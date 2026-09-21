/**
 * PREVIEW MODE (YAZ-1244): hovering a table row / board card holds the page's rendered body up
 * beside it, read-only. `usePreview` is the whole feature — the caller spreads `rowProps(record)`
 * on its rows, renders `card` wherever it likes, and calls `close()` when a drag starts.
 *
 * INTENT, NOT MOTION: nothing opens and nothing is READ until the cursor has rested OPEN_DELAY_MS,
 * so dragging the mouse across a table is silent. Leaving starts a CLOSE_GRACE_MS grace the card
 * itself can catch — the cursor is allowed to travel from the row onto the card and stay there.
 * There is only ever ONE card: hovering another row re-targets this one.
 *
 * READ, NEVER OPEN: the body comes from `api.readFile` directly, never the `useFile` hook — a
 * preview must not put the file on the editor's save path. Bodies are cached per path and
 * invalidated by `mtime`, so re-hovering the same row costs nothing; a REJECTED read is dropped
 * from the cache so the next hover retries instead of re-serving the failure.
 *
 * The instance is a real Crepe with BlockEdit and the Toolbar off and no wikilink/find/drawing
 * options — the plugins that exist to EDIT are simply never registered — then `setReadonly(true)`.
 */
import { type CSSProperties, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CrepeFeature } from '@milkdown/crepe'
import type { FileResponse, IndexRecord } from '@shared/types'
import { splitFrontmatter } from '@shared/frontmatter'
import { api } from '../../api'
import { createCrepe } from '../../editor/createCrepe'
import { features } from '../../editor/featureConfig'
import './previewCard.css'

/** Hover intent: the cursor must rest this long before anything opens or is read. */
export const OPEN_DELAY_MS = 300
/** The window after leaving in which the cursor may land on the card and keep it alive. */
export const CLOSE_GRACE_MS = 200

/** The note editor's features minus the two that exist to edit blocks. */
const previewFeatures = { ...features, [CrepeFeature.BlockEdit]: false, [CrepeFeature.Toolbar]: false }

interface CacheEntry {
  mtime: number
  content: Promise<FileResponse>
}

const cache = new Map<string, CacheEntry>()

function readCached(record: IndexRecord): Promise<FileResponse> {
  const hit = cache.get(record.path)
  if (hit !== undefined && hit.mtime === record.mtime) return hit.content
  const entry: CacheEntry = { mtime: record.mtime, content: api.readFile(record.path) }
  // Consumers handle the failure; this both silences the unhandled-rejection noise and un-caches
  // the rejection so the next hover reads again. Only THIS entry goes — a newer read may have won.
  entry.content.catch(() => {
    if (cache.get(record.path) === entry) cache.delete(record.path)
  })
  cache.set(record.path, entry)
  return entry.content
}

/** Test hook: drops every cached body. */
export function _resetPreviewCache(): void {
  cache.clear()
}

type Content = { kind: 'loading' } | { kind: 'body'; body: string } | { kind: 'empty' } | { kind: 'error' }

interface CardProps {
  record: IndexRecord
  anchor: HTMLElement
  onEnter: () => void
  onLeave: () => void
}

function PreviewCard({ record, anchor, onEnter, onLeave }: CardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [content, setContent] = useState<Content>({ kind: 'loading' })
  const [pos, setPos] = useState<CSSProperties>()

  useEffect(() => {
    let live = true
    readCached(record).then(
      (file) => {
        if (!live) return
        const body = splitFrontmatter(file.content).body
        setContent(body.trim() === '' ? { kind: 'empty' } : { kind: 'body', body })
      },
      () => live && setContent({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [record])

  // Placed ONCE, under the row when it fits and above it when it does not, clamped to the viewport
  // like `Popover` — the card follows the cursor's row, not its scrolling.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const a = anchor.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const below = a.bottom + 6
    const top = below + r.height <= window.innerHeight ? below : a.top - 6 - r.height
    setPos({
      top: Math.max(0, Math.min(top, window.innerHeight - r.height)),
      left: Math.max(0, Math.min(a.left, window.innerWidth - r.width)),
    })
  }, [anchor])

  useEffect(() => {
    const host = hostRef.current
    if (content.kind !== 'body' || host === null) return
    // Own wrapper per effect run (StrictMode mounts twice) wearing the note editor's class, so the
    // editor stylesheets apply to the preview unchanged.
    const el = document.createElement('div')
    el.className = 'editor-instance'
    host.appendChild(el)
    // No `image` options (YAZ-1656): the card knows the record's path but not the vault root, and a
    // vault-relative src has nothing to resolve against without it — images stay Crepe's stock `<img>`.
    const crepe = createCrepe({ root: el, defaultValue: content.body, features: previewFeatures })
    const ready = crepe.create().then(() => crepe.setReadonly(true))
    return () => {
      void ready.then(() => crepe.destroy()).finally(() => el.remove())
    }
  }, [content])

  return (
    <div ref={ref} className="view-preview" style={pos} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <div className="view-preview__body" ref={hostRef}>
        {content.kind === 'error' && <div className="view-preview__error">Couldn&apos;t load preview</div>}
        {content.kind === 'empty' && <div className="view-preview__empty">Empty page</div>}
      </div>
    </div>
  )
}

interface Target {
  record: IndexRecord
  anchor: HTMLElement
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

export interface PreviewHandle {
  /** Hover handlers to spread on a row; `undefined` while preview mode is off. */
  rowProps: (record: IndexRecord) => { onMouseEnter: (e: MouseEvent<HTMLElement>) => void; onMouseLeave: () => void } | undefined
  /** The one open card, or null. */
  card: ReactNode
  /** Shut it now — what a drag start calls. */
  close: () => void
}

export function usePreview(enabled: boolean): PreviewHandle {
  const [target, setTarget] = useState<Target | null>(null)
  const openTimer: TimerRef = useRef(null)
  const closeTimer: TimerRef = useRef(null)

  const stop = useCallback((timer: TimerRef) => {
    if (timer.current === null) return
    clearTimeout(timer.current)
    timer.current = null
  }, [])

  const close = useCallback(() => {
    stop(openTimer)
    stop(closeTimer)
    setTarget(null)
  }, [stop])

  const scheduleClose = useCallback(() => {
    stop(closeTimer)
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null
      setTarget(null)
    }, CLOSE_GRACE_MS)
  }, [stop])

  const keepOpen = useCallback(() => stop(closeTimer), [stop])

  useEffect(
    () => () => {
      stop(openTimer)
      stop(closeTimer)
    },
    [stop],
  )

  const rowProps = (record: IndexRecord) => {
    if (!enabled) return undefined
    return {
      onMouseEnter: (e: MouseEvent<HTMLElement>) => {
        const anchor = e.currentTarget
        stop(openTimer)
        stop(closeTimer)
        openTimer.current = setTimeout(() => {
          openTimer.current = null
          setTarget({ record, anchor })
        }, OPEN_DELAY_MS)
      },
      onMouseLeave: () => {
        stop(openTimer)
        scheduleClose()
      },
    }
  }

  const card =
    target === null ? null : (
      // Keyed by path: re-targeting another row is a fresh card, never a half-swapped one.
      <PreviewCard key={target.record.path} record={target.record} anchor={target.anchor} onEnter={keepOpen} onLeave={scheduleClose} />
    )

  return { rowProps, card, close }
}
