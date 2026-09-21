/**
 * Title search candidates (YAZ-802): basename + alias rows over an index snapshot, matched
 * through the shared completion matcher at SEARCH_CAP — and, since YAZ-1491, one row per FOLDER
 * of the loaded tree (🔒 D1), ranked through the very same matcher (🔒 D2). The perf smoke lives
 * in searchCandidates.perf.test.ts (YAZ-740).
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { SEARCH_CAP, folderCandidates, searchCandidates, searchTitles } from './searchCandidates'

const rec = (path: string, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const folder = path.slice('/vault/'.length, path.lastIndexOf('/')).replace(/^\/+$/, '')
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

describe('searchCandidates', () => {
  it('one row per record: matched on the basename, opening its own path, folder as the label', () => {
    expect(searchCandidates([rec('/vault/sub/Alpha.md')])).toEqual([
      { kind: 'file', name: 'Alpha', lower: 'alpha', label: 'Alpha', path: '/vault/sub/Alpha.md', folder: 'sub' },
    ])
  })

  it('a root-level record carries an empty folder', () => {
    expect(searchCandidates([rec('/vault/Alpha.md')])[0].folder).toBe('')
  })

  it('an alias adds a row after its note, labelled with the basename', () => {
    const rows = searchCandidates([rec('/vault/Customer Acquisition Cost.md', ['CAC', 'Acquisition Cost'])])
    expect(rows.map((c) => c.label)).toEqual([
      'Customer Acquisition Cost',
      'CAC — Customer Acquisition Cost',
      'Acquisition Cost — Customer Acquisition Cost',
    ])
    // Every row opens the same note.
    expect(rows.every((c) => c.path === '/vault/Customer Acquisition Cost.md')).toBe(true)
  })

  it('an alias equal to its own basename is skipped — it would only duplicate the row', () => {
    expect(searchCandidates([rec('/vault/CAC.md', ['CAC', 'cac', 'Cost'])]).map((c) => c.label)).toEqual(['CAC', 'Cost — CAC'])
  })

  it('duplicate basenames BOTH appear under the bare name, told apart by the folder (unlike linkCandidates)', () => {
    const rows = searchCandidates([rec('/vault/Note.md'), rec('/vault/deep/Note.md')])
    expect(rows.map((c) => c.name)).toEqual(['Note', 'Note'])
    expect(rows.map((c) => c.folder)).toEqual(['', 'deep'])
    expect(rows.map((c) => c.path)).toEqual(['/vault/Note.md', '/vault/deep/Note.md'])
  })
})

describe('folderCandidates (🔒 D1, YAZ-1491)', () => {
  it('one `dir` row per folder: matched by its own name, opening (revealing) its own path', () => {
    expect(folderCandidates('/vault', ['/vault/Archive'])).toEqual([
      { kind: 'dir', name: 'Archive', lower: 'archive', label: 'Archive', path: '/vault/Archive', folder: '' },
    ])
  })

  it('a nested folder is labelled by its ROOT-RELATIVE parent, the way IndexRecord.folder is', () => {
    expect(folderCandidates('/vault', ['/vault/A', '/vault/A/B', '/vault/A/B/C']).map((c) => [c.name, c.folder])).toEqual([
      ['A', ''],
      ['B', 'A'],
      ['C', 'A/B'],
    ])
  })

  it('tolerates a trailing slash on the root', () => {
    expect(folderCandidates('/vault/', ['/vault/A/B']).map((c) => [c.name, c.folder])).toEqual([['B', 'A']])
  })

  it('no folders, no rows', () => {
    expect(folderCandidates('/vault', [])).toEqual([])
  })
})

describe('searchTitles', () => {
  const candidates = searchCandidates([
    rec('/vault/Big CAC story.md'),
    rec('/vault/CAC Model.md'),
    rec('/vault/CAC.md'),
    rec('/vault/Ideas.md', ['cac notes']),
  ])

  it('ranks exact → prefix → substring, input order within each bucket', () => {
    expect(searchTitles(candidates, 'cac').map((c) => c.label)).toEqual([
      'CAC',
      'CAC Model',
      'cac notes — Ideas',
      'Big CAC story',
    ])
  })

  it('a note never matches on its folder (🔒 D3, YAZ-739); the folder itself is ONE row (🔒 D2, YAZ-1491)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/Archive']), ...searchCandidates([rec('/vault/Archive/Note.md')])]
    expect(searchTitles(rows, 'archive').map((c) => [c.kind, c.label])).toEqual([['dir', 'Archive']])
  })

  it('a folder and a note of the same name both match exactly — the folder first (tree order, 🔒 D1)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/CAC']), ...searchCandidates([rec('/vault/CAC.md')])]
    expect(searchTitles(rows, 'cac').map((c) => [c.kind, c.path])).toEqual([
      ['dir', '/vault/CAC'],
      ['file', '/vault/CAC.md'],
    ])
  })

  it('an empty query returns the first SEARCH_CAP rows in records order', () => {
    const many = searchCandidates(Array.from({ length: SEARCH_CAP + 10 }, (_, i) => rec(`/vault/Note ${i}.md`)))
    expect(searchTitles(many, '')).toEqual(many.slice(0, SEARCH_CAP))
  })

  it('caps at SEARCH_CAP after ranking — a late exact match still tops a board of substrings', () => {
    const many = searchCandidates([
      ...Array.from({ length: SEARCH_CAP + 10 }, (_, i) => rec(`/vault/note cac ${i}.md`)),
      rec('/vault/CAC.md'),
    ])
    const matched = searchTitles(many, 'cac')
    expect(matched).toHaveLength(SEARCH_CAP)
    expect(matched[0].name).toBe('CAC')
  })
})
