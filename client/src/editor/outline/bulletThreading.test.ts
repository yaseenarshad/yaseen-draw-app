/**
 * Bullet threading (GRO-2094): real editor, caret moved with TextSelection, decoration classes
 * inspected in the DOM. Threading is view-only — markdown must never change and
 * `markdownUpdated` must never fire because of it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { THREAD_NODE_CLASS, THREAD_SEG_CLASS, THREAD_STOP_CLASS } from './bulletThreading'

const OUTLINE = `Intro paragraph

* L1 a
  * L2 a
    * L3 a
    * L3 b
  * L2 b
* L1 b
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...opts })
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

function caretIn(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let pos = -1
    view.state.doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + text.length
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })
}

/** Labels (first-block text) of the list-item blocks carrying `cls`, in document order. */
const labelsWith = (root: HTMLElement, cls: string): string[] =>
  [...root.querySelectorAll<HTMLElement>(`.${cls}`)].map(
    (el) => el.querySelector(':scope > li > .children > .content-dom > p')?.textContent ?? '?',
  )

describe('bullet threading (GRO-2094)', () => {
  it('marks the root→caret path: nodes on the path, segments down to the active child, stop at it', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L3 b')
    expect(labelsWith(root, THREAD_NODE_CLASS)).toEqual(['L1 a', 'L2 a', 'L3 b'])
    // Top-level list has no guide line → no segments there. L1 a's list: L2 a is the path child
    // (index 0) → seg + stop. L2 a's list: L3 a (before) gets seg, L3 b gets seg + stop.
    expect(labelsWith(root, THREAD_SEG_CLASS)).toEqual(['L2 a', 'L3 a', 'L3 b'])
    expect(labelsWith(root, THREAD_STOP_CLASS)).toEqual(['L2 a', 'L3 b'])
  })

  it('follows the caret and clears outside lists', async () => {
    const { crepe, root } = await mount()
    caretIn(crepe, 'L2 b')
    expect(labelsWith(root, THREAD_NODE_CLASS)).toEqual(['L1 a', 'L2 b'])
    expect(labelsWith(root, THREAD_SEG_CLASS)).toEqual(['L2 a', 'L2 b'])
    expect(labelsWith(root, THREAD_STOP_CLASS)).toEqual(['L2 b'])
    caretIn(crepe, 'Intro paragraph')
    expect(labelsWith(root, THREAD_NODE_CLASS)).toEqual([])
    expect(labelsWith(root, THREAD_SEG_CLASS)).toEqual([])
  })

  it('never changes the markdown or fires markdownUpdated', async () => {
    const onMarkdownUpdated = vi.fn()
    const { crepe } = await mount(OUTLINE, { onMarkdownUpdated })
    await new Promise((r) => setTimeout(r, 300)) // Crepe's mount-time normalisation, not ours
    onMarkdownUpdated.mockClear()
    const before = getMarkdownForSave(crepe)
    caretIn(crepe, 'L3 a')
    caretIn(crepe, 'L1 b')
    await new Promise((r) => setTimeout(r, 300))
    expect(getMarkdownForSave(crepe)).toBe(before)
    expect(onMarkdownUpdated).not.toHaveBeenCalled()
  })
})
