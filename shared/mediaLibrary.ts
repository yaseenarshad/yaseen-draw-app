/**
 * The media library's RULES (🔒 YAZ-1775 D4 / D5, YAZ-1817): what a valid item is, and what add / remove /
 * record do to the two lists in `<library>/media.json`. Pure and Electron-free — the main-process
 * store around it (`desktop/src/main/library/mediaStore.ts`) only reads, writes and watches the
 * file, so every rule here is unit-tested with no disk.
 *
 * The item validator is the web app's `convex/mediaTypes.ts` verbatim: an item is whole or it is
 * not one at all (a wrong-typed optional REJECTS rather than being dropped — a half-read item
 * would show a broken tile). The FILE is lenient around that: a bad row is dropped, the rest
 * survive, so one hand-edit cannot cost the user 499 favorites. Both lists are newest-first,
 * de-duplicated by `itemKey`, and capped on the tail — the same order the web app's
 * `by_ownerId_and_updatedAt` index answered in.
 */
import { MAX_MEDIA_FAVORITES, RECENT_LIMIT, isMediaItemKind, isMediaProvider, type MediaItem, type MediaLibraryFile, type StoredMediaItem } from './types'
import { isFiniteNumber, isRecord } from './guards'

export const EMPTY_MEDIA_LIBRARY: MediaLibraryFile = { version: 1, favorites: [], recent: [] }


/** The optional fields and their one type each — `mediaItemValidator`'s `v.optional(...)` rows. */
const OPTIONAL_STRINGS = ['previewUrl', 'creator', 'creatorUrl', 'collectionName', 'sourceUrl', 'licenseName', 'licenseUrl', 'attribution'] as const
const OPTIONAL_NUMBERS = ['width', 'height'] as const

/** `mediaItemValidator`, field for field: null unless every present field is right; unknown fields drop. */
export function normalizeMediaItem(v: unknown): MediaItem | null {
  if (!isRecord(v)) return null
  const { itemKey, provider, providerId, kind, title } = v
  if (typeof itemKey !== 'string' || itemKey === '' || typeof providerId !== 'string' || providerId === '') return null
  if (!isMediaProvider(provider) || !isMediaItemKind(kind) || typeof title !== 'string') return null
  const out: MediaItem = { itemKey, provider, providerId, kind, title }
  for (const k of OPTIONAL_STRINGS) {
    if (v[k] === undefined) continue
    if (typeof v[k] !== 'string') return null
    out[k] = v[k]
  }
  for (const k of OPTIONAL_NUMBERS) {
    if (v[k] === undefined) continue
    if (!isFiniteNumber(v[k])) return null
    out[k] = v[k]
  }
  if (v.trademarkNotice !== undefined) {
    if (typeof v.trademarkNotice !== 'boolean') return null
    out.trademarkNotice = v.trademarkNotice
  }
  return out
}

/** The stored row: an item plus the finite `updatedAt` the lists are ordered by. */
export function normalizeStoredMediaItem(v: unknown): StoredMediaItem | null {
  const item = normalizeMediaItem(v)
  if (item === null || !isRecord(v) || !isFiniteNumber(v.updatedAt)) return null
  return { ...item, updatedAt: v.updatedAt }
}

/** How an incoming item gets its stamp: main's clock, never the renderer's. */
export const stamp = (item: MediaItem, now: number): StoredMediaItem => ({ ...item, updatedAt: now })

/** Newest-first, one row per `itemKey` (the first wins), no longer than `cap`. */
function cleanList(raw: unknown, cap: number): StoredMediaItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: StoredMediaItem[] = []
  for (const row of raw) {
    const item = normalizeStoredMediaItem(row)
    if (item === null || seen.has(item.itemKey)) continue
    seen.add(item.itemKey)
    out.push(item)
    if (out.length === cap) break
  }
  return out
}

/** Null when the document is not a version-1 library at all (→ corrupt, moved aside); otherwise every readable row. */
export function sanitizeMediaLibrary(raw: unknown): MediaLibraryFile | null {
  if (!isRecord(raw) || raw.version !== 1) return null
  return { version: 1, favorites: cleanList(raw.favorites, MAX_MEDIA_FAVORITES), recent: cleanList(raw.recent, RECENT_LIMIT) }
}

/** The web app's `addFavorite`: a new key goes to the head, an existing one changes nothing. */
export function addFavorite(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  if (lib.favorites.some((f) => f.itemKey === item.itemKey)) return lib
  return { ...lib, favorites: [stamp(item, now), ...lib.favorites].slice(0, MAX_MEDIA_FAVORITES) }
}

export function removeFavorite(lib: MediaLibraryFile, itemKey: string): MediaLibraryFile {
  if (!lib.favorites.some((f) => f.itemKey === itemKey)) return lib
  return { ...lib, favorites: lib.favorites.filter((f) => f.itemKey !== itemKey) }
}

/** The web app's `recordRecent`: an MRU — the item as it arrives NOW moves to the head, re-stamped. */
export function recordRecent(lib: MediaLibraryFile, item: MediaItem, now: number): MediaLibraryFile {
  return { ...lib, recent: [stamp(item, now), ...lib.recent.filter((r) => r.itemKey !== item.itemKey)].slice(0, RECENT_LIMIT) }
}
