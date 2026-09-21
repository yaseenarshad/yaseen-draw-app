/**
 * Multi-select (YAZ-1334): the ONE pointed end-to-end proof, per 🔒 D6 (unit suites are the
 * default evidence; this spec exists to see the real app do the whole flow once, not to be a
 * matrix). Shift+click builds the selection, the context menu copies it and opens it in
 * background tabs, ⌘⇧C copies it from the keyboard — and a plain click ends it, after which
 * the chord answers with the ACTIVE file instead. Serial: each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, expandDirs, launchApp, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const selectedRows = (w: Page) => w.locator('.tree__row--selected')
const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const readClipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz1334-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('shift+click selects, the menu copies and opens the selection, ⌘⇧C copies it, a plain click ends it', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.tree__row--file', { hasText: 'Ideas' })).toBeVisible()
  // The nested half of the selection lives under `Projects`; a launch is collapsed since YAZ-1642.
  await expandDirs(win, [path.join(vault, 'Projects')])

  // Shift+click two files (one nested): both mark selected, nothing opens, the tab stays put.
  await win.locator('.tree__row--file', { hasText: 'Ideas' }).click({ modifiers: ['Shift'] })
  await win.locator('.tree__row--file', { hasText: 'Roadmap' }).click({ modifiers: ['Shift'] })
  await expect(selectedRows(win)).toHaveCount(2)
  await expect(tabsOf(win)).toHaveCount(1)
  await shoot(win, 'yaz1334-1-two-selected')

  // Right-click inside the selection → "Copy 2 paths": the clipboard holds exactly both.
  // The renderer's clipboard write is async — clear first, then POLL rather than race it.
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await win.locator('.tree__row--file', { hasText: 'Ideas' }).click({ button: 'right' })
  await shoot(win, 'yaz1334-2-plural-menu')
  await win.locator('.ctx-menu__item', { hasText: 'Copy 2 paths' }).click()
  await expect(win.locator('.link-notice')).toHaveText('Copied 2 paths') // YAZ-1341: the copy says so
  await expect.poll(readClipboard).toContain('Ideas.md')
  expect((await readClipboard()).split('\n').sort()).toEqual(
    [path.join(vault, 'Ideas.md'), path.join(vault, 'Projects', 'Roadmap.md')].sort(),
  )
  await expect(selectedRows(win)).toHaveCount(2) // acting on the selection is not ending it

  // "Open 2 in new tabs": two background tabs append; activation never moves.
  await win.locator('.tree__row--file', { hasText: 'Roadmap' }).click({ button: 'right' })
  await win.locator('.ctx-menu__item', { hasText: 'Open 2 in new tabs' }).click()
  await expect(tabsOf(win)).toHaveCount(3)
  await expect(activeTab(win)).toHaveText(SEED_FILE.replace(/\.md$/, ''))
  await shoot(win, 'yaz1334-3-background-tabs')

  // ⌘⇧C with the selection standing: the same two paths, from the keyboard.
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await win.keyboard.press('Meta+Shift+C')
  await expect.poll(readClipboard).toContain('Ideas.md')
  expect((await readClipboard()).split('\n').sort()).toEqual(
    [path.join(vault, 'Ideas.md'), path.join(vault, 'Projects', 'Roadmap.md')].sort(),
  )

  // A plain click ends the selection and opens; ⌘⇧C now answers with the ACTIVE file.
  await win.locator('.tree__row--file', { hasText: 'Ideas' }).click()
  await expect(selectedRows(win)).toHaveCount(0)
  await app.evaluate(({ clipboard }) => clipboard.writeText(''))
  await win.keyboard.press('Meta+Shift+C')
  await expect.poll(readClipboard).toBe(path.join(vault, 'Ideas.md'))
  await shoot(win, 'yaz1334-4-cleared-active-copy')
})
