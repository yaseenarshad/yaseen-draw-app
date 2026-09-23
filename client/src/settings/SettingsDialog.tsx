/**
 * THE SETTINGS DIALOG (YAZ-1679): a centred modal — ONE long page of every section, grouped rows
 * under section and group headings, scrolling on the right; the section titles down the left as
 * anchors with a scrollspy, under a search box. It replaces the 220px popover that grew above the
 * sidebar cog (GRO-2024) and folds the hotkey reference (GRO-2067) in as its own page. App mounts
 * it, so the cog, ⌘, and the app menu's Settings… all open the ONE dialog.
 *
 * What it shows comes entirely from `SETTINGS_SECTIONS` (registry.tsx): the nav lists the
 * sections this context can show, the page renders them all in order, and search runs over the
 * same items — a setting declared once appears in all three.
 *
 * ONE PAGE, NOT PAGES (Yasin's call after the demo): every setting is on the page at once, so a
 * nav click is a scroll, not a route, and the active nav item is DERIVED from where the page is
 * scrolled to. Opening always starts at the top. The one exception is a `standalone` section
 * (Hotkeys — a reference table, noise among settings): it is its own page inside the dialog,
 * listed under a divider in the nav, and `page` names it while it is showing; `null` is the
 * settings page.
 *
 * ⚡ KEYS ARE THE OVERLAY'S, NEVER `window`'s (⚡ YAZ-888): React
 * flushes mount effects inside the dispatch of the event that opened the dialog, so a `window`
 * mousedown listener installed on mount would hear the cog click that opened it and close it in
 * the same tick. Bound to the overlay, it only hears what happens inside itself.
 *
 * Esc is layered: with a query typed it clears the search (back to the page); with none it
 * closes. Focus goes to the search box on open, and whatever had focus before — the cog, the
 * editor ⌘, was pressed in — gets it back on close.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { SearchIcon } from '../components/icons'
import { availableGroups, availableSections, resolveHint, resolveWide, type SettingDef, type SettingsCtx, type SettingsGroup, type SettingsSection, type SettingsSectionId } from './registry'
import { searchSettings, settingCandidates } from './searchSettings'
import { SettingRow } from './SettingRow'
import './settings.css'

/**
 * How far below the pane's top edge a section heading may sit and still count as "the one you
 * are reading" — a touch more than the pane's `scroll-padding-top`, so a section the nav just
 * scrolled to (landing exactly under the padding) is the active one, not its predecessor.
 */
const SPY_OFFSET = 24

const anchorId = (id: SettingsSectionId) => `settings-${id}`

interface SettingsDialogProps {
  ctx: SettingsCtx
  onClose: () => void
}

export function SettingsDialog({ ctx, onClose }: SettingsDialogProps) {
  const sections = availableSections(ctx)
  const scrollSections = sections.filter((s) => s.standalone !== true)
  const pages = sections.filter((s) => s.standalone === true)
  const paneRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  /** The standalone page showing, or null for the settings page. Search leaves it alone, so clearing a query returns to it. */
  const [page, setPage] = useState<SettingsSectionId | null>(null)
  /** The scrollspy's answer: which scroll section is being read. Meaningful only while `page` is null. */
  const [active, setActive] = useState<SettingsSectionId>(scrollSections[0].id)
  /** An anchor click's target, applied after the render that (re)shows the settings page — a search or a standalone page may be leaving. */
  const [pending, setPending] = useState<SettingsSectionId | null>(null)

  useEffect(() => {
    const previous = document.activeElement
    searchRef.current?.focus()
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  /**
   * The scrollspy: at the top the first section is being read; otherwise the LAST section whose
   * top is at or above the read line; at the very bottom the last section, even when the page is
   * too short for its heading to reach the read line. Sections are the pane's offset children
   * (`position: relative` on it), so `offsetTop` is scroll-independent. A standalone page has
   * no anchors to spy on.
   */
  const updateActive = (): void => {
    const pane = paneRef.current
    if (pane === null || page !== null) return
    const anchors = pane.querySelectorAll<HTMLElement>('[data-section]')
    const atBottom = pane.scrollTop > 0 && pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1
    let reading = anchors[0]
    if (atBottom) reading = anchors[anchors.length - 1]
    else if (pane.scrollTop > 0) {
      for (let i = anchors.length - 1; i > 0; i--) {
        if (anchors[i].offsetTop <= pane.scrollTop + SPY_OFFSET) {
          reading = anchors[i]
          break
        }
      }
    }
    setActive(reading.dataset.section as SettingsSectionId)
  }

  useEffect(() => {
    if (pending === null) return
    // Instant, not smooth: a smooth scroll fires the spy on every intermediate frame and the nav
    // highlight walks through the sections in between. A nav click is a jump, like a page switch.
    paneRef.current?.querySelector(`#${anchorId(pending)}`)?.scrollIntoView({ block: 'start' })
    setPending(null)
  }, [pending])

  // Built once per open: the searchable text is labels, hints and keywords, none of which a click
  // inside the dialog changes in a way search needs to see.
  const candidates = useMemo(() => settingCandidates(ctx), [])
  const searching = query.trim() !== ''
  const hits = searching ? searchSettings(candidates, query) : []

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    if (query !== '') setQuery('')
    else onClose()
  }

  /** An anchor click is a scroll — a search or a standalone page first gives way so there is a page to scroll. */
  const jumpTo = (id: SettingsSectionId): void => {
    setQuery('')
    setPage(null)
    setActive(id)
    setPending(id)
  }
  /** A standalone item is a page swap; a query in progress is dropped like any other navigation. */
  const showPage = (id: SettingsSectionId): void => {
    setQuery('')
    setPage(id)
  }

  const row = (item: SettingDef) => (
    <SettingRow key={item.id} id={item.id} label={item.label} hint={resolveHint(item, ctx)} wide={resolveWide(item)} bare={item.bare === true}>
      {item.render(ctx)}
    </SettingRow>
  )
  /** `titled` is false under a search breadcrumb, which already names the group. */
  const group = (g: SettingsGroup, items: readonly SettingDef[], key: number, titled = true) => (
    <div key={key} className="settings-group">
      {titled && g.title !== undefined && <h3 className="settings-group__title">{g.title}</h3>}
      {g.hint !== undefined && <p className="settings-group__hint">{g.hint}</p>}
      <div className="settings-group__card">{items.map(row)}</div>
    </div>
  )
  const section = (s: SettingsSection) => (
    <section key={s.id} id={anchorId(s.id)} data-section={s.id} className="settings-section">
      <h2 className="settings-section__title">{s.title}</h2>
      {s.note !== undefined && <p className="settings-section__note">{s.note}</p>}
      {availableGroups(s, ctx).map((g, i) => group(g, g.items, i))}
    </section>
  )

  // Hits under a breadcrumb per group ("Canvas › Drawing defaults"; an untitled group is just its
  // section). `candidates` is in registry order, so walking it keeps groups and rows in the order
  // the page shows them; the matcher's ranking decided only WHICH rows are here.
  const matched = new Set(hits)
  const hitGroups: { section: SettingsSection; group: SettingsGroup; items: SettingDef[] }[] = []
  for (const candidate of candidates) {
    if (!matched.has(candidate)) continue
    const last = hitGroups[hitGroups.length - 1]
    if (last?.group === candidate.group) last.items.push(candidate.item)
    else hitGroups.push({ section: candidate.section, group: candidate.group, items: [candidate.item] })
  }

  return (
    <div className="settings-overlay" tabIndex={-1} onMouseDown={onClose} onKeyDown={onKeyDown}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav" aria-label="Settings sections">
          <div className="settings-search">
            <SearchIcon />
            <input ref={searchRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings…" aria-label="Search settings" autoComplete="off" spellCheck={false} />
            {query !== '' && (
              <button
                type="button"
                aria-label="Clear search settings"
                onClick={() => {
                  setQuery('')
                  searchRef.current?.focus()
                }}
              >
                ×
              </button>
            )}
          </div>
          {/* `location` = where you are in a scrolled document; `page` = the standalone page showing. */}
          {scrollSections.map((s) => (
            <button key={s.id} type="button" className="settings-nav__item" aria-current={page === null && s.id === active ? 'location' : undefined} onClick={() => jumpTo(s.id)}>
              {s.title}
            </button>
          ))}
          <hr className="settings-nav__divider" />
          {pages.map((s) => (
            <button key={s.id} type="button" className="settings-nav__item" aria-current={page === s.id ? 'page' : undefined} onClick={() => showPage(s.id)}>
              {s.title}
            </button>
          ))}
        </nav>
        <button type="button" className="settings-dialog__close" aria-label="Close settings" onClick={onClose}>
          ✕
        </button>
        <div ref={paneRef} className="settings-pane" onScroll={updateActive}>
          {searching ? (
            hitGroups.length === 0 ? (
              <p className="settings-empty">No settings match “{query}”.</p>
            ) : (
              hitGroups.map((entry, i) => (
                <section key={i} className="settings-section">
                  <h2 className="settings-section__title">{entry.group.title === undefined ? entry.section.title : `${entry.section.title} › ${entry.group.title}`}</h2>
                  {group(entry.group, entry.items, 0, false)}
                </section>
              ))
            )
          ) : page === null ? (
            scrollSections.map(section)
          ) : (
            // `page` only ever holds a standalone section's id (`open` from the nav).
            section(pages.find((s) => s.id === page) as SettingsSection)
          )}
        </div>
      </div>
    </div>
  )
}
