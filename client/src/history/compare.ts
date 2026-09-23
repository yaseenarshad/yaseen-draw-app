import type { ExcalidrawModule } from '../drawings/engine'

/**
 * WHAT CHANGED SINCE A VERSION, AS A PICTURE (🔒 YAZ-1897 D4). Version history never shows JSON: it
 * draws the board as it is NOW and marks what is different from the chosen version — a shape added
 * since then outlined GREEN, a shape changed since then outlined AMBER, and a shape that has been
 * removed since then drawn back in, faded, with a RED dashed outline. Pick "your version before
 * the merge" and the marks are exactly what the merge brought in.
 *
 * Pure apart from the two engine utilities it is handed, so the classification is unit-tested
 * without a canvas.
 */

type Element = Record<string, unknown> & { id: string }

export interface BoardChanges {
  added: Element[]
  removed: Element[]
  changed: Element[]
}

export type CompareEngine = Pick<ExcalidrawModule, 'restoreElements' | 'getCommonBounds'>

/** The picture's own colours (Excalidraw's palette), not the app's theme tokens: they sit ON the board. */
export const MARK = { added: '#2f9e44', changed: '#f08c00', removed: '#e03131' } as const

const OUTLINE_PAD = 8
const REMOVED_OPACITY = 30

const live = (elements: readonly unknown[]): Map<string, Element> => {
  const out = new Map<string, Element>()
  for (const e of elements) {
    if (typeof e === 'object' && e !== null && typeof (e as Element).id === 'string' && (e as Element).isDeleted !== true) out.set((e as Element).id, e as Element)
  }
  return out
}

/** Every visible shape on the board now against the chosen version. Deleted shapes (tombstones) do not count as shapes. */
export function compareBoards(then: readonly unknown[], now: readonly unknown[]): BoardChanges {
  const before = live(then)
  const after = live(now)
  const changes: BoardChanges = { added: [], removed: [], changed: [] }
  for (const [id, e] of after) {
    const was = before.get(id)
    if (was === undefined) changes.added.push(e)
    else if (JSON.stringify(was) !== JSON.stringify(e)) changes.changed.push(e)
  }
  for (const [id, e] of before) if (!after.has(id)) changes.removed.push(e)
  return changes
}

export const hasChanges = (c: BoardChanges): boolean => c.added.length + c.removed.length + c.changed.length > 0

/**
 * The elements of the "changes since" picture: the board now, the removed shapes faded back in
 * beneath it, and one outline per marked shape on top. Outlines are ordinary rectangles, completed
 * by the engine's own `restoreElements`, so the export draws them like any other shape.
 */
export function changesScene(engine: CompareEngine, now: readonly unknown[], changes: BoardChanges): unknown[] {
  const ghosts = changes.removed.map((e) => ({ ...e, opacity: REMOVED_OPACITY, strokeColor: MARK.removed }))
  const outline = (e: Element, colour: string, dashed: boolean) => {
    const [x1, y1, x2, y2] = engine.getCommonBounds([e] as never)
    return {
      id: `yaz-mark-${e.id}`,
      type: 'rectangle',
      x: x1 - OUTLINE_PAD,
      y: y1 - OUTLINE_PAD,
      width: x2 - x1 + OUTLINE_PAD * 2,
      height: y2 - y1 + OUTLINE_PAD * 2,
      strokeColor: colour,
      backgroundColor: 'transparent',
      strokeWidth: 2,
      strokeStyle: dashed ? 'dashed' : 'solid',
      roughness: 0,
      roundness: null,
    }
  }
  // Text inside a box that is already marked would draw a second outline inside the first: the box's says it.
  const marked = new Set([...changes.added, ...changes.changed, ...changes.removed].map((e) => e.id))
  const own = (e: Element) => typeof e.containerId !== 'string' || !marked.has(e.containerId)
  const marks = [...changes.added.filter(own).map((e) => outline(e, MARK.added, false)), ...changes.changed.filter(own).map((e) => outline(e, MARK.changed, false)), ...changes.removed.filter(own).map((e) => outline(e, MARK.removed, true))]
  return [...ghosts, ...(now as unknown[]), ...(engine.restoreElements(marks as never, null) as unknown[])]
}
