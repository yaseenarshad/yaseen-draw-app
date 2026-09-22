/**
 * THE IMAGES TAB (🔒 D4 / ⚡ D8 amended, YAZ-1818): the web app's
 * `excalidraw-app/image-studio/ImageStudio.tsx`, ported into the canvas panel's first tab. Four
 * views — Search, Shapes, Favorites, Recent — over the providers main owns.
 *
 * WHAT THE PORT CHANGED, AND WHY
 * - **Convex became the bridge.** `useQuery`/`useMutation` on `api.mediaLibrary.*` are
 *   `api.media.favorites` / `api.media.recent` plus the `media:changed` push (🔒 D5, 3A): one
 *   file, every window, every vault. The lists are re-listed on that push rather than polled.
 * - **A preview is asked for, not linked to.** The web app put a Worker route in `previewUrl` and
 *   let `<img>` fetch it. There are no routes here and the renderer may not reach a provider, so
 *   every tile asks `media:preview` for its bytes as a dataURL — including a favorite whose
 *   stored `previewUrl` is a dead Worker path from the web app. That field is never read.
 * - **No key is not an error.** `pixabayAvailable` false hides the Pixabay source and says
 *   nothing at all (🔒 D4). The web app's "Pixabay graphics need an API key" warning is gone with
 *   the Worker that produced it; the Settings › Images row is where a key is entered (3A).
 * - **Offline is a state, not a banner.** A search that could not reach a provider renders a
 *   passive line; Shapes keeps working entirely, and Favorites and Recent keep working with
 *   whatever previews main still has cached — which is the whole of 🔒 D4's offline half.
 * - **The favorites kebab is gone.** Its menu had exactly one item, "Remove from favorites", and
 *   the lit star beside it already means that. One click, and no menu primitive to vendor.
 *
 * THE SMART SHAPES ARRIVE LATE ON PURPOSE. `@excalidraw/element` is a second ~300 kB download
 * (`engine.ts`'s lazy rule), so the seven basic shapes render immediately and the twelve Smart
 * Shapes join when it lands. Nothing waits on it.
 *
 * WHAT AN INSERT COSTS ON DISK: nothing, here. The bytes go to the engine, the engine's files map
 * grows an id the store does not hold, and the SAVE path built in 2E writes it into `assets/`
 * before the scene names it (🔒 D3).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PIXABAY_SECRET, type MediaSearchSource, type StoredMediaItem, type StudioItem } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { loadExcalidrawElement } from '../drawings/engine'
import { insertImage, insertShape, fileFromImport, type InsertEngine, type InsertTarget } from './insertShape'
import { buildShapeCatalog, filterShapeCatalog, getShape, type ShapeCatalogItem, type ShapePreview, type SmartShapeApi } from './shapes'
import './imageStudio.css'

export type StudioView = 'search' | 'shapes' | 'favorites' | 'recent'
export const STUDIO_VIEWS: readonly StudioView[] = ['search', 'shapes', 'favorites', 'recent']

const VIEW_LABELS: Record<StudioView, string> = { search: 'Search', shapes: 'Shapes', favorites: 'Favorites', recent: 'Recent' }

/** What the Search view says when the machine could not reach a provider (🔒 D4's offline half). */
export const OFFLINE_NOTICE = "You're offline. Shapes, Favorites and Recent still work."

export interface ImageStudioProps {
  /** The two engine values an insert needs; the panel only exists once the engine has loaded. */
  engine: InsertEngine
  /** The engine's imperative handle, or null while it is still mounting — inserting is off until then. */
  excalidrawAPI: InsertTarget | null
  /** Bumped by ⌘F: switch to Search and put the caret in the field (the web app's own pattern). */
  searchFocusRequest?: number
}

/** A catalog shape as a studio item, so one grid renders all four views. */
const shapeItem = (shape: ShapeCatalogItem): StudioItem => ({
  itemKey: `shape:${shape.id}`,
  provider: 'shape',
  providerId: shape.id,
  kind: 'shape',
  title: shape.title,
  collectionName: 'Shapes',
})

const dedupeItems = (items: StudioItem[]) => [...new Map(items.map((item) => [item.itemKey, item])).values()]

/**
 * THE PREVIEW MEMO. `media:preview` is already cached on disk for 24 h, but a tile re-mounts every
 * time a view is switched and an IPC round trip per tile per switch is a visible stutter. One
 * module-level map of settled dataURLs and in-flight promises makes the second look free, and it
 * is keyed by provider+id — the same key main caches under, so the two never disagree.
 */
const previewMemo = new Map<string, string>()
const previewInFlight = new Map<string, Promise<string | null>>()

export function previewKey(provider: string, providerId: string): string {
  return `${provider}:${providerId}`
}

/** Exported for the tests, which must not inherit another test's memo. */
export function clearPreviewMemo(): void {
  previewMemo.clear()
  previewInFlight.clear()
}

async function loadPreview(item: StudioItem): Promise<string | null> {
  if (item.provider === 'shape') return null
  const key = previewKey(item.provider, item.providerId)
  const settled = previewMemo.get(key)
  if (settled !== undefined) return settled
  const existing = previewInFlight.get(key)
  if (existing !== undefined) return existing
  const request = api.media
    .preview({ provider: item.provider, id: item.providerId })
    .then(({ dataURL }) => {
      previewMemo.set(key, dataURL)
      return dataURL
    })
    // A preview that cannot be had is a PLACEHOLDER, never an error: offline, no key for a
    // favorited graphic, an icon set that has since dropped the name. The tile still inserts.
    .catch(() => null)
    .finally(() => previewInFlight.delete(key))
  previewInFlight.set(key, request)
  return request
}

/** One provider tile's picture, asked for by id and drawn when it arrives. */
function RemotePreview({ item }: { item: StudioItem }) {
  const [src, setSrc] = useState<string | null>(() => previewMemo.get(previewKey(item.provider, item.providerId)) ?? null)
  useEffect(() => {
    let live = true
    void loadPreview(item).then((dataURL) => {
      if (live) setSrc(dataURL)
    })
    return () => {
      live = false
    }
  }, [item])
  if (src === null) return <span className="image-studio__placeholder" aria-hidden="true" />
  return <img src={src} alt="" loading="lazy" />
}

/** A shape tile's picture: one of six stock outlines, or the engine's own generated path. */
function ShapePreview({ preview }: { preview: ShapePreview }) {
  if (preview.type === 'smart') {
    return (
      <svg viewBox={preview.viewBox} aria-hidden="true">
        {preview.closed ? (
          <polygon className="image-studio__shape-path--closed" points={preview.points} />
        ) : (
          <polyline className="image-studio__shape-path--open" points={preview.points} strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    )
  }
  if (preview.shape === 'rectangle') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <rect className="image-studio__shape-path--basic" x="10" y="20" width="80" height="60" rx="12" />
      </svg>
    )
  }
  if (preview.shape === 'ellipse') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <ellipse className="image-studio__shape-path--basic" cx="50" cy="50" rx="40" ry="34" />
      </svg>
    )
  }
  const points =
    preview.shape === 'diamond'
      ? '50,7 93,50 50,93 7,50'
      : preview.shape === 'triangle'
        ? '50,10 90,88 10,88'
        : preview.shape === 'hexagon'
          ? '25,10 75,10 94,50 75,90 25,90 6,50'
          : '50,5 61,36 95,38 68,58 78,91 50,71 22,91 32,58 5,38 39,36'
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon className="image-studio__shape-path--basic" points={points} />
    </svg>
  )
}

export function ImageStudio({ engine, excalidrawAPI, searchFocusRequest = 0 }: ImageStudioProps) {
  const [view, setView] = useState<StudioView>('search')
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<MediaSearchSource>('all')
  const [shapeQuery, setShapeQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [results, setResults] = useState<StudioItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [offline, setOffline] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [insertingKey, setInsertingKey] = useState<string | null>(null)
  const [busyFavoriteKey, setBusyFavoriteKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pixabayAvailable, setPixabayAvailable] = useState(true)
  const [favorites, setFavorites] = useState<StoredMediaItem[]>([])
  const [recent, setRecent] = useState<StoredMediaItem[]>([])
  const [smart, setSmart] = useState<SmartShapeApi | null>(null)

  const searchRequestId = useRef(0)
  const searchRequestInFlight = useRef(false)
  const requestedCursors = useRef(new Set<string>())
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchGridRef = useRef<HTMLDivElement>(null)
  const searchSentinelRef = useRef<HTMLDivElement>(null)
  const loadNextPageRef = useRef<() => void>(() => {})

  const canInsert = excalidrawAPI !== null

  // The library lists, and the ONE push that keeps them true in every window and every vault.
  useEffect(() => {
    let live = true
    const refresh = () => {
      void api.media.favorites({ op: 'list' }).then((list) => live && setFavorites(list))
      void api.media.recent({ op: 'list' }).then((list) => live && setRecent(list))
    }
    refresh()
    const off = api.media.onChanged(refresh)
    return () => {
      live = false
      off()
    }
  }, [])

  // Whether a key is set, before the first search has said so — so the Pixabay source is never
  // offered to someone who has not entered one (🔒 D4: the renderer learns yes/no, never a value).
  useEffect(() => {
    let live = true
    void api.secrets.has({ name: PIXABAY_SECRET }).then(
      (has) => live && setPixabayAvailable(has),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // The Smart Shapes' package, lazily; the basics are already on screen while it arrives.
  useEffect(() => {
    let live = true
    void loadExcalidrawElement().then(
      (mod) => live && setSmart(mod as unknown as SmartShapeApi),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [])

  // A source that is no longer offered cannot stay selected.
  useEffect(() => {
    if (!pixabayAvailable && source === 'pixabay') setSource('all')
  }, [pixabayAvailable, source])

  const catalog = useMemo(() => buildShapeCatalog(smart), [smart])
  const shapes = useMemo(() => filterShapeCatalog(catalog, shapeQuery).map(shapeItem), [catalog, shapeQuery])
  const favoriteKeys = useMemo(() => new Set(favorites.map(({ itemKey }) => itemKey)), [favorites])

  const displayedItems: StudioItem[] = view === 'shapes' ? shapes : view === 'favorites' ? favorites : view === 'recent' ? recent : results

  useEffect(() => {
    if (searchFocusRequest > 0) setView('search')
  }, [searchFocusRequest])

  useEffect(() => {
    if (searchFocusRequest > 0 && view === 'search') searchInputRef.current?.focus()
  }, [searchFocusRequest, view])

  /**
   * One page. `append` is the infinite scroll's next page and keeps what is on screen; a fresh
   * search clears everything, including the cursors already asked for — which is what stops the
   * observer from re-firing the page it just loaded.
   */
  const runSearch = useCallback(
    async ({
      append = false,
      retry = false,
      nextQuery,
      nextSource,
    }: { append?: boolean; retry?: boolean; nextQuery?: string; nextSource?: MediaSearchSource } = {}) => {
      const askedQuery = nextQuery ?? (append ? searchedQuery : query.trim())
      const askedSource = nextSource ?? source
      if (askedQuery.length < 2) {
        setError('Type at least two characters.')
        return
      }
      const requestedCursor = append ? cursor : null
      if (append && (!requestedCursor || searchRequestInFlight.current || (!retry && requestedCursors.current.has(requestedCursor)))) return
      const requestId = append ? searchRequestId.current : ++searchRequestId.current
      searchRequestInFlight.current = true
      setIsSearching(true)
      if (requestedCursor !== null) {
        requestedCursors.current.add(requestedCursor)
        setPageError(null)
      } else {
        requestedCursors.current.clear()
        setError(null)
        setPageError(null)
        setOffline(false)
        setResults([])
        setCursor(null)
        setWarnings([])
        setSearchedQuery(askedQuery)
      }
      try {
        const response = await api.media.search({ q: askedQuery, source: askedSource, cursor: requestedCursor })
        if (requestId !== searchRequestId.current) return
        setResults((current) => dedupeItems(append ? [...current, ...response.items] : response.items))
        setCursor(response.nextCursor)
        setWarnings(response.warnings)
        setPixabayAvailable(response.pixabayAvailable)
        setOffline(false)
      } catch (cause) {
        if (requestId !== searchRequestId.current) return
        const isOffline = cause instanceof BridgeRequestError && cause.code === 'OFFLINE'
        const message = cause instanceof Error ? cause.message : 'Image search failed'
        if (isOffline) setOffline(true)
        if (append) setPageError(isOffline ? OFFLINE_NOTICE : message)
        else if (!isOffline) setError(message)
      } finally {
        if (requestId === searchRequestId.current) {
          searchRequestInFlight.current = false
          setIsSearching(false)
        }
      }
    },
    [cursor, query, searchedQuery, source],
  )

  loadNextPageRef.current = () => {
    void runSearch({ append: true })
  }

  // The infinite scroll: one observer on a sentinel at the end of the grid, re-armed whenever the
  // cursor moves. It is never armed for a cursor already asked for, so a page cannot load twice.
  useEffect(() => {
    const sentinel = searchSentinelRef.current
    if (view !== 'search' || !cursor || pageError || isSearching || requestedCursors.current.has(cursor) || !sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadNextPageRef.current()
      },
      { root: searchGridRef.current, rootMargin: '160px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [cursor, isSearching, pageError, view])

  const addItem = async (item: StudioItem) => {
    if (excalidrawAPI === null || insertingKey) return
    setInsertingKey(item.itemKey)
    setError(null)
    try {
      let recorded = item
      if (item.provider === 'shape') {
        const shape = getShape(catalog, item.providerId)
        if (shape === undefined) throw new Error('That shape is not available yet.')
        insertShape(engine, excalidrawAPI, shape)
      } else {
        const imported = await api.media.import({ provider: item.provider, id: item.providerId })
        await insertImage(excalidrawAPI, fileFromImport(item, imported))
        // Main's item is what the provider says NOW — a fresh size and attribution for the MRU
        // row — layered over the caller's, which knows the pretty collection name a search gave it.
        recorded = { ...item, ...imported.item }
      }
      setRecent(await api.media.recent({ op: 'record', item: recorded }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add item')
    } finally {
      setInsertingKey(null)
    }
  }

  const toggleFavorite = async (item: StudioItem) => {
    if (busyFavoriteKey) return
    setBusyFavoriteKey(item.itemKey)
    setError(null)
    try {
      setFavorites(favoriteKeys.has(item.itemKey) ? await api.media.favorites({ op: 'remove', itemKey: item.itemKey }) : await api.media.favorites({ op: 'add', item }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change favorites')
    } finally {
      setBusyFavoriteKey(null)
    }
  }

  return (
    <div className="image-studio">
      <header className="image-studio__header">
        <div>
          <span>IMAGE STUDIO</span>
          <strong>Add visuals</strong>
        </div>
      </header>
      <nav className="image-studio__nav" aria-label="Image Studio sections">
        {STUDIO_VIEWS.map((tab) => (
          <button type="button" key={tab} className={view === tab ? 'is-active' : undefined} aria-pressed={view === tab} onClick={() => setView(tab)}>
            {VIEW_LABELS[tab]}
          </button>
        ))}
      </nav>

      {view === 'search' && (
        <form
          className="image-studio__search"
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch({})
          }}
        >
          <select
            aria-label="Search source"
            value={source}
            onChange={(event) => {
              const nextSource = event.target.value as MediaSearchSource
              setSource(nextSource)
              if (searchedQuery) void runSearch({ nextQuery: searchedQuery, nextSource })
            }}
          >
            <option value="all">All</option>
            <option value="iconify">Iconify</option>
            {/* 🔒 D4: with no key there is no Pixabay to offer, and nothing to explain here. */}
            {pixabayAvailable && <option value="pixabay">Pixabay</option>}
          </select>
          <input
            ref={searchInputRef}
            type="search"
            aria-label="Search graphics, icons, and logos"
            placeholder="Search graphics, icons, and logos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="submit" disabled={isSearching}>
            {isSearching ? '…' : 'Search'}
          </button>
        </form>
      )}
      {view === 'shapes' && (
        <div className="image-studio__search">
          <input type="search" aria-label="Search shapes" placeholder="Search shapes" value={shapeQuery} onChange={(event) => setShapeQuery(event.target.value)} />
        </div>
      )}

      {!canInsert && <div className="image-studio__notice">The canvas is still loading.</div>}
      {view === 'search' && offline && (
        <div className="image-studio__notice" role="status">
          {OFFLINE_NOTICE}
        </div>
      )}
      {view === 'search' && warnings.length > 0 && <div className="image-studio__warning">{warnings.join(' ')}</div>}
      {error && <div className="image-studio__error">{error}</div>}

      <div className="image-studio__grid" ref={searchGridRef}>
        {displayedItems.map((item) => {
          const catalogShape = item.provider === 'shape' ? getShape(catalog, item.providerId) : undefined
          const favorited = favoriteKeys.has(item.itemKey)
          return (
            <article className="image-studio__card" key={item.itemKey}>
              <button
                type="button"
                className="image-studio__add"
                disabled={!canInsert || insertingKey !== null}
                onClick={() => void addItem(item)}
                aria-label={`Add ${item.title}`}
              >
                <span className="image-studio__preview">
                  {catalogShape ? <ShapePreview preview={catalogShape.preview} /> : <RemotePreview item={item} />}
                  {insertingKey === item.itemKey && <span className="image-studio__adding">Adding…</span>}
                </span>
                <span className="image-studio__meta">
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind}
                    {item.collectionName ? ` · ${item.collectionName}` : ''}
                  </small>
                </span>
              </button>
              <button
                type="button"
                className={favorited ? 'image-studio__favorite is-active' : 'image-studio__favorite'}
                aria-label={favorited ? `Remove ${item.title} from favorites` : `Add ${item.title} to favorites`}
                aria-pressed={favorited}
                disabled={busyFavoriteKey !== null}
                onClick={() => void toggleFavorite(item)}
              >
                {favorited ? '★' : '☆'}
              </button>
            </article>
          )
        })}
        {view === 'search' && cursor && results.length > 0 && <div className="image-studio__search-sentinel" ref={searchSentinelRef} aria-hidden="true" />}
      </div>

      {displayedItems.length === 0 && (
        <div className="image-studio__empty">
          {view === 'search'
            ? 'Search once, then add anything from the mixed results.'
            : view === 'favorites'
              ? 'Star an item and it will stay available in every board.'
              : view === 'recent'
                ? 'Items you add will appear here across every board.'
                : shapeQuery
                  ? 'No shapes match your search.'
                  : 'No items found.'}
        </div>
      )}
      {view === 'search' && pageError && cursor && (
        <>
          <div className="image-studio__error" role="alert">
            {pageError}
          </div>
          <button type="button" className="image-studio__retry" disabled={isSearching} onClick={() => void runSearch({ append: true, retry: true })}>
            {isSearching ? 'Retrying…' : 'Retry loading results'}
          </button>
        </>
      )}
      {view === 'search' && isSearching && results.length > 0 && (
        <div className="image-studio__loading-more" role="status">
          Loading more…
        </div>
      )}
      <footer className="image-studio__footer">Graphics via Pixabay · icons via Iconify. Check source details and trademarks before publishing.</footer>
    </div>
  )
}
