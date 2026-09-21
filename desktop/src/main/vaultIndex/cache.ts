import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { IndexCacheStatus, IndexRecord } from '@shared/types'
import { atomicWrite } from '../fs/fsUtils'

/**
 * Persistent vault-index cache (GRO-2223 D1-D4, write side GRO-2228, load side GRO-2229):
 * one JSON per vault under an app-storage dir (never the vault), so a relaunch can skip the
 * cold full scan. Electron-free like `store.ts` — `main/index.ts` injects the dir
 * (`userData/index-cache`) via `initIndexCache`; without it every function is inert.
 *
 * THE INVARIANT: the cache is only an accelerator. Loading NEVER throws — a missing, corrupt,
 * wrong-version or wrong-root file degrades to `{ records: null, status }`, which the caller
 * (`reconcile`) treats as "do today's full rescan". A cached record is only ever trusted after
 * its path + mtime + size match a fresh stat (D2), so a stale cache cannot produce wrong data.
 */

/**
 * RULE (GRO-2230): any change to `IndexRecord`'s shape or to the scanner's extraction semantics
 * MUST bump this constant — an old snapshot must never be read as if it had the new semantics.
 * Discard IS the migration: a version mismatch degrades to one full rescan, never a converter.
 * The fingerprint pin in `cache.test.ts` fails on such changes until the bump lands here.
 */
export const CACHE_VERSION = 3
/** Trailing debounce per root; bursts (a big paste, a sync tool landing) coalesce into one write. */
const PERSIST_DEBOUNCE_MS = 5000
/**
 * GC (GRO-2230): cache files for vaults never reopened would otherwise accumulate forever, so
 * `initIndexCache` sweeps the dir once — ANY file (cache JSONs and crashed `.tmp-` leftovers
 * alike) whose mtime is older than this is deleted. Generous on purpose: every vault open
 * refreshes its file's mtime (build success schedules a persist), so only truly abandoned entries
 * age out, and a wrongly deleted cache is self-healing — it costs exactly one full rescan.
 * Deliberately minimal: no size caps, no LRU, no eviction policy of its own.
 */
const GC_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000

// The status vocabulary is part of the E1c bridge contract (`ColdStartDiffResponse.cacheStatus`,
// GRO-2242), so the ONE definition lives in shared/types.ts; re-exported here for main-side use.
export type { IndexCacheStatus } from '@shared/types'

export interface IndexCacheLoad {
  /** Non-null exactly when `status` is `'hit'`. */
  records: Map<string, IndexRecord> | null
  status: IndexCacheStatus
}

let cacheDir: string | null = null
let debounceMs = PERSIST_DEBOUNCE_MS
/** Roots with a debounce timer running; `records` is the LIVE map, serialised at write time. */
const pending = new Map<string, { timer: NodeJS.Timeout; records: Map<string, IndexRecord> }>()
/** Per-root write chains so two atomic writes for one root can never land out of order. */
const chains = new Map<string, Promise<void>>()

/** In-flight init GC sweep; `_gcDone()` exposes it to tests. */
let gcSweep: Promise<void> = Promise.resolve()

/**
 * Remembers the cache dir (created lazily on first write) and kicks the GC sweep (fire-and-forget;
 * see GC_MAX_AGE_MS). Call once at startup, before any persist.
 */
export function initIndexCache(dir: string): void {
  cacheDir = dir
  gcSweep = gc(dir)
}

/** Deletes every cache-dir file older than GC_MAX_AGE_MS. Never throws: a missing dir is a fresh install, a per-file race is a no-op. */
async function gc(dir: string): Promise<void> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const cutoff = Date.now() - GC_MAX_AGE_MS
  await Promise.all(
    names.map(async (name) => {
      const file = path.join(dir, name)
      try {
        if ((await stat(file)).mtimeMs < cutoff) await unlink(file)
      } catch {
        // stat/unlink raced or failed — a leftover file is exactly what the next sweep is for
      }
    }),
  )
}

function cacheFile(dir: string, root: string): string {
  return path.join(dir, `${createHash('sha256').update(root).digest('hex').slice(0, 16)}.json`)
}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const isFinite_ = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * Full structural check of one cached record — the D2 validation key (path/mtime/size) plus every
 * field the renderer consumes, so a hand-mangled but parseable file can never smuggle a partial
 * record into the index (the invariant again). One bad element marks the whole file corrupt.
 */
function isCachedRecord(v: unknown): v is IndexRecord {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const r = v as Record<string, unknown>
  return (
    typeof r.path === 'string' &&
    typeof r.name === 'string' &&
    typeof r.basename === 'string' &&
    typeof r.folder === 'string' &&
    typeof r.ext === 'string' &&
    isFinite_(r.size) &&
    isFinite_(r.ctime) &&
    isFinite_(r.mtime) &&
    typeof r.properties === 'object' &&
    r.properties !== null &&
    !Array.isArray(r.properties) &&
    (r.frontmatterError === undefined || typeof r.frontmatterError === 'string') &&
    isStringArray(r.aliases) &&
    isStringArray(r.tags) &&
    isStringArray(r.links) &&
    isStringArray(r.embeds)
  )
}

/**
 * Loads the persisted records for `root`. NEVER throws: any failure is a status —
 * `miss` (no dir/file, or the file holds another root's payload — a hash-prefix collision or a
 * copied cache dir is simply not this vault's cache), `corrupt` (unparsable / wrong shape /
 * a malformed record), `version-mismatch` (a numeric `version` ≠ CACHE_VERSION).
 *
 * Forensics (GRO-2230, deliberate contrast with `store.ts`, which moves a corrupt state file
 * aside as `.corrupt-<epoch>` before defaulting): a corrupt cache file is ignored IN PLACE and
 * simply overwritten by the next persist. The cache is derived data — the vault it was scanned
 * from is the source of truth — so a corrupt copy holds nothing worth preserving, and moving it
 * aside would only accumulate junk files the GC would then have to know about.
 */
export async function loadIndexCache(root: string): Promise<IndexCacheLoad> {
  if (cacheDir === null) return { records: null, status: 'miss' }
  let raw: string
  try {
    raw = await readFile(cacheFile(cacheDir, root), 'utf8')
  } catch {
    return { records: null, status: 'miss' }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { records: null, status: 'corrupt' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { records: null, status: 'corrupt' }
  const doc = parsed as { version?: unknown; root?: unknown; records?: unknown }
  if (!isFinite_(doc.version)) return { records: null, status: 'corrupt' }
  if (doc.version !== CACHE_VERSION) return { records: null, status: 'version-mismatch' }
  if (doc.root !== root) return { records: null, status: 'miss' }
  if (!Array.isArray(doc.records)) return { records: null, status: 'corrupt' }
  const records = new Map<string, IndexRecord>()
  for (const r of doc.records) {
    if (!isCachedRecord(r)) return { records: null, status: 'corrupt' }
    records.set(r.path, r)
  }
  return { records, status: 'hit' }
}

/**
 * True when `v` cannot round-trip through JSON: a non-finite number (YAML `.inf`/`.nan`) or a
 * self-referential alias cycle (`a: &x\n  b: *x` — the yaml parser builds a genuinely cyclic
 * object, which `JSON.stringify` throws on) anywhere inside it. `stack` is the ancestor chain,
 * so shared-but-acyclic aliases are NOT flagged — stringify just duplicates those.
 */
function cannotRoundTrip(v: unknown, stack = new Set<object>()): boolean {
  if (typeof v === 'number') return !Number.isFinite(v)
  if (typeof v !== 'object' || v === null) return false
  if (stack.has(v)) return true
  stack.add(v)
  const bad = (Array.isArray(v) ? v : Object.values(v)).some((x) => cannotRoundTrip(x, stack))
  stack.delete(v)
  return bad
}

/** Serialises + atomically writes `records` for `root` NOW, appended to the root's write chain. Errors log, never throw. */
function write(root: string, records: Map<string, IndexRecord>): Promise<void> {
  const dir = cacheDir
  if (dir === null) return Promise.resolve()
  const chain = (chains.get(root) ?? Promise.resolve())
    .then(async () => {
      // Serialise inside the chain: the map is live, so the freshest state wins. Records whose
      // frontmatter cannot round-trip through JSON (non-finite numbers, alias cycles) are left
      // out — they just rescan on the next start; the rest of the vault still caches.
      const body = JSON.stringify({ version: CACHE_VERSION, root, records: [...records.values()].filter((r) => !cannotRoundTrip(r.properties)) })
      await mkdir(dir, { recursive: true })
      await atomicWrite(cacheFile(dir, root), body)
    })
    .catch((err: unknown) => console.error(`[index-cache] failed to write cache for ${root}: ${String(err)}`))
  chains.set(root, chain)
  return chain
}

/**
 * Schedules a debounced (~5 s per root) persist of `records` — the live index map calls this from the
 * watcher-incremental mutations, build success and eviction. Bursts coalesce (trailing edge, the
 * latest map ref wins); the timer is unref'd, so `flushIndexCache` (quit) is what guarantees the
 * last write lands. No-op until `initIndexCache` ran.
 */
export function schedulePersist(root: string, records: Map<string, IndexRecord>): void {
  if (cacheDir === null) return
  const prev = pending.get(root)
  if (prev !== undefined) clearTimeout(prev.timer)
  const timer = setTimeout(() => {
    pending.delete(root)
    void write(root, records)
  }, debounceMs)
  timer.unref()
  pending.set(root, { timer, records })
}

/** Writes every pending root now and waits for all in-flight writes — the quit path, next to `store.flush()`. */
export async function flushIndexCache(): Promise<void> {
  for (const [root, p] of [...pending.entries()]) {
    clearTimeout(p.timer)
    pending.delete(root)
    void write(root, p.records)
  }
  await Promise.all([...chains.values()])
}

/** Test hook: drops the injected dir and every pending timer (pending writes are discarded, not flushed). */
export function _resetIndexCache(): void {
  for (const p of pending.values()) clearTimeout(p.timer)
  pending.clear()
  chains.clear()
  cacheDir = null
  gcSweep = Promise.resolve()
}

/** Test hook: resolves when the `initIndexCache` GC sweep has finished. */
export function _gcDone(): Promise<void> {
  return gcSweep
}

/** Test hook: the per-root persist debounce (omit to restore the 5 s default). */
export function _setPersistDebounceMs(ms: number = PERSIST_DEBOUNCE_MS): void {
  debounceMs = ms
}
