import type { ReactElement } from 'react'

/** 14px stroked glyphs for the Bases toolbar, in the sidebar's style (GRO-2135). */

const svg = {
  width: 14,
  height: 14,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/**
 * Panel-left pictogram shared by the sidebar's collapse button and the tab strip's Show-sidebar
 * button (GRO-2023; moved here from `sidebar/Sidebar.tsx` by YAZ-1759 once TabBar wore it too).
 * Deliberately NOT on the shared `svg` spread: its square line caps are the original pixels.
 */
/** Octicons' `triangle-down` (the chevron GitHub Desktop's repository switcher wears, YAZ-1767 D6); `up` flips it while the panel is open. */
export function TriangleIcon({ up = false }: { up?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" style={up ? { transform: 'rotate(180deg)' } : undefined}>
      <path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z" />
    </svg>
  )
}

export function SidebarPanelIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.75" y1="2.5" x2="5.75" y2="13.5" />
    </svg>
  )
}

/**
 * 2×2 grid marking a FOLDER PAGE row in the outline (YAZ-820) and in its add-row picker; same
 * stroke weight as `SidebarPanelIcon`. It lived in `sidebar/Tree.tsx` while tree rows and tabs
 * wore it too; YAZ-844 left the folder page its only wearer, so it moved in with the rest of
 * the folder-page glyphs.
 */
export function FolderPageGlyph({ className }: { className: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1" />
      <line x1="6" y1="1.5" x2="6" y2="10.5" />
      <line x1="1.5" y1="6" x2="10.5" y2="6" />
    </svg>
  )
}

export const PlusIcon = () => (
  <svg {...svg}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

/** Funnel, for the toolbar's Filter menu (YAZ-1227). */
export const FilterIcon = () => (
  <svg {...svg}>
    <path d="M2.5 3h11L9.2 8.2v4.4l-2.4 1.2V8.2z" />
  </svg>
)

export const SortIcon = () => (
  <svg {...svg}>
    <path d="M5 2.5v11M2.5 11 5 13.5 7.5 11M11 13.5v-11M8.5 5 11 2.5 13.5 5" />
  </svg>
)

export const PropertiesIcon = () => (
  <svg {...svg}>
    <path d="M2 5h12M2 11h12" />
    <circle cx="6" cy="5" r="1.6" fill="var(--bg)" />
    <circle cx="10" cy="11" r="1.6" fill="var(--bg)" />
  </svg>
)

export const SearchIcon = () => (
  <svg {...svg}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3.5 3.5" />
  </svg>
)

export const PencilIcon = () => (
  <svg {...svg}>
    <path d="m3 13 .8-3.2L11.2 2.4l2.4 2.4-7.4 7.4z" />
  </svg>
)

/** Stacked chevrons, for the toolbar's collapse / expand all groups toggle (YAZ-744). */
export const ChevronsIcon = () => (
  <svg {...svg}>
    <path d="M4.5 4 8 7l3.5-3M4.5 9 8 12l3.5-3" />
  </svg>
)

/** Circling arrows, for the toolbar's "Sync from folder" (YAZ-953). */
export const SyncIcon = () => (
  <svg {...svg}>
    <path d="M15.3 2.7v4h-4M0.7 13.3v-4h4" />
    <path d="M2.3 6a6 6 0 0 1 9.9-2.2l3.1 2.9M0.7 9.3l3.1 2.9A6 6 0 0 0 13.7 10" />
  </svg>
)

/** Chain link, for the relation-column editor (5E, GRO-2217). */
export const RelationIcon = () => (
  <svg {...svg}>
    <path d="M6.5 9.5 9.5 6.5M7.8 4.6l1.5-1.5a2.3 2.3 0 0 1 3.6 3.6l-1.5 1.5M8.2 11.4l-1.5 1.5a2.3 2.3 0 0 1-3.6-3.6l1.5-1.5" />
  </svg>
)

/** Eye, for the toolbar's preview-on-hover toggle (YAZ-1244). */
export const EyeIcon = () => (
  <svg {...svg}>
    <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4z" />
    <circle cx="8" cy="8" r="1.8" />
  </svg>
)

/** The Favorites lens tab (YAZ-1766 D1, a glyph not a word — Yasin, demo 2026-09-21); filled while active via CSS. */
export const HeartIcon = () => (
  <svg {...svg} width={15} height={15} viewBox="0 0 24 24" strokeWidth={2} className="heart-icon">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
)

/** 6-dot grip, for dragging a shown property into place (YAZ-1207) — dots, so filled, not stroked. */
export const DragHandleIcon = () => (
  <svg {...svg}>
    <g fill="currentColor" stroke="none">
      <circle cx="6" cy="4" r="1" />
      <circle cx="10" cy="4" r="1" />
      <circle cx="6" cy="8" r="1" />
      <circle cx="10" cy="8" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="10" cy="12" r="1" />
    </g>
  </svg>
)

const TYPE_GLYPHS: Record<string, ReactElement> = {
  table: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.2" />
      <path d="M2 6.5h12M6.5 6.5V13" />
    </>
  ),
  cards: (
    <>
      <rect x="2" y="2.5" width="5" height="5" rx="1" />
      <rect x="9" y="2.5" width="5" height="5" rx="1" />
      <rect x="2" y="8.5" width="5" height="5" rx="1" />
      <rect x="9" y="8.5" width="5" height="5" rx="1" />
    </>
  ),
  list: <path d="M2 4h12M2 8h12M2 12h12" />,
  map: (
    <>
      <path d="M8 14s-4-4.2-4-7.3a4 4 0 0 1 8 0C12 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.7" r="1.3" />
    </>
  ),
  board: (
    <>
      <rect x="2" y="2.5" width="3.2" height="11" rx="0.8" />
      <rect x="6.4" y="2.5" width="3.2" height="7" rx="0.8" />
      <rect x="10.8" y="2.5" width="3.2" height="9" rx="0.8" />
    </>
  ),
}

/** Small glyph for a view's `type`; unknown types get a plain frame. */
export function ViewTypeIcon({ type }: { type: string }) {
  return <svg {...svg}>{TYPE_GLYPHS[type] ?? <rect x="2" y="3" width="12" height="10" rx="1.2" />}</svg>
}

/** A `file.*` field in the properties list (YAZ-1513): the page's own facts, never a note property. */
export const FileFieldIcon = () => (
  <svg {...svg}>
    <path d="M4 2h5l3 3v9H4z" />
    <path d="M9 2v3h3" />
  </svg>
)

/** A `formula.*` column in the properties list (YAZ-1513). */
export const FormulaIcon = () => (
  <svg {...svg}>
    <path d="M10.5 3c-1.6 0-2.3 1-2.5 2.6L6.9 12c-.2 1.3-.9 2-2.4 2" />
    <path d="M5.5 7.5h5.5" />
  </svg>
)
