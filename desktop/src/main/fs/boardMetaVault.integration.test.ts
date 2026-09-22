import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { TreeNode } from '@shared/types'
import { BOARD_META_KEY, parseBoardMetaBlock } from '@shared/drawingAssets'
import { createFile } from './create'
import { loadDrawing, saveDrawing } from './drawing'
import { renameFile } from './rename'
import { blockOf as blockOfText } from './testFixture'
import { tree } from './tree'

/**
 * 1834D — the `yaseendraw` block across the REAL boundaries (🔒 YAZ-1834): the stress vault
 * `tools/seedDemoVault.mjs` builds (63 boards: legacy-embedded, empty, corrupt, unicode, 40-image,
 * 10 MB), the real doors, and a `git clone` of the vault's own origin. No Playwright, no app.
 * `.integration.test.ts` because it forks `node` and `git`: seconds, not milliseconds.
 */

const run = promisify(execFile)
const SEED = path.resolve(__dirname, '../../../../tools/seedDemoVault.mjs')

let work: string
let vault: string
let origin: string
beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'yd-1834d-'))
  vault = path.join(work, 'vault')
  origin = path.join(work, 'origin.git')
  await run(process.execPath, [SEED, '--vault', vault, '--origin', origin])
}, 60_000)
afterAll(() => rm(work, { recursive: true, force: true }))

const boards = (nodes: TreeNode[]): Extract<TreeNode, { type: 'file' }>[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? boards(n.children) : n.kind === 'drawing' ? [n] : []))
const byName = (nodes: TreeNode[], name: string) => boards(nodes).find((n) => n.name === name)
const blockOf = async (file: string) => blockOfText(await readFile(file, 'utf8'))
const plain = (elements: unknown[] = []) => `${JSON.stringify({ type: 'excalidraw', version: 2, elements, appState: {}, files: {} }, null, 2)}\n`

describe('1834D — the block on the seeded stress vault', () => {
  it('1. a fresh seed lists every board, none with meta', async () => {
    const all = boards((await tree(vault)).tree)
    expect(all.length).toBeGreaterThan(50)
    expect(all.filter((n) => n.meta !== undefined)).toEqual([])
    for (const name of ['07 Corrupt.excalidraw', '08 Empty file.excalidraw', '06 Big image 10MB.excalidraw']) expect(byName(all, name), name).toBeDefined()
  })

  it('2. a new board is born stamped', async () => {
    const file = path.join(vault, 'Born here.excalidraw')
    await createFile({ path: file, content: plain() })
    const node = byName((await tree(vault)).tree, 'Born here.excalidraw')
    expect(node?.meta).toBeDefined()
    expect(node?.meta?.createdAt).toBe(node?.meta?.updatedAt)
  })

  it('3+4. a legacy embedded board shrinks AND gets its block on first save; a second save keeps createdAt', async () => {
    const file = path.join(vault, '03 Legacy embedded.excalidraw')
    const born = new Date('2020-01-02T03:04:05Z')
    await utimes(file, born, born)
    const before = (await stat(file)).size
    const doc = await loadDrawing({ root: vault, path: file })
    expect(Object.keys(doc.files).length).toBeGreaterThan(0)
    await saveDrawing({ root: vault, path: file, json: doc.json, expectedMtime: doc.mtime, newFiles: [] })
    const first = await blockOf(file)
    expect(first.createdAt).toBe(born.getTime())
    expect((await stat(file)).size).toBeLessThan(before)
    await new Promise((r) => setTimeout(r, 5))
    const again = await loadDrawing({ root: vault, path: file })
    await saveDrawing({ root: vault, path: file, json: again.json, expectedMtime: again.mtime, newFiles: [] })
    const second = await blockOf(file)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt as number)
    expect(byName((await tree(vault)).tree, '03 Legacy embedded.excalidraw')?.meta).toEqual({ createdAt: second.createdAt, updatedAt: second.updatedAt })
  })

  it('5–7. a backfilled board keeps its cloud dates and cloudId through an app save, a rename, a folder move and a git clone', async () => {
    // 5. The importer's shape (YAZ-1832): the block first, the cloud row's dates, its own key beside them.
    const file = path.join(vault, 'Folder A', 'From the cloud.excalidraw')
    await writeFile(file, `${JSON.stringify({ [BOARD_META_KEY]: { createdAt: 1600000000000, updatedAt: 1600000000001, cloudId: 'j97abc' }, type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`)
    expect(byName((await tree(vault)).tree, 'From the cloud.excalidraw')?.meta).toEqual({ createdAt: 1600000000000, updatedAt: 1600000000001 })
    const doc = await loadDrawing({ root: vault, path: file })
    await saveDrawing({ root: vault, path: file, json: plain([{ id: 'edit', type: 'rectangle' }]), expectedMtime: doc.mtime, newFiles: [] })
    const block = await blockOf(file)
    expect(block).toMatchObject({ createdAt: 1600000000000, cloudId: 'j97abc' })
    expect(block.updatedAt).toBeGreaterThan(1600000000001)

    // 6. Rename the board, then move its folder: the meta follows the bytes.
    const before = byName((await tree(vault)).tree, 'From the cloud.excalidraw')?.meta
    await renameFile({ oldPath: file, newPath: path.join(vault, 'Folder A', 'Renamed.excalidraw') })
    await renameFile({ oldPath: path.join(vault, 'Folder A'), newPath: path.join(vault, 'Folder B') })
    const after = byName((await tree(vault)).tree, 'Renamed.excalidraw')
    expect(after?.path).toBe(path.join(vault, 'Folder B', 'Renamed.excalidraw'))
    expect(after?.meta).toEqual(before)

    // 7. Commit, push to the seeded origin, clone: same meta, different mtimes.
    await run('git', ['-C', vault, 'add', '-A'])
    await run('git', ['-C', vault, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'stamped'])
    await run('git', ['-C', vault, 'push', '-q', 'origin', 'HEAD'])
    const clone = path.join(work, 'clone')
    await run('git', ['clone', '-q', origin, clone])
    const here = boards((await tree(vault)).tree).filter((n) => n.meta !== undefined)
    const there = boards((await tree(clone)).tree).filter((n) => n.meta !== undefined)
    expect(here.length).toBeGreaterThanOrEqual(2)
    expect(there.map((n) => [path.relative(clone, n.path), n.meta])).toEqual(here.map((n) => [path.relative(vault, n.path), n.meta]))
    const cloud = there.find((n) => n.name === 'Renamed.excalidraw')
    expect(cloud?.meta?.createdAt).toBe(1600000000000)
    expect(cloud?.mtime).toBeGreaterThan(1600000000001)
  })

  it('8. the seeded corrupt and empty boards are listed without meta and never throw', async () => {
    const all = boards((await tree(vault)).tree)
    for (const name of ['07 Corrupt.excalidraw', '08 Empty file.excalidraw']) {
      expect(byName(all, name), name).toBeDefined()
      expect(byName(all, name), name).not.toHaveProperty('meta')
    }
  })

  it('9. a stale expectedMtime leaves a legacy board byte-identical and block-less', async () => {
    const file = path.join(vault, '01 Simple shapes.excalidraw')
    const original = await readFile(file, 'utf8')
    await expect(saveDrawing({ root: vault, path: file, json: plain(), expectedMtime: 1, newFiles: [] })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(file, 'utf8')).toBe(original)
    expect(parseBoardMetaBlock(original)).toBeNull()
  })
})
