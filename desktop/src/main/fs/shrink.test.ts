import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shrinkVault } from './shrink'

/**
 * "Move pictures out of boards" (YAZ-1801 D5): the save's own extraction run over a whole vault
 * — pictures into `assets/` (once, however many boards share them), the board rewritten lean —
 * with the one difference that makes it not a save: the `yaseendraw` block rides through
 * VERBATIM, so `updatedAt` never moves for boards nobody edited. Tolerant per board.
 */

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'draw-shrink-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

const OLD = Date.UTC(2026, 0, 15)
const BLOCK = { createdAt: OLD, updatedAt: OLD, cloudId: 'k97' }
const png = (text: string) => `data:image/png;base64,${Buffer.from(text).toString('base64')}`
const imageEl = (fileId: string) => ({ id: `el-${fileId}`, type: 'image', fileId })

function legacy(files: Record<string, { mimeType: string; dataURL: string }>, elements: unknown[]): string {
  return `${JSON.stringify({ yaseendraw: BLOCK, type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files }, null, 2)}\n`
}

async function seed(rel: string, body: string): Promise<string> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return file
}

const assets = async () => (await readdir(path.join(root, 'assets')).catch(() => [] as string[])).sort()

describe('shrinkVault (YAZ-1801 D5)', () => {
  it('moves referenced pictures into assets/, writes the board lean, and keeps the block verbatim', async () => {
    const file = await seed('Legacy.excalidraw', legacy({ aaa: { mimeType: 'image/png', dataURL: png('A') }, bbb: { mimeType: 'image/png', dataURL: png('B') } }, [imageEl('aaa'), imageEl('bbb')]))
    const before = (await stat(file)).size

    const res = await shrinkVault(root)

    expect(res).toEqual({ shrunk: 1, skipped: 0, bytesMoved: before - (await stat(file)).size })
    expect(res.bytesMoved).toBeGreaterThan(0)
    expect(await assets()).toEqual(['aaa.png', 'bbb.png'])
    expect(await readFile(path.join(root, 'assets', 'aaa.png'), 'utf8')).toBe('A')
    const after = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    expect(Object.keys(after)[0]).toBe('yaseendraw')
    // Verbatim: the SAME dates (updatedAt did not move) and the backfill's extra key.
    expect(after.yaseendraw).toEqual(BLOCK)
    expect(after.files).toEqual({})
    expect(after.elements).toEqual([imageEl('aaa'), imageEl('bbb')])
  })

  it('stores a picture two boards share ONCE, and drops an embedded picture nothing references', async () => {
    await seed('A.excalidraw', legacy({ same: { mimeType: 'image/png', dataURL: png('S') } }, [imageEl('same')]))
    await seed('Nested/B.excalidraw', legacy({ same: { mimeType: 'image/png', dataURL: png('S') }, orphan: { mimeType: 'image/png', dataURL: png('O') } }, [imageEl('same')]))

    const res = await shrinkVault(root)

    expect(res.shrunk).toBe(2)
    expect(await assets()).toEqual(['same.png'])
    expect(JSON.parse(await readFile(path.join(root, 'Nested/B.excalidraw'), 'utf8')).files).toEqual({})
  })

  it('never throws per board: corrupt and skip-listed boards count as skipped and stay byte-identical; lean boards are neither', async () => {
    await seed('Corrupt.excalidraw', '{ not json')
    const dirtyBody = legacy({ x: { mimeType: 'image/png', dataURL: png('X') } }, [imageEl('x')])
    const dirty = await seed('Dirty.excalidraw', dirtyBody)
    const leanBody = legacy({}, [])
    const lean = await seed('Lean.excalidraw', leanBody)

    const res = await shrinkVault(root, { skip: [dirty] })

    expect(res).toEqual({ shrunk: 0, skipped: 2, bytesMoved: 0 })
    expect(await readFile(dirty, 'utf8')).toBe(dirtyBody)
    expect(await readFile(lean, 'utf8')).toBe(leanBody)
    expect(await assets()).toEqual([])
  })

  it('a malformed dataURL is dropped as a save drops it; the rest of the board still moves', async () => {
    const file = await seed('Mixed.excalidraw', legacy({ good: { mimeType: 'image/png', dataURL: png('G') }, bad: { mimeType: 'image/png', dataURL: 'data:image/png;base64,@@@not base64' } }, [imageEl('good'), imageEl('bad')]))

    expect((await shrinkVault(root)).shrunk).toBe(1)
    expect(await assets()).toEqual(['good.png'])
    expect(JSON.parse(await readFile(file, 'utf8')).yaseendraw).toEqual(BLOCK)
  })

  it('is idempotent: a second run finds nothing to do', async () => {
    await seed('Legacy.excalidraw', legacy({ aaa: { mimeType: 'image/png', dataURL: png('A') } }, [imageEl('aaa')]))
    await shrinkVault(root)
    expect(await shrinkVault(root)).toEqual({ shrunk: 0, skipped: 0, bytesMoved: 0 })
  })

  it('leaves dot-folders alone (a board inside .git or .yaseendraw is not the vault\'s)', async () => {
    const hidden = legacy({ h: { mimeType: 'image/png', dataURL: png('H') } }, [imageEl('h')])
    const file = await seed('.hidden/Inside.excalidraw', hidden)
    expect(await shrinkVault(root)).toEqual({ shrunk: 0, skipped: 0, bytesMoved: 0 })
    expect(await readFile(file, 'utf8')).toBe(hidden)
  })
})
