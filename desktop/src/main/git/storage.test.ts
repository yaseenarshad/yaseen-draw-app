import { mkdir, mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundleStorageWorker, makeGitRepo, REAL_GIT_TIMEOUT_MS } from './gitFixture'
import { GITHUB_FILE_LIMIT_BYTES, GITHUB_FILE_WARN_BYTES } from '@shared/types'
import { vaultStorage, vaultStorageOffThread } from './storage'

/**
 * `vaultStorage` (YAZ-1801 D2) on temp vaults: the disk numbers exact, and the git numbers
 * checked for what they MEAN — history grows with every commit, the current snapshot does not
 * count what was overwritten, and a folder that is not a repo answers `git: null`.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function write(root: string, rel: string, body: string | Buffer): Promise<number> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return (await stat(file)).size
}

const board = (embedded: Record<string, string>) =>
  JSON.stringify({ type: 'excalidraw', elements: [], files: Object.fromEntries(Object.entries(embedded).map(([id, dataURL]) => [id, { mimeType: 'image/png', dataURL }])) })

/** Bytes that do not compress, so history numbers move by roughly their size. */
const noise = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(Math.random() * 256)))

describe('vaultStorage (YAZ-1801 D2)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('sums boards, the assets/ store and everything else; skips dot-folders; tolerates a corrupt board', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'draw-storage-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    const dataURL = `data:image/png;base64,${'A'.repeat(1000)}`
    const legacy = await write(root, 'Legacy.excalidraw', board({ a: dataURL, b: dataURL }))
    const lean = await write(root, 'Nested/Lean.excalidraw', board({}))
    const corrupt = await write(root, 'Corrupt.excalidraw', '{ not json')
    const pic = await write(root, 'assets/abc.png', 'png bytes')
    const theirs = await write(root, 'Nested/assets/mine.png', 'a user folder called assets is theirs')
    const video = await write(root, 'Big video.mov', 'mov')
    await write(root, '.yaseendraw/github.json', '{"enabled":true}')
    await write(root, '.hidden/Ghost.excalidraw', board({ g: dataURL }))

    const stats = await vaultStorage(root)

    expect(stats.boards).toEqual({ bytes: legacy + lean + corrupt, count: 3 })
    expect(stats.pictures).toEqual({ bytes: pic, count: 1 })
    expect(stats.other).toEqual({ bytes: theirs + video, count: 2 })
    expect(stats.embedded).toEqual({ bytes: 2 * dataURL.length, boards: 1 })
    expect(stats.git).toBeNull()
    expect(stats.large).toEqual([])
  })

  it('lists EVERY file at or over 50 MiB — board, picture, anything else — biggest first, and nothing under it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'draw-storage-'))
    cleanups.push(() => rm(root, { recursive: true, force: true }))
    // Sparse files: `truncate` sets the size without writing, so these cost nothing.
    const sized = async (rel: string, bytes: number) => {
      await write(root, rel, '')
      await truncate(path.join(root, rel), bytes)
    }
    await sized('Big video.mov', GITHUB_FILE_LIMIT_BYTES + 10)
    await sized('Folder/Too big.excalidraw', GITHUB_FILE_LIMIT_BYTES + 1)
    await sized('assets/huge.png', GITHUB_FILE_WARN_BYTES)
    await sized('Just under.excalidraw', GITHUB_FILE_WARN_BYTES - 1)

    const stats = await vaultStorage(root)

    expect(stats.large).toEqual([
      { path: 'Big video.mov', bytes: GITHUB_FILE_LIMIT_BYTES + 10 },
      { path: 'Folder/Too big.excalidraw', bytes: GITHUB_FILE_LIMIT_BYTES + 1 },
      { path: 'assets/huge.png', bytes: GITHUB_FILE_WARN_BYTES },
    ])
  })

  it('counts git history, the current snapshot, and the old versions in between', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    // Three versions of one board, ~40 KB of incompressible bytes each: history holds all three,
    // HEAD needs only the last.
    for (let v = 0; v < 3; v++) {
      await write(repo.root, 'Board.excalidraw', noise(40_000))
      await repo.run(['add', '-A'])
      await repo.run(['commit', '-m', `v${v}`])
    }

    const { git } = await vaultStorage(repo.root)

    expect(git).not.toBeNull()
    expect(git!.historyBytes).toBeGreaterThan(3 * 38_000)
    expect(git!.headBytes).toBeGreaterThan(38_000)
    expect(git!.headBytes).toBeLessThan(2 * 40_000)
    expect(git!.oldVersionsBytes).toBe(git!.historyBytes - git!.headBytes)
    expect(git!.oldVersionsBytes).toBeGreaterThan(2 * 38_000)
  })

  it('a repo with no commits yet has history but no snapshot', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    const { git } = await vaultStorage(repo.root)
    expect(git).toEqual({ historyBytes: 0, headBytes: 0, oldVersionsBytes: 0 })
  })
})

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

describe('vaultStorageOffThread (YAZ-1801 D8)', { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  it('answers exactly what the in-thread walk answers, while the event loop keeps turning', async () => {
    const repo = await makeGitRepo()
    cleanups.push(repo.cleanup)
    // What freezes a parse is many small objects, not one long string: ~20 MB of freedraw strokes
    // takes V8 a few hundred ms, while 40 MB of base64 in one string takes ~20.
    const stroke = (i: number) => ({ id: `e${i}`, type: 'freedraw', x: i, y: i, points: Array.from({ length: 20 }, (_, k) => [k, 2 * k]) })
    const heavy = JSON.parse(board({ a: `data:image/png;base64,${'A'.repeat(1000)}` })) as Record<string, unknown>
    await write(repo.root, 'Heavy.excalidraw', JSON.stringify({ ...heavy, elements: Array.from({ length: 100_000 }, (_, i) => stroke(i)) }))
    await write(repo.root, 'Folder/Legacy.excalidraw', board({ a: `data:image/png;base64,${'B'.repeat(5000)}` }))
    await write(repo.root, 'Corrupt.excalidraw', '{ not json')
    await write(repo.root, 'assets/abc.png', 'png bytes')
    await repo.run(['add', '-A'])
    await repo.run(['commit', '-m', 'v1'])
    const worker = await bundleStorageWorker()

    let inThread: unknown
    const blocked = await longestStall(async () => (inThread = await vaultStorage(repo.root)))
    let offThread: unknown
    const stalled = await longestStall(async () => (offThread = await vaultStorageOffThread(worker, repo.root)))

    expect(offThread).toEqual(inThread)
    // The fixture is heavy enough to freeze the loop in-thread; off it, the loop barely notices.
    expect(blocked).toBeGreaterThan(150)
    expect(stalled).toBeLessThan(60)
  })

  it('rejects, rather than hanging, when the worker cannot measure', async () => {
    await expect(vaultStorageOffThread(await bundleStorageWorker(), path.join(tmpdir(), 'draw-storage-no-such-vault'))).rejects.toThrow()
  })
})
