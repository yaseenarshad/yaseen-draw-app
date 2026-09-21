/**
 * TWO-LEVEL GROUPING, end to end (YAZ-1102; the engine is YAZ-1097/1098, the table YAZ-1100).
 *
 * The unit suites already pin the bucketing and the display list. What they cannot show is the
 * thing the feature was asked for: a REAL folder page, whose `groupBy` is a LIST written on disk,
 * rendering a real two-level table in the real app — and keeping what the user folded across a
 * quit. So this spec drives the two shapes the real vault actually has, on a fixture that is a
 * miniature of each:
 *
 *   PROBLEMS — the FORMULA case. Functions are pages (`1 Lead Gen`, its children `1.1 Cross` /
 *   `1.2 Paid`, and the childless `3 Sales`), each problem names ONE of them, and the outer level
 *   is a formula that climbs to the top function: `parent` when the function has one, the function
 *   itself when it does not. Which is what makes the merge rule visible — a `3 Sales` problem's
 *   inner value EQUALS its outer one, so it sits directly under the outer section with no inner
 *   header of its own, while the Lead Gen problems fan into two indented sections.
 *
 *   AUTOMATIONS — the PLAIN-COLUMN case, deliberately WIDE (eight columns): two departments, one
 *   process value shared across both, and a table that genuinely overflows horizontally. That is
 *   where the sticky contract has to hold PER LEVEL (YAZ-1043-46, applied twice by YAZ-1100): the
 *   nested indent rides the sticky `left` offset, so scrolling to the right edge must leave BOTH
 *   an outer and an inner label cluster on screen, still 28px apart.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 Problems renders two levels: outer sections in reading order, indented inner sections, and
 *     the merge rule's direct rows under `3 Sales`
 *   2 collapse folds a whole BRANCH, an inner collapse folds only its own rows, and both survive
 *     quit → relaunch in the main-owned `baseGroups` bucket — the inner one under an OUTER-SCOPED
 *     composite key, never in the page's own frontmatter
 *   3 Automations proves the same render over two plain columns, and the per-level sticky label
 *     while the eight-column table is scrolled to its right edge
 *   4 regression: a single-level `groupBy` — the LIST form with one entry, the shape that could
 *     have started nesting by accident — renders flat, with no nested cell anywhere
 *   5 the same plain-column hierarchy renders inside one Board column per outer value; both
 *     collapse scopes, named child creation, and an atomic cross-outer child drag work end to end
 *
 * Same harness as folderPages.spec.ts (temp `--user-data-dir`, a COPY of the committed fixture,
 * `nested-` step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed two-level fixture. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'nested-vault')
const PROBLEMS = 'Problems.md'
/** The view names the fixture writes — half of the `baseGroups` key. */
const PROBLEMS_VIEW = 'By function'
const NESTED_VIEW = 'Dept then process'
const FLAT_VIEW = 'Dept only'

/**
 * The unit separator `nestedGroupKeyOf` joins an inner key to its outer with — spelled as an
 * ESCAPE, never as a raw byte in this file, which is exactly how the encoding stays reviewable.
 */
const SEP = '\u001f'
/** `groupKeyOf` renders a link value with its brackets, so the persisted key carries them. */
const OUTER_KEY = 'v:[[1 Lead Gen]]'
const INNER_KEY = `v:[[1 Lead Gen]]${SEP}v:[[1.1 Cross]]`

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const wrap = (w: Page) => contents(w).locator('.view-table-wrap')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** One section header row, addressed by the value it SHOWS (which for a link is its target, bare). */
const groupRow = (w: Page, name: string) =>
  contents(w)
    .locator('.view-table__group')
    .filter({ has: w.locator('.view-group__value', { hasText: new RegExp(`^${name}$`) }) })
const nestedCells = (w: Page) => contents(w).locator('.view-table__group-cell--nested')
const boardCol = (w: Page, name: string) =>
  contents(w)
    .locator('.view-board__col')
    .filter({ has: w.locator('.view-board__col-header > .view-group .view-group__value', { hasText: new RegExp(`^${name}$`) }) })
const boardSubgroup = (w: Page, col: Locator, name: string) =>
  col
    .locator(':scope > .view-board__subgroups > .view-board__subgroup')
    .filter({ has: w.locator('.view-group__value', { hasText: new RegExp(`^${name}$`) }) })

/**
 * THE WHOLE TABLE BODY AS ONE SCRIPT, in DOM order — because two-level grouping is a statement
 * about ORDER and NESTING, and a list of names or a count could pass while both were wrong. A
 * section header reads `# <value> (<count>)`, an INNER one is indented two spaces (read off the
 * nested class, which is the renderer's own mark), and a data row reads `- <title>` — the page's
 * basename, which is what the name cell shows since YAZ-1513 (never `.md`).
 */
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

/** The Board hierarchy in reading order: one outer column, its direct cards, then child sections. */
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

/** A label cluster's box and the scroller's, in one read — what the sticky assertion compares. */
const clusterBox = async (w: Page, name: string) => {
  const box = await groupRow(w, name).locator('.view-group').boundingBox()
  if (box === null) throw new Error(`group label ${name} has no bounding box`)
  return box
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'nestedgroups-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — two levels render: outer sections in reading order, indented inner ones, merged direct rows', async () => {
  const state = seededState(vault, path.join(vault, PROBLEMS))
  state.windows[0].bounds.width = 900
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')

  await expect(contents(win)).toBeVisible()
  // The fixture's own first view IS the grouped table, so nothing has to be clicked to reach it.
  await expect(viewTabs(contents(win))).toHaveText([PROBLEMS_VIEW, 'Board'])

  // Reading order, both levels, in ONE assertion. `1 Lead Gen` leads and `3 Sales` closes because
  // the outer keys sort by their link target; the two Lead Gen sub-functions become INDENTED inner
  // sections; and the merge rule shows itself under `3 Sales` — its problems' inner value equals
  // its outer one, so they sit directly under the outer header with no inner header at all.
  await expect.poll(() => tableScript(win), { timeout: 15_000 }).toEqual([
    '# 1 Lead Gen (3)',
    '  # 1.1 Cross (2)',
    '- Attribution gap',
    '- Lead leakage',
    '  # 1.2 Paid (1)',
    '- Ad spend waste',
    '# 3 Sales (2)',
    '- Deal slippage',
    '- Quote turnaround',
  ])
  // The indent is the renderer's nested mark on the inner sections and ONLY them.
  await expect(nestedCells(win)).toHaveCount(2)
  await shoot(win, 'nested-01-problems-two-levels')
})

test('step 2 — collapsing folds a whole branch, an inner collapse folds only its rows, and both survive a relaunch', async () => {
  // An OUTER collapse takes its inner headers down with its rows: the branch, not the level.
  await groupRow(win, '1 Lead Gen').locator('.view-group__toggle').click()
  await expect.poll(() => tableScript(win)).toEqual([
    '# 1 Lead Gen (3)',
    '# 3 Sales (2)',
    '- Deal slippage',
    '- Quote turnaround',
  ])
  await shoot(win, 'nested-02-outer-collapsed')

  // Expanded again, and then the INNER one alone: its header stays, its two rows go, and its
  // sibling section and the whole `3 Sales` branch are untouched.
  await groupRow(win, '1 Lead Gen').locator('.view-group__toggle').click()
  await groupRow(win, '1.1 Cross').locator('.view-group__toggle').click()
  await expect.poll(() => tableScript(win)).toEqual([
    '# 1 Lead Gen (3)',
    '  # 1.1 Cross (2)',
    '  # 1.2 Paid (1)',
    '- Ad spend waste',
    '# 3 Sales (2)',
    '- Deal slippage',
    '- Quote turnaround',
  ])
  await shoot(win, 'nested-03-inner-collapsed')

  // Fold the outer over the top of it, so the state carries one key of each kind at once.
  await groupRow(win, '1 Lead Gen').locator('.view-group__toggle').click()

  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const problems = path.join(vault, PROBLEMS)
  const stored = (await readState(userData)).folders?.[vault]?.baseGroups ?? {}
  // ONE bucket, keyed by the folder page's own path and the VIEW's name…
  expect(Object.keys(stored)).toEqual([`${problems}::${PROBLEMS_VIEW}`])
  // …holding exactly the two keys: the outer's, and the inner's OUTER-SCOPED composite. Sorted
  // because the list is a set — what it holds is the contract, the append order is not.
  expect([...stored[`${problems}::${PROBLEMS_VIEW}`]].sort()).toEqual([OUTER_KEY, INNER_KEY].sort())
  // And never in the page's own card — collapsing must not be able to touch autosave (4C).
  expect(await readFile(problems, 'utf8')).not.toContain('baseGroups')

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()
  // The outer is still folded…
  await expect.poll(() => tableScript(win), { timeout: 15_000 }).toEqual([
    '# 1 Lead Gen (3)',
    '# 3 Sales (2)',
    '- Deal slippage',
    '- Quote turnaround',
  ])
  // …and the inner collapse it was hiding survived underneath it, which is the half a single
  // restored key could never show: expanding the branch brings back an ALREADY-folded `1.1 Cross`.
  await groupRow(win, '1 Lead Gen').locator('.view-group__toggle').click()
  await expect.poll(() => tableScript(win)).toEqual([
    '# 1 Lead Gen (3)',
    '  # 1.1 Cross (2)',
    '  # 1.2 Paid (1)',
    '- Ad spend waste',
    '# 3 Sales (2)',
    '- Deal slippage',
    '- Quote turnaround',
  ])
  await shoot(win, 'nested-04-collapse-restored')
})

test('step 3 — two plain columns, and a per-level sticky label at the table’s right edge', async () => {
  await fileRow(win, 'Automations').click()
  await expect(contents(win)).toBeVisible()
  await expect(viewTabs(contents(win))).toHaveText([NESTED_VIEW, FLAT_VIEW, 'Board'])

  // The same two-level shape with no formula in sight — `dept` then `proc`, both plain columns.
  // `Intake` appears under BOTH departments, which is why an inner key has to be outer-scoped.
  await expect.poll(() => tableScript(win), { timeout: 15_000 }).toEqual([
    '# Finance (1)',
    '  # Intake (1)',
    '- Invoice sync',
    '# Ops (3)',
    '- Ops dashboard',
    '  # Intake (1)',
    '- Ticket triage',
    '  # Review (1)',
    '- Shift handover',
  ])
  await shoot(win, 'nested-05-automations-two-levels')

  // The indent is a STICKY OFFSET, not cell padding (YAZ-1100 on YAZ-1043-46's mechanism): one
  // 28px step in from the outer's 8px. Padding would slide back onto 8px under a scroll.
  expect(
    await Promise.all(
      ['Ops', 'Review'].map((name) =>
        groupRow(win, name)
          .locator('.view-group')
          .evaluate((node) => ({ position: getComputedStyle(node).position, left: getComputedStyle(node).left })),
      ),
    ),
  ).toEqual([
    { position: 'sticky', left: '8px' },
    { position: 'sticky', left: '36px' },
  ])

  // Eight columns in a 900px window: the table really does overflow, so this is a real scroll.
  const scrolled = await wrap(win).evaluate((node) => {
    node.scrollLeft = node.scrollWidth
    return { scrollLeft: node.scrollLeft, overflow: node.scrollWidth - node.clientWidth }
  })
  expect(scrolled.overflow).toBeGreaterThan(0)
  expect(scrolled.scrollLeft).toBeGreaterThan(0)

  // At the right edge BOTH label clusters are still inside the scroller's own viewport — the
  // frozen-label contract, honoured per level — and still exactly one indent step apart.
  const view = await wrap(win).boundingBox()
  if (view === null) throw new Error('the table scroller has no bounding box')
  const outer = await clusterBox(win, 'Ops')
  const inner = await clusterBox(win, 'Review')
  for (const [name, box] of [
    ['Ops', outer],
    ['Review', inner],
  ] as const) {
    expect(box.x, `${name} starts inside the scroller`).toBeGreaterThanOrEqual(view.x - 1)
    expect(box.x + box.width, `${name} ends inside the scroller`).toBeLessThanOrEqual(view.x + view.width + 1)
  }
  expect(Math.round(inner.x - outer.x)).toBe(28)
  await shoot(win, 'nested-06-sticky-labels-scrolled')
})

test('step 4 — a single-level groupBy still renders flat, with no nested cell anywhere', async () => {
  await wrap(win).evaluate((node) => {
    node.scrollLeft = 0
  })
  // The LIST form with ONE entry — the shape a two-level reader could most easily have started
  // nesting by accident. One level in, one flat level out.
  await viewTabs(contents(win)).filter({ hasText: FLAT_VIEW }).click()

  await expect.poll(() => tableScript(win), { timeout: 15_000 }).toEqual([
    '# Finance (1)',
    '- Invoice sync',
    '# Ops (3)',
    '- Ops dashboard',
    '- Shift handover',
    '- Ticket triage',
  ])
  await expect(nestedCells(win)).toHaveCount(0)
  await shoot(win, 'nested-07-single-level-flat')
})

test('step 5 — nested Board layout, both collapse scopes, named child creation, and cross-outer drag', async () => {
  await viewTabs(contents(win)).filter({ hasText: 'Board' }).evaluate((button) => (button as HTMLButtonElement).click())
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

  const ops = boardCol(win, 'Ops')
  const intake = boardSubgroup(win, ops, 'Intake')
  await intake.locator(':scope > .view-group .view-group__toggle').click()
  await expect(intake.locator('.view-board__card')).toHaveCount(0)
  await expect(boardSubgroup(win, ops, 'Review').locator('.view-board__card', { hasText: 'Shift handover' })).toBeVisible()
  await ops.locator(':scope > .view-board__col-header .view-group__toggle').click()
  await expect(ops.locator(':scope > .view-board__subgroups')).toHaveCount(0)
  await ops.locator(':scope > .view-board__col-header .view-group__toggle').click()
  await expect(boardSubgroup(win, ops, 'Intake').locator('.view-board__card')).toHaveCount(0)
  await boardSubgroup(win, ops, 'Intake').locator(':scope > .view-group .view-group__toggle').click()

  const financeIntake = boardSubgroup(win, boardCol(win, 'Finance'), 'Intake')
  await financeIntake.locator('[aria-label="New card"]').click()
  const input = financeIntake.locator('[aria-label="New card name"]')
  await input.fill('Reconcile invoices')
  await input.press('Enter')
  const created = path.join(vault, 'automations', 'Reconcile invoices.md')
  await expect
    .poll(async () => {
      const text = await readFile(created, 'utf8').catch(() => '')
      return text.includes('dept: Finance') && text.includes('proc: Intake') && text.includes('[[Automations]]')
    })
    .toBe(true)
  const createdCard = financeIntake.locator('.view-board__card', { hasText: 'Reconcile invoices' })
  await expect(createdCard).toBeVisible()

  const opsReview = boardSubgroup(win, ops, 'Review')
  await createdCard.dragTo(opsReview)
  await expect(opsReview.locator('.view-board__card', { hasText: 'Reconcile invoices' })).toBeVisible()
  await expect
    .poll(async () => {
      const text = await readFile(created, 'utf8')
      return text.includes('dept: Ops') && text.includes('proc: Review')
    })
    .toBe(true)
  await shoot(win, 'nested-08-board-subgroups')

  await quitApp(app)
})
