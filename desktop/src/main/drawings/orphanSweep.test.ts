/**
 * The orphan sweep on a real temp vault, with `shell.trashItem` injected (🔒 D3, YAZ-1811).
 * No Electron import anywhere in the module under test, which is why this runs on plain Node —
 * and why a test never moves a file into the developer's own Trash.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ORPHAN_MAX_AGE_MS } from '@shared/drawingAssets'
import { referencedAssetIds, sweepOrphanAssets } from './orphanSweep'

const DAY = 24 * 60 * 60 * 1000

let root: string
let trashed: string[]

/** A file at `rel`, optionally aged into the past; parents made on the way. */
async function put(rel: string, body: string, ageMs = 0): Promise<string> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs)
    await utimes(file, when, when)
  }
  return file
}

const board = (...fileIds: string[]) => JSON.stringify({ type: 'excalidraw', elements: fileIds.map((fileId) => ({ type: 'image', fileId })) })

/** The real deps, minus the OS trash. */
const deps = () => ({ now: Date.now, trash: async (p: string) => void trashed.push(path.basename(p)) })

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'draw-sweep-'))
  trashed = []
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('referencedAssetIds', () => {
  it('reads every `.excalidraw` under the root, however deep', async () => {
    await put('Top.excalidraw', board('a'))
    await put('One/Two/Three/Deep.excalidraw', board('b', 'c'))
    expect([...(await referencedAssetIds(root))].sort()).toEqual(['a', 'b', 'c'])
  })

  it('skips dot-dirs, node_modules and the store itself — none of them can hold a board that counts', async () => {
    await put('.trash/Old.excalidraw', board('hidden'))
    await put('node_modules/pkg/README.excalidraw', board('vendored'))
    await put('assets/Weird.excalidraw', board('inthestore'))
    await put('Real.excalidraw', board('real'))
    expect([...(await referencedAssetIds(root))]).toEqual(['real'])
  })

  it('counts a user folder named `assets` INSIDE a subfolder — only the store at the root is skipped', async () => {
    await put('Projects/assets/Board.excalidraw', board('theirs'))
    expect([...(await referencedAssetIds(root))]).toEqual(['theirs'])
  })

  it('ignores a DELETED image element: undo brings the id back, the age guard keeps the bytes', async () => {
    await put('Board.excalidraw', JSON.stringify({ elements: [{ type: 'image', fileId: 'gone', isDeleted: true }, { type: 'image', fileId: 'live' }] }))
    expect([...(await referencedAssetIds(root))]).toEqual(['live'])
  })

  it('tolerates a corrupt, empty or non-scene file: skipped, never fatal', async () => {
    await put('Broken.excalidraw', '{ not json')
    await put('Empty.excalidraw', '')
    await put('Array.excalidraw', '[1,2]')
    await put('Good.excalidraw', board('good'))
    expect([...(await referencedAssetIds(root))]).toEqual(['good'])
  })

  it('answers an empty set for a vault with no boards', async () => {
    expect((await referencedAssetIds(root)).size).toBe(0)
  })
})

describe('sweepOrphanAssets', () => {
  it('trashes what is unreferenced AND old, and keeps everything else', async () => {
    await put('assets/orphan.png', 'x', 3 * DAY)
    await put('assets/fresh.png', 'x', 60_000)
    await put('assets/used.png', 'x', 3 * DAY)
    await put('Board.excalidraw', board('used'))
    expect(await sweepOrphanAssets(root, deps())).toBe(1)
    expect(trashed).toEqual(['orphan.png'])
    expect((await readdir(path.join(root, 'assets'))).sort()).toEqual(['fresh.png', 'orphan.png', 'used.png'])
  })

  it('an asset used only by a NESTED board is never swept', async () => {
    await put('assets/deep.png', 'x', 3 * DAY)
    await put('A/B/C/Board.excalidraw', board('deep'))
    expect(await sweepOrphanAssets(root, deps())).toBe(0)
    expect(trashed).toEqual([])
  })

  it('leaves the user`s own files in assets/ alone: dot-entries, folders and foreign extensions', async () => {
    await put('assets/.DS_Store', 'x', 3 * DAY)
    await put('assets/notes.txt', 'x', 3 * DAY)
    await put('assets/sub/nested.png', 'x', 3 * DAY)
    expect(await sweepOrphanAssets(root, deps())).toBe(0)
    expect(trashed).toEqual([])
  })

  it('does no work at all when there is no store, or an empty one', async () => {
    await put('Board.excalidraw', board('a'))
    expect(await sweepOrphanAssets(root, deps())).toBe(0)
    await mkdir(path.join(root, 'assets'))
    expect(await sweepOrphanAssets(root, deps())).toBe(0)
  })

  it('a failing trash call skips that file and the sweep carries on', async () => {
    await put('assets/aaa.png', 'x', 3 * DAY)
    await put('assets/bbb.png', 'x', 3 * DAY)
    const swept = await sweepOrphanAssets(root, {
      now: Date.now,
      trash: async (p) => {
        if (p.endsWith('aaa.png')) throw new Error('locked')
        trashed.push(path.basename(p))
      },
    })
    expect(swept).toBe(1)
    expect(trashed).toEqual(['bbb.png'])
  })

  it('uses the injected clock, so the 24 h boundary is testable without waiting', async () => {
    const file = await put('assets/edge.png', 'x')
    // Read the mtime the filesystem actually recorded: `Date.now()` here would drift past the
    // boundary by however long the write took, which is exactly the thing under test.
    const mtime = (await stat(file)).mtimeMs
    expect(await sweepOrphanAssets(root, { ...deps(), now: () => mtime + ORPHAN_MAX_AGE_MS })).toBe(0)
    expect(await sweepOrphanAssets(root, { ...deps(), now: () => mtime + ORPHAN_MAX_AGE_MS + 1 })).toBe(1)
  })
})
