/**
 * The sidebar header's vault switcher (YAZ-1767): GitHub Desktop's repository panel, keyboard-first.
 * The header's top-left button is the trigger — bold vault name plus a small chevron (D6) — and the
 * panel it drops is a `ContextMenuSurface` stretched to the header's own rect (D5), flush with the
 * sidebar. Its first element is the filter input, autofocused, query reset on every open (D7);
 * below it every recent vault as a Welcome-style row (name + relative time, then the full path,
 * because two vaults can share a basename), the CURRENT vault included and marked `aria-current`
 * (D3); and LAST, under a hairline, "Open folder…" — the existing in-place picker (D4).
 *
 * ONE rule for every vault row (D1/D3): activating it — click or ⏎ — asks main's one open-recent
 * door, `window.openRecent(path)`, which brings that vault to the front: its open windows raised
 * (D9) or, with none, a NEW window on its remembered last file (D2) — and bumps the MRU either
 * way; the current vault's row simply raises this window. A folder that is gone answers `false`:
 * the row is disabled with "Folder not found" in the time slot and the panel STAYS open
 * (Welcome's behaviour), so the next choice is one keystroke away. `true` closes the panel.
 *
 * The keyboard model (D7): ranking is `matchLinkCandidates` over the basenames (the `[[` picker's
 * ranking: exact, then prefix, then substring; an empty query is MRU order). One highlighted row;
 * with an EMPTY query it starts on the first row that is NOT the current vault — so ⌘O ⏎ jumps to
 * the last-used OTHER vault, like ⌘Tab — with a typed query on the top match, and with no match on
 * Open folder…. ↑/↓ clamp at both ends (the `[[` picker's no-wrap rule), hover moves it too, ⏎
 * activates it, Esc closes (the menu convention — not the search bar's two-press rule). Typing
 * never leaves the input: rows swallow their own mousedown. "Open folder…" is not a candidate, so
 * it is visible whatever the query; a query with no vault match shows "No matching vaults" above it.
 *
 * ⌘O (D8): App bumps `openRequest`; each new value toggles the panel — opens it with the filter focused, or closes it.
 * Rows are read fresh from `storage.getRecentRoots()` on every open, never cached across opens.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { matchCandidates } from '../search/matchCandidates'
import { basename } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { storage } from '../lib/storage'
import { TriangleIcon } from '../components/icons'

export interface VaultSwitcherProps {
  root: string
  /** "Open folder…" (D4): the sidebar's existing in-place picker, unchanged. */
  onPickFolder: () => void
  /** True while the native folder dialog is open; the "Open folder…" row is disabled meanwhile. */
  pickDisabled: boolean
  /** ⌘O (D8): a counter App bumps per request; 0 = nothing requested. Each new value TOGGLES the panel — open with the filter focused, or close. */
  openRequest: number
}

/** One recent vault as the panel ranks and draws it. `name` is what `matchLinkCandidates` matches on. */
export interface VaultRow {
  name: string
  path: string
  lastOpened: number
}

interface PanelState {
  rows: VaultRow[]
  /** Captured once per open, so every row's relative time is measured against the same instant. */
  now: number
  anchor: { x: number; y: number; width: number }
}

export const NO_MATCH_TEXT = 'No matching vaults'
export const MISSING_TEXT = 'Folder not found'
export const OPEN_FOLDER_TEXT = 'Open folder…'

/** The rows `query` keeps, ranked (D7): an empty query is MRU order untouched; otherwise the `[[` picker's ranking, uncapped. */
export function rankVaultRows(rows: readonly VaultRow[], query: string): VaultRow[] {
  return query.trim() === '' ? [...rows] : matchCandidates(rows, query, Math.max(1, rows.length))
}

/**
 * Where the highlight starts (D7). The index is over `[...matches, Open folder…]`, so with no
 * match at all it lands on the Open folder… row (= `matches.length`).
 */
export function defaultHighlight(matches: readonly { path: string }[], query: string, root: string): number {
  if (query.trim() !== '') return 0
  const other = matches.findIndex((m) => m.path !== root)
  return other === -1 ? 0 : other
}

export function VaultSwitcher({ root, onPickFolder, pickDisabled, openRequest }: VaultSwitcherProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [panel, setPanel] = useState<PanelState | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [missing, setMissing] = useState<ReadonlySet<string>>(() => new Set())
  const open = panel !== null

  const openPanel = useCallback(() => {
    // Anchor = the `.sidebar__header` rect (the trigger's parent): the panel hangs off the whole header, flush with the sidebar (D5).
    const rect = triggerRef.current?.parentElement?.getBoundingClientRect()
    const rows = storage.getRecentRoots().map((r) => ({ name: basename(r.path), path: r.path, lastOpened: r.lastOpened }))
    setPanel({ rows, now: Date.now(), anchor: rect === undefined ? { x: 0, y: 0, width: 280 } : { x: rect.left, y: rect.bottom, width: rect.width } })
    setQuery('')
    setMissing(new Set())
  }, [])
  const closePanel = useCallback(() => setPanel(null), [])

  // The filter takes focus whenever the panel mounts (D7).
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // ⌘O (D8) TOGGLES: each new request value opens the panel with a fresh query, or closes it when
  // it is already up — so ⌘O ⌘O is a no-op round trip, the way ⌘K's search bar answers a second press.
  // `openRef` mirrors `open` so this effect runs on the REQUEST alone, never on the open/close itself.
  const openRef = useRef(open)
  openRef.current = open
  useEffect(() => {
    if (openRequest === 0) return
    if (openRef.current) {
      closePanel()
      return
    }
    openPanel()
    inputRef.current?.focus()
  }, [openRequest, openPanel, closePanel])

  const matches = useMemo(() => (panel === null ? [] : rankVaultRows(panel.rows, query)), [panel, query])
  /** The Open folder… row's index in the highlight space. */
  const openFolderIndex = matches.length

  // The highlight re-seeds exactly when `matches` does — on open and on every keystroke (D7).
  useEffect(() => {
    setActive(defaultHighlight(matches, query, root))
  }, [matches, query, root])

  const choose = (path: string): void => {
    void window.yaseenDraw.window
      .openRecent(path)
      .catch((err: unknown) => {
        console.error('[vault-switcher] openRecent failed:', err)
        return false
      })
      .then((opened) => {
        if (opened) {
          closePanel()
          return
        }
        setMissing((prev) => new Set(prev).add(path))
        inputRef.current?.focus()
      })
  }

  const activate = (index: number): void => {
    if (index === openFolderIndex) {
      if (pickDisabled) return
      closePanel()
      onPickFolder()
      return
    }
    const row = matches[index]
    if (row === undefined || missing.has(row.path)) return
    choose(row.path)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive((i) => Math.min(openFolderIndex, i + 1))
        return
      case 'ArrowUp':
        e.preventDefault()
        setActive((i) => Math.max(0, i - 1))
        return
      case 'Enter':
        e.preventDefault()
        activate(active)
        return
      case 'Escape':
        e.preventDefault()
        closePanel()
        return
      default:
        return
    }
  }

  return (
    <>
      {/* stopPropagation on mousedown: the surface closes on any window mousedown, so without it a
          second click on the trigger would close and immediately reopen the panel. */}
      <button
        ref={triggerRef}
        type="button"
        className="sidebar__root"
        title={root}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => (open ? closePanel() : openPanel())}
      >
        <span className="sidebar__root-name">{basename(root)}</span>
        <span className="sidebar__root-hint" aria-hidden="true"><TriangleIcon up={open} /></span>
      </button>
      {panel !== null && (
        <ContextMenuSurface x={panel.anchor.x} y={panel.anchor.y} width={panel.anchor.width} className="ctx-menu--panel" onClose={closePanel}>
          <div className="vault-switcher">
            <input
              ref={inputRef}
              className="vault-switcher__filter"
              type="text"
              placeholder="Switch vault…"
              aria-label="Switch vault"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="vault-switcher__rows">
              {matches.length === 0 && <div className="vault-switcher__empty">{NO_MATCH_TEXT}</div>}
              {matches.map((row, i) => {
                const gone = missing.has(row.path)
                return (
                  <button
                    key={row.path}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={`vault-switcher__row${i === active ? ' vault-switcher__row--active' : ''}`}
                    aria-current={row.path === root ? 'true' : undefined}
                    disabled={gone}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => activate(i)}
                  >
                    <span className="vault-switcher__name">{row.name}</span>
                    <span className={`vault-switcher__when${gone ? ' vault-switcher__when--missing' : ''}`}>{gone ? MISSING_TEXT : relativeTime(row.lastOpened, panel.now)}</span>
                    <span className="vault-switcher__path">{row.path}</span>
                  </button>
                )
              })}
            </div>
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={`vault-switcher__row vault-switcher__open${active === openFolderIndex ? ' vault-switcher__row--active' : ''}`}
              disabled={pickDisabled}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(openFolderIndex)}
              onClick={() => activate(openFolderIndex)}
            >
              {OPEN_FOLDER_TEXT}
            </button>
          </div>
        </ContextMenuSurface>
      )}
    </>
  )
}
