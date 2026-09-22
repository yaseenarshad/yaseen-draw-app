import { watch, type FSWatcher } from 'chokidar'
import { existsSync, type Stats } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'

/**
 * ONE FOLDER, WATCHED — the shape every store in main uses (`library/mediaStore.ts`,
 * `library/componentStore.ts`, `vaultConfig.ts`), written once so the four rules below cannot
 * drift apart between them:
 *
 *  - CHOKIDAR OPTIONS. `ignoreInitial` (the caller reads on demand), `alwaysStat` (the echo test
 *    needs an mtime) and `awaitWriteFinish` at 200/50 ms, so a file another machine is still
 *    syncing is announced once it has settled rather than half-written.
 *  - RE-ANCHORING. A watcher attached while its folder did not exist loses the path for good under
 *    polling, so the FIRST write that creates the folder re-adds it (`noteOwnWrite` does this).
 *  - ECHO SUPPRESSION. A write this process made is announced to subscribers synchronously by the
 *    store itself; its watcher echo is dropped by mtime (`null` = an unlink this process caused).
 *  - DEBOUNCE. 50 ms, because one save touches two or three files and the subscriber only wants
 *    to know that something changed.
 */

const NOTIFY_DEBOUNCE_MS = 50

export interface WatchedFolder {
  /** Note a write this process just made, so its echo is dropped; `null` mtime = a delete. */
  noteOwnWrite(file: string, mtime: number | null): void
  /** Point at another folder; the old one goes quiet and every own-write note is dropped. */
  setFolder(next: string): void
  close(): Promise<void>
}

export interface WatchedFolderOptions {
  dir: string
  /** 0 = the folder's own files; 1 = one level of subfolders too; omitted = chokidar's default,
   *  which is what a folder that does not exist YET needs in order to notice it appearing. */
  depth?: number
  /** Log prefix, e.g. `media` — the only thing that differs between the stores' warnings. */
  tag: string
  /** Which paths are worth announcing; everything else (tmp files above all) is silence. */
  relevant(path: string, dir: string): boolean
  /** Called, debounced, after a change this process did not make. */
  onChange(paths: readonly string[]): void
  /** Paths to (re-)add once chokidar is ready — a subfolder that appeared during its init. */
  alsoWatch?(dir: string): readonly string[]
}

export function createWatchedFolder(opts: WatchedFolderOptions): WatchedFolder {
  let dir = opts.dir
  let watcher: FSWatcher
  let ownWrites = new Map<string, number | null>()
  let anchored = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = new Set<string>()

  function start(): FSWatcher {
    anchored = existsSync(dir)
    ownWrites = new Map()
    const watched = dir
    const w = watch(watched, { depth: opts.depth, ignoreInitial: true, alwaysStat: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    const schedule = (p: string, stats?: Stats) => {
      if (!opts.relevant(p, watched)) return
      const own = ownWrites.get(p)
      if (own !== undefined && (stats === undefined ? own === null : own === stats.mtimeMs)) {
        ownWrites.delete(p)
        return // the echo of this process's own write or delete
      }
      pending.add(p)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const paths = [...pending]
        pending = new Set()
        opts.onChange(paths)
      }, NOTIFY_DEBOUNCE_MS)
    }
    w.on('add', schedule)
      .on('change', schedule)
      .on('unlink', (p) => schedule(p))
      .on('error', (err) => console.warn(`[${opts.tag}] watcher error under ${watched}: ${String(err)}`))
    const also = opts.alsoWatch?.(watched)
    if (also !== undefined && also.length > 0) w.on('ready', () => void w.add([...also]))
    return w
  }

  const stopTimer = (): void => {
    if (timer !== null) clearTimeout(timer)
    timer = null
    pending = new Set()
  }

  watcher = start()

  return {
    noteOwnWrite(file, mtime) {
      // An entry is consumed by the echo it predicts; an echo that never arrives (a watcher that
      // missed it) would otherwise keep its note for the session. Clearing the lot at a generous
      // ceiling costs at most one spurious "something changed", which is a re-list.
      if (ownWrites.size > 256) ownWrites.clear()
      ownWrites.set(file, mtime)
      if (!anchored) {
        watcher.add(dir)
        anchored = true
      }
    },
    setFolder(next) {
      if (next === dir) return
      void watcher.close()
      stopTimer()
      dir = next
      watcher = start()
    },
    close() {
      stopTimer()
      return watcher.close()
    },
  }
}

/**
 * READ A JSON FILE, OR MOVE IT ASIDE — `store.ts`'s posture, shared by every store that owns one
 * (`media.json`, `components.json`, `secrets.json`). A missing file is `null`; a file that is not
 * what it claims to be is renamed `<file>.corrupt-<epoch>` and read as absent, because a bad file
 * must cost a rename, never a launch. A rename that itself fails is logged and the read still
 * answers absent — the app carries on either way.
 */
export async function readOrQuarantine<T>(file: string, parse: (raw: unknown) => T | null, tag: string, what: string): Promise<T | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let value: T | null = null
  try {
    value = parse(JSON.parse(raw))
  } catch {
    value = null
  }
  if (value !== null) return value
  const backup = `${file}.corrupt-${Date.now()}`
  await rename(file, backup).then(
    () => console.error(`[${tag}] ${file} is not ${what}; moved to ${backup}`),
    (err: unknown) => console.error(`[${tag}] ${file} is not ${what} and could not be moved aside: ${String(err)}`),
  )
  return null
}

/**
 * A serialising queue: `run(fn)` starts only once every earlier `fn` has settled, so two
 * read-modify-writes of one file can never interleave and lose each other. A rejection is the
 * caller's; the chain itself carries on.
 */
export function createChain(): { run<T>(fn: () => Promise<T>): Promise<T>; wait<T>(fn: () => Promise<T>): Promise<T> } {
  let chain: Promise<unknown> = Promise.resolve()
  const run = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn)
    chain = next.catch(() => undefined)
    return next
  }
  /** Queue behind the writes without joining them — a read that must see the last write. */
  return { run, wait: (fn) => chain.then(fn) }
}
