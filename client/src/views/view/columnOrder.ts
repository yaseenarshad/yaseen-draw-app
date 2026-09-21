import type { ViewDef, ViewSet } from '../viewSchema'
import { frozenColumnCount } from './frozenColumns'

/**
 * THE one order writer (YAZ-1549): a view with `order` replaced, its `frozenColumns` following
 * POSITIONALLY (YAZ-1007) — the frozen prefix is a count over the shown columns, so a shorter order
 * clamps the count and an empty order deletes the key. Pure; the same object comes back when nothing
 * would change. Every place that assigns an order — the Properties checklist, reorder and bulk
 * buttons, "+ Add column", the table header's Hide / Add-to-the-right / drag, and a column delete —
 * spells it through here, so no view can hold an order its frozen prefix disagrees with.
 */
export function withOrder(view: ViewDef, order: string[]): ViewDef {
  const next: ViewDef = { ...view, order }
  if (next.frozenColumns !== undefined) {
    const count = frozenColumnCount(next.frozenColumns, order.length)
    if (count === 0) delete next.frozenColumns
    else next.frozenColumns = count
  }
  return next
}

/** `withOrder` as a `Mutate` body: the def's view at `viewIndex` takes the new order. */
export function setViewOrder(d: ViewSet, viewIndex: number, order: string[]): void {
  d.views[viewIndex] = withOrder(d.views[viewIndex], order)
}
