/**
 * Paste-in translator for fake-bullet outlines (YAZ-937). Contract:
 *  - `outlineToMarkdown(text)` — pure: translated markdown for outline-shaped text, null otherwise.
 *  - Wired into `createCrepe` as a DIRECT editor prop `handlePaste` (direct props run before the
 *    clipboard plugin's), firing only for outline-shaped plain text when the HTML payload (if any)
 *    carries no real list markup — genuine rich-list pastes keep Milkdown's HTML path.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'
import { outlineToMarkdown } from './outlinePaste'
import { SLACK_OUTLINE_SAMPLE, SLACK_OUTLINE_EXPECTED } from './outlinePaste.fixtures'

describe('outlineToMarkdown (pure)', () => {
  it('translates the Slack sample: ranks nest (• ◦ ■), blank lines between bullets are dropped, non-bullet lines stay paragraphs', () => {
    expect(outlineToMarkdown(SLACK_OUTLINE_SAMPLE)).toBe(SLACK_OUTLINE_EXPECTED)
  })

  it('leading indentation deepens nesting for a repeated bullet char', () => {
    expect(outlineToMarkdown('• a\n  • b\n• c')).toBe('- a\n  - b\n- c')
  })

  it('treats ▪ like ■ (rank 3)', () => {
    expect(outlineToMarkdown('• a\n▪ b')).toBe('- a\n    - b')
  })

  it('returns null for prose that merely contains a bullet character mid-line', () => {
    expect(outlineToMarkdown('The bullet • is a character.\nIt is • not a list.')).toBeNull()
  })

  it('returns null for a single bullet line (outline needs at least two)', () => {
    expect(outlineToMarkdown('• just one line')).toBeNull()
  })

  it('returns null for text that is already markdown', () => {
    expect(outlineToMarkdown('- one\n  - two\n- three')).toBeNull()
  })

  it('strips the trailing " ." junk Slack appends — but only a period after whitespace (YAZ-933 decision)', () => {
    expect(outlineToMarkdown('• junk here .\n• more junk  .')).toBe('- junk here\n- more junk')
    expect(outlineToMarkdown('• real sentence.\n• ends with colon:.')).toBe('- real sentence.\n- ends with colon:.')
  })
})

// ---------------------------------------------------------------------------
// Integration: the translator wired into the real editor's paste chain.
// ---------------------------------------------------------------------------

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/**
 * Drive the editor's real paste pipeline with a fake clipboard event. When HTML is present,
 * `view.pasteHTML` (ProseMirror's own test entry point) builds the pre-processed slice exactly
 * as a real paste would before the handlePaste chain runs — a hand-rolled slice here once forced
 * production code to re-parse HTML itself.
 */
function paste(view: EditorView, data: Record<string, string>): boolean {
  const event = {
    clipboardData: { getData: (t: string) => data[t] ?? '' },
    preventDefault: () => {},
  } as unknown as ClipboardEvent
  const html = data['text/html']
  if (html !== undefined) return view.pasteHTML(html, event)
  return view.someProp('handlePaste', (f) => f(view, event, view.state.doc.slice(0))) ?? false
}

/** Every list_item in document order as {depth, text} — depth 0 = top-level item. */
function outlineOf(view: EditorView): Array<{ depth: number; text: string }> {
  const items: Array<{ depth: number; text: string }> = []
  const walk = (node: EditorView['state']['doc'], depth: number): void => {
    node.forEach((child) => {
      if (child.type.name === 'list_item') {
        items.push({ depth, text: child.firstChild?.textContent ?? '' })
        walk(child as never, depth + 1)
      } else {
        walk(child as never, depth)
      }
    })
  }
  walk(view.state.doc, 0)
  return items
}

describe('outline paste wired into the editor (YAZ-937)', () => {
  it('pasting the Slack sample produces real nested lists, not flat • paragraphs', async () => {
    const { view } = await mount('')
    expect(paste(view, { 'text/plain': SLACK_OUTLINE_SAMPLE })).toBe(true)
    expect(outlineOf(view)).toEqual([
      { depth: 0, text: 'this is the foundation to:.' },
      { depth: 1, text: '1) content (short form // long form)' },
      { depth: 1, text: '2) business (lead magnets // agents, automations we would build)' },
      { depth: 0, text: 'What is the business wiki?' },
      { depth: 1, text: 'it’s my library of Alexandria // my mochi // my second brain for business' },
      { depth: 2, text: 'database system' },
      { depth: 2, text: 'linking (wiki links)' },
    ])
    expect(view.state.doc.textContent).toContain('Phase 0) Business Wiki')
    expect(view.state.doc.textContent).not.toContain('•')
  })

  it('fires even when HTML is present, as long as that HTML has no real list markup (Slack ships flat HTML)', async () => {
    const { view } = await mount('')
    const flatHtml = '<p>• a</p><p>• b</p>'
    expect(paste(view, { 'text/plain': '• a\n• b', 'text/html': flatHtml })).toBe(true)
    expect(outlineOf(view)).toEqual([
      { depth: 0, text: 'a' },
      { depth: 0, text: 'b' },
    ])
  })

  it('does NOT hijack a genuine rich-list paste (HTML with <ul>/<li> wins, marks preserved)', async () => {
    const { view } = await mount('')
    paste(view, { 'text/plain': '• rich\n• list', 'text/html': '<ul><li><p><strong>rich</strong></p></li><li><p>list</p></li></ul>' })
    expect(outlineOf(view)).toEqual([
      { depth: 0, text: 'rich' },
      { depth: 0, text: 'list' },
    ])
    let hasBold = false
    view.state.doc.descendants((n) => {
      if (n.isText && n.marks.some((m) => m.type.name === 'strong')) hasBold = true
      return true
    })
    expect(hasBold).toBe(true)
  })

  it('leaves ordinary prose paste exactly on the existing markdown path', async () => {
    const { view } = await mount('')
    paste(view, { 'text/plain': 'Just a sentence with a • inside.\nAnd another line.' })
    const types: string[] = []
    view.state.doc.descendants((n) => {
      types.push(n.type.name)
      return true
    })
    expect(types).not.toContain('bullet_list')
    expect(view.state.doc.textContent).toContain('Just a sentence with a • inside.')
  })

  it('leaves markdown-shaped plain text on the existing markdown path (still nests)', async () => {
    const { view } = await mount('')
    paste(view, { 'text/plain': '- one\n  - two' })
    expect(outlineOf(view)).toEqual([
      { depth: 0, text: 'one' },
      { depth: 1, text: 'two' },
    ])
  })
})
