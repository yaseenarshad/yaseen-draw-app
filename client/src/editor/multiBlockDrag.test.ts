/**
 * Multi-block drag (GRO-2019): the pure range expansion plus the drop-cleanup
 * appendTransaction, exercised on the real editor in jsdom. The DOM event race
 * (capture mousedown/dragstart vs Crepe's handle listeners) needs layout and is
 * verified in the browser (GRO-2062).
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { dropPoint } from '@milkdown/kit/prose/transform'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { armedDragSlice, expandedBlockRange, multiBlockDragKey } from './multiBlockDrag'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  return { crepe, view }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Position of `text` in the doc plus `offset`. */
function posOf(view: EditorView, text: string, offset = 0): number {
  let pos = -1
  view.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.isText && node.text !== undefined && node.text.includes(text)) {
      pos = nodePos + node.text.indexOf(text)
    }
  })
  if (pos === -1) throw new Error(`text not found: ${text}`)
  return pos + offset
}

describe('expandedBlockRange', () => {
  it('expands a partial selection across top-level paragraphs to whole blocks', async () => {
    const { view } = await mount('alpha one\n\nbravo two\n\ncharlie three\n')
    const range = expandedBlockRange(view.state.doc, posOf(view, 'one'), posOf(view, 'two'))
    expect(range).not.toBeNull()
    const { start, end } = range!
    const first = view.state.doc.resolve(start).nodeAfter!
    expect(first.textContent).toBe('alpha one')
    expect(view.state.doc.slice(start, end).content.childCount).toBe(2)
    // charlie stays outside
    expect(end).toBeLessThanOrEqual(posOf(view, 'charlie'))
  })

  it('expands within a nested list to sibling list items, not the whole outer list', async () => {
    const { view } = await mount('* L1 a\n  * L2 a\n  * L2 b\n  * L2 c\n* L1 b\n')
    const range = expandedBlockRange(view.state.doc, posOf(view, 'L2 a', 2), posOf(view, 'L2 b', 2))
    expect(range).not.toBeNull()
    const slice = view.state.doc.slice(range!.start, range!.end)
    expect(slice.content.childCount).toBe(2)
    expect(slice.content.firstChild!.type.name).toBe('list_item')
    // L2 c and both L1 items stay outside the range
    const covered = view.state.doc.textBetween(range!.start, range!.end, ' ')
    expect(covered).toContain('L2 a')
    expect(covered).toContain('L2 b')
    expect(covered).not.toContain('L2 c')
    expect(covered).not.toContain('L1 a')
  })

  it('returns null for empty or single-block selections', async () => {
    const { view } = await mount('alpha one\n\nbravo two\n')
    expect(expandedBlockRange(view.state.doc, posOf(view, 'one'), posOf(view, 'one'))).toBeNull()
    expect(expandedBlockRange(view.state.doc, posOf(view, 'alpha'), posOf(view, 'one'))).toBeNull()
  })
})

describe('arm guard', () => {
  it('does not arm on a right-button handle grab', async () => {
    const { view } = await mount('alpha\n\nbravo\n\ncharlie\n')
    const range = expandedBlockRange(view.state.doc, posOf(view, 'alpha'), posOf(view, 'bravo'))!
    const sel = TextSelection.between(view.state.doc.resolve(range.start), view.state.doc.resolve(range.end))
    view.dispatch(view.state.tr.setSelection(sel))
    const handle = document.createElement('div')
    handle.className = 'milkdown-block-handle'
    const item = document.createElement('div')
    item.className = 'operation-item'
    handle.appendChild(item)
    view.dom.parentElement!.appendChild(handle)
    handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
    view.posAtCoords = () => ({ pos: range.start + 1, inside: range.start })
    item.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, clientY: 0 }))
    expect(multiBlockDragKey.getState(view.state) ?? null).toBeNull()
    expect(view.state.selection.from).toBe(sel.from)
    expect(view.state.selection.to).toBe(sel.to)
  })
})

describe('drop cleanup', () => {
  /** Arm the plugin over [start,end], then replay what ProseMirror's drop-move does. */
  function dragAndDrop(view: EditorView, start: number, end: number, targetText: string) {
    const sel = TextSelection.between(view.state.doc.resolve(start), view.state.doc.resolve(end))
    view.dispatch(
      view.state.tr.setSelection(sel).setMeta(multiBlockDragKey, { type: 'arm', from: sel.from, to: sel.to }),
    )
    const slice = armedDragSlice(view.state)
    const tr = view.state.tr
    tr.deleteSelection()
    // ProseMirror's drop resolves the pointer position to a valid insertion point via dropPoint.
    const pointer = tr.mapping.map(posOf(view, targetText))
    const insert = dropPoint(tr.doc, pointer, slice) ?? pointer
    tr.replaceRange(insert, insert, slice)
    tr.setMeta('uiEvent', 'drop')
    view.dispatch(tr)
  }

  it('moves whole top-level blocks without leaving an empty shell behind', async () => {
    const { crepe, view } = await mount('alpha\n\nbravo\n\ncharlie\n\ndelta\n')
    const range = expandedBlockRange(view.state.doc, posOf(view, 'alpha'), posOf(view, 'bravo'))!
    dragAndDrop(view, range.start, range.end, 'delta')
    expect(getMarkdownForSave(crepe)).toBe('charlie\n\nalpha\n\nbravo\n\ndelta\n')
  })

  it('moves sibling list items cleanly, markers and indent intact', async () => {
    const { crepe, view } = await mount('* L1 a\n  * L2 a\n  * L2 b\n  * L2 c\n* L1 b\n')
    const range = expandedBlockRange(view.state.doc, posOf(view, 'L2 a', 2), posOf(view, 'L2 b', 2))!
    dragAndDrop(view, range.start, range.end, 'L1 b')
    const md = getMarkdownForSave(crepe)
    expect(md).not.toMatch(/^\s*[*-]\s*$/m) // no empty bullets left behind
    expect(md).toContain('L2 c')
    expect(md).toContain('L2 a')
  })

  it('does nothing on a drop when not armed', async () => {
    const { crepe, view } = await mount('alpha\n\nbravo\n')
    // plain single-block-style drop replay, never armed
    const from = posOf(view, 'alpha')
    const sel = TextSelection.between(view.state.doc.resolve(from), view.state.doc.resolve(from + 5))
    view.dispatch(view.state.tr.setSelection(sel))
    const slice = view.state.selection.content()
    const tr = view.state.tr
    tr.deleteSelection()
    tr.setMeta('uiEvent', 'drop')
    view.dispatch(tr)
    expect(getMarkdownForSave(crepe)).toContain('bravo')
  })
})
