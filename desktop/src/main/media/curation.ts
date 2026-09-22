/**
 * THE IMAGE STUDIO'S CURATION (🔒 YAZ-1775 D4, YAZ-1818): `worker/imageStudio.ts` from the web app
 * (`yaseen-excalidraw` @ `e72242f8`), ported rather than re-invented. This is the valuable part
 * of the Worker — the ranking, the interleave, the two-phase Iconify walk and the cursor that
 * makes an infinite scroll possible over two providers with incompatible paging — and it is the
 * part that must not be simplified.
 *
 * PURE BY CONSTRUCTION: not one function here touches the network, the disk or Electron.
 * `providers.ts` is the half that fetches; everything it decides it decides by calling into here,
 * so every rule below is unit-tested with no `fetch` at all.
 *
 * WHAT CHANGED FROM THE WORKER, AND WHY
 * - `previewUrl` is not set on an item. In the Worker it held `/api/image-studio/preview/…`, the
 *   route that would serve the picture; this app has no routes and asks over `media:preview`.
 * - The cursor's base64url is `Buffer.from(...).toString('base64url')` instead of `btoa` plus
 *   three `replace`s. Same bytes, same alphabet, same stripped padding — Node has the encoder.
 */
import type { MediaItemKind, MediaSearchSource, StudioItem } from '@shared/types'

/** How many results ONE page of a search answers with. */
export const SEARCH_LIMIT = 18
/** In `all`, the split: icons carry the page, Pixabay garnishes it. */
export const ICONIFY_ALL_RESULT_LIMIT = 14
export const PIXABAY_ALL_RESULT_LIMIT = SEARCH_LIMIT - ICONIFY_ALL_RESULT_LIMIT
/** The colour-collection pass asks for at most this many icons before the general pass starts. */
export const ICONIFY_COLOR_BATCH_LIMIT = 6
/** Pixabay is paged four at a time, alternating vector and illustration. */
export const PIXABAY_PAGE_SIZE = 4
/** The import ceiling (🔒 YAZ-1775 D4): 20 MB, enforced in main, never in the renderer. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
/** Search JSON and previews live this long on disk; bump `SEARCH_CACHE_VERSION` to orphan them early. */
export const CACHE_SECONDS = 24 * 60 * 60
/** Part of every search cache key: changing the curation changes this, and yesterday's answers stop counting. */
export const SEARCH_CACHE_VERSION = '2'
export const PIXABAY_API = 'https://pixabay.com/api/'
export const ICONIFY_API = 'https://api.iconify.design'

/**
 * The icon sets that are COLOURED, best first. They are asked for in their own batch before the
 * general search, and then excluded from it, so a query never comes back as eighteen identical
 * monochrome glyphs.
 */
export const COLOR_COLLECTION_PRIORITY = [
  'fluent-emoji-flat',
  'noto',
  'openmoji',
  'twemoji',
  'fluent-color',
  'streamline-color',
  'streamline-ultimate-color',
  'icon-park',
  'icon-park-twotone',
]

const colorCollectionSet = new Set(COLOR_COLLECTION_PRIORITY)
/** Whether `prefix` is one of the colour sets the first Iconify pass claims. */
export const isColorCollection = (prefix: string): boolean => colorCollectionSet.has(prefix)

export type SearchProvider = Exclude<MediaSearchSource, 'all'>
export type PixabayImageType = 'vector' | 'illustration'

/** One Pixabay hit, as loosely as the API actually answers. */
export interface PixabayHit {
  id?: number
  type?: string
  pageURL?: string
  tags?: string
  previewURL?: string
  webformatURL?: string
  largeImageURL?: string
  vectorURL?: string
  user?: string
  imageWidth?: number
  imageHeight?: number
}

export interface IconifyCollection {
  name?: string
  category?: string
  license?: { title?: string; url?: string; spdx?: string }
}

export interface IconifySearchPayload {
  icons?: string[]
  collections?: Record<string, IconifyCollection>
  total?: number
  limit?: number
}

/** Where the Iconify walk has got to: a colour pass and a general pass, each with its own start. */
export interface IconifyCursor {
  colorStart: number
  generalStart: number
  colorExhausted: boolean
  generalExhausted: boolean
}

/** Where the Pixabay walk has got to: a page per image type, whose turn it is, and what was already shown. */
export interface PixabayCursor {
  vectorPage: number
  illustrationPage: number
  nextType: PixabayImageType
  vectorExhausted: boolean
  illustrationExhausted: boolean
  seenIds: string[]
}

/** The whole opaque cursor. It carries the query and the source so a stale one cannot page a different search. */
export interface SearchCursor {
  version: 1
  query: string
  source: MediaSearchSource
  iconify: IconifyCursor
  pixabay: PixabayCursor
}

export interface ProviderCursor {
  iconify: IconifyCursor
  pixabay: PixabayCursor
}

export interface ProviderSearchResult<Provider extends SearchProvider> {
  items: StudioItem[]
  cursor: ProviderCursor[Provider]
  hasMore: boolean
}

export type AnyProviderSearchResult = ProviderSearchResult<'iconify'> | ProviderSearchResult<'pixabay'>

const stringValue = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined)
/** A finite number, or undefined — the Pixabay payload's own looseness, narrowed once. */
export const finiteNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

/** A Pixabay hit's first tag, title-cased — the closest thing the API gives to a name. */
const titleFromTags = (tags?: string) => {
  const firstTag = tags
    ?.split(',')
    .map((tag) => tag.trim())
    .find(Boolean)
  return firstTag ? firstTag.replace(/\b\w/g, (character) => character.toUpperCase()) : 'Pixabay graphic'
}

/**
 * Pixabay hits → items. `vector` and `illustration` ONLY (🔒 YAZ-1775 D4): photographs are not what this
 * studio is for, and the API answers with them freely if you let it. A hit with no id or no
 * preview is not an item at all.
 */
export function normalizePixabayResults(payload: { hits?: PixabayHit[] }): StudioItem[] {
  return (payload.hits ?? []).flatMap((raw) => {
    const id = finiteNumber(raw.id)
    const preview = stringValue(raw.previewURL)
    const type = stringValue(raw.type)?.toLowerCase()
    if (id === undefined || !preview || (!type?.startsWith('vector') && !type?.startsWith('illustration'))) return []
    const providerId = String(id)
    const item: StudioItem = {
      itemKey: `pixabay:${providerId}`,
      provider: 'pixabay',
      providerId,
      kind: 'illustration',
      title: titleFromTags(raw.tags),
      collectionName: 'Pixabay',
      licenseName: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      attribution: `Graphic from Pixabay${raw.user ? ` by ${raw.user}` : ''}`,
    }
    const creator = stringValue(raw.user)
    if (creator !== undefined) item.creator = creator
    const sourceUrl = stringValue(raw.pageURL)
    if (sourceUrl !== undefined) item.sourceUrl = sourceUrl
    const width = finiteNumber(raw.imageWidth)
    if (width !== undefined) item.width = width
    const height = finiteNumber(raw.imageHeight)
    if (height !== undefined) item.height = height
    return [item]
  })
}

/** A brand set, or a set whose category says brand/logo/social, is a LOGO — and logos carry a trademark notice. */
export function iconKind(prefix: string, collection: IconifyCollection | undefined): Extract<MediaItemKind, 'icon' | 'logo'> {
  return prefix === 'simple-icons' || /brand|logo|social/i.test(collection?.category ?? '') ? 'logo' : 'icon'
}

/** Iconify's `prefix:name` strings → items, with whatever the payload's collection map knows about the set. */
export function normalizeIconifyResults(payload: { icons?: string[]; collections?: Record<string, IconifyCollection> }): StudioItem[] {
  return (payload.icons ?? []).flatMap((providerId) => {
    const separator = providerId.indexOf(':')
    if (separator < 1 || separator === providerId.length - 1) return []
    const prefix = providerId.slice(0, separator)
    const iconName = providerId.slice(separator + 1)
    const collection = payload.collections?.[prefix]
    const kind = iconKind(prefix, collection)
    const item: StudioItem = {
      itemKey: `iconify:${providerId}`,
      provider: 'iconify',
      providerId,
      kind,
      title: iconName.replaceAll('-', ' '),
      collectionName: collection?.name ?? prefix,
      sourceUrl: `https://icon-sets.iconify.design/${prefix}/${iconName}/`,
      licenseName: collection?.license?.title ?? collection?.license?.spdx ?? 'Open source',
    }
    if (collection?.license?.url !== undefined) item.licenseUrl = collection.license.url
    if (kind === 'logo') item.trademarkNotice = true
    return [item]
  })
}

/** Three icons, one graphic, repeat — the grid's rhythm, capped at `SEARCH_LIMIT`. */
export function interleaveResults(iconify: StudioItem[], pixabay: StudioItem[]): StudioItem[] {
  const results: StudioItem[] = []
  let iconIndex = 0
  let pixabayIndex = 0
  while (results.length < SEARCH_LIMIT && (iconIndex < iconify.length || pixabayIndex < pixabay.length)) {
    for (let offset = 0; offset < 3 && iconIndex < iconify.length && results.length < SEARCH_LIMIT; offset++) {
      results.push(iconify[iconIndex++])
    }
    if (pixabayIndex < pixabay.length && results.length < SEARCH_LIMIT) results.push(pixabay[pixabayIndex++])
  }
  return results
}

/** A fresh cursor: both providers at their start, nothing exhausted, nothing seen. */
export function initialCursor(query: string, source: MediaSearchSource): SearchCursor {
  return {
    version: 1,
    query,
    source,
    iconify: { colorStart: 0, generalStart: 0, colorExhausted: false, generalExhausted: false },
    pixabay: { vectorPage: 1, illustrationPage: 1, nextType: 'vector', vectorExhausted: false, illustrationExhausted: false, seenIds: [] },
  }
}

/** base64url of the cursor JSON — opaque to the renderer, which only ever hands it back. */
export function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

const validInteger = (candidate: unknown, minimum: number) => typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= minimum
const validBoolean = (candidate: unknown) => typeof candidate === 'boolean'

/**
 * The cursor back, or a throw. Every field is checked — a cursor is renderer input, and one that
 * disagrees with the query or source it was minted for would page a DIFFERENT search into these
 * results. `seenIds` is capped at 1000 numeric strings so a hand-made cursor cannot grow unbounded.
 */
export function decodeCursor(value: string | null | undefined, query: string, source: MediaSearchSource): SearchCursor {
  if (!value) return initialCursor(query, source)
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as SearchCursor
    if (
      cursor.version !== 1 ||
      cursor.query !== query ||
      cursor.source !== source ||
      !validInteger(cursor.iconify?.colorStart, 0) ||
      !validInteger(cursor.iconify?.generalStart, 0) ||
      !validBoolean(cursor.iconify?.colorExhausted) ||
      !validBoolean(cursor.iconify?.generalExhausted) ||
      !validInteger(cursor.pixabay?.vectorPage, 1) ||
      !validInteger(cursor.pixabay?.illustrationPage, 1) ||
      (cursor.pixabay?.nextType !== 'vector' && cursor.pixabay?.nextType !== 'illustration') ||
      !validBoolean(cursor.pixabay?.vectorExhausted) ||
      !validBoolean(cursor.pixabay?.illustrationExhausted) ||
      (cursor.pixabay?.seenIds !== undefined &&
        (!Array.isArray(cursor.pixabay.seenIds) || cursor.pixabay.seenIds.length > 1000 || !cursor.pixabay.seenIds.every((candidate) => typeof candidate === 'string' && /^\d+$/.test(candidate))))
    ) {
      throw new Error('Invalid search cursor')
    }
    cursor.pixabay.seenIds ??= []
    return cursor
  } catch {
    throw new Error('Invalid search cursor')
  }
}

/** How many results each provider owes for this source. */
export function providerLimits(source: MediaSearchSource): Record<SearchProvider, number> {
  return source === 'all' ? { iconify: ICONIFY_ALL_RESULT_LIMIT, pixabay: PIXABAY_ALL_RESULT_LIMIT } : { iconify: SEARCH_LIMIT, pixabay: SEARCH_LIMIT }
}

/** Which providers this source asks, in the order the page interleaves them. */
export function providersFor(source: MediaSearchSource): SearchProvider[] {
  return source === 'all' ? ['iconify', 'pixabay'] : [source]
}

/**
 * Whether the page just consumed was the last one. Iconify answers `total` when it feels like it;
 * without one, a short page (fewer icons than the limit it echoed) is the end.
 */
export function iconifyPageExhausted(start: number, consumedCount: number, page: { fetchedCount: number; responseLimit: number; total?: number }): boolean {
  return page.total !== undefined ? start + consumedCount >= page.total : consumedCount === page.fetchedCount && page.fetchedCount < page.responseLimit
}

export const oppositePixabayType = (type: PixabayImageType): PixabayImageType => (type === 'vector' ? 'illustration' : 'vector')

/** Whose turn it is, skipping a type that has run out; null when both have. */
export function nextPixabayType(cursor: PixabayCursor): PixabayImageType | null {
  if (!cursor[`${cursor.nextType}Exhausted`]) return cursor.nextType
  const alternate = oppositePixabayType(cursor.nextType)
  return cursor[`${alternate}Exhausted`] ? null : alternate
}

/** Whether a cursor still has a page in it — what decides `nextCursor: null` and stops the scroll. */
export function hasMorePages(cursor: SearchCursor, source: MediaSearchSource): boolean {
  return providersFor(source).some((provider) =>
    provider === 'iconify' ? !cursor.iconify.colorExhausted || !cursor.iconify.generalExhausted : !cursor.pixabay.vectorExhausted || !cursor.pixabay.illustrationExhausted,
  )
}

/** The Pixabay search URL the Worker built, field for field (`colors=transparent`, `safesearch`, `order=popular`). */
export function pixabaySearchUrl(query: string, page: number, imageType: PixabayImageType, key: string, perPage: number): URL {
  const url = new URL(PIXABAY_API)
  url.searchParams.set('key', key)
  url.searchParams.set('q', query)
  url.searchParams.set('page', String(page))
  url.searchParams.set('per_page', String(perPage))
  url.searchParams.set('image_type', imageType)
  url.searchParams.set('colors', 'transparent')
  url.searchParams.set('safesearch', 'true')
  url.searchParams.set('order', 'popular')
  return url
}

/** Iconify's search URL; `prefixes` is what makes the colour pass a colour pass. */
export function iconifySearchUrl(query: string, start: number, limit: number, prefixes?: string[]): URL {
  const url = new URL(`${ICONIFY_API}/search`)
  url.searchParams.set('query', query)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('start', String(start))
  if (prefixes?.length) url.searchParams.set('prefixes', prefixes.join(','))
  return url
}

/** `prefix:name` → the SVG endpoint, or null when the id is not one Iconify could serve. */
export function iconifySvgUrl(providerId: string): string | null {
  if (!/^[a-z0-9-]+:[a-z0-9-]+$/i.test(providerId)) return null
  const [prefix, name] = providerId.split(':')
  return `${ICONIFY_API}/${encodeURIComponent(prefix)}/${encodeURIComponent(name)}.svg`
}

/**
 * The item an IMPORT can describe on its own. Only what the provider actually told us: an Iconify
 * import knows the icon's name and its set's PREFIX, not the set's pretty title or licence, so it
 * leaves those out and the caller's own copy (from a search, a favorite or the MRU) supplies them.
 */
export function iconifyItemFromId(providerId: string): StudioItem | null {
  if (iconifySvgUrl(providerId) === null) return null
  const [prefix, name] = providerId.split(':')
  const kind = iconKind(prefix, undefined)
  const item: StudioItem = {
    itemKey: `iconify:${providerId}`,
    provider: 'iconify',
    providerId,
    kind,
    title: name.replaceAll('-', ' '),
    sourceUrl: `https://icon-sets.iconify.design/${prefix}/${name}/`,
  }
  if (kind === 'logo') item.trademarkNotice = true
  return item
}
