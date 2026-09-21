/**
 * Folder pages, end to end (YAZ-819; 🔒 D1/D2/D3 of YAZ-818): a page flagged `folder_page: true`
 * carries its CONTENTS below its own body — today's fully interactive views table, fed the pages
 * that belong to it, columns from the folder page's own settings.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * which since 7C- is a MIGRATED vault: every page belongs somewhere, `Funnel Stages` is one of six
 * folder pages hanging off `Home`, and the only pages that belong nowhere are the two `inbox/`
 * notes that were never told about. Nothing below depends on that shape except where it says so —
 * the steps that move `CAC` around now move a page that ALREADY belongs to `[[KPIs]]`, which is
 * what makes the add/remove gestures prove merge-and-drop rather than write-and-wipe.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the block renders INSIDE the note's scroller, between the body and the backlinks, holding
 *     exactly the pages that say they belong here — and the view tabs switch outline ⇄ table
 *   2 a cell edited in the table writes the MEMBER's own file on disk, surgically
 *   3 the narrowed picker: a multi-link column whose target is a folder page offers exactly that
 *     folder page's members — the 🔒 D2 case, resolved over the WHOLE vault while the rows are
 *     only the members
 *   4 "New" births a member from the declaration, parks it per the settings, and it comes back —
 *     ADOPTED into the outline's document, with no user action at all
 *   5 the OUTLINE tags a page (YAZ-820, re-aimed in YAZ-904): the `[[` picker writes a LINK LINE,
 *     and that line puts `folder_pages` onto the PICKED page's own file, on disk
 *   6 a member that is itself a folder page: PLAIN TEXT inside the document (no glyph, no count,
 *     no chevron — the locked scoping decision), with the glyph and the direct-member count read
 *     off the Topics tree, which is where they live now
 *   7 deleting the link line + confirm sheet un-tags it again — dropping ONLY this folder page's
 *     entry and leaving the other two exactly where they were
 *   8 the GROUPED table (YAZ-744, restored here in YAZ-846): a `groupBy` set through the Sort
 *     menu is ONE `folder_page_settings` write, and a collapsed section survives quit → relaunch
 *     in the main-owned `baseGroups` bucket — keyed by the folder page's own `.md` path, never
 *     written into the page's frontmatter
 *
 * TOMBSTONE (YAZ-904, for steps 5–7): the outline's picker-only ADD ROW, the depth-0 DRAG and the
 * nested AUTO-EXPANSION (chevrons, per-row counts inside the outline) died with YAZ-903 — the
 * outline is a document now. Every one of those steps still proves what it set out to prove, on
 * the surface that replaced it; where the premise itself died (nesting expanding IN PLACE) the
 * step says so and asserts the behaviour that took its place.
 *
 * TOMBSTONE (YAZ-919, for steps 1/4/5/6): and the document these steps used to read is gone too.
 * Every folder page in the fixture SHIPS a body, and a folder page is title → outline now — so
 * the body migrates into the outline document on the page's first open, deterministically, on the
 * first paint. What stands in the editor is therefore the page's own prose, and the [D5]
 * member-link list these steps used to assert is the fallback a folder page with NO document
 * gets. Step 9 is the migration's own proof.
 *
 * ⚡ TOMBSTONE (YAZ-1152, for steps 1/4/6/7): the APPENDED SECTION — the read-only row per member
 * the document does not name, with its bullet, glyph, direct-member count and hover × — DOES NOT
 * EXIST. Those members are ADOPTED into the document instead: depth-0 `[[link]]` lines at the end,
 * alphabetical, written through the outline's one commit door before anybody types a key. So every
 * "it is a row down there" assertion below became "it is a LINE up here", the glyph-and-count
 * claim moved to the Topics tree (step 6, the only surface that still draws them), and the hover ×
 * moved to deleting the line — the gesture that opens the very same sheet. Cancelling that sheet
 * now RESTORES the line, which `folderPageOutline.spec.ts` step 5 owns end to end.
 *
 * Same harness as bible.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `folder-` step
 * screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  bulletAfterLine,
  clearOutlineLine,
  copyVault,
  expandDirs,
  launchApp,
  outlineEditor,
  outlineLineIndex,
  outlineLines,
  outlineSaid,
  pickOutlineLink,
  quitApp,
  readState,
  seededState,
  shoot,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Funnel Stages.md'
const STAGES = 'funnel-stages'
/** Its members, in the path order `pagesIn` hands them over. */
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']
/**
 * `Funnel Stages.md`'s own BODY, migrated into its outline DOCUMENT on the page's first open
 * (YAZ-919): the heading marker stripped, blank lines dropped, one bullet per surviving line.
 * This is what the document says from the first paint — so the members it does not NAME are the
 * appended rows below it, which is where every assertion about them now looks.
 */
const BODY = [
  'Funnel Stages',
  'The stages a deal walks through, from first touch to closed-won. Every page that says it',
  'belongs here shows up below — there is no list to maintain.',
]
/** The same, for `funnel-stages/Lead Gen.md` — step 6 turns it into a folder page and opens it. */
const LEAD_GEN_BODY = [
  'Lead Gen',
  'Everything that turns strangers into known contacts. Spend concentrates here, so',
  "[[CAC]] and [[MQL Volume]] are the stage's scoreboard.",
]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** Row names, whichever body renders: the unknown-view placeholder list, or the real table — the page TITLE, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
/** Every member's name as a LINK LINE, which is how a membership is spelled inside the document. */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)
/**
 * The sidebar's two lenses. This file navigates by the FILE tree (its seed says so) and steps over
 * to Topics for one thing: the folder-page glyph and the DIRECT-member count, which since
 * ⚡ YAZ-1152 are drawn there and nowhere else (step 6).
 */
const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
const topicRow = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const treeChevron = (w: Page, action: 'Expand' | 'Collapse', label: string) =>
  w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
/** `data-cell="row:col"` indexes DATA columns only — the `#` gutter (YAZ-1513) carries none. */
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The grouped table's section headers (4C), in document order. */
const groupNames = (scope: Locator) => scope.locator('.view-table__group .view-group__value')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'folderpages-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the contents block sits between the note and its backlinks, holding exactly the members', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FOLDER_PAGE)) })
  win = await appWindow(app, 'w1')
  // A launch is collapsed since YAZ-1642: open the members' disk folder once for the later steps.
  await expandDirs(win, [path.join(vault, STAGES)])

  await expect(contents(win)).toBeVisible()
  // 🔒 D1: between the Crepe mount and "Linked mentions" in the note's own scroller — it scrolls
  // WITH the note, exactly like the Comments block (YAZ-1472) and the backlinks below it. No chip
  // of its own: the page's NAME and its properties share block zero, the header ROW (YAZ-918
  // folded ⚡ YAZ-888's title and ⚡ YAZ-883's panel into one), and a folder page adds nothing to it.
  const children = await layer(win)
    .locator('.editor-host')
    .evaluate((host) => Array.from(host.children).map((c) => c.className))
  expect(children).toEqual(['page-header', 'editor-mount', 'folder-page-contents', 'comments', 'backlinks'])

  // YAZ-909 → YAZ-917/YAZ-919: a folder page IS title → outline. The body editor still mounts
  // (autosave, and YAZ-919's migration path, live behind it) but shows NOTHING, and the contents
  // block draws no divider — the outline starts right under the header row.
  await expect
    .poll(() =>
      layer(win)
        .locator('.editor-host')
        .evaluate((host) => {
          const mount = getComputedStyle(host.querySelector('.editor-mount')!)
          const contents = getComputedStyle(host.querySelector('.folder-page-contents')!)
          return `${mount.display} | ${contents.borderTopWidth}`
        }),
    )
    .toBe('none | 0px')

  // Q7: the folder page's two skins, outline FIRST (YAZ-820). The outline is a DOCUMENT (YAZ-903)
  // and YAZ-919 gave this page one on its very first paint: the body it has carried since the
  // fixture was written, moved in whole. That prose names none of its three members — so
  // ⚡ YAZ-1152's adoption writes all three INTO it, as link lines under the body, alphabetically.
  // One surface, both halves, deterministically, before anybody has typed anything.
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table', 'Board'])
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...BODY, ...asLinks(...MEMBERS)])
  // …and the body really did LEAVE the file, which is the other half of "nothing disappears":
  // frontmatter, and nothing after it.
  await expect
    .poll(() => readFile(path.join(vault, FOLDER_PAGE), 'utf8').then((t) => t.trimEnd().endsWith('---')), { timeout: 10_000 })
    .toBe(true)
  await shoot(win, 'folder-01-contents-outline')

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  // Per-view filters returned in YAZ-1218 (🔒 Q3 amended): the button is offered — and since 🔒 D0
  // (YAZ-1471) the view tabs are EDITABLE, so the "+" that adds a view is offered beside them too.
  await expect(contents(win).locator('[aria-label="Filter"]')).toHaveCount(1)
  await expect(contents(win).locator('[aria-label="Add view"]')).toHaveCount(1)
  await shoot(win, 'folder-02-contents-table')
})

test('step 2 — a cell edited in the block writes the MEMBER’s own file on disk', async () => {
  // Column 1 is `note.order`, typed `number` by the folder page's own declaration (🔒 Q8). The
  // CELL owns mouse activation since YAZ-1030 (its display button is `pointer-events: none`), so
  // the door in is a deliberate double-click.
  await cell(contents(win), 0, 1).dblclick()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.fill('9')
  await win.keyboard.press('Enter')

  const leadGen = path.join(vault, STAGES, 'Lead Gen.md')
  await expect.poll(() => readFile(leadGen, 'utf8'), { timeout: 10_000 }).toContain('order: 9')
  const after = await readFile(leadGen, 'utf8')
  expect(after).toContain('folder_pages: ["[[Funnel Stages]]"]') // the belonging is untouched
  expect(after).toContain('# Lead Gen') // and so is the body
  await shoot(win, 'folder-03-cell-write')
})

test('step 3 — the narrowed picker: a multi-link column targeting a folder page offers its members', async () => {
  // Column 2 is `related_stages`, declared `multi-link` with `target: "[[Funnel Stages]]"`. The
  // members are the ROWS here, but the picker resolves that target over the WHOLE vault (🔒 D2)
  // — fed the rows alone it would have found no folder page at all and widened to every page.
  await cell(contents(win), 0, 2).dblclick()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await input.pressSequentially('[[', { delay: 15 })

  const suggestions = win.locator('[aria-label="Edit related_stages suggestions"] [role="option"]')
  await expect(suggestions).toHaveText(MEMBERS)
  await shoot(win, 'folder-04-narrowed-picker')

  await win.keyboard.press('Escape') // cancel: the picker is what this step proves, not a write
  await expect(input).toHaveCount(0)
})

test('step 4 — "New" births a member from the declaration, parked per the settings, and it comes back as a LINE', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Parked in the settings' `folder`, born with every declared column empty and the belonging
  // LAST — and an ORDINARY page: the flag is never born here (🔒 Q5).
  const created = path.join(vault, STAGES, 'Untitled.md')
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  const born = await readFile(created, 'utf8')
  expect(born).toContain('related_stages: []')
  expect(born).not.toContain('folder_page:')
  await expect(activeTab(win)).toHaveText('Untitled')
  // YAZ-909's other half, retuned by YAZ-918: an ORDINARY page keeps its visible editor and its
  // 120px document tail — but the 32px lead-in went with the stacked panel the header row
  // replaced, so the body starts on the editor's own 16px + 4px rhythm.
  await expect
    .poll(() =>
      layer(win)
        .locator('.editor-mount > .editor-instance')
        .evaluate((el) => {
          const s = getComputedStyle(el)
          return `${getComputedStyle(el.closest('.editor-mount')!).display} | ${s.paddingTop} ${s.paddingBottom}`
        }),
    )
    .toBe('block | 0px 120px')
  await shoot(win, 'folder-05-new-member')

  // …and the folder page adopts it off the watcher, with no user action.
  await fileRow(win, 'Funnel Stages').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the re-opened note is back on Q7's first skin — and
  // the newborn arrives the ⚡ YAZ-1152 way: a member the document does not NAME is written into
  // it, so `Untitled` is simply the next link line, in adoption's own alphabetical order, with
  // nobody typing a thing. (The three that were adopted on the first open keep their places: the
  // append is at the END, and it never re-writes what is already there.)
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...BODY, ...asLinks(...MEMBERS, 'Untitled')])
  await shoot(win, 'folder-06-new-member-row')
})

/** The kpi page the outline gestures move around; the migration left it belonging to `[[KPIs]]`. */
const CAC = 'kpis/CAC.md'

test('step 5 — the outline’s `[[` picker tags an existing page, on that page’s own file', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(outlineLines(contents(win))).toHaveText([...BODY, ...asLinks(...MEMBERS, 'Untitled')])

  // The add row is gone (YAZ-903): the gesture is now typing `[[` in the document itself, which
  // is still picker-only in the sense that mattered — the picker narrows over REAL pages and
  // inserts the link text, and a line that is exactly one resolving link IS the membership.
  // The new line goes under the page's own prose, which is where a user typing would put it.
  await bulletAfterLine(win, contents(win), BODY.length - 1)
  await pickOutlineLink(win, 'CAC', 'folder-07-outline-picker')

  // The write lands on the PICKED page's card — never on the folder page's — and it ADDS: the
  // `[[KPIs]]` entry the migration wrote is still the first thing in the list.
  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // a page belongs to as many topics as it says
  expect(await readFile(cac, 'utf8')).toContain('funnel_stages: ["[[Lead Gen]]"]') // every other key survives
  // The typed line stands where the caret put it — under the prose, ABOVE the lines adoption
  // wrote. Adoption appends at the END and reorders nothing, so the four that were there are
  // exactly where they were: a document the user typed into is never rearranged under them.
  await expect(outlineLines(contents(win))).toHaveText([...BODY, '[[CAC]]', ...asLinks(...MEMBERS, 'Untitled')])
  await shoot(win, 'folder-08-outline-tagged')
})

test('step 6 — a member that is itself a folder page: a plain link line in the document, glyph and count on the Topics tree', async () => {
  // TOMBSTONE (YAZ-904): a nested folder page used to EXPAND IN PLACE here, behind a chevron, with
  // its direct-member count on the row. That premise died with rows-are-pages — inside the
  // document a folder page's link is a plain wikilink and nothing more (the locked scoping
  // decision), and the glyph and count moved to the APPENDED row.
  //
  // ⚡ TOMBSTONE (YAZ-1152): and then the appended row died too, so there is no second surface left
  // to compare against. Both halves survive, one on each side of the split the scoping decision
  // always meant: the DOCUMENT holds a plain wikilink, and the TOPICS TREE — which is where a
  // folder page's glyph and direct-member count have always been drawn honestly — holds the rest.
  // The naming half needs no gesture at all any more: adoption wrote `[[Lead Gen]]` into this
  // document on the page's first open, before it was even a folder page.

  // The sidebar's own gesture (YAZ-840) makes Lead Gen a folder page; forward never confirms.
  await fileRow(win, 'Lead Gen').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Turn into folder page' }).click()

  // Tag CAC into Lead Gen from LEAD GEN's own outline — CAC now belongs to both. `Lead Gen.md`
  // carries a body of its own, so becoming a folder page moves it in exactly the same way: the
  // document is that prose, and the link line goes UNDER it.
  await fileRow(win, 'Lead Gen').click()
  await expect(contents(win)).toBeVisible()
  await expect(outlineLines(contents(win))).toHaveText(LEAD_GEN_BODY)
  await bulletAfterLine(win, contents(win), LEAD_GEN_BODY.length - 1)
  await pickOutlineLink(win, 'CAC')
  // The `folder_pages` ENTRY, not just the name: CAC's body and its `funnel_stages` relation both
  // spell `[[Lead Gen]]` already, so a bare `toContain` would pass without a membership at all.
  await expect.poll(() => readFile(path.join(vault, CAC), 'utf8'), { timeout: 10_000 }).toContain('- "[[Lead Gen]]"')

  // Back on Funnel Stages, where `[[Lead Gen]]` has been a LINE since the first open — becoming a
  // folder page changed nothing about it, because the document holds text and text does not care.
  await fileRow(win, 'Funnel Stages').click()
  await expect(outlineLines(contents(win))).toHaveText([...BODY, '[[CAC]]', ...asLinks(...MEMBERS, 'Untitled')])
  // As a LINE it is an ordinary wikilink and nothing else: no glyph, no count, no chevron — the
  // very selectors those badges used to wear match nothing anywhere in the window now.
  await expect(outlineEditor(contents(win)).locator('.wikilink', { hasText: 'Lead Gen' })).toHaveCount(1)
  await expect(win.locator('.view-outline__glyph, .view-outline__count, .view-outline__list')).toHaveCount(0)
  await expect(contents(win).locator('[aria-label="Expand Lead Gen"]')).toHaveCount(0)

  // And the OTHER half, on the surface that kept it: the Topics tree draws a folder-page member
  // with its glyph and its honest DIRECT-member count — CAC, and only CAC, so 1 — while the
  // document above stays the plain text it is. One fact, two skins, neither pretending.
  await lensTab(win, 'Topics').click()
  await treeChevron(win, 'Expand', 'Funnel Stages').click()
  await expect(topicRow(win, 'Lead Gen').locator('.tree__glyph')).toBeVisible()
  await expect(topicRow(win, 'Lead Gen').locator('.tree__count')).toHaveText('1')
  expect(await readFile(path.join(vault, 'funnel-stages', 'Lead Gen.md'), 'utf8')).toContain('[[Funnel Stages]]')
  await shoot(win, 'folder-09-outline-folder-page-member')
  await lensTab(win, 'Files').click() // back to the lens the rest of this file navigates by
})

test('step 7 — deleting the link line + sheet un-tags it, dropping ONLY this folder page’s entry', async () => {
  // ⚡ YAZ-1152: there is no hover × any more — every membership is a LINE, and dropping one is
  // deleting its line, which opens the very sheet the × used to. One gesture, one question.
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), '[[CAC]]'))
  // The sheet names the OTHERS in entry order — the migrated `[[KPIs]]` first, then step 6's pick.
  await expect(sheet(win)).toContainText('The page is not deleted — its file stays put. It remains in: KPIs, Lead Gen.')
  await shoot(win, 'folder-10-remove-sheet')
  await sheetBtn(win, 'Remove').click()

  const cac = path.join(vault, CAC)
  await expect.poll(() => readFile(cac, 'utf8'), { timeout: 10_000 }).not.toContain('[[Funnel Stages]]')
  expect(await readFile(cac, 'utf8')).toContain('[[KPIs]]') // the other two belongings are untouched
  expect(await readFile(cac, 'utf8')).toContain('[[Lead Gen]]')
  // Gone from this folder page entirely — and it STAYS gone: an un-tag in flight is never
  // re-adopted, so the only link lines left are the four pages that do belong here.
  await expect.poll(() => outlineSaid(contents(win))).toEqual([...BODY, ...asLinks(...MEMBERS, 'Untitled')])
  await shoot(win, 'folder-11-outline-untagged')
})

test('step 8 — the grouped table: one groupBy write, and a collapsed section that survives a relaunch', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  // `folder_page` is ORDINARY frontmatter to the query engine — the flag MEANS something to
  // `isFolderPage`, and nothing at all to a groupBy. Step 6 turned exactly one of these four
  // members into a folder page, so the run has a real group and the trailing "No value" one.
  // Setting it is ONE `folder_page_settings` write through the one door. "Group by" is the shared
  // `ColumnPicker` (YAZ-1466): a button opening a searchable listbox, each option keyed by
  // `data-value`; choosing one closes the list, and Esc then closes the Sort menu itself.
  await contents(win).locator('[aria-label="Sort"]').click()
  await win.locator('.view-popover [aria-label="Group by"]').click()
  await win.locator('.view-popover [role="option"][data-value="note.folder_page"]').click()
  await win.keyboard.press('Escape')

  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(4)
  const folderPage = path.join(vault, FOLDER_PAGE)
  await expect.poll(() => readFile(folderPage, 'utf8'), { timeout: 10_000 }).toContain('groupBy')
  await shoot(win, 'folder-12-grouped-table')

  // Collapsing keeps the header and drops the rows — and it lands in the MAIN-owned store, keyed
  // by the folder page's own path, never in its frontmatter (4C).
  await contents(win).locator('[aria-label="Toggle group true"]').click()
  await expect(dataRows(contents(win))).toHaveCount(3)
  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await shoot(win, 'folder-13-group-collapsed')

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const state = await readState(userData)
  expect(state.folders?.[vault]?.baseGroups).toEqual({ [`${folderPage}::Table`]: ['v:true'] })
  expect(await readFile(folderPage, 'utf8')).not.toContain('baseGroups')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'Funnel Stages').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on Q7's first skin.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(groupNames(contents(win))).toHaveText(['true', 'No value'])
  await expect(dataRows(contents(win))).toHaveCount(3) // still collapsed
  await shoot(win, 'folder-14-group-collapse-restored')

  await quitApp(app)
})

test('step 9 — a body the page already carried migrates into the outline on open (YAZ-919)', async () => {
  // A folder page is title → outline now, and its body editor shows nothing — so the body
  // `Roles.md` has carried since the fixture was written must MOVE on first open: into the top
  // of its outline document, leaving the file frontmatter-only. Nothing silently disappears.
  const roles = path.join(vault, 'Roles.md')
  expect(await readFile(roles, 'utf8')).toContain('Who signs') // the body is really there first

  app = await launchApp({ userData }) // restore, no re-seed — the ordinary door in
  win = await appWindow(app, 'w1')
  await fileRow(win, 'Roles').click()
  await expect(contents(win)).toBeVisible()
  // The moved text stands in the page's contents — the outline is where the body went.
  await expect(contents(win)).toContainText('Who signs')

  // Durable, not cosmetic: the outline document holds the text as bullets, the body is gone,
  // and the write happened THROUGH the one open door (useFile), before the editor ever mounted.
  await expect.poll(() => readFile(roles, 'utf8'), { timeout: 10_000 }).toContain('- Who signs')
  const after = await readFile(roles, 'utf8')
  expect(after.trimEnd().endsWith('---')).toBe(true) // frontmatter only: the body moved out

  await quitApp(app)
})
