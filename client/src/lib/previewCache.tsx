/**
 * THE PREVIEW CACHE both canvas-panel grids draw their tiles through (YAZ-1818, YAZ-1819).
 *
 * A tile re-mounts on every view switch and every keystroke in a filter field, and an IPC round
 * trip per tile per re-render is a visible stutter. One map of settled dataURLs plus one of
 * in-flight promises makes every look after the first free, and the in-flight map is what stops
 * ten tiles for the same key asking ten times.
 *
 * A picture that cannot be had is a PLACEHOLDER, never an error — offline, no API key for a
 * favorited graphic, a component whose PNG went missing. The tile still inserts either way.
 */
import { useEffect, useState, type ReactNode } from 'react'

export interface PreviewCache {
  /** The dataURL for `key`, or null when it could not be had. One request per key, shared. */
  load(key: string): Promise<string | null>
  /** Forget everything — the library changed, or a test must not inherit another's memo. */
  clear(): void
  /** The tile's picture: an `<img>` once there is one, the placeholder until then (or never). */
  Preview(props: { cacheKey: string | null; placeholderClass: string }): ReactNode
}

/**
 * One cache per kind of preview; `fetchPreview` is the door that answers a key with a dataURL.
 * `limit` bounds how many settled pictures are kept, least recently seen out first (YAZ-1800: a
 * board's picture is ~1200 px and keyed per edit, so an unbounded map would only ever grow).
 */
export function createPreviewCache(fetchPreview: (key: string) => Promise<string>, { limit = Infinity }: { limit?: number } = {}): PreviewCache {
  const settledByKey = new Map<string, string>()
  const inFlight = new Map<string, Promise<string | null>>()

  const load = (key: string): Promise<string | null> => {
    const settled = settledByKey.get(key)
    if (settled !== undefined) {
      // Map iterates in insertion order, so the front is least recently seen: re-set to move to the back.
      settledByKey.delete(key)
      settledByKey.set(key, settled)
      return Promise.resolve(settled)
    }
    const existing = inFlight.get(key)
    if (existing !== undefined) return existing
    const request = fetchPreview(key)
      .then((dataURL) => {
        if (settledByKey.size >= limit) settledByKey.delete(settledByKey.keys().next().value as string)
        settledByKey.set(key, dataURL)
        return dataURL
      })
      .catch(() => null)
      .finally(() => inFlight.delete(key))
    inFlight.set(key, request)
    return request
  }

  return {
    load,
    clear: () => {
      settledByKey.clear()
      inFlight.clear()
    },
    Preview: ({ cacheKey, placeholderClass }) => {
      // A key already settled paints on the first render, so a re-mount never flashes a placeholder.
      const [src, setSrc] = useState<string | null>(() => (cacheKey === null ? null : (settledByKey.get(cacheKey) ?? null)))
      useEffect(() => {
        if (cacheKey === null) return
        let live = true
        void load(cacheKey).then((dataURL) => {
          if (live) setSrc(dataURL)
        })
        return () => {
          live = false
        }
      }, [cacheKey])
      if (src === null) return <span className={placeholderClass} aria-hidden="true" />
      return <img src={src} alt="" loading="lazy" />
    },
  }
}
