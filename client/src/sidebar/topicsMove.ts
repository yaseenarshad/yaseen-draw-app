/**
 * THE TOPICS DRAG ENGINE (YAZ-990): what a drop is ALLOWED to do and how a confirmed move is
 * persisted. No React or DOM: the view hands in the dragged row, the row under the cursor and the
 * snapshot's `folderPagesLookup`, and gets back a verdict; the drag itself (hit-testing, the drop
 * line, the cursor) is `TopicsTree`'s. The verdict carries its REASON rather than a bare boolean so
 * the surface can say why a drop is refused instead of just going dead under the pointer.
 *
 * THE TARGET RULES (🔒 D4 of the YAZ-959 scope), in this order: a target must be a FLAGGED folder
 * page — only a folder page holds members, so a plain row is no target at all; a row is never its
 * own target; the folder page a row ALREADY belongs to is refused, because that move would write
 * nothing; and a folder page can never be dropped into its own descendant, which would cut the
 * branch off the tree and hand it to itself.
 *
 * THE DESCENT IS `guardedChildren` AND NOTHING ELSE (⚡ D6, YAZ-814): the cycle test walks down
 * from the dragged row through THE guarded step only — never raw `pagesIn` — with the ancestor
 * trail accumulated per branch, so a loop the user already wrote (`A → B → A` is one keystroke
 * away) ends the descent quietly instead of hanging the drag, while a page reachable down two
 * branches is still found down either.
 *
 * THE MEMBERSHIP MOVE IS ONE WRITE ON THE MEMBER (locked): a single `folder_pages` write on the
 * MEMBER's own frontmatter — belonging stays child-declared (YAZ-825). The old parent is filtered
 * out through THE CLICK RULE (`entryTarget`, the very filter the × has used since YAZ-820) and the
 * new one appended, in one list. Deliberately NOT tag-then-untag via two `applyBelonging` calls:
 * both would compute from the SAME stale record snapshot and the second write would clobber the
 * first. Entries that count for nobody — prose, non-strings, dangling links, the row's OTHER
 * parents — survive verbatim and in place, and a list that already reads correctly is not written
 * at all. YAZ-999 then reconciles the closed target's declarations through conditional missing-key
 * writes; those never alter the membership list or existing values.
 *
 * PLUS THE SOURCE OUTLINE, when it names the member (YAZ-1364, 🔒 D4): the outline is the truth
 * about belonging — a line that is exactly a resolving wikilink IS a member, and since YAZ-1357 the
 * outline view re-asks that rule on every snapshot. A stale line would tag the page straight back,
 * so the source topic drops it (`dropOutlineLinks`) in ONE `folder_page_settings` write on its own
 * card, only when an outline actually changed. The destination is still never written: adoption
 * appends the new member there when it next opens.
 */
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { FOLDER_PAGES_KEY, entryTarget, folderPagesList, guardedChildren, type FolderPagesLookup } from '../links/folderPages'
import { backfillFolderPageColumns } from '../views/folderPageColumns'
import { folderPageSettings, writeFolderPageSettings, type ColumnDecl } from '../views/folderPageSettings'
import { dropOutlineLinks } from '../views/outlineDoc'
import { writeProperty } from '../views/writeProperty'

/** Whether this drop may happen, and — when it may not — which locked rule refused it. */
export type DropVerdict = { ok: true } | { ok: false; reason: 'not-a-folder-page' | 'self' | 'already-parent' | 'would-cycle' }

/**
 * Is `targetPath` anywhere BELOW `page`? The guarded descent (⚡ D6), depth first, with `trail`
 * carrying the ancestors of this branch. No `isFolderPage` gate is needed on the way down: only a
 * flagged page is ever a key in the members map, so an ordinary note simply holds nobody.
 */
function reachesBelow(lookup: FolderPagesLookup, page: IndexRecord, targetPath: string, trail: readonly string[]): boolean {
  for (const kid of guardedChildren(lookup, page.path, trail)) {
    if (kid.path === targetPath || reachesBelow(lookup, kid, targetPath, [...trail, kid.path])) return true
  }
  return false
}

/** The four target rules, in their locked order — the first one that refuses names the reason. */
export function canDrop(child: IndexRecord, target: IndexRecord, lookup: FolderPagesLookup): DropVerdict {
  if (!lookup.isFolderPage(target)) return { ok: false, reason: 'not-a-folder-page' }
  if (target.path === child.path) return { ok: false, reason: 'self' }
  // One of several parents is still a parent: dropping onto any of them changes nothing.
  if (lookup.folderPagesOf(child.path).includes(target.path)) return { ok: false, reason: 'already-parent' }
  return reachesBelow(lookup, child, target.path, [child.path]) ? { ok: false, reason: 'would-cycle' } : { ok: true }
}

/** Same entries, same order, nothing added — the list already says what the move wants it to say. */
function unchanged(next: readonly unknown[], before: readonly unknown[]): boolean {
  return next.length === before.length && next.every((entry, i) => Object.is(entry, before[i]))
}

/**
 * Move `child` out of `from` and into `to`: ONE `folder_pages` write on the child — or none when
 * the list already reads that way — then the source outline's line, if it had one (see above).
 * `from` is NULL for a row dragged out of Uncategorized: nothing is filtered, one entry is gained. `to.path` is what a surviving entry
 * must RESOLVE to to count as the new parent (alias, case, `#heading` — every spelling a click
 * would follow); `to.name` is the text a NEW entry is written as, `[[<name>]]`, exactly as the
 * outline's tag and the add row write it.
 */
export async function performMove(
  child: IndexRecord,
  from: IndexRecord | null,
  to: { path: string; name: string; columns: Readonly<Record<string, ColumnDecl>> },
  resolve: ResolveLink,
): Promise<void> {
  const entries = folderPagesList(child)
  const kept = from === null ? entries : entries.filter((entry) => entryTarget(entry, resolve) !== from.path)
  const next = kept.some((entry) => entryTarget(entry, resolve) === to.path) ? kept : [...kept, `[[${to.name}]]`]
  if (!unchanged(next, entries)) await writeProperty(child.path, FOLDER_PAGES_KEY, next)
  if (from !== null) {
    const settings = folderPageSettings(from)
    const views = settings.views.map((view) => {
      const outline = view.outline === undefined ? undefined : dropOutlineLinks(view.outline, child.path, resolve)
      return outline === undefined ? view : { ...view, outline }
    })
    if (views.some((view, i) => view !== settings.views[i])) await writeFolderPageSettings(from.path, { ...settings, views })
  }
  // YAZ-999's CLOSED-target half: the destination page may not be mounted, so its open-folder
  // invariant cannot answer this gesture. Membership stays the source-of-truth write and lands
  // first; then the shared missing-only operation fills the target's declarations.
  await backfillFolderPageColumns([child], to.columns)
}
