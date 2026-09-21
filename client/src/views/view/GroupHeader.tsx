import type { ViewSet, ViewDef } from '../viewSchema'
import { type Row, propertyLabel } from '../engine'
import { ErrorValue, FileValue, LinkValue, type Value, render } from '../expr'
import { summarize } from '../summaries'
import { canonicalKey } from './keys'

/**
 * One group's header content (4C, GRO-2137), shared by Table today and Cards / List / Board
 * later: chevron collapse toggle, the group value rendered by type, count, and the per-group
 * summaries (recomputed over the group's SHOWN rows, like the table's total row in 4B).
 */

/**
 * Stable string identity for one group, the key persisted in the app state's `baseGroups`:
 * `∅` for the trailing "No value" group, `v:<render(key)>` otherwise (the prefix keeps any
 * rendered value from colliding with the sentinel). Deterministic across sessions.
 */
export const groupKeyOf = (key: Value | null): string => (key === null ? '∅' : `v:${render(key)}`)

/**
 * The same identity for an INNER group (YAZ-745), scoped by its outer's so the same inner value
 * under two outers collapses independently. It is persisted in `baseGroups` like `groupKeyOf`,
 * so the unit-separator encoding is a contract.
 */
export const nestedGroupKeyOf = (outerKey: Value | null, innerKey: Value | null): string =>
  `${groupKeyOf(outerKey)}\u001f${groupKeyOf(innerKey)}`

/** The stored summary kind for a column, whichever key form (`priority` / `note.priority`) the file uses. */
export function summaryKindOf(view: ViewDef, key: string): string | undefined {
  const s = view.summaries
  if (s === undefined) return undefined
  const k = Object.keys(s).find((x) => canonicalKey(x) === canonicalKey(key))
  return k !== undefined && typeof s[k] === 'string' ? s[k] : undefined
}

/** One value inside a list / link cell (shared with TableView's cells). */
export function chip(v: Value, key?: number) {
  const link = v instanceof LinkValue || v instanceof FileValue
  const text = v instanceof LinkValue ? v.display ?? v.target : v instanceof FileValue ? v.record.basename : render(v)
  return (
    <span key={key} className={`view-table__chip${link ? ' view-table__chip--link' : ''}`} title={text}>
      {text}
    </span>
  )
}

/**
 * The page's TITLE wherever a skin shows its `file.name` column (YAZ-1513/1549): the basename, never
 * the file name — one spelling for the table's name cell, the board's card title, the card's title
 * and the list's primary. `file.name`'s VALUE keeps its extension for sort and filter; only what
 * the eye reads is the name.
 */
export const pageTitle = (row: Row): string => row.record.basename

/** Typed cell body (shared by table cells and board cards): error chip, read-only checkbox (editing is 5B), chips for lists/links, `render()` for the rest. */
export function cellContent(v: Value) {
  if (v instanceof ErrorValue)
    return (
      <span className="view-table__chip view-table__chip--error" title={v.message}>
        #ERROR
      </span>
    )
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled readOnly />
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v)
  return render(v)
}

/** The group value by type: chips for lists and links/files, `render()` for the rest. */
function groupValue(v: Value) {
  if (Array.isArray(v)) return v.map((item, i) => chip(item, i))
  if (v instanceof LinkValue || v instanceof FileValue) return chip(v)
  return render(v)
}

export interface GroupHeaderProps {
  def: ViewSet
  view: ViewDef
  /** The host view's column keys (`propertyKeys`); one summary renders per summarised column, in this order. */
  columns: readonly string[]
  /** The engine group's key; null = the "No value" group. */
  groupKey: Value | null
  /** The group's SHOWN (post-search) rows: the count and summaries are computed over exactly these. */
  rows: readonly Row[]
  collapsed: boolean
  onToggle: () => void
  /** Create a note in this group (5D, GRO-2144); absent → no "+" affordance. */
  onNew?: () => void
}

export function GroupHeader({ def, view, columns, groupKey, rows, collapsed, onToggle, onNew }: GroupHeaderProps) {
  const label = groupKey === null ? 'No value' : render(groupKey)
  return (
    <div className="view-group">
      <button type="button" className="view-group__toggle" aria-expanded={!collapsed} aria-label={`Toggle group ${label}`} onClick={onToggle}>
        <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      <span className={`view-group__value${groupKey === null ? ' view-group__value--none' : ''}`}>
        {groupKey === null ? 'No value' : groupValue(groupKey)}
      </span>
      <span className="view-group__count">{rows.length}</span>
      {onNew !== undefined && (
        <button type="button" className="view-group__new" aria-label={`New note in group ${label}`} title="New note" onClick={onNew}>
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M8 3v10M3 8h10" />
          </svg>
        </button>
      )}
      {columns.map((key) => {
        const kind = summaryKindOf(view, key)
        if (kind === undefined) return null
        return (
          <span key={key} className="view-group__summary" title={`${propertyLabel(def, key)} ${kind}`}>
            <span className="view-group__summary-kind">{kind}</span>
            {render(summarize(kind, rows.map((r) => r.values[key]), def.summaries))}
          </span>
        )
      })}
    </div>
  )
}
