/**
 * THE MEDIA CACHE ON DISK (🔒 YAZ-1775 D4, YAZ-1818): `<userData>/media-cache/`, one flat folder of JSON
 * files named by the hash of their key. `cachePolicy.ts` decides every name and every deadline;
 * this file only reads, writes and deletes.
 *
 * A CACHE MAY NEVER FAIL A REQUEST. Every method here swallows its own errors: a read that throws
 * is a miss, a write that throws is a search that simply was not stored. The folder can be
 * read-only, full, or deleted under us mid-session and the Image Studio keeps working over the
 * network — which is the whole point of it being a cache and not a store.
 *
 * BOUNDED BY A SWEEP, NOT BY A COUNT. `sweep()` runs once at startup, detached, and trashes
 * nothing it did not write: only `*.json` older than 24 h, which is exactly the set a read would
 * have refused anyway. So the folder's size follows what the user actually searched for in the
 * last day, and a machine that never opens the studio again ends up with an empty folder rather
 * than a growing one.
 *
 * Electron-free: the folder and the clock come in as arguments.
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWrite } from '../fs/fsUtils'
import { cacheFileName, isFresh, planCacheSweep } from './cachePolicy'

export interface MediaCache {
  /** The stored value under `key`, or null when it is absent, stale or unreadable. */
  read<T>(key: string): Promise<T | null>
  /** Store `value` under `key`. Never throws; a cache that cannot write is still a working cache. */
  write(key: string, value: unknown): Promise<void>
  /** Delete every entry past its 24 h — the startup bound. Answers how many went. */
  sweep(): Promise<number>
}

export interface MediaCacheOptions {
  /** Injected in tests so "yesterday" does not need a real yesterday. */
  now?: () => number
}

export function createMediaCache(folder: string, { now = Date.now }: MediaCacheOptions = {}): MediaCache {
  const fileFor = (key: string) => join(folder, cacheFileName(key))

  return {
    async read<T>(key: string): Promise<T | null> {
      const file = fileFor(key)
      try {
        const info = await stat(file)
        if (!isFresh(info.mtimeMs, now())) return null
        return JSON.parse(await readFile(file, 'utf8')) as T
      } catch {
        // Absent, unreadable or not JSON any more — all of them are a miss.
        return null
      }
    },

    async write(key, value) {
      // `mkdir` is the caller's (`createMediaProviders` makes the folder once); a write into a
      // folder that has since gone is a miss on the next read, which is exactly right.
      await atomicWrite(fileFor(key), JSON.stringify(value)).catch(() => undefined)
    },

    async sweep() {
      const names = await readdir(folder).catch(() => [] as string[])
      const entries = await Promise.all(
        names.map(async (name) => {
          const info = await stat(join(folder, name)).catch(() => null)
          return info === null || !info.isFile() ? null : { name, mtimeMs: info.mtimeMs }
        }),
      )
      const doomed = planCacheSweep(entries.filter((entry): entry is { name: string; mtimeMs: number } => entry !== null), now())
      let swept = 0
      for (const name of doomed) {
        if (await rm(join(folder, name), { force: true }).then(() => true, () => false)) swept++
      }
      return swept
    },
  }
}
