/**
 * The settings dialog (YAZ-1679): one scrolling page of every section with grouped rows, nav
 * anchors with a scrollspy, search over the one registry, the popover's controls rehoused row by
 * row (Theme writes through `onChange`, the per-vault GitHub switch through `sync.setEnabled`),
 * and the modal's own contract — Esc layered over search, click-away, focus restored to whatever
 * opened it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type GithubSyncStatus, type SettingsState } from '@shared/types'
import { SettingsDialog } from './SettingsDialog'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

/** jsdom has no `scrollIntoView`; the nav's click is exactly that call, so it is a spy here. */
const scrollIntoView = vi.fn()
beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

function mount(settings: SettingsState = { ...DEFAULT_SETTINGS }, syncStatus?: GithubSyncStatus | null) {
  const onChange = vi.fn()
  const onClose = vi.fn()
  const setEnabled = vi.fn()
  // `undefined` (the argument omitted) means no Sync section at all; an explicit `null` is the
  // section present with its first status fetch still in flight.
  const sync = syncStatus === undefined ? undefined : { status: syncStatus, setEnabled }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<SettingsDialog ctx={{ settings, onChange, sync }} onClose={onClose} />))
  return { onChange, onClose, setEnabled, el: container }
}

const unmount = () => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(unmount)

const navButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')]
/** The nav in reading order, the divider included, so a test can pin what sits on each side of it. */
const navShape = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.settings-nav__item, .settings-nav__divider')].map((n) => (n.tagName === 'HR' ? '—' : n.textContent))
const navByTitle = (el: HTMLElement, title: string) => navButtons(el).find((b) => b.textContent === title) as HTMLButtonElement
const clickNav = (el: HTMLElement, title: string) => act(() => navByTitle(el, title).click())
/** The one current nav item, whichever kind: `location` on a scroll anchor, `page` on a standalone page. */
const currentNav = (el: HTMLElement) => navButtons(el).find((b) => b.getAttribute('aria-current') !== null)?.textContent
const currentKind = (el: HTMLElement) => navButtons(el).find((b) => b.getAttribute('aria-current') !== null)?.getAttribute('aria-current')
const headings = (el: HTMLElement) => [...el.querySelectorAll('.settings-section__title')].map((h) => h.textContent)
const groupTitles = (el: HTMLElement) => [...el.querySelectorAll('.settings-group__title')].map((h) => h.textContent)
const rowIds = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.setting')].map((r) => r.dataset.setting)
const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)
const rowButtons = (el: HTMLElement, id: string) => [...(row(el, id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
const searchInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]') as HTMLInputElement
const pane = (el: HTMLElement) => el.querySelector<HTMLElement>('.settings-pane') as HTMLElement
const sections = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('[data-section]')]

/** Drive a CONTROLLED input like a user: native value setter + input event. */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const pressEscape = (target: HTMLElement) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
const status = (extra: Partial<GithubSyncStatus> = {}): GithubSyncStatus => ({ root: '/vault', state: 'off', ...extra })

/**
 * jsdom lays nothing out, so the scroll geometry is stubbed: every section 300px tall in order,
 * the pane 400px tall showing the whole page as it scrolls. `scrollTop` is a plain property on
 * the pane, so setting it and dispatching `scroll` is the whole simulation.
 */
function layOut(el: HTMLElement, sectionHeight = 300, paneHeight = 400) {
  const all = sections(el)
  all.forEach((s, i) => Object.defineProperty(s, 'offsetTop', { value: i * sectionHeight, configurable: true }))
  Object.defineProperty(pane(el), 'clientHeight', { value: paneHeight, configurable: true })
  Object.defineProperty(pane(el), 'scrollHeight', { value: all.length * sectionHeight, configurable: true })
}
const scrollTo = (el: HTMLElement, top: number) =>
  act(() => {
    pane(el).scrollTop = top
    pane(el).dispatchEvent(new Event('scroll', { bubbles: true }))
  })

describe('SettingsDialog shell (D1)', () => {
  it('is a modal dialog named Settings that opens at the top with the search box focused', () => {
    const { el } = mount()
    const dialog = el.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-label')).toBe('Settings')
    expect(currentNav(el)).toBe('Appearance')
    expect(document.activeElement).toBe(searchInput(el))
  })

  it('Escape with no query closes; a mousedown on the overlay closes; one inside the dialog does not', () => {
    const { el, onClose } = mount()
    pressEscape(searchInput(el))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('.settings-dialog')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(1)
    act(() => void el.querySelector('.settings-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(onClose).toHaveBeenCalledTimes(2)
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Close settings"]')?.click())
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('gives focus back to whatever had it before — the cog, or wherever ⌘, was pressed', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)
    const { el } = mount()
    expect(document.activeElement).toBe(searchInput(el))
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('SettingsDialog: one page of every settings section (the post-demo redesign)', () => {
  it('the nav: the settings-page anchors (Sync only with the engine), a divider, then the standalone Hotkeys page', () => {
    const { el } = mount()
    expect(navShape(el)).toEqual(['Appearance', 'Files', '—', 'Hotkeys'])
    unmount()
    const withSync = mount({ ...DEFAULT_SETTINGS }, status())
    expect(navShape(withSync.el)).toEqual(['Appearance', 'Files', 'Sync', '—', 'Hotkeys'])
  })

  it('renders every settings section on the one page, in order, each anchored by id and every row addressed by data-setting — Hotkeys is not on it', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    expect(headings(el)).toEqual(['Appearance', 'Files', 'Sync'])
    expect(sections(el).map((s) => s.id)).toEqual(['settings-appearance', 'settings-files', 'settings-sync'])
    expect(rowIds(el)).toEqual(['theme', 'confirmDelete', 'githubSync'])
    for (const r of el.querySelectorAll<HTMLElement>('.setting')) expect(r.dataset.setting).toBeTruthy()
    expect(el.querySelector('[data-setting^="hotkeys"]')).toBeNull()
  })

  it('every settings-page group is untitled: the rows sit straight under their section title', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    expect(groupTitles(el)).toEqual([])
    expect([...el.querySelectorAll('.settings-group__hint')]).toEqual([])
    expect(el.querySelector('#settings-files .settings-group__title')).toBeNull()
    expect(row(el, 'theme')?.querySelector('.setting__label')?.textContent).toBe('Theme')
    expect(row(el, 'confirmDelete')?.querySelector('.setting__label')?.textContent).toBe('Confirm before deleting')
  })

  it('the Sync section carries the per-vault note under its title; no other section does', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    const notes = [...el.querySelectorAll('.settings-section__note')]
    expect(notes.map((n) => n.textContent)).toEqual(["These settings are saved in this vault's .yaseendraw folder, not app-wide."])
    expect(notes[0].closest('[data-section]')?.id).toBe('settings-sync')
  })

  it('Hotkeys is its own page: clicking it swaps the pane for its two tables and takes aria-current; no anchor is current meanwhile', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    expect(currentNav(el)).toBe('Hotkeys')
    expect(currentKind(el)).toBe('page') // a page, where an anchor says `location`
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(groupTitles(el)).toEqual(['Window', 'Mouse'])
    expect(rowIds(el)).toEqual(['hotkeys-window', 'hotkeys-mouse'])
    expect([...el.querySelectorAll('[data-setting="hotkeys-window"] .hotkeys__keys')].map((k) => k.textContent)).toContain('⌘,')
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('an anchor click from the Hotkeys page returns to the settings page and scrolls to that section', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    clickNav(el, 'Files')
    expect(currentNav(el)).toBe('Files')
    expect(headings(el)).toEqual(['Appearance', 'Files'])
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-files'))
  })

  it('an anchor click scrolls its section into view and marks it current — as a location, not a page', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    clickNav(el, 'Sync')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-sync'))
    expect(currentNav(el)).toBe('Sync')
    expect(currentKind(el)).toBe('location')
  })

  it('scrolling while the Hotkeys page shows leaves aria-current on Hotkeys — the spy only watches the settings page', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    clickNav(el, 'Hotkeys')
    scrollTo(el, 500)
    expect(currentNav(el)).toBe('Hotkeys')
    expect(currentKind(el)).toBe('page')
  })

  it('scrollspy: the current nav item follows the pane scroll — last heading above the read line, the last section at the bottom', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    layOut(el) // sections at 0 / 300 / 600, pane 400 of 900
    scrollTo(el, 0)
    expect(currentNav(el)).toBe('Appearance')
    scrollTo(el, 270) // the read line (scrollTop + 24 = 294) is still above Files' top (300)
    expect(currentNav(el)).toBe('Appearance')
    scrollTo(el, 280) // 304: Files' top is now at or above it
    expect(currentNav(el)).toBe('Files')
    // The bottom: 900 - 400 = 500, and Sync's top (600) never reaches the read line.
    scrollTo(el, 500)
    expect(currentNav(el)).toBe('Sync')
  })

  it('reopening starts at the top of the settings page again — no remembered page', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    expect(currentNav(el)).toBe('Hotkeys')
    unmount()
    const again = mount()
    expect(currentNav(again.el)).toBe('Appearance')
    expect(headings(again.el)).toEqual(['Appearance', 'Files'])
  })
})

describe('SettingsDialog rows write through the popover contracts', () => {
  it('Theme: System · Light · Dark in order, current active; Dark writes the whole object with theme flipped', () => {
    const { el, onChange } = mount()
    const buttons = rowButtons(el, 'theme')
    expect(buttons.map((b) => b.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false, false])
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    act(() => buttons[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('Confirm before deleting: On · Off with the guard ON by default, its hint in the row, and Off writing the whole object', () => {
    const { el, onChange } = mount()
    expect(row(el, 'confirmDelete')?.querySelector('.setting__hint')?.textContent).toBe('Deleted notes and folders move to the Trash either way.')
    const buttons = rowButtons(el, 'confirmDelete')
    expect(buttons.map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
    act(() => buttons[1].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, confirmDelete: false })
  })

  it('GitHub sync: the engine-stamped `enabled` is the read-back, the hint is the detected repo, and Off calls setEnabled(false) — never onChange', () => {
    const { el, setEnabled, onChange } = mount({ ...DEFAULT_SETTINGS }, status({ state: 'synced', enabled: true, repo: { remoteUrl: 'git@github.com:me/notes.git', branch: 'main' } }))
    const buttons = rowButtons(el, 'githubSync')
    expect(buttons.map((b) => b.textContent)).toEqual(['On', 'Off'])
    expect(buttons.map((b) => b.classList.contains('settings__option--active'))).toEqual([true, false])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe('repo git@github.com:me/notes.git · branch main')
    act(() => buttons[1].click())
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('GitHub sync: a null status (first fetch in flight) reads as Off, the safe default', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, null)
    expect(rowButtons(el, 'githubSync').map((b) => b.classList.contains('settings__option--active'))).toEqual([false, true])
    expect(row(el, 'githubSync')?.querySelector('.setting__hint')?.textContent).toBe("This folder isn't a git repo — set it up with GitHub Desktop, then turn sync on.")
  })
})

describe('SettingsDialog search (D6)', () => {
  it('"dark" shows the Theme row under an Appearance heading and nothing else — and the row still works', () => {
    const { el, onChange } = mount({ ...DEFAULT_SETTINGS }, status())
    type(searchInput(el), 'dark')
    expect(headings(el)).toEqual(['Appearance'])
    expect(rowIds(el)).toEqual(['theme'])
    expect(sections(el)).toEqual([]) // the page is gone while the query stands
    act(() => rowButtons(el, 'theme')[2].click())
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ ...DEFAULT_SETTINGS, theme: 'dark' })
  })

  it('a titled group heads its hits with a breadcrumb, without repeating the group title below it', () => {
    const { el } = mount()
    type(searchInput(el), 'mouse')
    expect(headings(el)).toEqual(['Hotkeys › Mouse'])
    expect(groupTitles(el)).toEqual([])
    expect(rowIds(el)).toEqual(['hotkeys-mouse'])
  })

  it('hits from several groups stack under their own breadcrumbs, in registry order', () => {
    const { el } = mount({ ...DEFAULT_SETTINGS }, status())
    // "files": the Files section (by its own title) and, on the standalone Hotkeys page, the
    // Window table whose clipboard rows name files — two breadcrumbs, registry order, never rank.
    type(searchInput(el), 'files')
    expect(headings(el)).toEqual(['Files', 'Hotkeys › Window'])
    expect(rowIds(el)).toEqual(['confirmDelete', 'hotkeys-window'])
    type(searchInput(el), 'keyboard shortcuts')
    expect(headings(el)).toEqual(['Hotkeys › Window', 'Hotkeys › Mouse'])
    expect(rowIds(el)).toEqual(['hotkeys-window', 'hotkeys-mouse'])
    type(searchInput(el), 'close tab')
    expect(headings(el)).toEqual(['Hotkeys › Window'])
    expect(rowIds(el)).toEqual(['hotkeys-window'])
  })

  it('clearing a query returns to whatever page was showing before it — the Hotkeys page included', () => {
    const { el } = mount()
    clickNav(el, 'Hotkeys')
    type(searchInput(el), 'dark')
    expect(headings(el)).toEqual(['Appearance'])
    pressEscape(searchInput(el))
    expect(headings(el)).toEqual(['Hotkeys'])
    expect(currentNav(el)).toBe('Hotkeys')
  })

  it('no hit says so, quoting the query', () => {
    const { el } = mount()
    type(searchInput(el), 'zzzz')
    expect(el.querySelector('.settings-empty')?.textContent).toBe('No settings match “zzzz”.')
    expect(rowIds(el)).toEqual([])
  })

  it('Escape with a query clears it and brings the page back; the × button does the same', () => {
    const { el, onClose } = mount()
    type(searchInput(el), 'dark')
    expect(rowIds(el)).toEqual(['theme'])
    pressEscape(searchInput(el))
    expect(onClose).not.toHaveBeenCalled()
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Appearance', 'Files'])

    type(searchInput(el), 'dark')
    act(() => el.querySelector<HTMLButtonElement>('[aria-label="Clear search settings"]')?.click())
    expect(searchInput(el).value).toBe('')
    expect(headings(el)).toEqual(['Appearance', 'Files'])
  })

  it('a nav click during a search clears the query and then scrolls to that section on the restored page', () => {
    const { el } = mount()
    type(searchInput(el), 'dark')
    clickNav(el, 'Files')
    expect(searchInput(el).value).toBe('')
    expect(currentNav(el)).toBe('Files')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.instances[0]).toBe(el.querySelector('#settings-files'))
  })
})
