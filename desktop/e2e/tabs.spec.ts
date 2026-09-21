/**
 * Tabs I3 (GRO-2235): the tab strip against the REAL app — open-in-current-tab vs ⌘-click
 * background tabs, per-tab buffer preservation across switches, ⌃Tab cycling through the
 * menu accelerator ids, quit → relaunch tab restore, and the ⌘W ladder down to the window
 * close. Same harness as smoke.spec.ts (temp `--user-data-dir`, COPY of a generated fixture
 * vault, `i3-` step screenshots); serial by design — each step continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  clickMenuItem,
  copyVault,
  expandDirs,
  extraWindow,
  launchApp,
  quitApp,
  readState,
  SEED_BODY,
  SEED_FILE,
  seededState,
  shoot,
  windowCount,
  winParam,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const TYPED_MARKER = 'tab-buffer-5c1'
/** Bodies of the fixture's other files (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const ROADMAP_BODY = 'synthetic-roadmap-body'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted (rule 6). */
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'i3-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('step 1 — sidebar click replaces the CURRENT tab; ⌘-click appends a background tab', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(SEED_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  // A launch is collapsed since YAZ-1642: `Roadmap` is under `Projects`, so open it first.
  await expandDirs(win, [path.join(vault, 'Projects')])

  // A plain sidebar click opens in the CURRENT tab: still ONE tab, now Ideas (rule 4).
  await win.locator('.tree__row--file', { hasText: 'Ideas' }).click()
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Ideas')

  // ⌘-click another file: a background tab appends; activation (and the editor) stay put.
  await win.locator('.tree__row--file', { hasText: 'Roadmap' }).click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Ideas', 'Roadmap'])
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  expect(await windowCount(app)).toBe(1) // never a new window (the LOCKED I3 ruling)
  await shoot(win, 'i3-01-background-tab')
})

test('step 2 — switching tabs by click preserves each tab\'s content and typed buffer', async () => {
  // First activation of the background Roadmap tab lazy-mounts its editor.
  await tabsOf(win).filter({ hasText: 'Roadmap' }).click()
  await expect(editorOf(win)).toContainText(ROADMAP_BODY)

  // Type into Roadmap, switch to Ideas and back — the typed text survives the round-trip
  // (the layer stays mounted; no reload, no conflict bar).
  await editorOf(win).getByText(ROADMAP_BODY).click()
  await win.keyboard.press('End')
  await win.keyboard.type(` ${TYPED_MARKER}`, { delay: 10 })
  await expect(editorOf(win)).toContainText(TYPED_MARKER)
  await tabsOf(win).filter({ hasText: 'Ideas' }).click()
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await tabsOf(win).filter({ hasText: 'Roadmap' }).click()
  await expect(editorOf(win)).toContainText(TYPED_MARKER)
  await expect(win.locator('.conflict-bar')).toHaveCount(0)
  await shoot(win, 'i3-02-buffer-survives-switch')
})

test('step 3 — ⌃Tab / ⌃⇧Tab cycle the strip with wraparound (the menu accelerator ids)', async () => {
  // Active: Roadmap (last of [Ideas, Roadmap]). Next wraps to Ideas; Previous wraps back.
  await clickMenuItem(app, 'menu.window.next-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Ideas')
  await clickMenuItem(app, 'menu.window.prev-tab', 'w1')
  await expect(activeTab(win)).toHaveText('Roadmap')
  await shoot(win, 'i3-03-cycle-wraparound')
})

test('step 4 — quit and relaunch restores the tabs and the active tab', async () => {
  await quitApp(app) // the REAL quit path: flush handshake, windows[] kept
  const flushed = await readState(userData)
  expect(flushed.windows).toHaveLength(1)
  expect(flushed.windows[0].tabs.map((t) => path.basename(t))).toEqual(['Ideas.md', 'Roadmap.md'])
  expect(path.basename(flushed.windows[0].file!)).toBe('Roadmap.md')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(tabsOf(win)).toHaveText(['Ideas', 'Roadmap'])
  await expect(activeTab(win)).toHaveText('Roadmap')
  await expect(editorOf(win)).toContainText(TYPED_MARKER) // step 2's autosaved edit
  await shoot(win, 'i3-04-restored')
})

test('step 4b — the tab context menu sits above the editor and accepts a real click', async () => {
  await activeTab(win).click({ button: 'right' })
  const menu = win.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Copy path', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await shoot(win, 'i3-04b-tab-menu-click')
})

test('step 5 — the ⌘W ladder: tabs → empty state with the window ALIVE → window close', async () => {
  // A second window (⌘⇧N duplicate — it carries the same tabs) keeps the app alive while the
  // ladder closes the first one all the way down.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  await expect(dup.locator('.tabbar [role="tab"]')).toHaveCount(2)

  // ⌘W closes the active tab (Roadmap → Ideas takes over), then the last tab.
  await clickMenuItem(app, 'menu.file.close-tab', dupId)
  await expect(dup.locator('.tabbar [role="tab"]')).toHaveText(['Ideas'])
  await clickMenuItem(app, 'menu.file.close-tab', dupId)
  // Zero tabs: the empty state renders and the window is still ALIVE (rule 7).
  await expect(dup.locator('.tabbar [role="tab"]')).toHaveCount(0)
  await expect(dup.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  expect(await windowCount(app)).toBe(2)
  await shoot(dup, 'i3-05a-empty-state-window-alive')

  // ⌘W once more: the WINDOW closes through the real close path; the first window survives.
  await clickMenuItem(app, 'menu.file.close-tab', dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
  await expect.poll(async () => (await readState(userData)).windows.map((w) => w.id)).toEqual(['w1'])
  await expect(tabsOf(win)).toHaveText(['Ideas', 'Roadmap']) // untouched
  await shoot(win, 'i3-05b-window-closed')
  await quitApp(app)
})
