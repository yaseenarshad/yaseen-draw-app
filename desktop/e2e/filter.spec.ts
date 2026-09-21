/**
 * THE FILTER, end to end (YAZ-1234; the model is YAZ-1224, the menu YAZ-1226-1232, the new-note
 * seed YAZ-1236).
 *
 * The unit suites already pin the rule ↔ expression grammar, the menu's writes and the engine's
 * narrowing. What they cannot show is the thing the feature was asked for: a REAL folder page,
 * whose `filters` is a block written on disk, narrowing a real table in the real app — surviving a
 * quit, composing with search, re-bucketing a two-level board, deleting its own key when it is
 * emptied, and seeding the note the toolbar's New button births.
 *
 * The fixture is `nested-vault`'s AUTOMATIONS page, the same one `nestedGroups.spec.ts` drives:
 * four members over two departments, where `status` splits them 3/1 — three `Live`, one `Draft`.
 * That one split is what every step below is built on. It is a STRICT subset (a filter that keeps
 * everything proves nothing), it takes out the whole `Review` process (so a group left with no rows
 * has to disappear, on the table AND on the board), and `Shift handover` is the only member holding
 * it, so nothing else moves when it goes.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 the Filter button opens on "No filters", one built rule narrows the table to the three Live
 *     rows, the emptied `Review` section is gone, and the button wears the badge
 *   2 the rule is DURABLE: the `filters:` block stands under `folder_page_settings` on disk, and
 *     quit → relaunch comes back to the same filtered view
 *   3 search composes on top: both narrow, and clearing the box restores the FILTERED set
 *   4 the board buckets POST-filter — the same subset, one column short of a subgroup
 *   5 removing the rules restores every view and DELETES the key from the card (empty → no key)
 *   6 the seed (YAZ-1236): with an equality filter active, "New" births a note that satisfies it
 *     and walks straight into the filtered view
 *
 * ONE DEVIATION worth naming: a filter narrows `total` ITSELF — it runs before the count is taken —
 * so the count reads `3 items` under a filter, never `3 / 4 items`. The `shown / total` form belongs
 * to search and limit, which reduce what is SHOWN of that total, and step 3 asserts it in exactly
 * that position: on top of the filter, which is the honest proof that the filter sits upstream.
 *
 * Same harness as nestedGroups.spec.ts (temp `--user-data-dir`, a COPY of the committed fixture,
 * `filter-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed two-level fixture. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'nested-vault')
const AUTOMATIONS = 'Automations.md'
/** The table view names the fixture writes; the board it declares last is simply `Board`. */
const NESTED_VIEW = 'Dept then process'
const FLAT_VIEW = 'Dept only'
/**
 * The four members in the nested table's own READING order (grouped `dept` then `proc`, which is
 * not alphabetical), and the three the fixture marks `status: Live` — `Shift handover` is the
 * `Draft` one, and the only member of the `Review` process. Spelled as the name cell shows them:
 * the page TITLE, never `.md` (YAZ-1513).
 */
const ALL = ['Invoice sync', 'Ops dashboard', 'Ticket triage', 'Shift handover']
const LIVE = ['Invoice sync', 'Ops dashboard', 'Ticket triage']
/** The toolbar's New names nothing, so the newborn takes the `Untitled` scheme's first free name. */
const NEWBORN = 'Untitled'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const rowNames = (w: Page) => contents(w).locator('.view-table__link')
const count = (w: Page) => contents(w).locator('.view-toolbar__count')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** The toolbar's Filter button and its badge — the popover it opens carries the same label, hence `button`. */
const filterBtn = (w: Page) => contents(w).locator('button[aria-label="Filter"]')
const badge = (w: Page) => filterBtn(w).locator('.view-toolbar__badge')
const menu = (w: Page) => w.locator('.view-popover[aria-label="Filter"]')
const field = (w: Page, label: string) => menu(w).locator(`[aria-label="${label}"]`)

/** The table body as one script, exactly as nestedGroups.spec.ts reads it: `# value (count)`, inner ones indented, `- name`. */
const tableScript = (w: Page): Promise<string[]> =>
  contents(w)
    .locator('.view-table tbody')
    .evaluate((tbody) =>
      Array.from(tbody.querySelectorAll('tr')).flatMap((tr) => {
        if (tr.classList.contains('view-table__spacer')) return [] // windowing padding, not content
        const cell = tr.querySelector('.view-table__group-cell')
        if (cell === null) return [`- ${tr.querySelector('.view-table__link')?.textContent ?? '?'}`]
        const indent = cell.classList.contains('view-table__group-cell--nested') ? '  ' : ''
        return [`${indent}# ${cell.querySelector('.view-group__value')?.textContent ?? ''} (${cell.querySelector('.view-group__count')?.textContent ?? ''})`]
      }),
    )

/** The board hierarchy in reading order: one outer column, its direct cards, then its child sections. */
const boardScript = (w: Page): Promise<string[]> =>
  contents(w)
    .locator('.view-board')
    .evaluate((board) =>
      Array.from(board.querySelectorAll<HTMLElement>(':scope > .view-board__col')).flatMap((col) => {
        const outer = col.querySelector(':scope > .view-board__col-header > .view-group')
        const lines = [`# ${outer?.querySelector('.view-group__value')?.textContent ?? ''} (${outer?.querySelector('.view-group__count')?.textContent ?? ''})`]
        for (const card of Array.from(col.querySelectorAll(':scope > .view-board__cards > .view-board__card'))) {
          lines.push(`- ${card.querySelector('.view-board__title')?.textContent ?? '?'}`)
        }
        for (const section of Array.from(col.querySelectorAll<HTMLElement>(':scope > .view-board__subgroups > .view-board__subgroup'))) {
          const header = section.querySelector(':scope > .view-group')
          lines.push(`  # ${header?.querySelector('.view-group__value')?.textContent ?? ''} (${header?.querySelector('.view-group__count')?.textContent ?? ''})`)
          for (const card of Array.from(section.querySelectorAll(':scope > .view-board__cards > .view-board__card'))) {
            lines.push(`  - ${card.querySelector('.view-board__title')?.textContent ?? '?'}`)
          }
        }
        return lines
      }),
    )

/**
 * The rule's Property is the shared `ColumnPicker` (YAZ-1466): a button wearing the label that
 * opens a searchable listbox, each option carrying its canonical key as `data-value`.
 */
async function pickProperty(w: Page, key: string): Promise<void> {
  await field(w, 'Property').click()
  await menu(w).locator(`[role="option"][data-value="${key}"]`).click()
}

/**
 * The builder's whole gesture on the ACTIVE view: Add rule, then property · operator · value, each
 * its own write, fired at Playwright speed. The pace is deliberate (YAZ-1241): a stale write echo
 * must never hand the menu an older row to edit, so nothing here waits out the index round-trip.
 */
async function addRule(w: Page, property: string, op: string, value: string): Promise<void> {
  await filterBtn(w).click()
  await menu(w).locator('.view-menu__action', { hasText: 'Add rule' }).click()
  await expect(badge(w)).toHaveText('1')
  await pickProperty(w, property)
  await field(w, 'Operator').selectOption(op)
  await field(w, 'Value').fill(value)
  await field(w, 'Value').press('Enter')
  await expect(field(w, 'Value')).toHaveValue(value)
  await filterBtn(w).click() // the trigger toggles its own popover shut
}

/** The inverse gesture: the row's own ×, which empties the group and therefore deletes the key. */
async function removeRule(w: Page): Promise<void> {
  await filterBtn(w).click()
  await menu(w).locator('[aria-label="Remove rule"]').click()
  await expect(menu(w).locator('.view-menu__empty')).toHaveText('No filters')
  await filterBtn(w).click()
}

/** The folder page's own card, sliced to what stands under its settings key. */
async function settingsOf(): Promise<string> {
  const card = await readFile(path.join(vault, AUTOMATIONS), 'utf8')
  return card.slice(card.indexOf('folder_page_settings:'))
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'filter-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — one built rule narrows the table to the matching rows, and the button wears the badge', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, AUTOMATIONS)) })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  // The fixture's own first view IS the two-level grouped table, so nothing has to be clicked.
  await expect(viewTabs(contents(win))).toHaveText([NESTED_VIEW, FLAT_VIEW, 'Board'])
  await expect.poll(() => rowNames(win).allTextContents(), { timeout: 15_000 }).toEqual(ALL)
  await expect(count(win)).toHaveText('4 items')
  await expect(badge(win)).toHaveCount(0) // an unfiltered view wears nothing

  // The menu opens EMPTY: a folder page's set is the lookup, and it has never been filtered.
  await filterBtn(win).click()
  await expect(menu(win).locator('.view-menu__empty')).toHaveText('No filters')
  await shoot(win, 'filter-01-menu-empty')
  await filterBtn(win).click()

  await addRule(win, 'note.status', 'is', 'Live')

  // The strict subset, in the grouped shape: `Shift handover` was the only `Review` process, so
  // that inner section is not empty — it is GONE. The engine buckets what the filter left it.
  await expect.poll(() => rowNames(win).allTextContents()).toEqual(LIVE)
  await expect.poll(() => tableScript(win)).toEqual([
    '# Finance (1)',
    '  # Intake (1)',
    '- Invoice sync',
    '# Ops (2)',
    '- Ops dashboard',
    '  # Intake (1)',
    '- Ticket triage',
  ])
  // A filter narrows the TOTAL, so the count is a plain three (see the deviation note above).
  await expect(count(win)).toHaveText('3 items')
  await expect(badge(win)).toHaveText('1')
  await shoot(win, 'filter-02-table-narrowed')
})

test('step 2 — the rule stands in the page’s frontmatter and survives quit → relaunch', async () => {
  // Durable, not cosmetic: the block is under the page's OWN settings, holding the expression the
  // builder writes for `is` — the same string `ruleToExpr` produces and `exprToRule` reads back.
  await expect.poll(() => settingsOf(), { timeout: 10_000 }).toContain('filters:')
  expect(await settingsOf()).toContain('note.status == "Live"')

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  await expect.poll(() => rowNames(win).allTextContents(), { timeout: 15_000 }).toEqual(LIVE)
  await expect(badge(win)).toHaveText('1')
  await expect(count(win)).toHaveText('3 items')
  await shoot(win, 'filter-03-survives-relaunch')
})

test('step 3 — search composes on top of the filter, and clearing it restores the FILTERED set', async () => {
  await contents(win).locator('[aria-label="Search"]').click()
  const box = contents(win).locator('[aria-label="Search rows"]')
  await box.fill('Ticket')

  // Both narrow, and here the `shown / total` form finally appears: search reduces what is SHOWN
  // of the three the filter left — never of the four the folder holds.
  await expect(rowNames(win)).toHaveText(['Ticket triage'])
  await expect(count(win)).toHaveText('1 / 3 items')
  await shoot(win, 'filter-04-search-composed')

  // And a search for the row the FILTER removed finds nothing: search cannot reach past it.
  // (`handover`, not `Shift` — search reads every column, and two Live rows carry a `Shift` trigger.)
  await box.fill('handover')
  await expect(rowNames(win)).toHaveCount(0)

  await box.fill('')
  await expect(rowNames(win)).toHaveText(LIVE)
  await expect(count(win)).toHaveText('3 items')
  await contents(win).locator('[aria-label="Search"]').click() // close the box; the filter stays
  await expect(badge(win)).toHaveText('1')
})

test('step 4 — the board buckets POST-filter: the subgroup whose cards all went is gone', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Board' }).evaluate((button) => (button as HTMLButtonElement).click())
  // Filters are PER VIEW (D1), so the board opens on all four cards — the table's rule is not its.
  await expect.poll(() => boardScript(win), { timeout: 15_000 }).toEqual([
    '# Finance (1)',
    '  # Intake (1)',
    '  - Invoice sync',
    '# Ops (3)',
    '- Ops dashboard',
    '  # Intake (1)',
    '  - Ticket triage',
    '  # Review (1)',
    '  - Shift handover',
  ])
  await expect(badge(win)).toHaveCount(0)

  await addRule(win, 'note.status', 'is', 'Live')

  // The same subset, one column short of a subgroup: `Ops` keeps its direct card and its `Intake`
  // section, and `Review` — whose only card was the `Draft` one — does not exist any more.
  await expect.poll(() => boardScript(win)).toEqual([
    '# Finance (1)',
    '  # Intake (1)',
    '  - Invoice sync',
    '# Ops (2)',
    '- Ops dashboard',
    '  # Intake (1)',
    '  - Ticket triage',
  ])
  await expect(badge(win)).toHaveText('1')
  await shoot(win, 'filter-05-board-narrowed')
})

test('step 5 — removing the rules restores every view and deletes the key from the card', async () => {
  await removeRule(win)
  await expect.poll(() => boardScript(win)).toEqual([
    '# Finance (1)',
    '  # Intake (1)',
    '  - Invoice sync',
    '# Ops (3)',
    '- Ops dashboard',
    '  # Intake (1)',
    '  - Ticket triage',
    '  # Review (1)',
    '  - Shift handover',
  ])

  await viewTabs(contents(win)).filter({ hasText: NESTED_VIEW }).evaluate((button) => (button as HTMLButtonElement).click())
  await removeRule(win)
  await expect.poll(() => rowNames(win).allTextContents()).toEqual(ALL)
  await expect(count(win)).toHaveText('4 items')
  await expect(badge(win)).toHaveCount(0)

  // An emptied group is no group: the key is DELETED, never left behind as an empty `filters:`.
  await expect.poll(() => settingsOf(), { timeout: 10_000 }).not.toContain('filters:')
  await shoot(win, 'filter-06-cleared')
})

test('step 6 — "New" seeds the note from the active filter, and it lands in the filtered view', async () => {
  await addRule(win, 'note.status', 'is', 'Live')
  await expect.poll(() => rowNames(win).allTextContents()).toEqual(LIVE)

  await contents(win).locator('[aria-label="New note"]').click()

  // The equality rule IS the seed (YAZ-1236): the newborn carries the property the filter asks for,
  // on top of the declaration's empty columns and under the belonging that lands last.
  const created = path.join(vault, 'automations', `${NEWBORN}.md`)
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('status: Live')
  expect(await readFile(created, 'utf8')).toContain('[[Automations]]')
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'filter-07-new-seeded')

  // …so it walks straight into the view that made it, with nobody typing a thing. It groups under
  // "No value": `dept` and `proc` are not what the filter asked for, so the seed left them empty.
  await fileRow(win, 'Automations').click()
  await expect(contents(win)).toBeVisible()
  await expect.poll(() => rowNames(win).allTextContents(), { timeout: 15_000 }).toEqual([...LIVE, NEWBORN])
  await expect(count(win)).toHaveText('4 items')
  await expect(badge(win)).toHaveText('1')
  await shoot(win, 'filter-08-new-in-filtered-view')

  await quitApp(app)
})
