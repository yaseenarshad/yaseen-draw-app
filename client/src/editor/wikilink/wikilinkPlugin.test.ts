/**
 * Wikilink rendering (Links A, GRO-2190): real editor (`createCrepe`), `[[target]]` collapses to
 * a styled link via inline decorations — never a schema/serializer change. Pinned here: the hide
 * mechanics (brackets get `wikilink__syntax`, CSS `display: none`), alias/heading display, the
 * caret-adjacency reveal (boundaries inclusive), embed/code exclusion, and the live restyle when
 * the resolve source updates (meta transaction — no remount, no doc change).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import {
  WIKILINK_CLASS,
  WIKILINK_SUB_CLASS,
  WIKILINK_SYNTAX_CLASS,
  WIKILINK_UNRESOLVED_CLASS,
  createWikilinkResolveSource,
  type MutableWikilinkResolveSource,
} from './wikilinkPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string, wikilinks?: MutableWikilinkResolveSource) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

function caret(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** Visible link segments, in document order (never merged: syntax spans separate them). */
function links(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).map((el) => el.textContent ?? '')
}

/** All hidden syntax text joined — PM may merge adjacent same-class segments, the text cannot change. */
function syntax(root: HTMLElement): string {
  return Array.from(root.querySelectorAll(`.${WIKILINK_SYNTAX_CLASS}`))
    .map((el) => el.textContent ?? '')
    .join('')
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('wikilink decorations: collapsed display (GRO-2190)', () => {
  it('hides the brackets and styles the target as a link when the caret is outside', async () => {
    const { root } = await mount('Intro [[Target]] outro\n')
    expect(links(root)).toEqual(['Target'])
    expect(syntax(root)).toBe('[[]]')
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
  })

  it('[[target|alias]] shows only the alias', async () => {
    const { root } = await mount('See [[target|alias]] here\n')
    expect(links(root)).toEqual(['alias'])
    expect(syntax(root)).toBe('[[target|]]')
  })

  it('[[target#heading]] shows target and heading; the heading carries the separator class', async () => {
    const { root } = await mount('See [[target#head]] here\n')
    expect(links(root)).toEqual(['target', 'head'])
    expect(syntax(root)).toBe('[[#]]')
    const segments = root.querySelectorAll(`.${WIKILINK_CLASS}`)
    expect(segments[0].classList.contains(WIKILINK_SUB_CLASS)).toBe(false)
    expect(segments[1].classList.contains(WIKILINK_SUB_CLASS)).toBe(true)
  })

  it('[[a#^block]] shows the block ref as a sub segment', async () => {
    const { root } = await mount('Ref [[a#^blk]] end\n')
    expect(links(root)).toEqual(['a', '^blk'])
  })

  it('[[a#b#c]] hides every # and marks each later segment', async () => {
    const { root } = await mount('Deep [[a#b#c]] end\n')
    expect(links(root)).toEqual(['a', 'b', 'c'])
    expect(syntax(root)).toBe('[[##]]')
    const subs = Array.from(root.querySelectorAll(`.${WIKILINK_SUB_CLASS}`)).map((el) => el.textContent)
    expect(subs).toEqual(['b', 'c'])
  })

  it('an alias wins over a heading for display ([[a#h|alias]])', async () => {
    const { root } = await mount('X [[a#h|alias]] y\n')
    expect(links(root)).toEqual(['alias'])
    expect(syntax(root)).toBe('[[a#h|]]')
  })

  it('embeds (![[…]]) are never decorated', async () => {
    const { root } = await mount('An ![[img.png]] and ![[note]] here\n')
    expect(links(root)).toEqual([])
    expect(syntax(root)).toBe('')
  })

  it('code blocks and inline code are excluded; links outside still collapse', async () => {
    const { root } = await mount('```\n[[x]]\n```\n\nA `[[y]]` span and [[z]] link\n')
    expect(links(root)).toEqual(['z'])
  })

  it('unclosed [[ stays raw', async () => {
    const { root } = await mount('Nothing [[ here\n')
    expect(links(root)).toEqual([])
    expect(syntax(root)).toBe('')
  })

  it('[[Note|]] (empty alias) stays raw — never a zero-width invisible run (FN12, GRO-2197)', async () => {
    const { crepe, root } = await mount('pad [[Note|]] tail\n')
    expect(links(root)).toEqual([])
    expect(syntax(root)).toBe('')
    expect(viewOf(crepe).dom.textContent).toContain('[[Note|]]')
  })

  it('[[|]] and [[#]] (nothing visible in any part) stay raw too (FN12, GRO-2197)', async () => {
    const { crepe, root } = await mount('pad [[|]] and [[#]] tail\n')
    expect(links(root)).toEqual([])
    expect(syntax(root)).toBe('')
    expect(viewOf(crepe).dom.textContent).toContain('[[|]] and [[#]]')
  })

  it('adjacent links decorate independently', async () => {
    const { root } = await mount('Pair [[a]][[b]] end\n')
    expect(links(root)).toEqual(['a', 'b'])
    expect(syntax(root)).toBe('[[]][[]]')
  })

  it('a link inside bold collapses too', async () => {
    const { root } = await mount('**see [[a]]** rest\n')
    expect(links(root)).toEqual(['a'])
  })
})

describe('wikilink decorations: resolved vs unresolved', () => {
  const resolveKnown = (target: string) => (target === 'Known' ? '/vault/Known.md' : null)

  it('consults the resolve source: unresolved targets get the dimmed class', async () => {
    const source = createWikilinkResolveSource()
    source.update(resolveKnown)
    const { root } = await mount('A [[Known]] and a [[Missing]] link\n', source)
    const segments = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`))
    expect(segments.map((el) => el.textContent)).toEqual(['Known', 'Missing'])
    expect(segments[0].classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    expect(segments[1].classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
  })

  it('resolution uses the target only: alias and heading forms resolve like the bare link', async () => {
    const source = createWikilinkResolveSource()
    source.update(resolveKnown)
    const { root } = await mount('X [[Known|k]] and [[Known#h]] and [[Missing|m]] y\n', source)
    const unresolved = Array.from(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).map((el) => el.textContent)
    expect(unresolved).toEqual(['m'])
  })

  it('before the index has loaded (resolve null) nothing is dimmed', async () => {
    const { root } = await mount('A [[Whatever]] link\n', createWikilinkResolveSource())
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
  })

  it('[[#heading]] (same-file link, empty target) is never dimmed', async () => {
    const source = createWikilinkResolveSource()
    source.update(() => null)
    const { root } = await mount('Jump [[#heading]] now\n', source)
    expect(links(root)).toEqual(['heading'])
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
  })
})

describe('wikilink decorations: caret adjacency reveals the raw syntax', () => {
  // 'pad [[abc]] tail' — the match spans positions 5..12 (paragraph content starts at 1).
  const MD = 'pad [[abc]] tail\n'
  const FROM = 5
  const TO = 12

  it('caret inside the match drops its decorations (raw [[abc]] fully visible)', async () => {
    const { crepe, root } = await mount(MD)
    caret(crepe, FROM + 3)
    expect(links(root)).toEqual([])
    expect(syntax(root)).toBe('')
    expect(viewOf(crepe).dom.textContent).toContain('[[abc]]')
  })

  it('boundaries are inclusive: caret exactly at the edges reveals, one further out collapses', async () => {
    const { crepe, root } = await mount(MD)
    caret(crepe, FROM)
    expect(links(root)).toEqual([])
    caret(crepe, TO)
    expect(links(root)).toEqual([])
    caret(crepe, FROM - 1)
    expect(links(root)).toEqual(['abc'])
    caret(crepe, TO + 1)
    expect(links(root)).toEqual(['abc'])
  })

  it('a selection range overlapping the match reveals it', async () => {
    const { crepe, root } = await mount(MD)
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, FROM + 1)))
    expect(links(root)).toEqual([])
  })

  it('only the match under the caret reveals; other links stay collapsed', async () => {
    const { crepe, root } = await mount('[[a]] x [[b]]\n')
    caret(crepe, 3) // inside [[a]]
    expect(links(root)).toEqual(['b'])
    expect(syntax(root)).toBe('[[]]')
  })

  it('the initial caret at doc start reveals a link that starts the document (arrow-in expands)', async () => {
    // This is the adjacency rule doing the work for arrow traversal: the caret can never be
    // trapped against hidden text — at the boundary the whole match is already raw.
    const { root } = await mount('[[abc]] tail\n')
    expect(links(root)).toEqual([])
  })

  it('typing elsewhere keeps the link collapsed and correct', async () => {
    const { crepe, root } = await mount(MD)
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.insertText('x', view.state.doc.content.size - 1))
    expect(links(root)).toEqual(['abc'])
  })
})

describe('wikilink decorations: live restyle on index change (no remount, no doc change)', () => {
  it('source.update() restyles via a meta transaction; the document and markdown are untouched', async () => {
    const source = createWikilinkResolveSource()
    const { crepe, root } = await mount('A [[Known]] and a [[Missing]] link\n', source)
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
    const view = viewOf(crepe)
    const docBefore = view.state.doc
    const mdBefore = getMarkdownForSave(crepe)

    source.update((target) => (target === 'Known' ? '/vault/Known.md' : null))
    expect(Array.from(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).map((el) => el.textContent)).toEqual(['Missing'])
    expect(view.state.doc).toBe(docBefore)
    expect(getMarkdownForSave(crepe)).toBe(mdBefore)

    // the file appears (index update): the dimming clears live
    source.update(() => '/vault/anything.md')
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
    expect(view.state.doc).toBe(docBefore)
  })

  it('a destroyed editor unsubscribes from the source', async () => {
    const source = createWikilinkResolveSource()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: 'A [[x]] link\n', wikilinks: source })
    await crepe.create()
    await crepe.destroy()
    root.remove()
    expect(() => source.update(() => null)).not.toThrow()
  })
})
