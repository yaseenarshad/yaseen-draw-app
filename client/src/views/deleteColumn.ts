/**
 * Delete a column (YAZ-1513, Notion semantics, confirm-first): ONE function behind both doorways —
 * the table header's right-click and the Properties menu's detail panel. It removes
 *
 *  (a) the declaration `folder_page_settings.columns.<key>` on THIS folder page,
 *  (b) every reference the page's views hold to the key — `order`, `sort`, `groupBy`,
 *      `summaries`, `columnSize`, `cardStyle`, a cards `image`, and every filter leaf that names
 *      it — and its label under `properties`, so nothing dangles (a `frozenColumns` prefix follows
 *      the shortened order through the one order writer, `withOrder`),
 *  (c) the key from the frontmatter of every DIRECT member that carries it.
 *
 * (a)+(b) are ONE settings write through the host's door — never a bypass of the folder page
 * host's echo guard (YAZ-1234/1241) — and they land FIRST and are AWAITED: settings are the source
 * of truth, and if that write is refused nothing else moves (YAZ-1549). (c) is per note, against
 * fresh file bytes, byte-preserving every other key; a note whose record shows the key but whose
 * disk no longer does is simply not written. Strip failures are aggregated the way
 * `folderPageColumns.ts` aggregates its own — one error for the banner, successes committed, no
 * rollback; the next open is the retry.
 *
 * ACCEPTED (by ruling): a member that ALSO belongs to another folder page declaring the same key
 * gets it re-added by THAT page's presence invariant when it is next opened. The declaration is
 * per page; the value follows whichever declaration is live.
 *
 * Built-in columns are never deletable — `file.*`, `formula.*` and the app-owned keys — only
 * hidden. `undeletableReason` is the one rule both menus disable their item by.
 */
import { setFrontmatterProperty } from '@shared/frontmatter'
import type { IndexRecord } from '@shared/types'
import { APP_OWNED_KEYS } from '../links/reservedKeys'
import type { ColumnDecl } from './folderPageSettings'
import { withOrder } from './view/columnOrder'
import { canonicalKey } from './view/keys'
import { groupByLevels, type FilterNode, type ViewDef, type ViewSet } from './viewSchema'
import { transformFile } from './writeProperty'

const bareOf = (key: string): string => canonicalKey(key).slice('note.'.length)

/** The tooltip a disabled "Delete column…" wears, or null when the key may go. */
export function undeletableReason(key: string): string | null {
  const c = canonicalKey(key)
  return !c.startsWith('note.') || APP_OWNED_KEYS.has(c.slice('note.'.length)) ? 'Built-in column — hide it instead' : null
}

/** The direct members whose card currently carries the key — the confirm sheet's count, the strip's list. */
export function membersCarrying(members: readonly IndexRecord[], key: string): IndexRecord[] {
  const bare = bareOf(key)
  return members.filter((member) => Object.prototype.hasOwnProperty.call(member.properties, bare))
}

/** Every `"…"` / `'…'` literal blanked (escapes honoured), so a key spelled INSIDE a string is not a reference. */
const withoutStringLiterals = (expr: string): string => expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')

/**
 * Does a filter expression name the column? The identifier `note.<key>` or the bare `<key>` as a
 * whole token, outside string literals — a tokenizer-free check: literals go first, then a
 * word-boundary match (YAZ-1549).
 */
export function filterMentions(expr: string, key: string): boolean {
  const bare = bareOf(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\w.])(note\\.)?${bare}(?![\\w])`).test(withoutStringLiterals(expr))
}

/**
 * The filter minus every leaf that names the key: an emptied `and` / `or` / `not` node goes with
 * its last leaf, and `undefined` means the whole filter went. The same node comes back when
 * nothing under it changed.
 */
export function pruneFilter(node: FilterNode, key: string): FilterNode | undefined {
  if (typeof node === 'string') return filterMentions(node, key) ? undefined : node
  const [op, children] = Object.entries(node)[0] as ['and' | 'or' | 'not', FilterNode[]]
  const kept = children.map((child) => pruneFilter(child, key)).filter((child): child is FilterNode => child !== undefined)
  if (kept.length === 0) return undefined
  if (kept.length === children.length && kept.every((child, i) => child === children[i])) return node
  return { [op]: kept } as FilterNode
}

/** Every view minus every reference to the key; untouched views come back as the same object. */
export function pruneColumnFromViews(views: readonly ViewDef[], key: string): ViewDef[] {
  const c = canonicalKey(key)
  const names = (k: unknown): boolean => typeof k === 'string' && canonicalKey(k) === c
  return views.map((view) => {
    let changed = false
    let next: ViewDef = { ...view }
    if (Array.isArray(view.order)) {
      const order = view.order.filter((k) => !names(k))
      if (order.length !== view.order.length) {
        changed = true
        next = withOrder(next, order)
      }
    }
    if (Array.isArray(view.sort)) {
      const sort = view.sort.filter((s) => !names(s.property))
      if (sort.length !== view.sort.length) {
        changed = true
        if (sort.length === 0) delete next.sort
        else next.sort = sort
      }
    }
    if (view.groupBy !== undefined) {
      const levels = groupByLevels(view)
      const kept = levels.filter((g) => !names(g.property))
      if (kept.length !== levels.length) {
        changed = true
        if (kept.length === 0) delete next.groupBy
        else next.groupBy = Array.isArray(view.groupBy) ? kept : kept[0]
      }
    }
    if (names(view.image)) {
      changed = true
      delete next.image
    }
    if (view.filters !== undefined) {
      const filters = pruneFilter(view.filters, key)
      if (filters !== view.filters) {
        changed = true
        if (filters === undefined) delete next.filters
        else next.filters = filters
      }
    }
    for (const map of ['summaries', 'columnSize', 'cardStyle'] as const) {
      const entries = view[map]
      if (entries === undefined || entries === null || typeof entries !== 'object') continue
      const keptEntries = Object.fromEntries(Object.entries(entries).filter(([k]) => !names(k)))
      if (Object.keys(keptEntries).length === Object.keys(entries).length) continue
      changed = true
      if (Object.keys(keptEntries).length === 0) delete next[map]
      else (next as Record<string, unknown>)[map] = keptEntries
    }
    return changed ? next : view
  })
}

/** The labels minus the key's entry (any spelling); undefined once none are left, so the key deletes itself. */
export function pruneColumnLabel(properties: ViewSet['properties'], key: string): ViewSet['properties'] {
  if (properties === undefined) return undefined
  const c = canonicalKey(key)
  const kept = Object.fromEntries(Object.entries(properties).filter(([k]) => canonicalKey(k) !== c))
  return Object.keys(kept).length === 0 ? undefined : kept
}

export interface DeleteColumnHost {
  /** The folder page's declarations as the host holds them — its AHEAD copy (YAZ-1549), never a stale snapshot. */
  columns: Readonly<Record<string, ColumnDecl>>
  /** The LIVE def (views + labels) — the host's `parsed.def`, never the index snapshot (YAZ-1234). */
  def: ViewSet
  /** The DIRECT members — the same set the presence invariant walks (YAZ-999). */
  members: readonly IndexRecord[]
  /** The host's one settings door: declarations, views and labels in ONE write. Resolves when it landed; rejects when it did not. */
  writeSettings: (columns: Record<string, ColumnDecl>, views: ViewDef[], properties: ViewSet['properties']) => Promise<void>
}

/**
 * Delete `key` everywhere on this page (see the module doc). The settings write is awaited and a
 * refusal ABORTS — no member is touched; the host has already surfaced that error. Rejects with
 * the aggregated member failures otherwise.
 */
export async function deleteColumn(key: string, host: DeleteColumnHost): Promise<void> {
  const reason = undeletableReason(key)
  if (reason !== null) throw new Error(`Can't delete ${canonicalKey(key)}: ${reason.toLowerCase()}`)
  const bare = bareOf(key)

  const columns: Record<string, ColumnDecl> = { ...host.columns }
  delete columns[bare]
  await host.writeSettings(columns, pruneColumnFromViews(host.def.views, key), pruneColumnLabel(host.def.properties, key))

  const carrying = membersCarrying(host.members, key)
  const results = await Promise.allSettled(
    carrying.map((member) => transformFile(member.path, (content) => setFrontmatterProperty(content, bare, undefined))),
  )
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ member: carrying[index]!, why: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [],
  )
  if (failed.length === 0) return
  throw new Error(
    `Could not remove "${bare}" from ${failed.length} ${failed.length === 1 ? 'note' : 'notes'}: ${failed.map(({ member, why }) => `${member.basename} (${why})`).join('; ')}`,
  )
}
