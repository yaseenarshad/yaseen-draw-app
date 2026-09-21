import { type ReactNode, useCallback, useState } from 'react'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { type ViewSet, type ViewDef, type Mutate, groupByLevels } from '../viewSchema'
import type { EngineError } from '../engine'
import type { FolderPageMode } from '../ViewsPane'
import { countRules } from './filterRows'
import { ChevronsIcon, EyeIcon, FilterIcon, PlusIcon, PropertiesIcon, SearchIcon, SortIcon, SyncIcon } from './icons'
import { FilterMenu } from './FilterMenu'
import { Popover } from './Popover'
import { PropertiesMenu } from './PropertiesMenu'
import { SortMenu } from './SortMenu'
import { ViewTabs, type ViewTabsProps } from './ViewTabs'

type Menu = 'filter' | 'sort' | 'properties'

export interface ToolbarProps {
  def: ViewSet
  view: ViewDef
  viewIndex: number
  records: readonly IndexRecord[]
  /** The engine's `*.filters` errors, shown inside the Filter menu (YAZ-1229). */
  filterErrors: readonly EngineError[]
  /** Rows in the body after search / limit, and the pre-limit total. */
  shown: number
  total: number
  /** null while the search box is closed. */
  search: string | null
  onSearch: (next: string | null) => void
  onUpdate: Mutate
  /** Create a note satisfying this view and open it (5D, GRO-2144). */
  onNew: () => void
  /** Every group key of the view, and the collapsed subset — the collapse / expand all toggle (YAZ-744); empty when the view is not grouped. */
  allGroupKeys: readonly string[]
  collapsed: readonly string[]
  onSetAllGroups: (next: readonly string[]) => void
  tabs: ViewTabsProps
  /** Relation columns (5E, GRO-2217): the vault root and the vault-wide declarations, for the Properties menu. */
  root?: string | null
  properties?: PropertiesResponse | null
  /**
   * The folder page's OUTLINE is showing (YAZ-820, amended YAZ-903): the outline is a free-form
   * DOCUMENT, not rows — it has no columns for the Properties menu to configure and no row values
   * for search to filter, so neither is offered.
   */
  documentView?: boolean
  /** Opens the outline's "Sync from folder" sheet (YAZ-953); the sheet and the append are the outline's own. */
  onSync: () => void
  /** The folder page bundle, for the Properties menu: its declarations, and the door they are written back through (YAZ-895). */
  folderPage: FolderPageMode
}

/** `8 items`, or `1 / 8 items` when search or limit reduce what the body shows. */
export const countLabel = (shown: number, total: number): string =>
  shown === total ? `${total} item${total === 1 ? '' : 's'}` : `${shown} / ${total} items`

/** Shared view actions: Sort, Properties, Filter, group collapse, Preview, New, Search, count. */
export function Toolbar({ def, view, viewIndex, records, filterErrors, shown, total, search, onSearch, onUpdate, onNew, allGroupKeys, collapsed, onSetAllGroups, tabs, root = null, properties = null, documentView = false, onSync, folderPage }: ToolbarProps) {
  const [open, setOpen] = useState<Menu | null>(null)
  const close = useCallback(() => setOpen(null), [])
  // Each grouping LEVEL is one rule in the badge (YAZ-745) — and an empty `groupBy: []` is none.
  const sorts = (view.sort?.length ?? 0) + groupByLevels(view).length
  const allCollapsed = allGroupKeys.every((k) => collapsed.includes(k))
  const groupsLabel = allCollapsed ? 'Expand all groups' : 'Collapse all groups'

  const button = (menu: Menu, label: string, icon: ReactNode, badge: number, body: ReactNode, extraClass?: string) => (
    <div className="view-toolbar__menu">
      <button
        type="button"
        className={`view-toolbar__btn${badge ? ' view-toolbar__btn--on' : ''}${extraClass ? ` ${extraClass}` : ''}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open === menu}
        onClick={() => setOpen(open === menu ? null : menu)}
      >
        {icon}
        {badge > 0 && <span className="view-toolbar__badge">{badge}</span>}
      </button>
      {open === menu && (
        <Popover constrainToViewport label={label} onClose={close} className={`view-popover--${menu}`}>
          {body}
        </Popover>
      )}
    </div>
  )

  return (
    <div className="view-toolbar">
      <ViewTabs {...tabs} />
      <div className="view-toolbar__actions">
        {/* The folder's notes are appended to the DOCUMENT (YAZ-953): no other skin has anywhere to put them. */}
        {documentView && (
          <button type="button" className="view-toolbar__btn" aria-label="Sync from folder" title="Sync from folder" onClick={onSync}>
            <SyncIcon />
          </button>
        )}
        {button('sort', 'Sort', <SortIcon />, sorts, <SortMenu folderPage={folderPage.settings} properties={properties} def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} />)}
        {!documentView &&
          button(
            'properties',
            'Properties',
            <PropertiesIcon />,
            0,
            <PropertiesMenu def={def} view={view} viewIndex={viewIndex} records={records} onUpdate={onUpdate} root={root} properties={properties} folderPage={folderPage} />,
          )}
        {/* An outline is a DOCUMENT, not rows (YAZ-903): there is nothing there to filter. */}
        {!documentView &&
          button(
            'filter',
            'Filter',
            <FilterIcon />,
            countRules(view.filters),
            <FilterMenu def={def} view={view} viewIndex={viewIndex} records={records} errors={filterErrors} properties={properties} folderPage={folderPage} onUpdate={onUpdate} />,
            filterErrors.length > 0 ? 'view-toolbar__btn--error' : undefined,
          )}
        {allGroupKeys.length > 0 && (
          <button
            type="button"
            className="view-toolbar__btn"
            aria-label={groupsLabel}
            title={groupsLabel}
            onClick={() => onSetAllGroups(allCollapsed ? [] : allGroupKeys)}
          >
            <ChevronsIcon />
          </button>
        )}
        {(view.type === 'table' || view.type === 'board') && !documentView && (
          <button
            type="button"
            className={`view-toolbar__btn${view.preview === true ? ' view-toolbar__btn--on' : ''}`}
            aria-label="Preview on hover"
            title="Preview on hover"
            aria-pressed={view.preview === true}
            // Off CLEANS the key — absent is off, and the YAML carries no dead `preview: false`.
            onClick={() => onUpdate((d) => (view.preview === true ? delete d.views[viewIndex].preview : (d.views[viewIndex].preview = true)))}
          >
            <EyeIcon />
          </button>
        )}
        <button type="button" className="view-toolbar__btn view-toolbar__new" aria-label="New note" title="New note" onClick={onNew}>
          <PlusIcon />
          New
        </button>
        {/* An outline is a DOCUMENT, not rows (YAZ-903): search has nothing to filter there. */}
        {!documentView && (
        <div className="view-toolbar__search">
          <button
            type="button"
            className={`view-toolbar__btn${search !== null ? ' view-toolbar__btn--on' : ''}`}
            aria-label="Search"
            title="Search"
            aria-expanded={search !== null}
            onClick={() => onSearch(search === null ? '' : null)}
          >
            <SearchIcon />
          </button>
          {search !== null && (
            <input
              className="view-input view-toolbar__search-input"
              type="search"
              aria-label="Search rows"
              placeholder="Search…"
              autoFocus
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  onSearch(null)
                }
              }}
            />
          )}
        </div>
        )}
        <span className="view-toolbar__count" aria-live="polite">
          {countLabel(shown, total)}
        </span>
      </div>
    </div>
  )
}
