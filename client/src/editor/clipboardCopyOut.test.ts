/**
 * Copy-out payload pins (YAZ-1443). The app writes BOTH clipboard formats on copy —
 * readable text/plain (clipboardTextSerializer) and rich HTML (ProseMirror clipboard
 * serialization). These tests pin the shapes YAZ-933 cares about (nested bullets, bold,
 * headings) so a Milkdown upgrade that degrades either format fails here instead of in a
 * user's paste into Linear/Claude/Docs. Sibling of clipboardOrderedList.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { EditorView as CodeMirrorView } from '@codemirror/view'
import { EditorSelection, EditorState, StateEffect } from '@codemirror/state'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const copyListeners = new Set<(mode: 'plain' | 'markdown') => string | undefined>()
let originalApi: typeof window.yaseenDocs
beforeEach(() => {
  originalApi = window.yaseenDocs
  window.yaseenDocs = { ...originalApi, menu: { ...originalApi?.menu, onCopyAs: listener => {
    copyListeners.add(listener)
    return () => { copyListeners.delete(listener) }
  } } }
})

function copyAs(mode: 'plain' | 'markdown') {
  for (const listener of copyListeners) {
    const text = listener(mode)
    if (text !== undefined) return text
  }
  return undefined
}

async function mount(markdown: string): Promise<{ view: EditorView; crepe: Crepe }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { view, crepe }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  window.yaseenDocs = originalApi
  copyListeners.clear()
})

/** What the clipboard would carry for the current selection — same probe as clipboardOrderedList.test.ts. */
function payload(view: EditorView): { text: string; html: string } {
  const slice = view.state.selection.content()
  const { text, dom } = view.serializeForClipboard(slice)
  return { text, html: dom.innerHTML }
}

function selectAll(view: EditorView): void {
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)))
}

describe('copy-out carries readable text/plain AND rich text/html (YAZ-1443)', () => {
  it.each(['<br />', '<br/>', '<br>', '<br >'])('copies message spacing without %s while preserving the saved document (YAZ-1389)', async (spacer) => {
    const { view, crepe } = await mount(`Hi FIRST_NAME,\n\n${spacer}\n\nHello **friend**.\n`)
    selectAll(view)
    const doc = view.state.doc
    const selection = view.state.selection
    const saved = getMarkdownForSave(crepe)
    const { text, html } = payload(view)
    expect(text).toBe('Hi FIRST_NAME,\n\nHello friend.')
    const copied = document.createElement('div')
    copied.innerHTML = html
    const paragraphs = [...copied.querySelectorAll('p')]
    expect(paragraphs).toHaveLength(2)
    for (const paragraph of paragraphs) {
      expect(paragraph.style.marginTop).toBe('0px')
      expect(paragraph.style.marginBottom).toBe('0px')
    }
    expect(paragraphs[0].getAttribute('data-pm-slice')).toBe('0 0 []')
    expect([...copied.children].map(node => node.tagName)).toEqual(['P', 'BR', 'P'])
    expect(copied.children[1].getAttribute('data-mdapp-empty-paragraph')).toBe('true')
    expect(paragraphs[1].innerHTML).toBe('Hello <strong>friend</strong>.')
    expect(view.state.doc).toBe(doc)
    expect(view.state.selection).toBe(selection)
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(saved).toContain('<br />')
  })

  it('keeps each blank paragraph explicit without adding breaks to ordinary or inline-break paragraphs', async () => {
    const { view, crepe } = await mount('First.\n\n<br />\n\n<br />\n\nSecond.\\\nInline.\n')
    selectAll(view)
    const saved = getMarkdownForSave(crepe)
    const editorHtml = view.dom.innerHTML
    const copied = document.createElement('div')
    copied.innerHTML = payload(view).html
    const paragraphs = [...copied.querySelectorAll('p')]
    expect([...copied.children].map(node => node.tagName)).toEqual(['P', 'BR', 'BR', 'P'])
    expect(copied.querySelectorAll('br[data-mdapp-empty-paragraph]')).toHaveLength(2)
    expect(paragraphs.map(p => p.querySelectorAll('br').length)).toEqual([0, 1])
    expect(paragraphs[1].textContent).toBe('Second.Inline.')
    expect(getMarkdownForSave(crepe)).toBe(saved)
    expect(view.dom.innerHTML).toBe(editorHtml)
  })

  it('retains links and code inside zero-margin clipboard paragraphs', async () => {
    const { view } = await mount('[Link](https://example.com) and `literal <br />`\n\n* **List item**\n')
    selectAll(view)
    const copied = document.createElement('div')
    copied.innerHTML = payload(view).html
    expect(copied.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(copied.querySelector('code')?.textContent).toBe('literal <br />')
    expect(copied.querySelector('li strong')?.textContent).toBe('List item')
    for (const paragraph of copied.querySelectorAll('p')) {
      if (paragraph.textContent) expect(paragraph.querySelector('br')).toBeNull()
      expect(paragraph.style.marginTop).toBe('0px')
      expect(paragraph.style.marginBottom).toBe('0px')
    }
  })

  it('removes repeated spacing tags without changing literal inline/fenced code or underline markup', async () => {
    const { view } = await mount('## Message\n\n<br />\n\n<br />\n\nUse `<br />` with <u>care</u>.\n\n```html\n<br />\n```\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toBe('Message\n\n\nUse <br /> with care.\n<br />\n')
    expect(text.match(/<br \/>/g)).toHaveLength(2)
    expect(html).toContain('<u>care</u>')
    expect(html).toContain('&lt;br /&gt;')
  })

  it.each(['`<br />`\n', '```html\n<br />\n```\n'])('keeps a literal break tag selected inside code', async (markdown) => {
    const { view } = await mount(markdown)
    let from = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === '<br />') from = pos
    })
    expect(from).toBeGreaterThanOrEqual(0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 6)))
    expect(payload(view).text).toBe('<br />')
  })

  it('copies an empty paragraph as whitespace rather than falling back to the original spacer tag', async () => {
    const { view } = await mount('Before\n\n<br />\n\nAfter\n')
    let empty = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) empty = pos
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, empty)))
    const { text, html } = payload(view)
    expect(text).toMatch(/^\s+$/)
    expect(html).toContain('<br')
    expect(html).toContain('data-mdapp-empty-paragraph="true"')
  })

  it('keeps simultaneous editor instances independent', async () => {
    const [first, second] = await Promise.all([mount('First\n\n<br />\n\nEnd\n'), mount('Second\n\n<br />\n\nEnd\n')])
    selectAll(first.view)
    selectAll(second.view)
    expect(payload(first.view).text).toBe('First\n\nEnd')
    expect(payload(second.view).text).toBe('Second\n\nEnd')
  })

  it('nested bullets: readable labels keep nesting, HTML has nested <ul>', async () => {
    const { view } = await mount('* parent\n  * child one\n  * child two\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('• parent')
    expect(text).toContain('  • child one')
    expect(text).toContain('  • child two')
    expect(html.match(/<ul/g)!.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('<li')
  })

  it('bold and italic keep words in plain text and formatting in HTML', async () => {
    const { view } = await mount('some **bold** and *italic* words\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toBe('some bold and italic words')
    expect(html).toContain('<strong')
    expect(html).toContain('<em')
  })

  it('headings keep words in plain text and formatting in HTML', async () => {
    const { view } = await mount('## Section title\n\nbody text\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toBe('Section title\nbody text')
    expect(html).toContain('<h2')
  })

  it('the Slack-shaped nested outline carries readable indented bullets', async () => {
    const { view } = await mount('* top .\n  * middle .\n    * deep .\n')
    selectAll(view)
    const { text, html } = payload(view)
    expect(text).toContain('    • deep .')
    // `data-label="•"` attributes are internal ProseMirror metadata; what matters is that the
    // VISIBLE content carries no literal bullets (the structure is real <ul> nesting).
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('•')
  })

  it('copies the Fiverr paragraph/number shape with one intentional blank line and no escapes', async () => {
    const { view, crepe } = await mount('Hi FRIEND,\n\n<br />\n\nMore information:\n\n<br />\n\n1\\. Do you work alone?\n\n<br />\n\n2\\. How much time?\n')
    selectAll(view)
    const saved = getMarkdownForSave(crepe)
    expect(payload(view).text).toBe('Hi FRIEND,\n\nMore information:\n\n1. Do you work alone?\n\n2. How much time?')
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('preserves consecutive empty paragraphs, inline breaks, spaces and literal code', async () => {
    const { view } = await mount('First  sentence.\\\nNext line.\n\n<br />\n\n<br />\n\nUse `1\\. literal` and **bold**.\n')
    selectAll(view)
    expect(payload(view).text).toBe('First  sentence.\nNext line.\n\n\nUse 1\\. literal and bold.')
  })

  it('copies selected words from a list without inventing a bullet', async () => {
    const { view } = await mount('* Before **selected** after\n')
    let from = -1
    view.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'selected') from = pos })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 8)))
    expect(payload(view).text).toBe('selected')
    expect(payload(view).html).toContain('<strong>selected</strong>')
  })

  it('keeps task labels, list starts, links and table cell boundaries readable', async () => {
    const { view } = await mount('3. first\n4. second\n\n* [x] done\n* [ ] pending\n\n[Website](https://example.com)\n\n| Name | Value |\n| --- | --- |\n| Alice | 42 |\n')
    selectAll(view)
    expect(payload(view).text).toBe('3. first\n4. second\n☑ done\n☐ pending\nWebsite\nName\tValue\nAlice\t42\n')
  })

  it('explicit Markdown retains source formatting and spacers while Plain text matches normal copy', async () => {
    const { view, crepe } = await mount('Hi FRIEND,\n\n<br />\n\n1\\. **Important** [link](https://example.com)\n')
    view.focus()
    selectAll(view)
    const saved = getMarkdownForSave(crepe)
    const selection = view.state.selection
    expect(copyAs('plain')).toBe('Hi FRIEND,\n\n1. Important link')
    expect(copyAs('plain')).toBe(payload(view).text)
    expect(copyAs('markdown')).toBe(saved)
    expect(copyAs('markdown')).toContain('<br />')
    expect(copyAs('markdown')).toContain('**Important** [link](https://example.com)')
    expect(view.state.selection).toBe(selection)
    expect(getMarkdownForSave(crepe)).toBe(saved)
  })

  it('copies only the focused selection, supports read-only, no-ops at a caret and unsubscribes', async () => {
    const first = await mount('First')
    const second = await mount('Second')
    selectAll(first.view)
    selectAll(second.view)
    second.view.focus()
    second.view.setProps({ editable: () => false })
    expect(copyAs('plain')).toBe('Second')
    second.view.dispatch(second.view.state.tr.setSelection(TextSelection.atEnd(second.view.state.doc)))
    expect(copyAs('markdown')).toBe('')
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    expect(copyAs('plain')).toBeUndefined()
    input.remove()
    await second.crepe.destroy()
    mounted.pop()!.root.remove()
    expect(copyListeners.size).toBe(1)
  })

  it.each([
    '* parent\n  * child A\n  * child B\n',
    '* ancestor\n  * parent\n    * child A\n    * child B\n',
  ])('keeps selected parent/child hierarchy without adding unselected ancestors: %s', async markdown => {
    const { view } = await mount(markdown)
    let from = -1, to = -1
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'parent') from = pos
      if (node.isText && node.text === 'child A') to = pos + 7
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    expect(payload(view).text).toBe('• parent\n  • child A')
  })

  it('explicit code copy uses all selected state ranges, preserving line breaks without fences', async () => {
    const { view } = await mount('```text\nfirst\nsecond\nthird\n```\n')
    view.focus()
    const code = CodeMirrorView.findFromDOM(view.dom.querySelector<HTMLElement>('.cm-content')!)!
    code.dispatch({ effects: StateEffect.appendConfig.of(EditorState.allowMultipleSelections.of(true)),
      selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(13, 18)]) })
    code.focus()
    expect(copyAs('plain')).toBe('first\nthird')
    expect(copyAs('markdown')).toBe('first\nthird')
    code.dispatch({ selection: EditorSelection.single(2, 10) })
    expect(copyAs('plain')).toBe('rst\nseco')
    code.dispatch({ selection: EditorSelection.cursor(0) })
    expect(copyAs('plain')).toBe('')
  })
})
