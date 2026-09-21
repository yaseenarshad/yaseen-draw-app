/**
 * Search E (YAZ-805): the ⌘K search feature driven end-to-end through the REAL app — the
 * persistent sidebar bar (YAZ-801), the flat ranked result list that replaces the tree
 * (YAZ-803) and the title/alias ranking behind it (YAZ-802), over a COPY of the committed
 * encyclopedia fixture (`fixtures/bible-vault`) plus ONE seeded note that makes the ranking
 * and the alias row deterministic.
 *
 * That seeded note is `Nurture.md` at the vault root, aliased `Zephyr Codename`. It turns the
 * query "Nurture" into one row of each rank bucket — exact `Nurture`, prefix `Nurture
 * Sequencing`, substring `Lead Nurture` — which is the only way this fixture can PROVE the
 * exact-first ordering, and it gives the keyboard steps their three rows.
 *
 * The ⌘K accelerator itself is NOT driven here: a native menu accelerator cannot be fired from
 * Playwright (`keyboard.press('Meta+K')` silently does nothing), so the shortcut is pinned by
 * `desktop/src/main/menu.test.ts` and a recorded human check on YAZ-804. Everything below is
 * the DOM the accelerator lands on.
 *
 * Serial by design (the suite's idiom): each step continues the previous state, and every step
 * starts from `closeAllTabs` + an empty query so the one before it cannot colour it.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia — copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')

/** The seeded note (see the module doc): the exact hit for "Nurture", and the ONE alias in the vault. */
const SEEDED = 'Nurture.md'
const SEEDED_BODY = 'search-seeded-nurture-body'
const ALIAS = 'Zephyr Codename'

/** Bodies of the fixture pages the steps land on. */
const SEQUENCING_BODY = 'Contacts stall between'
const CEO_BODY = 'Signs off on anything'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the suite's shared idioms) ----------

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')

const treeRows = (w: Page) => w.locator('.tree__row')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
const dirRow = (w: Page, label: string) => w.locator('.tree__row--dir').filter({ hasText: new RegExp(`^${label}$`) })

const searchBar = (w: Page) => w.locator('[aria-label="Search notes"]')
const resultList = (w: Page) => w.locator('[aria-label="Search results"]')
const resultRows = (w: Page) => resultList(w).locator('[role="option"]')

/**
 * Every result row's aria-label, in list order — the assertion the ranking is really about.
 * Playwright's `hasText` cannot read aria-labels, so the rows are anchored by them throughout
 * (the feature was built with exactly this in mind).
 */
const rowLabels = (w: Page): Promise<(string | null)[]> =>
  resultRows(w).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

// ---------- gestures ----------

/**
 * Closes every open tab, leaving the empty state (the easyWave idiom), then empties the query.
 * Always the ACTIVE tab's ✕: an inactive tab only reveals its close button on hover (tabs.css).
 */
async function reset(w: Page): Promise<void> {
  for (;;) {
    const n = await tabsOf(w).count()
    if (n === 0) break
    await w.locator('.tabbar__tab--active .tabbar__close').click()
    await expect(tabsOf(w)).toHaveCount(n - 1)
  }
  await expect(w.locator('.editor-msg')).toHaveText('Select a file from the sidebar.')
  await searchBar(w).fill('')
  await expect(treeRows(w).first()).toBeVisible()
}

/**
 * Types `query` into the bar and waits for the rows it must rank, in order.
 *
 * The fill lives INSIDE the retry: the bar is a controlled input, so a value set while React is
 * re-rendering it can be swallowed — the bar ends up empty and no rows ever arrive (seen under
 * full-suite load once YAZ-847 grew the suite by a spec). Re-filling the same query is a no-op
 * when it did land, so a healthy run still settles on the first attempt.
 */
async function search(w: Page, query: string, labels: readonly string[]): Promise<void> {
  const want = labels.map((l) => `Search result ${l}`)
  await expect(async () => {
    await searchBar(w).fill(query)
    expect(await rowLabels(w)).toEqual(want)
  }).toPass({ timeout: 15_000 })
}

/** The selected row: `aria-selected` and the active class are ONE state — assert them together. */
async function expectSelected(w: Page, index: number): Promise<void> {
  await expect(resultRows(w).nth(index)).toHaveAttribute('aria-selected', 'true')
  await expect(resultRows(w).nth(index)).toHaveClass(/search-results__row--active/)
  await expect(resultList(w).locator('[aria-selected="true"]')).toHaveCount(1)
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'search-userdata-'))
  vault = await copyVault(FIXTURE)
  // Seeded BEFORE launch, so the first index scan already carries the alias.
  await writeFile(
    path.join(vault, SEEDED),
    `---\naliases: ["${ALIAS}"]\n---\n\n# Nurture\n\n${SEEDED_BODY}\n`,
  )
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- YAZ-802 / 803: rank and open

test('step 1 — a typed title replaces the tree with a ranked list; Enter opens the top row in the CURRENT tab', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'roles', 'CEO.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(CEO_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  await expect(searchBar(win)).toBeVisible() // persistent: there before anyone asked for it
  await expect(treeRows(win).first()).toBeVisible() // …with the tree below it, as usual

  // Exact → prefix → substring, the shared `[[` matcher's ranking (YAZ-802).
  await search(win, 'Nurture', ['Nurture', 'Nurture Sequencing', 'Lead Nurture'])
  await expect(treeRows(win)).toHaveCount(0) // the list REPLACES the tree while a query is typed
  await expectSelected(win, 0)
  await shoot(win, 'search-01-ranked-list')

  // Enter opens the selection in the CURRENT tab: still ONE tab, now the seeded note.
  await searchBar(win).press('Enter')
  await expect(activeTab(win)).toHaveText('Nurture')
  await expect(editorOf(win)).toContainText(SEEDED_BODY)
  await expect(tabsOf(win)).toHaveCount(1)
  // Opening does not dismiss the list — the query is still typed, so the rows are still there.
  await expect.poll(() => rowLabels(win)).toEqual(['Search result Nurture', 'Search result Nurture Sequencing', 'Search result Lead Nurture'])
})

test('step 2 — a frontmatter alias is its own row, labelled "Alias — Basename", and opens the note', async () => {
  await reset(win)
  // Nothing in the vault is CALLED Zephyr: the only way to this row is through the alias.
  await search(win, 'Zephyr', [`${ALIAS} — Nurture`])
  await shoot(win, 'search-02-alias-row')

  await resultRows(win).first().click()
  await expect(activeTab(win)).toHaveText('Nurture')
  await expect(editorOf(win)).toContainText(SEEDED_BODY)
  await expect.poll(() => decodeURI(win.url())).toContain(SEEDED)
})

test('step 3 — ⌘-click on a row opens a BACKGROUND tab; the active tab never moves', async () => {
  await reset(win)
  await fileRow(win, 'CEO').click() // an active tab to leave alone
  await expect(activeTab(win)).toHaveText('CEO')

  await search(win, 'Nurture', ['Nurture', 'Nurture Sequencing', 'Lead Nurture'])
  await resultRows(win).nth(1).click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['CEO', 'Nurture Sequencing'])
  await expect(activeTab(win)).toHaveText('CEO')
  await expect(editorOf(win)).toContainText(CEO_BODY)

  // Activating it later is the ordinary tab gesture — the background tab is a real one.
  await tabsOf(win).filter({ hasText: 'Nurture Sequencing' }).click()
  await expect(editorOf(win)).toContainText(SEQUENCING_BODY)
})

test('step 4 — ArrowDown / ArrowUp walk the rows from the input, clamped at BOTH ends', async () => {
  await reset(win)
  await search(win, 'Nurture', ['Nurture', 'Nurture Sequencing', 'Lead Nurture'])
  await expectSelected(win, 0)

  // At the top: ArrowUp holds, it never wraps to the bottom (the `[[` picker's rule).
  await searchBar(win).press('ArrowUp')
  await expectSelected(win, 0)

  await searchBar(win).press('ArrowDown')
  await searchBar(win).press('ArrowDown')
  await expectSelected(win, 2)

  // At the bottom: ArrowDown holds too.
  await searchBar(win).press('ArrowDown')
  await expectSelected(win, 2)

  // The keyboard's selection is what Enter opens.
  await searchBar(win).press('Enter')
  await expect(activeTab(win)).toHaveText('Lead Nurture')
})

// ---------------------------------------------------------------- YAZ-803: the tree is waiting

test('step 5 — Esc on a typed query brings the tree back, with the expansion it had', async () => {
  await reset(win)
  await dirRow(win, 'industries').click()
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()

  await search(win, 'Nurture', ['Nurture', 'Nurture Sequencing', 'Lead Nurture'])
  await expect(treeRows(win)).toHaveCount(0)

  // Esc with text EMPTIES the query (it only gives up focus on a second press) — and the tree
  // comes back untouched: the swap is a conditional render, never a teardown.
  await searchBar(win).press('Escape')
  await expect(searchBar(win)).toHaveValue('')
  await expect(resultList(win)).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()
})

test('step 6 — a query nothing answers to shows "No matches"; clearing it restores the tree', async () => {
  await reset(win)
  await searchBar(win).fill('zzqqxvw')
  await expect(win.locator('p.sidebar__msg')).toHaveText('No matches')
  await expect(resultList(win)).toHaveCount(0)
  await expect(treeRows(win)).toHaveCount(0)
  await shoot(win, 'search-06-no-matches')

  await searchBar(win).fill('')
  await expect(win.locator('p.sidebar__msg')).toHaveCount(0)
  await expect(fileRow(win, 'PLG SaaS')).toBeVisible()
  await quitApp(app)
})
