/**
 * Declared columns, end to end (YAZ-898; the seams landed in YAZ-895/896/897): a folder page's
 * `folder_page_settings.columns` is the typing ladder's TOP rung (🔒 Q8), and the Properties menu
 * is the only door to it — "+ Add column" declares one and the per-key Type select retypes one,
 * each in a single `folder_page_settings` write.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`),
 * on `KPIs` — the folder page that already SHIPS three declarations (`funnel_stages` multi-link
 * with a target, `kpi_category`, `unit`), five members parked in `kpis/`, and a Table view whose
 * `order` names four columns. So every step below adds to a real declaration block rather than
 * creating one, which is what makes the merge-don't-replace half of each write visible.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 "+ Add column" declares `unit_notes` and SHOWS it, in one `folder_page_settings` write
 *     (🔒 D3): the header appears, the declaration lands on disk, the Table view's `order`
 *     gains `note.unit_notes`, and every direct member missing the key gets its empty scalar value
 *     while a legacy value under an existing declaration survives unchanged
 *   2 the Type select retypes it `text` → `number`: the DECLARATION moves and nothing else does —
 *     🔒 C1, proven by byte-equality over every member file after step 1's backfill
 *   3 the retyped column edits as a NUMBER, and the value lands on the member's own card on disk
 *   4 "New" births a member from the declaration, `unit_notes` scaffolded empty among the rest
 *   5 quit → relaunch: the column and its declaration are on the page, not in the session
 *   6 a name that is not a property name is refused inline, and NOTHING is written
 *
 * Same harness as folderPages.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `columns-`
 * step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, setFrontmatterProperty, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, copyVault, expandDirs, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'KPIs.md'
const KPIS = 'kpis'
/** Its members, in the order the table lists them (no `sort`, so the index order stands). */
const MEMBERS = ['CAC', 'Gross Margin', 'MQL Volume', 'Sales Cycle Time', 'Win Rate']
/** The column this spec declares, and the member whose cell it fills. */
const COLUMN = 'unit_notes'
/** …and the LABEL its header and its Properties row wear (YAZ-1513: sentence case, `_` → space). */
const COLUMN_LABEL = 'Unit notes'
/** The shipped Table's headers: the `#` gutter first, then every column by its label (YAZ-1513). */
const HEADERS = ['#', 'Name', 'Kpi category', 'Unit', 'Funnel stages']
const SUBJECT = 'CAC'
const RETAINED = 'Gross Margin'
const RETAINED_KEY = 'funnel_stages'
const RETAINED_VALUE = ['[[Legacy Stage]]']

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
/** Every member file before launch; includes RETAINED's seeded legacy declared value. */
let memberBytes: Record<string, string>
/** Every member file after missing-only backfill — step 2's no-migration baseline. */
let backfilledMemberBytes: Record<string, string>

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
const dataRows = (scope: Locator) => scope.locator('.view-table tbody tr:not(.view-table__group):not(.view-table__spacer)')
/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
const headers = (scope: Locator) => scope.locator('.view-table thead th')
/** `data-cell="row:col"` indexes DATA columns only — the `#` gutter carries none. */
const cell = (scope: Locator, r: number, c: number) => scope.locator(`[data-cell="${r}:${c}"]`)
/** The Properties popover — the ONE door to the declarations (YAZ-895). */
const propsMenu = (scope: Locator) => scope.locator('.view-popover')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

const memberPath = (name: string) => path.join(vault, KPIS, `${name}.md`)
const folderPagePath = () => path.join(vault, FOLDER_PAGE)

/** One declared column, as the frontmatter holds it. */
interface OnDiskColumn {
  kind?: string
  target?: string
}
interface OnDiskSettings {
  columns?: Record<string, OnDiskColumn>
  folder?: string
  views?: { type?: string; name?: string; order?: string[] }[]
}

/**
 * The folder page's `folder_page_settings` AS WRITTEN, read off disk. Parsed rather than
 * string-matched: the assertions below are about the SHAPE the one door wrote (which keys moved,
 * which survived), and a `toContain` would pass on a block that had lost half of it.
 */
async function settingsOnDisk(): Promise<OnDiskSettings> {
  const { frontmatter } = splitFrontmatter(await readFile(folderPagePath(), 'utf8'))
  return (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as OnDiskSettings
}

/** Every member file's full bytes, keyed by name — the before/after pair C1 is proven with. */
async function readMembers(): Promise<Record<string, string>> {
  const entries = await Promise.all(MEMBERS.map(async (name) => [name, await readFile(memberPath(name), 'utf8')] as const))
  return Object.fromEntries(entries)
}

/** Opens the Properties menu on the folder page's Table view; the outline is never offered one. */
async function openProperties(): Promise<Locator> {
  await contents(win).locator('[aria-label="Properties"]').click()
  const menu = propsMenu(contents(win))
  await expect(menu).toBeVisible()
  return menu
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'columns-userdata-'))
  vault = await copyVault(FIXTURE)
  const retained = memberPath(RETAINED)
  await writeFile(retained, setFrontmatterProperty(await readFile(retained, 'utf8'), RETAINED_KEY, RETAINED_VALUE), 'utf8')
  memberBytes = await readMembers()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — "+ Add column" declares a column and shows it, in one settings write', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, folderPagePath()) })
  win = await appWindow(app, 'w1')
  // A launch is collapsed since YAZ-1642: open the members' disk folder first.
  await expandDirs(win, [path.join(vault, KPIS)])

  await expect(contents(win)).toBeVisible()
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  // The shipped shape this step adds to: four columns from the view's `order` (each header its
  // LABEL, behind the `#` gutter — YAZ-1513), five members named by their titles.
  await expect(headers(contents(win))).toHaveText(HEADERS)
  await expect(rowNames(contents(win))).toHaveText(MEMBERS)
  // Opening a declaration with an already-present legacy value never normalises or rewrites it.
  await expect.poll(readMembers).toEqual(memberBytes)

  const menu = await openProperties()
  await menu.locator('.view-menu__action', { hasText: '+ Add column' }).click()
  await menu.locator('[aria-label="Column name"]').fill(COLUMN)
  // The kind is the definition editor's own type row (`PropertyDefinitionEditor`): a picker of the
  // registry's kinds, chosen here explicitly rather than left on its default.
  await menu.locator('[aria-label^="Property type:"]').click()
  await menu.locator('.property-def__type-list').getByRole('button', { name: 'Text', exact: true }).click()
  await expect(menu.locator('[aria-label="Property type: Text"]')).toBeVisible()
  await shoot(win, 'columns-01-add-column-form')
  await menu.locator('[aria-label="Save column"]').click()

  // The header is there as soon as the write comes back through the index — no reopen, no reload.
  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])
  await shoot(win, 'columns-02-column-header')

  // ONE write, asserted as its FINAL state (🔒 D3): the declaration AND the view's `order`, with
  // the three shipped declarations — `funnel_stages`' target included — exactly where they were.
  await expect.poll(async () => (await settingsOnDisk()).columns?.[COLUMN], { timeout: 10_000 }).toEqual({ kind: 'text' })
  const settings = await settingsOnDisk()
  expect(settings.columns).toEqual({
    funnel_stages: { kind: 'multi-link', target: '[[Funnel Stages]]' },
    kpi_category: { kind: 'text' },
    unit: { kind: 'text' },
    [COLUMN]: { kind: 'text' },
  })
  expect(settings.views?.find((v) => v.name === 'Table')?.order).toEqual([
    'file.name',
    'note.kpi_category',
    'note.unit',
    'note.funnel_stages',
    `note.${COLUMN}`,
  ])
  expect(settings.folder).toBe(KPIS) // the parking bin is not a column and never moves

  // YAZ-999: the settings write is source-of-truth and its index echo triggers a missing-only
  // reconciliation over DIRECT members.
  await expect
    .poll(async () => {
      const bytes = await readMembers()
      return Object.fromEntries(
        MEMBERS.map((name) => [name, parseFrontmatter(splitFrontmatter(bytes[name]!).frontmatter).properties[COLUMN]]),
      )
    })
    .toEqual(Object.fromEntries(MEMBERS.map((name) => [name, null])))

  backfilledMemberBytes = await readMembers()
  for (const name of MEMBERS) {
    const before = splitFrontmatter(memberBytes[name]!)
    const after = splitFrontmatter(backfilledMemberBytes[name]!)
    const beforeProps = parseFrontmatter(before.frontmatter).properties
    const afterProps = { ...parseFrontmatter(after.frontmatter).properties }
    delete afterProps[COLUMN]
    expect(afterProps).toEqual(beforeProps)
    expect(after.body).toBe(before.body)
  }
  expect(parseFrontmatter(splitFrontmatter(backfilledMemberBytes[RETAINED]!).frontmatter).properties[RETAINED_KEY]).toEqual(RETAINED_VALUE)
})

test('step 2 — retyping moves the DECLARATION and nothing else: every member file is byte-identical', async () => {
  // The per-key Type select (YAZ-897) lives one level down since YAZ-1513: the list row the
  // declaration made offerable opens the column's DETAIL panel, and the select sits there.
  const menu = propsMenu(contents(win))
  await menu.locator(`[aria-label="Open ${COLUMN_LABEL}"]`).click()
  const kind = menu.locator(`[aria-label="Edit property ${COLUMN_LABEL}"]`)
  await expect(kind).toHaveValue('text')
  await kind.selectOption('number')
  await expect.poll(async () => (await settingsOnDisk()).columns?.[COLUMN], { timeout: 10_000 }).toEqual({ kind: 'number' })
  // The select is CONTROLLED off the folder page's own card, so it only reads `number` once the
  // write has come back through the index — the honest signal that the new rung is live (step 3
  // types into it as a number, which is the same rung answering).
  await expect(kind).toHaveValue('number')
  await shoot(win, 'columns-03-retyped-number')

  // 🔒 C1 (locked): a retype never touches member files — no migration, no rewrite, not one byte.
  expect(await readMembers()).toEqual(backfilledMemberBytes)

  // `views` was not passed to this write, so the order it does not own is untouched.
  const settings = await settingsOnDisk()
  expect(settings.views?.find((v) => v.name === 'Table')?.order).toContain(`note.${COLUMN}`)
  expect(settings.columns?.kpi_category).toEqual({ kind: 'text' })
})

test('step 3 — the retyped column edits as a number, onto the MEMBER’s own file', async () => {
  // Back out of the detail panel, then close the Properties popover; the table is what edits now.
  await propsMenu(contents(win)).locator('[aria-label="Back to columns"]').click()
  await expect(propsMenu(contents(win)).locator(`[aria-label="Open ${COLUMN_LABEL}"]`)).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(propsMenu(contents(win))).toHaveCount(0)

  // Column 4 is the new one, row 0 is CAC (the row order asserted in step 1).
  // One click selects without editing; a deliberate double-click opens the editor.
  const target = cell(contents(win), 0, 4)
  await target.click()
  const input = win.locator('.view-cell-edit__input')
  await expect(input).toHaveCount(0)
  await target.dblclick()
  await expect(input).toBeVisible()
  await input.fill('42')
  await win.keyboard.press('Enter')

  const subject = memberPath(SUBJECT)
  await expect.poll(() => readFile(subject, 'utf8'), { timeout: 10_000 }).toContain(`${COLUMN}: 42`)
  const after = await readFile(subject, 'utf8')
  expect(after).toContain('folder_pages:') // the belonging is untouched
  expect(after).toContain('kpi_category: lagging') // and so is every other key
  expect(after).toContain(`# ${SUBJECT}`) // and the body
  // A number kind writes a NUMBER, not the string the input carried.
  const props = parseFrontmatter(splitFrontmatter(after).frontmatter).properties
  expect(props[COLUMN]).toBe(42)
  await shoot(win, 'columns-04-number-cell-write')

  // Only the edited member moved; the other four are still byte-identical to the backfilled state.
  const now = await readMembers()
  for (const name of MEMBERS.filter((n) => n !== SUBJECT)) expect(now[name]).toBe(backfilledMemberBytes[name])
})

test('step 4 — "New" births a member with the declared column scaffolded empty', async () => {
  await contents(win).locator('[aria-label="New note"]').click()

  // Parked in the settings' `folder`, every DECLARED column empty (scalars print Obsidian-style
  // `key:`, lists `[]`) and the belonging LAST (🔒 Q5).
  const created = path.join(vault, KPIS, 'Untitled.md')
  await expect.poll(() => readFile(created, 'utf8').catch(() => ''), { timeout: 10_000 }).toContain('[[KPIs]]')
  const born = await readFile(created, 'utf8')
  expect(born).toContain(`${COLUMN}:\n`) // the column declared in step 1, scaffolded from the declaration
  expect(born).toContain('funnel_stages: []')
  expect(born).not.toContain('folder_page:')
  const props = parseFrontmatter(splitFrontmatter(born).frontmatter).properties
  expect(props[COLUMN]).toBeNull()
  await expect(activeTab(win)).toHaveText('Untitled')
  await shoot(win, 'columns-05-born-member')
})

test('step 5 — the column lives on the page, not in the session: it survives quit → relaunch', async () => {
  await quitApp(app) // the REAL quit path: pending autosaves and the state write are flushed

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'KPIs').click()
  await expect(contents(win)).toBeVisible()
  // Which view is active is SESSION state, so the reopened page is back on Q7's first skin.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()

  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])
  await expect(dataRows(contents(win))).toHaveCount(MEMBERS.length + 1) // step 4's newborn is a member now
  expect((await settingsOnDisk()).columns?.[COLUMN]).toEqual({ kind: 'number' })
  // …and step 3's value is still in the cell it was typed into.
  await expect(cell(contents(win), 0, 4)).toContainText('42')
  await shoot(win, 'columns-06-survives-relaunch')
})

test('step 6 — a name that is not a property name is refused inline, and nothing is written', async () => {
  const before = await readFile(folderPagePath(), 'utf8')

  const menu = await openProperties()
  await menu.locator('.view-menu__action', { hasText: '+ Add column' }).click()
  await menu.locator('[aria-label="Column name"]').fill('Bad Name!')
  await menu.locator('[aria-label="Save column"]').click()

  const alert = menu.locator('[role="alert"]')
  await expect(alert).toBeVisible()
  await expect(alert).toHaveText('Use lower case letters, digits and _, starting with a letter')
  // The form stays open on the rejected name — the refusal is a correction, not a dismissal.
  await expect(menu.locator('[aria-label="Column name"]')).toHaveValue('Bad Name!')
  await shoot(win, 'columns-07-bad-name-refused')

  // Nothing was written: the folder page's bytes are the ones step 5 left behind.
  expect(await readFile(folderPagePath(), 'utf8')).toBe(before)
  await expect(headers(contents(win))).toHaveText([...HEADERS, COLUMN_LABEL])

  await quitApp(app)
})
