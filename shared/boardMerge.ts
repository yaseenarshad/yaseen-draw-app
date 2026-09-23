import { isFiniteNumber, isRecord } from './guards'

/**
 * THE SHAPE-BY-SHAPE BOARD MERGE (🔒 YAZ-1897 D1). When two machines both changed one `.excalidraw`
 * since they last agreed, sync hands this function the three versions git holds — the common
 * ancestor, the remote's, and ours — and gets back one board with everyone's work in it.
 *
 * Git's own line merge knows nothing about shapes (two people each ADDING a shape is a conflict to
 * it), so boards never reach it (D2); this is the only board merge there is. Per shape id:
 *  - changed on ONE side → that side, a delete included (a saved board keeps deleted shapes as
 *    `isDeleted: true` tombstones, and a shape missing from a side counts as deleted there);
 *  - changed on BOTH → an edit beats a delete (never lose work); otherwise the newest `updated`
 *    wins, then the higher `version`, then the lower `versionNonce` — Excalidraw's own tie rule — and
 *    a clash between two live edits is counted for the "kept the newest" notice;
 *  - a clashing shape keeps the union of both sides' `boundElements` (arrows and text bound to it),
 *    because load does not repair bindings and an arrow drawn on one machine would otherwise lose
 *    its anchor to the other machine's move.
 * The board's own settings (`appState`) merge per key the same way, ours winning a clash.
 *
 * Pure and engine-free: it runs in the main process in the middle of a rebase. Answers null for
 * anything it must not merge — a side that is not a scene — and the caller keeps both copies.
 */

export interface BoardMerge {
  /** The merged board, written the way the app writes one: 2-space JSON and a trailing newline. */
  json: string
  /** Shapes BOTH sides edited (a delete is not an edit); the newest version of each was kept. */
  clashes: number
}

type Element = Record<string, unknown> & { id: string }
type Scene = Record<string, unknown> & { elements: Element[] }

function parseScene(text: string): Scene | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isRecord(raw) || !Array.isArray(raw.elements)) return null
  if (!raw.elements.every((e) => isRecord(e) && typeof e.id === 'string')) return null
  return raw as Scene
}

/** Structural equality for values that came out of `JSON.parse` — the app's writer keeps key order stable. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

const alive = (e: Element | undefined): e is Element => e !== undefined && e.isDeleted !== true

const num = (v: unknown): number => (isFiniteNumber(v) ? v : 0)

/** Which of two edits of one shape is the newer: `updated`, then `version`, then the LOWER `versionNonce`; ours on a full tie. */
function newer(theirs: Element, mine: Element): Element {
  const byUpdated = num(theirs.updated) - num(mine.updated)
  if (byUpdated !== 0) return byUpdated > 0 ? theirs : mine
  const byVersion = num(theirs.version) - num(mine.version)
  if (byVersion !== 0) return byVersion > 0 ? theirs : mine
  return num(theirs.versionNonce) < num(mine.versionNonce) ? theirs : mine
}

const byId = (elements: readonly Element[]): Map<string, Element> => new Map(elements.map((e) => [e.id, e]))

/** Every id in first-seen order across the sides — theirs first, so a board's order follows the remote when `index` cannot decide. */
function idsInOrder(...sides: readonly Element[][]): string[] {
  const ids = new Set<string>()
  for (const side of sides) for (const e of side) ids.add(e.id)
  return [...ids]
}

/** `{ id, type }[]` bindings from both versions of a shape, first occurrence of each id kept. */
function unionBindings(a: unknown, b: unknown): Record<string, unknown>[] {
  const out = new Map<string, Record<string, unknown>>()
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue
    for (const binding of list) if (isRecord(binding) && typeof binding.id === 'string' && !out.has(binding.id)) out.set(binding.id, binding)
  }
  return [...out.values()]
}

/** Per-key 3-way merge of two plain objects against their ancestor; ours wins a key both changed. */
function mergeRecord(base: Record<string, unknown>, theirs: Record<string, unknown>, mine: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const pick = same(mine[key], base[key]) ? theirs[key] : mine[key]
    if (pick !== undefined) out[key] = pick
  }
  return out
}

const recordOf = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})

export function mergeBoards(baseText: string, theirsText: string, mineText: string): BoardMerge | null {
  const base = parseScene(baseText)
  const theirs = parseScene(theirsText)
  const mine = parseScene(mineText)
  if (base === null || theirs === null || mine === null) return null

  const b = byId(base.elements)
  const t = byId(theirs.elements)
  const m = byId(mine.elements)
  const merged = new Map<string, Element>()
  const clashed = new Set<string>()

  for (const id of idsInOrder(theirs.elements, mine.elements)) {
    const was = b.get(id)
    const tv = t.get(id)
    const mv = m.get(id)
    let pick: Element | undefined
    if (same(tv, was)) pick = mv
    else if (same(mv, was) || same(tv, mv)) pick = tv
    else if (alive(tv) !== alive(mv)) pick = alive(tv) ? tv : mv // an edit beats a delete
    else if (tv === undefined || mv === undefined) pick = tv ?? mv // gone on one side, a tombstone on the other
    else {
      pick = newer(tv, mv)
      if (alive(tv)) clashed.add(id)
    }
    if (pick !== undefined) merged.set(id, pick)
  }

  // A clashing shape keeps every binding either side gave it, as long as the bound element survived.
  for (const id of clashed) {
    const pick = merged.get(id) as Element
    const bindings = unionBindings(t.get(id)?.boundElements, m.get(id)?.boundElements).filter((x) => alive(merged.get(x.id as string)))
    merged.set(id, { ...pick, boundElements: bindings.length > 0 ? bindings : null })
  }

  // Excalidraw orders a scene by fractional `index`; a board written before indices existed keeps the sequence above.
  let elements = [...merged.values()]
  if (elements.every((e) => typeof e.index === 'string')) {
    elements = elements.sort((x, y) => (x.index === y.index ? (x.id < y.id ? -1 : 1) : (x.index as string) < (y.index as string) ? -1 : 1))
  }

  const doc: Record<string, unknown> = { ...mine, elements }
  if ('appState' in mine || 'appState' in theirs) doc.appState = mergeRecord(recordOf(base.appState), recordOf(theirs.appState), recordOf(mine.appState))
  if ('files' in mine || 'files' in theirs) doc.files = { ...recordOf(theirs.files), ...recordOf(mine.files) }
  return { json: `${JSON.stringify(doc, null, 2)}\n`, clashes: clashed.size }
}
