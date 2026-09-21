/**
 * YAZ-1176: the real Electron proof for one global content-width preference — exact preset
 * mapping, aligned note/folder-page surfaces, live switching, persistence, and narrow-window
 * fallback. The app runs against a copied vault and isolated `--user-data-dir` throughout.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(60_000)

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const NOTE = path.join('funnel-stages', 'Lead Gen.md')
const FOLDER_PAGE = 'KPIs'

const layer = (win: Page) => win.locator('.tabstack__layer:not(.tabstack__layer--hidden)')

async function pickContentWidth(win: Page, label: 'Narrow' | 'Medium' | 'Full'): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  // The dialog opens on Appearance (YAZ-1679), where the row lives; `data-setting` addresses it.
  const row = win.locator('.settings-dialog [data-setting="contentWidth"]')
  await row.getByRole('button', { name: label, exact: true }).click()
  await win.keyboard.press('Escape')
}

async function computedMaxWidths(win: Page, selectors: readonly string[]): Promise<string[]> {
  return layer(win).locator('.editor-host').evaluate((host, requested) =>
    requested.map((selector) => getComputedStyle(host.querySelector(selector)!).maxWidth), selectors)
}

async function alignedWithinHost(win: Page, selectors: readonly string[], cap: number | null): Promise<boolean> {
  return layer(win).locator('.editor-host').evaluate((host, input) => {
    const rects = input.selectors.map((selector) => host.querySelector(selector)!.getBoundingClientRect())
    // The host's CLIENT width, not its border box: a tall folder page shows the host's vertical
    // scrollbar, and on a machine with classic (non-overlay) scrollbars that is 15 px the children
    // cannot have — their `width: 100%` is of the content box (YAZ-1634).
    const expectedWidth = input.cap === null ? host.clientWidth : Math.min(host.clientWidth, input.cap)
    return (
      rects.every((rect) => Math.abs(rect.width - expectedWidth) < 1 && Math.abs(rect.left - rects[0].left) < 1) &&
      host.scrollWidth === host.clientWidth
    )
  }, { selectors, cap })
}

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'content-width-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('Narrow → Medium → Full changes the real note surfaces live and persists Full', async () => {
  const state = seededState(vault, path.join(vault, NOTE))
  state.windows[0].bounds.width = 1800
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  const noteSurfaces = ['.page-header', '.editor-instance', '.backlinks'] as const
  await expect(layer(win).locator('.editor-instance')).toBeVisible()
  await expect.poll(() => computedMaxWidths(win, noteSurfaces)).toEqual(['1040px', '1040px', '1040px'])
  await expect.poll(() => alignedWithinHost(win, noteSurfaces, 1040)).toBe(true)

  await pickContentWidth(win, 'Medium')
  await expect.poll(() => computedMaxWidths(win, noteSurfaces)).toEqual(['1440px', '1440px', '1440px'])
  await expect.poll(() => alignedWithinHost(win, noteSurfaces, 1440)).toBe(true)

  await pickContentWidth(win, 'Full')
  await expect.poll(() => computedMaxWidths(win, noteSurfaces)).toEqual(['none', 'none', 'none'])
  await expect.poll(() => alignedWithinHost(win, noteSurfaces, null)).toBe(true)
  await expect.poll(async () => (await readState(userData)).settings.contentWidth).toBe('full')
  await shoot(win, 'content-width-01-full-note')
})

test('Full aligns the folder page and Board, survives relaunch, and stays fluid in a narrow window', async () => {
  const folderRow = win.locator('.tree__row--file').filter({ has: win.locator('.tree__label', { hasText: new RegExp(`^${FOLDER_PAGE}$`) }) })
  await folderRow.click()
  await expect(layer(win).locator('.folder-page-contents')).toBeVisible()

  const boardTab = layer(win).getByRole('tab', { name: 'Board', exact: true })
  await expect(boardTab).toBeVisible()
  await boardTab.click()
  await expect(layer(win).locator('.view-board__hint')).toBeVisible()
  await layer(win).locator('[aria-label="Sort"]').click()
  await layer(win).locator('[aria-label="Group by"]').click()
  await layer(win).locator('[role="option"][data-value="note.kpi_category"]').click()
  await win.keyboard.press('Escape')
  await expect(layer(win).locator('.view-board')).toBeVisible()
  await expect(layer(win).locator('.view-board__col')).toHaveCount(2)
  const folderSurfaces = ['.page-header', '.folder-page-contents', '.backlinks'] as const
  await expect.poll(() => computedMaxWidths(win, ['.page-header', '.editor-instance', '.folder-page-contents', '.backlinks'])).toEqual(['none', 'none', 'none', 'none'])
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)
  await shoot(win, 'content-width-02-full-folder-page')

  await quitApp(app)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(layer(win).locator('.folder-page-contents')).toBeVisible()
  await expect(win.locator('.app')).toHaveAttribute('data-content-width', 'full')
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(780, 700)
  })
  await expect.poll(() => alignedWithinHost(win, folderSurfaces, null)).toBe(true)
  await shoot(win, 'content-width-03-full-narrow-window')
  await quitApp(app)
})
