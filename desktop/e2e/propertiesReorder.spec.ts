/**
 * DRAG-TO-REORDER COLUMNS, END TO END (YAZ-1207): the Properties menu's 6-dot grip proven
 * against the REAL app over the committed encyclopedia. The ↑↓ arrows are gone; dragging the
 * `unit` row's grip above `kpi_category` rewrites the KPIs folder page's own `order` on disk
 * and the table's header row follows. Since YAZ-1513 every row and header reads the column's
 * LABEL (`file.name` → `Name`, `kpi_category` → `Kpi category`) and the table leads with the `#`
 * gutter, which is not a column and never appears in the list. Same harness as its siblings
 * (temp `--user-data-dir`, COPY of the fixture, step screenshots); serial by design.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

let app: ElectronApplication
let win: Page
let vault: string

const contents = (): Locator =>
  win.locator('.tabstack__layer:not(.tabstack__layer--hidden)').locator('.folder-page-contents')
const headers = (): Locator => contents().locator('.view-table thead th')
const rowOf = (label: string): Locator =>
  contents().locator('.view-prop').filter({ has: win.locator(`[aria-label="Reorder ${label}"]`) })

test.beforeAll(async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'propreorder-userdata-'))
  vault = await copyVault(FIXTURE)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'KPIs.md')) })
  win = await appWindow(app, 'w1')
})

test.afterAll(async () => {
  await quitApp(app)
})

test('step 1 — every shown row carries a grip, and the arrows are gone', async () => {
  await contents().locator('.view-tab__btn', { hasText: 'Table' }).click()
  await expect(headers()).toHaveText(['#', 'Name', 'Kpi category', 'Unit', 'Funnel stages'])
  await contents().locator('[aria-label="Properties"]').click()
  await expect(contents().locator('[aria-label^="Reorder "]')).toHaveCount(4)
  await expect(contents().locator('[aria-label="Reorder Name"]')).toBeVisible()
  await expect(contents().locator('[aria-label="Move up"]')).toHaveCount(0)
  await expect(contents().locator('[aria-label="Move down"]')).toHaveCount(0)
  await shoot(win, 'propreorder-01-grips')
})

test("step 2 — dragging unit's grip onto kpi_category's top half reorders the durable order and the table follows", async () => {
  await contents().locator('[aria-label="Reorder Unit"]').dragTo(rowOf('Kpi category'), {
    // The row's TOP edge: above the midpoint = the before-slot, TabBar's rule made vertical.
    targetPosition: { x: 10, y: 2 },
  })
  await expect(headers()).toHaveText(['#', 'Name', 'Unit', 'Kpi category', 'Funnel stages'])
  await expect
    .poll(async () => {
      const text = await readFile(path.join(vault, 'KPIs.md'), 'utf8')
      return /- file\.name\s*\n\s*- note\.unit\s*\n\s*- note\.kpi_category\s*\n\s*- note\.funnel_stages/.test(text)
    })
    .toBe(true)
  await shoot(win, 'propreorder-02-dragged')
})

test('step 3 — file.name itself can be dragged down, like the arrows always allowed', async () => {
  // Dropping on kpi_category's TOP half is the slot BETWEEN unit and kpi_category — one below
  // file.name's own slot, and reliably positioned however tall the rows are.
  await contents().locator('[aria-label="Reorder Name"]').dragTo(rowOf('Kpi category'), {
    targetPosition: { x: 10, y: 2 },
  })
  await expect(headers()).toHaveText(['#', 'Unit', 'Name', 'Kpi category', 'Funnel stages'])
  await expect
    .poll(async () => {
      const text = await readFile(path.join(vault, 'KPIs.md'), 'utf8')
      return /- note\.unit\s*\n\s*- file\.name\s*\n\s*- note\.kpi_category/.test(text)
    })
    .toBe(true)
  await shoot(win, 'propreorder-03-filename-moved')
  await win.keyboard.press('Escape')
})
