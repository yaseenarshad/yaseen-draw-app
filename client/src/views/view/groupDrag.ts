import { type DragEvent as ReactDragEvent, useEffect, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { type ViewDef, groupByLevels } from '../viewSchema'
import type { Group } from '../engine'
import type { Value } from '../expr'
import { canonicalKey } from './keys'
import { groupKeyOf, nestedGroupKeyOf } from './GroupHeader'

/**
 * Drag between groups (5C, GRO-2143): shared by the board's columns and the grouped table's
 * sections. The views own the transient HTML5 drag state through `useGroupDrag`; ViewsPane owns
 * the optimistic moves (`PendingMove`, applied to the records BEFORE the engine runs, so the
 * card lands in its target group with sort/summaries/values all consistent) and commits them
 * through 5A's `writeProperty`.
 */

/**
 * A drop between FANNED-OUT groups (YAZ-671 D3): the row belongs to several groups, so the drop
 * describes an edit rather than a value — drop the element it was dragged out of, add the one it
 * was dropped into, leave every other value on the page alone. Either side is null at the
 * "No value" group: dragging out of it adds only, dropping onto it removes only.
 */
export interface GroupSwap {
  remove: Value | null
  add: Value | null
}

/** One property write inside a pending move. */
export interface PendingWrite {
  /** Bare frontmatter key being written. */
  key: string
  /** The raw YAML value written; undefined = the key was deleted ("No value" drop). */
  value: unknown
  /** The note's raw value when the move was committed; the entry clears when the index moves off it. */
  prevRaw: unknown
}

/**
 * One committed-but-not-yet-indexed move, keyed by note path in ViewsPane's state. A cross-outer
 * inner drop (🔒 YAZ-745) carries BOTH writes, inner first: they apply, clear and — on either one
 * failing — drop as a single unit, so the row is never left half-moved.
 */
export type PendingMove = PendingWrite[]

/**
 * The bare frontmatter key `groupBy` names at `level`, or null when THAT level is not a note
 * property — what a drop there writes, and what its group "+" seeds. Null disables the level's
 * own drag and "+" (YAZ-1101) while the other level keeps working.
 */
export function groupByKey(view: ViewDef, level = 0): string | null {
  const property = groupByLevels(view)[level]?.property
  if (typeof property !== 'string') return null
  const c = canonicalKey(property)
  return c.startsWith('note.') ? c.slice(5) : null
}

/** `records` with the pending moves patched in, for the engine (same clearing discipline as 5B). */
export function applyMoves(records: readonly IndexRecord[], moves: Record<string, PendingMove>): IndexRecord[] {
  return records.map((r) => {
    const mv = moves[r.path]
    if (mv === undefined) return r
    const properties = { ...r.properties }
    for (const w of mv) {
      if (w.value === undefined) delete properties[w.key]
      else properties[w.key] = w.value
    }
    return { ...r, properties }
  })
}

/**
 * Where a group sits in a two-level view (YAZ-1101): its `groupBy` level and, for an inner group,
 * the outer it hangs under. Omitted = a top-level group — the only kind board / cards / list and
 * single-level tables have, so they pass nothing and behave exactly as before.
 */
export interface GroupSpot {
  level: number
  outer: Group
}

/**
 * The level-aware half of a drop (YAZ-1101): the level the row landed on — which property the move
 * writes — and, when it crossed into a DIFFERENT outer, that outer's own write, committed second so
 * the row lands where it was dropped (🔒 YAZ-745). Absent when the level's outer is unwritable.
 */
export interface GroupDrop {
  level: number
  outer?: { key: string; value: unknown }
}

export interface GroupDrag {
  /** The dragged card's path, its source group key, that group's VALUE (the element a swap removes) and its outer's key. */
  drag: { path: string; gk: string; key: Value | null; outer: string } | null
  /** Group key of the hovered drop target (never the source group), inner groups scoped by their outer. */
  over: string | null
  /** Spread on each draggable card/row, with the group it is being dragged out of and where that group sits. */
  source: (path: string, group: Group, at?: GroupSpot) => Record<string, unknown>
  /** Spread on each column/section drop target (a group's own rows included — events bubble). */
  target: (group: Group, at?: GroupSpot) => Record<string, unknown>
}

/**
 * The HTML5 drag wiring for one view. A drop onto ANOTHER group fires `onMove` one of two ways:
 * scalar grouping → `onMove(path, value)` with the target's raw YAML value read off that group's
 * first row (so the written type matches what its members already carry), or undefined for
 * "No value" (deletes the key); fanned-out grouping → `onMove(path, undefined, swap)` with a
 * `GroupSwap` naming the element to remove (the source group's value) and the one to add. Esc
 * cancels: real drags fire `dragend` on Esc, jsdom (and any missed dragend) goes through a
 * document keydown listener. `dataTransfer` is guarded — jsdom's synthetic drag events have none.
 *
 * `keys` is one write key PER `groupBy` level (YAZ-1101): a level whose key is null shows its
 * sections but takes no drops, while the other level keeps working, and every drop reports the
 * level it landed on so the caller writes THAT property.
 */
export function useGroupDrag(
  keys: readonly (string | null)[],
  onMove: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void,
): GroupDrag {
  const [drag, setDrag] = useState<{ path: string; gk: string; key: Value | null; outer: string } | null>(null)
  const [over, setOver] = useState<string | null>(null)
  /** Inner groups are identified by their outer too, so the same value under two outers is two targets. */
  const spotKey = (group: Group, at: GroupSpot) => (at.level === 0 ? groupKeyOf(group.key) : nestedGroupKeyOf(at.outer.key, group.key))

  const clear = () => {
    setDrag(null)
    setOver(null)
  }

  useEffect(() => {
    if (drag === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag])

  return {
    drag,
    over,
    // A row stays draggable while ANY level accepts drops; the target side rejects the rest.
    source: (path, group, at = { level: 0, outer: group }) =>
      !keys.some((k) => k !== null)
        ? {}
        : {
            draggable: true,
            onDragStart: (e: ReactDragEvent) => {
              e.dataTransfer?.setData('text/plain', path)
              if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
              setDrag({ path, gk: spotKey(group, at), key: group.key, outer: groupKeyOf(at.outer.key) })
            },
            onDragEnd: clear,
          },
    target: (group, at = { level: 0, outer: group }) => {
      const key = keys[at.level] ?? null
      if (key === null) return {}
      const gk = spotKey(group, at)
      return {
        onDragOver: (e: ReactDragEvent) => {
          if (drag === null || drag.gk === gk) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (over !== gk) setOver(gk)
        },
        onDragLeave: (e: ReactDragEvent) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          if (over === gk) setOver(null)
        },
        onDrop: (e: ReactDragEvent) => {
          e.preventDefault()
          const d = drag
          clear()
          if (d === null || d.gk === gk) return
          // 🔒 YAZ-745: an inner drop under a DIFFERENT outer carries the outer's write too — read
          // off that outer's first row, like the level's own value — so the row LANDS where it was
          // dropped. Same-outer inner drops and outer drops write their own level alone.
          const outerKey = at.level > 0 && d.outer !== groupKeyOf(at.outer.key) ? keys[0] ?? null : null
          const outerRaw = outerKey === null ? undefined : at.outer.rows[0]?.record.properties[outerKey] ?? (at.outer.optionValue === undefined ? undefined : at.outer.fannedOut ? [at.outer.optionValue] : at.outer.optionValue)
          const drop: GroupDrop = { level: at.level }
          if (outerKey !== null && outerRaw !== undefined) drop.outer = { key: outerKey, value: outerRaw }
          // Fanned out (D3): the row is in several groups, so swap the element it left for the
          // one it entered rather than overwriting the whole value with a neighbour's list.
          if (group.fannedOut) return onMove(d.path, undefined, { remove: d.key, add: group.key }, drop)
          if (group.key === null) onMove(d.path, undefined, undefined, drop)
          else if (group.optionValue !== undefined) onMove(d.path, group.optionValue, undefined, drop)
          else if (group.rows.length > 0) onMove(d.path, group.rows[0].record.properties[key], undefined, drop)
        },
      }
    },
  }
}
