import { readdir } from 'node:fs/promises'
import path from 'node:path'
import type { IndexRecord, IndexResponse, WatchEvent } from '@shared/types'
import { fsCall, isMarkdown, isSkipped } from '../fs/fsUtils'
import { subscribe } from '../fs/watchers'
import { loadIndexCache, schedulePersist } from './cache'
import { reconcile, type ColdStartDiff } from './reconcile'
import { scanFile } from './scan'

interface Entry {
  records: Map<string, IndexRecord>
  unsubscribe: () => void
  idle?: NodeJS.Timeout
  /** Live scans the watcher has started but not finished — `getIndex` drains these before it answers (YAZ-986). */
  inFlight: Set<Promise<unknown>>
  /** What the cold-start reconcile found (GRO-2223); dropped with the entry on idle eviction. */
  coldDiff?: ColdStartDiff
}

const DEFAULT_IDLE_MS = 10 * 60 * 1000

/** One live index per root, kept fresh by the shared watcher; dropped after `idleMs` without a `getIndex`. */
const entries = new Map<string, Entry>()
/** First-call scans in flight, so concurrent callers share one walk. */
const pending = new Map<string, Promise<Entry>>()
let idleMs = DEFAULT_IDLE_MS

/** Markdown files under `dir`, skipping dot-entries / node_modules; unreadable subdirs are skipped like `buildTree`. */
async function walk(dir: string, out: string[]): Promise<void> {
  const dirents = await readdir(dir, { withFileTypes: true })
  await Promise.all(
    dirents.map(async (e) => {
      if (isSkipped(e.name)) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, out).catch(() => undefined)
      else if (e.isFile() && isMarkdown(e.name)) out.push(full)
    }),
  )
}

function onEvent(root: string, entry: Entry, ev: WatchEvent): void {
  switch (ev.type) {
    case 'add':
    case 'change': {
      if (!isMarkdown(ev.path)) return
      const scan = scanFile(root, ev.path)
        .then(
          (record) => entry.records.set(ev.path, record),
          () => entry.records.delete(ev.path),
        )
        .finally(() => {
          entry.inFlight.delete(scan)
          schedulePersist(root, entry.records)
        })
      entry.inFlight.add(scan)
      return
    }
    case 'unlink':
      entry.records.delete(ev.path)
      schedulePersist(root, entry.records)
      return
    case 'unlinkDir': {
      const prefix = ev.path + path.sep
      for (const p of entry.records.keys()) if (p.startsWith(prefix)) entry.records.delete(p)
      schedulePersist(root, entry.records)
      return
    }
    default:
      return
  }
}

// TOMBSTONE (⚡ YAZ-815, ruled by Yasin): `readTypes(root)` stood here — a per-`getIndex` read of
// `.obsidian/types.json`, whose assignments rode `IndexResponse.types` to a typing rung nothing
// ever fed. A foreign app's file is not our schema: `.yaseendocs/properties.json` is the vault's
// own, and this index no longer reads anything out of `.obsidian` at all. (It was never cached
// either — the payload is `{version, root, records}` — so there is nothing to invalidate and no
// CACHE_VERSION bump here.)

async function build(root: string): Promise<Entry> {
  const entry: Entry = { records: new Map(), unsubscribe: () => undefined, inFlight: new Set() }
  const files: string[] = []
  // Persistent cache (GRO-2223): loaded BEFORE subscribing, overlapped with the walk — the cache
  // lives in userData, never the vault, so the watcher ordering below does not apply to it, and
  // reading it early keeps the multi-MB read ahead of the chokidar initial scan that floods the
  // fs threadpool on subscribe.
  const [cached] = await Promise.all([loadIndexCache(root), fsCall(root, () => walk(root, files))])
  // A corrupt cache is an anomaly worth one line (vaultConfig idiom); `miss` and
  // `version-mismatch` are expected states (first open / semantics bump) and stay silent.
  if (cached.status === 'corrupt') console.warn(`[index-cache] cache for ${root} is corrupt; ignoring it and rescanning`)
  // Subscribe before reading so a write that lands mid-scan is re-scanned rather than lost.
  entry.unsubscribe = subscribe(root, (ev) => onEvent(root, entry, ev))
  try {
    // Reuse records the D2 stat sweep validates, rescan the rest. Any cache failure comes back
    // as a non-hit load and reconcile degrades to today's full scan.
    const { records, diff } = await reconcile(root, files, cached)
    entry.records = records
    entry.coldDiff = diff
  } catch (err) {
    entry.unsubscribe()
    throw err
  }
  entries.set(root, entry)
  schedulePersist(root, entry.records)
  return entry
}

function evict(root: string): void {
  const entry = entries.get(root)
  if (entry === undefined) return
  clearTimeout(entry.idle)
  // Flush-ish: one last persist so an evicted index leaves a fresh cache behind (GRO-2223).
  schedulePersist(root, entry.records)
  entry.unsubscribe()
  entries.delete(root)
}

function touch(root: string, entry: Entry): void {
  clearTimeout(entry.idle)
  entry.idle = setTimeout(() => evict(root), idleMs)
  entry.idle.unref()
}

/**
 * Index of every markdown note under `root` (GRO-2128). The first call walks the tree and
 * subscribes to the root's watcher; later calls return the live map (sorted by path) with a
 * fresh `generatedAt`. Transport-agnostic: no HTTP here — the Desktop bridge calls this directly.
 */
export async function getIndex(root: string): Promise<IndexResponse> {
  let entry = entries.get(root)
  if (entry === undefined) {
    let scan = pending.get(root)
    if (scan === undefined) {
      scan = build(root).finally(() => pending.delete(root))
      pending.set(root, scan)
    }
    entry = await scan
  }
  touch(root, entry)
  // Drain scans the watcher has already started: a create that beat this call is in this snapshot,
  // never invisible until the next fs event (YAZ-986) — the live twin of awaiting the first build.
  if (entry.inFlight.size > 0) await Promise.all([...entry.inFlight])
  const records = [...entry.records.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { root, records, generatedAt: Date.now() }
}

/**
 * The cold-start reconcile diff for `root` (GRO-2223) — the E1c rename-detection consumer
 * (GRO-2242) reads it after the first `getIndex`. Undefined before the first build and again
 * once idle eviction drops the entry. Trust `added`/`removed`/`changed` only when
 * `cacheStatus === 'hit'`: on any other status there was no before-snapshot and they are empty.
 */
export function getColdStartDiff(root: string): ColdStartDiff | undefined {
  return entries.get(root)?.coldDiff
}

/** Test hook: drops every cached index and its watcher subscription. */
export function _evictAll(): void {
  for (const root of [...entries.keys()]) evict(root)
}

/** Test hook: idle period before an unused index is evicted (omit to restore the 10-minute default). */
export function _setIdleMs(ms: number = DEFAULT_IDLE_MS): void {
  idleMs = ms
}
