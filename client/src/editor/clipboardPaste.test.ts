import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrepeFeature, type Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { undo } from '@milkdown/kit/prose/history'
import { Slice } from '@milkdown/kit/prose/model'
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { ClipboardPasteRequest } from '@shared/types'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import type { ImageOptions } from './image/imageOptions'
import { isBulletsOnly, lockToBullets, outlineFeatures } from './outline/bulletsOnly'

// Image bytes on the clipboard reach the vault through `writeAsset` (YAZ-1656); the rest of this file never touches `api`.
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { writeAsset: vi.fn() },
}))
import { api } from '../api'
const writeAsset = vi.mocked(api.writeAsset)

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const listeners = new Set<(request: ClipboardPasteRequest) => boolean>()
let originalApi: typeof window.yaseenDocs
beforeEach(() => {
  originalApi = window.yaseenDocs
  window.yaseenDocs = { ...originalApi, menu: { ...originalApi?.menu, onPasteAs: (listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  } } }
})
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
  window.yaseenDocs = originalApi
  listeners.clear()
})
async function mount(markdown = '', outline = false, nativeCode = false, image?: ImageOptions) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image, ...(outline ? { features: outlineFeatures } : nativeCode ? { features: { [CrepeFeature.CodeMirror]: false } } : {}) })
  if (outline) lockToBullets(crepe)
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  view.focus()
  return { crepe, view }
}
function pasteAs(mode: ClipboardPasteRequest['mode'], text: string) {
  return [...listeners].some(listener => listener({ mode, text }))
}
function pasteHtml(view: EditorView, html: string, text = 'First.\n\nSecond.') {
  return view.pasteHTML(html, { clipboardData: { getData: (t: string) => t === 'text/html' ? html : t === 'text/plain' ? text : '' }, preventDefault() {} } as unknown as ClipboardEvent)
}
function pasteText(view: EditorView, text: string) {
  return view.pasteText(text, { clipboardData: { getData: (type: string) => type === 'text/plain' ? text : '' }, preventDefault() {} } as unknown as ClipboardEvent)
}
const all = (view: EditorView) => view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
const textOf = (view: EditorView) => view.state.doc.textBetween(0, view.state.doc.content.size, '\n', '\n')

describe('external pasted numbers are literal text (YAZ-1429)', () => {
  function expectNoNumberedLists(view: EditorView) {
    view.state.doc.descendants(node => { expect(node.type.name).not.toBe('ordered_list') })
  }
  const text = 'so there are\n\n1. solo guys\n2. guys who have an agency but its just them\n3. guys who run their own agencies and have a team\n4. and guys who work at agencies'
  it('preserves external rich list numbers as literal text', async () => {
    const { view, crepe } = await mount()
    pasteHtml(view, '<p>so there are</p><ol><li>solo guys</li><li>guys who have an agency but its just them</li><li>guys who run their own agencies and have a team</li><li>and guys who work at agencies</li></ol>', text)
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe(text.replace('\n\n', '\n'))
    expect(getMarkdownForSave(crepe)).toContain('1\\. solo guys')
  })
  it('preserves plain-text-only numbers without Markdown list creation', async () => {
    const { view, crepe } = await mount()
    pasteText(view, text)
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe(text.replace('\n\n', '\n'))
    expect(getMarkdownForSave(crepe)).toContain('1\\. solo guys')
  })
  it('retains original plain-text labels, punctuation and inline formatting instead of renumbering', async () => {
    const { view, crepe } = await mount()
    pasteText(view, '3) **first**\n9) [second](https://example.com)\n9) third')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('3) first\n9) second\n9) third')
    expect(getMarkdownForSave(crepe)).toContain('**first**')
    expect(getMarkdownForSave(crepe)).toContain('[second](https://example.com)')
  })
  it('retains rich list starts, explicit item values, reverse order and marks', async () => {
    const { view, crepe } = await mount()
    pasteHtml(view, '<ol start="5" reversed><li><p><strong>first</strong></p></li><li value="9"><a href="https://example.com">second</a></li><li>third</li></ol>')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('5. first\n9. second\n8. third')
    expect(getMarkdownForSave(crepe)).toContain('**first**')
    expect(getMarkdownForSave(crepe)).toContain('[second](https://example.com)')
  })
  it.each([['A', 27, 'AA. first\nAB. second'], ['a', 2, 'b. first\nc. second'], ['I', 4, 'IV. first\nV. second'], ['i', 9, 'ix. first\nx. second']])(
    'preserves native HTML %s marker labels as text', async (type, start, expected) => {
      const { view } = await mount()
      pasteHtml(view, `<ol type="${type}" start="${start}"><li>first</li><li>second</li></ol>`)
      expectNoNumberedLists(view)
      expect(textOf(view)).toBe(expected)
    },
  )
  it('preserves nested bullets, paragraphs and code around external numbered items', async () => {
    const { view } = await mount()
    pasteHtml(view, '<ul><li><p>parent</p><ol><li><p>child</p><ul><li>bullet</li></ul><p>continuation</p></li><li>next</li></ol></li></ul><pre><code>1. literal\n2. code</code></pre>')
    expectNoNumberedLists(view)
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    // Crepe retains its normal trailing paragraph after a code block.
    expect(textOf(view)).toBe('parent\n1. child\nbullet\ncontinuation\n2. next\n1. literal\n2. code\n')
  })
  it('only changes parsed Markdown lists, preserving fenced and indented code', async () => {
    const { view } = await mount('', false, true)
    pasteText(view, '1. first\n2. second\n\n```text\n1. fenced\n2. code\n```\n\n    1. indented\n    2. code')
    expectNoNumberedLists(view)
    const code: string[] = []
    view.state.doc.descendants(node => { if (node.type.name === 'code_block') code.push(node.textContent) })
    expect(code).toEqual(['1. fenced\n2. code', '1. indented\n2. code'])
  })
  it('keeps numbering literal in normal fake-bullet outline paste too', async () => {
    const { view } = await mount()
    pasteText(view, '• parent\n• sibling\n\n1. first\n2. second')
    expectNoNumberedLists(view)
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(textOf(view)).toContain('1. first\n2. second')
  })
  it('keeps checked and unchecked Markdown task markers as literal text', async () => {
    const { view } = await mount()
    pasteText(view, '1. [x] done\n2. [ ] pending')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('1. [x] done\n2. [ ] pending')
  })
  it.each([
    ['<ol><li><!-- comment --><p>first</p></li></ol>', '1. first'],
    ['<ol><li><div><p>first</p><p>second</p></div></li></ol>', '1. first\nsecond'],
    ['<ol><li><ol><li>child</li></ol></li></ol>', '1.\n1. child'],
    ['<ol><li>item</li>unusual source content</ol>', '1. item\nunusual source content'],
  ])('keeps labels with their intended rich-text block: %s', async (html, expected) => {
    const { view } = await mount()
    pasteHtml(view, html)
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe(expected)
  })
  it('runs outline paste constraints for mixed fake bullets and numbered text', async () => {
    const { view } = await mount('* existing', true)
    all(view)
    const before = view.state.doc.toJSON()
    pasteText(view, '• parent\n• sibling\n\n1. first\n2. second')
    expect(isBulletsOnly(view.state.doc)).toBe(true)
    expect(textOf(view)).toBe('parent\nsibling\n1. first\n2. second')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(before)
  })
  it('does not automatically continue numbering on Enter', async () => {
    const { view } = await mount()
    pasteText(view, '1. first\n2. second')
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
    view.someProp('handleKeyDown', handler => handler(view, new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13 })))
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('1. first\n2. second\n')
  })
  it('does not reconstruct foreign numbering from ProseMirror clipboard context', async () => {
    const { view } = await mount()
    pasteHtml(view, '<div data-pm-slice=\'1 1 ["ordered_list",{"order":5},"list_item",{}]\'><p>Selected text</p><ol><li>child</li></ol></div>')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('Selected text\n1. child')
  })
  it('preserves internal ordered lists but not ordered HTML from another ProseMirror editor', async () => {
    const { view } = await mount('* Parent\n  1. First\n  2. Second')
    const before = view.state.doc.toJSON()
    all(view)
    const { dom, text } = view.serializeForClipboard(view.state.selection.content())
    pasteHtml(view, dom.innerHTML, text)
    expect(view.state.doc.toJSON()).toEqual(before)
    all(view)
    pasteHtml(view, '<ol data-pm-slice="0 0 []"><li><p>External</p></li></ol>')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('1. External')
  })
  it('retains explicit Markdown numbering and literal plain paste', async () => {
    const { view } = await mount()
    pasteAs('markdown', '1. first\n2. second')
    expect(view.state.doc.firstChild?.type.name).toBe('ordered_list')
    all(view)
    pasteAs('plain', '1. first\n2. second')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('1. first\n2. second')
  })
  it('pastes into the current selection as one undo step and reloads as literal text', async () => {
    const { view, crepe } = await mount('Before middle after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 14)))
    const before = view.state.doc.toJSON()
    pasteText(view, '1. first\n2. second')
    expectNoNumberedLists(view)
    expect(textOf(view)).toBe('Before 1. first\n2. second after')
    const reloaded = await mount(getMarkdownForSave(crepe))
    expectNoNumberedLists(reloaded.view)
    expect(textOf(reloaded.view)).toBe(textOf(view))
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(before)
  })
  it.each(['<ol><li>first</li></ol>', '<ol><li>first</li><li>second</li></ol>'])('undoes rich numbered paste without undoing preceding typing: %s', async html => {
    const { view } = await mount('Before')
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)).insertText(' typed '))
    const before = view.state.doc.toJSON()
    pasteHtml(view, html)
    expectNoNumberedLists(view)
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(before)
  })
})

describe('explicit paste modes through the native menu subscription', () => {
  it('inserts plain text literally, preserving spaces, CRLF and blank lines without Markdown interpretation', async () => {
    const { view } = await mount()
    const text = '# Heading\r\n\r\n**bold**  [link](https://example.com)\n- item\n'
    expect(pasteAs('plain', text)).toBe(true)
    expect(textOf(view)).toBe(text.replace(/\r\n/g, '\n'))
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    view.state.doc.descendants(node => { expect(node.marks).toEqual([]); expect(['paragraph', 'text', 'hardbreak']).toContain(node.type.name) })
  })
  it('parses explicit Markdown using existing schema including marks, links and lists', async () => {
    const { crepe, view } = await mount()
    expect(pasteAs('markdown', '# Heading\n\n**bold** [link](https://example.com)\n\n- first\n- second')).toBe(true)
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(getMarkdownForSave(crepe)).toContain('**bold**')
    expect(getMarkdownForSave(crepe)).toContain('[link](https://example.com)')
    expect(view.state.doc.content.toJSON().some((n: {type:string}) => n.type === 'bullet_list')).toBe(true)
  })
  it('replaces only the active selection and undoes the entire paste once', async () => {
    const { view } = await mount('Before middle after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 14)))
    const before = view.state.doc.toJSON()
    pasteAs('plain', 'new\ntext')
    expect(textOf(view)).toBe('Before new\ntext after')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(before)
  })
  it('routes only to the focused editor and unsubscribes on destroy', async () => {
    const first = await mount('First')
    const second = await mount('Second')
    all(first.view); first.view.focus()
    pasteAs('plain', 'Replacement')
    expect(textOf(first.view)).toBe('Replacement')
    expect(textOf(second.view)).toBe('Second')
    const input = document.createElement('input'); document.body.append(input); input.focus()
    expect(pasteAs('markdown', '# Native input fallback')).toBe(false)
    input.remove()
    for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
    expect(listeners.size).toBe(0)
  })
  it('keeps Markdown pasted into a sentence inline and one undo step', async () => {
    const { view } = await mount('Before middle after')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8, 14)))
    pasteAs('markdown', '**bold**')
    expect(view.state.doc.childCount).toBe(1)
    expect(textOf(view)).toBe('Before bold after')
    expect(view.state.doc.firstChild?.child(1).marks[0]?.type.name).toBe('strong')
    undo(view.state, view.dispatch)
    expect(textOf(view)).toBe('Before middle after')
  })
  it('keeps every mode literal inside code, including fake bullets on ordinary paste', async () => {
    const { view } = await mount('```text\nold\n```', false, true)
    for (const mode of ['plain', 'markdown'] as const) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + view.state.doc.firstChild!.content.size)))
      view.focus()
      expect(pasteAs(mode, '# heading\r\n**literal**')).toBe(true)
      expect(view.state.doc.firstChild?.type.name).toBe('code_block')
      expect(view.state.doc.firstChild?.textContent).toBe('# heading\n**literal**')
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1 + view.state.doc.firstChild!.content.size)))
    pasteHtml(view, '<ul><li>one</li><li>two</li></ul>', '• one\n• two')
    expect(view.state.doc.firstChild?.textContent).toBe('• one\n• two')
  })
  it('lets CodeMirror own native insertion at its internal caret', async () => {
    const { view } = await mount('```text\ncode\n```')
    const code = view.dom.querySelector<HTMLElement>('.cm-content')!
    expect(code).not.toBeNull()
    code.focus()
    expect(pasteAs('markdown', '# literal')).toBe(false)
    expect(view.state.doc.firstChild?.textContent).toBe('code')
  })
  it('does not change a read-only editor', async () => {
    const { view } = await mount('Read only')
    all(view)
    view.setProps({ editable: () => false })
    pasteAs('plain', 'replacement')
    pasteHtml(view, '<p>replacement</p>')
    expect(textOf(view)).toBe('Read only')
  })
  it('treats empty clipboard text as a no-op and never deletes the selection', async () => {
    const { view } = await mount('Keep this')
    all(view)
    pasteAs('plain', ''); pasteAs('markdown', '')
    expect(textOf(view)).toBe('Keep this')
  })
  it('runs existing outline paste constraints for explicit Markdown and literal plain text', async () => {
    const { view } = await mount('- existing', true)
    pasteAs('markdown', '# Heading\n\nParagraph')
    expect(isBulletsOnly(view.state.doc)).toBe(true)
    expect(textOf(view)).toContain('Heading')
    pasteAs('plain', '# literal\n\nnext')
    expect(isBulletsOnly(view.state.doc)).toBe(true)
    expect(textOf(view)).toContain('# literal\n\nnext')
  })
})

describe('automatic rich paste spacing', () => {
  it('represents a standalone paragraph separator as one empty paragraph, preserving rich marks', async () => {
    const { view, crepe } = await mount()
    pasteHtml(view, '<b id="docs-internal-guid-test" style="font-weight:normal"><p><strong>First.</strong></p><br><p>Second.</p></b>')
    expect(view.state.doc.childCount).toBe(3)
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).childCount).toBe(0)
    expect(getMarkdownForSave(crepe)).toBe('**First.**\n\n<br />\n\nSecond.\n')
  })
  it('preserves multiple intentional standalone separators', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.</p>\n<br>\n<br>\n<p>Second.</p>')
    expect(view.state.doc.childCount).toBe(4)
    expect(view.state.doc.child(1).content.size).toBe(0)
    expect(view.state.doc.child(2).content.size).toBe(0)
  })
  it('keeps ordinary paragraphs, inline breaks and explicit empty paragraphs', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.<br>inline</p><p></p><p>Second.</p>')
    expect(view.state.doc.child(0).child(1).type.name).toBe('hardbreak')
    expect(view.state.doc.child(1).content.size).toBe(0)
  })
  it('does not change internal clipboard structure, nested lists or code', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p data-pm-slice="0 0 []">First.</p><br><p>Second.</p>')
    expect(view.state.doc.child(1).firstChild?.type.name).toBe('hardbreak')
    all(view)
    pasteHtml(view, '<ul><li><p>Item<br>continuation</p></li></ul><pre><code>one\n\ntwo</code></pre>')
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
    expect(textOf(view)).toContain('Item\ncontinuation')
    expect(textOf(view)).toContain('one\n\ntwo')
  })
  it('restores marked leading and trailing empty paragraphs with internal slice metadata', async () => {
    const { view } = await mount()
    const { schema } = view.state
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [
      schema.nodes.paragraph.create(),
      schema.nodes.paragraph.create(null, schema.text('Middle')),
      schema.nodes.paragraph.create(),
    ]))
    const expected = view.state.doc.toJSON()
    all(view)
    const { dom, text } = view.serializeForClipboard(view.state.selection.content())
    expect(dom.firstElementChild?.tagName).toBe('BR')
    expect(dom.firstElementChild?.hasAttribute('data-pm-slice')).toBe(true)
    expect(dom.querySelectorAll('br[data-mdapp-empty-paragraph]')).toHaveLength(2)
    pasteHtml(view, dom.innerHTML, text)
    expect(view.state.doc.toJSON()).toEqual(expected)
  })
  it('restores empty paragraphs inside nested lists without turning them into inline breaks', async () => {
    const { view } = await mount('- parent\n  - \n  - child\n')
    const expected = view.state.doc.toJSON()
    all(view)
    const { dom, text } = view.serializeForClipboard(view.state.selection.content())
    expect(dom.querySelector('li br[data-mdapp-empty-paragraph]')).not.toBeNull()
    pasteHtml(view, dom.innerHTML, text)
    expect(view.state.doc.toJSON()).toEqual(expected)
  })
  it('does not multiply blank paragraphs across repeated rich copy/paste round trips', async () => {
    const { view } = await mount()
    pasteHtml(view, '<p>First.</p><br><p>Second.</p>')
    const expected = view.state.doc.toJSON()
    for (let i = 0; i < 3; i++) {
      all(view)
      const { dom, text } = view.serializeForClipboard(view.state.selection.content())
      pasteHtml(view, dom.innerHTML, text)
      expect(view.state.doc.toJSON()).toEqual(expected)
    }
  })
})

describe('image bytes on the clipboard (YAZ-1656 / YAZ-1662)', () => {
  const IMAGE: ImageOptions = { root: '/v', notePath: '/v/notes/n.md' }
  const PNG = new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' })
  /** The written name is `<note>-<stamp>.png`; the clock is the code's, so only its shape is pinned. */
  const IMG = String.raw`!\[n-\d{8}-\d{6}\]\(assets/images/n-\d{8}-\d{6}\.png\)`
  /** A ClipboardEvent / DragEvent stand-in: jsdom has no DataTransfer, and the two lists are all the code reads. */
  const withFiles = (files: File[], data: Record<string, string> = {}) => {
    const transfer = { files: files as unknown as FileList, items: [] as unknown as DataTransferItemList, getData: (t: string) => data[t] ?? '' } as unknown as DataTransfer
    return { clipboardData: transfer, dataTransfer: transfer, preventDefault() {}, clientX: 0, clientY: 0 } as unknown as ClipboardEvent & DragEvent
  }
  const drop = (view: EditorView, event: DragEvent) => view.someProp('handleDrop', (handle) => handle(view, event, Slice.empty, false))
  beforeEach(() => {
    writeAsset.mockReset()
    writeAsset.mockResolvedValue({ path: '/v/assets/images/n.png', mtime: 1, size: 3 })
  })

  it('an image file wins over the HTML riding with it: the bytes are written, the markup never lands', async () => {
    const { view, crepe } = await mount('', false, false, IMAGE)
    const html = '<p>Finder copy</p>'
    expect(view.pasteHTML(html, withFiles([PNG], { 'text/html': html, 'text/plain': 'Finder copy' }))).toBe(true)
    await vi.waitFor(() => expect(getMarkdownForSave(crepe)).toMatch(new RegExp(`^${IMG}\n$`)))
    expect(writeAsset).toHaveBeenCalledTimes(1)
    expect(textOf(view)).not.toContain('Finder copy')
  })

  it('inside a code block the image is refused: nothing written, the code untouched', async () => {
    const { view } = await mount('```text\ncode\n```', false, true, IMAGE)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
    view.pasteHTML('', withFiles([PNG]))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeAsset).not.toHaveBeenCalled()
    expect(view.state.doc.firstChild?.type.name).toBe('code_block')
    expect(view.state.doc.firstChild?.textContent).toBe('code')
  })

  it('a dropped image lands at the DROP position, not at the caret', async () => {
    const { view, crepe } = await mount('before after', false, false, IMAGE)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    // jsdom has no layout: the drop coordinates resolve to "after `before `" by hand.
    view.posAtCoords = () => ({ pos: 8, inside: 0 })
    expect(drop(view, withFiles([PNG]))).toBe(true)
    await vi.waitFor(() => expect(getMarkdownForSave(crepe)).toMatch(new RegExp(`^before ${IMG}after\n$`)))
  })

  it('a drop over a code block is refused outright — handled, and nothing written', async () => {
    const { view } = await mount('```text\ncode\n```', false, true, IMAGE)
    view.posAtCoords = () => ({ pos: 2, inside: 0 })
    expect(drop(view, withFiles([PNG]))).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(writeAsset).not.toHaveBeenCalled()
    expect(view.state.doc.firstChild?.textContent).toBe('code')
  })
})
