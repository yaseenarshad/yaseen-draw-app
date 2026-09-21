/**
 * Bible C (GRO-2203, re-pointed at the folder-page model in 7C-): the convergence proof — one
 * committed encyclopedia driven through the REAL app, with the index, the wiki-link graph and the
 * folder pages all answering the same questions about it.
 *
 * The fixture (`fixtures/bible-vault/`) is a MIGRATED vault: `tools/migrateFolderPages.mjs` ran
 * over the `page_type` encyclopedia this file used to open, turned its five type values into five
 * folder pages, gave them a `Home` to hang from and deleted the registry. Every page now says in
 * its OWN frontmatter which topics it belongs to — except the two `inbox/` notes, which are
 * deliberately Uncategorized. Nothing carries `page_type` any more, and step 1 proves it.
 *
 * WHAT THIS SPEC IS FOR, now that the wave has three siblings: `folderPages.spec.ts` drives the
 * contents block's own gestures (cells, pickers, New, tag/untag, nesting, grouping),
 * `topics.spec.ts` drives the sidebar tree and Home's birth, `lenses.spec.ts` the tabs above them.
 * What is left here — and lives nowhere else — is the CONTENT: that the index reads this vault
 * correctly, that its links and backlinks agree with its relations, and that a rename leaves both
 * the graph and the belongings standing.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1  the migrated vault is sound: zero `page_type` keys, zero broken links, and Home holds
 *      exactly the five folder pages — its own migrated body as the document, the five ADOPTED
 *      into it below (⚡ YAZ-1152), with their direct-member counts read off the Topics tree
 *   2  a cell the MIGRATION declared, edited inline on `KPIs` — a surgical write into a card the
 *      migration itself rewrote, leaving its membership and body byte-for-byte
 *   3  wiki-link navigation: click → current tab, ⌘-click → background tab (the LOCKED model)
 *   4  the backlinks panel finds every note that names a KPI, and the ones that BELONG TO
 *      `[[Problems]]` are exactly the two problems whose relations point at it
 *   5  rename an entity page — relations, body links, backlinks AND its belonging all survive,
 *      still zero broken links
 *   6  rename a FOLDER PAGE (YAZ-864) — the links that live INSIDE `folder_page_settings` follow
 *      too: Home's outline document line and another folder page's column `target`, alongside the
 *      members' own `folder_pages`. Still zero broken links, and the map still browses.
 *
 * TOMBSTONE (YAZ-904 → YAZ-919 → ⚡ YAZ-1152): the outline is a free-form DOCUMENT since YAZ-903,
 * and the member rows this file used to read — one per member, each with a direct-member COUNT —
 * first moved to the APPENDED section (the members a document does not name) and then STOPPED
 * EXISTING: adoption writes those members into the document instead, so every membership this
 * file reads is now a LINK LINE of the editor's own bullets. Two consequences run through the
 * steps below. The COUNTS are gone from this surface — they live on the Topics tree, which is
 * where step 1 now asks for them, with `directMembers` still re-asking the vault itself as a
 * second source. And a rename must walk INSIDE `folder_page_settings` for every one of these
 * pages, not just for the two the fixture ships with settings links (steps 5 and 6).
 *
 * Same harness as links.spec.ts / backlinks.spec.ts (temp `--user-data-dir`, a COPY of the
 * fixture, `bible-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, expandDirs, launchApp, outlineLines, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDERS = ['funnel-stages', 'inbox', 'industries', 'kpis', 'problems', 'roles']

const HOME = 'Home.md'
/** Home's members, in the `order` the migration wrote onto its outline view. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** Their direct-member counts, in the same order — the shape of the whole migrated map. */
const TOPIC_COUNTS = ['3', '2', '5', '4', '3']

/** The folder page step 2 edits through, and the member it writes to (row 1 in path order). */
const KPIS = 'KPIs'
const GROSS_MARGIN = path.join('kpis', 'Gross Margin.md')
/** Its `kpi_category` today, and what step 2 makes it — the page's own body argues for the change. */
const CATEGORY_WAS = 'lagging'
const CATEGORY_NOW = 'fundamental'

/** Every page that belongs to `[[Problems]]` — the fixture's own answer to "which mentions are problems?". */
const PROBLEMS = ['CRM Hygiene', 'Lead Quality Scoring', 'Nurture Sequencing', 'Stage Accuracy']
/** The KPIs, alphabetically — the order ADOPTION writes them into the document in. */
const KPI_MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']

/**
 * ⚡ YAZ-919: every folder page in this fixture SHIPS a body, and a folder page is title → outline
 * now — so on its first open the body MOVES into `folder_page_settings.views[i].outline` (heading
 * marker stripped, blank lines dropped, one bullet per surviving line) and the file is left
 * frontmatter-only. That document is on screen from the first paint, so what `outlineLines` says
 * about any of these pages starts with the page's own PROSE — and its members, named nowhere in
 * it, are ADOPTED in underneath (⚡ YAZ-1152) as link lines of the same document. The three
 * bodies this file reads back, verbatim:
 */
const HOME_BODY = [
  'Home',
  'The root of the map. Every folder page below says in its own frontmatter that it belongs here,',
  // the editor renders `order` as a code span, so its backticks are an element and not text
  "and the outline's order is the only thing that decides what comes first.",
]
const KPIS_BODY = [
  'KPIs',
  'The numbers the funnel is judged on. Each one names the stages it belongs to, so the same',
  'metric can be owned jointly without anybody maintaining a second list.',
]
const PROBLEMS_BODY = [
  'Problems',
  'The things we are hired to fix. Every one names the stage it lives in, the KPIs it moves and',
  'the role that buys it — which is why nothing here needs a category to be found.',
]
/** `Roles.md`'s, read after step 6 has RENAMED the page — prose is prose, and a rename never rewrites it. */
const ROLES_BODY = ['Roles', 'Who signs, who owns and who reports to whom. The buyers every problem below is sold to.']

const FUNNEL = path.join('funnel-stages', 'Sales-Conversion.md')
const RENAMED = 'Deal Win Rate'

/**
 * Step 6 (YAZ-864): the folder page whose name is spelled in three OTHER frontmatter places than a
 * `folder_pages` list — Home's outline `order`, `Problems.md`'s `sold_to` column `target`, and its
 * own `reports_to` target — all of them NESTED inside `folder_page_settings`, where the index never
 * looked for links. Renamed to a name that sorts FIRST alphabetically, so a stale order entry
 * (silently ignored, then alphabetical) could not pass for a rewritten one.
 */
const ROLES = 'Roles'
const ROLES_RENAMED = 'Buyer Roles'
/** Its members, alphabetically — `Roles.md` declares no outline `order`, so [D5] falls back. */
const ROLE_MEMBERS = ['CEO', 'Head of Sales', 'RevOps Lead']
const TOPICS_AFTER = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', ROLES_RENAMED]

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()
const backlinksHeader = (w: Page) => layer(w).locator('.backlinks__header')
const backlinkNotes = (w: Page) => layer(w).locator('.backlinks__note')
/** The section is collapsed by default (locked) but survives a remount expanded — so check first. */
const expandBacklinks = async (w: Page): Promise<void> => {
  if ((await backlinksHeader(w).getAttribute('aria-expanded')) === 'false') await backlinksHeader(w).click()
  await expect(backlinksHeader(w)).toHaveAttribute('aria-expanded', 'true')
}

/** The folder page's contents block, and the rows/cells of whichever view it is showing. */
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** Every name as a LINK LINE, which is how a membership is spelled into the document. */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)
/**
 * The sidebar's two lenses. This file lives on the FILE tree (its seed says so), and steps down to
 * the Topics tree for one thing only: the DIRECT-member counts, which since ⚡ YAZ-1152 live there
 * and nowhere else — the outline's appended rows, which used to print them, are gone.
 */
const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
const topicRow = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')
/**
 * What the name column shows. The clickable title cell is keyed to `file.name` (TableView's
 * `nameCol`), and since YAZ-1513 it reads the page TITLE — the basename, never `Funnel Stages.md`
 * (`file.name`'s VALUE keeps the extension for sort and filter; the eye never sees it).
 */
const rowNames = (scope: Locator) => scope.locator('.view-row__link, .view-table__link')
/** `data-cell="row:col"` indexes DATA columns only — the `#` gutter (YAZ-1513) carries none. */
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)

const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

/** The name-change confirm (⚡ YAZ-888): every rename below passes it, and its count is the rewrite's own. */
async function confirmRename(w: Page, message: string): Promise<void> {
  const sheet = w.locator('.confirm[role="dialog"]')
  await expect(sheet.locator('.confirm__text')).toHaveText(message)
  await sheet.locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(sheet).toHaveCount(0)
}

// ---------- whole-vault audits ----------

/** Fenced and inline code can't carry links — same discipline as the index's `stripCode`. */
const maskCode = (text: string) => text.replace(/```[\s\S]*?(?:```|$)/g, '').replace(/`[^`\n]*`/g, '')
const WIKILINK = /!?\[\[([^[\]]+)\]\]/g
/** `[[Target|alias]]` / `[[Target#heading]]` → `Target`. */
const targetOf = (inner: string) => inner.split('|')[0].split('#')[0].trim()

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

/**
 * Every wiki link in every note — frontmatter relation values and folder-page settings as much as
 * body prose and `![[…]]` embeds — whose target names no file in the vault, by basename or by
 * root-relative path, with or without extension. The durable result GRO-2203 asks for is that this
 * is `[]` both before and after the rename.
 */
async function brokenLinks(root: string): Promise<string[]> {
  const files = await walk(root)
  const known = new Set<string>()
  for (const f of files) {
    const rel = path.relative(root, f)
    known.add(path.basename(f))
    known.add(path.basename(f, path.extname(f)))
    known.add(rel)
    known.add(rel.slice(0, rel.length - path.extname(rel).length))
  }
  const broken: string[] = []
  for (const f of files.filter((x) => x.endsWith('.md'))) {
    for (const m of maskCode(await readFile(f, 'utf8')).matchAll(WIKILINK)) {
      const t = targetOf(m[1])
      if (!known.has(t)) broken.push(`${path.relative(root, f)} → [[${t}]]`)
    }
  }
  return broken
}

/**
 * How many pages say, in their OWN frontmatter, that they belong to each of `topics` — the fact the
 * outline printed beside every row until YAZ-903 moved it onto the appended section and ⚡ YAZ-1152
 * deleted that section outright (the Topics tree keeps it). Read straight off the vault, so the
 * claim outlives every surface that has carried it.
 */
async function directMembers(root: string, topics: readonly string[]): Promise<string[]> {
  const counts = new Map(topics.map((t) => [t, 0]))
  for (const f of (await walk(root)).filter((x) => x.endsWith('.md'))) {
    const props = parseFrontmatter(splitFrontmatter(await readFile(f, 'utf8')).frontmatter).properties
    const entries = Array.isArray(props.folder_pages) ? props.folder_pages : []
    for (const topic of topics) {
      if (entries.some((e) => typeof e === 'string' && targetOf(e.replace(/^\[\[|\]\]$/g, '')) === topic)) {
        counts.set(topic, (counts.get(topic) ?? 0) + 1)
      }
    }
  }
  return topics.map((t) => String(counts.get(t) ?? 0))
}

/** Any note still carrying the retired type key. The migration's own post-check, re-asked here. */
async function withPageType(root: string): Promise<string[]> {
  const out: string[] = []
  for (const f of (await walk(root)).filter((x) => x.endsWith('.md'))) {
    if (/^page_type:/m.test(await readFile(f, 'utf8'))) out.push(path.relative(root, f))
  }
  return out
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'bible-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------- the scenario ----------

test('step 1 — the migrated encyclopedia opens on Home, holding exactly its topics, with nothing left over', async () => {
  // The fixture itself is sound before anything runs: the migration took every `page_type` with it
  // and left not one dangling wiki link behind — settings targets and `folder_pages` entries included.
  expect(await withPageType(vault)).toEqual([])
  expect(await brokenLinks(vault)).toEqual([])

  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, HOME)) })
  win = await appWindow(app, 'w1')
  // A launch is collapsed since YAZ-1642: open the six disk folders once for every step that
  // clicks a member.
  await expandDirs(win, FOLDERS.map((f) => path.join(vault, f)))

  // The map of an encyclopedia that maintains no list: the five folder pages say in their OWN
  // frontmatter that they belong to Home, and NOTHING on Home's side says it back.
  await expect(contents(win)).toBeVisible()
  await expect(viewTabs(contents(win))).toHaveText(['Outline', 'Table', 'Board'])
  // ⚡ YAZ-919: what the outline DOCUMENT holds is Home's own body, migrated in on the first open
  // — so the page's prose is on screen and its file is frontmatter-only. ⚡ YAZ-1152: that prose
  // names none of the five members, so ADOPTION writes all five into it, right there under the
  // body, before anybody has typed a key. One surface, and it is the document.
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...HOME_BODY, ...asLinks(...TOPICS)])
  expect((await read(HOME)).trimEnd().endsWith('---')).toBe(true)
  // …and `order` RETIRED in that same write: adoption's commit travels the outline's one door, so
  // it is the first EDIT the lazy migration was waiting for. Nobody reads [D5] here again.
  expect(await read(HOME)).not.toContain('order:')

  // THE WHOLE MIGRATED MAP, on one line — the DIRECT-member count per topic. ⚡ YAZ-1152 took the
  // counts off this surface with the rows that carried them (inside the document a folder-page
  // link is a plain wikilink, the locked scoping decision), so the claim is re-asked where they
  // still live: the Topics tree. Confirmed independently against the vault: 17 pages, five topics.
  await lensTab(win, 'Topics').click()
  for (const [i, topic] of TOPICS.entries()) await expect(topicRow(win, topic).locator('.tree__count')).toHaveText(TOPIC_COUNTS[i])
  expect(await directMembers(vault, TOPICS)).toEqual(TOPIC_COUNTS)
  await lensTab(win, 'Files').click() // back to the lens the rest of this file navigates by

  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(dataRows(contents(win))).toHaveCount(TOPICS.length)
  await expect(rowNames(contents(win))).toHaveText(TOPICS)
  await shoot(win, 'bible-01-home-topics')
})

test('step 2 — a MIGRATED column, edited inline: written to the member’s own file, surgically', async () => {
  await fileRow(win, KPIS).click()
  await expect(activeTab(win)).toHaveText(KPIS)
  // Its own body as the document (⚡ YAZ-919), its five members adopted into it below (⚡ YAZ-1152).
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...KPIS_BODY, ...asLinks(...KPI_MEMBERS)])
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  // Column 1 is `kpi_category`, declared `text` by `KPIs.md` — a column the MIGRATION wrote, out
  // of the `types.json` the same run deleted. Row 1 is Gross Margin, whose own body argues it is
  // not a funnel lagging indicator at all.
  // The CELL owns mouse activation since YAZ-1030 (its display button is `pointer-events: none`),
  // so the door in is a deliberate double-click — `folderPageColumns.spec.ts` step 3's idiom.
  await cell(contents(win), 1, 1).dblclick()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue(CATEGORY_WAS)
  await shoot(win, 'bible-02-migrated-cell-edit')
  await input.fill(CATEGORY_NOW)
  await win.keyboard.press('Enter')

  // The write lands in the MEMBER's frontmatter, surgically — every other key the migration left
  // there, its belonging and the whole body survive.
  const grossMargin = path.join(vault, GROSS_MARGIN)
  await expect.poll(() => readFile(grossMargin, 'utf8'), { timeout: 10_000 }).toContain(`kpi_category: ${CATEGORY_NOW}`)
  const after = await readFile(grossMargin, 'utf8')
  expect(after).toContain('unit: percent')
  expect(after).toContain('[[KPIs]]') // the belonging is untouched
  expect(after).toContain('# Gross Margin')
  expect(after).not.toContain('page_type')
  await shoot(win, 'bible-02b-migrated-cell-written')
})

test('step 3 — navigating the encyclopedia: click → current tab, ⌘-click → background tab', async () => {
  await fileRow(win, 'Sales-Conversion').click()
  await expect(activeTab(win)).toHaveText('Sales-Conversion')
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await expect(tabsOf(win)).toHaveCount(1)

  await linkIn(win, 'CRM Hygiene').click()
  await expect(activeTab(win)).toHaveText('CRM Hygiene')
  await expect(editorOf(win)).toContainText('The parent SKU')
  await expect(tabsOf(win)).toHaveCount(1) // the funnel page's slot, not a new tab

  await fileRow(win, 'Sales-Conversion').click()
  await expect(editorOf(win)).toContainText('Open pipeline through to closed-won')
  await linkIn(win, 'Win Rate').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Sales-Conversion', 'Win Rate'])
  await expect(activeTab(win)).toHaveText('Sales-Conversion') // background: activation never moves
  await shoot(win, 'bible-03-wikilink-navigation')
})

test('step 4 — the backlinks panel finds the whole mention set, problems included', async () => {
  // Who the problems ARE is the folder page's own answer, not this file's: the four pages that
  // say they belong to `[[Problems]]`, read straight off the block — adopted (⚡ YAZ-1152) into
  // the document under the page's own migrated body (⚡ YAZ-919), which names none of them.
  await fileRow(win, 'Problems').click()
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...PROBLEMS_BODY, ...asLinks(...PROBLEMS)])

  await tabsOf(win).filter({ hasText: 'Win Rate' }).click()
  await expect(activeTab(win)).toHaveText('Win Rate')
  await expect(editorOf(win)).toContainText('Closed-won as a share of closed pipeline')

  // Four notes mention Win Rate: the two problems that name it ONLY in their `kpis_impacted`
  // relation property — frontmatter links are first-class to the index — plus the funnel page
  // and the owning role, via body prose. Path-sorted.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // Convergence: the mentions that BELONG TO `[[Problems]]` are exactly the two problems whose
  // relations point at this KPI — prose, relations and belonging answering the same question.
  const mentions = await backlinkNotes(win).allTextContents()
  expect(mentions.filter((n) => PROBLEMS.includes(n)).sort()).toEqual(['CRM Hygiene', 'Stage Accuracy'])
  await shoot(win, 'bible-04-backlinks-agree')
})

test('step 5 — renaming an entity page: relations, body links, backlinks and its belonging survive', async () => {
  await fileRow(win, 'Win Rate').click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue('Win Rate')
  await win.locator('.create-inline__input').fill(RENAMED)
  await win.keyboard.press('Enter')
  // The name-change confirm (⚡ YAZ-888), whose count is the notes the rewrite touches — FIVE
  // since ⚡ YAZ-1152: the four that spell the name in prose and relations, plus `KPIs.md`, whose
  // outline document names it because adoption wrote the line there (step 2 watched it happen).
  await confirmRename(win, `Rename 'Win Rate' to '${RENAMED}'? Links in 5 notes will be updated.`)

  // Five referencing notes: two through frontmatter relations, two through body prose, one
  // through the link line inside its own `folder_page_settings`.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 5 notes')
  await expect(activeTab(win)).toHaveText(RENAMED)

  const crmHygiene = path.join('problems', 'CRM Hygiene.md')
  // relation properties (whole-value links inside a list) …
  await expect.poll(() => read(crmHygiene)).toContain(`[[${RENAMED}]]`)
  expect(await read(crmHygiene)).toContain('[[Sales Cycle Time]]') // the sibling relation is untouched
  await expect.poll(() => read(path.join('problems', 'Stage Accuracy.md'))).toContain(`[[${RENAMED}]]`)
  // … and body links, including a note that was never opened in this run.
  await expect.poll(() => read(path.join('roles', 'Head of Sales.md'))).toContain(`[[${RENAMED}]]`)
  await expect.poll(() => read(FUNNEL)).toContain(`[[${RENAMED}]]`)

  // The backlinks panel still finds the same FOUR notes on the renamed page — and the honest gap
  // between the two counts is the point: the rewrite walks `folder_page_settings` (YAZ-864), the
  // INDEX does not extract links from it, so KPIs' adopted line is renamed without ever becoming
  // a mention. A membership is not a mention.
  await expect(backlinksHeader(win)).toHaveText('Linked mentions (4)')
  await expandBacklinks(win)
  await expect(backlinkNotes(win)).toHaveText(['Sales-Conversion', 'CRM Hygiene', 'Stage Accuracy', 'Head of Sales'])

  // And it still belongs where it belonged: the entry lives on the MEMBER and names the topic, so
  // renaming the member is nothing the topic has to be told about.
  await fileRow(win, RENAMED).click()
  expect(await read(path.join('kpis', `${RENAMED}.md`))).toContain('[[KPIs]]')
  await fileRow(win, KPIS).click()
  // ⚡ YAZ-1152: `KPIs.md`'s membership is LINES of its document now (adopted in step 2), so the
  // rename had to walk INSIDE `folder_page_settings` to keep them honest — and it did, in place:
  // the renamed page is still the fifth line, where adoption first wrote it, under its new name.
  // A rename rewrites the link where it stands; it does not re-sort a document, and it does not
  // touch a word of the prose above.
  await expect
    .poll(() => outlineLines(contents(win)).allTextContents())
    .toEqual([...KPIS_BODY, ...asLinks('CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', RENAMED)])

  // The durable result: not one dangling wiki link anywhere in the vault.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-05-rename-survived')
  await quitApp(app)
})

test('step 6 — renaming a FOLDER PAGE: the links INSIDE folder_page_settings follow too (YAZ-864)', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, HOME)) })
  win = await appWindow(app, 'w1')
  // Home's document is what step 1 left: the body YAZ-919 migrated (the file is frontmatter-only
  // now, so there is nothing left to move and it moves nothing) plus the five members adoption
  // wrote in. Read back off the page — and adoption, finding every member already named, is quiet.
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...HOME_BODY, ...asLinks(...TOPICS)])

  await fileRow(win, ROLES).click({ button: 'right' })
  await win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(win.locator('.create-inline__input')).toHaveValue(ROLES)
  await win.locator('.create-inline__input').fill(ROLES_RENAMED)
  await win.keyboard.press('Enter')
  // The confirm's count sees what the rewrite sees — settings-only references included (YAZ-864).
  await confirmRename(win, `Rename '${ROLES}' to '${ROLES_RENAMED}'? Links in 6 notes will be updated.`)

  // SIX notes: the three members through their own top-level `folder_pages` — the half that already
  // worked — plus the three folder pages that name Roles ONLY from inside `folder_page_settings`,
  // which the index never extracted as links and the rewrite therefore used to walk straight past.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 6 notes')

  // Home's outline DOCUMENT — the line adoption wrote, rewritten in place. (Before ⚡ YAZ-1152 the
  // reference this step caught lived in the [D5] `order` list, which adoption's first write
  // retired; the link moved into the document and the rewrite followed it there.) …
  await expect.poll(() => read(HOME)).toContain(`- [[${ROLES_RENAMED}]]`)
  expect(await read(HOME)).toContain('- [[KPIs]]') // its siblings, untouched
  // … a column `target` on ANOTHER folder page, its column's other keys intact …
  await expect.poll(() => read('Problems.md')).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  const problems = await read('Problems.md')
  expect(problems).toContain('target: "[[KPIs]]"')
  expect(problems).toContain('required: true')
  expect(problems).toContain('folder: problems')
  // … the renamed page's OWN self-target, written at its new path, `folder` and belonging intact …
  const renamedPage = await read(`${ROLES_RENAMED}.md`)
  expect(renamedPage).toContain(`target: "[[${ROLES_RENAMED}]]"`)
  expect(renamedPage).toContain('folder: roles')
  expect(renamedPage).toContain('- "[[Home]]"')
  // … and the members' plain `folder_pages`, which is the behaviour that already worked.
  for (const member of ROLE_MEMBERS) {
    await expect.poll(() => read(path.join('roles', `${member}.md`))).toContain(`- "[[${ROLES_RENAMED}]]"`)
  }

  // And everything still browses. The renamed page opens for the FIRST time here, so this is also
  // where its body migrates (⚡ YAZ-919) — out of the file the rename just moved, into the
  // settings the rename just rewrote, with both writes intact afterwards. The prose still says
  // "Roles", because prose is prose: a rename walks the CARD and never edits a word of the text.
  // Its three members, untouched by any of it, are adopted into the document under that prose.
  await fileRow(win, ROLES_RENAMED).click()
  await expect(activeTab(win)).toHaveText(ROLES_RENAMED)
  await expect.poll(() => outlineLines(contents(win)).allTextContents()).toEqual([...ROLES_BODY, ...asLinks(...ROLE_MEMBERS)])
  expect(await read(`${ROLES_RENAMED}.md`)).toContain('folder: roles') // the rename's own write survived the migration's
  expect(await directMembers(vault, TOPICS_AFTER)).toEqual(TOPIC_COUNTS)

  // The durable result again, with the settings targets now inside the audit's reach.
  await expect.poll(() => brokenLinks(vault)).toEqual([])
  await shoot(win, 'bible-06-folder-page-rename')
  await quitApp(app)
})
