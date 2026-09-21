import { statSync, type Stats } from 'node:fs'
import type { ColdStartDiffResponse, DiffFileStat, IndexRecord } from '@shared/types'
import type { IndexCacheLoad } from './cache'
import { scanFile } from './scan'

/**
 * Cold-start reconcile (GRO-2229): validates a loaded cache against the walked files and turns
 * it into the live record map. A cached record is reused only when a fresh stat matches its
 * path + mtime + size (D2) — everything else is scanned from disk — so wrong/stale/corrupt cache
 * can never produce wrong data; a non-hit load is exactly today's full rescan.
 */

export const SCAN_CONCURRENCY = 32

/** Scans `files` with at most SCAN_CONCURRENCY reads in flight; files that fail to scan are left out. */
export async function scanAll(root: string, files: string[]): Promise<Map<string, IndexRecord>> {
  const records = new Map<string, IndexRecord>()
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      const record = await scanFile(root, file).catch(() => null)
      if (record !== null) records.set(file, record)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, worker))
  return records
}

type FileStat = DiffFileStat

/**
 * What changed between the persisted cache and the disk at cold start — the E1c rename-detection
 * input (GRO-2242: the `removed` × `added` (size, mtime) join is the rename signal, which is why
 * `removed` carries the CACHED stats and `added` the ON-DISK ones).
 *
 * Miss semantics: on any `cacheStatus` other than `'hit'` there is no before-snapshot to diff
 * against, so `added`/`removed`/`changed` are EMPTY (never "everything added") and `cacheStatus`
 * says why — consumers MUST check `cacheStatus === 'hit'` before trusting the three lists.
 *
 * The shape IS the E1c bridge payload (`fs:cold-diff` ships it verbatim), so the ONE definition
 * lives in shared/types.ts as `ColdStartDiffResponse`; this alias keeps the main-side name.
 */
export type ColdStartDiff = ColdStartDiffResponse

const byPath = (a: FileStat, b: FileStat): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

/**
 * Builds the record map for `files` (the fresh walk of `root`) from `cached` where the stat
 * matches, from disk where it doesn't. Non-hit → plain `scanAll`. Per-file stat/scan errors drop
 * that file silently, matching `scanAll`'s semantics. Changed files double-stat (`scanFile` stats
 * again) — accepted (GRO-2227); misses go straight to `scanFile`, whose own stat is the one look.
 */
export async function reconcile(
  root: string,
  files: string[],
  cached: IndexCacheLoad,
): Promise<{ records: Map<string, IndexRecord>; diff: ColdStartDiff }> {
  if (cached.records === null) {
    const records = await scanAll(root, files)
    return { records, diff: { root, scannedAt: Date.now(), cacheStatus: cached.status, added: [], removed: [], changed: [] } }
  }
  const cachedRecords = cached.records
  const records = new Map<string, IndexRecord>()
  const added: FileStat[] = []
  const changed: string[] = []
  // The validation stats run as a SYNC loop, not through the async 32-cap worker pool: build()
  // subscribes the (fresh) chokidar watcher just before reconciling, and its initial scan floods
  // the 4-thread libuv pool — async stats queue FIFO behind it and drain at the watcher's pace
  // (~660 ms at 10k notes vs ~27 ms sync, GRO-2229 bench). statSync bypasses the pool entirely;
  // the one-time ~27 ms loop block at vault open matches the main process's existing sync fs use
  // (store load, link routing). A null entry is a failed stat (→ that file drops, like scanAll).
  // If the residual ~25 ms warm-band gap ever matters, the recorded levers are a
  // UV_THREADPOOL_SIZE bump or a sync walk (GRO-2223 evidence comment) — deliberately not done.
  const stats = new Map<string, Stats | null>()
  for (const file of files) {
    if (!cachedRecords.has(file)) continue
    try {
      stats.set(file, statSync(file))
    } catch {
      stats.set(file, null)
    }
  }
  let next = 0
  const worker = async () => {
    while (next < files.length) {
      const file = files[next++]
      const hit = cachedRecords.get(file)
      if (hit === undefined) {
        const record = await scanFile(root, file).catch(() => null)
        if (record === null) continue
        records.set(file, record)
        added.push({ path: file, size: record.size, mtime: record.mtime })
        continue
      }
      const st = stats.get(file)
      if (st === null || st === undefined) continue
      if (st.mtimeMs === hit.mtime && st.size === hit.size) {
        records.set(file, hit)
        continue
      }
      const record = await scanFile(root, file).catch(() => null)
      if (record === null) continue
      records.set(file, record)
      changed.push(file)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, files.length) }, worker))
  const walked = new Set(files)
  const removed: FileStat[] = []
  for (const [p, r] of cachedRecords) if (!walked.has(p)) removed.push({ path: p, size: r.size, mtime: r.mtime })
  added.sort(byPath)
  removed.sort(byPath)
  changed.sort()
  return { records, diff: { root, scannedAt: Date.now(), cacheStatus: 'hit', added, removed, changed } }
}
