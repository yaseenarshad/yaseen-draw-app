/**
 * In-app delete against the REAL app (GRO-2272 `D1-`/`D2-`): the sidebar context menu's
 * Delete → the confirm sheet → `shell.trashItem`.
 *
 * The step that justifies this whole spec is the **resurrection guard** (step 4): a note with
 * a DIRTY, unsaved buffer is deleted, and after both the autosave debounce and the watcher's
 * awaitWriteFinish window have elapsed it must still be gone. Unit tests prove each seam in
 * isolation; only the real app proves the seams together, with the real timers.
 *
 * `shell.trashItem` moves entries to the user's REAL Trash. Assertions therefore only ever
 * check that a path is **gone from the vault** — never that anything landed in `~/.Trash`,
 * which is shared state across runs and machines. Vault names are prefixed `del-` so any
 * debris left in the Trash by a crashed run is identifiable.
 *
 * Same harness as rename.spec.ts (temp `--user-data-dir`, a COPY of a generated fixture
 * vault, `delete-` step screenshots); serial by design — each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const HUB_BODY = 'del-hub-body'
const DOOMED_BODY = 'del-doomed-body'
const KEEP_BODY = 'del-keep-body'
const INNER_BODY = 'del-inner-body'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
const dirRow = (w: Page, label: string) => w.locator('.tree__row--dir').filter({ hasText: new RegExp(`^${label}$`) })
const sheet = (w: Page) => w.locator('.confirm')

/** True when the path is gone from the vault. Where it went (the Trash) is not our business. */
const gone = async (p: string): Promise<boolean> => stat(p).then(() => false, () => true)

/** Right-click a row and open the confirm sheet; returns without confirming. */
async function askDelete(w: Page, row: ReturnType<typeof fileRow>): Promise<void> {
  await row.click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Delete' }).click()
  await expect(sheet(w)).toBeVisible()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'del-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, 'Docs', 'deep'), { recursive: true })
  await Promise.all([
    // Hub links to Doomed three ways, so the confirm sheet has a backlink count to report
    // and step 6 can prove the links are left BYTE-IDENTICAL.
    writeFile(path.join(vault, 'Hub.md'), `# Hub\n\n${HUB_BODY}\n\nSee [[Doomed]] and [[Doomed|Dee]] here.\n\n![[Doomed]]\n`),
    writeFile(path.join(vault, 'Doomed.md'), `# Doomed\n\n${DOOMED_BODY}\n`),
    writeFile(path.join(vault, 'Keep.md'), `# Keep\n\n${KEEP_BODY}\n`),
    writeFile(path.join(vault, 'Docs', 'Inner.md'), `# Inner\n\n${INNER_BODY}\n`),
    writeFile(path.join(vault, 'Docs', 'deep', 'Deeper.md'), '# Deeper\n\ndel-deeper-body\n'),
  ])
})

test.afterAll(async () => {
  // quitApp, not app.close(): this spec ends with freshly-mounted editors (step 6 recreates a
  // page via create-on-click), and the close/flush handshake needs the real quit path.
  if (app !== undefined) await quitApp(app).catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- D1: deleting a note

test('step 1 — the menu offers Delete, and it opens the confirm sheet without deleting', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Doomed.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(DOOMED_BODY)

  // Make the buffer DIRTY and unsaved — this is what makes step 4 meaningful.
  await editorOf(win).click()
  await win.keyboard.type(' edited-but-never-saved')

  await askDelete(win, fileRow(win, 'Doomed'))
  await shoot(win, 'delete-01-confirm-sheet')
  // The sheet names the file, says where it goes, and reports the backlink count.
  await expect(sheet(win)).toContainText('Delete "Doomed.md"?')
  await expect(sheet(win)).toContainText('moves to the Trash')
  await expect(sheet(win)).toContainText('1 note links to this')
  expect(await gone(path.join(vault, 'Doomed.md'))).toBe(false) // nothing deleted yet
})

test('step 2 — Cancel deletes nothing and leaves the tab open', async () => {
  await win.locator('.confirm__btn', { hasText: 'Cancel' }).click()
  await expect(sheet(win)).toBeHidden()
  expect(await gone(path.join(vault, 'Doomed.md'))).toBe(false)
  await expect(activeTab(win)).toHaveText('Doomed')
})

test('step 3 — confirming trashes the file and closes its tab; a neighbour takes over', async () => {
  // ⌘-click opens a BACKGROUND tab (the locked I3 ruling); a plain click would REPLACE the
  // active tab, leaving no heir for the delete to promote.
  await fileRow(win, 'Keep').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Doomed', 'Keep'])
  await expect(activeTab(win)).toHaveText('Doomed')

  await askDelete(win, fileRow(win, 'Doomed'))
  await win.locator('.confirm__btn', { hasText: 'Delete' }).click()

  await expect.poll(() => gone(path.join(vault, 'Doomed.md'))).toBe(true)
  await expect(tabsOf(win)).toHaveText(['Keep'])
  await expect(activeTab(win)).toHaveText('Keep')
  await expect.poll(() => win.title()).toContain('Keep')
  await shoot(win, 'delete-03-deleted')
})

test('step 4 — RESURRECTION GUARD: the dirty buffer never writes the file back', async () => {
  // Past BOTH the autosave debounce (500ms) and the watcher awaitWriteFinish window (200ms),
  // with a wide margin. If retireDeletedPath were removed, the unmount flush would have
  // recreated Doomed.md by now — this is the assertion that proves it does not.
  await win.waitForTimeout(3000)
  expect(await gone(path.join(vault, 'Doomed.md'))).toBe(true)
})

test('step 5 — referencing notes are left BYTE-IDENTICAL: no link rewriting on delete', async () => {
  const hub = await readFile(path.join(vault, 'Hub.md'), 'utf8')
  expect(hub).toBe(`# Hub\n\n${HUB_BODY}\n\nSee [[Doomed]] and [[Doomed|Dee]] here.\n\n![[Doomed]]\n`)
})

test('step 6 — the links now render UNRESOLVED, and clicking one recreates the page', async () => {
  await fileRow(win, 'Hub').click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  const link = editorOf(win).locator('.wikilink', { hasText: 'Doomed' }).first()
  await expect(link).toBeVisible()
  await expect(link).toHaveClass(/wikilink--unresolved/)
  await shoot(win, 'delete-06-unresolved-link')
  await link.click()
  // Create-on-click restores the page in place — an accidental delete is recoverable here.
  await expect.poll(() => gone(path.join(vault, 'Doomed.md'))).toBe(false)
  await expect(activeTab(win)).toHaveText('Doomed')
})

// ---------------------------------------------------------------- D2: folders and refusals

test('step 7 — a folder sheet reports its whole subtree, and Escape cancels', async () => {
  // Same reason as step 3: ⌘-click so a survivor remains when the folder's tab closes.
  await dirRow(win, 'Docs').click()
  await fileRow(win, 'Inner').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toContainText(['Inner'])

  await askDelete(win, dirRow(win, 'Docs'))
  await expect(sheet(win)).toContainText('Delete "Docs"?')
  // Recursive count: Inner.md + deep/Deeper.md = 2 notes, and the `deep` subfolder.
  await expect(sheet(win)).toContainText('2 notes and 1 folder move to the Trash')
  await shoot(win, 'delete-07-folder-sheet')

  await win.keyboard.press('Escape')
  await expect(sheet(win)).toBeHidden()
  expect(await gone(path.join(vault, 'Docs'))).toBe(false)
})

test('step 8 — deleting the folder takes the whole subtree and closes the tab inside it', async () => {
  await askDelete(win, dirRow(win, 'Docs'))
  await win.locator('.confirm__btn', { hasText: 'Delete' }).click()

  await expect.poll(() => gone(path.join(vault, 'Docs'))).toBe(true)
  expect(await gone(path.join(vault, 'Docs', 'Inner.md'))).toBe(true)
  expect(await gone(path.join(vault, 'Docs', 'deep', 'Deeper.md'))).toBe(true)
  // The tab that lived inside the folder is gone; a survivor is active.
  await expect(tabsOf(win)).not.toContainText(['Inner'])
  await win.waitForTimeout(3000)
  expect(await gone(path.join(vault, 'Docs'))).toBe(true) // nothing reappeared
  await shoot(win, 'delete-08-folder-deleted')
})

test('step 9 — blank space offers no Delete: a destructive item needs a target', async () => {
  await win.locator('.sidebar__body').click({ button: 'right', position: { x: 20, y: 320 } })
  await expect(win.locator('.ctx-menu')).toBeVisible()
  await expect(win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Delete' })).toHaveCount(0)
  // Copy path (and Open in ▸ Reveal in Finder) DO appear there — they target the vault root (GRO-2273/2274).
  await expect(win.locator('.ctx-menu [role="menuitem"]', { hasText: 'Copy path' })).toHaveCount(1)
  await win.keyboard.press('Escape')
})

test('step 10 — the vault survives: Keep and Hub are still there', async () => {
  expect(await gone(path.join(vault, 'Keep.md'))).toBe(false)
  expect(await gone(path.join(vault, 'Hub.md'))).toBe(false)
  expect(await gone(vault)).toBe(false)
})
