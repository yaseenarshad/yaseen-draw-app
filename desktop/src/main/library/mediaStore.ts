/**
 * THE LIBRARY'S MEDIA STORE (🔒 YAZ-1775 D5, YAZ-1817): `<library>/media.json`, the one file every
 * vault's windows share for media favorites and the recent MRU. The rules live in
 * `@shared/mediaLibrary`; this module is the disk half.
 *
 * Lazy: a read never creates anything; the file appears on the first mutation. A file that is not
 * a version-1 library is moved aside (`readOrQuarantine`) and read as empty.
 *
 * Mutations serialise on one chain: two windows favoriting in the same tick are two
 * read-modify-writes, and interleaving them would lose one. A mutation that changes nothing
 * (favoriting a favorite) does not write.
 *
 * Watching is `watchedFolder.ts`'s — depth 0, filtered to this file's own name, so `components/`
 * and an `atomicWrite` tmp file never notify. An own write notifies this process's subscribers
 * synchronously (every window, whichever vault, hears it — that is the whole point of D5) and its
 * watcher echo is dropped by mtime; a write by the OTHER machine, through a synced vault, has a
 * different mtime and notifies as usual.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { MEDIA_LIBRARY_FILE, type MediaFavoritesRequest, type MediaLibraryFile, type MediaRecentRequest, type StoredMediaItem } from '@shared/types'
import { EMPTY_MEDIA_LIBRARY, addFavorite, recordRecent, removeFavorite, sanitizeMediaLibrary } from '@shared/mediaLibrary'
import { atomicWrite, fsCall } from '../fs/fsUtils'
import { createChain, createWatchedFolder, readOrQuarantine } from '../watchedFolder'

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
  const chain = createChain()
  let folder = initialFolder

  const file = (): string => path.join(folder, MEDIA_LIBRARY_FILE)
  const notify = (): void => listeners.forEach((l) => l())

  const watched = createWatchedFolder({
    dir: initialFolder,
    depth: 0,
    tag: 'media',
    relevant: (p, dir) => p === path.join(dir, MEDIA_LIBRARY_FILE),
    onChange: notify,
  })

  const read = async (): Promise<MediaLibraryFile> =>
    (await readOrQuarantine(file(), sanitizeMediaLibrary, 'media', 'a valid media library')) ?? EMPTY_MEDIA_LIBRARY

  async function write(lib: MediaLibraryFile): Promise<void> {
    const p = file()
    const { mtime } = await fsCall(p, async () => {
      await mkdir(folder, { recursive: true })
      return atomicWrite(p, `${JSON.stringify(lib, null, 2)}\n`)
    })
    watched.noteOwnWrite(p, mtime)
    notify()
  }

  /** One read-modify-write on the chain; writes only when `mutate` produced a different library. */
  const mutate = (fn: (lib: MediaLibraryFile) => MediaLibraryFile): Promise<MediaLibraryFile> =>
    chain.run(async () => {
      const before = await read()
      const after = fn(before)
      if (after !== before) await write(after)
      return after
    })

  return {
    favorites(req) {
      const lib = req.op === 'list' ? chain.wait(read) : mutate((l) => (req.op === 'add' ? addFavorite(l, req.item, now()) : removeFavorite(l, req.itemKey)))
      return lib.then((l) => l.favorites)
    },
    recent(req) {
      const lib = req.op === 'list' ? chain.wait(read) : mutate((l) => recordRecent(l, req.item, now()))
      return lib.then((l) => l.recent)
    },
    setFolder(next) {
      if (next === folder) return
      folder = next
      watched.setFolder(next)
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    close() {
      listeners.clear()
      return watched.close()
    },
  }
}
