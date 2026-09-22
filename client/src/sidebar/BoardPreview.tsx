/**
 * THE HOVER PREVIEW PANEL (YAZ-1800): a big picture of the whole board, beside the sidebar, while
 * the mouse rests on its row. Portalled to `<body>` and `pointer-events: none` — it is a glance,
 * never a surface: nothing in it can be clicked, and it never steals the hover from the row.
 *
 * The Sidebar decides WHEN (the dwell and every close); this decides WHERE and WHAT — the placement
 * is measured off the sidebar's own rect and re-measured on resize, scroll and a sidebar resize.
 */
import { useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { FileNode } from '@shared/treeSort'
import { boardFolder, stripExt } from '../lib/paths'
import { boardPreviews } from './boardPreviewCache'

const GAP = 16
const WIDTH_RATIO = 0.575
const HEIGHT_RATIO = 0.68
const MAX_H_RATIO = 0.7
const MIN_H = 220

export interface BoardPreviewPlacement {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the panel goes (YAZ-1800): right of the sidebar with a gap, a little over half of the
 * room left, landscape-ish, vertically centred. Null when the window leaves no room at all.
 */
export function boardPreviewPlacement(sidebarRight: number, innerWidth: number, innerHeight: number): BoardPreviewPlacement | null {
  const usable = innerWidth - sidebarRight - GAP
  const width = Math.min(Math.round(usable * WIDTH_RATIO), usable - GAP)
  const height = Math.min(Math.round(innerHeight * MAX_H_RATIO), Math.max(MIN_H, Math.round(width * HEIGHT_RATIO)))
  if (width <= 0 || height <= 0) return null
  return { left: sidebarRight + GAP, top: Math.max(GAP, Math.round((innerHeight - height) / 2)), width, height }
}

/** The placement, kept live against the window and the sidebar's own size. */
function usePlacement(anchor: RefObject<HTMLElement | null>): BoardPreviewPlacement | null {
  const [placement, setPlacement] = useState<BoardPreviewPlacement | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const el = anchor.current
      setPlacement(el === null ? null : boardPreviewPlacement(el.getBoundingClientRect().right, window.innerWidth, window.innerHeight))
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    const observer = typeof ResizeObserver === 'undefined' || anchor.current === null ? null : new ResizeObserver(place)
    if (observer !== null && anchor.current !== null) observer.observe(anchor.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      observer?.disconnect()
    }
  }, [anchor])
  return placement
}

interface BoardPreviewProps {
  root: string
  node: FileNode
  /** `boardPreviewKey(root, node, theme)` — a new key (a save, a theme flip) swaps the picture in place. */
  cacheKey: string
  /** The `<aside className="sidebar">` the panel sits beside. */
  anchor: RefObject<HTMLElement | null>
}

export function BoardPreview({ root, node, cacheKey, anchor }: BoardPreviewProps) {
  const placement = usePlacement(anchor)
  // The last settled picture. Mounted `key={path}` by the Sidebar, so a stale one is always THIS board's —
  // shown while a new key (a save, a theme flip) draws, instead of flashing "Loading".
  // What the cache answered: undefined = still drawing, '' = an empty board, null = it could not be drawn.
  const [picture, setPicture] = useState<string | null | undefined>(undefined)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void boardPreviews.load(cacheKey).then((value) => {
      if (live) setPicture(value)
    })
    return () => {
      live = false
    }
  }, [cacheKey])

  if (placement === null) return null
  const name = stripExt(node.name)
  const src = picture || null // '' (empty) and null (failed) have no picture, like undefined (drawing)
  const message = picture === undefined ? 'Loading preview…' : picture === '' ? 'Empty board' : picture === null ? 'Preview unavailable' : null
  return createPortal(
    <div className="board-preview" role="status" aria-live="polite" aria-label={`Preview of ${name}`} style={placement}>
      <div className="board-preview__header">
        <span className="board-preview__name">{name}</span>
        <span className="board-preview__folder">{boardFolder(root, node.path)}</span>
      </div>
      <div className="board-preview__body">
        {src !== null && (
          <img
            className={`board-preview__img${loadedSrc === src ? ' board-preview__img--loaded' : ''}`}
            src={src}
            alt=""
            onLoad={() => setLoadedSrc(src)}
          />
        )}
        {message !== null && <p className="board-preview__msg">{message}</p>}
      </div>
    </div>,
    document.body,
  )
}
