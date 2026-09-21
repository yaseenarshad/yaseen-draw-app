/**
 * Number children (YAZ-728): flips every direct child list of a list_item, leaves grandchildren
 * and paragraph text alone, and lands in one history step. Exercised on the real editor in jsdom.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { undo } from '@milkdown/kit/prose/history'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { childListState, nearestListItem, toggleNumberedChildren } from './numberChildren'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; ctx: Ctx }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { crepe, view, ctx: crepe.editor.ctx }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** `posAtCoords().inside` for the list_item whose first paragraph reads `label`. */
function insideOf(view: EditorView, label: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
  })
  if (found === -1) throw new Error(`list_item not found: ${label}`)
  return found
}

function flip(view: EditorView, ctx: Ctx, label: string): void {
  const tr = toggleNumberedChildren(view.state, insideOf(view, label), ctx)
  expect(tr).not.toBeNull()
  view.dispatch(tr!)
}

describe('nearestListItem', () => {
  it('resolves the hovered item itself and any ancestor item of an inner block', async () => {
    const { view } = await mount('* Parent\n  * Child\n')
    const parentPos = insideOf(view, 'Parent')
    expect(nearestListItem(view.state.doc, parentPos)?.pos).toBe(parentPos)
    // inside = position before the parent's first paragraph
    expect(nearestListItem(view.state.doc, parentPos + 1)?.pos).toBe(parentPos)
    expect(nearestListItem(view.state.doc, 0)).toBeNull()
  })
})

describe('toggleNumberedChildren', () => {
  it('numbers direct children and leaves grandchildren as bullets', async () => {
    const { crepe, view, ctx } = await mount('* Fundamentals\n  * Setup\n    * deep\n  * VS Code\n')
    flip(view, ctx, 'Fundamentals')
    expect(getMarkdownForSave(crepe)).toBe('* Fundamentals\n  1. Setup\n     * deep\n  2. VS Code\n')
    expect(childListState(view.state.doc, insideOf(view, 'Fundamentals'))).toBe('ordered')
  })

  it('toggles back to the original markdown', async () => {
    const original = '* Fundamentals\n  * Setup\n    * deep\n  * VS Code\n'
    const { crepe, view, ctx } = await mount(original)
    flip(view, ctx, 'Fundamentals')
    flip(view, ctx, 'Fundamentals')
    expect(getMarkdownForSave(crepe)).toBe(original)
    expect(childListState(view.state.doc, insideOf(view, 'Fundamentals'))).toBe('bullet')
  })

  it('never strips hand-typed numbering from the text (D2)', async () => {
    // `1)` unescaped is a CommonMark list marker; `1\)` is how remark writes a typed "1) Setup".
    const { crepe, view, ctx } = await mount('* Parent\n  * 1\\) Setup\n  * 2\\) VS Code\n')
    expect(view.state.doc.textContent).toBe('Parent1) Setup2) VS Code')
    flip(view, ctx, 'Parent')
    expect(view.state.doc.textContent).toBe('Parent1) Setup2) VS Code')
    expect(getMarkdownForSave(crepe)).toBe('* Parent\n  1. 1\\) Setup\n  2. 2\\) VS Code\n')
  })

  it('returns null for leaf items, headings and root paragraphs', async () => {
    const { view, ctx } = await mount('# H\n\n* Leaf\n\nplain\n')
    const leaf = insideOf(view, 'Leaf')
    expect(childListState(view.state.doc, leaf)).toBeNull()
    expect(toggleNumberedChildren(view.state, leaf, ctx)).toBeNull()
    let heading = -1
    let paragraph = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') heading = pos
      if (node.type.name === 'paragraph' && node.textContent === 'plain') paragraph = pos
      return false
    })
    for (const inside of [heading, paragraph]) {
      expect(childListState(view.state.doc, inside)).toBeNull()
      expect(toggleNumberedChildren(view.state, inside, ctx)).toBeNull()
    }
  })

  it('leaves the parent list ordered when numbering children of a root ordered item', async () => {
    const { crepe, view, ctx } = await mount('1. Parent\n   * a\n   * b\n')
    flip(view, ctx, 'Parent')
    expect(getMarkdownForSave(crepe)).toBe('1. Parent\n   1. a\n   2. b\n')
  })

  it('is one history step', async () => {
    const { view, ctx } = await mount('* Fundamentals\n  * Setup\n    * deep\n  * VS Code\n')
    const baseline = JSON.stringify(view.state.doc.toJSON())
    flip(view, ctx, 'Fundamentals')
    expect(JSON.stringify(view.state.doc.toJSON())).not.toBe(baseline)
    undo(view.state, view.dispatch)
    expect(JSON.stringify(view.state.doc.toJSON())).toBe(baseline)
  })

  it('flips every direct child list of an item with two of them (C1)', async () => {
    const { crepe, view, ctx } = await mount('* P\n  * a\n\n  text\n\n  * b\n')
    const item = nearestListItem(view.state.doc, insideOf(view, 'P'))!
    const shape = item.node.content.content.map((n) => n.type.name)
    expect(shape).toEqual(['paragraph', 'bullet_list', 'paragraph', 'bullet_list'])
    flip(view, ctx, 'P')
    const lists = nearestListItem(view.state.doc, insideOf(view, 'P'))!.node.content.content.map((n) => n.type.name)
    expect(lists).toEqual(['paragraph', 'ordered_list', 'paragraph', 'ordered_list'])
    expect(getMarkdownForSave(crepe)).toMatch(/^\* P\n\n {2}1\. a\n\n {2}text\n\n {2}1\. b\n$/)
  })
})
