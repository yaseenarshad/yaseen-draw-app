/**
 * ONE RULE, THREE DOORWAYS (YAZ-987): a page created under a folder page shows up in the Topics
 * tree IMMEDIATELY — no tag removed and re-added, no lens switched, no window reloaded.
 *
 * The bug this closes over (YAZ-985, fixed in YAZ-986) lived in main: the watcher's live `scanFile`
 * was fire-and-forget, and `getIndex` snapshotted the records map knowing nothing about the scans
 * it had already started. A newborn could miss the renderer's ONE edge-triggered refetch —
 * `useIndex`'s 300ms debounce, fired by the very `add` event that started the scan — and then stay
 * invisible under its topic until some later fs event happened along, which is what the
 * remove-the-tag-and-put-it-back workaround was really doing. `getIndex` drains its in-flight scans
 * now; what only the REAL app can prove is the round trip — create, and the row is simply there.
 *
 * So nothing below touches the newborn's tags or properties, and nothing below touches the tree
 * after the create: each topic is expanded BEFORE its page is born, and the row that appears under
 * it appears on the app's own refetch. A Playwright poll re-reads the DOM — it never pokes the
 * index — so a tree that is never told about the page fails here rather than waiting it out.
 *
 * The three doorways are the three creates that stamp `folder_pages`, and they are one rule:
 * `Sidebar.createInTopic` and `FolderPageContents.createMember` both travel the folder page's own
 * `newPageFromFolderPage` and park through the same `memberFolder`.
 *   1 the Topics row's own right-click "New note" (8H, ⚡ YAZ-869)
 *   2 the folder page toolbar's "New" (🔒 Q5/Q6, YAZ-815)
 *   3 the board column's inline add (YAZ-943), which never leaves the board at all
 *
 * Each takes its OWN copy of the encyclopedia, its own launch and its own topic: the doorways share
 * a rule, not a state, so any one of these runs alone. Same harness as its siblings (temp
 * `--user-data-dir`, a COPY of the fixture, `create-under-` step screenshots), with the seed
 * pre-selecting the Topics lens.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, outlineLinkLines, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per test; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
/** The five folder pages the migration made, path-sorted — YAZ-920 stands every one of them at the root. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']

/** Doorway 1's topic and its members, in the path order `pagesIn` hands them over. */
const ROLES = ['CEO', 'Head of Sales', 'RevOps Lead']
/** Named so it sorts INTO the list rather than onto the end — placement is proven, not assumed. */
const NEW_ROLE = 'Demand Gen Lead'
const WITH_NEW_ROLE = ['CEO', NEW_ROLE, 'Head of Sales', 'RevOps Lead']

/** Doorway 2's topic. It declares no columns at all, so the newborn carries the belonging and nothing else. */
const INDUSTRIES = ['PLG SaaS', 'VC-Backed B2B SaaS']
/** The toolbar's "New" names nothing, so the page is born under the `Untitled` scheme. */
const NEW_INDUSTRY = 'Untitled'
/**
 * Where the newborn lands in the TREE, for the two doorways whose folder page is OPEN when it is
 * born (2 and 3): at the END. The tree reads its arrangement off the outline document (YAZ-905),
 * an open page's document names every existing member (⚡ YAZ-1152 adopted them), and both rules
 * that could place the newcomer put it last — [D5] sorts the unnamed behind the named, and the
 * adoption that follows APPENDS. Doorway 1 opens no folder page at all, so its topic has no
 * document and the alphabetical fallback still sorts the newborn INTO the list (`WITH_NEW_ROLE`).
 */
const WITH_NEW_INDUSTRY = [...INDUSTRIES, NEW_INDUSTRY]

/** Doorway 3's topic — the one with a `kpi_category` to group a board by (board.spec.ts's own column). */
const KPIS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
const NEW_KPI = 'Pipeline Velocity'
const WITH_NEW_KPI = [...KPIS, NEW_KPI]

let userData: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
let app: ElectronApplication
let win: Page

// ---------- locators ----------

/** Every row the topic tree renders, in document order (the create input carries no label of its own). */
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const rowFor = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const chevron = (w: Page, action: 'Expand' | 'Collapse', label: string) => w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
/** The right-clicked row's menu, and the inline name input the create group opens (8G-/8H). */
const menuItem = (w: Page, label: string) => w.locator('.ctx-menu [role="menuitem"]', { hasText: label })
const inlineInput = (w: Page) => w.locator('.sidebar__body .create-inline__input')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTab = (w: Page, label: string) => contents(w).locator('.view-tab__btn', { hasText: label })
/** Every name as a LINK LINE — how a membership reads inside the outline document (⚡ YAZ-1152). */
const asLinks = (...names: readonly string[]) => names.map((n) => `[[${n}]]`)
const colOf = (w: Page, label: string): Locator =>
  contents(w).locator('.view-board__col').filter({ has: w.locator(`.view-group__value:text-is("${label}")`) })

/** What is on disk at `<vault>/<name>`, or null when it is not there at all. */
const onDisk = (vaultPath: string, name: string): Promise<string | null> => readFile(path.join(vaultPath, name), 'utf8').catch(() => null)

/** The belonging as the writer spells it: the `folder_pages:` block naming the folder page it was born under. */
const belongsTo = (topic: string) => new RegExp(`folder_pages:\\n {2}- "\\[\\[${topic}\\]\\]"\\n`)

// ---------- lifecycle ----------

/** A copy of the encyclopedia for one test's exclusive use; torn down with the rest. */
async function ownVault(): Promise<string> {
  const dir = await copyVault(FIXTURE)
  vaults.push(dir)
  return dir
}

/** The window on `vaultPath`, `file` open (or nothing), with the Topics lens showing. */
async function openTopics(vaultPath: string, file: string | null): Promise<void> {
  const state = seededState(vaultPath, file === null ? null : path.join(vaultPath, file))
  state.windows[0].sidebarLens = 'topics'
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
}

/**
 * The folder page SETTLED on screen: every member named by a link line of its document, and the
 * YAZ-919 body migration already written back to its own file. Both halves matter — the migration
 * is a WRITE, and so (since ⚡ YAZ-1152) is the ADOPTION that writes those link lines; a create
 * fired while either is still in flight would be riding somebody else's fs event. Waiting on the
 * lines is waiting on the last of the two, which is the whole job of this helper.
 */
async function settledFolderPage(vaultPath: string, file: string, members: readonly string[]): Promise<void> {
  await expect.poll(() => outlineLinkLines(contents(win))).toEqual(asLinks(...members))
  await expect.poll(() => onDisk(vaultPath, file).then((text) => text?.trimEnd().endsWith('---'))).toBe(true)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'createunder-userdata-'))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- doorway 1: the row's own menu

test('step 1 — the Topics row’s “New note”: the member stands under its topic the moment it is born', async () => {
  const vault = await ownVault()
  // Nothing open: the only fs traffic in this test is the create itself, so the refetch that
  // carries the newborn into the tree can only be the one the create's own `add` event fired.
  await openTopics(vault, null)

  // Expanded BEFORE the create — what appears afterwards is the app's answer, not a gesture of this
  // test's. Roles' three members, and no sign of the fourth.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await chevron(win, 'Expand', 'Roles').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, ...ROLES, 'Uncategorized'])
  await shoot(win, 'create-under-01-topic-open')

  await rowFor(win, 'Roles').click({ button: 'right' })
  await menuItem(win, 'New note').click()
  await inlineInput(win).fill(NEW_ROLE)
  await inlineInput(win).press('Enter')

  // THE FILE: parked where Roles' members live, carrying the belonging — nobody typed it.
  await expect.poll(() => onDisk(vault, path.join('roles', `${NEW_ROLE}.md`))).toMatch(belongsTo('Roles'))
  // THE TREE, untouched since the expand: the row is simply there, in its place among the three
  // that were already open, at the members' own 8 + depth * 14 indent, and the count says four.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, ...WITH_NEW_ROLE, 'Uncategorized'])
  await expect(rowFor(win, NEW_ROLE)).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('4')
  await expect(activeTab(win)).toHaveText(NEW_ROLE) // created AND opened, the create group's standing behaviour
  await shoot(win, 'create-under-02-topics-menu')
  await quitApp(app)
})

// ------------------------------------------------------------ doorway 2: the contents block's New

test('step 2 — the folder page’s own “New”: the member appears in the tree beside the page that made it', async () => {
  const vault = await ownVault()
  await openTopics(vault, 'Industries.md')
  await chevron(win, 'Expand', 'Industries').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS.slice(0, 2), ...INDUSTRIES, ...TOPICS.slice(2), 'Uncategorized'])
  await settledFolderPage(vault, 'Industries.md', INDUSTRIES)
  await shoot(win, 'create-under-03-folder-page-open')

  await contents(win).locator('[aria-label="New note"]').click()

  // Born from the declaration — Industries declares no columns, so the belonging is the whole card.
  await expect.poll(() => onDisk(vault, path.join('industries', `${NEW_INDUSTRY}.md`))).toMatch(belongsTo('Industries'))
  // …and the sidebar hears about it without being asked: the tree was expanded before the click and
  // has not been touched since, and the newborn takes its place at the end of the two members —
  // where this page's own document puts it (see `WITH_NEW_INDUSTRY`).
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS.slice(0, 2), ...WITH_NEW_INDUSTRY, ...TOPICS.slice(2), 'Uncategorized'])
  await expect(rowFor(win, NEW_INDUSTRY)).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'Industries').locator('.tree__count')).toHaveText('3')
  await expect(activeTab(win)).toHaveText(NEW_INDUSTRY)
  await shoot(win, 'create-under-04-toolbar-new')
  await quitApp(app)
})

// ------------------------------------------------------------- doorway 3: the board's inline add

test('step 3 — the board column’s inline add: the tree updates while the user never leaves the board', async () => {
  const vault = await ownVault()
  await openTopics(vault, 'KPIs.md')
  await chevron(win, 'Expand', 'KPIs').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS.slice(0, 3), ...KPIS, ...TOPICS.slice(3), 'Uncategorized'])
  await settledFolderPage(vault, 'KPIs.md', KPIS)

  // board.spec.ts's own arrangement: the Board view the card DECLARES (the YAZ-935 read-time
  // injection was retired by YAZ-1471 D3), turned into columns through the Sort menu. `leading`
  // holds one card, so the add below is visibly the second.
  await viewTab(win, 'Board').click()
  await contents(win).locator('[aria-label="Sort"]').click()
  await contents(win).locator('[aria-label="Group by"]').click()
  await contents(win).locator('[role="option"][data-value="note.kpi_category"]').click()
  await win.keyboard.press('Escape')
  await expect(colOf(win, 'leading').locator('.view-board__card')).toHaveCount(1)

  await colOf(win, 'leading').locator('[aria-label="New card"]').click()
  const input = colOf(win, 'leading').locator('[aria-label="New card name"]')
  await input.fill(NEW_KPI)
  await input.press('Enter')

  // The named card is a page like any other: KPIs' whole declaration, the column's own group, and
  // the belonging LAST.
  await expect.poll(() => onDisk(vault, path.join('kpis', `${NEW_KPI}.md`))).toMatch(belongsTo('KPIs'))
  expect(await onDisk(vault, path.join('kpis', `${NEW_KPI}.md`))).toContain('kpi_category: leading')
  // THE TREE — the whole point of this doorway: the inline add stays on the board and opens nothing,
  // so nothing but the index refetch can have put this row under KPIs.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS.slice(0, 3), ...WITH_NEW_KPI, ...TOPICS.slice(3), 'Uncategorized'])
  await expect(rowFor(win, NEW_KPI)).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'KPIs').locator('.tree__count')).toHaveText('6')
  await expect(activeTab(win)).toHaveText('KPIs') // never navigated
  await expect(colOf(win, 'leading').locator('.view-board__card', { hasText: NEW_KPI })).toBeVisible()
  await shoot(win, 'create-under-05-board-inline-add')
  await quitApp(app)
})
