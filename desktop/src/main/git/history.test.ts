import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boardHistory, boardVersion, restoreBoardVersion } from './history'
import { makeTwoMachines, REAL_GIT_TIMEOUT_MS, type Machine } from './gitFixture'
import { syncPass } from './sync'

/**
 * Version history (YAZ-1897 D4) over REAL git: two machines, real sync passes, then the three
 * reads a person makes from the panel — the list, one version's picture data, and a restore.
 */

type El = Record<string, unknown> & { id: string }
const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, index: `a${id}`, version: 1, versionNonce: 1, updated: 1000, isDeleted: false, boundElements: null, ...over })
const board = (elements: El[]): string => `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files: {} }, null, 2)}\n`
const xs = (json: string): unknown[] => (JSON.parse(json) as { elements: El[] }).elements.map((e) => e.x)

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function twoMachines(files: Record<string, string>): Promise<{ a: Machine; b: Machine }> {
  const pair = await makeTwoMachines(files)
  cleanups.push(pair.cleanup)
  return pair
}

const r1 = shape('1')
const r2 = shape('2')

describe('Version history', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('lists versions newest first with who made them; a merge is marked, and "before the merge" is offered', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1, r2]) })
    await b.write('b.excalidraw', board([{ ...r1, x: 7, version: 2, updated: 3000 }, r2]))
    await syncPass(b.root)
    await a.write('b.excalidraw', board([{ ...r1, x: 13, version: 2, updated: 2000 }, { ...r2, x: 5, version: 2, updated: 2000 }]))
    await syncPass(a.root)

    const versions = await boardHistory(a.root, 'b.excalidraw')
    const plain = versions.filter((v) => !v.localOnly)
    expect(plain.map((v) => [v.author, v.merged])).toEqual([
      ['Yaseen Draw Test', true],
      ['Sam', false],
      ['Yaseen Draw Test', false],
    ])
    expect(plain.every((v, i) => i === 0 || v.at <= (plain[i - 1]?.at ?? 0))).toBe(true)
    const before = versions.find((v) => v.localOnly)
    expect(before).toMatchObject({ author: 'Yaseen Draw Test', merged: false })
    expect(xs((await boardVersion(a.root, 'b.excalidraw', before?.ref)).json)).toEqual([13, 5])
    expect(xs((await boardVersion(a.root, path.join(a.root, 'b.excalidraw'), plain[0]?.ref)).json)).toEqual([7, 5])
  })

  it('drops "before the merge" once the board no longer differs from it', async () => {
    const { a, b } = await twoMachines({ 'b.excalidraw': board([r1]), 'other.excalidraw': board([r1]) })
    await b.write('b.excalidraw', board([r1, shape('sam', { index: 'a9' })]))
    await syncPass(b.root)
    await a.write('b.excalidraw', board([r1, shape('me', { index: 'a9' })]))
    await syncPass(a.root)
    // The merge never touched `other.excalidraw`: its before-merge version is its current one.
    expect((await boardHistory(a.root, 'other.excalidraw')).some((v) => v.localOnly)).toBe(false)
    expect((await boardHistory(a.root, 'b.excalidraw')).some((v) => v.localOnly)).toBe(true)
  })

  it('follows a rename: older versions still open under their old name', async () => {
    const { a } = await twoMachines({ 'old.excalidraw': board([r1]) })
    await a.git('mv', 'old.excalidraw', 'new.excalidraw')
    await a.write('new.excalidraw', board([{ ...r1, x: 3 }]))
    await a.git('commit', '-am', 'rename and edit')
    const versions = await boardHistory(a.root, 'new.excalidraw')
    expect(versions).toHaveLength(2)
    expect(versions[1]?.ref.endsWith(':old.excalidraw')).toBe(true)
    expect(xs((await boardVersion(a.root, 'new.excalidraw', versions[1]?.ref)).json)).toEqual([0])
  })

  it('resolves an old version\'s pictures from assets/, like opening the board does', async () => {
    const image = shape('img', { type: 'image', fileId: 'abc123' })
    const { a } = await twoMachines({ 'b.excalidraw': board([image]), 'assets/abc123.png': 'png-bytes' })
    const [v] = await boardHistory(a.root, 'b.excalidraw')
    const scene = await boardVersion(a.root, 'b.excalidraw', v?.ref)
    expect(scene.files.abc123).toEqual({ mimeType: 'image/png', dataURL: `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}` })
  })

  it('restores a version as an ordinary edit, byte for byte', async () => {
    const { a } = await twoMachines({ 'b.excalidraw': board([r1]) })
    await a.write('b.excalidraw', board([{ ...r1, x: 9 }]))
    await a.git('commit', '-am', 'edit')
    const oldest = (await boardHistory(a.root, 'b.excalidraw')).at(-1)
    await restoreBoardVersion(a.root, 'b.excalidraw', oldest?.ref)
    expect(a.read('b.excalidraw')).toBe(board([r1]))
    expect(await a.git('status', '--porcelain')).toBe('M b.excalidraw')
  })

  it('refuses a ref it did not hand out, a path outside the vault, and a non-board', async () => {
    const { a } = await twoMachines({ 'b.excalidraw': board([r1]), 'n.md': 'x' })
    await expect(boardVersion(a.root, 'b.excalidraw', 'HEAD:b.excalidraw')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(boardVersion(a.root, 'b.excalidraw', '--output=/tmp/x')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(boardHistory(a.root, '../escape.excalidraw')).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(boardHistory(a.root, 'n.md')).rejects.toMatchObject({ code: 'UNSUPPORTED_EXTENSION' })
  })

  it('answers an empty history for a vault with no git', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'yaseendraw-nogit-'))
    cleanups.push(() => rm(dir, { recursive: true, force: true }))
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'b.excalidraw'), board([r1]))
    expect(await boardHistory(dir, 'b.excalidraw')).toEqual([])
  })
})
