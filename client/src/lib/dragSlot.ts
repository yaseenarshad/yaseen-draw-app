import type { DragEvent } from 'react'

/**
 * The insertion-slot arithmetic BOTH horizontal tab strips reorder by — the window's tab bar
 * (GRO-2235) and a folder page's view tabs (YAZ-1471). One spelling, so the two strips cannot
 * drift apart: a slot is an index in the WITH-dragged-item list and runs 0…length.
 */

/** The slot a pointer at `clientX` over the item at `i` means: BEFORE it (`i`) or AFTER it (`i + 1`), by the target's own horizontal midpoint. */
export function insertionSlot(e: DragEvent, i: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientX < r.left + r.width / 2 ? i : i + 1
}

/** The FINAL index the item grabbed at `from` lands on when dropped at `slot` — past the grab point the slot shifts one left, because the dragged item leaves the list before it re-enters it. */
export function dropIndex(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot
}
