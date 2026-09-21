import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IndexRecord } from '@shared/types'
import type { IndexCacheLoad } from './cache'
import { reconcile, scanAll } from './reconcile'

/** Writes `file` and pins its mtime to a whole-ms value so utimes round trips exactly. */
async function writePinned(file: string, content: string, mtimeMs: number): Promise<void> {
  await writeFile(file, content)
  await utimes(file, new Date(mtimeMs), new Date(mtimeMs))
}

const hit = (records: Map<string, IndexRecord>): IndexCacheLoad => ({ records, status: 'hit' })

const T0 = 1_700_000_000_000

describe('reconcile', () => {
  let root: string
  let a: string
  let b: string
  let c: string
  let files: string[]
  let cached: Map<string, IndexRecord>

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'mdapp-reconcile-'))
    a = path.join(root, 'a.md')
    b = path.join(root, 'sub', 'b.md')
    c = path.join(root, 'c.md')
    await mkdir(path.join(root, 'sub'))
    await writePinned(a, '---\nstatus: idea\n---\n\n# A\n#tag [[B]]\n', T0)
    await writePinned(b, '# B\nplain body\n', T0 + 1000)
    await writePinned(c, '# C\nSee [[a]].\n', T0 + 2000)
    files = [a, b, c]
    cached = await scanAll(root, files)
  })
  afterEach(() => rm(root, { recursive: true, force: true }))

  it('cache hit with nothing on disk changed: every record is reused by identity, diff is empty', async () => {
    const { records, diff } = await reconcile(root, files, hit(cached))
    expect(records.size).toBe(3)
    for (const f of files) expect(records.get(f)).toBe(cached.get(f))
    expect(diff).toEqual({ root, scannedAt: diff.scannedAt, cacheStatus: 'hit', added: [], removed: [], changed: [] })
    expect(diff.scannedAt).toBeGreaterThan(0)
  })

  it('an mtime bump re-scans that file into `changed`', async () => {
    await utimes(a, new Date(T0 + 5000), new Date(T0 + 5000))
    const { records, diff } = await reconcile(root, files, hit(cached))
    expect(diff.changed).toEqual([a])
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(records.get(a)).not.toBe(cached.get(a))
    expect(records.get(a)).toEqual({ ...cached.get(a), ctime: records.get(a)!.ctime, mtime: T0 + 5000 })
    expect(records.get(b)).toBe(cached.get(b))
  })

  it('a size-only difference (the rsync case: content replaced, mtime restored) is still `changed`', async () => {
    await writePinned(b, '# B\nplain body, now longer than before\n#fresh\n', T0 + 1000) // same mtime as the cached record
    expect((await stat(b)).mtimeMs).toBe(cached.get(b)!.mtime)
    const { records, diff } = await reconcile(root, files, hit(cached))
    expect(diff.changed).toEqual([b])
    expect(records.get(b)?.tags).toEqual(['fresh'])
  })

  it('on-disk-not-in-cache is scanned into `added` with its current stats', async () => {
    const d = path.join(root, 'd.md')
    await writePinned(d, '# D\n#new\n', T0 + 9000)
    const st = await stat(d)
    const { records, diff } = await reconcile(root, [...files, d], hit(cached))
    expect(diff.added).toEqual([{ path: d, size: st.size, mtime: st.mtimeMs }])
    expect(diff.changed).toEqual([])
    expect(records.get(d)?.tags).toEqual(['new'])
  })

  it('in-cache-not-on-disk lands in `removed` carrying the CACHED stats', async () => {
    await rm(b)
    const { records, diff } = await reconcile(
      root,
      files.filter((f) => f !== b),
      hit(cached),
    )
    expect(diff.removed).toEqual([{ path: b, size: cached.get(b)!.size, mtime: cached.get(b)!.mtime }])
    expect(records.has(b)).toBe(false)
    expect(records.size).toBe(2)
  })

  it('miss / corrupt / version-mismatch fall back to the full scan; the diff arrays are EMPTY and cacheStatus says why', async () => {
    for (const status of ['miss', 'corrupt', 'version-mismatch'] as const) {
      const { records, diff } = await reconcile(root, files, { records: null, status })
      expect(records).toEqual(cached)
      expect(diff).toEqual({ root, scannedAt: diff.scannedAt, cacheStatus: status, added: [], removed: [], changed: [] })
    }
  })

  it('per-file stat/scan errors drop the file silently (matches scanAll)', async () => {
    const ghost = path.join(root, 'ghost.md') // walked but gone by scan time, never cached
    const ghostCached = path.join(root, 'ghost-cached.md') // walked AND cached, gone by stat time
    const cachedGhost = { ...cached.get(a)!, path: ghostCached }
    const withGhost = new Map(cached)
    withGhost.set(ghostCached, cachedGhost)
    const { records, diff } = await reconcile(root, [...files, ghost, ghostCached], hit(withGhost))
    expect(records.size).toBe(3)
    expect(diff.added).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.removed).toEqual([]) // both ghosts were walked, so neither is "in-cache-not-on-disk"
  })
})
