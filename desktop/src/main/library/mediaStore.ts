/**
 * THE LIBRARY'S MEDIA STORE (🔒 D5, YAZ-1817): `<library>/media.json`, the one file every vault's
 * windows share for media favorites and the recent MRU. The rules live in `@shared/mediaLibrary`;
 * this module is the disk half — read lazily, write atomically, watch for the other writers.
 *
 * Lazy: a read never creates anything; the file appears on the first mutation (`mkdir -p` the
 * folder, since a chosen path may have been unplugged, then the `atomicWrite` tmp+rename idiom).
 * A file that is not a version-1 library at all is moved aside as `media.json.corrupt-<epoch>`
 * and read as empty — the `store.ts` posture: a bad file costs a rename, never a launch.
 *
 * Mutations serialise on one promise chain: two windows favoriting in the same tick are two
 * read-modify-writes, and interleaving them would lose one. A mutation that changes nothing
 * (favoriting a favorite) does not write.
 *
 * Watching: one chokidar on the library FOLDER, depth 0, filtered to the file's own name — so
 * 3C's `components/` and an `atomicWrite` tmp file never notify. An own write notifies this
 * process's subscribers synchronously (every window, whichever vault, hears it — that is the
 * whole point of D5) and its watcher echo is dropped by mtime, the app's standard echo
 * suppression (`vaultConfig.ts`). A write by the OTHER machine, through a synced vault, has a
 * different mtime and notifies as usual. `setFolder` re-points everything when
 * `settings.libraryFolder` changes.
 */
import { watch, type FSWatcher } from 'chokidar'
import { existsSync, type Stats } from 'node:fs'
import { mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_LIBRARY_FILE, type MediaFavoritesRequest, type MediaLibraryFile, type MediaRecentRequest, type StoredMediaItem } from '@shared/types'
import { EMPTY_MEDIA_LIBRARY, addFavorite, recordRecent, removeFavorite, sanitizeMediaLibrary } from '@shared/mediaLibrary'
import { atomicWrite, fsCall } from '../fs/fsUtils'

const NOTIFY_DEBOUNCE_MS = 50

export interface MediaStore {
  /** Every verb answers the favorites list it produced. */
  favorites(req: MediaFavoritesRequest): Promise<StoredMediaItem[]>
  /** Every verb answers the MRU it produced. */
  recent(req: MediaRecentRequest): Promise<StoredMediaItem[]>
  /** Point at another library folder (the setting changed); the old one goes quiet. */
  setFolder(folder: string): void
  /** Fires after any change to `media.json` — an own write or an external one. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
  close(): Promise<void>
}

export function createMediaStore(initialFolder: string, deps: { now?: () => number } = {}): MediaStore {
  const now = deps.now ?? Date.now
  const listeners = new Set<() => void>()
  let folder = initialFolder
  let watcher: FSWatcher
  /** mtime of this process's last write, so the watcher echo of it is dropped. */
  let ownMtime: number | null = null
  /** True once the folder existed when the watcher anchored to it (polling loses a path that appears mid-init). */
  let anchored = false
  let timer: ReturnType<typeof setTimeout> | null = null
  /** Mutations chain so two read-modify-writes never interleave. */
  let chain: Promise<unknown> = Promise.resolve()

  const file = (): string => path.join(folder, MEDIA_LIBRARY_FILE)
  const notify = (): void => listeners.forEach((l) => l())

  async function read(): Promise<MediaLibraryFile> {
    const p = file()
    let raw: string
    try {
      raw = await readFile(p, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_MEDIA_LIBRARY
      throw err
    }
    let lib: MediaLibraryFile | null = null
    try {
      lib = sanitizeMediaLibrary(JSON.parse(raw))
    } catch {
      lib = null
    }
    if (lib !== null) return lib
    const backup = `${p}.corrupt-${Date.now()}`
    await rename(p, backup).then(
      () => console.error(`[media] ${p} is not a valid media library; moved to ${backup} and using an empty one`),
      (err: unknown) => console.error(`[media] ${p} is not a valid media library and could not be moved aside: ${String(err)}`),
    )
    return EMPTY_MEDIA_LIBRARY
  }

  async function write(lib: MediaLibraryFile): Promise<void> {
    const p = file()
    const { mtime } = await fsCall(p, async () => {
      await mkdir(folder, { recursive: true })
      return atomicWrite(p, `${JSON.stringify(lib, null, 2)}\n`)
    })
    ownMtime = mtime
    if (!anchored) {
      // The watcher attached while the folder was missing; this write made it. Re-anchor once.
      watcher.add(folder)
      anchored = true
    }
    notify()
  }

  /** One read-modify-write on the chain; writes only when `mutate` produced a different library. */
  function mutate(fn: (lib: MediaLibraryFile) => MediaLibraryFile): Promise<MediaLibraryFile> {
    const run = chain.then(async () => {
      const before = await read()
      const after = fn(before)
      if (after !== before) await write(after)
      return after
    })
    chain = run.catch(() => undefined)
    return run
  }

  function startWatching(): FSWatcher {
    const dir = folder
    anchored = existsSync(dir)
    ownMtime = null
    const w = watch(dir, { depth: 0, ignoreInitial: true, alwaysStat: true, awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } })
    const schedule = (p: string, stats?: Stats) => {
      if (p !== path.join(dir, MEDIA_LIBRARY_FILE)) return
      if (stats !== undefined && stats.mtimeMs === ownMtime) return // echo of an own write
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        notify()
      }, NOTIFY_DEBOUNCE_MS)
    }
    w.on('add', schedule)
      .on('change', schedule)
      .on('unlink', (p) => schedule(p))
      .on('error', (err) => console.warn(`[media] watcher error under ${dir}: ${String(err)}`))
    return w
  }

  watcher = startWatching()

  return {
    favorites(req) {
      const lib = req.op === 'list' ? chain.then(read) : mutate((l) => (req.op === 'add' ? addFavorite(l, req.item, now()) : removeFavorite(l, req.itemKey)))
      return lib.then((l) => l.favorites)
    },
    recent(req) {
      const lib = req.op === 'list' ? chain.then(read) : mutate((l) => recordRecent(l, req.item, now()))
      return lib.then((l) => l.recent)
    },
    setFolder(next) {
      if (next === folder) return
      void watcher.close()
      if (timer !== null) clearTimeout(timer)
      timer = null
      folder = next
      watcher = startWatching()
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      listeners.clear()
      return watcher.close()
    },
  }
}
