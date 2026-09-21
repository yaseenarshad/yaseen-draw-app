/**
 * The SEAMS (8C-, YAZ-859): the folder-page wave's promises proved WORKING TOGETHER.
 *
 * Every sibling spec owns one surface — `folderPages.spec.ts` the contents block's gestures,
 * `topics.spec.ts` the sidebar tree and Home's birth, `lenses.spec.ts` the tabs above it,
 * `bible.spec.ts` the encyclopedia's content. What none of them owns is the JOIN: that ONE
 * gesture on one surface lands on disk AND on every other surface reading the same frontmatter,
 * that the two tree-walkers agree inside a loop, that an order dragged in the main pane is the
 * order the sidebar shows after a restart, and that a page_type vault run through the migration
 * opens as a folder-page vault in the real app. Nothing below re-proves a single-surface claim;
 * every step is an every-surface-agrees proof.
 *
 * The arc, in order (serial by design — each step continues the previous state, and the sidebar
 * sits on the TOPICS lens throughout so the tree and the contents block are on screen together):
 *   1 THE FULL CIRCLE — tag a page by typing its link into the outline, then read the SAME fact off four
 *     places at once: the member's own file on disk, the Topics tree's nesting, the Table tab's
 *     rows, the outline's bullets (and Uncategorized shrinking by one, the fifth)
 *   2 THE LAST REMOVAL — deleting the line of a member whose ONLY parent this is: the sheet says
 *     Uncategorized, and Uncategorized is exactly where the sidebar then puts it, while the table
 *     drops the row (⚡ YAZ-1152 retired the hover × with the rows it lived on)
 *   3 ORDER SURVIVES RESTART — rearranging the outline is ONE `folder_page_settings` write (not
 *     one member card is touched), and after quit → relaunch the document reads back as it was —
 *     and the Topics tree reads the SAME arrangement off the document's link lines (YAZ-905
 *     closed the seam YAZ-904 found: `outlineOrderOf` answers from an edited outline's document)
 *   4 LOOPS ARE SAFE EVERYWHERE — an `A ↔ B` loop hand-written on disk: the tree's walker descends
 *     into it and terminates, a page reachable down two branches repeats under both, and the
 *     outline — a flat document since YAZ-903, which since ⚡ YAZ-1152 ADOPTS both members of the
 *     loop as plain link lines — has no descent left to hang
 *   5 TURN-INTO END TO END — the file tree's context menu makes a folder page, the block appears
 *     under its body, it nests in the tree, it takes a member; turning it BACK drops the member
 *     into Uncategorized and takes the block away, with not one member card rewritten
 *   6 MIGRATION SMOKE — a tiny page_type-era vault, git-committed, run through the REAL
 *     `tools/migrateFolderPages.mjs --apply`, then OPENED IN THE APP: Topics roots on Home, a
 *     folder page browses, a merged `channels:` link shows up as a second parent, zero `page_type`
 *
 * Same harness as the siblings (temp `--user-data-dir`, COPIES of the fixture — the committed
 * encyclopedia is never opened — `cross-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  bulletAfterLine,
  caretAtEndOfLine,
  clearOutlineLine,
  copyVault,
  expandDirs,
  launchApp,
  md5,
  outlineLineIndex,
  outlineLines,
  outlineSaid,
  pickOutlineLink,
  quitApp,
  REPO_ROOT,
  seededState,
  shoot,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
/** The disk folders step 5 opens by hand before it right-clicks a row inside `kpis/`. */
const FOLDERS = ['funnel-stages', 'inbox', 'industries', 'kpis', 'problems', 'roles']

const FOLDER_PAGE = 'Funnel Stages.md'
/** Its members at the start, alphabetically — the order ADOPTION writes them into the document in. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/**
 * ⚡ YAZ-919: `Funnel Stages.md` ships a BODY, and a folder page is title → outline now — so on
 * its first open that body MOVES into the outline document (heading marker stripped, blanks
 * dropped) and is on screen from the first paint. ⚡ YAZ-1152: the members that prose does not NAME
 * are then written into the same document, as depth-0 link lines under it. So the document under
 * every gesture below is the page's own prose followed by its whole membership, in text.
 */
const BODY = [
  'Funnel Stages',
  'The stages a deal walks through, from first touch to closed-won. Every page that says it',
  'belongs here shows up below — there is no list to maintain.',
]
/** Home's members, in the `order` the migration wrote onto its outline view. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']

/** The page step 1 tags in: an `inbox/` orphan, so the gesture also empties a slot in Uncategorized. */
const ORPHAN_IN = 'inbox/Pipeline Review Notes.md'
/** The member step 2 un-tags: `[[Funnel Stages]]` is its ONLY folder page, so it lands in Uncategorized. */
const ONLY_CHILD = 'funnel-stages/Lead Nurture.md'
/** The other orphan — step 5's member, and Uncategorized's constant. */
const ORPHAN_OUT = 'inbox/Positioning Draft.md'
/** The plain page step 5 turns into a folder page and back; the migration left it in `[[KPIs]]`. */
const CAC = 'kpis/CAC.md'

/** THE migration, run as a child process exactly as a human types it (`tools/` own suite's idiom). */
const MIGRATE = path.join(REPO_ROOT, 'tools', 'migrateFolderPages.mjs')

let userData: string
let vault: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
let app: ElectronApplication
let win: Page

// ---------- locators: the sidebar's Topics tree ----------

const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
/** Every row the topic tree renders, in document order. */
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const topicRow = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const treeChevron = (w: Page, action: 'Expand' | 'Collapse', label: string) =>
  w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
const uncategorizedRow = (w: Page) => w.locator('.sidebar__body .tree__row--muted')
/** The FILE tree's rows — the other lens, where the folder-page context menu lives. */
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

// ---------- locators: the folder page's contents block ----------

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
/** Every name as a LINK LINE, which is how a membership is spelled inside the document. */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
/** The blocks inside the open note's scroller, in order — 🔒 D1's placement, read straight off the DOM. */
const scrollerBlocks = (w: Page) =>
  layer(w)
    .locator('.editor-host')
    .evaluate((host) => Array.from(host.children).map((c) => c.className))

// ---------- helpers ----------

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')

/**
 * `seededState` pre-selects the FILES lens for the rest of the suite; this spec needs BOTH
 * surfaces at once, so it seeds Topics. The descent is no longer seeded (YAZ-1642: neither tree's
 * open list survives a launch), so chevrons and dirs are opened where a step needs them.
 */
function crossState(vaultPath: string, file: string | null) {
  const state = seededState(vaultPath, file)
  state.windows[0].sidebarLens = 'topics'
  return state
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await walk(p)))
    else out.push(p)
  }
  return out.sort()
}

/** Any note still carrying the retired type key — the migration's own post-check, re-asked from outside. */
async function withPageType(root: string): Promise<string[]> {
  const out: string[] = []
  for (const f of (await walk(root)).filter((x) => x.endsWith('.md'))) {
    if (/^page_type:/m.test(await readFile(f, 'utf8'))) out.push(path.relative(root, f))
  }
  return out
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'crosscutting-userdata-'))
  vault = await copyVault(FIXTURE)
  vaults.push(vault)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ================================================================ 1. the full circle

test('step 1 — one gesture, four surfaces: a link line writes the member’s card, and the tree, the table and the outline all say so', async () => {
  app = await launchApp({
    userData,
    seedState: crossState(vault, path.join(vault, FOLDER_PAGE)),
  })
  win = await appWindow(app, 'w1')

  // The starting shape, on BOTH surfaces at once: the sidebar's tree descended two rungs, and the
  // same three members standing in the block below the note's own body. The descent is a CLICK
  // since YAZ-1642 — the launch shows every topic folded — and Home never had a chevron to knock.
  await expect(lensTab(win, 'Topics')).toHaveAttribute('aria-selected', 'true')
  await treeChevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Lead Gen',
    'Lead Nurture',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2') // the two `inbox/` notes
  await expect(contents(win)).toBeVisible()
  // ⚡ YAZ-919 gave this page its own body as the document; ⚡ YAZ-1152 then wrote the three members
  // it does not NAME straight into it. So the same three pages the tree just listed are link lines
  // under the prose — one surface further down, and now literally the same kind of thing.
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...BODY, ...asLinks(...MEMBERS)])
  await shoot(win, 'cross-01-both-surfaces')

  // THE GESTURE — one link line typed into the outline's DOCUMENT (YAZ-903, replacing the add row
  // this step used to drive), on an `inbox/` orphan, under the page's own prose where a user would
  // type it. The full name is typed on purpose: a name that answers in the vault is a PICK and
  // never the picker's create row.
  await bulletAfterLine(win, contents(win), BODY.length - 1)
  await pickOutlineLink(win, 'Pipeline Review Notes')

  // (a) DISK — the write lands on the PICKED page's own card, surgically: the entry is new and the
  //     key it already carried is untouched. Belonging is text a page writes about ITSELF.
  await expect.poll(() => read(ORPHAN_IN), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  expect(await read(ORPHAN_IN)).toContain('captured: 2026-08-14')
  expect(await read(ORPHAN_IN)).toContain('# Pipeline Review Notes')
  // …and the FOLDER PAGE still maintains no MEMBER LIST. Its own card names the page exactly once,
  // as a LINE of the outline document the gesture typed — and a line is text. What GRANTS the
  // membership is the entry that landed on the member's card above; nothing on this side does.
  const card = await read(FOLDER_PAGE)
  expect(card.match(/Pipeline Review Notes/g)).toHaveLength(1)
  expect(card).toMatch(/\* \[\[Pipeline Review Notes\]\]/)
  expect(card).toContain('folder_pages:\n  - "[[Home]]"') // its own belonging, untouched

  // (b) THE OUTLINE — one more bullet, where the caret put it: the document is the order now, so
  //     the new link line stands under the prose, ABOVE the three adoption wrote in. Nothing is
  //     re-sorted by a typed line, and nothing adoption wrote is disturbed by one.
  await expect(outlineLines(contents(win))).toHaveText([...BODY, '[[Pipeline Review Notes]]', ...asLinks(...MEMBERS)])

  // (c) THE TOPICS TREE — nested under the same folder page, one rung in, with the count moved and
  //     Uncategorized one shorter. The sidebar read the same frontmatter through the same lookup —
  //     and the same [D5] rule, which since ⚡ YAZ-1152 has nothing left to fall back to: the
  //     document names every member now, so the tree is simply the document's own order, and the
  //     typed line leads because that is where it was typed. One arrangement, two skins (YAZ-905).
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes', // first in the document, so first here
    'Lead Gen',
    'Lead Nurture',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(topicRow(win, 'Funnel Stages').locator('.tree__count')).toHaveText('4')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1')
  // 8 + depth * 14. YAZ-920 promoted `Funnel Stages` to a ROOT beside the pinned leaf Home, so its
  // members are depth 1 and sit at 22 — one whole rung shallower than the umbrella-Home tree drew
  // them. The claim is unchanged: the page moved INTO the topic, and the indent is how that reads.
  await expect(topicRow(win, 'Funnel Stages')).toHaveCSS('padding-left', '8px')
  await expect(topicRow(win, 'Pipeline Review Notes')).toHaveCSS('padding-left', '22px')
  await shoot(win, 'cross-02-tagged-everywhere')

  // (d) THE TABLE — the same four pages, in `pagesIn`'s PATH order rather than the outline's [D5]
  //     order: two skins of one set, ordered by two different rules, and neither is wrong.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(4)
  await expect(rowNames(contents(win))).toHaveText(['Lead Gen', 'Lead Nurture', 'Sales-Conversion', 'Pipeline Review Notes'])
  await shoot(win, 'cross-03-table-agrees')
})

// ================================================================ 2. the last removal

test('step 2 — dropping a page’s ONLY parent: the sheet promises Uncategorized and the sidebar delivers it', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()

  // `Lead Nurture` belongs to `[[Funnel Stages]]` and nowhere else, so this is the copy's OTHER
  // form — the one that names Uncategorized instead of listing the folder pages left.
  //
  // THE GESTURE, re-aimed three times and now settled. YAZ-903 made it "delete the LINE"; YAZ-919
  // gave this page a document of its own prose that named nobody, which put the hover × back in
  // play; ⚡ YAZ-1152 deleted the × and the row it lived on, because adoption writes every member
  // into the document — so there is ONE gesture again, and this is it. Same sheet, either way.
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), '[[Lead Nurture]]'))
  await expect(sheet(win)).toContainText(
    "Remove 'Lead Nurture' from 'Funnel Stages'? The page is not deleted — its file stays put. It has no other folder pages, so it moves to Uncategorized.",
  )
  await shoot(win, 'cross-04-last-removal-sheet')
  await sheetBtn(win, 'Remove').click()

  // DISK: the entry goes, the file does not — body and every other key still there.
  await expect.poll(() => read(ONLY_CHILD), { timeout: 10_000 }).not.toContain('[[Funnel Stages]]')
  expect(await read(ONLY_CHILD)).toContain('# Lead Nurture')
  expect(await read(ONLY_CHILD)).toContain('order: 2')

  // THE BLOCK: gone, and STAYING gone — the line was deleted by the gesture, and the page it named
  // is not a member any more, so adoption never writes it back. The three that are left are the
  // three that belong.
  await expect
    .poll(() => outlineSaid(contents(win)))
    .toEqual([...BODY, '[[Pipeline Review Notes]]', '[[Lead Gen]]', '[[Sales-Conversion]]'])
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(['Lead Gen', 'Sales-Conversion', 'Pipeline Review Notes'])
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()

  // THE SIDEBAR: the sheet said Uncategorized, and this is Uncategorized — two orphans again, this
  // time a `funnel-stages/` page beside an `inbox/` one. Since YAZ-956 the section opens as a MINI
  // FILE TREE, so each orphan stands under the disk folder it actually lives in, path-sorted.
  // Nothing was lost anywhere.
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2')
  await uncategorizedRow(win).click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes', // the tree reads the document's own order (YAZ-905)
    'Lead Gen',
    'Sales-Conversion',
    ...TOPICS.slice(1),
    'Uncategorized',
    'funnel-stages',
    'Lead Nurture',
    'inbox',
    'Positioning Draft',
  ])
  await shoot(win, 'cross-05-uncategorized-caught-it')
  await uncategorizedRow(win).click() // back in place — the label lists below stay readable
})

// ================================================================ 3. order survives restart

test('step 3 — the outline IS the order now: rearranging it writes nobody’s card, and survives a relaunch', async () => {
  test.setTimeout(60_000)

  // TOMBSTONE (YAZ-904): this step used to DRAG a depth-0 row, which wrote the [D5] `order` list.
  // Rows are gone; rearranging is editing the document. The claim survives whole — a rearrangement
  // is presentation, it lives on the FOLDER PAGE, and not one member card may be touched by it.
  const leadGen = path.join(vault, 'funnel-stages', 'Lead Gen.md')
  const before = await md5(leadGen)

  // `Lead Gen` to the BOTTOM — and since ⚡ YAZ-1152 the document names every member, so the move
  // is made IN THE TEXT, in the two moves a document allows: write the line where it should go,
  // then take away the one that was. The link SET never changes across either edit, which is why
  // neither of them raises the un-tag sheet — and why the second edit cannot be read as a removal.
  await bulletAfterLine(win, contents(win), (await outlineLines(contents(win)).count()) - 1)
  await pickOutlineLink(win, 'Lead Gen')
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), '[[Lead Gen]]'))
  await expect
    .poll(() => outlineSaid(contents(win)))
    .toEqual([...BODY, '[[Pipeline Review Notes]]', '[[Sales-Conversion]]', '[[Lead Gen]]'])
  await expect(sheet(win)).toHaveCount(0)

  // DISK: the new sequence is on the FOLDER PAGE's own card, inside `folder_page_settings` — the
  // one place 2A keeps it, alongside the migrated prose it was typed under — and the member is
  // byte-for-byte what it was.
  await expect
    .poll(() => read(FOLDER_PAGE), { timeout: 10_000 })
    .toMatch(/\[\[Sales-Conversion\]\][\s\S]*\[\[Lead Gen\]\]/)
  expect(await read(FOLDER_PAGE)).toContain('The stages a deal walks through') // …and so is the body that moved in
  expect(await md5(leadGen)).toBe(before)

  // THE SIDEBAR, live — the seam YAZ-904 found, CLOSED (YAZ-905): `outlineOrderOf` reads an
  // edited outline's DOCUMENT, so the tree rearranges exactly as the outline did. One set, one
  // arrangement, two skins — and `Lead Gen`, moved to the bottom of the text, sits last on both.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes',
    'Sales-Conversion',
    'Lead Gen',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await shoot(win, 'cross-06-rearranged-order')

  // AND ACROSS A RESTART: the document is frontmatter, so it is the PAGE's and it comes back; the
  // expansion is a session list since YAZ-1642, so it does not — the restored tree is folded, and
  // the arrangement is re-read the moment the same chevron is knocked again.
  await quitApp(app)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')

  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized']) // collapsed on relaunch
  await treeChevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes',
    'Sales-Conversion',
    'Lead Gen',
    ...TOPICS.slice(1),
    'Uncategorized',
  ])
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on the first skin — and it
  // reads the arrangement back out of the document, exactly as it was left. The migrated prose is
  // still standing above it, a relaunch later: it lives on the page, not in the session.
  await expect
    .poll(() => outlineSaid(contents(win)))
    .toEqual([...BODY, '[[Pipeline Review Notes]]', '[[Sales-Conversion]]', '[[Lead Gen]]'])
  await shoot(win, 'cross-07-order-restored')
})

// ================================================================ 4. loops are safe everywhere

test('step 4 — a hand-written A ↔ B loop: the tree descends into it, terminates, repeats a two-parent page under both — and the outline has nothing left to hang', async () => {
  test.setTimeout(60_000)

  // Written straight onto disk — the honest path for "somebody typed this in another editor". The
  // watcher adopts them with no user action: A belongs to KPIs AND to B, B belongs to A, and the
  // leaf belongs to both, so it is reachable down two branches.
  //
  // ⚡ YAZ-920 moved the loop's anchor: `Loop A` used to hang off `[[Home]]`, which was then the
  // umbrella the whole tree descended from. Home is a pinned LEAF now — it unfolds nothing — so a
  // loop hung off it alone would be drawn NOWHERE (Uncategorized would catch it, which is 🔒 D7's
  // own amendment and `topics.spec.ts` step 5's claim). The walker's proof therefore hangs off a
  // topic that actually descends: `[[KPIs]]`, one of the five promoted roots.
  await writeFile(path.join(vault, 'Loop B.md'), '---\nfolder_page: true\nfolder_pages:\n  - "[[Loop A]]"\n---\n\n# Loop B\n')
  await writeFile(path.join(vault, 'Loop A.md'), '---\nfolder_page: true\nfolder_pages:\n  - "[[KPIs]]"\n  - "[[Loop B]]"\n---\n\n# Loop A\n')
  await writeFile(path.join(vault, 'Loop Leaf.md'), '---\nfolder_pages:\n  - "[[Loop A]]"\n  - "[[Loop B]]"\n---\n\n# Loop Leaf\n')

  // THE TOPICS TREE. `Loop A` joins KPIs' members (which declare no `order`, so the [D5] fallback
  // sorts it into third place); neither loop page is a ROOT, because each has a non-Home parent.
  await expect.poll(() => topicRow(win, 'KPIs').locator('.tree__count').textContent()).toBe('6')
  await treeChevron(win, 'Expand', 'KPIs').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes',
    'Sales-Conversion',
    'Lead Gen',
    'Industries',
    'KPIs',
    'CAC',
    'Gross Margin',
    'Loop A',
    'MQL Volume',
    'Sales Cycle Time',
    'Win Rate',
    'Problems',
    'Roles',
    'Uncategorized',
  ])

  await treeChevron(win, 'Expand', 'Loop A').click()
  await treeChevron(win, 'Expand', 'Loop B').click()
  // The descent walks KPIs → A → B and STOPS: A is on B's ancestor path, so that branch ends
  // quietly instead of hanging. `Loop Leaf` renders under BOTH parents — the multi-parent repeat.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Funnel Stages',
    'Pipeline Review Notes',
    'Sales-Conversion',
    'Lead Gen',
    'Industries',
    'KPIs',
    'CAC',
    'Gross Margin',
    'Loop A',
    'Loop B',
    'Loop Leaf',
    'Loop Leaf',
    'MQL Volume',
    'Sales Cycle Time',
    'Win Rate',
    'Problems',
    'Roles',
    'Uncategorized',
  ])
  // 🔒 D3's honesty split, and the loop is what makes it visible: the COUNT is the page's DIRECT
  // members (`pagesIn` — Loop A and Loop Leaf), while the CHEVRON asked the GUARDED question and
  // opened onto the one member that is not already standing above it.
  await expect(topicRow(win, 'Loop B').locator('.tree__count')).toHaveText('2')
  await expect(topicRow(win, 'Loop A').first().locator('.tree__count')).toHaveText('2')
  await shoot(win, 'cross-08-loop-in-the-tree')

  // THE OUTLINE, from inside the loop — and the OTHER half of the YAZ-859 seam ruling, re-aimed.
  //
  // TOMBSTONE (YAZ-904 → ⚡ YAZ-1152): the outline used to be the second EXPANSION-driven surface —
  // chevrons, per-row counts, a guarded descent of its own — and this step used to prove the two
  // walkers agreed inside the loop. That surface is gone twice over: the outline is a DOCUMENT,
  // and a member it does not name is now WRITTEN INTO it rather than listed beside it. Either way
  // it is FLAT — a link line is a link line, it does not descend — so a loop cannot hang it, and
  // there is no second walker left to disagree with the tree. The honesty split itself (count =
  // DIRECT members, chevron = the guarded question) is still proven where it still exists: on the
  // Topics tree, three assertions up, which is also where the counts this step used to read off
  // the appended rows now live.
  await topicRow(win, 'Loop A').click()
  await expect(activeTab(win)).toHaveText('Loop A')
  // Its one-line body, migrated in (⚡ YAZ-919), and both members adopted under it (⚡ YAZ-1152) as
  // plain depth-0 links: the document lists them, it does not descend into them.
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual(['Loop A', '[[Loop B]]', '[[Loop Leaf]]'])
  // `Loop B` is a folder page and `Loop Leaf` is not, and inside the document that difference does
  // not show at all — no glyph, no count, nothing to expand. The locked scoping decision.
  await expect(win.locator('.view-outline__glyph, .view-outline__count, .view-outline__list')).toHaveCount(0)
  await expect(contents(win).locator('[aria-label="Expand Loop B"]')).toHaveCount(0)
  await shoot(win, 'cross-09-loop-in-the-outline')

  // And from the OTHER end of the loop, so neither direction is the special case.
  await topicRow(win, 'Loop B').click()
  await expect(activeTab(win)).toHaveText('Loop B')
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual(['Loop B', '[[Loop A]]', '[[Loop Leaf]]'])
  await expect(contents(win).locator('[aria-label="Expand Loop A"]')).toHaveCount(0)

  // Tidy the tree back up before step 5 reads it again — including KPIs, which step 5 expands.
  await treeChevron(win, 'Collapse', 'Loop A').click()
  await treeChevron(win, 'Collapse', 'KPIs').click()
})

// ================================================================ 5. turn-into, end to end

test('step 5 — turn a plain note into a folder page, feed it, and turn it back: the member lands in Uncategorized', async () => {
  test.setTimeout(60_000)

  // The gesture lives in the FILE tree's context menu (the Topics lens has no menu of its own —
  // 🔒 YAZ-847), so the lens row is part of the path. `CAC` is an ordinary page today.
  await lensTab(win, 'Files').click()
  // Step 3 relaunched, and a launch restores no open dirs (YAZ-1642): open `kpis/` and its
  // siblings before a member is clicked.
  await expandDirs(win, FOLDERS.map((f) => path.join(vault, f)))
  await fileRow(win, 'CAC').click()
  await expect(activeTab(win)).toHaveText('CAC')
  expect(await scrollerBlocks(win)).not.toContain('folder-page-contents')
  await expect(contents(win)).toHaveCount(0)

  await fileRow(win, 'CAC').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn into folder page' }).click()

  // ONE frontmatter key, and the block appears BELOW the note's own body — 🔒 D1's slot, between
  // the Crepe mount and the Comments block (YAZ-1472) that stands above "Linked mentions", with
  // no reload and no reopen.
  await expect.poll(() => read(CAC), { timeout: 10_000 }).toContain('folder_page: true')
  expect(await read(CAC)).toContain('[[KPIs]]') // it still belongs where it belonged
  await expect(contents(win)).toBeVisible()
  expect(await scrollerBlocks(win)).toEqual(['page-header', 'editor-mount', 'folder-page-contents', 'comments', 'backlinks'])
  await shoot(win, 'cross-10-turned-into')

  // THE SIDEBAR: a folder page NESTED under the topic it belongs to — glyph, count, no chevron
  // yet, because it holds nobody.
  await lensTab(win, 'Topics').click()
  await treeChevron(win, 'Expand', 'KPIs').click()
  await expect(topicRow(win, 'CAC').locator('.tree__glyph')).toBeVisible()
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveText('0')
  await expect(treeChevron(win, 'Expand', 'CAC')).toHaveCount(0)

  // FEED IT — from its own outline, the remaining orphan. The target has NO frontmatter at all,
  // so this write builds the block from nothing.
  // A brand-new folder page holds nobody, so its document is the single empty bullet the seed
  // guarantees — there is always something to click into and type.
  await expect(outlineLines(contents(win))).toHaveText([''])
  await caretAtEndOfLine(win, contents(win), 0)
  await pickOutlineLink(win, 'Positioning Draft')
  await expect.poll(() => read(ORPHAN_OUT), { timeout: 10_000 }).toContain('[[CAC]]')
  await expect(outlineLines(contents(win))).toHaveText(asLinks('Positioning Draft'))
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveText('1')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1') // only Lead Nurture left
  await treeChevron(win, 'Expand', 'CAC').click()
  await expect(topicRow(win, 'Positioning Draft')).toHaveCount(1)
  await shoot(win, 'cross-11-fed-it')

  // TURN IT BACK — the only direction that asks, through its own sheet.
  const memberBefore = await md5(path.join(vault, ORPHAN_OUT))
  await lensTab(win, 'Files').click()
  await fileRow(win, 'CAC').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn back into normal page' }).click()
  await expect(sheet(win)).toContainText(
    "Turn 'CAC.md' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.",
  )
  await shoot(win, 'cross-12-turn-back-sheet')
  await sheetBtn(win, 'Turn back').click()

  // The reverse touches ONE page atomically, and the member's card is byte-identical — its
  // `[[CAC]]` entry is still there, simply not counting for anybody while the flag is gone.
  await expect.poll(() => read(CAC), { timeout: 10_000 }).not.toContain('folder_page:')
  expect(await read(ORPHAN_OUT)).toContain('[[CAC]]')
  expect(await md5(path.join(vault, ORPHAN_OUT))).toBe(memberBefore)

  // The block goes with the flag…
  await expect(contents(win)).toHaveCount(0)
  expect(await scrollerBlocks(win)).not.toContain('folder-page-contents')
  // …and the sheet's promise comes true on the other surface: the page it held belongs nowhere
  // else, so Uncategorized has it back — exactly what the copy said would happen.
  await lensTab(win, 'Topics').click()
  await expect(topicRow(win, 'CAC').locator('.tree__glyph')).toHaveCount(0)
  await expect(topicRow(win, 'CAC').locator('.tree__count')).toHaveCount(0)
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('2')
  await uncategorizedRow(win).click()
  await expect(topicRow(win, 'Positioning Draft')).toHaveCount(1)
  await shoot(win, 'cross-13-turned-back')
  await quitApp(app)
})

// ================================================================ 6. migration smoke

/** The page_type era in miniature: two channel pages, two problems that name them, one kpi. */
const PAGE_TYPE_VAULT: Record<string, string> = {
  'Website.md': '---\npage_type: channel\n---\n\n# Website\n\nThe marketing site and everything on it.\n',
  'Newsletter.md': '---\npage_type: channel\n---\n\n# Newsletter\n\nThe weekly send.\n',
  'problems/Signup Flow.md':
    '---\npage_type: problem\nchannels: ["[[Website]]"]\n---\n\n# Signup Flow\n\nToo many steps before anybody sees value.\n',
  'problems/Onboarding Drip.md':
    '---\npage_type: problem\nchannels: ["[[Newsletter]]"]\n---\n\n# Onboarding Drip\n\nNobody owns the sequence after day three.\n',
  'kpis/North Star.md': '---\npage_type: kpi\nunit: percent\n---\n\n# North Star\n\nWeekly active teams.\n',
}

test('step 6 — a page_type vault, migrated by the real script, OPENS as a folder-page vault', async () => {
  test.setTimeout(90_000)

  // Build it and commit it: the migration refuses to run unless it has something to `git checkout`
  // back into (🔒 D1), so the git repo is part of the gesture and not scaffolding around it.
  const legacy = await mkdtemp(path.join(tmpdir(), 'cross-pagetype-'))
  vaults.push(legacy)
  for (const [rel, content] of Object.entries(PAGE_TYPE_VAULT)) {
    const abs = path.join(legacy, rel)
    await mkdir(path.dirname(abs), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  const git = (...args: string[]) => execFileSync('git', ['-C', legacy, ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('config', 'user.email', 'cross@test.local')
  git('config', 'user.name', 'Cross Cutting Test')
  git('config', 'commit.gpgsign', 'false')
  git('add', '-A')
  git('commit', '-q', '-m', 'the page_type era')

  // THE REAL COMMAND, as a human types it. `execFileSync` throws on a non-zero exit, so a failed
  // post-check fails this test — the script's own four checks are the first assertion here.
  const report = execFileSync(process.execPath, [MIGRATE, '--vault', legacy, '--apply'], { encoding: 'utf8', stdio: 'pipe' })
  expect(report).toContain('Folder pages created')
  expect(await withPageType(legacy)).toEqual([])

  // NOW OPEN IT. Nothing was hand-fixed between the script and the app: this is the vault the
  // migration left behind, on the Topics lens.
  app = await launchApp({ userData, seedState: crossState(legacy, null) })
  win = await appWindow(app, 'w1')

  // The roots rule finds the Home the migration made — a PINNED LEAF since ⚡ YAZ-920, so it
  // counts nothing and unfolds nothing — and the three folder pages the script made out of the
  // three `page_type` values stand as roots BESIDE it, path-sorted, each carrying its own count.
  // `migration-report.md` is a page of the vault now like any other, and belongs nowhere — so
  // Uncategorized is where it waits.
  await expect(topicLabels(win)).toHaveText(['Home', 'Channels', 'KPIs', 'Problems', 'Uncategorized'])
  await expect(topicRow(win, 'Home').locator('.tree__count')).toHaveCount(0)
  await expect(treeChevron(win, 'Expand', 'Home')).toHaveCount(0)
  await expect(topicRow(win, 'Channels').locator('.tree__count')).toHaveText('2')
  await expect(topicRow(win, 'KPIs').locator('.tree__count')).toHaveText('1')
  await expect(topicRow(win, 'Problems').locator('.tree__count')).toHaveText('2')
  await expect(uncategorizedRow(win).locator('.tree__count')).toHaveText('1')
  await shoot(win, 'cross-14-migrated-roots')

  // `channel` pages became folder pages of their own, so the tree descends INTO a channel — and
  // `Signup Flow` stands under BOTH `Problems` (from its `page_type`) and `Website` (from the
  // `channels:` list the migration merged into `folder_pages`). One page, two parents, one write.
  await treeChevron(win, 'Expand', 'Channels').click()
  await treeChevron(win, 'Expand', 'Website').click()
  await treeChevron(win, 'Expand', 'Problems').click()
  await expect(topicLabels(win)).toHaveText([
    'Home',
    'Channels',
    'Newsletter',
    'Website',
    'Signup Flow',
    'KPIs',
    'Problems',
    'Onboarding Drip',
    'Signup Flow',
    'Uncategorized',
  ])
  await expect(topicRow(win, 'Channels').locator('.tree__count')).toHaveText('2')
  await expect(topicRow(win, 'Website').locator('.tree__count')).toHaveText('1')
  await shoot(win, 'cross-15-migrated-tree')

  // AND A FOLDER PAGE BROWSES: open one from the tree and its members are below its body, in both
  // skins, with the two channel pages wearing the glyph and their own counts.
  await topicRow(win, 'Channels').click()
  await expect(activeTab(win)).toHaveText('Channels')
  await expect(contents(win)).toBeVisible()
  // Both channel pages stand in the document the [D5] seed wrote, as plain link lines — the glyph
  // and the direct-member count they used to wear moved to the appended section with YAZ-903 and
  // then to the Topics tree with ⚡ YAZ-1152, which is where `folderPages.spec.ts` step 6 reads
  // them. This page names every member it has, so adoption has nothing to add and writes nothing.
  await expect(outlineLines(contents(win))).toHaveText(asLinks('Newsletter', 'Website'))
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(['Newsletter', 'Website'])
  await shoot(win, 'cross-16-migrated-folder-page')

  await quitApp(app)
})
