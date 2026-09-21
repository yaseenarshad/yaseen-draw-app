/**
 * SYNC FROM FOLDER (YAZ-951, the pure half of YAZ-950): which of a disk folder's notes a folder
 * page's outline does not list yet, and the text to append for each. The LOGIC layer only; the
 * picker and the write that appends the lines are 950's.
 *
 * NOTHING HERE IS A SECOND RULE. Already-listed is `outlineLinkTargets` (`outlineSync.ts`) — the
 * click rule, judged by where a line RESOLVES, so a note listed through an alias, a different
 * case or its `folder/name` form is already listed and a name that resolves ELSEWHERE never
 * counts as listing it. The text to append is the completion picker's own name row
 * (`links/completion.ts` `linkNames`) — the SHORTEST UNAMBIGUOUS name, so a duplicate basename
 * appends `folder/Name` and the appended link lands on the note it names. That lookup is shared
 * with adoption (YAZ-1152): one note, one spelling, wherever it is written.
 *
 * THE ANSWER STOPS AT THE FOLDER'S OWN NOTES: `folder` is the root-relative folder of a record
 * ('' at the vault root, which is a folder like any other), matched exactly — a note in
 * `auto/deep` is not in `auto`. Non-markdown files are not notes, and the folder page never
 * lists itself.
 */
import { fileKind } from '@shared/fileKind'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { linkNames } from '../links/completion'
import { outlineLinkTargets } from './outlineSync'

/** Names sort the way the base engine sorts them: case- and accent-insensitive, numeric-aware. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

const isNote = (record: IndexRecord): boolean => fileKind(record.path) === 'markdown'

/** Every folder holding at least one note DIRECTLY, path-sorted, with how many it holds. */
export function foldersWithNotes(records: readonly IndexRecord[]): { folder: string; notes: number }[] {
  const notes = new Map<string, number>()
  for (const record of records) if (isNote(record)) notes.set(record.folder, (notes.get(record.folder) ?? 0) + 1)
  return [...notes]
    .map(([folder, count]) => ({ folder, notes: count }))
    .sort((a, b) => collator.compare(a.folder, b.folder))
}

/** The folder's notes the outline does not name yet, alphabetical, each with the text to append. */
export function missingFromOutline({
  records,
  folder,
  outline,
  folderPagePath,
  resolve,
}: {
  records: readonly IndexRecord[]
  folder: string
  outline: string
  folderPagePath: string
  resolve: ResolveLink
}): { path: string; insert: string }[] {
  const listed = outlineLinkTargets(outline, resolve)
  const nameOf = linkNames(records)
  return records
    .filter(r => r.folder === folder && isNote(r) && r.path !== folderPagePath && !listed.has(r.path))
    .sort((a, b) => collator.compare(a.basename, b.basename))
    .flatMap(record => {
      const insert = nameOf.get(record.path)
      // No name resolves back: the root case-collision `linkCandidates` records as unfixable.
      // There is no text that would link here, so there is nothing to offer.
      return insert === undefined ? [] : [{ path: record.path, insert }]
    })
}
