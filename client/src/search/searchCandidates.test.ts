/**
 * Title search candidates (YAZ-802): one row per FILE of the loaded tree, named the way the tree
 * and the tab strip spell it (a drawing without its extension), matched through the shared
 * matcher at SEARCH_CAP — and, since YAZ-1491, one row per FOLDER of that same tree (🔒 D1),
 * ranked through the very same matcher (🔒 D2).
 */
import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { SEARCH_CAP, folderCandidates, searchCandidates, searchTitles } from './searchCandidates'

const file = (path: string): TreeNode => ({
  type: 'file',
  name: path.slice(path.lastIndexOf('/') + 1),
  path,
  size: 1,
  mtime: 1,
  kind: 'drawing',
})

describe('searchCandidates', () => {
  it('one row per file: matched on the name, opening its own path, folder as the label', () => {
    expect(searchCandidates('/vault', [file('/vault/sub/Alpha.excalidraw')])).toEqual([
      { kind: 'file', name: 'Alpha', lower: 'alpha', label: 'Alpha', path: '/vault/sub/Alpha.excalidraw', folder: 'sub' },
    ])
  })

  it('a root-level file carries an empty folder', () => {
    expect(searchCandidates('/vault', [file('/vault/Alpha.excalidraw')])[0].folder).toBe('')
  })

  it('a nested file is labelled by its ROOT-RELATIVE parent, and a trailing slash on the root is tolerated', () => {
    expect(searchCandidates('/vault', [file('/vault/A/B/Deep.excalidraw')])[0].folder).toBe('A/B')
    expect(searchCandidates('/vault/', [file('/vault/A/Deep.excalidraw')])[0].folder).toBe('A')
  })

  it('a drawing matches and reads WITHOUT its extension — the name the tree shows', () => {
    const rows = searchCandidates('/vault', [file('/vault/Customer Acquisition Cost.excalidraw')])
    expect(rows.map((c) => [c.name, c.label, c.lower])).toEqual([
      ['Customer Acquisition Cost', 'Customer Acquisition Cost', 'customer acquisition cost'],
    ])
    expect(rows[0].path).toBe('/vault/Customer Acquisition Cost.excalidraw')
  })

  it('duplicate names BOTH appear under the bare name, told apart by the folder', () => {
    const rows = searchCandidates('/vault', [file('/vault/Note.excalidraw'), file('/vault/deep/Note.excalidraw')])
    expect(rows.map((c) => c.name)).toEqual(['Note', 'Note'])
    expect(rows.map((c) => c.folder)).toEqual(['', 'deep'])
    expect(rows.map((c) => c.path)).toEqual(['/vault/Note.excalidraw', '/vault/deep/Note.excalidraw'])
  })

  it('no files, no rows', () => {
    expect(searchCandidates('/vault', [])).toEqual([])
  })
})

describe('folderCandidates (🔒 D1, YAZ-1491)', () => {
  it('one `dir` row per folder: matched by its own name, opening (revealing) its own path', () => {
    expect(folderCandidates('/vault', ['/vault/Archive'])).toEqual([
      { kind: 'dir', name: 'Archive', lower: 'archive', label: 'Archive', path: '/vault/Archive', folder: '' },
    ])
  })

  it('a nested folder is labelled by its ROOT-RELATIVE parent, the way a file row is', () => {
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
  const candidates = searchCandidates('/vault', [
    file('/vault/Big CAC story.excalidraw'),
    file('/vault/CAC Model.excalidraw'),
    file('/vault/CAC.excalidraw'),
  ])

  it('ranks exact → prefix → substring, input order within each bucket', () => {
    expect(searchTitles(candidates, 'cac').map((c) => c.label)).toEqual(['CAC', 'CAC Model', 'Big CAC story'])
  })

  it('a drawing never matches on its folder (🔒 D3, YAZ-739); the folder itself is ONE row (🔒 D2, YAZ-1491)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/Archive']), ...searchCandidates('/vault', [file('/vault/Archive/Note.excalidraw')])]
    expect(searchTitles(rows, 'archive').map((c) => [c.kind, c.label])).toEqual([['dir', 'Archive']])
  })

  it('a folder and a drawing of the same name both match exactly — the folder first (tree order, 🔒 D1)', () => {
    const rows = [...folderCandidates('/vault', ['/vault/CAC']), ...searchCandidates('/vault', [file('/vault/CAC.excalidraw')])]
    expect(searchTitles(rows, 'cac').map((c) => [c.kind, c.path])).toEqual([
      ['dir', '/vault/CAC'],
      ['file', '/vault/CAC.excalidraw'],
    ])
  })

  it('an empty query returns the first SEARCH_CAP rows in tree order', () => {
    const many = searchCandidates('/vault', Array.from({ length: SEARCH_CAP + 10 }, (_, i) => file(`/vault/Note ${i}.excalidraw`)))
    expect(searchTitles(many, '')).toEqual(many.slice(0, SEARCH_CAP))
  })

  it('caps at SEARCH_CAP after ranking — a late exact match still tops a board of substrings', () => {
    const many = searchCandidates('/vault', [
      ...Array.from({ length: SEARCH_CAP + 10 }, (_, i) => file(`/vault/note cac ${i}.excalidraw`)),
      file('/vault/CAC.excalidraw'),
    ])
    const matched = searchTitles(many, 'cac')
    expect(matched).toHaveLength(SEARCH_CAP)
    expect(matched[0].name).toBe('CAC')
  })
})
