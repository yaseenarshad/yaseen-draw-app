import { type CSSProperties, type DragEvent as ReactDragEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import { type Modifiers, openByGesture, openTarget } from '../../lib/openGesture'
import type { FolderPageSettings } from '../folderPageSettings'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import { type Group, type Row, propertyKeys, propertyLabel } from '../engine'
import { cardWidth } from './cardWidth'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, nestedGroupKeyOf, pageTitle } from './GroupHeader'
import { useFlip } from './flip'
import { type GroupDrop, type GroupSpot, type GroupSwap, groupByKey, useGroupDrag } from './groupDrag'
import { usePreview } from './PreviewCard'
import { allPropertyKeys } from './properties'
import { PageContextMenu } from './PageContextMenu'

export interface BoardViewProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The folder page's settings — its declared columns show by default (YAZ-1549). */
  folderPage?: FolderPageSettings | null
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onUpdate: Mutate
  /** Open a card page in the current tab — the title click or Enter, the table's name-link rule (YAZ-1557). */
  onOpenFile?: (path: string) => void
  /** Open a card page in the window's right panel. */
  onOpenFileRight?: (path: string) => void
  /** Open a card's page without replacing the current folder page. */
  onOpenFileBackground?: (path: string) => void
  /** Passive notice surface for page actions that fail because a card moved or disappeared. */
  onNotice?: (message: string) => void
  /** A drop on another section, including nested level metadata, via ViewsPane's existing optimistic write path. */
  onMoveToGroup: (path: string, value: unknown, swap?: GroupSwap, drop?: GroupDrop) => void
  /** The last failed move, flagged inline on its card. */
  moveError: { path: string; message: string } | null
  /** Create a note seeded at one group level; nested spots let ViewsPane seed the outer too. A `name` is the inline add's typed one. */
  onNewInGroup?: (group: Group, name?: string, at?: GroupSpot) => void
  /** Preview mode (`view.preview`, YAZ-1244): resting on a card pops its page read-only. */
  preview?: boolean
}

/**
 * Board view (4D, GRO-2138): `type: board` — OUR schema extension — renders the engine's groups
 * as kanban columns on one horizontally scrolling row. With two group levels, each outer remains
 * one column: merge-rule `direct` cards come first, then compact inner sections stack vertically.
 * Every level uses the shared `GroupHeader` (chevron, typed value, count, per-section summaries)
 * over its cards: `file.name`, when present in `order`, as the title button → `onOpenFile`, then
 * the view's other `order` properties as small label/value rows typed like table cells. A card is
 * a focusable cell (YAZ-1557 D2): a plain click selects it, arrows walk the cards, and the title,
 * Enter, or a modifier opens through `lib/openGesture.ts` — the table's exact rule. Column
 * width follows `cardSize` (shared `cardWidth`: a number = px, legacy small/medium/large values
 * remain readable as 220/280/340, and absent or invalid values default to 280). Collapsing a
 * column hides its cards and
 * keeps the header — same persisted state as the table's groups, never the page's card. Without
 * `groupBy` a centered hint's "Group by…" button writes the first non-file property through the
 * file (opening the Sort popover remotely would mean lifting Toolbar's menu state; one write is
 * simpler and the Sort menu can change it after). Dragging a card to another column (5C,
 * GRO-2143) writes the group property through `onMoveToGroup` — the hovered column shows a
 * dashed placeholder, the own column is never a target, Esc cancels — and a failed move's
 * card carries an inline error chip. Nested targets are siblings of the outer target rather than
 * descendants, so one bubbled drop cannot dispatch at both levels. Images are 4E. A single-level
 * column — or each writable inner section in a nested Board — ends in the Notion inline add
 * (YAZ-943): Enter births the named page into that exact section without opening it. Per-property
 * `cardStyle` (YAZ-1206) bolds/underlines a value and hides its label; its `join` flag is the whole
 * LAYOUT (YAZ-1217, left/right is gone): a card is `.view-board__line` rows following `order`, each
 * key starting one unless `join` continues the line being built — so position IS ordering and the
 * title is un-pinned: `file.name` sits at its order position, can be joined onto and can itself join.
 */
/** The text flags a note row carries (YAZ-1206); the title takes part in the layout only (YAZ-1217). */
const styleClasses = (style: NonNullable<ViewDef['cardStyle']>[string]) =>
  `${style.bold === true ? ' view-board__prop--bold' : ''}${style.underline === true ? ' view-board__prop--underline' : ''}`

export function BoardView({
  def,
  view,
  folderPage = null,
  viewIndex,
  records,
  groups,
  collapsed,
  onToggleGroup,
  onUpdate,
  onOpenFile,
  onOpenFileRight,
  onOpenFileBackground,
  onNotice,
  onMoveToGroup,
  moveError,
  onNewInGroup,
  preview = false,
}: BoardViewProps) {
  const { rowProps, card, close } = usePreview(preview)
  const levelKeys = [groupByKey(view), groupByKey(view, 1)]
  const dnd = useGroupDrag(levelKeys, onMoveToGroup)
  /** One FLIP instance for the whole board (YAZ-944), so a card crossing columns MOVES. */
  const flipRoot = useFlip()
  /** The one open add row (YAZ-943) and what has been typed into it; null = every column shows its button. */
  const [adding, setAdding] = useState<{ key: string; name: string } | null>(null)
  /** The exact rendered record targeted by the latest whole-card secondary click. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  /** Browser click tails after secondary-click and drag gestures must not become page opens. */
  const suppressClick = useRef(false)
  const suppressOnce = () => {
    suppressClick.current = true
    queueMicrotask(() => {
      suppressClick.current = false
    })
  }
  /** The one open rule (YAZ-1557), shared with the table: ⌘ → background tab, ⌥ → right panel, plain → current tab, ⇧ → nothing. */
  const openHandlers = { onOpenFile, onOpenFileRight, onOpenFileBackground }
  const openCard = (row: Row, e: Modifiers): void => {
    if (suppressClick.current) return
    openByGesture(e, row.record.path, openHandlers)
  }
  /**
   * Arrow keys walk cards like table cells (YAZ-1557 D2): ↑↓ through the column's cards in DOM
   * order — nested sections included, so a two-level column reads top to bottom — and ←→ to the
   * same row of the neighbour column, clamped at every edge. An empty or collapsed neighbour has
   * no card at any row, so focus simply stays.
   */
  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const card = e.target as HTMLElement
    if (!card.classList.contains('view-board__card')) return
    const move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    if (move === undefined) return
    e.preventDefault()
    const columns = [...e.currentTarget.querySelectorAll<HTMLElement>(':scope > .view-board__col')]
    const cardsOf = (column: HTMLElement) => [...column.querySelectorAll<HTMLElement>('.view-board__card')]
    const c = columns.findIndex((column) => column.contains(card))
    const r = cardsOf(columns[c]).indexOf(card)
    const next = cardsOf(columns[Math.max(0, Math.min(columns.length - 1, c + move[1]))])
    next[Math.max(0, Math.min(next.length - 1, r + move[0]))]?.focus()
  }
  /** ViewsPane reuses this component between Board tabs; no action may retain the previous Board's record. */
  useEffect(() => setMenu(null), [viewIndex])
  if (groups === null) {
    const fallback = allPropertyKeys(def, view, records).find((k) => !canonicalKey(k).startsWith('file.')) ?? 'file.folder'
    return (
      <div className="view-board__hint">
        <p>Board views group notes into columns. Pick a property to group by.</p>
        <button
          type="button"
          className="view-menu__action"
          onClick={() =>
            onUpdate((d) => {
              d.views[viewIndex].groupBy = { property: canonicalKey(fallback), direction: 'ASC' }
            })
          }
        >
          Group by…
        </button>
      </div>
    )
  }

  const keys = propertyKeys(def, view, records, Object.keys(folderPage?.columns ?? {}))
  const nameKey = keys.find((k) => canonicalKey(k) === 'file.name')
  const styleOf = (key: string) => view.cardStyle?.[canonicalKey(key)] ?? {}
  /** The card's ROWS (YAZ-1217): each ordered key starts a line, `join` appends it to the one being built — so a join with no line yet is a harmless no-op. */
  const lines = keys.reduce<string[][]>((acc, key) => {
    if (styleOf(key).join === true && acc.length > 0) acc[acc.length - 1].push(key)
    else acc.push([key])
    return acc
  }, [])
  const width = cardWidth(view.cardSize)
  /**
   * One item on a line: the title button, or a label/value row. The dash between joined items is
   * its OWN element — a pseudo on a flex row would become that row's first flex child and drag
   * the row's internal 8px gap in after itself (the lopsided "App– Sam" bug).
   */
  const cardItem = (key: string, row: Row) => {
    if (key === nameKey)
      return (
        <button
          key={key}
          type="button"
          className="view-board__title"
          onClick={(event) => {
            event.stopPropagation()
            openCard(row, event)
          }}
        >
          {pageTitle(row)}
        </button>
      )
    const style = styleOf(key)
    return (
      <div key={key} className={`view-board__prop${styleClasses(style)}`}>
        {style.hideLabel !== true && <span className="view-board__prop-name">{propertyLabel(def, key)}</span>}
        <span className="view-board__prop-value">{cellContent(row.values[key])}</span>
      </div>
    )
  }
  /** A failed move's inline chip (5C, GRO-2143), under the card's first line. */
  const moveChip = (row: Row) =>
    moveError?.path === row.record.path ? (
      <span className="view-table__chip view-table__chip--error view-drag__error" role="alert" title={moveError.message}>
        Move failed
      </span>
    ) : null
  const openCardMenu = (event: ReactMouseEvent, row: Row): void => {
    event.preventDefault()
    suppressOnce()
    close()
    setMenu({ x: event.clientX, y: event.clientY, path: row.record.path })
  }
  const dragSource = (row: Row, group: Group, at: GroupSpot): Record<string, unknown> => {
    const source = dnd.source(row.record.path, group, at)
    const onDragEnd = source.onDragEnd as ((event: ReactDragEvent) => void) | undefined
    if (onDragEnd === undefined) return source
    return {
      ...source,
      onDragEnd: (event: ReactDragEvent) => {
        onDragEnd(event)
        suppressOnce()
      },
    }
  }
  const cardList = (rows: readonly Row[], group: Group, at: GroupSpot, isOver = false) => (
    <ul className="view-board__cards">
      {rows.map((row) => (
        <li
          key={row.record.path}
          data-flip-key={row.record.path}
          className={`view-board__card${dnd.drag?.path === row.record.path ? ' view-board__card--drag' : ''}`}
          {...dragSource(row, group, at)}
          {...rowProps(row.record)}
          // Every card is a focusable "cell" (YAZ-1557 D2): a plain click SELECTS it, and only the
          // title, Enter, or a modifier opens — so a card without a title still has a name to read.
          tabIndex={0}
          aria-label={nameKey === undefined ? row.record.name : undefined}
          onClick={(event) => {
            if (openTarget(event) === 'current') event.currentTarget.focus()
            else openCard(row, event)
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || event.key !== 'Enter') return
            event.preventDefault()
            openCard(row, event)
          }}
          // Capture phase so the preview closes ALONGSIDE the drag wiring's own onDragStart rather
          // than replacing it (YAZ-1244): a card must never hang over a drag.
          onDragStartCapture={close}
          onContextMenu={(event) => openCardMenu(event, row)}
        >
          {lines.map((line, i) => (
            <Fragment key={line[0]}>
              <div className="view-board__line">
                {line.map((key, item) => (
                  <Fragment key={key}>
                    {item > 0 && (
                      <span className="view-board__dash" aria-hidden>
                        &ndash;
                      </span>
                    )}
                    {cardItem(key, row)}
                  </Fragment>
                ))}
              </div>
              {i === 0 && moveChip(row)}
            </Fragment>
          ))}
          {/* An empty `order` leaves a blank card shell with no line to hang the chip under — it still drags, so it still reports. */}
          {lines.length === 0 && moveChip(row)}
        </li>
      ))}
      {isOver && <li className="view-board__placeholder" aria-hidden />}
    </ul>
  )
  const inlineAdd = (group: Group, key: string, at?: GroupSpot) => {
    if (onNewInGroup === undefined) return null
    return adding?.key === key ? (
      <input
        className="view-board__add-input"
        aria-label="New card name"
        placeholder="New card"
        autoFocus
        value={adding.name}
        onChange={(e) => setAdding({ key, name: e.target.value })}
        onBlur={() => setAdding(null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAdding(null)
          if (e.key !== 'Enter') return
          const name = adding.name.trim()
          // An empty Enter is a no-op, not an `Untitled` card: the row is asking for a name.
          if (name === '') return
          onNewInGroup(group, name, at)
          setAdding({ key, name: '' })
        }}
      />
    ) : (
      <button type="button" className="view-board__add" aria-label="New card" onClick={() => setAdding({ key, name: '' })}>
        + New card
      </button>
    )
  }

  return (
    <>
      <div className="view-board" ref={flipRoot} onKeyDown={onCardKeyDown} style={{ '--view-board-col-w': `${width}px` } as CSSProperties}>
        {groups.map((g) => {
          const gk = groupKeyOf(g.key)
          const isCollapsed = collapsed.includes(gk)
          const isOver = dnd.over === gk
          const outerAt: GroupSpot = { level: 0, outer: g }
          const header = (
            <GroupHeader
              def={def}
              view={view}
              columns={keys}
              groupKey={g.key}
              rows={g.rows}
              collapsed={isCollapsed}
              onToggle={() => onToggleGroup(gk)}
              onNew={onNewInGroup === undefined || levelKeys[0] === null ? undefined : () => onNewInGroup(g)}
            />
          )
          return (
            <section
              key={gk}
              className={`view-board__col${g.children === undefined ? '' : ' view-board__col--nested'}${isOver ? ' view-board__col--drop' : ''}`}
              {...(g.children === undefined ? dnd.target(g, outerAt) : {})}
            >
              {g.children === undefined ? (
                header
              ) : (
                <div className="view-board__col-header" {...dnd.target(g, outerAt)}>
                  {header}
                </div>
              )}
              {!isCollapsed && (
                <>
                  {g.children === undefined ? (
                    cardList(g.rows, g, outerAt, isOver)
                  ) : (
                    <>
                      {(g.direct?.length ?? 0) > 0 && cardList(g.direct ?? [], g, outerAt, isOver)}
                      {g.children.length > 0 && (
                        <div className="view-board__subgroups">
                          {g.children.map((child) => {
                            const ck = nestedGroupKeyOf(g.key, child.key)
                            const childCollapsed = collapsed.includes(ck)
                            const childOver = dnd.over === ck
                            const innerAt: GroupSpot = { level: 1, outer: g }
                            return (
                              <section
                                key={ck}
                                className={`view-board__subgroup${childOver ? ' view-board__subgroup--drop' : ''}`}
                                {...dnd.target(child, innerAt)}
                              >
                                <GroupHeader
                                  def={def}
                                  view={view}
                                  columns={keys}
                                  groupKey={child.key}
                                  rows={child.rows}
                                  collapsed={childCollapsed}
                                  onToggle={() => onToggleGroup(ck)}
                                  onNew={
                                    onNewInGroup === undefined || levelKeys[1] === null
                                      ? undefined
                                      : () => onNewInGroup(child, undefined, innerAt)
                                  }
                                />
                                {!childCollapsed && cardList(child.rows, child, innerAt, childOver)}
                                {!childCollapsed && levelKeys[1] !== null && inlineAdd(child, ck, innerAt)}
                              </section>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
              {!isCollapsed && g.children === undefined && levelKeys[0] !== null && inlineAdd(g, gk)}
            </section>
          )
        })}
      </div>
      {menu !== null && (
        <PageContextMenu
          x={menu.x}
          y={menu.y}
          path={menu.path}
          onOpenRight={onOpenFileRight}
          onOpenBackground={onOpenFileBackground}
          onNotice={onNotice}
          onClose={() => setMenu(null)}
        />
      )}
      {/* Outside the horizontal scroller on purpose (YAZ-1244): the card is placed against the viewport. */}
      {card}
    </>
  )
}
