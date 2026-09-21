/**
 * Folder pages (YAZ-825): who belongs to a folder page, and which folder pages a note belongs to
 * — computed CLIENT-SIDE in ONE pass over the index snapshot this window already holds, through
 * THE shared resolver (`views/engine.ts` `resolverFor`), exactly as backlinks are. No map in the
 * main process, no new IPC, no new index field: the whole model lives in frontmatter. A note
 * names its parents in a `folder_pages` list; a folder page declares itself with
 * `folder_page: true`.
 *
 * THE CLICK RULE (locked): an entry counts only when it is a string that is EXACTLY a wikilink
 * after trim — the indexer's own frontmatter-link rule (`EXACT_WIKILINK_RE`, `vaultIndex/scan.ts`),
 * so only what the index already counted as a link can count here — AND it resolves
 * (case-insensitively, alias-aware, through the resolver handed in) — AND the page it resolves
 * to carries the flag. THE FLAG RULE (locked): `folder_page` is the boolean `true` and nothing
 * else; `"true"`, `1` and truthy objects are not it. An entry failing any leg counts as NOTHING
 * and is ignored quietly — prose, bare names, non-strings, dangling links and links to ordinary
 * pages all just leave the note unparented. Two entries resolving to one page count ONCE.
 *
 * `uncategorized()` is every record with zero counting entries — folder pages and Home included.
 * The lookup has NO carve-outs; a surface that wants one subtracts it itself.
 */
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'

/**
 * The note's parents, and the flag that makes a page a folder page. `FOLDER_PAGES_KEY` is
 * exported because the scaffold writes the very key this lookup reads back (`views/scaffold.ts`
 * `newPageFromFolderPage`): ONE source of truth, never a second local const (YAZ-836).
 */
export const FOLDER_PAGES_KEY = 'folder_pages'
/**
 * The flag key itself, exported for the SAME reason (YAZ-840): the sidebar's turn-into /
 * turn-back item writes the very key `isFolderPage` reads back, both directions through
 * `writeProperty` — ONE source of truth, never a second local `'folder_page'` literal.
 */
export const FOLDER_PAGE_KEY = 'folder_page'

/** Exactly a wikilink, nothing around it — the index's frontmatter-link rule (`scan.ts`). */
const EXACT_WIKILINK_RE = /^\[\[[^[\]]*\]\]$/

/** Strictly the boolean: `"true"`, `1` and truthy objects do NOT declare a folder page. */
export function isFolderPage(record: IndexRecord): boolean {
  return record.properties[FOLDER_PAGE_KEY] === true
}

export interface FolderPagesLookup {
  /** The notes belonging to this folder page, path-sorted; any other path holds nobody. */
  pagesIn(folderPagePath: string): IndexRecord[]
  /** The folder pages this note belongs to, as resolved paths, in entry order. */
  folderPagesOf(pagePath: string): string[]
  /** Every record with no counting entry — folder pages included (no carve-outs here). */
  uncategorized(): IndexRecord[]
  isFolderPage(record: IndexRecord): boolean
}

/**
 * One note's `folder_pages` as a REWRITABLE list (YAZ-820). Scalar-or-list is the indexer's own
 * tolerance (`extractLinks`, scan.ts): a bare `folder_pages: "[[X]]"` is one entry, not nothing.
 * Entries come back VERBATIM — nothing is dropped or normalised — because the tag / un-tag
 * gestures read this, edit one element and write the whole list back, and an entry this module
 * does not count for anybody is still the user's text and must survive untouched.
 */
export function folderPagesList(record: IndexRecord): unknown[] {
  const raw = record.properties[FOLDER_PAGES_KEY]
  if (Array.isArray(raw)) return [...raw]
  // A mapping (or a missing key) declares nothing, and rewriting it as a list would be an edit
  // nobody asked for — an absent/mapping value simply starts from empty.
  return raw === undefined || raw === null || typeof raw === 'object' ? [] : [raw]
}

/**
 * THE CLICK RULE for ONE entry, minus the flag test: the path this entry counts for, or null.
 * Exported so the outline's un-tag can find exactly the entries `parentsOf` counted (YAZ-820) —
 * a prose entry that merely SPELLS the folder page's name never resolves here, so removing a
 * belonging can never eat a line the lookup was ignoring anyway.
 */
export function entryTarget(entry: unknown, resolve: ResolveLink): string | null {
  if (!isExactWikilink(entry)) return null
  // The raw link goes to the resolver brackets and all — it strips them (`stripBrackets`),
  // along with any `|alias` / `#heading`, exactly as a click on that link would.
  return resolve(entry.trim())
}

/**
 * THE CLICK RULE's SPELLING leg alone, for a caller with no resolver to ask (YAZ-900): the
 * outline's rename rewrite decides which LINES are links long before anything resolves them.
 */
export function isExactWikilink(entry: unknown): entry is string {
  return typeof entry === 'string' && EXACT_WIKILINK_RE.test(entry.trim())
}

/** The folder pages one record's `folder_pages` counts for: the click rule, de-duplicated. */
function parentsOf(record: IndexRecord, flagged: ReadonlySet<string>, resolve: ResolveLink): string[] {
  const out: string[] = []
  for (const entry of folderPagesList(record)) {
    const target = entryTarget(entry, resolve)
    if (target === null || !flagged.has(target) || out.includes(target)) continue
    out.push(target)
  }
  return out
}

const byPath = (a: IndexRecord, b: IndexRecord): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * ONE pass builds both directions and the uncategorized set. The flags are collected first: a
 * note may name a folder page defined anywhere in the snapshot, including after itself.
 */
function build(records: readonly IndexRecord[], resolve: ResolveLink): FolderPagesLookup {
  const flagged = new Set<string>()
  for (const record of records) if (isFolderPage(record)) flagged.add(record.path)
  const members = new Map<string, IndexRecord[]>()
  const belongsTo = new Map<string, string[]>()
  const orphans: IndexRecord[] = []
  for (const record of records) {
    const parents = parentsOf(record, flagged, resolve)
    if (parents.length === 0) {
      orphans.push(record)
      continue
    }
    belongsTo.set(record.path, parents)
    for (const parent of parents) {
      const held = members.get(parent)
      if (held === undefined) members.set(parent, [record])
      else held.push(record)
    }
  }
  for (const held of members.values()) held.sort(byPath)
  return {
    pagesIn: (folderPagePath) => members.get(folderPagePath) ?? [],
    folderPagesOf: (pagePath) => belongsTo.get(pagePath) ?? [],
    uncategorized: () => orphans,
    isFolderPage,
  }
}

/**
 * One lookup per snapshot — `backlinksFor`'s WeakMap idiom. A refetched index is a NEW array and
 * rebuilds (that IS the live update), and dropped snapshots are collectable. The resolver is
 * derived from the SAME snapshot (memoized per its identity too), so records identity is the
 * whole key.
 */
const lookupCache = new WeakMap<readonly IndexRecord[], FolderPagesLookup>()

/** The folder-page lookup over this snapshot: both directions, built once, answered from memory. */
export function folderPagesLookup(records: readonly IndexRecord[], resolve: ResolveLink): FolderPagesLookup {
  let hit = lookupCache.get(records)
  if (hit === undefined) lookupCache.set(records, (hit = build(records, resolve)))
  return hit
}

/**
 * Picker candidates for a belongs-to column (🔒 Q2, YAZ-815): the pages in the folder page
 * `target` names — resolved like a click — falling back to ALL basenames when the target is
 * unresolved or holds nobody. Report-don't-block, the picker narrows when it can and never goes
 * empty. THE successor to the type-keyed picker helper YAZ-836 deleted with `views/relation.ts`:
 * the table / list / cards views call this instead. Mid-wave their stored targets still spell old
 * type names, so those columns fall back to all pages until 5.1 re-points them at folder pages.
 */
export function belongsToBasenames(records: readonly IndexRecord[], resolve: ResolveLink, target: string): string[] {
  const home = resolve(target)
  const matches = home === null ? [] : folderPagesLookup(records, resolve).pagesIn(home).map((r) => r.basename)
  return matches.length > 0 ? matches : records.map((r) => r.basename)
}

/**
 * THE GUARDED STEP (⚡ D6 amendment, YAZ-814, ruled 2026-08-25): the members of `parent`,
 * excluding anyone already standing on the ancestor path. Folder pages hold folder pages and
 * belonging is plain text a note writes about itself, so `A → B → A` is one keystroke away and
 * would hang any surface walking it. THE LAW: during a descent, children come ONLY from here —
 * never raw `pagesIn` — so forgetting the loop protection is structurally impossible instead of
 * merely forbidden. Path-scoped, deliberately NOT a global visited set: a page reachable down two
 * branches belongs under both; the only banned thing is a page inside itself. No cap, no throw —
 * a looping branch just ends quietly.
 */
export function guardedChildren(
  lookup: FolderPagesLookup,
  parent: string,
  ancestors: readonly string[],
): IndexRecord[] {
  return lookup.pagesIn(parent).filter((member) => !ancestors.includes(member.path))
}

// TOMBSTONE (⚡ YAZ-814, ruled by Yasin): `walkFolderPage(lookup, start, visit)` stood here — a
// canonical LINEAR depth-first walk over a folder page's contents, itself built on
// `guardedChildren`. Every real surface is expansion-driven and recurses over `guardedChildren`
// ITSELF, with its own ordering and its own expansion, so the walker had no production caller and
// only ever restated the guard a second time. `guardedChildren` IS the whole law.
