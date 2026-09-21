import { useMemo } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import type { ViewSet, ViewDef } from '../viewSchema'
import { belongsToBasenames } from '../../links/folderPages'
import { type Group, type Row, propertyKeys, propertyLabel, resolverFor } from '../engine'
import { render } from '../expr'
import { cellEditor, columnTyping } from '../editorType'
import type { FolderPageSettings } from '../folderPageSettings'
import { EditableCell } from './EditableCell'
import { canonicalKey } from './keys'
import { GroupHeader, cellContent, groupKeyOf, pageTitle } from './GroupHeader'

export interface ListViewProps {
  def: ViewSet
  view: ViewDef
  records: readonly IndexRecord[]
  /** The post-search rows — the one flat list when the view has no `groupBy`. */
  rows: readonly Row[]
  /** Post-search groups from ViewsPane (empty groups dropped); null when the view has no `groupBy`. */
  groups: readonly Group[] | null
  /** Collapsed group keys (`groupKeyOf`) for this page + view; owned by ViewsPane, persisted via storage. */
  collapsed: readonly string[]
  onToggleGroup: (key: string) => void
  onOpenFile: (path: string) => void
  /** Create a note seeded with a section's group value (5D, GRO-2144); absent → no "+" on headers. */
  onNewInGroup?: (group: Group) => void
  /** Vault root, so the picker's resolver is THE one the wikilink surfaces share (YAZ-846); null = name-and-relative-path resolution only. */
  root: string | null
  /** The vault's property declarations (5E, GRO-2217): vault-wide editor inference and relation targets. */
  properties?: PropertiesResponse | null
  /** The folder page whose contents these rows are (YAZ-819): the typing ladder's TOP rung (🔒 Q8). */
  folderPage?: FolderPageSettings | null
  /** The WHOLE index snapshot (🔒 D2, YAZ-819) — `records` is only the MEMBERS: link resolution and the pickers read this. */
  vaultRecords: readonly IndexRecord[]
}

export type MarkerStyle = 'bullet' | 'number' | 'none'

/** `view.markerStyle`, defaulted: bullet unless the file says number or none (the menu deletes the key for bullet). */
export const markerStyleOf = (view: ViewDef): MarkerStyle =>
  view.markerStyle === 'number' || view.markerStyle === 'none' ? view.markerStyle : 'bullet'

/** `view.propertySeparator` when it is a string, else Obsidian's documented default `, `. */
const separatorOf = (view: ViewDef): string => (typeof view.propertySeparator === 'string' ? view.propertySeparator : ', ')

/**
 * List view (4F, GRO-2140): `type: list` — Obsidian's schema — renders one item per record. The
 * FIRST property in `order` is the primary line (Obsidian: the primary list item is whatever
 * sits on top of the Properties menu): `file.name` renders as a link → `onOpenFile` — the
 * default when `order` is empty or absent — while any other first property renders its typed
 * value and file.name is NOT implicitly added. The remaining `order` properties render either
 * as indented label/value rows beneath the primary line (`indentProperties: true`) or inline
 * after it, `render()`ed, empties skipped, joined by `propertySeparator` (default `, `).
 * `markerStyle` bullet | number | none draws the item marker (default bullet; number is the
 * ordinal within its list — restarting per group). Grouped results render 4C sections (the
 * shared `GroupHeader` over each group's own list) with the SAME persisted collapse state as
 * the table/board/cards (never the page's card); search narrows items and drops empty groups.
 * The three config keys are edited in the Properties menu (list views only). The primary line
 * (when not file.name) and the indented property rows edit inline through `EditableCell`
 * (5B, GRO-2142); the joined inline string stays read-only.
 */
export function ListView({ def, view, records, rows, groups, collapsed, onToggleGroup, onOpenFile, onNewInGroup, root, properties = null, folderPage = null, vaultRecords }: ListViewProps) {
  const keys = useMemo(() => propertyKeys(def, view, records, Object.keys(folderPage?.columns ?? {})), [def, view, records, folderPage])
  const primary: string | undefined = keys[0]
  const rest = keys.slice(1)
  const nameIsPrimary = primary === undefined || canonicalKey(primary) === 'file.name'
  const marker = markerStyleOf(view)
  const indent = view.indentProperties === true
  const separator = separatorOf(view)
  // per-column halves of the editor inference (5B, GRO-2142), over the view's shown rows;
  // memoised so unrelated re-renders skip the per-column row walk (7B, GRO-2148)
  const rowRecords = useMemo(() => rows.map((r) => r.record), [rows])
  const bareOf = (key: string) => (canonicalKey(key).startsWith('note.') ? canonicalKey(key).slice(5) : null)
  const typings = useMemo(
    () => new Map(keys.map((k) => [k, columnTyping(k, rowRecords, properties, folderPage)])),
    [keys, rowRecords, properties, folderPage],
  )
  /** What the pickers resolve and complete over: the WHOLE vault, never the members alone (🔒 D2). */
  const basenames = useMemo(() => vaultRecords.map((r) => r.basename), [vaultRecords])
  // Relation columns narrow the link picker to the pages of the folder page the target names
  // (YAZ-836: `belongsToBasenames` succeeded the type-keyed helper); missing key = all basenames.
  // The resolver carries the ROOT since YAZ-846 — the very instance the wikilink surfaces hold.
  const resolve = useMemo(() => {
    const resolver = resolverFor(vaultRecords, root ?? undefined)
    return (target: string) => resolver(target)?.record.path ?? null
  }, [vaultRecords, root])
  const linkNames = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [key, t] of typings) if (t?.target !== undefined) m.set(key, belongsToBasenames(vaultRecords, resolve, t.target))
    return m
  }, [typings, vaultRecords, resolve])
  const editable = (row: Row, key: string) => {
    const bare = bareOf(key)
    if (bare === null) return cellContent(row.values[key])
    return (
      <EditableCell
        path={row.record.path}
        propKey={bare}
        raw={row.record.properties[bare]}
        value={row.values[key]}
        editor={cellEditor(row.record.properties[bare], typings.get(key) ?? null)}
                        options={typings.get(key)?.options}
        basenames={linkNames.get(key) ?? basenames}
      />
    )
  }

  const items = (shown: readonly Row[]) => (
    <ul className="view-list__items">
      {shown.map((row, i) => {
        const inline = indent ? '' : rest.map((k) => render(row.values[k])).filter((s) => s !== '').join(separator)
        return (
          <li key={row.record.path} className="view-list__item">
            {marker !== 'none' && (
              <span className="view-list__marker" aria-hidden>
                {marker === 'number' ? `${i + 1}.` : '•'}
              </span>
            )}
            <div className="view-list__body">
              <div className="view-list__line">
                {nameIsPrimary ? (
                  <button type="button" className="view-list__title" onClick={() => onOpenFile(row.record.path)}>
                    {pageTitle(row)}
                  </button>
                ) : (
                  <span className="view-list__primary">{editable(row, primary)}</span>
                )}
                {inline !== '' && <span className="view-list__inline">{inline}</span>}
              </div>
              {indent && rest.length > 0 && (
                <div className="view-list__props">
                  {rest.map((key) => (
                    <div key={key} className="view-list__prop">
                      <span className="view-list__prop-name">{propertyLabel(def, key)}</span>
                      <span className="view-list__prop-value">{editable(row, key)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="view-list">
      {groups === null
        ? items(rows)
        : groups.map((g) => {
            const gk = groupKeyOf(g.key)
            const isCollapsed = collapsed.includes(gk)
            return (
              <section key={gk} className="view-list__group">
                <GroupHeader
                  def={def}
                  view={view}
                  columns={keys}
                  groupKey={g.key}
                  rows={g.rows}
                  collapsed={isCollapsed}
                  onToggle={() => onToggleGroup(gk)}
                  onNew={onNewInGroup === undefined ? undefined : () => onNewInGroup(g)}
                />
                {!isCollapsed && items(g.rows)}
              </section>
            )
          })}
    </div>
  )
}
