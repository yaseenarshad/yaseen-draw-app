import { useEffect, useRef, useState } from 'react'
import { ContextMenuSurface } from '../../components/ContextMenuSurface'
import { dropIndex, insertionSlot } from '../../lib/dragSlot'
import type { ViewDef } from '../viewSchema'
import { ConfirmDeleteView } from './ConfirmDeleteView'
import { ViewTypeIcon } from './icons'
import { Popover } from './Popover'
import { TextField } from './TextField'

/** The kinds "+" offers, in menu order; a kind's label is its type, capitalised. */
const VIEW_TYPES = ['table', 'board', 'cards', 'list', 'outline'] as const
/** This strip's own drag payload (TabBar's `WORKSPACE_PAGE_MIME` idiom); never `text/plain`. */
const VIEW_TAB_MIME = 'application/x-yaseen-view-tab'
export const viewTypeLabel = (type: string): string => type.charAt(0).toUpperCase() + type.slice(1)

export interface ViewTabsProps {
  views: ViewDef[]
  active: number
  onSelect: (index: number) => void
  /** Drag-to-reorder (YAZ-1471, TabBar's idiom): the tab at `from` lands at final index `to`. */
  onMove: (from: number, to: number) => void
  /** "+": append a view of `type`; the new tab opens in rename. */
  onAdd: (type: string) => void
  onRename: (index: number, name: string) => void
  onDuplicate: (index: number) => void
  /** After the sheet confirms; never offered for the last view. */
  onDelete: (index: number) => void
}

/** In-flight drag: the grabbed tab + the hovered insertion slot (0…views.length). */
interface DragState {
  from: number
  over: number | null
}

/**
 * View switcher (GRO-2135), editable again since YAZ-1471 re-ruled 🔒 rule 4 (YAZ-819): tabs
 * reorder by HTML5 drag — the insertion-slot arithmetic is TabBar's, now SHARED with it as
 * `lib/dragSlot` so the two strips cannot drift apart, with `dataTransfer` guarded for jsdom —
 * right-click opens Rename / Duplicate / Delete, "+" picks a type. Every change is ONE
 * `update` in ViewsPane; which view is active stays session state.
 */
export function ViewTabs({ views, active, onSelect, onMove, onAdd, onRename, onDuplicate, onDelete }: ViewTabsProps) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null)
  const [renaming, setRenaming] = useState<number | null>(null)
  const [adding, setAdding] = useState<HTMLElement | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const hasOutline = views.some((v) => v.type === 'outline')
  // `menu`, `confirm` and `renaming` are INDICES: another window (or a hand edit) can drop views
  // out from under an open one, so derive the view in render — a stale index then renders nothing
  // instead of throwing through a block with no error boundary above it (YAZ-1488).
  const menuView = menu === null ? null : (views[menu.i] ?? null)
  const confirmView = confirm === null ? null : (views[confirm] ?? null)
  // Overflow (TabBar's idiom): the strip scrolls with no scrollbar, so keep the ACTIVE tab in
  // view on every activation. jsdom has no scrollIntoView — hence the `?.()`.
  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [active])

  const drop = (insertion: number): void => {
    if (drag === null) return
    setDrag(null)
    const to = dropIndex(drag.from, insertion)
    if (to !== drag.from) onMove(drag.from, to)
  }
  /** Names key `defaultView` and the collapse store: a rename commits only a non-empty name no OTHER view has. */
  const uniqueName = (i: number) => (draft: string): string | null => {
    const name = draft.trim()
    return name !== '' && !views.some((v, j) => j !== i && v.name === name) ? name : null
  }

  return (
    <>
      <div className="view-tabs-wrap">
        <div
          className="view-tabs scroll-strip"
          role="tablist"
          onDragOver={(e) => {
            if (drag === null || e.target !== e.currentTarget) return // the strip's empty tail = the end slot
            e.preventDefault()
            if (drag.over !== views.length) setDrag({ ...drag, over: views.length })
          }}
          onDrop={(e) => {
            if (drag === null || e.target !== e.currentTarget) return
            e.preventDefault()
            drop(views.length)
          }}
        >
          {views.map((v, i) => {
            const cls = ['view-tab']
            if (i === active) cls.push('view-tab--active')
            if (drag?.from === i) cls.push('view-tab--dragging')
            if (drag?.over === i) cls.push('view-tab--insert-before')
            if (drag?.over === views.length && i === views.length - 1) cls.push('view-tab--insert-after')
            return (
              <div
                key={i}
                ref={i === active ? activeRef : undefined}
                className={cls.join(' ')}
                draggable={renaming !== i}
                onDragStart={(e) => {
                  // A PRIVATE mime, like `TabBar`'s workspace one: `text/plain` would let a tab
                  // mis-dropped on the note body above insert its name into the markdown.
                  e.dataTransfer?.setData(VIEW_TAB_MIME, v.name)
                  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                  setDrag({ from: i, over: null })
                }}
                onDragEnd={() => setDrag(null)}
                onDragOver={(e) => {
                  if (drag === null) return
                  e.preventDefault()
                  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                  const over = insertionSlot(e, i)
                  if (drag.over !== over) setDrag({ ...drag, over })
                }}
                onDrop={(e) => {
                  if (drag === null) return
                  e.preventDefault()
                  drop(insertionSlot(e, i))
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ x: e.clientX, y: e.clientY, i })
                }}
              >
                {renaming === i ? (
                  <TextField className="view-tab__rename" aria-label="View name" autoFocus value={v.name} normalize={uniqueName(i)} onCommit={(name) => onRename(i, name)} onDone={() => setRenaming(null)} />
                ) : (
                  <button type="button" role="tab" className="view-tab__btn" title={v.name} aria-selected={i === active} onClick={() => onSelect(i)}>
                    <ViewTypeIcon type={v.type} />
                    <span>{v.name}</span>
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <button type="button" className="view-tab__add" aria-label="Add view" title="Add view" aria-haspopup="dialog" aria-expanded={adding !== null} onClick={(e) => setAdding(adding === null ? e.currentTarget : null)}>
          +
        </button>
        {adding !== null && (
          <Popover label="Add view" anchor={adding} className="view-popover--menu" onClose={() => setAdding(null)}>
            <div role="menu">
              {/* ONE outline per page: ViewsPane reads and writes the FIRST outline view's document, so a second would shadow it. */}
              {VIEW_TYPES.filter((type) => type !== 'outline' || !hasOutline).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="menuitem"
                  className="view-popover__item"
                  onClick={() => {
                    setAdding(null)
                    onAdd(type)
                    setRenaming(views.length) // the appended tab, once the parent re-renders with it
                  }}
                >
                  <ViewTypeIcon type={type} />
                  {viewTypeLabel(type)}
                </button>
              ))}
            </div>
          </Popover>
        )}
      </div>
      {menu !== null && menuView !== null && (
        <ContextMenuSurface x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <button
            type="button"
            role="menuitem"
            className="ctx-menu__item"
            onClick={() => {
              setRenaming(menu.i)
              setMenu(null)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-menu__item"
            disabled={menuView.type === 'outline'}
            onClick={() => {
              onDuplicate(menu.i)
              setMenu(null)
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            role="menuitem"
            className="ctx-menu__item ctx-menu__item--danger"
            disabled={views.length <= 1}
            onClick={() => {
              setConfirm(menu.i)
              setMenu(null)
            }}
          >
            Delete
          </button>
        </ContextMenuSurface>
      )}
      {confirm !== null && confirmView !== null && (
        <ConfirmDeleteView
          view={confirmView}
          onConfirm={() => {
            onDelete(confirm)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  )
}
