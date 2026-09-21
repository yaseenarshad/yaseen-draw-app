/**
 * Where the 6-dot block handle points. The handle floats in the gutter left of the block, so
 * the block it belongs to is found by probing just right of the handle at the pointer's y.
 */
import type { EditorView } from '@milkdown/kit/prose/view'
import { cssZoom } from '../lib/cssZoom'

/** How far right of the handle to probe for the block it points at (the gutter is ~24px). */
export const PROBE_OFFSET_PX = 24

/** Element, not HTMLElement: the pointer usually lands on the icon's <svg>/<path>. */
export const isDragHandleGrab = (t: EventTarget | null): t is Element =>
  t instanceof Element && t.closest('.milkdown-block-handle .operation-item') !== null

/** A grab on THIS editor's own handle (tabs keep hidden editors mounted, each with its own handle). */
export const isOwnHandleGrab = (view: EditorView, t: EventTarget | null): t is Element =>
  isDragHandleGrab(t) && (view.dom.parentElement?.contains(t) ?? false)

export interface HandleTarget {
  pos: number
  inside: number
}

/**
 * Where the handle points: probe PROBE_OFFSET_PX right of the handle at the pointer's y. Null
 * when the probe misses. `pos` lands on the block's start boundary, so consumers that need the
 * enclosing node (e.g. a list_item) must use `inside`.
 */
export function handleTargetPos(view: EditorView, e: MouseEvent): HandleTarget | null {
  const handle = (e.target as Element).closest('.milkdown-block-handle')!
  const rect = handle.getBoundingClientRect()
  // The handle floats beside the zoomed content at 100% (D14), so the probe scales with the content.
  const probe = view.posAtCoords({ left: rect.right + PROBE_OFFSET_PX * cssZoom(view.dom), top: e.clientY })
  return probe === null ? null : { pos: probe.pos, inside: probe.inside }
}
