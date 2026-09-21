/**
 * BELONGING AUTO-SYNC (🔒 E1, YAZ-902): what changed between two outline documents,
 * belonging-wise — and, when asked, the writes that make it true. The LOGIC layer only; the view
 * that calls it, debounce and confirm sheet included, is YAZ-903.
 *
 * THE RULE is one rule, the click rule, and no second rule: a LINE that is exactly one resolving
 * wikilink (`outlineDoc.ts` `lineTarget` → `entryTarget`) means that page is a member of this
 * folder page. Prose, a link inside prose, a bare name and a dangling link are text and mean
 * nothing — the outline is free-form and unsaid is not unmeant. Two lines naming ONE page (however
 * they spell it — alias, case, `#heading`) are ONE belonging.
 *
 * BELONGING STAYS CHILD-DECLARED (YAZ-825): every write here lands on the MEMBER's own
 * `folder_pages`, one key on one page through the shared `writeProperty` — never on the folder
 * page, never in the outline document itself.
 *
 * THE DIFF IS BETWEEN THE LAST-WRITTEN OUTLINE AND THE NEW ONE, and THE CALLER HOLDS `prev`.
 * Nothing here reads disk or the index for a previous document: a caller that compares against the
 * wrong string will tag and un-tag the wrong pages, which is why `prev` is a parameter and not a
 * lookup.
 *
 * TAGGING IS IDEMPOTENT, and idempotent through the RESOLVER, never a string compare: a page whose
 * `folder_pages` already holds an entry RESOLVING to this folder page — spelled through an alias, a
 * different case, an absolute path — is already a member and is not written at all.
 *
 * UN-TAGGING NEVER FIRES FROM HERE UNASKED. This module computes `untag` and, when a caller asks
 * for it, writes it; the confirmation gate that decides whether to ask is 903's sheet. What it
 * removes is exactly what counted (`entryTarget(...) === folderPagePath`, the filter the × has used
 * since YAZ-820), so prose that merely SPELLS the folder page's name, and every other folder page
 * the member belongs to, survive untouched.
 */
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { FOLDER_PAGES_KEY, entryTarget, folderPagesList } from '../links/folderPages'
import { lineTarget, parseOutline } from './outlineDoc'
import { writeProperty } from './writeProperty'

/** The resolved paths this outline names, de-duplicated, in document order. */
export function outlineLinkTargets(markdown: string, resolve: ResolveLink): Set<string> {
  const targets = new Set<string>()
  for (const { text } of parseOutline(markdown)) {
    const target = lineTarget(text, resolve)
    if (target !== null) targets.add(target)
  }
  return targets
}

/** Members gained and lost between two outlines: resolved paths, never basenames. */
export interface BelongingDiff {
  tag: string[]
  untag: string[]
}

/** Pure: what `next` says about belonging that `prev` did not, and what it no longer says. */
export function diffOutlineBelonging(prev: string, next: string, resolve: ResolveLink): BelongingDiff {
  const before = outlineLinkTargets(prev, resolve)
  const after = outlineLinkTargets(next, resolve)
  return {
    tag: [...after].filter((path) => !before.has(path)),
    untag: [...before].filter((path) => !after.has(path)),
  }
}

/** The folder page a belonging write is about, and everything reading one takes. */
export interface FolderPageBelonging {
  /** Its path — what an existing entry must RESOLVE to to count as this belonging. */
  path: string
  /** Its basename — the text a NEW entry is written as, `[[<name>]]`, exactly as the add row writes it. */
  name: string
  /** The whole snapshot: a member's current `folder_pages` is read off its record, not re-read from disk. */
  records: readonly IndexRecord[]
  /** THE shared resolver (`views/engine.ts` `resolverFor`) — the very one the outline resolved its lines with. */
  resolve: ResolveLink
}

export type BelongingMode = 'tag' | 'untag'

/** The member's whole list after the change, or null when it already says what we want. */
function nextEntries(record: IndexRecord, folderPage: FolderPageBelonging, mode: BelongingMode): unknown[] | null {
  const entries = folderPagesList(record)
  const counts = (entry: unknown): boolean => entryTarget(entry, folderPage.resolve) === folderPage.path
  if (mode === 'tag') return entries.some(counts) ? null : [...entries, `[[${folderPage.name}]]`]
  const kept = entries.filter((entry) => !counts(entry))
  return kept.length === entries.length ? null : kept
}

/**
 * Tag or un-tag every path, one `folder_pages` write per member — the read-modify-write the ×
 * and the add row have always done, in a loop. A path with no record in the snapshot is skipped,
 * and so is one whose list already reads correctly (no disk touched). Every path is attempted;
 * a failure rejects and the caller owns the banner.
 */
export async function applyBelonging(
  paths: readonly string[],
  folderPage: FolderPageBelonging,
  mode: BelongingMode,
): Promise<void> {
  await Promise.all(
    paths.map((path) => {
      const record = folderPage.records.find((r) => r.path === path)
      const next = record === undefined ? null : nextEntries(record, folderPage, mode)
      return next === null ? undefined : writeProperty(path, FOLDER_PAGES_KEY, next)
    }),
  )
}
