/**
 * The vault switcher (YAZ-1767): the sidebar header's trigger + panel. Pins the locked decisions —
 * D3 the current vault is a row (`aria-current`), D4 "Open folder…" last, D5 dead folders stay in
 * an open panel, D6 the one-line trigger, D7 the filter/keyboard model (ranking, default
 * highlight skipping the current vault, clamp, Enter, Esc, focus never leaving the input), D8 the
 * ⌘O request. Every open goes through the mocked `window.yaseenDraw.window.openRecent` — the one
 * back-end door (D1); nothing here ever opens in place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { RecentRoots } from '@shared/types'
import { storage } from '../lib/storage'
import { MISSING_TEXT, NO_MATCH_TEXT, OPEN_FOLDER_TEXT, VaultSwitcher, defaultHighlight, rankVaultRows } from './VaultSwitcher'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/v/Notes'
const NOW = 1_700_000_000_000
/** MRU order: the current vault first (it always is — the renderer bumps it on open), then three others; two share the basename "Notes". */
const RECENTS: RecentRoots = [
  { path: ROOT, lastOpened: NOW - 60_000 },
  { path: '/w/Notes', lastOpened: NOW - 2 * 3_600_000 },
  { path: '/v/Archive', lastOpened: NOW - 86_400_000 },
  { path: '/v/Notes Archive', lastOpened: NOW - 3 * 86_400_000 },
]

let openRecent: ReturnType<typeof vi.fn>
let recentsSpy: ReturnType<typeof vi.spyOn>
let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  openRecent = vi.fn(async () => true)
  Object.defineProperty(window, 'yaseenDraw', { value: { window: { openRecent } }, configurable: true, writable: true })
  recentsSpy = vi.spyOn(storage, 'getRecentRoots').mockReturnValue(RECENTS)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  recentsSpy.mockRestore()
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.useRealTimers()
})

type Props = Parameters<typeof VaultSwitcher>[0]

function render(over: Partial<Props> = {}) {
  const props: Props = { root: ROOT, onPickFolder: vi.fn(), pickDisabled: false, openRequest: 0, ...over }
  const draw = (next: Partial<Props>) => {
    Object.assign(props, next)
    act(() =>
      root?.render(
        <StrictMode>
          {/* The real header is the anchor (D5): the trigger's parent rect is what the panel spans. */}
          <div className="sidebar__header">
            <VaultSwitcher {...props} />
          </div>
        </StrictMode>,
      ),
    )
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw({})
  return { props, rerender: draw, el: container }
}

const trigger = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__root')!
const panel = (el: HTMLElement) => el.querySelector<HTMLElement>('.ctx-menu--panel')
const filter = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.vault-switcher__filter')!
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.vault-switcher__rows .vault-switcher__row')]
const openFolderRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-switcher__open')!
const activeRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.vault-switcher__row--active')
const names = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.vault-switcher__name')?.textContent)

const openPanel = (el: HTMLElement) => act(() => trigger(el).click())
const key = (el: HTMLElement, k: string) => act(() => void filter(el).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })))
const type = async (el: HTMLElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    set?.call(filter(el), value)
    filter(el).dispatchEvent(new Event('input', { bubbles: true }))
  })
}
/** Settles the `openRecent` promise chain inside act. */
const settle = () => act(async () => {})

describe('VaultSwitcher: the trigger (D6)', () => {
  it('is one line — the bold basename and a chevron, no "change" — with the full path as its tooltip', () => {
    const { el } = render()
    const t = trigger(el)
    expect(t.querySelector('.sidebar__root-name')?.textContent).toBe('Notes')
    expect(t.querySelector('.sidebar__root-hint svg')?.getAttribute('style') ?? '').not.toContain('rotate')
    expect(t.querySelector('.sidebar__root-hint')?.getAttribute('aria-hidden')).toBe('true')
    expect(t.textContent).not.toContain('change')
    expect(t.title).toBe(ROOT)
    expect(t.getAttribute('aria-haspopup')).toBe('menu')
    expect(t.getAttribute('aria-expanded')).toBe('false')
    expect(t.disabled).toBe(false)
  })

  it('click opens the panel (chevron flips, aria-expanded), a second click closes it', () => {
    const { el } = render()
    openPanel(el)
    expect(panel(el)).not.toBeNull()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('true')
    expect(trigger(el).querySelector('.sidebar__root-hint svg')?.getAttribute('style')).toContain('rotate(180deg)')
    // The surface closes on ANY window mousedown; the trigger swallows its own so the click that
    // follows toggles closed instead of close-then-reopen.
    act(() => void trigger(el).dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(panel(el)).not.toBeNull()
    openPanel(el)
    expect(panel(el)).toBeNull()
    expect(trigger(el).getAttribute('aria-expanded')).toBe('false')
  })

  it('a mousedown anywhere else closes the panel', () => {
    const { el } = render()
    openPanel(el)
    act(() => void window.dispatchEvent(new MouseEvent('mousedown')))
    expect(panel(el)).toBeNull()
  })

  it('the panel spans the header rect (D5): a ctx-menu with the panel class and the header width', () => {
    const { el } = render()
    const header = el.querySelector<HTMLElement>('.sidebar__header')!
    header.getBoundingClientRect = () => ({ left: 0, top: 0, right: 260, bottom: 41, width: 260, height: 41, x: 0, y: 0, toJSON: () => ({}) })
    openPanel(el)
    const p = panel(el)!
    expect(p.classList.contains('ctx-menu')).toBe(true)
    expect(p.getAttribute('role')).toBe('menu')
    expect(p.style.width).toBe('260px')
  })
})

describe('VaultSwitcher: the rows (D3/D4/D5)', () => {
  it('lists every recent vault in MRU order — the current vault included and marked aria-current — with name, relative time and full path; Open folder… is the last row', () => {
    const { el } = render()
    openPanel(el)
    expect(names(el)).toEqual(['Notes', 'Notes', 'Archive', 'Notes Archive'])
    const [current, other] = rows(el)
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(other.getAttribute('aria-current')).toBeNull()
    expect(current.querySelector('.vault-switcher__path')?.textContent).toBe(ROOT)
    expect(other.querySelector('.vault-switcher__path')?.textContent).toBe('/w/Notes')
    expect(current.querySelector('.vault-switcher__when')?.textContent).toBe('1 minute ago')
    expect(other.querySelector('.vault-switcher__when')?.textContent).toBe('2 hours ago')
    // Open folder… is outside the rows list, after it, and reads as the last menu item.
    const items = [...panel(el)!.querySelectorAll('[role="menuitem"]')]
    expect(items.at(-1)?.textContent).toBe(OPEN_FOLDER_TEXT)
    expect(items).toHaveLength(5)
  })

  it('rows are read fresh from storage on EVERY open', () => {
    const { el } = render()
    openPanel(el)
    expect(names(el)).toHaveLength(4)
    openPanel(el)
    recentsSpy.mockReturnValue(RECENTS.slice(0, 2))
    openPanel(el)
    expect(names(el)).toEqual(['Notes', 'Notes'])
    expect(recentsSpy).toHaveBeenCalledTimes(2)
  })

  it('clicking a row — the current vault too (one rule for every row) — opens it through window.openRecent and closes the panel', async () => {
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[0].click())
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith(ROOT)
    expect(panel(el)).toBeNull()
  })

  it('a dead folder (openRecent → false): the row is disabled, its time slot says Folder not found, the panel STAYS open and the filter keeps focus', async () => {
    openRecent.mockResolvedValueOnce(false)
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[2].click())
    await settle()
    expect(openRecent).toHaveBeenCalledWith('/v/Archive')
    expect(panel(el)).not.toBeNull()
    const dead = rows(el)[2]
    expect(dead.disabled).toBe(true)
    expect(dead.querySelector('.vault-switcher__when')?.textContent).toBe(MISSING_TEXT)
    expect(dead.querySelector('.vault-switcher__when')?.classList.contains('vault-switcher__when--missing')).toBe(true)
    expect(document.activeElement).toBe(filter(el))
    // A dead row cannot be activated again by keyboard either: the highlight (still on the default,
    // row 1) walks onto it, Enter is a no-op, and the panel is still open.
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(dead)
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })

  it('Open folder… runs onPickFolder (in place) and closes the panel; disabled while pickDisabled', () => {
    const { el, props, rerender } = render()
    openPanel(el)
    act(() => openFolderRow(el).click())
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).toBeNull()
    expect(openRecent).not.toHaveBeenCalled()

    rerender({ pickDisabled: true })
    openPanel(el)
    expect(openFolderRow(el).disabled).toBe(true)
    act(() => openFolderRow(el).click())
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })
})

describe('VaultSwitcher: filter + keyboard (D7)', () => {
  it('the filter is first, autofocused on open, with the placeholder and label', () => {
    const { el } = render()
    openPanel(el)
    const input = filter(el)
    expect(panel(el)!.querySelector('input, button')).toBe(input)
    expect(document.activeElement).toBe(input)
    expect(input.placeholder).toBe('Switch vault…')
    expect(input.getAttribute('aria-label')).toBe('Switch vault')
    expect(input.value).toBe('')
  })

  it('the query resets on every open', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    expect(filter(el).value).toBe('arch')
    openPanel(el)
    openPanel(el)
    expect(filter(el).value).toBe('')
  })

  it('ranks like the [[ picker over basenames: exact, then prefix, then substring; an empty query is MRU order', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'notes')
    expect(names(el)).toEqual(['Notes', 'Notes', 'Notes Archive'])
    await type(el, 'arch')
    expect(names(el)).toEqual(['Archive', 'Notes Archive'])
    await type(el, '')
    expect(names(el)).toEqual(['Notes', 'Notes', 'Archive', 'Notes Archive'])
  })

  it('with an empty query the highlight starts on the first row that is NOT the current vault (⌘O ⏎ = last-used other vault)', () => {
    const { el } = render()
    openPanel(el)
    expect(activeRow(el)).toBe(rows(el)[1])
    expect(activeRow(el)?.querySelector('.vault-switcher__path')?.textContent).toBe('/w/Notes')
  })

  it('when every row is the current vault the highlight starts on the first row', () => {
    recentsSpy.mockReturnValue([RECENTS[0]])
    const { el } = render()
    openPanel(el)
    expect(activeRow(el)).toBe(rows(el)[0])
  })

  it('a typed query moves the highlight to the top match', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    expect(activeRow(el)).toBe(rows(el)[0])
    expect(activeRow(el)?.querySelector('.vault-switcher__path')?.textContent).toBe('/v/Archive')
  })

  it('no match: a muted "No matching vaults" line above Open folder…, which is always visible and takes the highlight', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'zzz')
    expect(rows(el)).toHaveLength(0)
    const empty = panel(el)!.querySelector('.vault-switcher__empty')
    expect(empty?.textContent).toBe(NO_MATCH_TEXT)
    expect((empty!.compareDocumentPosition(openFolderRow(el)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true)
    expect(openFolderRow(el).classList.contains('vault-switcher__row--active')).toBe(true)
  })

  it('↑/↓ move the highlight and CLAMP at both ends — never wrap', () => {
    const { el } = render()
    openPanel(el)
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[0])
    for (let i = 0; i < 4; i++) key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    key(el, 'ArrowDown')
    expect(activeRow(el)).toBe(openFolderRow(el))
    key(el, 'ArrowUp')
    expect(activeRow(el)).toBe(rows(el)[3])
    // Arrow keys never leave the input.
    expect(document.activeElement).toBe(filter(el))
  })

  it('hover moves the highlight too', () => {
    const { el } = render()
    openPanel(el)
    act(() => rows(el)[3].dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(activeRow(el)).toBe(rows(el)[3])
    act(() => openFolderRow(el).dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    expect(activeRow(el)).toBe(openFolderRow(el))
  })

  it('Enter opens the highlighted row through window.openRecent (the default: the last-used OTHER vault) and closes the panel', async () => {
    const { el } = render()
    openPanel(el)
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/w/Notes')
    expect(panel(el)).toBeNull()
  })

  it('Enter after typing opens the top match', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'notes arch')
    key(el, 'Enter')
    await settle()
    expect(openRecent).toHaveBeenCalledExactlyOnceWith('/v/Notes Archive')
  })

  it('Enter on Open folder… runs the picker; not while pickDisabled', () => {
    const { el, props, rerender } = render()
    openPanel(el)
    for (let i = 0; i < 5; i++) key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(openRecent).not.toHaveBeenCalled()
    expect(panel(el)).toBeNull()

    rerender({ pickDisabled: true })
    openPanel(el)
    for (let i = 0; i < 5; i++) key(el, 'ArrowDown')
    key(el, 'Enter')
    expect(props.onPickFolder).toHaveBeenCalledTimes(1)
    expect(panel(el)).not.toBeNull()
  })

  it('Esc closes the panel on the first press (the menu convention, not the search bar\'s two-press rule)', async () => {
    const { el } = render()
    openPanel(el)
    await type(el, 'arch')
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
  })

  it('clicking a row never steals focus from the filter (mousedown is swallowed)', () => {
    const { el } = render()
    openPanel(el)
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    rows(el)[1].dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(filter(el))
  })
})

describe('VaultSwitcher: ⌘O (D8)', () => {
  it('each new openRequest value TOGGLES: opens with the filter focused, a second one closes, a third reopens with the query reset; 0 requests nothing', async () => {
    const { el, rerender } = render()
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 1 })
    expect(panel(el)).not.toBeNull()
    expect(document.activeElement).toBe(filter(el))
    await type(el, 'arch')
    // Still open: a second ⌘O closes it (the ⌘K rule) — no re-read of the rows.
    rerender({ openRequest: 2 })
    expect(panel(el)).toBeNull()
    expect(recentsSpy).toHaveBeenCalledTimes(1)
    // A third opens afresh: rows re-read, query cleared, filter focused.
    rerender({ openRequest: 3 })
    expect(panel(el)).not.toBeNull()
    expect(filter(el).value).toBe('')
    expect(document.activeElement).toBe(filter(el))
    expect(recentsSpy).toHaveBeenCalledTimes(2)
  })

  it('a request already consumed does not reopen after Esc; the next one does', () => {
    const { el, rerender } = render({ openRequest: 3 })
    expect(panel(el)).not.toBeNull()
    key(el, 'Escape')
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 3 })
    expect(panel(el)).toBeNull()
    rerender({ openRequest: 4 })
    expect(panel(el)).not.toBeNull()
  })
})

describe('VaultSwitcher: pure helpers', () => {
  const rowsOf = (...paths: string[]) => paths.map((path, i) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, lastOpened: i }))

  it('rankVaultRows: empty query keeps MRU order, otherwise exact > prefix > substring, uncapped', () => {
    const list = rowsOf('/a/Notes', '/b/Old Notes', '/c/Notes Archive', '/d/Other', '/e/n1', '/f/n2', '/g/n3', '/h/n4', '/i/n5', '/j/n6')
    expect(rankVaultRows(list, '  ').map((r) => r.path)).toEqual(list.map((r) => r.path))
    expect(rankVaultRows(list, 'notes').map((r) => r.path)).toEqual(['/a/Notes', '/c/Notes Archive', '/b/Old Notes'])
    // The [[ picker caps at 8; the switcher shows every match.
    expect(rankVaultRows(list, 'n')).toHaveLength(9)
  })

  it('defaultHighlight: skips the current root on an empty query, 0 otherwise (which is Open folder… when nothing matches)', () => {
    const list = rowsOf('/v/cur', '/v/a', '/v/b')
    expect(defaultHighlight(list, '', '/v/cur')).toBe(1)
    expect(defaultHighlight(list, '', '/v/none')).toBe(0)
    expect(defaultHighlight(rowsOf('/v/cur'), '', '/v/cur')).toBe(0)
    expect(defaultHighlight([], '', '/v/cur')).toBe(0)
    expect(defaultHighlight(list, 'a', '/v/cur')).toBe(0)
    expect(defaultHighlight([], 'zzz', '/v/cur')).toBe(0)
  })
})
