/**
 * The media cache's policy (🔒 D4, YAZ-1818): the key scheme the Worker used, the 24 h that
 * bounds both a read and the startup sweep, and the hashing that turns a user's query into a
 * filename nothing can be surprised by.
 */
import { describe, expect, it } from 'vitest'
import { SEARCH_CACHE_VERSION } from './curation'
import { CACHE_TTL_MS, cacheFileName, isFresh, MEDIA_CACHE_DIR, pixabayItemCacheKey, pixabayPageCacheKey, planCacheSweep, previewCacheKey, searchCacheKey } from './cachePolicy'

describe('cache file names', () => {
  it('is a flat sha-256 .json, whatever the key looked like', () => {
    expect(cacheFileName('search?q=x')).toMatch(/^[0-9a-f]{64}\.json$/)
    // A query is free text: slashes, dots and leading dots must not become path or hidden files.
    expect(cacheFileName('../../etc/passwd')).toMatch(/^[0-9a-f]{64}\.json$/)
    expect(cacheFileName('.hidden')).toMatch(/^[0-9a-f]{64}\.json$/)
  })

  it('is stable for one key and different for another', () => {
    expect(cacheFileName('a')).toBe(cacheFileName('a'))
    expect(cacheFileName('a')).not.toBe(cacheFileName('b'))
  })

  it('lives in userData/media-cache', () => {
    expect(MEDIA_CACHE_DIR).toBe('media-cache')
  })
})

describe('the key scheme', () => {
  it('carries SEARCH_CACHE_VERSION, so bumping it orphans every stored answer', () => {
    expect(searchCacheKey('money bag', 'all', null, true)).toContain(`_iscv=${SEARCH_CACHE_VERSION}`)
  })

  it('separates query, source, cursor AND whether a Pixabay key was set', () => {
    const base = searchCacheKey('money bag', 'all', null, true)
    expect(searchCacheKey('money bags', 'all', null, true)).not.toBe(base)
    expect(searchCacheKey('money bag', 'iconify', null, true)).not.toBe(base)
    expect(searchCacheKey('money bag', 'all', 'CURSOR', true)).not.toBe(base)
    // The one that matters most: adding a key must not keep serving yesterday's Iconify-only page.
    expect(searchCacheKey('money bag', 'all', null, false)).not.toBe(base)
  })

  it('encodes a query that would otherwise break the key apart', () => {
    expect(searchCacheKey('a&source=pixabay', 'all', null, true)).toContain('a%26source%3Dpixabay')
  })

  it('names provider sub-fetches and previews the way the Worker did', () => {
    expect(pixabayPageCacheKey('money bag', 'vector', 2, 4)).toBe('pixabay/search/money%20bag/vector/2/4')
    expect(pixabayItemCacheKey('101')).toBe('pixabay/item/101')
    expect(previewCacheKey('iconify', 'noto:money-bag')).toBe('image/iconify/noto%3Amoney-bag/preview')
  })
})

describe('freshness and the sweep', () => {
  const now = 1_700_000_000_000

  it('is fresh under 24 h and stale at it', () => {
    expect(CACHE_TTL_MS).toBe(24 * 60 * 60 * 1000)
    expect(isFresh(now - CACHE_TTL_MS + 1, now)).toBe(true)
    expect(isFresh(now - CACHE_TTL_MS, now)).toBe(false)
  })

  it('counts a file from the future as fresh rather than deleting it', () => {
    expect(isFresh(now + 60_000, now)).toBe(true)
  })

  it('sweeps only expired .json entries and leaves anything else alone', () => {
    const entries = [
      { name: 'aa.json', mtimeMs: now - CACHE_TTL_MS - 1 },
      { name: 'bb.json', mtimeMs: now - 1000 },
      { name: 'notes.txt', mtimeMs: 0 },
      { name: 'cc.json.tmp-abc', mtimeMs: 0 },
    ]
    expect(planCacheSweep(entries, now)).toEqual(['aa.json'])
  })

  it('has nothing to do on an empty folder', () => {
    expect(planCacheSweep([], now)).toEqual([])
  })
})
