/**
 * External edits apply as diffs, not rebuilds (YAZ-1347). Contract tests written FIRST (Fable) —
 * the implementation (YAZ-1350 diffDocs, YAZ-1351 applyExternalMarkdown, YAZ-1353 key
 * normalization) must pass these unchanged.
 *
 * The locked architecture (YAZ-1347 comments, YAZ-1348 implementation contract): a live external
 * edit is parsed and structurally diffed against the current doc, then dispatched as ONE
 * transaction (no history entry), so ProseMirror position mapping carries folds, cursor and
 * selection. Content-hash fold keys are demoted to cold-start persistence; a whole-document
 * rewrite falls back to the existing `setMarkdown` rebuild and may never behave worse than
 * v0.9.1. YAZ-1342's reworded-line boundary is deliberately RETIRED for live edits by these tests.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx, parserCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { undo } from '@milkdown/kit/prose/history'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { normalizeEmptyItems } from '../listItemRoundTrip'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from '../outline/outlineFolding'
import { getOutlineFoldKey } from '../outline/outlineFoldKeys'
import { applyExternalMarkdown } from './applyExternalMarkdown'
import { diffDocs } from './diffDocs'

const OUTLINE = `* 1) Parent
  * Child
* 2) Second
  * Kid
* 3) Leaf tail
`

/** Every item changed AND a fourth appended: nothing trims off either end (YAZ-1638). */
const RENUMBERED_PLUS_ONE = `* 2) Parent renamed
  * Child
* 3) Second
  * Kid
* 4) Leaf tail
* 5) Appended
`

/** The first item reworded AND the middle one deleted: one pair, one leftover (YAZ-1638). */
const REWORDED_MINUS_ONE = `* 1) Parent renamed
  * Child
* 3) Leaf tail
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'> = {}): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const toggleFor = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btn = [...root.querySelectorAll<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)].find((b) =>
    b.getAttribute('aria-label')?.endsWith(` ${label}`),
  )
  if (!btn) throw new Error(`no toggle for "${label}"`)
  return btn
}

const foldedCount = (root: HTMLElement): number => root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}]`).length

/** Parse exactly as the editor loads a file (`normalizeEmptyItems` keeps `1)` markers literal, YAZ-1329). */
const parse = (crepe: Crepe, markdown: string): ProseNode => {
  let doc: ProseNode | undefined
  crepe.editor.action((ctx) => {
    const parsed = ctx.get(parserCtx)(normalizeEmptyItems(markdown))
    if (parsed === null || typeof parsed === 'string') throw new Error('parse failed')
    doc = parsed
  })
  if (!doc) throw new Error('parse produced nothing')
  return doc
}

/** Caret into the first occurrence of `text`; returns the resolved doc position used. */
const placeCaretIn = (crepe: Crepe, text: string): void => {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let target = -1
    view.state.doc.descendants((node, pos) => {
      if (target === -1 && node.isText && node.text !== undefined && node.text.includes(text)) {
        target = pos + node.text.indexOf(text)
      }
      return target === -1
    })
    if (target === -1) throw new Error(`text not found: ${text}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)))
  })
}

/** The text of the textblock the selection head currently sits in. */
const caretBlockText = (crepe: Crepe): string => {
  let text = ''
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    text = view.state.selection.$head.parent.textContent
  })
  return text
}

describe('diffDocs (YAZ-1350)', () => {
  it('reproduces the new doc and does not degenerate to one whole-document replace on a renumber', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    const oldDoc = parse(crepe, OUTLINE)
    const renumbered = OUTLINE.replace('1) Parent', '2) Parent').replace('2) Second', '3) Second').replace('3) Leaf tail', '4) Leaf tail')
    const newDoc = parse(crepe, renumbered)

    const ranges = diffDocs(oldDoc, newDoc)
    expect(ranges.length).toBeGreaterThan(0)
    // Apply right-to-left; the result must equal the parsed new doc exactly.
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr
      for (const r of [...ranges].sort((a, b) => b.from - a.from)) tr.replace(r.from, r.to, r.slice)
      expect(tr.doc.eq(newDoc)).toBe(true)
    })
    // A renumber must produce targeted small replacements, never one span across the whole doc.
    const width = Math.max(...ranges.map((r) => r.to - r.from))
    expect(width).toBeLessThan(oldDoc.content.size / 2)
  })

  it.each([
    ['every item changed and one appended', RENUMBERED_PLUS_ONE],
    ['one item reworded and one deleted', REWORDED_MINUS_ONE],
  ])('reproduces the new doc in targeted ranges when the middle AND the count change — %s (YAZ-1638)', async (_shape, target) => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    const oldDoc = parse(crepe, OUTLINE)
    const newDoc = parse(crepe, target)

    const ranges = diffDocs(oldDoc, newDoc)
    // The changed items pair up one by one; the leftover sibling is its own insert or delete.
    expect(ranges.length).toBeGreaterThan(1)
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const tr = view.state.tr
      for (const r of [...ranges].sort((a, b) => b.from - a.from)) tr.replace(r.from, r.to, r.slice)
      expect(tr.doc.eq(newDoc)).toBe(true)
    })
    const width = Math.max(...ranges.map((r) => r.to - r.from))
    expect(width).toBeLessThan(oldDoc.content.size / 2)
  })

  it('returns no ranges for identical docs', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    const a = parse(crepe, OUTLINE)
    const b = parse(crepe, OUTLINE)
    expect(diffDocs(a, b)).toHaveLength(0)
  })
})

describe('applyExternalMarkdown (YAZ-1351)', () => {
  it('keeps a fold whose own line was renumbered — the trigger case', async () => {
    let reported: readonly string[] = []
    const { crepe, root } = await mount({
      defaultValue: OUTLINE,
      folding: { onCollapsedKeysChange: (keys) => (reported = keys) },
    })
    toggleFor(root, '1) Parent').click()
    expect(foldedCount(root)).toBeGreaterThan(0)

    const renumbered = OUTLINE.replace('1) Parent', '2) Parent').replace('2) Second', '3) Second').replace('3) Leaf tail', '4) Leaf tail')
    expect(applyExternalMarkdown(crepe, renumbered)).toBe('applied')

    expect(foldedCount(root)).toBeGreaterThan(0)
    expect(getMarkdownForSave(crepe)).toBe(renumbered)
    // Persisted keys stay truthful for cold start (2D): the reported set matches the live label.
    expect(reported).toContain(getOutlineFoldKey('2) Parent', 0))
  })

  it('keeps a fold whose own line was REWORDED — the YAZ-1342 boundary, retired for live edits', async () => {
    let reported: readonly string[] = []
    const { crepe, root } = await mount({
      defaultValue: OUTLINE,
      folding: { onCollapsedKeysChange: (keys) => (reported = keys) },
    })
    toggleFor(root, '1) Parent').click()
    expect(foldedCount(root)).toBe(1)

    const reworded = OUTLINE.replace('1) Parent', '1) Parent renamed completely')
    expect(applyExternalMarkdown(crepe, reworded)).toBe('applied')

    expect(foldedCount(root)).toBe(1)
    expect(reported).toContain(getOutlineFoldKey('1) Parent renamed completely', 0))
  })

  it('keeps a fold when every item changes AND one is appended — nothing to trim (YAZ-1638)', async () => {
    let reported: readonly string[] = []
    const { crepe, root } = await mount({
      defaultValue: OUTLINE,
      folding: { onCollapsedKeysChange: (keys) => (reported = keys) },
    })
    toggleFor(root, '1) Parent').click()
    expect(foldedCount(root)).toBe(1)

    expect(applyExternalMarkdown(crepe, RENUMBERED_PLUS_ONE)).toBe('applied')

    expect(foldedCount(root)).toBe(1)
    expect(getMarkdownForSave(crepe)).toBe(RENUMBERED_PLUS_ONE)
    expect(reported).toContain(getOutlineFoldKey('2) Parent renamed', 0))
  })

  it('keeps a fold on a reworded line while a sibling is deleted in the same edit (YAZ-1638)', async () => {
    let reported: readonly string[] = []
    const { crepe, root } = await mount({
      defaultValue: OUTLINE,
      folding: { onCollapsedKeysChange: (keys) => (reported = keys) },
    })
    toggleFor(root, '1) Parent').click()
    expect(foldedCount(root)).toBe(1)

    expect(applyExternalMarkdown(crepe, REWORDED_MINUS_ONE)).toBe('applied')

    expect(foldedCount(root)).toBe(1)
    expect(getMarkdownForSave(crepe)).toBe(REWORDED_MINUS_ONE)
    expect(reported).toContain(getOutlineFoldKey('1) Parent renamed', 0))
  })

  it('drops only the fold of a deleted bullet', async () => {
    const { crepe, root } = await mount({ defaultValue: OUTLINE })
    toggleFor(root, '1) Parent').click()
    toggleFor(root, '2) Second').click()
    expect(foldedCount(root)).toBe(2)

    const without = `* 1) Parent
  * Child
* 3) Leaf tail
`
    expect(applyExternalMarkdown(crepe, without)).toBe('applied')
    expect(foldedCount(root)).toBe(1)
    expect(getMarkdownForSave(crepe)).toBe(without)
  })

  it('maps the caret through an edit above it', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    placeCaretIn(crepe, 'Leaf tail')
    const edited = OUTLINE.replace('1) Parent', '1) Parent with a much longer label than before')
    expect(applyExternalMarkdown(crepe, edited)).toBe('applied')
    expect(caretBlockText(crepe)).toContain('Leaf tail')
  })

  it('adds no history entry: undo reverts the user edit, not the external one', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    // User edit first (goes into history).
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      let target = -1
      view.state.doc.descendants((node, pos) => {
        if (target === -1 && node.isText && node.text?.includes('Child')) target = pos + (node.text?.indexOf('Child') ?? 0)
        return target === -1
      })
      view.dispatch(view.state.tr.insertText('USER-', target))
    })
    expect(getMarkdownForSave(crepe)).toContain('USER-Child')

    const external = OUTLINE.replace('* 3) Leaf tail', '* 3) Leaf tail EXTERNAL').replace('* 1) Parent\n  * Child', '* 1) Parent\n  * USER-Child')
    expect(applyExternalMarkdown(crepe, external)).toBe('applied')
    expect(getMarkdownForSave(crepe)).toContain('EXTERNAL')

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      undo(view.state, view.dispatch)
    })
    const md = getMarkdownForSave(crepe)
    expect(md).not.toContain('USER-Child') // the user's own edit was undone…
    expect(md).toContain('EXTERNAL') // …the external change stayed.
  })

  it('falls back to a rebuild on a whole-document rewrite and still lands the exact content', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    const rewrite = `# Entirely different

A paragraph that shares nothing with the outline.

Another paragraph.
`
    expect(applyExternalMarkdown(crepe, rewrite)).toBe('rebuilt')
    expect(getMarkdownForSave(crepe)).toBe(rewrite)
  })

  it('serialises back to exactly the external body (autosave stays clean)', async () => {
    const { crepe } = await mount({ defaultValue: OUTLINE })
    const edited = OUTLINE.replace('Kid', 'Kid but edited elsewhere')
    expect(applyExternalMarkdown(crepe, edited)).toBe('applied')
    expect(getMarkdownForSave(crepe)).toBe(edited)
  })
})

describe('cold-start key normalization (YAZ-1353)', () => {
  it('ignores enumeration prefixes so a renumber-while-closed keeps folds on cold start', () => {
    expect(getOutlineFoldKey('12) foo', 0)).toBe(getOutlineFoldKey('15) foo', 0))
    expect(getOutlineFoldKey('3. foo', 0)).toBe(getOutlineFoldKey('foo', 0))
    expect(getOutlineFoldKey('X) foo', 0)).toBe(getOutlineFoldKey('foo', 0))
  })

  it('still distinguishes different labels and occurrences', () => {
    expect(getOutlineFoldKey('1) foo', 0)).not.toBe(getOutlineFoldKey('1) bar', 0))
    expect(getOutlineFoldKey('foo', 0)).not.toBe(getOutlineFoldKey('foo', 1))
  })
})
