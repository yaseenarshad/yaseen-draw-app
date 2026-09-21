/**
 * The Topics tree (6B-, YAZ-848) end-to-end against the REAL app: the sidebar's Topics lens is
 * the folder-page tree — browsing the vault by MEANING rather than by the folders on disk.
 *
 * Driven over the committed encyclopedia (`fixtures/bible-vault`), which since 7C- is a MIGRATED
 * vault: `tools/migrateFolderPages.mjs` turned its five `page_type` values into five folder pages
 * and gave them a `Home` to hang from. The disk still has `funnel-stages/`, `kpis/`, `problems/`,
 * `roles/`, `industries/` and `inbox/`; this lens never mentions any of them — that is the point.
 * The two `inbox/` notes carry no `folder_pages` entry at all and wait under Uncategorized.
 *
 * ⚡ YAZ-920 AMENDS 🔒 D2, and it is the shape most of this file is now about: Home is a PINNED
 * LEAF, not the umbrella the whole encyclopedia used to hang from. It still LEADS — resolved and
 * flagged, wearing the house — but it counts nothing, unfolds nothing and never descends, while
 * every folder page whose parents-minus-Home are EMPTY is PROMOTED to a root beside it,
 * path-sorted. So the map opens flat, and every row that used to sit under Home sits one rung
 * shallower. A topic with a real, non-Home parent is untouched: it still nests under that parent.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the roots: the pinned leaf Home — house glyph, no count, no chevron — then the five
 *     promoted topics beside it, glyphed and counted, all at the SAME root indent
 *   2 the chevrons descend ONE rung, from the topics themselves — Funnel Stages' three members in
 *     the [D5] fallback — and "Expand all" opens every topic while never naming Home
 *   3 a row click OPENS the page (the file tree's own handler) AND unfolds a folder page in the
 *     same gesture (⚡ YAZ-870); clicking the topic you are ALREADY reading folds it (⚡ YAZ-917);
 *     the pinned leaf only ever opens
 *   4 the expansion is SESSION chrome (⚡ YAZ-1642): it never reaches the state file, never any
 *     note's frontmatter, and the next launch opens folded — every topic, Home's row included
 *   5 Uncategorized expands IN PLACE (🔒 D7, the locked deviation from the mockup), showing the
 *     two unfiled notes under their collapsible inbox disk folder and subtracting everything the
 *     tree DRAWS — the pinned leaf included
 *   5b a member row carries the file tree's own menu, and Delete trashes the page (YAZ-865)
 *   5c "New note" ON a folder-page row births a MEMBER of it (8H, YAZ-869) — the new page shows
 *     up under that topic in the tree AND in the topic's own contents, without one hand-tag
 *   5d an Uncategorized disk folder carries the applicable Files DIRECTORY menu (YAZ-1080)
 *
 * Then HOME'S BIRTH (6C-, YAZ-849). The migrated fixture HAS a Home, so both steps below run over
 * a copy with `Home.md` deleted — a vault full of folder pages that answers `[[Home]]` with
 * nothing, which is exactly the shape 6C exists for.
 *   6 the OFFER: un-adopted + no Home → the card, and one click makes Home — whereupon the five
 *     topics keep their places exactly (YAZ-920 promotes a Home-only member to a root) and Home
 *     takes the pinned leaf's row above them
 *   7 the AUTO-CREATE: an ADOPTED copy grows its own Home on open, once, never overwritten
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `topics-` step
 * screenshots), with the seed pre-selecting the Topics lens.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_COLUMNS } from '../../shared/folderPageDefaults'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const HOME = 'Home.md'
const FOLDER_PAGE = 'Funnel Stages.md'
/**
 * The five folder pages the migration made. Each says `folder_pages: ["[[Home]]"]` and nothing
 * else, so YAZ-920 PROMOTES all five to roots beside the pinned leaf — PATH-sorted, which for
 * five `.md` files at the vault root spells the same sequence Home's outline `order` used to.
 */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** Their direct-member counts, in the same order — the whole migrated map, on one line. */
const TOPIC_COUNTS = ['3', '2', '5', '4', '3']
/** Funnel Stages' members, alphabetically — the [D5] fallback, since it declares no outline `order`. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/** KPIs' five members, alphabetically — the topic 8H's step births a sixth one into. */
const KPI_MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
/** The sixth. Named so it sorts INTO the list rather than onto the end — placement is proven, not assumed. */
const NEW_KPI = 'Growth Rate'
/** KPIs' members once 8H's step has made one, in the [D5] alphabetical fallback KPIs declares no order against. */
const WITH_NEW_KPI = ['CAC', 'Gross Margin', NEW_KPI, 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
/** The only two pages in the migrated fixture that belong nowhere: `inbox/`, deliberately unfiled. */
const ORPHANS = ['Pipeline Review Notes', 'Positioning Draft']
/** 6C (YAZ-849): the dotfolder whose existence IS adoption. */
const VAULT_CONFIG_DIR = '.yaseendocs'
/**
 * 4B's birth, as a newborn Home carries it: the flag AND — since YAZ-1513 — the default `status`
 * Select every folder page is born with, spelled from the app's ONE `DEFAULT_COLUMNS`; no body.
 * Read back PARSED (`bornHome`), so the claim is the shape the one builder writes, not its YAML.
 */
const HOME_BIRTH = { folder_page: true, folder_page_settings: { columns: DEFAULT_COLUMNS } }
const bornHome = (text: string | null): { properties: Record<string, unknown>; body: string } | null =>
  text === null ? null : { properties: parseFrontmatter(splitFrontmatter(text).frontmatter).properties, body: splitFrontmatter(text).body }

let userData: string
let vault: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
let app: ElectronApplication
let win: Page

// ---------- locators ----------

const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
/** Every row the topic tree renders, in document order. */
const topicRows = (w: Page) => w.locator('.sidebar__body .tree__row')
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const rowFor = (w: Page, label: string) => topicRows(w).filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const chevron = (w: Page, action: 'Expand' | 'Collapse', label: string) => w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
/** The lens row's one fold-everything button (⚡ YAZ-873); its LABEL is the move it will make. */
const foldAll = (w: Page, label: 'Expand all' | 'Collapse all') => w.locator(`.sidebar__expand-all[aria-label="${label}"]`)
const uncategorizedRow = (w: Page) => w.locator('.sidebar__body .tree__row--muted')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
/** The right-clicked row's menu, and the inline name input the create group opens (8G-/8H). */
const menuItem = (w: Page, label: string) => w.locator('.ctx-menu [role="menuitem"]', { hasText: label })
const inlineInput = (w: Page) => w.locator('.sidebar__body .create-inline__input')
/** The folder page's contents block and its two skins — bible.spec.ts's own locators. */
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (w: Page) => contents(w).locator('.view-tab__btn[role="tab"]')
/** The outline is a DOCUMENT since YAZ-903: what it says is its bullet LINES, not row buttons. */
const outlineLines = (w: Page) => contents(w).locator('.view-outline .editor-instance .content-dom > p')
/** Every name as a LINK LINE — how a membership reads inside the document (⚡ YAZ-1152). */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)
/** The name cells — the page TITLE, never `.md` (YAZ-1513). */
const tableNames = (w: Page) => contents(w).locator('.view-row__link, .view-table__link')
/**
 * `KPIs.md`'s own body, migrated into its outline document the first time the page is opened
 * (⚡ YAZ-919) — heading marker stripped, the blank line dropped. It names no member, so every
 * member of KPIs is ADOPTED into the document under it as a link line (⚡ YAZ-1152).
 */
const KPIS_BODY = [
  'KPIs',
  'The numbers the funnel is judged on. Each one names the stages it belongs to, so the same',
  'metric can be owned jointly without anybody maintaining a second list.',
]

/** 6C's offer card and its one button. */
const offerCard = (w: Page) => w.locator('.sidebar__body .topics-offer')
const offerButton = (w: Page) => offerCard(w).locator('button')

/** What is on disk at `<vault>/<name>`, or null when it is not there at all. */
const onDisk = (vaultPath: string, name: string): Promise<string | null> => readFile(path.join(vaultPath, name), 'utf8').catch(() => null)

/** `seededState` pre-selects the FILES lens for the rest of the suite; this spec is about Topics. */
function topicsState(vaultPath: string, file: string | null) {
  const state = seededState(vaultPath, file)
  state.windows[0].sidebarLens = 'topics'
  return state
}

/** A copy of the encyclopedia with its Home deleted: folder pages everywhere, `[[Home]]` answering nothing. */
async function homelessVault(): Promise<string> {
  const dir = await copyVault(FIXTURE)
  vaults.push(dir)
  await rm(path.join(dir, HOME))
  return dir
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'topics-userdata-'))
  vault = await copyVault(FIXTURE)
  vaults.push(vault)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- 🔒 D2: the roots

test('step 1 — the migrated shape: Home a pinned LEAF, the five topics promoted to roots beside it', async () => {
  app = await launchApp({ userData, seedState: topicsState(vault, path.join(vault, HOME)) })
  win = await appWindow(app, 'w1')

  await expect(lensTab(win, 'Topics')).toHaveAttribute('aria-selected', 'true')
  // ⚡ YAZ-920 amends 🔒 D2. `[[Home]]` resolves and carries the flag, so it still LEADS — but the
  // five folder pages the migration created say `[[Home]]` and nothing else, and a parents-minus-
  // Home that comes out EMPTY is a promotion: all five stand as roots of their own, path-sorted,
  // beside Home rather than one indent under it. Collapsed by default: seven rows, no descent.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])

  const root = rowFor(win, 'Home')
  // THE HOUSE, not the folder-page glyph: `FolderPageGlyph` draws a `rect` and two `line`s, Home's
  // front door two `path`s. Reading the shapes is the only way to tell the two SVGs apart at all.
  await expect(root.locator('.tree__glyph')).toBeVisible()
  await expect(root.locator('.tree__glyph path')).toHaveCount(2)
  await expect(root.locator('.tree__glyph rect')).toHaveCount(0)
  // …and it counts NOTHING and unfolds NOTHING — its members are the roots standing below it, so
  // a count would double them and a chevron would open onto a second copy of the tree.
  await expect(root.locator('.tree__count')).toHaveCount(0)
  await expect(chevron(win, 'Expand', 'Home')).toHaveCount(0)
  await expect(root.locator('.tree__chevron--none')).toHaveCount(1)

  // The promoted topics are the ones that carry 🔒 D3's marks: the folder-page glyph (`rect`) and
  // the DIRECT-member count. The whole migrated map, on one line — Home's row contributes none.
  await expect(rowFor(win, 'Funnel Stages').locator('.tree__glyph rect')).toHaveCount(1)
  await expect(win.locator('.sidebar__body .tree__count')).toHaveText([...TOPIC_COUNTS, String(ORPHANS.length)])
  // 8 + depth * 14, the file tree's own indent: the leaf and all five promotions share depth 0.
  for (const label of ['Home', ...TOPICS]) await expect(rowFor(win, label)).toHaveCSS('padding-left', '8px')

  // The folders on disk are nowhere here — that shape belongs to the other tab.
  // (Folder-page rows wear `.tree__row--dir` themselves: same class family, same colour.)
  await expect(rowFor(win, 'funnel-stages')).toHaveCount(0)
  await expect(rowFor(win, 'inbox')).toHaveCount(0)
  await expect(win.locator('.sidebar__body .tree__row--file')).toHaveCount(0)
  // A vault that already answers `[[Home]]` is never offered one, adopted or not (the fixture has
  // no `.yaseendocs/`, so this is the offer's LIVE half deciding, not the adoption half).
  await expect(offerCard(win)).toHaveCount(0)
  await shoot(win, 'topics-01-roots')
})

// ---------------------------------------------------------------- ⚡ D6 + [D5]: the descent

test('step 2 — the chevrons descend ONE rung, from the topics themselves; “Expand all” never names Home', async () => {
  await chevron(win, 'Expand', 'Funnel Stages').click()
  // Funnel Stages declares no `order`, so its members fall through to alphabetical, one rung in.
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
  await expect(rowFor(win, 'Funnel Stages').locator('.tree__chevron--open')).toHaveCount(1)
  // 8 + depth * 14 — and YAZ-920 took a whole rung out of every one of these: the members of a
  // promoted topic sit at 22, where the topics themselves used to sit under the umbrella Home.
  await expect(rowFor(win, 'Home')).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Funnel Stages')).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Lead Gen')).toHaveCSS('padding-left', '22px')
  // Leaves: no glyph, no count, nothing to expand.
  await expect(rowFor(win, 'Lead Gen').locator('.tree__glyph')).toHaveCount(0)
  await expect(rowFor(win, 'Lead Gen').locator('.tree__count')).toHaveCount(0)
  await expect(chevron(win, 'Expand', 'Lead Gen')).toHaveCount(0)
  await shoot(win, 'topics-02-nested-members')

  // ⚡ YAZ-873's button, walking exactly the descent above (⚡ D6) — and YAZ-920's rule that the
  // pinned leaf is never in it: all five topics open, all seventeen members show, and Home is
  // still the chevron-less row it was. An "Expand all" that opened nothing would be a lie.
  // (The button's LABEL is the move it will make, so it reads "Collapse all" while anything is
  // open — folding first is how the expand-all half is reached at all.)
  await foldAll(win, 'Collapse all').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await foldAll(win, 'Expand all').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    ...MEMBERS,
    'Industries',
    'PLG SaaS',
    'VC-Backed B2B SaaS',
    'KPIs',
    ...KPI_MEMBERS,
    'Problems',
    'CRM Hygiene',
    'Lead Quality Scoring',
    'Nurture Sequencing',
    'Stage Accuracy',
    'Roles',
    'CEO',
    'Head of Sales',
    'RevOps Lead',
    'Uncategorized',
  ])
  await expect(chevron(win, 'Expand', 'Home')).toHaveCount(0)
  await expect(chevron(win, 'Collapse', 'Home')).toHaveCount(0)
  await shoot(win, 'topics-02b-expand-all')

  // …and back down to the shape the rest of the arc continues from: everything folded, then the
  // one topic step 3 and step 4 read again.
  await foldAll(win, 'Collapse all').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await chevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
})

// ---------------------------------------------------------------- 🔒 D3: the row gestures

test('step 3 — a row click OPENS the page and unfolds it; the topic you are reading folds; the leaf only opens', async () => {
  await rowFor(win, 'Lead Nurture').click()
  await expect(activeTab(win)).toHaveText('Lead Nurture')
  await expect(editorOf(win)).toContainText('Lead Nurture')

  // ⚡ YAZ-870: a folder-page row opens AND unfolds in one gesture…
  await rowFor(win, 'Industries').click()
  await expect(activeTab(win)).toHaveText('Industries')
  await expect(chevron(win, 'Collapse', 'Industries')).toHaveCount(1)
  // …and ⚡ YAZ-917 amends the add-only half of that ruling: YAZ-870 protected NAVIGATION from
  // folding the tree, but a click on the topic you are ALREADY reading is not navigation — it
  // folds like a second knock, and knocks again to unfold. The page never moves either way.
  await rowFor(win, 'Industries').click()
  await expect(chevron(win, 'Expand', 'Industries')).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Industries')
  await rowFor(win, 'Industries').click()
  await expect(chevron(win, 'Collapse', 'Industries')).toHaveCount(1)
  // The chevron is its own hit target, and it keeps the collapse whoever is on screen.
  await chevron(win, 'Collapse', 'Industries').click()
  await expect(chevron(win, 'Expand', 'Industries')).toHaveCount(1)
  await expect(activeTab(win)).toHaveText('Industries')

  // TOMBSTONE (YAZ-920): this step used to COLLAPSE HOME here and prove Funnel Stages came back
  // open underneath it — 🔒 D4's keyed-by-page claim, made on the umbrella. Home unfolds nothing
  // now, so what it proves instead is the pinned leaf's whole contract: the row OPENS the page,
  // and the tree does not grow by a single row. D4's durable half is step 4's.
  const before = await topicLabels(win).allTextContents()
  await rowFor(win, 'Home').click()
  await expect(activeTab(win)).toHaveText('Home')
  await expect(topicLabels(win)).toHaveText(before)
  await shoot(win, 'topics-03-row-opens')
})

// ---------------------------------------------------------------- 🔒 D4, amended by ⚡ YAZ-1642

test('step 4 — the expansion is session chrome: the state file never holds it, and the relaunch opens folded', async () => {
  // ⚡ YAZ-1642 turns 🔒 D4's durable half around. `topicsExpanded` — and the file tree's
  // `expanded` beside it — are SESSION lists now: held in memory, shared by every window on the
  // root, and STRIPPED before each write. Funnel Stages is still open on screen from step 2; what
  // this step proves is that nothing on disk knows it, so the next launch cannot restore it.
  const page = path.join(vault, FOLDER_PAGE)
  const folder = async () => (await readState(userData)).folders?.[vault]

  await quitApp(app)
  const flushed = await folder()
  expect(flushed).not.toHaveProperty('topicsExpanded')
  expect(flushed).not.toHaveProperty('expanded')
  expect(flushed).toHaveProperty('lastFile') // the rest of the bucket is untouched
  // Session chrome, exactly like the `baseGroups` bucket: nothing about it reaches the page.
  expect(await readFile(page, 'utf8')).not.toContain('topicsExpanded')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  // FOLDED — the seven rows of step 1, a whole session of chevron-clicking later.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await shoot(win, 'topics-04-collapsed-on-relaunch')

  // The arc continues from the shape step 2 left it in, so the one topic step 5 reads is knocked
  // open again — by hand, which since YAZ-1642 is the only way it ever opens.
  await chevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
})

// ---------------------------------------------------------------- 🔒 D7: Uncategorized

test('step 5 — Uncategorized expands IN PLACE, subtracting everything the tree DRAWS', async () => {
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText(String(ORPHANS.length))
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(0)
  await uncategorizedRow(win).click()
  await expect(uncategorizedRow(win).locator('.tree__chevron--open')).toHaveCount(1) // the chevron turns with it
  // The two unfiled notes, and nothing else, under the one disk folder they already share. Disk
  // location organizes this mini tree; belonging still comes only from a folder_pages entry.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    ...MEMBERS,
    ...TOPICS.slice(1),
    'Uncategorized',
    'inbox',
    ...ORPHANS,
  ])
  // 🔒 D7 as ⚡ YAZ-920 restates it: the section holds what the tree does NOT DRAW, computed from
  // the same guarded descent the rows come from. So the pinned leaf — drawn, though it descends
  // into nothing — is not listed, and neither is a promoted root or anyone nested under one.
  await expect(rowFor(win, 'Home')).toHaveCount(1) // the pinned leaf's row only
  await expect(rowFor(win, 'KPIs')).toHaveCount(1) // the promoted root's row only
  await expect(rowFor(win, 'Lead Gen')).toHaveCount(1) // the nested row only

  // YAZ-1080: this is a real disk-directory target using the ONE shared sidebar menu. Keep the
  // exact applicable action set pinned here; file-only link/window/toggle actions must not leak.
  await rowFor(win, 'inbox').click({ button: 'right' })
  // 🔒 D7 (YAZ-1674, amended) order: the Open group (empty on one row), clipboard (Cut / Copy /
  // a disabled Paste — a disk-folder row gets the disk verb), create, this row (Rename), then
  // "Open in ▸" as its OWN group, then Delete. Hints and the chevron are CSS, not text.
  await expect(win.locator('.ctx-menu [role="menuitem"]')).toHaveText([
    'Cut',
    'Copy',
    'Paste',
    'Copy path',
    'New note',
    'New folder page',
    'New folder',
    'New dated folder',
    'Rename',
    'Open in', // its own group after the this-row group (D7 amended)
    'Delete',
  ])
  await win.keyboard.press('Escape')
  await shoot(win, 'topics-05-uncategorized')

  // It never becomes a page: clicking an orphan opens the ORPHAN, and there is no Uncategorized tab.
  await rowFor(win, ORPHANS[0]).click()
  await expect(activeTab(win)).toHaveText(ORPHANS[0])
  await uncategorizedRow(win).click() // …and it collapses back in place
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', ...MEMBERS, ...TOPICS.slice(1), 'Uncategorized'])
})

// ------------------------------------------- ⚡ the amendment (YAZ-865): the row menu is the file tree's

test('step 5b — a member row carries the FILE tree’s own menu, and Delete trashes the page', async () => {
  // The amendment on YAZ-821 (ruled by Yasin): Topics rows get the SAME right-click menu file
  // rows get. The unit tests pin the whole item list and every target; what only the real app
  // can prove is the DELETE landing — the sheet, the row leaving the MEANING tree, and the file
  // actually leaving the vault (delete.spec.ts's own assertions, from the other lens).
  const doomed = path.join(vault, 'funnel-stages', 'Lead Nurture.md')
  await rowFor(win, 'Lead Nurture').click({ button: 'right' })
  const item = (label: string) => win.locator('.ctx-menu [role="menuitem"]', { hasText: label })
  await item('Open in').hover() // the OS verbs live in the "Open in ▸" flyout (D7 amended, YAZ-1674)
  await expect(item('Reveal in Finder')).toHaveCount(1)
  await expect(item('Copy path')).toHaveCount(1)
  await expect(item('Turn into folder page')).toHaveCount(1) // state-aware: a LEAF gets the forward label
  await shoot(win, 'topics-05b-row-menu')

  await item('Delete').click()
  await expect(win.locator('.confirm')).toContainText('Delete "Lead Nurture.md"?')
  await win.locator('.confirm__btn', { hasText: 'Delete' }).click()
  // Gone from the vault (where it went — the Trash — is not this spec's business, delete.spec.ts
  // says so) AND gone from the tree, which is the whole point: one delete, both readings.
  await expect.poll(() => readFile(doomed, 'utf8').then(() => false, () => true)).toBe(true)
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Lead Gen', 'Sales-Conversion', ...TOPICS.slice(1), 'Uncategorized'])
  await shoot(win, 'topics-05b-deleted')
  await quitApp(app)
})

// ------------------------------------------ ⚡ the amendment (YAZ-869): New note ON a topic

test('step 5c — “New note” on a FOLDER-PAGE row births a MEMBER of it, tree and table both', async () => {
  // 8H, Yasin's dogfooding ruling: the right-click that says "New note" on KPIs means "a KPI".
  // The unit tests pin the frontmatter and the parking; what only the real app can prove is the
  // round trip — the page is born, the INDEX picks the belonging up, and the same page then
  // appears in the meaning tree and in the topic's own contents with nobody tagging anything.
  // Its own copy of the vault: step 5b deleted a page out of the shared one and then quit.
  const own = await copyVault(FIXTURE)
  vaults.push(own)
  app = await launchApp({ userData, seedState: topicsState(own, path.join(own, HOME)) })
  win = await appWindow(app, 'w1')

  // No chevron to open first: YAZ-920 stands KPIs up as a root of its own, so it is on screen the
  // moment the tree renders.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await rowFor(win, 'KPIs').click({ button: 'right' })
  await menuItem(win, 'New note').click()
  await inlineInput(win).fill(NEW_KPI)
  await shoot(win, 'topics-05c-new-note-on-a-topic')
  await inlineInput(win).press('Enter')

  // PARKED where KPIs' members live (`folder_page_settings.folder: kpis`), never beside KPIs.md,
  // and born carrying KPIs' whole DECLARATION — every column empty, in the order it declares them,
  // with the belonging forced LAST. (The empty multi-link's exact YAML rendering is the writer's
  // business and is pinned in its own unit; what is LOCKED here is the shape and the order.)
  await expect
    .poll(() => onDisk(own, path.join('kpis', `${NEW_KPI}.md`)))
    .toMatch(/^---\nfunnel_stages:.*\nkpi_category:\nunit:\nfolder_pages:\n {2}- "\[\[KPIs\]\]"\n---\n$/)
  expect(await onDisk(own, `${NEW_KPI}.md`)).toBeNull() // never beside the folder page's own file
  // Created AND opened, the create group's standing behaviour.
  await expect(activeTab(win)).toHaveText(NEW_KPI)

  // THE TREE: the next index snapshot adopts it, with nobody tagging anything — a sixth member
  // under KPIs, in its alphabetical place among the five that were already there.
  await chevron(win, 'Expand', 'KPIs').click()
  await expect(rowFor(win, 'KPIs').locator('.tree__count')).toHaveText('6')
  await expect(topicLabels(win)).toHaveText([
    'Home',
    ...TOPICS.slice(0, 3),
    ...WITH_NEW_KPI,
    ...TOPICS.slice(3),
    'Uncategorized',
  ])

  // THE TABLE: the same page, from KPIs' own contents block — both skins.
  await rowFor(win, 'KPIs').click()
  await expect(activeTab(win)).toHaveText('KPIs')
  // ⚡ YAZ-919: the document is KPIs' own migrated body and names nobody — so ⚡ YAZ-1152 ADOPTS
  // every member into it, the newborn among them, in one alphabetical run under the prose. The
  // page was opened for the first time here, so this is that write landing, with nobody typing.
  await expect.poll(() => outlineLines(win).allTextContents()).toEqual([...KPIS_BODY, ...asLinks(...WITH_NEW_KPI)])
  await viewTabs(win).filter({ hasText: 'Table' }).click()
  await expect(tableNames(win)).toHaveCount(WITH_NEW_KPI.length)
  await expect(tableNames(win).filter({ hasText: new RegExp(`^${NEW_KPI}$`) })).toHaveCount(1)
  await shoot(win, 'topics-05c-member-everywhere')
  await quitApp(app)
})

// ------------------------------------------------- ⚡ the amendment (YAZ-797): the un-adopted offer

test('step 6 — an UN-ADOPTED folder is OFFERED a Home, never given one; one click makes it', async () => {
  const homeless = await homelessVault()
  expect(await onDisk(homeless, HOME)).toBeNull()
  expect(await onDisk(homeless, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()

  app = await launchApp({ userData, seedState: topicsState(homeless, null) })
  win = await appWindow(app, 'w1')
  await expect(offerCard(win)).toContainText('Your map starts here')
  await expect(offerButton(win)).toHaveText('Create Home')
  // It replaces nothing: with `[[Home]]` answering nothing, the five folder pages have no parents
  // of their own, so the roots rule stands every one of them up — path-sorted — underneath the card.
  await expect(topicLabels(win)).toHaveText([...TOPICS, 'Uncategorized'])
  for (const label of TOPICS) await expect(rowFor(win, label)).toHaveCSS('padding-left', '8px')
  await shoot(win, 'topics-06-offer')

  await offerButton(win).click()
  // Exactly 4B's birth at the vault root — the flag and the default column declaration, no body.
  await expect.poll(async () => bornHome(await onDisk(homeless, HOME))).toEqual({ properties: HOME_BIRTH, body: '' })
  // Created AND opened, in the current tab.
  await expect(activeTab(win)).toHaveText('Home')
  // The card retires the moment `[[Home]]` resolves. What YAZ-920 changes is what happens to the
  // five: their own `folder_pages: ["[[Home]]"]` now lands somewhere, but a parent that IS Home
  // subtracts to nothing, so they stay roots and stay exactly where they were — at the same
  // indent, in the same path order. Home simply takes the pinned leaf's row above them, counting
  // nothing and unfolding nothing. (Before YAZ-920 this list collapsed to two rows.)
  await expect(offerCard(win)).toHaveCount(0)
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  for (const label of ['Home', ...TOPICS]) await expect(rowFor(win, label)).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Home').locator('.tree__count')).toHaveCount(0)
  await expect(chevron(win, 'Expand', 'Home')).toHaveCount(0)
  await expect(rowFor(win, 'Home').locator('.tree__glyph path')).toHaveCount(2) // the house, born with it
  // Making a Home does NOT adopt the folder: the app still owns nothing invisible in here.
  expect(await onDisk(homeless, `${VAULT_CONFIG_DIR}/properties.json`)).toBeNull()
  await shoot(win, 'topics-06-home-made')
  await quitApp(app)
})

// ------------------------------------------------------- 🔒 D2: an ADOPTED vault creates its own

test('step 7 — an ADOPTED vault grows its own Home on open: once, unasked, never overwritten', async () => {
  // The same encyclopedia minus its Home, adopted: `.yaseendocs/` exists, so it has said yes already.
  const adopted = await homelessVault()
  await mkdir(path.join(adopted, VAULT_CONFIG_DIR), { recursive: true })
  expect(await onDisk(adopted, HOME)).toBeNull()

  app = await launchApp({ userData, seedState: topicsState(adopted, null) })
  win = await appWindow(app, 'w1')
  // Nobody clicked anything: Home is simply there, carrying exactly 4B's birth, leading the five
  // topics it is the (only) declared parent of — which YAZ-920 keeps standing beside it.
  await expect.poll(async () => bornHome(await onDisk(adopted, HOME))).toEqual({ properties: HOME_BIRTH, body: '' })
  const born = await onDisk(adopted, HOME)
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await expect(offerCard(win)).toHaveCount(0) // an adopted vault is never offered
  await shoot(win, 'topics-07-auto-created')
  await quitApp(app)

  // IDEMPOTENT: the user makes it their own, and reopening the vault never recreates or
  // overwrites it — the resolver finds a Home, so nothing is written.
  const mine = `${born}\n# My map\n\nmy own words\n`
  await writeFile(path.join(adopted, HOME), mine)
  app = await launchApp({ userData })
  win = await appWindow(app, 'w1')
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  expect(await onDisk(adopted, HOME)).toBe(mine)
  await quitApp(app)
})
