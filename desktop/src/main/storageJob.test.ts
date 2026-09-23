import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { shrinkVault } from './fs/shrink'
import { bundleStorageWorker, makeGitRepo, REAL_GIT_TIMEOUT_MS } from './git/gitFixture'
import { vaultStorage } from './git/storage'
import { runOffThread } from './storageJob'

/**
 * The one storage worker (YAZ-1801 D8, 🔒 D11): both jobs answer exactly what the in-thread call
 * answers, and while either runs the main thread's event loop keeps turning.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function write(root: string, rel: string, body: string): Promise<void> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
}

/** The longest the event loop went without running a 5 ms interval while `work` ran. */
async function longestStall(work: () => Promise<unknown>): Promise<number> {
  let last = performance.now()
  let longest = 0
  const tick = setInterval(() => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }, 5)
  try {
    await work()
  } finally {
    clearInterval(tick)
  }
  return Math.max(longest, performance.now() - last)
}

/**
 * The fixture is heavy enough to freeze the loop in-thread; off it, the loop barely notices.
 * RELATIVE, not wall-clock: a busy machine (the full suite runs files in parallel) stretches both
 * runs, so the claim is "the worker run stalls far less than the same work in-thread".
 */
function expectOffThread(blocked: number, stalled: number): void {
  expect(blocked).toBeGreaterThan(100)
  expect(stalled).toBeLessThan(blocked / 3)
}

const png = (fill: string) => ({ mimeType: 'image/png', dataURL: `data:image/png;base64,${fill.repeat(1000)}` })
// What freezes a parse is many small objects, not one long string: ~20 MB of freedraw strokes
// takes V8 a few hundred ms, while 40 MB of base64 in one string takes ~20.
const stroke = (i: number) => ({ id: `e${i}`, type: 'freedraw', x: i, y: i, points: Array.from({ length: 20 }, (_, k) => [k, 2 * k]) })
const heavy = () =>
  JSON.stringify({ type: 'excalidraw', elements: [{ id: 'img', type: 'image', fileId: 'a' }, ...Array.from({ length: 100_000 }, (_, i) => stroke(i))], files: { a: png('A') } })
const legacy = () => JSON.stringify({ type: 'excalidraw', elements: [{ id: 'img', type: 'image', fileId: 'b' }], files: { b: png('B') } })

/** A vault heavy enough to freeze the loop in-thread: one 20 MB board of strokes, a nested legacy board, a corrupt one. */
async function heavyVault(root: string): Promise<void> {
  await write(root, 'Heavy.excalidraw', heavy())
  await write(root, 'Folder/Legacy.excalidraw', legacy())
  await write(root, 'Corrupt.excalidraw', '{ not json')
}

/** Every file under `root` with its text, to compare two shrunk copies. */
async function contents(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const rel of (await readdir(root, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.relative(root, path.join(e.parentPath, e.name)))) {
    out[rel] = await readFile(path.join(root, rel), 'utf8')
  }
  return out
}

describe('runOffThread (YAZ-1801 D8, 🔒 D11)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('stats: answers exactly what the in-thread walk answers, while the event loop keeps turning', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    await heavyVault(repo.root)
    await write(repo.root, 'assets/abc.png', 'png bytes')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-m', 'v1'])
    const worker = await bundleStorageWorker()

    let inThread: unknown
    const blocked = await longestStall(async () => (inThread = await vaultStorage(repo.root)))
    let offThread: unknown
    const stalled = await longestStall(async () => (offThread = await runOffThread(worker, { kind: 'stats', root: repo.root })))

    expect(offThread).toEqual(inThread)
    expectOffThread(blocked, stalled)
  })

  it('shrink: the same result and the same files as the direct call, skip list honoured, while the event loop keeps turning', async () => {
    const work = await mkdtemp(path.join(tmpdir(), 'draw-storage-job-'))
    cleanups.push(() => rm(work, { recursive: true, force: true }))
    const [direct, viaWorker] = [path.join(work, 'direct'), path.join(work, 'worker')]
    await heavyVault(direct)
    await heavyVault(viaWorker)
    const worker = await bundleStorageWorker()

    let inThread: unknown
    const blocked = await longestStall(async () => (inThread = await shrinkVault(direct, { skip: [path.join(direct, 'Folder', 'Legacy.excalidraw')] })))
    let offThread: unknown
    const stalled = await longestStall(async () => (offThread = await runOffThread(worker, { kind: 'shrink', root: viaWorker, skip: [path.join(viaWorker, 'Folder', 'Legacy.excalidraw')] })))

    expect(inThread).toMatchObject({ shrunk: 1, skipped: 2 })
    expect(offThread).toEqual(inThread)
    expect(await contents(viaWorker)).toEqual(await contents(direct))
    expectOffThread(blocked, stalled)
  })

  it('rejects, rather than hanging, when the worker cannot do the job', async () => {
    await expect(runOffThread(await bundleStorageWorker(), { kind: 'stats', root: path.join(tmpdir(), 'draw-storage-no-such-vault') })).rejects.toThrow()
  })
})
