import { watch, type FSWatcher } from 'chokidar'
import { existsSync, type Stats } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { VAULT_CONFIG_DIR, type VaultConfigChange } from '@shared/types'
import { atomicWrite, BridgeFailure, fsCall, requireAbsPath, toBridgeFailure } from './fs/fsUtils'

/**
 * Vault-local config store (Desktop J, GRO-2188): JSON files in `<root>/.yaseendraw/`, the
 * `.obsidian/`-style dotfolder that travels with the vault. Electron-free, like `store.ts`.
 *
 * Lazy: reading never creates anything; the dotfolder appears on the first `writeConfig`
 * (`mkdir -p` + the `atomicWrite` tmp+rename idiom, pretty-printed JSON).
 *
 * Watching: the shared vault watcher (`fs/watchers.ts`) ignores every dot-entry by design, so
 * this module runs its own chokidar per root, scoped to the dotfolder path. Chokidar tracks a
 * not-yet-existing path (verified for v4, FSEvents and polling), so the watcher is attached at
 * first subscribe whether or not the folder exists — it creates nothing, and an external
 * `mkdir .yaseendraw` + write by a sync tool is still picked up live. One caveat (verified): a
 * polling watcher loses the path for good when the folder appears DURING its initialisation, so
 * the first `writeConfig` that creates the folder re-`add()`s it once — the debounce absorbs the
 * duplicate events FSEvents emits after a re-add. Same lifecycle idioms as `fs/watchers.ts`:
 * one watcher per root, shared listener set, closed on the last unsubscribe.
 *
 * Echo policy: `writeConfig` notifies this process's subscribers synchronously (so every window
 * of the vault hears about a write from any of them), and the watcher's later echo of that same
 * write is dropped by mtime — the app's standard echo-suppression pattern (docs/CONTRACTS.md,
 * "Bridge API"). A genuinely external edit has a different mtime and notifies as usual,
 * debounced/deduped to one `{ root, name }` per file.
 */

/**
 * Re-exported, not re-declared (YAZ-861): the name lives in `@shared/types` so main and the
 * client's adoption probe can never drift. This module owns the dotfolder, so it keeps naming it.
 */
export { VAULT_CONFIG_DIR }

const NOTIFY_DEBOUNCE_MS = 50

type Listener = (change: VaultConfigChange) => void

interface Entry {
  watcher: FSWatcher
  listeners: Set<Listener>
  /** name → mtime of this process's last write, so the watcher echo of an own write is dropped. */
  ownMtimes: Map<string, number>
  /** Names with a watcher event waiting for the debounce flush. */
  pending: Set<string>
  timer: ReturnType<typeof setTimeout> | null
  /** True once the dotfolder existed when the watcher (re-)anchored to it; see the init-race caveat above. */
  anchored: boolean
}

/** One chokidar per root's dotfolder, shared by every subscriber; closed when the last one leaves. */
const entries = new Map<string, Entry>()

export function activeConfigWatcherRoots(): string[] {
  return [...entries.keys()]
}

/** A config name is a plain `<stem>.json` basename: no separators, no `..`, nothing else. */
function requireConfigName(name: unknown): string {
  if (name === undefined || name === '') throw new BridgeFailure('BAD_REQUEST', "missing 'name'")
  if (typeof name !== 'string' || name.includes('/') || name.includes('\\') || name.includes('..') || name.includes('\0')) {
    throw new BridgeFailure('BAD_REQUEST', "'name' must be a plain file name", { path: String(name) })
  }
  if (!name.endsWith('.json') || name === '.json') {
    throw new BridgeFailure('UNSUPPORTED_EXTENSION', 'only .json files live in .yaseendraw', { path: name })
  }
  return name
}

export type ConfigRead = { state: 'absent' } | { state: 'ok'; value: unknown } | { state: 'malformed'; error: string; file: string }

/**
 * Like `readConfig`, but distinguishes a missing file from malformed JSON and leaves the
 * reporting to the caller — the corrupt-file semantics layered on top need the difference
 * (absent → an empty result, malformed → error surfaced, mutations refused).
 * NEVER creates the folder.
 */
export async function readConfigDetailed(root: string, name: string): Promise<ConfigRead> {
  const dir = requireAbsPath(root, 'root')
  const file = path.join(dir, VAULT_CONFIG_DIR, requireConfigName(name))
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { state: 'absent' }
    throw toBridgeFailure(err, file)
  }
  try {
    return { state: 'ok', value: JSON.parse(raw) as unknown }
  } catch (err) {
    return { state: 'malformed', error: String(err), file }
  }
}

/** Parsed `<root>/.yaseendraw/<name>`, or null when missing or malformed. NEVER creates the folder. */
export async function readConfig(root: string, name: string): Promise<unknown> {
  const res = await readConfigDetailed(root, name)
  if (res.state === 'ok') return res.value
  // Malformed config (half-synced file, hand edit) must not throw across IPC: warn once, act as absent.
  if (res.state === 'malformed') console.warn(`[vaultConfig] ${res.file} is not valid JSON: ${res.error}`)
  return null
}

/** `mkdir -p` the dotfolder lazily, then an atomic pretty-printed write; own subscribers notified synchronously. */
export async function writeConfig(root: string, name: string, value: unknown): Promise<void> {
  const r = requireAbsPath(root, 'root')
  const n = requireConfigName(name)
  const content: string | undefined = JSON.stringify(value, null, 2)
  if (content === undefined) throw new BridgeFailure('BAD_REQUEST', "'value' must be JSON-serialisable")
  const dir = path.join(r, VAULT_CONFIG_DIR)
  const file = path.join(dir, n)
  const { mtime } = await fsCall(file, async () => {
    await mkdir(dir, { recursive: true })
    return atomicWrite(file, `${content}\n`)
  })
  const entry = entries.get(r)
  if (entry !== undefined) {
    entry.ownMtimes.set(n, mtime)
    if (!entry.anchored) {
      // The watcher attached while the folder was still missing; this write created it, possibly
      // during the watcher's initialisation (where polling loses the path for good). Re-anchor once.
      entry.watcher.add(dir)
      entry.anchored = true
    }
    entry.listeners.forEach((l) => l({ root: r, name: n }))
  }
}

function createEntry(root: string): Entry {
  const dir = path.join(root, VAULT_CONFIG_DIR)
  const watcher = watch(dir, {
    ignoreInitial: true,
    alwaysStat: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
  })
  const entry: Entry = { watcher, listeners: new Set(), ownMtimes: new Map(), pending: new Set(), timer: null, anchored: existsSync(dir) }
  const schedule = (p: string, stats?: Stats) => {
    // Only config files directly in the dotfolder count — atomicWrite tmp files and subdirs don't.
    if (path.dirname(p) !== dir || !p.endsWith('.json')) return
    const name = path.basename(p)
    if (stats !== undefined && stats.mtimeMs === entry.ownMtimes.get(name)) return // echo of an own write
    entry.pending.add(name)
    if (entry.timer !== null) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      entry.timer = null
      const names = [...entry.pending]
      entry.pending.clear()
      for (const n of names) entry.listeners.forEach((l) => l({ root, name: n }))
    }, NOTIFY_DEBOUNCE_MS)
  }
  watcher
    .on('add', (p, stats) => schedule(p, stats))
    .on('change', (p, stats) => schedule(p, stats))
    .on('unlink', (p) => schedule(p))
    .on('error', (err) => console.warn(`[vaultConfig] watcher error under ${dir}: ${String(err)}`))
  return entry
}

/** Subscribes to config changes under `root`; returns an unsubscribe fn. Attaching creates nothing on disk. */
export function subscribeConfig(root: string, listener: Listener): () => void {
  const r = requireAbsPath(root, 'root')
  let entry = entries.get(r)
  if (entry === undefined) {
    entry = createEntry(r)
    entries.set(r, entry)
  }
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && entries.get(r) === entry) {
      entries.delete(r)
      if (entry.timer !== null) clearTimeout(entry.timer)
      void entry.watcher.close()
    }
  }
}
