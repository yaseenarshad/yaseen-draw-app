/**
 * WHAT THE MEDIA CACHE KEEPS, UNDER WHAT NAME, AND FOR HOW LONG (🔒 YAZ-1775 D4, YAZ-1818). Policy
 * only — no disk, no clock — so every rule below is a unit test with nothing mocked.
 *
 * A KEY IS HASHED INTO THE FILENAME, because a key holds the user's query and that can be any text
 * at all; a sha-256 is a fixed, safe, flat name, and nothing needs to read a cache back by eye.
 *
 * FRESHNESS IS THE FILE'S OWN mtime — no sidecar timestamp to drift out of step with the bytes it
 * describes — which makes the 24 h read guard and the startup sweep the SAME rule.
 *
 * AN IMPORT IS NEVER CACHED: those bytes are on their way into `assets/`, which already
 * de-duplicates them (🔒 YAZ-1775 D3), so a second copy under a second naming scheme is pure cost.
 *
 * THE KEY-PRESENCE BIT IS PART OF THE SEARCH KEY: an Iconify-only answer must not be served to a
 * machine that has since had a Pixabay key added, or the Pixabay half would never appear.
 */
import { createHash } from 'node:crypto'
import type { MediaBytesProvider } from '@shared/types'
import { CACHE_SECONDS, SEARCH_CACHE_VERSION, type PixabayImageType } from './curation'

/** The cache's folder under userData. */
export const MEDIA_CACHE_DIR = 'media-cache'

/** 24 h, the Worker's `CACHE_SECONDS`, as milliseconds. */
export const CACHE_TTL_MS = CACHE_SECONDS * 1000

/** Every cache file is JSON; the extension is what the sweep recognises as ours. */
export const CACHE_FILE_EXT = '.json'

/** A key → the flat filename that holds it. */
export function cacheFileName(key: string): string {
  return `${createHash('sha256').update(key).digest('hex')}${CACHE_FILE_EXT}`
}

/**
 * The whole search answer's key. `_iscv` is the Worker's cache-version parameter under its own
 * name, so bumping `SEARCH_CACHE_VERSION` orphans every stored answer at once.
 */
export function searchCacheKey(query: string, source: string, cursor: string | null | undefined, pixabayAvailable: boolean): string {
  return `search?_iscv=${SEARCH_CACHE_VERSION}&q=${encodeURIComponent(query)}&source=${source}&pixabay=${pixabayAvailable ? '1' : '0'}&cursor=${encodeURIComponent(cursor ?? '')}`
}

/** One Pixabay result page — the Worker's `pixabay/search/<q>/<type>/<page>/<perPage>`. */
export function pixabayPageCacheKey(query: string, imageType: PixabayImageType, page: number, perPage: number): string {
  return `pixabay/search/${encodeURIComponent(query)}/${imageType}/${page}/${perPage}`
}

/** One Pixabay record by id — the Worker's `pixabay/item/<id>`. */
export function pixabayItemCacheKey(id: string): string {
  return `pixabay/item/${id}`
}

/** One tile's picture — the Worker's `image/<provider>/<id>/preview`. Imports have no key on purpose. */
export function previewCacheKey(provider: MediaBytesProvider, providerId: string): string {
  return `image/${provider}/${encodeURIComponent(providerId)}/preview`
}

/** Fresh = written less than 24 h ago. A file from the future (a clock change) counts as fresh. */
export function isFresh(mtimeMs: number, now: number): boolean {
  return now - mtimeMs < CACHE_TTL_MS
}

/**
 * The startup sweep's plan: every cache file older than 24 h, by name. Anything that is not a
 * `.json` of ours is left alone — the folder is the app's, but deleting what it does not
 * recognise is how a cache turns into a data-loss bug.
 */
export function planCacheSweep(entries: readonly { name: string; mtimeMs: number }[], now: number): string[] {
  return entries.filter((entry) => entry.name.endsWith(CACHE_FILE_EXT) && !isFresh(entry.mtimeMs, now)).map((entry) => entry.name)
}
