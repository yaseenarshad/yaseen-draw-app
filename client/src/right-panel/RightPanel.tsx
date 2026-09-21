import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { RIGHT_PANEL_MAX_W, RIGHT_PANEL_MIN_W } from '@shared/types'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { basename, stripExt } from '../lib/paths'
import { readPageDrag, writePageDrag, type PageDrag } from '../workspace/pageDrag'
import './right-panel.css'

export interface RightPanelProps {
  items: readonly string[]
  expanded: string | null
  width: number
  overlay: boolean
  canBack: boolean
  canForward: boolean
  onBack(): void
  onForward(): void
  onToggle(path: string): void
  onClose(path: string): void
  onHide(): void
  onResizeCommit(width: number): void
  onDropPage?: (page: PageDrag, at: number) => void
  onMoveToMain?: (path: string) => void
  children?: ReactNode
}

const HIDE_THRESHOLD = 192
const KEYBOARD_STEP = 16
const clamp = (width: number): number => Math.min(RIGHT_PANEL_MAX_W, Math.max(RIGHT_PANEL_MIN_W, width))

const Chevron = ({ d }: { d: string }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

export function RightPanel({ items, expanded, width, overlay, canBack, canForward, onBack, onForward, onToggle, onClose, onHide, onResizeCommit, onDropPage, onMoveToMain, children }: RightPanelProps) {
  const [previewWidth, setPreviewWidth] = useState(width)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const headerRefs = useRef(new Map<string, HTMLButtonElement>())
  const hideRef = useRef<HTMLButtonElement | null>(null)
  const resizeCleanup = useRef<(() => void) | null>(null)

  useEffect(() => setPreviewWidth(width), [width])
  useEffect(() => () => resizeCleanup.current?.(), [])
  useEffect(() => {
    if (menu !== null && !items.includes(menu.path)) setMenu(null)
  }, [items, menu])
  useEffect(() => {
    if (dropAt === null) return
    const clear = () => setDropAt(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear()
    }
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
      window.removeEventListener('keydown', onKey)
    }
  }, [dropAt])

  const startResize = (event: ReactMouseEvent): void => {
    event.preventDefault()
    resizeCleanup.current?.()
    const x0 = event.clientX
    let raw = width
    let next = width
    const move = (e: MouseEvent) => {
      raw = width + x0 - e.clientX
      next = clamp(raw)
      setPreviewWidth(next)
    }
    const cleanup = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      resizeCleanup.current = null
    }
    const up = () => {
      cleanup()
      setPreviewWidth(width)
      if (raw < HIDE_THRESHOLD) onHide()
      else if (next !== width) onResizeCommit(next)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
    resizeCleanup.current = cleanup
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = clamp(width + KEYBOARD_STEP)
    if (event.key === 'ArrowRight') next = clamp(width - KEYBOARD_STEP)
    if (event.key === 'Home') next = RIGHT_PANEL_MIN_W
    if (event.key === 'End') next = RIGHT_PANEL_MAX_W
    if (next === null) return
    event.preventDefault()
    if (next !== width) onResizeCommit(next)
  }

  const close = (path: string, index: number): void => {
    const focusPath = items[index + 1] ?? items[index - 1]
    onClose(path)
    queueMicrotask(() => {
      if (focusPath !== undefined) headerRefs.current.get(focusPath)?.focus()
      else hideRef.current?.focus()
    })
  }

  const insertionAt = (event: DragEvent, index: number): number => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? index : index + 1
  }

  const pageFrom = (event: DragEvent): PageDrag | null => {
    if (onDropPage === undefined || event.dataTransfer === null) return null
    const page = readPageDrag(event.dataTransfer)
    if (page === null) return null
    if (page.owner === 'main' && items.includes(page.path)) return null
    if (page.owner === 'right' && !items.includes(page.path)) return null
    return page
  }

  const hoverDrop = (event: DragEvent, at: number): void => {
    if (pageFrom(event) === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    if (dropAt !== at) setDropAt(at)
  }

  const dropPage = (event: DragEvent, at: number): void => {
    const page = pageFrom(event)
    setDropAt(null)
    if (page === null) return
    event.preventDefault()
    onDropPage?.(page, at)
  }

  return (
    <aside
      className={`right-panel${overlay ? ' right-panel--overlay' : ''}`}
      role="complementary"
      aria-label="Right panel"
      style={{ '--right-panel-width': `${previewWidth}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (overlay && event.key === 'Escape') {
          event.preventDefault()
          onHide()
        }
      }}
    >
      <div
        className="right-panel__resize"
        role="separator"
        aria-label="Resize right panel"
        aria-orientation="vertical"
        aria-valuemin={RIGHT_PANEL_MIN_W}
        aria-valuemax={RIGHT_PANEL_MAX_W}
        aria-valuenow={previewWidth}
        tabIndex={0}
        onMouseDown={startResize}
        onKeyDown={resizeByKeyboard}
      />
      <div className="right-panel__toolbar">
        <button type="button" className="right-panel__tool" aria-label="Back in right panel" title="Back" disabled={!canBack} onClick={onBack}>
          <Chevron d="m10 4-4 4 4 4" />
        </button>
        <button type="button" className="right-panel__tool" aria-label="Forward in right panel" title="Forward" disabled={!canForward} onClick={onForward}>
          <Chevron d="m6 4 4 4-4 4" />
        </button>
        <span className="right-panel__toolbar-spacer" />
        <button ref={hideRef} type="button" className="right-panel__tool right-panel__hide" aria-label="Hide right panel" title="Hide right panel" onClick={onHide}>
          <Chevron d="m11 4-4 4 4 4" />
        </button>
      </div>
      <ul
        className={`right-panel__headers${dropAt === items.length && items.length === 0 ? ' right-panel__headers--drop-empty' : ''}`}
        aria-label="Open pages in right panel"
        onDragOver={(event) => {
          if (event.target === event.currentTarget) hoverDrop(event, items.length)
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) dropPage(event, items.length)
        }}
        onDragLeave={(event) => {
          if (event.target === event.currentTarget && !event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null)
        }}
      >
        {items.map((path, index) => {
          const label = stripExt(basename(path))
          const isExpanded = path === expanded
          const cls = ['right-panel__item']
          if (isExpanded) cls.push('right-panel__item--expanded')
          if (dropAt === index) cls.push('right-panel__item--insert-before')
          if (dropAt === items.length && index === items.length - 1) cls.push('right-panel__item--insert-after')
          return (
            <li
              key={path}
              className={cls.join(' ')}
              onDragOver={(event) => hoverDrop(event, insertionAt(event, index))}
              onDrop={(event) => dropPage(event, insertionAt(event, index))}
            >
              <button
                ref={(node) => {
                  if (node === null) headerRefs.current.delete(path)
                  else headerRefs.current.set(path, node)
                }}
                type="button"
                className="right-panel__header"
                aria-expanded={isExpanded}
                title={path}
                draggable
                onDragStart={(event) => {
                  if (event.dataTransfer) writePageDrag(event.dataTransfer, { path, owner: 'right' })
                  setDropAt(null)
                }}
                onDragEnd={() => setDropAt(null)}
                onContextMenu={(event) => {
                  if (onMoveToMain === undefined) return
                  event.preventDefault()
                  setMenu({ x: event.clientX, y: event.clientY, path })
                }}
                onClick={() => onToggle(path)}
              >
                <Chevron d={isExpanded ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
                <span className="right-panel__label">{label}</span>
              </button>
              <button type="button" className="right-panel__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => close(path, index)}>
                ×
              </button>
            </li>
          )
        })}
      </ul>
      <div
        className={`right-panel__viewer${items.length === 0 && dropAt === 0 ? ' right-panel__viewer--drop-empty' : ''}`}
        onDragOver={(event) => {
          if (items.length === 0) hoverDrop(event, 0)
        }}
        onDrop={(event) => {
          if (items.length === 0) dropPage(event, 0)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null)
        }}
      >
        {items.length === 0 ? <p className="right-panel__empty">Open a page in the right panel</p> : children}
      </div>
      {menu !== null && (
        <ContextMenuSurface x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onMoveToMain?.(menu.path)
              setMenu(null)
            }}
          >
            Move to main tabs
          </button>
        </ContextMenuSurface>
      )}
    </aside>
  )
}
