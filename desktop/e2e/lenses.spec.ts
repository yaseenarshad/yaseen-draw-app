/**
 * The lens tabs (6A-, YAZ-847) end-to-end against the REAL app: chrome v2 ROW 1 — **Topics ⇄
 * Files** — above the persistent search bar.
 *
 * Topics is the DEFAULT lens and holds the folder-page tree (YAZ-848, driven in full by
 * `topics.spec.ts` over the encyclopedia fixture); Files is today's file explorer, unchanged,
 * behind a tab. This spec is about the TABS — which body each one swaps in, and that the choice
 * is WINDOW identity (`WindowEntry.sidebarLens`, per window since YAZ-1628) surviving quit →
 * relaunch the way `sidebarWidth` does (easyWave step 2's shape). The g1 fixture declares no folder page at all, so Topics here
 * is the honest minimum: no roots, and every page under the Uncategorized row.
 *
 * The seed here is deliberately NOT `seededState`'s: that helper pre-selects Files for the rest
 * of the suite (every other spec is about the tree), so this one seeds a PRE-847 state file —
 * every key of a valid state except `sidebarLens` — which is also the honest upgrade case: an
 * existing user's `yaseendocs.json` gains the lens and lands on Topics.
 *
 * The ⌘K accelerator itself is not driven here (Playwright cannot fire a native menu
 * accelerator — search.spec.ts's note; `desktop/src/main/menu.test.ts` pins the binding). What
 * is proved below is the DOM it lands on: the bar is there on BOTH lenses, a query replaces the
 * ACTIVE tab's body, and a lens switch mid-search keeps the query (🔒 D5).
 *
 * Serial by design (the suite's idiom): each step continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AppState, WindowEntry } from '../../shared/types'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, readState, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators ----------

const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
/** FILE rows — the Files lens' own; the Topics tree wears `.tree__row` too but never this one. */
const fileRows = (w: Page) => w.locator('.tree__row--file')
/** The Topics lens' Uncategorized row (YAZ-848) — the only row this fixture's topic tree has. */
const uncategorized = (w: Page) => w.locator('.tree__row--muted')
const bodyMsg = (w: Page) => w.locator('.sidebar__body .sidebar__msg')
const searchBar = (w: Page) => w.locator('[aria-label="Search notes"]')
const resultRows = (w: Page) => w.locator('[aria-label="Search results"] [role="option"]')

/** The lens a tab row reports through `aria-selected` — exactly one at a time. */
async function expectLens(w: Page, lens: 'Topics' | 'Files'): Promise<void> {
  await expect(lensTab(w, lens)).toHaveAttribute('aria-selected', 'true')
  await expect(w.locator('.sidebar__lenses [aria-selected="true"]')).toHaveCount(1)
}

/**
 * A PRE-847 `yaseendocs.json`: `seededState`'s window/folder seed with the window's lens key
 * removed (and no retired global one either), so the store's sanitize pass is what supplies the
 * default. `JSON.stringify` drops `undefined`, so the key never reaches disk.
 */
function preLensState(vaultPath: string, file: string): AppState {
  const state = seededState(vaultPath, file)
  delete (state.windows[0] as Partial<WindowEntry>).sidebarLens
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'lenses-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the default and the switch

test('step 1 — a state file with no lens boots on TOPICS: the folder-page tree, never the file tree', async () => {
  app = await launchApp({ userData, seedState: preLensState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(lensTab(win, 'Topics')).toBeVisible()
  await expect(lensTab(win, 'Files')).toBeVisible()
  await expectLens(win, 'Topics')
  // No folder page in this fixture: no roots, and every page waiting under Uncategorized.
  await expect(uncategorized(win)).toContainText('Uncategorized')
  await expect(fileRows(win)).toHaveCount(0)
  await expect(bodyMsg(win)).toHaveCount(0)
  await expect(searchBar(win)).toBeVisible() // ALWAYS visible — on this lens too (the locked YAZ-739 rule)
  await shoot(win, 'lens-01-topics-default')
})

/*
 * The blank-space context menu is deliberately NOT driven here. On the Topics lens the sidebar
 * offers no menu of its own (🔒 YAZ-847 — the blank-space menu is the TREE's), so the right-click
 * never calls `preventDefault` and Chromium hands it to Electron's own `context-menu` listener:
 * a NATIVE cut/copy/paste popup, exactly as on the search-results body today. A native popup runs
 * its own modal loop that nothing in Playwright can dismiss — and it blocks `app.quit()`, so a
 * step that opened one would wedge the relaunch below. The DOM half ("no `.ctx-menu`") is pinned
 * in `client/src/sidebar/Sidebar.test.tsx`.
 */

test('step 2 — clicking Files shows today\'s tree, and the choice reaches the state file', async () => {
  await lensTab(win, 'Files').click()
  await expectLens(win, 'Files')
  await expect(win.locator('.tree__row--file', { hasText: 'Ideas' })).toBeVisible()
  await expect(win.locator('.tree__row--dir', { hasText: 'Projects' })).toBeVisible()
  await expect(bodyMsg(win)).toHaveCount(0)
  await expect.poll(async () => (await readState(userData)).windows[0]?.sidebarLens).toBe('files')
  await shoot(win, 'lens-02-files-tree')
})

// ---------------------------------------------------------------- search from a lens (🔒 D5)

test('step 3 — a query replaces the ACTIVE tab\'s body; the tabs row stays, and switching keeps the query', async () => {
  await searchBar(win).fill('Ideas')
  await expect(resultRows(win)).toHaveCount(1)
  await expect(fileRows(win)).toHaveCount(0) // the flat list replaces the FILES body it was typed on

  // The tabs row is still there and still clickable while a query is typed…
  await expectLens(win, 'Files')
  await lensTab(win, 'Topics').click()
  await expectLens(win, 'Topics')
  // …and the switch neither clears the query nor dismisses its results.
  await expect(searchBar(win)).toHaveValue('Ideas')
  await expect(resultRows(win)).toHaveCount(1)
  await expect(bodyMsg(win)).toHaveCount(0) // results replace the Topics body now
  await shoot(win, 'lens-03-search-on-topics')

  // Clearing lands on whichever lens is active — Topics, the one switched to.
  await searchBar(win).fill('')
  await expect(uncategorized(win)).toBeVisible()
  await expect(fileRows(win)).toHaveCount(0)
})

// ---------------------------------------------------------------- persistence

test('step 4 — the lens survives quit → relaunch, on disk as its WindowEntry.sidebarLens', async () => {
  await lensTab(win, 'Files').click()
  await expectLens(win, 'Files')
  await expect.poll(async () => (await readState(userData)).windows[0]?.sidebarLens).toBe('files')

  await quitApp(app)
  expect((await readState(userData)).windows[0]?.sidebarLens).toBe('files')
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expectLens(win, 'Files')
  await expect(win.locator('.tree__row--file', { hasText: 'Ideas' })).toBeVisible()
  await shoot(win, 'lens-04-files-restored')
  await quitApp(app)
})
