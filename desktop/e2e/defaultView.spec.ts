/**
 * The saved default view, end to end (YAZ-1109, over YAZ-1104's seam): a folder page may remember
 * which of its skins a fresh open STARTS on, as `folder_page_settings.defaultView` — one name, on
 * the page's own card, through the Properties menu's own door.
 *
 * The distinction the whole arc turns on: the START persists, while which view is ACTIVE stays
 * SESSION state (🔒 rule 4). So switching tabs still writes nothing at all, the saved name never
 * reaches the main-owned state file the way `baseGroups` does (4C), and a relaunch opens on the
 * saved skin with nobody having clicked a tab.
 *
 * ONE test by design: the proof is the arc, and every step needs the state the previous one left.
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`) on
 * `KPIs` — the folder page that ships Q7's outline-first pair plus five members, so "the first
 * view" and "the saved view" are genuinely different skins.
 *
 * Same harness as folderPageColumns.spec.ts (temp `--user-data-dir`, a COPY of the fixture,
 * `defaultview-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'KPIs.md'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
/** The one tab the pane calls active — `aria-selected`, which is all a reader has to go on. */
const activeViewTab = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"][aria-selected="true"]')
const propsMenu = (scope: Locator) => scope.locator('.view-popover')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

const folderPagePath = () => path.join(vault, FOLDER_PAGE)

/**
 * The folder page's `folder_page_settings` AS WRITTEN, read off disk. Parsed rather than
 * string-matched (folderPageColumns.spec.ts's idiom): the claim is that the name landed INSIDE the
 * one key, and a `toContain` would pass on the word sitting anywhere in the file.
 */
async function settingsOnDisk(): Promise<{ defaultView?: string }> {
  const { frontmatter } = splitFrontmatter(await readFile(folderPagePath(), 'utf8'))
  return (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { defaultView?: string }
}

/** Opens the Properties menu on the folder page's Table view; the outline is never offered one. */
async function openProperties(): Promise<Locator> {
  await contents(win).locator('[aria-label="Properties"]').click()
  await expect(propsMenu(contents(win))).toBeVisible()
  return propsMenu(contents(win))
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'defaultview-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('the saved START: picked in the Properties menu, kept on the card, honoured on the next open', async () => {
  test.setTimeout(60_000) // two launches and a real quit inside the one arc

  app = await launchApp({ userData, seedState: seededState(vault, folderPagePath()) })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  // Q7's first skin is where every open starts until the card says otherwise (the fixture's card
  // DECLARES the Board itself — the YAZ-935 read-time injection was retired by YAZ-1471 D3).
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table', 'Board'])
  await expect(activeViewTab(contents(win))).toHaveText('Outline')

  // Switching is SESSION state (🔒 rule 4) and stays that way: the tab moves, the card does not.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(contents(win).locator('.view-table')).toBeVisible()
  expect(await readFile(folderPagePath(), 'utf8')).not.toContain('defaultView')

  // The START goes through its OWN door instead — the Properties menu's Page section, one
  // `folder_page_settings` write (🔒 D3), never a views write.
  const menu = await openProperties()
  const select = menu.locator('[aria-label="Default view"]')
  await expect(select).toHaveValue('') // "First view" — the card names none yet
  await select.selectOption('Table')
  await expect.poll(async () => (await settingsOnDisk()).defaultView, { timeout: 10_000 }).toBe('Table')
  await win.keyboard.press('Escape')
  await shoot(win, 'defaultview-01-picked')

  await quitApp(app) // the REAL quit path: pending autosaves and the state write are flushed
  // On the PAGE, and only there: unlike a collapsed group (4C), the START is not session state,
  // so the main-owned store never hears the name at all.
  expect(JSON.stringify(await readState(userData))).not.toContain('defaultView')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'KPIs').click()
  await expect(contents(win)).toBeVisible()
  // The whole point, and nobody has clicked a tab: the page OPENS on the saved skin.
  await expect(activeViewTab(contents(win))).toHaveText('Table')
  await expect(contents(win).locator('.view-table')).toBeVisible()
  await shoot(win, 'defaultview-02-opens-on-saved-view')

  await quitApp(app)
})
