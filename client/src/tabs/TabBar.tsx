import { useEffect, useRef, useState, type DragEvent } from 'react'
import { api, BridgeRequestError } from '../api'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { dropIndex, insertionSlot } from '../lib/dragSlot'
import { isMarkdown } from '@shared/fileKind'
import { copyForAgent } from '../lib/copyForAgent'
import { basename, stripExt } from '../lib/paths'
import { SidebarPanelIcon } from '../views/view/icons'
import { readPageDrag, writePageDrag, type PageDrag } from '../workspace/pageDrag'
import './tabs.css'

export interface TabBarProps {
  /** Open tabs, absolute paths, left→right. */
  tabs: readonly string[]
  /** The active tab (the window's `file`); null with no tabs open. */
  active: string | null
  onActivate: (path: string) => void
  onClose: (path: string) => void
  /** Drag-to-reorder (I3, GRO-2235): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** A validated page dropped from the right panel at a tab insertion slot. */
  onDropPage?: (page: PageDrag, at: number) => void
  /** Context-menu equivalent of dragging this tab into the right panel. */
  onMoveToRight?: (path: string) => void
  /** History (YAZ-721): the active tab's own back/forward stack has somewhere to go. */
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  /**
   * Collapsed sidebar (YAZ-1759): the reopen control sits HERE, left of ◀, instead of floating
   * over it. Absent while the sidebar is open.
   */
  onShowSidebar?: () => void
  /** Reveal this exact tab in the sidebar without activating it. */
  onShowInSidebar?: (path: string) => void
  /**
   * Where a failed OS action says so (YAZ-963) — App's passive notice. Optional: a mount with
   * nowhere to show one loses the message, never the gesture.
   */
  onNotice?: (message: string) => void
}

/** In-flight drag state: the grabbed tab's index + the hovered insertion slot (0…tabs.length). */
interface DragState {
  from: number
  over: number | null
}

const Chevron = ({ d }: { d: string }) => (
  <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
)

/**
 * The window tab strip (Tabs I2/I3, GRO-2234/2235): one tab per open file, ViewTabs' tablist
 * semantics (role=tab, aria-selected, active underline). Labels hide only Markdown's vault
 * extension; view-only labels keep their extension and every full path lives in the title
 * tooltip. Tabs reorder by HTML5 drag (the
 * groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none) with an accent
 * insertion indicator; the strip scrolls when full and keeps the ACTIVE tab in view. Left of
 * the strip sit the ◀ ▶ history buttons (YAZ-721), disabled when the active tab's stack has
 * nowhere to go — buttons only, per LOCKED ruling D2: no shortcut, no menu item.
 * Presentational only — all durable state changes go through workspace callbacks.
 */
export function TabBar({ tabs, active, onActivate, onClose, onMove, onDropPage, onMoveToRight, canBack, canForward, onBack, onForward, onShowSidebar, onShowInSidebar, onNotice }: TabBarProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [externalOver, setExternalOver] = useState<number | null>(null)
  // Right-click menu (YAZ-922): the tab IS the file, so it offers the sidebar row's Copy path —
  // and since YAZ-963 that row's OS actions too (Reveal in Finder, Open in VS Code).
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const activeRef = useRef<HTMLDivElement | null>(null)

  // Overflow polish (I3): tabs shrink to a floor and the strip scrolls, so scroll the active
  // tab fully into view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])
  useEffect(() => {
    if (externalOver === null) return
    const clear = () => setExternalOver(null)
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
  }, [externalOver])

  const drop = (insertion: number): void => {
    if (drag === null) return
    setDrag(null)
    const to = dropIndex(drag.from, insertion)
    if (to !== drag.from) onMove(drag.from, to)
  }

  const externalPage = (event: DragEvent): PageDrag | null => {
    if (drag !== null || onDropPage === undefined || event.dataTransfer === null) return null
    const page = readPageDrag(event.dataTransfer)
    return page?.owner === 'right' && !tabs.includes(page.path) ? page : null
  }

  const dropExternal = (event: DragEvent, insertion: number): void => {
    const page = externalPage(event)
    setExternalOver(null)
    if (page === null) return
    event.preventDefault()
    onDropPage?.(page, insertion)
  }

  /**
   * The menu's OS actions (YAZ-963), the sidebar's `reveal` idiom on a tab: read-only, so the
   * menu closes at once and there is nothing to confirm or repair — but a STALE tab (deleted or
   * moved externally) rejects `NOT_FOUND`, and without the notice the item would just look
   * broken. Both messages are the caller's, because "reveal" and "open … in VS Code" name the
   * gesture differently in each half.
   */
  const osAction = (call: Promise<unknown>, stale: string, failed: string): void => {
    setMenu(null)
    call.catch((err: unknown) => {
      onNotice?.(err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? stale : `${failed}: ${err instanceof Error ? err.message : String(err)}`)
    })
  }

  return (
    <div className="tabbar-row">
      <div className="tabbar-nav">
        {onShowSidebar && (
          <button type="button" className="tabbar-nav__btn" aria-label="Show sidebar" title="Show sidebar" onClick={onShowSidebar}>
            <SidebarPanelIcon />
          </button>
        )}
        <button type="button" className="tabbar-nav__btn" aria-label="Back" title="Back" disabled={!canBack} onClick={onBack}>
          <Chevron d="m10 4-4 4 4 4" />
        </button>
        <button type="button" className="tabbar-nav__btn" aria-label="Forward" title="Forward" disabled={!canForward} onClick={onForward}>
          <Chevron d="m6 4 4 4-4 4" />
        </button>
      </div>
      <div
        className={`tabbar scroll-strip${externalOver === 0 && tabs.length === 0 ? ' tabbar--drop-empty' : ''}`}
        role="tablist"
        aria-label="Open files"
        onDragOver={(e) => {
          // The empty strip tail: only direct hits — tab hovers are handled (and marked) per tab.
          if (e.target !== e.currentTarget) return
          if (drag !== null) {
            e.preventDefault()
            if (drag.over !== tabs.length) setDrag({ ...drag, over: tabs.length })
            return
          }
          if (externalPage(e) === null) return
          e.preventDefault()
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
          if (externalOver !== tabs.length) setExternalOver(tabs.length)
        }}
        onDrop={(e) => {
          if (e.target !== e.currentTarget) return
          if (drag !== null) {
            e.preventDefault()
            drop(tabs.length)
          } else dropExternal(e, tabs.length)
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget && !e.currentTarget.contains(e.relatedTarget as Node | null)) setExternalOver(null)
        }}
      >
        {tabs.map((path, i) => {
          const isActive = path === active
          const label = stripExt(basename(path))
          const cls = ['tabbar__tab']
          if (isActive) cls.push('tabbar__tab--active')
          if (drag !== null && drag.from === i) cls.push('tabbar__tab--dragging')
          // The insertion indicator: an accent edge on the tab the drop would land before —
          // or after the LAST tab for the end slot.
          const over = drag?.over ?? externalOver
          if (over === i) cls.push('tabbar__tab--insert-before')
          if (over === tabs.length && i === tabs.length - 1) cls.push('tabbar__tab--insert-after')
          return (
            <div
              key={path}
              ref={isActive ? activeRef : undefined}
              className={cls.join(' ')}
              draggable
              onDragStart={(e) => {
                if (e.dataTransfer) writePageDrag(e.dataTransfer, { path, owner: 'main' })
                setExternalOver(null)
                setDrag({ from: i, over: null })
              }}
              onDragEnd={() => {
                setDrag(null)
                setExternalOver(null)
              }}
              onDragOver={(e) => {
                const over = insertionSlot(e, i)
                if (drag !== null) {
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  if (drag.over !== over) setDrag({ ...drag, over })
                  return
                }
                if (externalPage(e) === null) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                if (externalOver !== over) setExternalOver(over)
              }}
              onDrop={(e) => {
                const at = insertionSlot(e, i)
                if (drag !== null) {
                  e.preventDefault()
                  drop(at)
                } else dropExternal(e, at)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path })
              }}
            >
              <button
                type="button"
                role="tab"
                className="tabbar__btn"
                aria-selected={isActive}
                title={path}
                onClick={() => onActivate(path)}
                onAuxClick={(e) => {
                  // Middle-click closes — the browser-tab convention.
                  if (e.button === 1) onClose(path)
                }}
              >
                <span className="tabbar__label">{label}</span>
              </button>
              <button type="button" className="tabbar__close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={() => onClose(path)}>
                ✕
              </button>
            </div>
          )
        })}
      </div>
      {menu !== null && (
        <ContextMenuSurface x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {onMoveToRight !== undefined && (
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              onClick={() => {
                onMoveToRight(menu.path)
                setMenu(null)
              }}
            >
              Move to right panel
            </button>
          )}
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              onShowInSidebar?.(menu.path)
              setMenu(null)
            }}
          >
            Show in sidebar
          </button>
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              void navigator.clipboard.writeText(menu.path)
              setMenu(null)
            }}
          >
            Copy path
          </button>
          {/* Right under Copy path (YAZ-1617 🔒 D2), Markdown pages only: the tab IS the file, so it offers the sidebar row's handshake too. */}
          {isMarkdown(menu.path) && (
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              onClick={() => {
                void copyForAgent(menu.path, onNotice)
                setMenu(null)
              }}
            >
              Copy for Agent
            </button>
          )}
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => osAction(api.reveal({ path: menu.path }), `Can't reveal "${basename(menu.path)}" — it is no longer there`, "Can't reveal")}>
            Reveal in Finder
          </button>
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={() => osAction(api.openVsCode({ path: menu.path }), `Can't open "${basename(menu.path)}" in VS Code — it is no longer there`, "Can't open in VS Code")}>
            Open in VS Code
          </button>
        </ContextMenuSurface>
      )}
    </div>
  )
}
