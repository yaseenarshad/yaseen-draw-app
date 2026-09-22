/**
 * The curation rules ported from `worker/imageStudio.ts` (🔒 YAZ-1775 D4, YAZ-1818). The web app's own
 * four unit tests are here field for field — Pixabay type filtering, the search URL's shape,
 * colour-collection ranking, the three-to-one interleave — plus the cursor, which the Worker only
 * ever exercised through a live `Request` and which is the piece an infinite scroll rests on.
 */
import { describe, expect, it } from 'vitest'
import {
  COLOR_COLLECTION_PRIORITY,
  decodeCursor,
  encodeCursor,
  hasMorePages,
  ICONIFY_ALL_RESULT_LIMIT,
  iconifyItemFromId,
  iconifyPageExhausted,
  iconifySearchUrl,
  pixabaySearchUrl,
  iconifySvgUrl,
  initialCursor,
  interleaveResults,
  isColorCollection,
  MAX_IMPORT_BYTES,
  nextPixabayType,
  normalizeIconifyResults,
  normalizePixabayResults,
  PIXABAY_ALL_RESULT_LIMIT,
  providerLimits,
  providersFor,
  SEARCH_CACHE_VERSION,
  SEARCH_LIMIT,
} from './curation'

const iconItem = (providerId: string, over: Partial<{ kind: 'icon' | 'logo'; title: string }> = {}) => ({
  itemKey: `iconify:${providerId}`,
  provider: 'iconify' as const,
  providerId,
  kind: over.kind ?? ('icon' as const),
  title: over.title ?? providerId,
})

describe('the numbers 🔒 YAZ-1775 D4 locked', () => {
  it('is 18 results, 14 icons and 4 graphics in "all", cache version 2, 20 MB imports', () => {
    expect(SEARCH_LIMIT).toBe(18)
    expect(ICONIFY_ALL_RESULT_LIMIT).toBe(14)
    expect(PIXABAY_ALL_RESULT_LIMIT).toBe(4)
    expect(SEARCH_CACHE_VERSION).toBe('2')
    expect(MAX_IMPORT_BYTES).toBe(20 * 1024 * 1024)
  })

  it('splits the page in "all" and gives one provider the whole page otherwise', () => {
    expect(providerLimits('all')).toEqual({ iconify: 14, pixabay: 4 })
    expect(providerLimits('iconify')).toEqual({ iconify: 18, pixabay: 18 })
    expect(providersFor('all')).toEqual(['iconify', 'pixabay'])
    expect(providersFor('pixabay')).toEqual(['pixabay'])
  })

  it('knows the colour sets by name — the first Iconify pass is exactly these', () => {
    expect(isColorCollection('fluent-emoji-flat')).toBe(true)
    expect(isColorCollection('mdi')).toBe(false)
    expect(COLOR_COLLECTION_PRIORITY[0]).toBe('fluent-emoji-flat')
  })
})

describe('Pixabay normalization', () => {
  it('keeps vectors and illustrations but rejects photos', () => {
    const results = normalizePixabayResults({
      hits: [
        {
          id: 101,
          type: 'vector/svg',
          tags: 'filing cabinet, office',
          previewURL: 'https://example.com/cabinet.png',
          pageURL: 'https://pixabay.com/vectors/cabinet-101/',
          user: 'Alex',
          imageWidth: 1000,
          imageHeight: 1200,
        },
        { id: 102, type: 'photo', previewURL: 'https://example.com/photo.jpg' },
      ],
    })

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      itemKey: 'pixabay:101',
      provider: 'pixabay',
      kind: 'illustration',
      title: 'Filing Cabinet',
      collectionName: 'Pixabay',
      licenseName: 'Pixabay Content License',
      creator: 'Alex',
      attribution: 'Graphic from Pixabay by Alex',
      width: 1000,
      height: 1200,
    })
  })

  it('drops a hit with no id or no preview, and titles an untagged one', () => {
    expect(normalizePixabayResults({ hits: [{ type: 'vector', previewURL: 'https://x/y.png' }] })).toEqual([])
    expect(normalizePixabayResults({ hits: [{ id: 5, type: 'vector' }] })).toEqual([])
    expect(normalizePixabayResults({ hits: [{ id: 5, type: 'vector', previewURL: 'https://x/y.png' }] })[0].title).toBe('Pixabay graphic')
  })

  it('carries NO previewUrl — this app asks for a preview over media:preview, not by URL', () => {
    const [item] = normalizePixabayResults({ hits: [{ id: 5, type: 'vector', previewURL: 'https://x/y.png' }] })
    expect(item.previewUrl).toBeUndefined()
  })

  it('builds a transparent, safe, popular-ordered search URL', () => {
    const url = pixabaySearchUrl('filing cabinet', 2, 'vector', 'secret', 20)
    expect(url.searchParams.get('image_type')).toBe('vector')
    expect(url.searchParams.get('colors')).toBe('transparent')
    expect(url.searchParams.get('safesearch')).toBe('true')
    expect(url.searchParams.get('order')).toBe('popular')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('key')).toBe('secret')
  })
})

describe('Iconify normalization and ranking', () => {
  it('reads the collection map for the name, the licence and the logo flag', () => {
    const [icon, logo] = normalizeIconifyResults({
      icons: ['mdi:rocket-launch', 'simple-icons:github'],
      collections: { mdi: { name: 'Material Design Icons', license: { title: 'Apache 2.0', url: 'https://x/l' } }, 'simple-icons': { name: 'Simple Icons' } },
    })
    expect(icon).toMatchObject({ itemKey: 'iconify:mdi:rocket-launch', kind: 'icon', title: 'rocket launch', collectionName: 'Material Design Icons', licenseName: 'Apache 2.0', licenseUrl: 'https://x/l' })
    expect(icon.trademarkNotice).toBeUndefined()
    expect(logo).toMatchObject({ kind: 'logo', trademarkNotice: true, licenseName: 'Open source' })
  })

  it('treats a brand/logo/social category as a logo, and drops a malformed id', () => {
    const [item] = normalizeIconifyResults({ icons: ['logos:react'], collections: { logos: { category: 'Brands / Social' } } })
    expect(item.kind).toBe('logo')
    expect(normalizeIconifyResults({ icons: ['nocolon', ':leading', 'trailing:'] })).toEqual([])
  })



  it('mixes three curated icons before each Pixabay graphic', () => {
    const item = (provider: 'pixabay' | 'iconify', providerId: string) => ({
      itemKey: `${provider}:${providerId}`,
      provider,
      providerId,
      kind: provider === 'pixabay' ? ('illustration' as const) : ('icon' as const),
      title: providerId,
    })
    expect(
      interleaveResults(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item('iconify', id)),
        ['one', 'two'].map((id) => item('pixabay', id)),
      ).map(({ provider }) => provider),
    ).toEqual(['iconify', 'iconify', 'iconify', 'pixabay', 'iconify', 'iconify', 'iconify', 'pixabay'])
  })

  it('never interleaves past SEARCH_LIMIT', () => {
    const many = (provider: 'pixabay' | 'iconify', n: number) =>
      Array.from({ length: n }, (_, i) => ({ itemKey: `${provider}:${i}`, provider, providerId: String(i), kind: 'icon' as const, title: String(i) }))
    expect(interleaveResults(many('iconify', 40), many('pixabay', 40))).toHaveLength(SEARCH_LIMIT)
  })
})

describe('the opaque cursor', () => {
  it('round-trips through base64url with no padding and no URL-unsafe characters', () => {
    const cursor = initialCursor('money bag', 'all')
    const encoded = encodeCursor(cursor)
    expect(encoded).not.toMatch(/[+/=]/)
    expect(decodeCursor(encoded, 'money bag', 'all')).toEqual(cursor)
  })

  it('starts fresh with no cursor at all', () => {
    expect(decodeCursor(null, 'q', 'all')).toEqual(initialCursor('q', 'all'))
    expect(decodeCursor(undefined, 'q', 'all')).toEqual(initialCursor('q', 'all'))
    expect(decodeCursor('', 'q', 'all')).toEqual(initialCursor('q', 'all'))
  })

  it('refuses a cursor minted for another query or another source — it would page a different search', () => {
    const encoded = encodeCursor(initialCursor('rockets', 'all'))
    expect(() => decodeCursor(encoded, 'money bag', 'all')).toThrow('Invalid search cursor')
    expect(() => decodeCursor(encoded, 'rockets', 'iconify')).toThrow('Invalid search cursor')
  })

  it('refuses garbage, a wrong version, a negative start and a non-numeric seen id', () => {
    expect(() => decodeCursor('2', 'q', 'all')).toThrow('Invalid search cursor')
    const bad = (patch: (c: ReturnType<typeof initialCursor>) => void) => {
      const cursor = initialCursor('q', 'all')
      patch(cursor)
      return () => decodeCursor(encodeCursor(cursor), 'q', 'all')
    }
    expect(bad((c) => ((c as { version: number }).version = 2))).toThrow()
    expect(bad((c) => (c.iconify.colorStart = -1))).toThrow()
    expect(bad((c) => (c.pixabay.vectorPage = 0))).toThrow()
    expect(bad((c) => ((c.pixabay as { nextType: string }).nextType = 'photo'))).toThrow()
    expect(bad((c) => (c.pixabay.seenIds = ['abc']))).toThrow()
    expect(bad((c) => (c.pixabay.seenIds = Array.from({ length: 1001 }, (_, i) => String(i))))).toThrow()
  })

  it('says there is more until BOTH halves of the asked-for providers are exhausted', () => {
    const cursor = initialCursor('q', 'all')
    expect(hasMorePages(cursor, 'all')).toBe(true)
    cursor.iconify.colorExhausted = true
    cursor.iconify.generalExhausted = true
    expect(hasMorePages(cursor, 'iconify')).toBe(false)
    expect(hasMorePages(cursor, 'all')).toBe(true)
    cursor.pixabay.vectorExhausted = true
    cursor.pixabay.illustrationExhausted = true
    expect(hasMorePages(cursor, 'all')).toBe(false)
  })

  it('alternates Pixabay types and skips one that has run out', () => {
    const cursor = initialCursor('q', 'all').pixabay
    expect(nextPixabayType(cursor)).toBe('vector')
    cursor.vectorExhausted = true
    expect(nextPixabayType(cursor)).toBe('illustration')
    cursor.illustrationExhausted = true
    expect(nextPixabayType(cursor)).toBeNull()
  })
})

describe('page exhaustion', () => {
  it('trusts a reported total when there is one', () => {
    expect(iconifyPageExhausted(0, 10, { fetchedCount: 10, responseLimit: 10, total: 10 })).toBe(true)
    expect(iconifyPageExhausted(0, 10, { fetchedCount: 10, responseLimit: 10, total: 40 })).toBe(false)
  })

  it('without a total, only a SHORT page that was fully consumed is the end', () => {
    expect(iconifyPageExhausted(0, 3, { fetchedCount: 3, responseLimit: 10 })).toBe(true)
    expect(iconifyPageExhausted(0, 10, { fetchedCount: 10, responseLimit: 10 })).toBe(false)
    expect(iconifyPageExhausted(0, 2, { fetchedCount: 3, responseLimit: 10 })).toBe(false)
  })
})

describe('provider URLs and the import-time item', () => {
  it('passes prefixes only for the colour pass', () => {
    expect(iconifySearchUrl('rocket', 0, 6, ['noto']).searchParams.get('prefixes')).toBe('noto')
    expect(iconifySearchUrl('rocket', 0, 6).searchParams.has('prefixes')).toBe(false)
    expect(iconifySearchUrl('rocket', 12, 6).searchParams.get('start')).toBe('12')
  })

  it('serves an icon SVG by name and refuses anything that is not prefix:name', () => {
    expect(iconifySvgUrl('noto:rocket')).toBe('https://api.iconify.design/noto/rocket.svg')
    expect(iconifySvgUrl('../../etc/passwd')).toBeNull()
    expect(iconifySvgUrl('noto:rocket/../x')).toBeNull()
    expect(iconifySvgUrl('https://evil.test')).toBeNull()
  })

  it('derives only what an import can actually know — no collection name, no licence it did not read', () => {
    const item = iconifyItemFromId('noto:money-bag')
    expect(item).toMatchObject({ itemKey: 'iconify:noto:money-bag', provider: 'iconify', kind: 'icon', title: 'money bag' })
    expect(item?.collectionName).toBeUndefined()
    expect(item?.licenseName).toBeUndefined()
    expect(iconifyItemFromId('simple-icons:github')).toMatchObject({ kind: 'logo', trademarkNotice: true })
    expect(iconifyItemFromId('nope')).toBeNull()
  })
})
