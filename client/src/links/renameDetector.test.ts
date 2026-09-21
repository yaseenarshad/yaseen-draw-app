import { describe, expect, it } from 'vitest'
import type { DiffFileStat, IndexRecord } from '@shared/types'
import { detectRenames, diffRecords, preRenameRecords } from './renameDetector'

const f = (path: string, size: number, mtime: number): DiffFileStat => ({ path, size, mtime })

describe('detectRenames (the E1c guard rails, GRO-2242 — locked)', () => {
  it('pairs an unambiguous (size, mtime) match old → new', () => {
    expect(detectRenames([f('/v/B.md', 7, 100)], [f('/v/B2.md', 7, 100)])).toEqual([{ oldPath: '/v/B.md', newPath: '/v/B2.md' }])
  })

  it('a pure move (same basename, different folder) is still a valid hypothesis', () => {
    expect(detectRenames([f('/v/Docs/N.md', 9, 50)], [f('/v/Notes/N.md', 9, 50)])).toEqual([{ oldPath: '/v/Docs/N.md', newPath: '/v/Notes/N.md' }])
  })

  it('the join key is EXACT equality: a size or mtime drift is no pair', () => {
    expect(detectRenames([f('/v/B.md', 7, 100)], [f('/v/B2.md', 8, 100)])).toEqual([])
    expect(detectRenames([f('/v/B.md', 7, 100)], [f('/v/B2.md', 7, 101)])).toEqual([])
  })

  it('zero-byte files never pair (size 0 matches every empty file)', () => {
    expect(detectRenames([f('/v/Empty.md', 0, 100)], [f('/v/Empty2.md', 0, 100)])).toEqual([])
  })

  it('markdown only: non-markdown paths never pair, whichever side they sit on', () => {
    expect(detectRenames([f('/v/All.txt', 7, 100)], [f('/v/All2.txt', 7, 100)])).toEqual([])
    expect(detectRenames([f('/v/pic.png', 7, 100)], [f('/v/pic2.png', 7, 100)])).toEqual([])
    expect(detectRenames([f('/v/B.md', 7, 100)], [f('/v/B2.txt', 7, 100)])).toEqual([])
  })

  it('an AMBIGUOUS signature skips entirely — one removed vs two added, two removed vs one added, 2×2', () => {
    expect(detectRenames([f('/v/B.md', 7, 100)], [f('/v/X.md', 7, 100), f('/v/Y.md', 7, 100)])).toEqual([])
    expect(detectRenames([f('/v/A.md', 7, 100), f('/v/B.md', 7, 100)], [f('/v/X.md', 7, 100)])).toEqual([])
    expect(detectRenames([f('/v/A.md', 7, 100), f('/v/B.md', 7, 100)], [f('/v/X.md', 7, 100), f('/v/Y.md', 7, 100)])).toEqual([])
  })

  it('independent pairs all detect, sorted by oldPath; an ambiguous signature never poisons the others', () => {
    expect(
      detectRenames(
        [f('/v/Z.md', 3, 30), f('/v/A.md', 1, 10), f('/v/Dup1.md', 5, 50), f('/v/Dup2.md', 5, 50)],
        [f('/v/A2.md', 1, 10), f('/v/Z2.md', 3, 30), f('/v/DupX.md', 5, 50)],
      ),
    ).toEqual([
      { oldPath: '/v/A.md', newPath: '/v/A2.md' },
      { oldPath: '/v/Z.md', newPath: '/v/Z2.md' },
    ])
  })

  it('a removed file nothing matches — or an added file with no vanished twin — yields nothing', () => {
    expect(detectRenames([f('/v/Deleted.md', 7, 100)], [])).toEqual([])
    expect(detectRenames([], [f('/v/Created.md', 7, 100)])).toEqual([])
  })
})

// ---------- the while-running feed's snapshot differ ----------

function rec(path: string, over: Partial<IndexRecord> = {}): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.(md|markdown)$/i, '')
  const rel = path.startsWith('/v/') ? path.slice('/v/'.length) : path
  const folder = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
  return { path, name, basename, folder, ext: 'md', size: 7, ctime: 1, mtime: 100, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
}

describe('diffRecords (consecutive index snapshots → the cold-diff shape)', () => {
  it('removed carries the PREVIOUS snapshot stats, added the new ones; survivors never show', () => {
    const prev = [rec('/v/A.md', { size: 3, mtime: 10 }), rec('/v/B.md', { size: 7, mtime: 100 })]
    const next = [rec('/v/A.md', { size: 4, mtime: 11 }), rec('/v/B2.md', { size: 7, mtime: 100 })]
    expect(diffRecords(prev, next)).toEqual({
      removed: [{ path: '/v/B.md', size: 7, mtime: 100 }],
      added: [{ path: '/v/B2.md', size: 7, mtime: 100 }],
    })
  })

  it('identical snapshots diff to nothing', () => {
    const snap = [rec('/v/A.md')]
    expect(diffRecords(snap, snap)).toEqual({ removed: [], added: [] })
  })
})

// ---------- the synthetic pre-rename snapshot ----------

describe('preRenameRecords (the engine wants the index as it WAS)', () => {
  it('re-paths the moved record back to the old path: path, name, basename and folder recomputed, links untouched', () => {
    const records = [rec('/v/A.md', { links: ['B'] }), rec('/v/Sub/B2.md', { links: ['A'] })]
    const pre = preRenameRecords(records, '/v', '/v/B.md', '/v/Sub/B2.md')
    expect(pre[0]).toBe(records[0]) // untouched records keep identity
    expect(pre[1]).toEqual({ ...records[1], path: '/v/B.md', name: 'B.md', basename: 'B', folder: '' })
  })

  it('a move INTO a folder recomputes the old (nested) folder', () => {
    const records = [rec('/v/N.md')]
    const pre = preRenameRecords(records, '/v', '/v/Docs/N.md', '/v/N.md')
    expect(pre[0]).toMatchObject({ path: '/v/Docs/N.md', name: 'N.md', basename: 'N', folder: 'Docs' })
  })

  it('a stale hypothesis is a no-op: no record at newPath, or one already living at oldPath', () => {
    const records = [rec('/v/A.md')]
    expect(preRenameRecords(records, '/v', '/v/B.md', '/v/Gone.md')).toEqual(records)
    const both = [rec('/v/B.md'), rec('/v/B2.md')]
    expect(preRenameRecords(both, '/v', '/v/B.md', '/v/B2.md')).toEqual(both)
  })
})
