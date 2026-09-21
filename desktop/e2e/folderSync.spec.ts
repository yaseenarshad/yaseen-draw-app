/**
 * SYNC FROM FOLDER, end to end (YAZ-954, proving YAZ-950): a disk folder's notes appended to a
 * folder page as `[[links]]`, through the REAL app over the committed encyclopedia fixture.
 *
 * The gesture is one-way and additive by design (🔒 4): notes in the folder that the page does
 * not list are offered; pages the page lists that are NOT in the folder are never touched, which
 * is the whole point of topics being independent of disk folders. What the sheet writes is
 * ordinary membership — the same `folder_pages` entry typing the link by hand would write
 * (🔒 1) — so the proof is not "a link appeared" but "each note's OWN file says where it belongs".
 *
 * `inbox/` is the subject: both its notes deliberately belong nowhere in the fixture, so every
 * assertion below is about writes this gesture caused and nothing else.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, outlineLines, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Funnel Stages.md'
/** Both belong NOWHERE in the fixture — every membership below is this gesture's doing. */
const INBOX = ['inbox/Pipeline Review Notes.md', 'inbox/Positioning Draft.md']
/**
 * What the page's outline says before anybody clicks Sync: its own body, migrated in on the first
 * open (YAZ-919), then its three members, ADOPTED in under it (⚡ YAZ-1152) — the state step 1
 * waits for, so that "Cancel wrote nothing" is measured against a page that has finished writing.
 */
const BODY = [
  'Funnel Stages',
  'The stages a deal walks through, from first touch to closed-won. Every page that says it',
  'belongs here shows up below — there is no list to maintain.',
]
const MEMBERS = ['Lead Gen', 'Lead Nurture', 'Sales-Conversion']

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const syncBtn = (w: Page) => contents(w).locator('[aria-label="Sync from folder"]')
const sheet = (w: Page) => w.locator('.confirm[role="dialog"]')
const sheetText = (w: Page) => sheet(w).locator('.confirm__text')
const folderRow = (w: Page, label: string) => sheet(w).locator('.sync__folder').filter({ hasText: label })
const previewNames = (w: Page) => sheet(w).locator('.sync__missing li')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: new RegExp(`^${label}$`) })
const said = async (scope: Locator): Promise<string[]> => (await outlineLines(scope).allTextContents()).filter((line) => line !== '')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'foldersync-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — Cancel is a true no-op: the sheet reports, and writes nothing at all', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FOLDER_PAGE)) })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()

  // SETTLE FIRST (⚡ YAZ-1152). Opening a folder page is now two writes of its own: YAZ-919 moves
  // the body into the outline, then ADOPTION writes in the three members that body does not name.
  // "Cancel wrote nothing" is a claim about the bytes AFTER those, so the baseline is read once
  // the document names every member — otherwise this file would be pinning a race, not a rule.
  await expect.poll(() => said(contents(win))).toEqual([...BODY, ...MEMBERS.map((n) => `[[${n}]]`)])
  const before = await readFile(path.join(vault, FOLDER_PAGE), 'utf8')
  const said0 = await said(contents(win))

  await syncBtn(win).click()
  // It opens on the QUESTION, and says "directly" — the non-recursive rule (🔒 5) is the user's
  // to know before approving, not to discover afterwards.
  await expect(sheetText(win)).toContainText('Pick a folder')
  await expect(sheetText(win)).toContainText('directly')
  await shoot(win, 'sync-01-sheet-opens')

  await folderRow(win, 'inbox').click()
  await expect(previewNames(win)).toHaveText(['Pipeline Review Notes', 'Positioning Draft'])
  await expect(sheetText(win)).toContainText('2 of 2 notes directly in "inbox"')
  await shoot(win, 'sync-02-preview')

  await sheetBtn(win, 'Cancel').click()
  await expect(sheet(win)).toHaveCount(0)
  expect(await readFile(path.join(vault, FOLDER_PAGE), 'utf8')).toBe(before)
  expect(await said(contents(win))).toEqual(said0)
  // The MEMBERSHIP, not the word: `Pipeline Review Notes` says "folder_pages" in its own prose.
  for (const note of INBOX) expect(await readFile(path.join(vault, note), 'utf8')).not.toContain('[[Funnel Stages]]')
})

test('step 2 — approving appends the links AND writes each note’s own membership', async () => {
  const before = await said(contents(win))

  await syncBtn(win).click()
  await folderRow(win, 'inbox').click()
  await sheetBtn(win, 'Add').click()
  await expect(sheet(win)).toHaveCount(0)

  // In the DOCUMENT: appended at the END, and every line that was already there is untouched.
  await expect
    .poll(() => said(contents(win)))
    .toEqual([...before, '[[Pipeline Review Notes]]', '[[Positioning Draft]]'])

  // On DISK, the half that matters: membership is CHILD-declared (🔒 1), so each note's own file
  // now names this page — exactly what typing the link by hand would have written.
  for (const note of INBOX) {
    await expect.poll(() => readFile(path.join(vault, note), 'utf8'), { timeout: 10_000 }).toContain('[[Funnel Stages]]')
  }
  // …and the page's own outline document holds the appended lines.
  await expect.poll(() => readFile(path.join(vault, FOLDER_PAGE), 'utf8')).toContain('[[Positioning Draft]]')
  await shoot(win, 'sync-03-appended')
})

test('step 3 — re-running offers nothing, and never a button that would do nothing', async () => {
  await syncBtn(win).click()
  await folderRow(win, 'inbox').click()
  await expect(sheetText(win)).toContainText('Nothing to add')
  await expect(previewNames(win)).toHaveCount(0)
  await expect(sheetBtn(win, 'Add')).toHaveCount(0) // the whole point: no no-op button
  await shoot(win, 'sync-04-nothing-to-add')
  await sheetBtn(win, 'Dismiss').click()
  await expect(sheet(win)).toHaveCount(0)
})

test('step 4 — it stops at the folder’s own notes, and never takes away what the page listed', async () => {
  const listed = await said(contents(win))

  // The vault ROOT is a folder like any other (🔒 5): what it offers is the notes sitting
  // DIRECTLY in it — the other topic pages — and never the ones nested inside `kpis/`,
  // `funnel-stages/` and friends, however much this page might want them.
  await syncBtn(win).click()
  await folderRow(win, 'Vault root').click()
  const offered = await previewNames(win).allTextContents()
  expect(offered).toContain('Industries')
  expect(offered).toContain('KPIs')
  expect(offered).not.toContain('CAC') // lives in kpis/ — a subfolder, so not this folder's
  expect(offered).not.toContain('Lead Gen') // lives in funnel-stages/
  expect(offered).not.toContain('Funnel Stages') // 🔒 8: a page never lists itself
  await shoot(win, 'sync-05-direct-only')

  // Cancelled — and the one-way rule (🔒 4) means nothing the page already said is ever taken
  // away, whichever folder is picked: what it listed before is exactly what it lists after.
  await sheetBtn(win, 'Cancel').click()
  expect(await said(contents(win))).toEqual(listed)

  await quitApp(app)
})
