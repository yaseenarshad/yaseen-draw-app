import { PROPERTY_LABELS, PropertyOptionsEditor, PropertyTypeIcon } from './PropertyDefinitionEditor'
import { ColumnSearch, matchesColumn } from './ColumnSearch'
import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { PROPERTY_KINDS, type IndexRecord, type PropertiesResponse, type PropertyKind } from '@shared/types'
import type { ViewSet, ViewDef, Mutate } from '../viewSchema'
import type { ColumnDecl } from '../folderPageSettings'
import type { FolderPageMode } from '../ViewsPane'
import { defaultLabel, propertyKeys, propertyLabel } from '../engine'
import { columnTyping } from '../editorType'
import { undeletableReason } from '../deleteColumn'
import { canonicalKey } from './keys'
import { AddColumn } from './AddColumn'
import { displayNameOf, setDisplayName } from './columnLabel'
import { setViewOrder, withOrder } from './columnOrder'
import { declarationForKind } from './declarationForKind'
import { ConfirmDeleteColumn } from './ConfirmDeleteColumn'
import { DragHandleIcon, FileFieldIcon, FormulaIcon } from './icons'
import { markerStyleOf } from './ListView'
import { allPropertyKeys } from './properties'
import { TextField } from './TextField'
import { frozenColumnCount } from './frozenColumns'
import { cardWidth } from './cardWidth'

export interface PropertiesMenuProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  onUpdate: Mutate
  /** Existing relation shortcut visibility and legacy declarations used only as read fallbacks. */
  root?: string | null
  properties?: PropertiesResponse | null
  /** The folder page's own declarations (the ladder's TOP rung) and `setColumns`, the door they go back through (YAZ-895). */
  folderPage: FolderPageMode
}

const bare = (key: string): string => (key.startsWith('note.') ? key.slice(5) : key)

/** Board's width editor accepts finite numbers, then rounds and clamps only its lower bound. */
export const normalizeBoardWidth = (draft: string): string | null => {
  if (draft.trim() === '') return null
  const width = Number(draft)
  return Number.isFinite(width) ? String(Math.max(180, Math.round(width))) : null
}

/** One property's card styling (YAZ-1206), keyed by canonical key under `view.cardStyle`. */
type CardStyle = NonNullable<ViewDef['cardStyle']>[string]

/**
 * Properties menu (GRO-2135), TWO levels inside the one popover since YAZ-1513 (Notion's shape):
 *
 *  LIST — one clean line per column: grip (YAZ-1207, shown rows only) · shown checkbox (writes
 *  `view.order`; Table and Board may hide `file.name`, Cards and List keep it) · the column's KIND
 *  glyph · its label · a `›` — the whole label area opens the column. Nothing else rides the row.
 *  "Select all / Unselect all", the count, "+ Add column" and the per-view sections below
 *  (Table: frozen columns, row numbers; Board; List) are as they were.
 *
 *  DETAIL — ONE panel, ONE exit (3D, Yasin's ruling): `‹` back beside the label itself as an
 *  inline heading-sized field (`setDisplayName` via `onUpdate` on Enter/blur, blank = the default
 *  label, Esc reverts the field and stays), then rows at the list's size: the read-only key; Type
 *  as an inline select (`note.*` only — `file.*` / `formula.*` read as text); Options for Select
 *  kinds (the SAME `PropertyOptionsEditor` the definition editor holds); Relation (a declared link
 *  kind's target inline, else "Make relation" seeding a link kind from a legacy vault
 *  declaration, YAZ-895); Card styling (the four `cardStyle` toggles — BOARD views only, the one
 *  skin that reads `cardStyle`); and the actions: Hide in this view (= unchecking) and Delete
 *  column… (`views/deleteColumn.ts`, confirm-first; built-in keys disabled with a tooltip).
 *
 *  Every declaration edit WRITES IMMEDIATELY through `folderPage.setColumn` — the exact write the
 *  old editor's Save made, with the same optimistic-concurrency `base`: the host's AHEAD declaration
 *  (YAZ-1549), which the panel renders and hands straight back, so a second edit is checked against
 *  what just landed and a "changed since opened" rejection shows its text inline while the host
 *  reverts. There is no third level and no Save/Cancel; Esc or `‹` returns to the list.
 */
export function PropertiesMenu({ def, view, viewIndex, records, onUpdate, root = null, properties = null, folderPage }: PropertiesMenuProps) {
  const [query, setQuery] = useState('')
  /**
   * The DETAIL level (YAZ-1513), or null for the list. The declaration itself is NOT held here: the
   * host's `settings.columns` is its ahead copy (YAZ-1549), so the panel renders that and hands the
   * very same object back as `base` — `writeFolderColumn`'s conflict boundary.
   */
  const [detail, setDetail] = useState<{ key: string; error: string | null; saving: boolean } | null>(null)
  /** "Delete column…" awaiting its confirm (YAZ-1513). */
  const [deleting, setDeleting] = useState<string | null>(null)
  /** The drag in flight (YAZ-1207): `from` is an index in `shown`, `to` the insertion slot it would land in. */
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null)
  const shown = propertyKeys(def, view, records, Object.keys(folderPage.settings.columns))
  const keys = allPropertyKeys(def, view, records, folderPage.settings.columns)
  const filtering = query.trim() !== ''
  const matches = keys.filter(key => matchesColumn(query, propertyLabel(def, key), key))
  const matchingKeys = new Set(matches.map(canonicalKey))
  const isShown = (key: string) => shown.some((k) => canonicalKey(k) === canonicalKey(key))
  const canToggle = (key: string) => !(canonicalKey(key) === 'file.name' && view.type !== 'table' && view.type !== 'board')

  const openDetail = (key: string) => setDetail({ key, error: null, saving: false })
  /**
   * ONE declaration write (YAZ-897), immediately — the write the old editor's Save made, against
   * the host's ahead declaration as `base` (C1, locked: member VALUES are never migrated; the
   * declaration alone moves). The host shows the next edit what just landed; a rejection only shows
   * its text here — the host has already reverted its copy.
   */
  const writeDeclaration = async (next: ColumnDecl) => {
    const d = detail
    if (d === null) return
    const name = bare(d.key)
    setDetail({ ...d, saving: true, error: null })
    try {
      await folderPage.setColumn(name, next, folderPage.settings.columns[name])
      setDetail((cur) => (cur === null || cur.key !== d.key ? cur : { ...cur, saving: false }))
    } catch (error) {
      setDetail((cur) => (cur === null || cur.key !== d.key ? cur : { ...cur, saving: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }

  /** ONE order write, `frozenColumns` following positionally — the shared rule (`columnOrder.ts`). */
  const writeOrder = (order: string[]) => onUpdate((d) => setViewOrder(d, viewIndex, order))
  const toggle = (key: string) => writeOrder(isShown(key) ? shown.filter((k) => canonicalKey(k) !== canonicalKey(key)) : [...shown, key])
  /** The slot a pointer at `clientY` over shown row `i` means: before (i) or after (i+1) it. */
  const insertionAt = (e: DragEvent<HTMLElement>, i: number): number => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? i : i + 1
  }
  /**
   * Reorder (YAZ-1207), TabBar's move rule (GRO-2235): the slot is an index in the WITH-dragged-row
   * list, so past the grab point it shifts one left. ONE `writeOrder` — never a bypass, it is what
   * keeps `frozenColumns` following positionally.
   */
  const move = (from: number, insertion: number) => {
    const to = insertion > from ? insertion - 1 : insertion
    if (to === from) return
    const next = [...shown]
    const [key] = next.splice(from, 1)
    next.splice(to, 0, key)
    writeOrder(next)
  }
  /** The label, through the shared rule (`columnLabel.ts`) the table header's rename uses too (YAZ-1513). */
  const renameColumn = (key: string, name: string) => onUpdate((d) => setDisplayName(d, key, name))

  const cardStyleOf = (key: string): CardStyle => view.cardStyle?.[canonicalKey(key)] ?? {}
  /** One cardStyle write (YAZ-1206): flags that fall back to absent delete themselves; an empty entry, then an empty map, deletes too — the YAML default-deletes rule. */
  const writeCardStyle = (key: string, edit: (style: CardStyle) => void) =>
    onUpdate((d) => {
      const v = d.views[viewIndex]
      const k = canonicalKey(key)
      const style: CardStyle = { ...v.cardStyle?.[k] }
      edit(style)
      const map = { ...v.cardStyle }
      if (Object.keys(style).length) map[k] = style
      else delete map[k]
      if (Object.keys(map).length) v.cardStyle = map
      else delete v.cardStyle
    })
  const toggleCardFlag = (key: string, flag: 'bold' | 'underline' | 'hideLabel' | 'join') =>
    writeCardStyle(key, (style) => {
      if (style[flag] === true) delete style[flag]
      else style[flag] = true
    })

  /** The kinds the list glyphs show, remembered per canonical key for as long as their inputs stand (YAZ-1549) — no row rescan per render. */
  const kinds = useMemo(() => new Map<string, PropertyKind>(), [records, properties, folderPage.settings])
  /** The kind a list row's glyph shows: the declaration, else the inferred editor kind, else text. */
  const kindOf = (key: string): PropertyKind => {
    const c = canonicalKey(key)
    const known = kinds.get(c)
    if (known !== undefined) return known
    const decl = folderPage.settings.columns[bare(key)]
    const typing = decl === undefined ? columnTyping(key, records, properties, folderPage.settings) : null
    const kind = decl?.kind ?? typing?.assigned ?? typing?.dominant ?? 'text'
    kinds.set(c, kind)
    return kind
  }
  /** Labels shared by two rows (`file.name` and a `name` property both read "Name"): those rows also show their key (YAZ-1549). */
  const labelCounts = new Map<string, number>()
  for (const key of keys) {
    const label = propertyLabel(def, key)
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  const glyphOf = (key: string): ReactNode => {
    const c = canonicalKey(key)
    if (c.startsWith('file.')) return <FileFieldIcon />
    if (c.startsWith('formula.')) return <FormulaIcon />
    return <PropertyTypeIcon kind={kindOf(key)} />
  }

  // ---------- DETAIL level (YAZ-1513) ----------
  if (detail !== null) {
    const { key, error, saving } = detail
    const name = bare(key)
    const decl = folderPage.settings.columns[name]
    const label = propertyLabel(def, key)
    const c = canonicalKey(key)
    const isNote = c.startsWith('note.')
    const on = isShown(key)
    const kind = decl?.kind
    const choice = kind === 'select' || kind === 'multi-select'
    const linkKind = kind === 'link' || kind === 'multi-link'
    const reason = undeletableReason(key)
    const style = cardStyleOf(key)
    const observed = [...new Set(records.flatMap((r) => {
      const value = r.properties[name]
      return (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    }))]
    /** The relation seed (YAZ-895): a legacy vault link declaration when there is one, else a plain link. */
    const legacy = properties?.properties[name]
    const relationSeed: ColumnDecl = legacy?.kind === 'link' || legacy?.kind === 'multi-link' ? legacy : { kind: 'link' }
    const toggleButton = (flag: 'bold' | 'underline' | 'hideLabel' | 'join', aria: string, content: ReactNode) => (
      <button type="button" className="view-rule__nav view-card-toggle" aria-label={aria} title={aria} aria-pressed={style[flag] === true} onClick={() => toggleCardFlag(key, flag)}>
        {content}
      </button>
    )
    return (
      <div
        className="view-menu column-detail"
        onKeyDown={(e) => {
          // Esc steps back to the list; the popover's own window listener never sees it. (Inside the
          // name field, TextField takes Esc first and only reverts the draft.)
          if (e.key !== 'Escape' || deleting !== null) return
          e.stopPropagation()
          setDetail(null)
        }}
      >
        <div className="column-detail__head">
          <button type="button" className="column-detail__back" aria-label="Back to columns" onClick={() => setDetail(null)}>
            <span aria-hidden="true">‹</span>
          </button>
          <TextField
            className="column-detail__name"
            aria-label="Display name"
            placeholder={defaultLabel(key)}
            value={displayNameOf(def, key)}
            onCommit={(next) => renameColumn(key, next)}
          />
        </div>
        <fieldset className="column-detail__rows" disabled={saving}>
          <div className="column-detail__row">
            <span>Key</span>
            <code className="column-detail__key">{c}</code>
          </div>
          <div className="column-detail__row">
            <span>Type</span>
            {isNote ? (
              <select
                className="view-select"
                aria-label={`Edit property ${label}`}
                value={kind ?? ''}
                onChange={(e) => void writeDeclaration(declarationForKind(decl, e.target.value as PropertyKind))}
              >
                {kind === undefined && (
                  <option value="" disabled>
                    Auto
                  </option>
                )}
                {PROPERTY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PROPERTY_LABELS[k]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="column-detail__value">{c.startsWith('file.') ? 'File field' : 'Formula'}</span>
            )}
          </div>
          {choice && decl !== undefined && (
            <div className="column-detail__group">
              <PropertyOptionsEditor value={decl} observed={observed} onChange={(next) => void writeDeclaration(next)} />
            </div>
          )}
          {/* The relation (YAZ-895): a declared link kind's target inline; any other note key can BECOME one from the legacy seed. */}
          {root !== null && isNote && (
            <div className="column-detail__row">
              <span>Relation</span>
              {linkKind && decl !== undefined ? (
                <TextField
                  className="view-input"
                  aria-label="Link target"
                  placeholder="Any page, or [[Folder page]]"
                  value={decl.target ?? ''}
                  onCommit={(target) => {
                    const next: ColumnDecl = { ...decl }
                    if (target.trim()) next.target = target.trim()
                    else delete next.target
                    void writeDeclaration(next)
                  }}
                />
              ) : (
                <button type="button" className="property-type-button" aria-label={`Relation for ${label}`} title="Relation" onClick={() => void writeDeclaration(declarationForKind({ ...decl, ...relationSeed }, relationSeed.kind))}>
                  Make relation
                </button>
              )}
            </div>
          )}
          {error !== null && (
            <p role="alert" className="view-relation__error">
              {error}
            </p>
          )}
          {/* Card styling (YAZ-1206/YAZ-1217): BOARD views only — the one skin that reads `cardStyle` — and only a shown column; the title gets ⤴ alone. */}
          {view.type === 'board' && on && (
            <div className="column-detail__group">
              <p className="view-menu__label">Card styling</p>
              <div className="column-detail__toggles">
                {isNote && toggleButton('bold', `Bold ${label} on cards`, <b>B</b>)}
                {isNote && toggleButton('underline', `Underline ${label} on cards`, <u>U</u>)}
                {isNote && toggleButton('hideLabel', `Hide ${label} label on cards`, '–L')}
                {toggleButton('join', `Join ${label} to the row above`, '⤴')}
              </div>
            </div>
          )}
        </fieldset>
        <div className="column-detail__actions">
          <button
            type="button"
            className="column-detail__action"
            aria-label={`Hide ${label} in this view`}
            disabled={!on || !canToggle(key)}
            onClick={() => {
              toggle(key)
              setDetail(null)
            }}
          >
            Hide in this view
          </button>
          <button
            type="button"
            className="column-detail__action column-detail__action--danger"
            aria-label={`Delete column ${label}`}
            disabled={reason !== null}
            title={reason ?? undefined}
            onClick={() => setDeleting(key)}
          >
            Delete column…
          </button>
        </div>
        {deleting !== null && (
          <ConfirmDeleteColumn
            columnKey={deleting}
            def={def}
            records={records}
            onCancel={() => setDeleting(null)}
            onConfirm={() => {
              const gone = deleting
              setDeleting(null)
              setDetail(null)
              void folderPage.deleteColumn(gone)
            }}
          />
        )}
      </div>
    )
  }

  // ---------- LIST level ----------
  return (
    <div className="view-menu">
      <div className="column-menu-head">
        <ColumnSearch value={query} onChange={setQuery} label="Search columns" />
        <div className="column-menu-summary">
          <span aria-live="polite">{filtering ? `${matches.length} of ${keys.length}` : keys.length} columns</span>
          {(view.type === 'table' || view.type === 'board') && <div className="view-menu__actions">
            <button type="button" className="view-menu__action" disabled={matches.every(isShown)} onClick={() => writeOrder(filtering ? [...shown, ...matches.filter(key => !isShown(key))] : keys)}>
              {filtering ? 'Select results' : 'Select all'}
            </button>
            <button type="button" className="view-menu__action" disabled={!matches.some(isShown)} onClick={() => writeOrder(filtering ? shown.filter(key => !matchingKeys.has(canonicalKey(key))) : [])}>
              {filtering ? 'Unselect results' : 'Unselect all'}
            </button>
          </div>}
        </div>
        {filtering && matches.length > 0 && <p className="column-reorder-hint">Clear search to reorder columns.</p>}
      </div>
      {matches.length === 0 && <p className="column-search__empty">No columns found. Try another name.</p>}
      <ul className="view-menu__list">
        {matches.map((key) => {
          const on = isShown(key)
          const i = shown.indexOf(key)
          const label = propertyLabel(def, key)
          const cls = ['view-prop']
          if (drag !== null && i >= 0) {
            if (drag.from === i) cls.push('view-prop--dragging')
            // The insertion indicator: an accent edge on the row the drop would land before — or
            // after the LAST row for the end slot.
            if (drag.to === i) cls.push('view-prop--insert-before')
            if (drag.to === shown.length && i === shown.length - 1) cls.push('view-prop--insert-after')
          }
          return (
            <li
              key={key}
              className={cls.join(' ')}
              onDragOver={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
                const to = insertionAt(e, i)
                if (drag.to !== to) setDrag({ ...drag, to })
              }}
              onDrop={(e) => {
                if (drag === null || i < 0) return
                e.preventDefault()
                setDrag(null)
                move(drag.from, insertionAt(e, i))
              }}
            >
              <div className="view-prop__identity">
                {on && !filtering && (
                  <button
                    type="button"
                    className="view-rule__nav view-prop__handle"
                    aria-label={`Reorder ${label}`}
                    title="Reorder"
                    draggable
                    onDragStart={(e) => {
                      // The groupDrag idiom: `dataTransfer` guarded — jsdom's synthetic drags have none.
                      e.dataTransfer?.setData('text/plain', key)
                      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
                      setDrag({ from: i, to: i })
                    }}
                    onDragEnd={() => setDrag(null)}
                    onKeyDown={(e) => {
                      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                      e.preventDefault()
                      if (e.key === 'ArrowUp') {
                        if (i > 0) move(i, i - 1)
                      } else if (i < shown.length - 1) move(i, i + 2)
                    }}
                  >
                    <DragHandleIcon />
                  </button>
                )}
                <input type="checkbox" aria-label={`Show ${label}`} checked={on} disabled={!canToggle(key)} onChange={() => toggle(key)} />
                <button type="button" className="view-prop__open" aria-label={`Open ${label}`} onClick={() => openDetail(key)}>
                  <span className="view-prop__kind">{glyphOf(key)}</span>
                  <span className="view-prop__name">
                    {label}
                    {(labelCounts.get(label) ?? 0) > 1 && <small>{canonicalKey(key)}</small>}
                  </span>
                  <span className="view-prop__chevron" aria-hidden="true">›</span>
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <AddColumn
        taken={keys}
        onSave={(name, column) =>
          folderPage.setColumns(
            { ...folderPage.settings.columns, [name]: column },
            // The new column shown TOO, in that same one write (🔒 D3): `shown` is what `writeOrder`
            // writes — the view's own `order`, or the derived keys when it has none.
            def.views.map((v, i) => (i === viewIndex ? withOrder(v, [...shown, `note.${name}`]) : v)),
          )
        }
      />
      {view.type === 'table' && (
        <>
          <p className="view-menu__label">Table</p>
          <label className="view-settings-row">
            <span>Frozen columns</span>
            <select
              className="view-select"
              aria-label="Frozen columns"
              value={frozenColumnCount(view.frozenColumns, shown.length)}
              onChange={(e) =>
                onUpdate((d) => {
                  const count = Number(e.target.value)
                  if (count === 0) delete d.views[viewIndex].frozenColumns
                  else d.views[viewIndex].frozenColumns = count
                })
              }
            >
              <option value={0}>None</option>
              {shown.map((key, index) => (
                <option key={key} value={index + 1}>
                  {index + 1} — through {propertyLabel(def, key)}
                </option>
              ))}
            </select>
          </label>
          <label className="view-menu__toggle">
            <input
              type="checkbox"
              aria-label="Row numbers"
              checked={view.rowNumbers !== false}
              onChange={(e) =>
                onUpdate((d) => {
                  // Shown is the default (YAZ-1513): a shown gutter leaves no key behind.
                  if (e.target.checked) delete d.views[viewIndex].rowNumbers
                  else d.views[viewIndex].rowNumbers = false
                })
              }
            />
            Row numbers
          </label>
        </>
      )}
      {view.type === 'board' && <div className="property-board-setting">
        <label><span>Show empty columns</span><input type="checkbox" role="switch" checked={view.showEmptyColumns === true} onChange={e => onUpdate(d => { if (e.target.checked) d.views[viewIndex].showEmptyColumns = true; else delete d.views[viewIndex].showEmptyColumns })} /></label>
        <small>Include unused options from the grouping property.</small>
      </div>}
      {view.type === 'board' && (
        <>
          <p className="view-menu__label">Board</p>
          <label className="view-settings-row">
            <span>Column width</span>
            <span className="view-width-setting">
              <TextField
                className="view-input"
                aria-label="Column width in pixels"
                type="number"
                inputMode="decimal"
                min={180}
                step={1}
                value={String(cardWidth(view.cardSize))}
                normalize={normalizeBoardWidth}
                onCommit={(next) =>
                  onUpdate((d) => {
                    const active = d.views[viewIndex]
                    if (Number(next) === 280) delete active.cardSize
                    else active.cardSize = Number(next)
                  })
                }
              />
              <span>px</span>
            </span>
          </label>
        </>
      )}
      {view.type === 'list' && (
        <>
          <p className="view-menu__label">List</p>
          <div className="view-list-settings">
            <select
              className="view-select"
              aria-label="Marker style"
              value={markerStyleOf(view)}
              onChange={(e) =>
                onUpdate((d) => {
                  if (e.target.value === 'bullet') delete d.views[viewIndex].markerStyle
                  else d.views[viewIndex].markerStyle = e.target.value
                })
              }
            >
              <option value="bullet">Bullet</option>
              <option value="number">Number</option>
              <option value="none">None</option>
            </select>
            <label className="view-menu__toggle">
              <input
                type="checkbox"
                aria-label="Indent properties"
                checked={view.indentProperties === true}
                onChange={(e) =>
                  onUpdate((d) => {
                    if (e.target.checked) d.views[viewIndex].indentProperties = true
                    else delete d.views[viewIndex].indentProperties
                  })
                }
              />
              Indent properties
            </label>
            <TextField
              className="view-input"
              aria-label="Property separator"
              placeholder=", "
              value={typeof view.propertySeparator === 'string' ? view.propertySeparator : ''}
              onCommit={(sep) =>
                onUpdate((d) => {
                  if (sep === '' || sep === ', ') delete d.views[viewIndex].propertySeparator
                  else d.views[viewIndex].propertySeparator = sep
                })
              }
            />
          </div>
        </>
      )}
      {/* The folder-page-level setting (YAZ-1104) — the saved START, in the def since YAZ-1471: ONE door. */}
      <p className="view-menu__label">Page</p>
      <label className="view-settings-row">
        <span>Default view</span>
        <select
          className="view-select"
          aria-label="Default view"
          value={def.defaultView ?? ''}
          onChange={(e) =>
            onUpdate((d) => {
              if (e.target.value === '') delete d.defaultView
              else d.defaultView = e.target.value
            })
          }
        >
          <option value="">First view</option>
          {def.views.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}
