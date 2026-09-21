/**
 * The settings DIALOG itself (YAZ-1679, spec'd in YAZ-1689): the three ways in (cog, ⌘, via the
 * app menu, and the menu with the sidebar collapsed — when there is no cog to click), the nav's
 * order and its divider, search narrowing the page to hits under breadcrumbs, the two-stage
 * Escape, the three ways out, the Hotkeys page swap, and a change surviving close → reopen.
 * theme.spec.ts / contentWidth.spec.ts / sync.spec.ts each prove ONE setting's effect on the app;
 * this spec proves the frame those rows sit in. Same harness as smoke.spec.ts: temp
 * `--user-data-dir`, a COPY of a generated fixture vault, `settings-` step screenshots. Serial:
 * one launch, each step continuing the last one's state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, clickMenuItem, copyVault, launchApp, quitApp, readState, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The nav as the registry orders it (registry.tsx): four scroll sections, a divider, the one standalone page. */
const NAV_ORDER = ['Appearance', 'Editor', 'Files & Links', 'Sync', '—', 'Hotkeys'] as const

// ---------- the dialog's parts, by role and stable class only (never position) ----------

const cog = (w: Page) => w.getByRole('button', { name: 'Settings', exact: true })
const dialog = (w: Page) => w.locator('.settings-dialog[role="dialog"]')
const search = (w: Page) => dialog(w).getByRole('textbox', { name: 'Search settings', exact: true })
const closeButton = (w: Page) => dialog(w).getByRole('button', { name: 'Close settings', exact: true })
/** A nav button by its exact title (`hasText` alone is a substring match; `&` is not special in a regex). */
const navItem = (w: Page, title: string) => dialog(w).locator('.settings-nav__item', { hasText: new RegExp(`^${title}$`) })
const headings = (w: Page) => dialog(w).locator('.settings-section__title')
const rows = (w: Page) => dialog(w).locator('[data-setting]')
const row = (w: Page, id: string) => dialog(w).locator(`[data-setting="${id}"]`)

/**
 * The nav's children in DOM order, section buttons by their text and the divider as `—` — the
 * one fact the "divider before Hotkeys" requirement is about, so it is read as a sequence rather
 * than through a sibling selector.
 */
const navSequence = (w: Page): Promise<string[]> =>
  dialog(w)
    .locator('.settings-nav')
    .evaluate((nav) =>
      Array.from(nav.children)
        .filter((el) => el.classList.contains('settings-nav__item') || el.classList.contains('settings-nav__divider'))
        .map((el) => (el.classList.contains('settings-nav__divider') ? '—' : (el.textContent ?? ''))),
    )

const paneScrollTop = (w: Page): Promise<number> => dialog(w).locator('.settings-pane').evaluate((pane) => pane.scrollTop)

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'settings-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the sidebar cog opens the dialog at the top: nav in registry order, divider before Hotkeys, Appearance current', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toBeVisible() // the seeded note is open; the app is up

  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toBeFocused() // focus lands in the search box on open

  // The nav lists exactly the registry's sections, in its order, with the standalone page walled
  // off under the divider — Sync is there because App always hands the engine over.
  await expect.poll(() => navSequence(win)).toEqual([...NAV_ORDER])

  // Opening always starts at the top: the pane is unscrolled, so the scrollspy names Appearance —
  // a `location` (where you are in the scrolled page), never `page` (that is the Hotkeys kind).
  expect(await paneScrollTop(win)).toBe(0)
  await expect(navItem(win, 'Appearance')).toHaveAttribute('aria-current', 'location')
  await expect(dialog(win).locator('.settings-nav__item[aria-current]')).toHaveCount(1)
  // ONE page, every section on it: the first heading is Appearance and the Sync row is already in the DOM.
  await expect(headings(win).first()).toHaveText('Appearance')
  await expect(row(win, 'theme')).toBeVisible()
  await expect(row(win, 'githubSync')).toBeAttached()
  await shoot(win, 'settings-01-open-from-cog')

  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
})

test('step 2 — Settings… in the app menu (⌘,) opens the same dialog, with or without a sidebar to click', async () => {
  // The REAL menu path: the item by its stable id, focused on w1 so main's focused-window send lands here.
  await clickMenuItem(app, 'menu.app.settings', 'w1')
  await expect(dialog(win)).toBeVisible()
  await expect(navItem(win, 'Appearance')).toHaveAttribute('aria-current', 'location')
  await shoot(win, 'settings-02-open-from-menu')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // With the sidebar collapsed the cog does not exist (App unmounts the sidebar) — the menu is
  // then the ONLY pointer-free way in besides the accelerator it carries, and it still works.
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(cog(win)).toHaveCount(0)
  await clickMenuItem(app, 'menu.app.settings', 'w1')
  await expect(dialog(win)).toBeVisible()
  await shoot(win, 'settings-03-open-from-menu-sidebar-collapsed')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // Leave the sidebar as the next steps need it: with a cog.
  await clickMenuItem(app, 'menu.view.toggle-sidebar', 'w1')
  await expect(cog(win)).toBeVisible()
})

test('step 3 — search narrows the page to hits under breadcrumbs, and a hit still works', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()

  // "dark" is a Theme keyword and nothing else's: one row, under its section as the heading
  // (an untitled group's breadcrumb is just the section).
  await search(win).fill('dark')
  await expect(rows(win)).toHaveCount(1)
  await expect(row(win, 'theme')).toBeVisible()
  await expect(headings(win)).toHaveText(['Appearance'])
  await shoot(win, 'settings-04-search-dark')

  // A hit is the live row, not a copy: clicking Dark in it changes the real setting.
  await row(win, 'theme').getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(row(win, 'theme').getByRole('button', { name: 'Dark', exact: true })).toHaveClass(/settings__option--active/)
  await expect.poll(async () => (await readState(userData)).settings.theme).toBe('dark')

  // "threading" matches on the GROUP title: its three rows, under "section › group".
  await search(win).fill('threading')
  await expect(headings(win)).toHaveText(['Editor › Bullet threading'])
  await expect(rows(win)).toHaveCount(3)
  await expect(row(win, 'bulletThreading')).toBeVisible()
  await expect(row(win, 'threadWidth')).toBeVisible()
  await expect(row(win, 'threadColor')).toBeVisible()
  await shoot(win, 'settings-05-search-threading')

  // Nothing matches: the empty state, no rows, no headings.
  await search(win).fill('zzz')
  await expect(dialog(win).locator('.settings-empty')).toHaveText('No settings match “zzz”.')
  await expect(rows(win)).toHaveCount(0)
  await expect(headings(win)).toHaveCount(0)
  await shoot(win, 'settings-06-search-empty')
})

test('step 4 — Escape is two-stage (clear the search, then close); the × and the overlay close too', async () => {
  // Continuing step 3: the dialog is open with "zzz" in the search box.
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toHaveValue('zzz')

  // First Escape: the query goes, the dialog stays, the full page is back.
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toBeVisible()
  await expect(search(win)).toHaveValue('')
  await expect(headings(win).first()).toHaveText('Appearance')
  await expect(row(win, 'theme')).toBeVisible()
  await shoot(win, 'settings-07-escape-cleared-search')

  // Second Escape, nothing to clear: the dialog closes.
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  // The × button.
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await closeButton(win).click()
  await expect(dialog(win)).toHaveCount(0)

  // The overlay: a mousedown outside the sheet. The sheet is centred and at most 920×680 in an
  // 1100×750 window, so the overlay's top-left corner is never under it.
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await win.locator('.settings-overlay').click({ position: { x: 8, y: 8 } })
  await expect(dialog(win)).toHaveCount(0)
  await shoot(win, 'settings-08-closed-by-overlay')
})

test('step 5 — Hotkeys is its own page inside the dialog; Appearance brings the settings page back', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()

  await navItem(win, 'Hotkeys').click()
  await expect(navItem(win, 'Hotkeys')).toHaveAttribute('aria-current', 'page') // a page, not a location
  await expect(dialog(win).locator('.settings-nav__item[aria-current]')).toHaveCount(1)
  // A page swap, not a scroll: the one heading is Hotkeys and the settings rows are gone from the DOM.
  await expect(headings(win)).toHaveText(['Hotkeys'])
  await expect(row(win, 'theme')).toHaveCount(0)
  await expect(row(win, 'hotkeys-keyboard')).toBeVisible()
  await expect(dialog(win).locator('.hotkeys__row').first()).toBeVisible()
  await shoot(win, 'settings-09-hotkeys-page')

  await navItem(win, 'Appearance').click()
  await expect(navItem(win, 'Appearance')).toHaveAttribute('aria-current', 'location')
  await expect(headings(win).first()).toHaveText('Appearance')
  await expect(row(win, 'theme')).toBeVisible()
  await expect(row(win, 'hotkeys-keyboard')).toHaveCount(0)
  await shoot(win, 'settings-10-back-to-settings-page')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
})

test('step 6 — a change survives close and reopen, and reached the state file', async () => {
  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  const width = row(win, 'contentWidth')
  await expect(width.getByRole('button', { name: 'Narrow', exact: true })).toHaveClass(/settings__option--active/) // the default
  await width.getByRole('button', { name: 'Full', exact: true }).click()
  await expect(width.getByRole('button', { name: 'Full', exact: true })).toHaveClass(/settings__option--active/)
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)

  await cog(win).click()
  await expect(dialog(win)).toBeVisible()
  await expect(row(win, 'contentWidth').getByRole('button', { name: 'Full', exact: true })).toHaveClass(/settings__option--active/)
  await expect(row(win, 'contentWidth').getByRole('button', { name: 'Narrow', exact: true })).not.toHaveClass(/settings__option--active/)
  await expect.poll(async () => (await readState(userData)).settings.contentWidth).toBe('full')
  await shoot(win, 'settings-11-full-persisted')
  await win.keyboard.press('Escape')
  await expect(dialog(win)).toHaveCount(0)
  await quitApp(app)
})
