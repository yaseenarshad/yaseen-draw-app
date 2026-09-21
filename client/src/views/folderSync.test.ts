/**
 * SYNC FROM FOLDER (YAZ-951, the pure half of YAZ-950): given the index, a disk folder, and a
 * folder page's outline document — which of that folder's notes are not yet listed on the page?
 *
 * Every case below pins one of the parent's 🔒 rules, because each is a place this could quietly
 * do the wrong thing: already-listed is judged by where a link RESOLVES (never by string match),
 * the text to append is the SHORTEST UNAMBIGUOUS name (never the bare basename), the answer stops
 * at the folder's own notes (never its subtree), and the page can never list itself.
 *
 * The resolver is handed in, keyed exactly like the real one (`makeResolver`, `views/engine.ts`) —
 * lowered, brackets and all — so these cases resolve the way a click would.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { foldersWithNotes, missingFromOutline } from './folderSync'

const ROOT = '/vault'

const rec = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice(`${ROOT}/`.length)
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: name.endsWith('.markdown') ? 'markdown' : 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
    ...over,
  } as IndexRecord
}

/** A resolver over these records: bare basename, and `folder/basename`, both case-insensitively. */
const resolverOver =
  (records: readonly IndexRecord[]): ResolveLink =>
  (target: string) => {
    const needle = target.trim().replace(/^\[\[|\]\]$/g, '').toLowerCase()
    const byAlias = records.find((r) => r.aliases.some((a) => a.toLowerCase() === needle))
    if (byAlias !== undefined) return byAlias.path
    const rel = (r: IndexRecord) => (r.folder === '' ? r.basename : `${r.folder}/${r.basename}`).toLowerCase()
    return records.find((r) => rel(r) === needle)?.path ?? records.find((r) => r.basename.toLowerCase() === needle)?.path ?? null
  }

/** The call under test, with the fixture's own resolver wired in. */
const missing = (records: readonly IndexRecord[], folder: string, outline: string, folderPagePath = `${ROOT}/Topic.md`) =>
  missingFromOutline({ records, folder, outline, folderPagePath, resolve: resolverOver(records) })

const PAGE = rec(`${ROOT}/Topic.md`)

describe('missingFromOutline: which of a folder’s notes the page does not list yet', () => {
  it('answers the folder’s notes, alphabetically, each with the text to append', () => {
    const records = [PAGE, rec(`${ROOT}/auto/Zebra.md`), rec(`${ROOT}/auto/Alpha.md`)]
    expect(missing(records, 'auto', '')).toEqual([
      { path: `${ROOT}/auto/Alpha.md`, insert: 'Alpha' },
      { path: `${ROOT}/auto/Zebra.md`, insert: 'Zebra' },
    ])
  })

  it('skips what the outline already names — plainly, and through an ALIAS or a folder/name form (🔒 6)', () => {
    const records = [
      PAGE,
      rec(`${ROOT}/auto/Alpha.md`),
      rec(`${ROOT}/auto/Beta.md`, { aliases: ['B-side'] }),
      rec(`${ROOT}/auto/Gamma.md`),
      rec(`${ROOT}/auto/Delta.md`),
    ]
    // Alpha by name, Beta by its alias, Gamma by its folder/name form, Delta by a different case.
    const outline = '- [[Alpha]]\n- [[B-side]]\n- [[auto/Gamma]]\n- [[dElTa]]'
    expect(missing(records, 'auto', outline)).toEqual([])
  })

  it('a name that resolves elsewhere does NOT count as listing this note (resolution, not spelling)', () => {
    // The outline says [[Alpha]] — and [[Alpha]] resolves to the ROOT one, not the folder's.
    const records = [PAGE, rec(`${ROOT}/Alpha.md`), rec(`${ROOT}/auto/Alpha.md`)]
    expect(missing(records, 'auto', '- [[Alpha]]')).toEqual([{ path: `${ROOT}/auto/Alpha.md`, insert: 'auto/Alpha' }])
  })

  it('appends the SHORTEST UNAMBIGUOUS name, so a duplicate basename is disambiguated (🔒 7)', () => {
    const records = [PAGE, rec(`${ROOT}/Guide.md`), rec(`${ROOT}/auto/Guide.md`)]
    // The root Guide owns the bare name (shallowest), so the folder's must carry its folder.
    expect(missing(records, 'auto', '')).toEqual([{ path: `${ROOT}/auto/Guide.md`, insert: 'auto/Guide' }])
  })

  it('takes the folder’s OWN notes, never its subtree (🔒 5)', () => {
    const records = [PAGE, rec(`${ROOT}/auto/Alpha.md`), rec(`${ROOT}/auto/deep/Buried.md`)]
    expect(missing(records, 'auto', '').map((m) => m.path)).toEqual([`${ROOT}/auto/Alpha.md`])
  })

  it('ignores non-markdown files and never lists the page itself (🔒 8)', () => {
    const records = [
      rec(`${ROOT}/auto/Topic.md`),
      rec(`${ROOT}/auto/Alpha.md`),
      rec(`${ROOT}/auto/sheet.csv`, { ext: 'csv' }),
      rec(`${ROOT}/auto/photo.png`, { ext: 'png' }),
    ]
    expect(missing(records, 'auto', '', `${ROOT}/auto/Topic.md`).map((m) => m.path)).toEqual([`${ROOT}/auto/Alpha.md`])
  })

  it('answers nothing for an empty folder, an unknown folder, and a fully-listed one', () => {
    const records = [PAGE, rec(`${ROOT}/auto/Alpha.md`)]
    expect(missing(records, 'empty', '')).toEqual([])
    expect(missing(records, 'nope/at/all', '')).toEqual([])
    expect(missing(records, 'auto', '- [[Alpha]]')).toEqual([])
  })

  it('reads the ROOT folder as its own folder (the vault’s top level is a folder too)', () => {
    const records = [PAGE, rec(`${ROOT}/Loose.md`), rec(`${ROOT}/auto/Alpha.md`)]
    expect(missing(records, '', '').map((m) => m.path)).toEqual([`${ROOT}/Loose.md`])
  })

  it('is idempotent: appending its own answer leaves nothing to do the next time', () => {
    const records = [PAGE, rec(`${ROOT}/auto/Alpha.md`), rec(`${ROOT}/auto/Beta.md`)]
    const first = missing(records, 'auto', '')
    const outline = first.map((m) => `- [[${m.insert}]]`).join('\n')
    expect(missing(records, 'auto', outline)).toEqual([])
  })
})

describe('foldersWithNotes: what the picker offers', () => {
  it('lists every folder holding at least one markdown note, path-sorted, counted', () => {
    const records = [
      rec(`${ROOT}/Loose.md`),
      rec(`${ROOT}/zeta/One.md`),
      rec(`${ROOT}/auto/Alpha.md`),
      rec(`${ROOT}/auto/Beta.md`),
      rec(`${ROOT}/auto/deep/Buried.md`),
    ]
    expect(foldersWithNotes(records)).toEqual([
      { folder: '', notes: 1 },
      { folder: 'auto', notes: 2 },
      { folder: 'auto/deep', notes: 1 },
      { folder: 'zeta', notes: 1 },
    ])
  })

  it('a folder holding only non-markdown files is not offered — there is nothing there to sync', () => {
    const records = [rec(`${ROOT}/assets/logo.png`, { ext: 'png' }), rec(`${ROOT}/auto/Alpha.md`)]
    expect(foldersWithNotes(records)).toEqual([{ folder: 'auto', notes: 1 }])
  })

  it('an empty snapshot answers nothing', () => {
    expect(foldersWithNotes([])).toEqual([])
  })
})
