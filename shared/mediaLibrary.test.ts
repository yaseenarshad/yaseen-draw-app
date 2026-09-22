/**
 * The media library's RULES (🔒 D4 / D5, YAZ-1817), TDD'd with no Electron and no disk: what a
 * valid item is, and what add / remove / record do to the two lists. The main-process module
 * around this (`desktop/src/main/library/mediaStore.ts`) only reads, writes and watches the file.
 *
 * The validator semantics are the web app's `convex/mediaTypes.ts` verbatim: an item is whole or
 * it is not one at all. The FILE is lenient around that — a bad row is dropped, the rest survive.
 */
import { describe, expect, it } from 'vitest'
import { MAX_MEDIA_FAVORITES, RECENT_LIMIT, type MediaItem, type StoredMediaItem } from './types'
import { EMPTY_MEDIA_LIBRARY, addFavorite, normalizeMediaItem, normalizeStoredMediaItem, recordRecent, removeFavorite, sanitizeMediaLibrary, stamp } from './mediaLibrary'

/** The minimum a provider result has to carry: every required field of `mediaItemValidator`. */
const item = (over: Partial<MediaItem> = {}): MediaItem => ({ itemKey: 'pixabay:1', provider: 'pixabay', providerId: '1', kind: 'photo', title: 'A tree', ...over })
const stored = (over: Partial<StoredMediaItem> = {}): StoredMediaItem => ({ ...item(), updatedAt: 1000, ...over })

describe('normalizeMediaItem — the web app`s mediaItemValidator, field for field', () => {
  it('accepts the five required fields alone', () => {
    expect(normalizeMediaItem(item())).toEqual(item())
  })

  it('carries every optional field through when it is the right type', () => {
    const full = item({
      previewUrl: 'https://cdn/x.png',
      creator: 'Ada',
      creatorUrl: 'https://pixabay.com/users/ada',
      collectionName: 'Trees',
      sourceUrl: 'https://pixabay.com/photos/1',
      licenseName: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license',
      attribution: 'Ada on Pixabay',
      width: 640,
      height: 480,
      trademarkNotice: true,
    })
    expect(normalizeMediaItem(full)).toEqual(full)
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, undefined, 'x', 7, [], true]) expect(normalizeMediaItem(bad)).toBeNull()
  })

  it('rejects a missing or empty required field — an item with no identity is not an item', () => {
    expect(normalizeMediaItem({ ...item(), itemKey: undefined })).toBeNull()
    expect(normalizeMediaItem({ ...item(), itemKey: '' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), providerId: '' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), title: undefined })).toBeNull()
  })

  it('allows an EMPTY title — providers do serve untitled photos, and the tile falls back to the id', () => {
    expect(normalizeMediaItem({ ...item(), title: '' })?.title).toBe('')
  })

  it('rejects an unknown provider or kind, the way a union validator does', () => {
    expect(normalizeMediaItem({ ...item(), provider: 'unsplash' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), kind: 'video' })).toBeNull()
  })

  it('rejects a WRONG-TYPED optional rather than quietly dropping it — a half-read item is not one', () => {
    expect(normalizeMediaItem({ ...item(), creator: 7 })).toBeNull()
    expect(normalizeMediaItem({ ...item(), width: '640' })).toBeNull()
    expect(normalizeMediaItem({ ...item(), trademarkNotice: 'yes' })).toBeNull()
  })

  it('rejects a non-finite dimension — NaN and Infinity survive JSON.parse of a hand-edited file', () => {
    expect(normalizeMediaItem({ ...item(), width: Number.NaN })).toBeNull()
    expect(normalizeMediaItem({ ...item(), height: Number.POSITIVE_INFINITY })).toBeNull()
  })

  it('drops an unknown field instead of storing it — the file stays the shape both apps read', () => {
    expect(normalizeMediaItem({ ...item(), rogue: 'x', updatedAt: 5 })).toEqual(item())
  })

  it('an absent optional stays absent — it is never written as undefined or null', () => {
    const out = normalizeMediaItem(item())
    expect(out !== null && 'creator' in out).toBe(false)
  })
})

describe('normalizeStoredMediaItem — the same, plus the stamp the file orders by', () => {
  it('needs a finite updatedAt', () => {
    expect(normalizeStoredMediaItem(stored())).toEqual(stored())
    expect(normalizeStoredMediaItem(item())).toBeNull()
    expect(normalizeStoredMediaItem({ ...stored(), updatedAt: 'yesterday' })).toBeNull()
    expect(normalizeStoredMediaItem({ ...stored(), updatedAt: Number.NaN })).toBeNull()
  })

  it('stamp() is how an incoming item gets one — main`s clock, never the renderer`s', () => {
    expect(stamp(item(), 42)).toEqual({ ...item(), updatedAt: 42 })
  })
})

describe('sanitizeMediaLibrary — lenient over the rows, strict about the file', () => {
  it('reads a well-formed file back unchanged', () => {
    const file = { version: 1, favorites: [stored()], recent: [stored({ itemKey: 'iconify:a', provider: 'iconify', providerId: 'a', kind: 'icon' })] }
    expect(sanitizeMediaLibrary(file)).toEqual(file)
  })

  it('CORRUPT (null) for anything that is not a version-1 library — the caller moves it aside', () => {
    for (const bad of [null, 'x', 7, [], { version: 2, favorites: [], recent: [] }, { favorites: [], recent: [] }]) expect(sanitizeMediaLibrary(bad)).toBeNull()
  })

  it('a missing or non-array list reads as empty rather than corrupting the whole file', () => {
    expect(sanitizeMediaLibrary({ version: 1 })).toEqual(EMPTY_MEDIA_LIBRARY)
    expect(sanitizeMediaLibrary({ version: 1, favorites: 'nope', recent: null })).toEqual(EMPTY_MEDIA_LIBRARY)
  })

  it('drops the rows it cannot read and keeps the ones it can', () => {
    const good = stored()
    const out = sanitizeMediaLibrary({ version: 1, favorites: [good, { itemKey: 'x' }, null], recent: [] })
    expect(out?.favorites).toEqual([good])
  })

  it('de-duplicates by itemKey, keeping the FIRST (newest) row', () => {
    const out = sanitizeMediaLibrary({ version: 1, favorites: [stored({ updatedAt: 9 }), stored({ updatedAt: 1 })], recent: [] })
    expect(out?.favorites).toEqual([stored({ updatedAt: 9 })])
  })

  it('enforces both caps on READ too — a hand-edited file cannot grow the lists', () => {
    const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => stored({ itemKey: `${prefix}${i}`, providerId: String(i) }))
    const out = sanitizeMediaLibrary({ version: 1, favorites: many(MAX_MEDIA_FAVORITES + 5, 'f'), recent: many(RECENT_LIMIT + 5, 'r') })
    expect(out?.favorites).toHaveLength(MAX_MEDIA_FAVORITES)
    expect(out?.recent).toHaveLength(RECENT_LIMIT)
  })
})

describe('addFavorite (the web app`s addFavorite)', () => {
  it('puts a new favorite at the head, stamped with main`s clock', () => {
    const out = addFavorite(EMPTY_MEDIA_LIBRARY, item(), 500)
    expect(out.favorites).toEqual([stored({ updatedAt: 500 })])
    expect(out.recent).toEqual([])
  })

  it('an itemKey already favorited changes NOTHING — not the order, not the stamp', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored({ itemKey: 'b' }), stored({ itemKey: 'a', updatedAt: 1 })] }
    const after = addFavorite(before, item({ itemKey: 'a', title: 'renamed' }), 999)
    expect(after.favorites).toEqual(before.favorites)
  })

  it('drops the OLDEST once the list is full — the cap is on the tail', () => {
    const full = { ...EMPTY_MEDIA_LIBRARY, favorites: Array.from({ length: MAX_MEDIA_FAVORITES }, (_, i) => stored({ itemKey: `f${i}` })) }
    const out = addFavorite(full, item({ itemKey: 'new' }), 500)
    expect(out.favorites).toHaveLength(MAX_MEDIA_FAVORITES)
    expect(out.favorites[0].itemKey).toBe('new')
    expect(out.favorites.at(-1)?.itemKey).toBe(`f${MAX_MEDIA_FAVORITES - 2}`)
  })

  it('never touches the input', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored()] }
    const snapshot = structuredClone(before)
    addFavorite(before, item({ itemKey: 'other' }), 1)
    expect(before).toEqual(snapshot)
  })
})

describe('removeFavorite', () => {
  it('drops the one itemKey and leaves everything else in order', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored({ itemKey: 'a' }), stored({ itemKey: 'b' }), stored({ itemKey: 'c' })] }
    expect(removeFavorite(before, 'b').favorites.map((f) => f.itemKey)).toEqual(['a', 'c'])
  })

  it('an itemKey that is not there is a no-op, not an error', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, favorites: [stored()] }
    expect(removeFavorite(before, 'nope')).toEqual(before)
  })

  it('never touches recent — the two lists are independent (unfavoriting does not forget a use)', () => {
    const before = { version: 1 as const, favorites: [stored({ itemKey: 'a' })], recent: [stored({ itemKey: 'a' })] }
    expect(removeFavorite(before, 'a').recent).toEqual(before.recent)
  })
})

describe('recordRecent (the web app`s recordRecent) — an MRU, not a log', () => {
  it('puts a first use at the head', () => {
    expect(recordRecent(EMPTY_MEDIA_LIBRARY, item(), 700).recent).toEqual([stored({ updatedAt: 700 })])
  })

  it('a use of something already there MOVES it to the head and re-stamps it, never duplicates', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: [stored({ itemKey: 'b' }), stored({ itemKey: 'a', updatedAt: 1 })] }
    const after = recordRecent(before, item({ itemKey: 'a', title: 'A tree' }), 900)
    expect(after.recent.map((r) => r.itemKey)).toEqual(['a', 'b'])
    expect(after.recent[0].updatedAt).toBe(900)
  })

  it('re-records the item as it arrives NOW — a title or licence that changed is refreshed', () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: [stored({ itemKey: 'a', title: 'old' })] }
    expect(recordRecent(before, item({ itemKey: 'a', title: 'new' }), 5).recent[0].title).toBe('new')
  })

  it(`keeps exactly RECENT_LIMIT (${RECENT_LIMIT}), dropping the least recent`, () => {
    const before = { ...EMPTY_MEDIA_LIBRARY, recent: Array.from({ length: RECENT_LIMIT }, (_, i) => stored({ itemKey: `r${i}` })) }
    const out = recordRecent(before, item({ itemKey: 'new' }), 5)
    expect(out.recent).toHaveLength(RECENT_LIMIT)
    expect(out.recent[0].itemKey).toBe('new')
    expect(out.recent.some((r) => r.itemKey === `r${RECENT_LIMIT - 1}`)).toBe(false)
  })

  it('never touches favorites — a favorite that is used stays favorited, once', () => {
    const before = { version: 1 as const, favorites: [stored({ itemKey: 'a' })], recent: [] }
    expect(recordRecent(before, item({ itemKey: 'a' }), 5).favorites).toEqual(before.favorites)
  })
})
