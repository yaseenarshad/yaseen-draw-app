import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { subscribe } from '../fs/watchers'
import { makeViewsFixture } from '../fs/viewsFixture'
import { _resetIndexCache, flushIndexCache, initIndexCache, loadIndexCache } from './cache'
import { _evictAll, getColdStartDiff, getIndex } from './live'
import { scanFile } from './scan'

// Passthrough spy: behaviour identical, calls countable — proves the warm start reads no files.
vi.mock('./scan', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./scan')>()
  return { ...mod, scanFile: vi.fn(mod.scanFile) }
})

const until = async (pred: () => Promise<boolean> | boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!(await pred())) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/**
 * Resolves once the root's chokidar watcher has finished its initial scan.
 *
 * REQUIRED before any test writes a file expecting the WATCHER to notice it, whenever an
 * `_evictAll()` has closed and reopened that watcher: the watcher runs `ignoreInitial: true`, so a
 * file created while the fresh initial scan is still walking is swallowed as "initial" and no
 * `add` is ever emitted — `live.ts` ignores `ready` itself, so nothing recovers it and the wait
 * below would burn its whole budget. (This dependency was always here; until ⚡ YAZ-815 deleted the
 * per-call `.obsidian/types.json` read, every `getIndex` above happened to pay an extra file read
 * and handed the scan enough slack by accident.) `subscribe` replays `ready` to late joiners, so
 * an already-warm watcher resolves this synchronously.
 */
const watcherReady = (root: string): Promise<void> =>
  new Promise((resolve) => {
    let off: (() => void) | null = null
    let fired = false
    off = subscribe(root, (ev) => {
      if (ev.type !== 'ready') return
      fired = true
      off?.()
      resolve()
    })
    if (fired) off() // `ready` replayed synchronously inside subscribe, before `off` was assigned
  })

describe('getIndex + persistent cache (GRO-2228/2229)', () => {
  let root: string
  let cleanup: () => Promise<void>
  let cacheDir: string
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    cacheDir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-int-'))
    initIndexCache(cacheDir)
  })
  afterAll(async () => {
    _evictAll()
    await flushIndexCache()
    _resetIndexCache()
    await cleanup()
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('cold build with no cache: full scan, coldDiff is an honest miss, and the build schedules a persist', async () => {
    const res = await getIndex(root)
    expect(res.records).toHaveLength(8)
    expect(getColdStartDiff(root)).toEqual({
      root,
      scannedAt: getColdStartDiff(root)!.scannedAt,
      cacheStatus: 'miss',
      added: [],
      removed: [],
      changed: [],
    })
    await flushIndexCache() // the build-success schedulePersist is what made this root pending
    const load = await loadIndexCache(root)
    expect(load.status).toBe('hit')
    expect(load.records!.size).toBe(8)
  })

  it('warm build reuses the cached records without a single scanFile call; coldDiff is an empty hit', async () => {
    const cold = await getIndex(root)
    _evictAll()
    vi.mocked(scanFile).mockClear()
    const warm = await getIndex(root)
    expect(scanFile).not.toHaveBeenCalled()
    expect(warm.records).toEqual(cold.records)
    expect(getColdStartDiff(root)).toMatchObject({ cacheStatus: 'hit', added: [], removed: [], changed: [] })
  })

  it('changes made while evicted show up in the records AND the coldDiff; only they are re-scanned', async () => {
    await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const changedFile = path.join(root, 'VSL-v1.md')
    const addedFile = path.join(root, 'While Evicted.md')
    await writeFile(changedFile, '---\nstatus: reworked\n---\n\nRewritten while nothing watched.\n')
    await writeFile(addedFile, '# New\n#while-evicted\n')
    vi.mocked(scanFile).mockClear()
    const res = await getIndex(root)
    expect(res.records).toHaveLength(9)
    expect(res.records.find((r) => r.path === changedFile)?.properties).toEqual({ status: 'reworked' })
    expect(res.records.find((r) => r.path === addedFile)?.tags).toEqual(['while-evicted'])
    expect(vi.mocked(scanFile).mock.calls.map((c) => c[1]).sort()).toEqual([changedFile, addedFile].sort())
    const diff = getColdStartDiff(root)!
    expect(diff.cacheStatus).toBe('hit')
    expect(diff.changed).toEqual([changedFile])
    expect(diff.added.map((a) => a.path)).toEqual([addedFile])
    expect(diff.removed).toEqual([])
  })

  it('a file deleted while evicted lands in coldDiff.removed with its CACHED stats', async () => {
    await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const victim = path.join(root, 'While Evicted.md')
    const cachedVictim = (await loadIndexCache(root)).records!.get(victim)!
    await rm(victim)
    await getIndex(root)
    expect(getColdStartDiff(root)!.removed).toEqual([{ path: victim, size: cachedVictim.size, mtime: cachedVictim.mtime }])
    expect((await getIndex(root)).records).toHaveLength(8)
  })

  it('watcher mutations schedule persists: after a flush the cache file reflects them', async () => {
    await getIndex(root)
    await watcherReady(root) // the test above evicted, so this watcher may still be scanning
    const live = path.join(root, 'Live Note.md')
    await writeFile(live, '# Live\n')
    await until(async () => (await getIndex(root)).records.some((r) => r.path === live))
    await flushIndexCache()
    expect((await loadIndexCache(root)).records!.has(live)).toBe(true)
    await rm(live)
    await until(async () => !(await getIndex(root)).records.some((r) => r.path === live))
    await flushIndexCache()
    expect((await loadIndexCache(root)).records!.has(live)).toBe(false)
  })

  it('evict drops the coldDiff and schedules one last persist', async () => {
    await getIndex(root)
    expect(getColdStartDiff(root)).toBeDefined()
    _evictAll()
    expect(getColdStartDiff(root)).toBeUndefined()
    await flushIndexCache()
    expect((await loadIndexCache(root)).status).toBe('hit')
  })

  it('a corrupt cache file degrades to a full rescan with one console.warn; coldDiff says corrupt', async () => {
    const cold = await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const files = (await readdir(cacheDir)).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    await writeFile(path.join(cacheDir, files[0]), 'not json {{{')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      vi.mocked(scanFile).mockClear()
      const res = await getIndex(root)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(res.records).toEqual(cold.records) // the full rescan, same truth
      expect(scanFile).toHaveBeenCalledTimes(res.records.length) // every file re-read
      expect(getColdStartDiff(root)).toMatchObject({ cacheStatus: 'corrupt', added: [], removed: [], changed: [] })
    } finally {
      warn.mockRestore()
    }
  })
})

describe('stale-cache torture (GRO-2230): heavy offline mutation, cache-assisted == from-scratch', () => {
  let root: string
  let cleanup: () => Promise<void>
  let cacheDir: string
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    cacheDir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-torture-'))
    initIndexCache(cacheDir)
  })
  afterAll(async () => {
    _evictAll()
    _resetIndexCache()
    await cleanup()
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('adds/edits/deletes/renames + an rsync-style same-mtime write: the assisted result deep-equals a no-cache full scan', async () => {
    const T0 = 1_700_000_000_000
    const pillars = path.join(root, 'Content Pillars')
    const agentic = path.join(pillars, '1. Agentic Agency')
    const creator = path.join(pillars, '2. Creator Economy')
    const pinned = path.join(pillars, 'List of Topics.md') // the same-mtime-different-size victim
    const levels = path.join(agentic, 'The Levels of an Agency.md') // the same-size-different-mtime victim
    const vsl = path.join(root, 'VSL-v1.md')
    const agenticOld = path.join(agentic, 'Agentic Agency.md')
    const agenticNew = path.join(agentic, 'Agentic Agency v2.md')
    const creatorOld = path.join(creator, 'Creator Economy.md')
    const creatorNew = path.join(root, 'Creator Economy Moved.md') // cross-directory rename
    const gold = path.join(creator, 'The Gold In Your Archive.md')
    const born = path.join(root, 'Born Offline.md')
    const fresh = path.join(pillars, '5. New Pillar', 'Fresh.md')
    await utimes(pinned, new Date(T0), new Date(T0)) // whole-ms mtime so the restore below round-trips exactly

    // Cold build writes the cache, then evict: from here the vault mutates with nothing watching.
    await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const cached = (await loadIndexCache(root)).records!
    expect(cached.get(pinned)!.mtime).toBe(T0)

    await writeFile(vsl, '---\nstatus: archived\ntags: [torture]\n---\n\nRewritten offline, much longer than it ever was before.\n')
    await rm(gold)
    await rename(agenticOld, agenticNew)
    await rename(creatorOld, creatorNew)
    await writeFile(born, '# New\n#offline [[VSL-v1]]\n')
    await mkdir(path.join(pillars, '5. New Pillar'))
    await writeFile(fresh, '---\npillar: New\n---\n\nFresh note in a folder born offline.\n')
    // Same size, new content (mtime is the only tell):
    const levelsBase = '# Levels rewritten offline\n\n#same-size\n'
    await writeFile(levels, levelsBase + '.'.repeat(cached.get(levels)!.size - levelsBase.length))
    expect((await stat(levels)).size).toBe(cached.get(levels)!.size)
    // Same mtime, new content (size is the only tell — the rsync/mtime-restore case):
    await writeFile(pinned, 'Pillars #pillars\n\n* [[Agentic Agency v2]]\n* [[Creator Economy Moved]]\n* [[Born Offline]]\n')
    await utimes(pinned, new Date(T0), new Date(T0))
    expect((await stat(pinned)).mtimeMs).toBe(T0)
    expect((await stat(pinned)).size).not.toBe(cached.get(pinned)!.size)

    // Cache-assisted rebuild: a warm hit that must nonetheless see every mutation.
    vi.mocked(scanFile).mockClear()
    const assisted = await getIndex(root)
    const diff = getColdStartDiff(root)!
    expect(diff.cacheStatus).toBe('hit')
    expect(diff.changed).toEqual([levels, pinned, vsl].sort())
    expect(diff.added.map((a) => a.path)).toEqual([agenticNew, creatorNew, born, fresh].sort())
    expect(diff.removed.map((r) => r.path)).toEqual([agenticOld, creatorOld, gold].sort())
    // The GRO-2242 rename signal: the moved file's on-disk (size, mtime) matches the cached stats of the file that vanished.
    const rem = diff.removed.find((r) => r.path === agenticOld)!
    const add = diff.added.find((a) => a.path === agenticNew)!
    expect([add.size, add.mtime]).toEqual([rem.size, rem.mtime])
    // Only the mutated files were rescanned; the untouched ones rode the cache.
    expect(vi.mocked(scanFile).mock.calls.map((c) => c[1]).sort()).toEqual([levels, pinned, vsl, agenticNew, creatorNew, born, fresh].sort())

    // The truth: a from-scratch scan with the cache disabled entirely.
    _evictAll()
    _resetIndexCache() // cacheDir gone → loadIndexCache is a guaranteed miss → plain scanAll
    const scratch = await getIndex(root)
    expect(getColdStartDiff(root)!.cacheStatus).toBe('miss')
    expect(assisted.records).toHaveLength(9) // 8 originals − 1 deleted − 2 rename sources + 2 rename targets + 2 adds
    expect(assisted.records).toEqual(scratch.records)
  })
})

/**
 * The payload the cache actually persists. Stood as "types.json is never cached (GRO-2230)" until
 * ⚡ YAZ-815 deleted the `.obsidian/types.json` chain outright — the exact-keys assertion is what
 * was load-bearing and it survives on its own: `{version, root, records}`, nothing else.
 */
describe('the persisted payload is version/root/records and nothing else', () => {
  let root: string
  let cleanup: () => Promise<void>
  let cacheDir: string
  beforeAll(async () => {
    ;({ root, cleanup } = await makeViewsFixture())
    cacheDir = await mkdtemp(path.join(tmpdir(), 'mdapp-index-cache-types-'))
    initIndexCache(cacheDir)
  })
  afterAll(async () => {
    _evictAll()
    _resetIndexCache()
    await cleanup()
    await rm(cacheDir, { recursive: true, force: true })
  })

  it('holds exactly those three keys, and reloads as a full warm hit', async () => {
    const first = await getIndex(root)
    _evictAll()
    await flushIndexCache()
    const files = (await readdir(cacheDir)).filter((f) => f.endsWith('.json'))
    expect(files).toHaveLength(1)
    const payload: unknown = JSON.parse(await readFile(path.join(cacheDir, files[0]), 'utf8'))
    expect(Object.keys(payload as object).sort()).toEqual(['records', 'root', 'version'])

    vi.mocked(scanFile).mockClear()
    const warm = await getIndex(root)
    expect(scanFile).not.toHaveBeenCalled() // every record reused: a full warm hit…
    expect(getColdStartDiff(root)).toMatchObject({ cacheStatus: 'hit', added: [], removed: [], changed: [] }) // …with zero invalidation
    expect(warm.records).toEqual(first.records)
  })
})
