/**
 * THE BOARD, END TO END (YAZ-935/YAZ-945): the kanban proven against the REAL app over the
 * committed encyclopedia. The Board view is DECLARED on the card (`KPIs.md`; the YAZ-935 read-time
 * injection was retired by YAZ-1471 D3), so the tab this spec clicks is one the file itself lists.
 * The arc: the third tab is just there → the group-by set through the Sort menu turns the hint
 * into columns → dragging a card across columns rewrites the MEMBER's own file on disk → the
 * YAZ-943 inline add births a NAMED page into the column it was typed in, without leaving the
 * board. Same harness as its siblings (temp `--user-data-dir`, COPY of the fixture, `board-` step
 * screenshots); serial by design — each step continues the previous state.
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
const colOf = (label: string): Locator =>
  contents().locator('.view-board__col').filter({ has: win.locator(`.view-group__value:text-is("${label}")`) })

test.beforeAll(async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'board-userdata-'))
  vault = await copyVault(FIXTURE)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'KPIs.md')) })
  win = await appWindow(app, 'w1')
})

test.afterAll(async () => {
  await quitApp(app)
})

test('step 1 — the Board tab is just THERE, declared on the card alongside the outline and the table', async () => {
  await expect(contents().locator('.view-tab__btn')).toHaveText(['Outline', 'Table', 'Board'])
  await shoot(win, 'board-01-injected-tab')
})

test('step 2 — no group-by yet shows the hint; the Sort menu turns it into columns', async () => {
  await contents().locator('.view-tab__btn', { hasText: 'Board' }).click()
  await expect(contents().locator('.view-board__hint')).toBeVisible()
  await shoot(win, 'board-02-hint')
  await contents().locator('[aria-label="Sort"]').click()
  await contents().locator('[aria-label="Group by"]').click()
  await contents().locator('[role="option"][data-value="note.kpi_category"]').click()
  await win.keyboard.press('Escape')
  await expect(contents().locator('.view-board__col')).toHaveCount(2)
  await expect(colOf('lagging').locator('.view-board__card')).toHaveCount(4)
  await expect(colOf('leading').locator('.view-board__card')).toHaveCount(1)
  await shoot(win, 'board-03-columns')
})

test("step 3 — dragging a card to another column rewrites the member's own file on disk", async () => {
  const card = colOf('lagging').locator('.view-board__card', { hasText: 'CAC' })
  await card.dragTo(colOf('leading'))
  // Optimistic move shows immediately; the durable truth is the member's file.
  await expect(colOf('leading').locator('.view-board__card', { hasText: 'CAC' })).toBeVisible()
  await expect
    .poll(async () => (await readFile(path.join(vault, 'kpis', 'CAC.md'), 'utf8')).includes('kpi_category: leading'))
    .toBe(true)
  await expect(colOf('leading').locator('.view-board__card')).toHaveCount(2)
  await shoot(win, 'board-04-dragged')
})

test('step 4 — the inline add births a NAMED page into the column it was typed in, and stays on the board', async () => {
  await colOf('leading').locator('[aria-label="New card"]').click()
  const input = colOf('leading').locator('[aria-label="New card name"]')
  await input.fill('Churn Rate')
  await input.press('Enter')
  // The page exists on disk, named, parked in the settings folder, carrying the column's group.
  await expect
    .poll(async () => {
      const text = await readFile(path.join(vault, 'kpis', 'Churn Rate.md'), 'utf8').catch(() => null)
      return text !== null && text.includes('kpi_category: leading') && text.includes('[[KPIs]]')
    })
    .toBe(true)
  // …and the board shows it in that column once the index refetch lands, input still open for the next add.
  await expect(colOf('leading').locator('.view-board__card', { hasText: 'Churn Rate' })).toBeVisible()
  await expect(input).toBeVisible()
  // Still on the folder page — the inline add never navigated.
  await expect(contents().locator('.view-board')).toBeVisible()
  await shoot(win, 'board-05-inline-add')
})
