/**
 * Links E1 (GRO-2194): in-app rename with automatic link updates, against the REAL app —
 * the sidebar context menu's "Rename" → inline input → Enter → the name-change confirm sheet
 * (⚡ YAZ-888, which every NAME change below now passes). The renamed file moves on
 * disk, every referencing note is rewritten (bare, aliased and embed forms, alias
 * preserved), the open tab follows in place (label + window title), the summary notice
 * shows, and clicking the rewritten link navigates to the renamed file. A rename onto an
 * existing name is DECLINED with a passive notice — never-overwrite, never a dialog.
 *
 * YAZ-1553 (step 3b): LEAVING the inline box commits — click another row with a changed name
 * and the sheet asks and SURVIVES that click (the row's mousedown landed before the sheet
 * existed, and its click lands on the body, so the row does not open); Escape is the only
 * discard; the unchanged name leaves silently.
 *
 * Links E1b (GRO-2241, steps 5+): folder rename via the folder row's context menu — the
 * PATHED link in a referencing note rewrites on disk while the bare link stays
 * BYTE-IDENTICAL (the LOCKED rule), and the open tab under the folder follows by prefix;
 * drag-a-file-row-onto-a-folder moves it (bare link unchanged, pathed link rewritten);
 * a folder rename onto an existing folder is DECLINED with the same passive notice.
 *
 * Same harness as links.spec.ts (temp `--user-data-dir`, COPY of a generated fixture
 * vault, `rename-` step screenshots); serial by design — each step continues the last.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  copyVault,
  launchApp,
  quitApp,
  seededState,
  shoot,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** Seeded on top of the fixture vault: A references B three ways; C blocks a rename onto it. */
const A_BODY = 'a-hub-body'
const B_BODY = 'b-note-body'
/** YAZ-1553 seed: D is linked by nobody, so its click-away rename asks with the "no other notes" count. */
const D_BODY = 'd-note-body'
/** E1b seeds: Docs/N is referenced by R (pathed + bare); Target/M by S (pathed + bare). */
const N_BODY = 'n-note-body'
const M_BODY = 'm-note-body'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
const dirRow = (w: Page, label: string) => w.locator('.tree__row--dir').filter({ hasText: new RegExp(`^${label}$`) })

/** Right-click `label`'s row and drive the context menu's Rename into the inline input. */
async function startRename(w: Page, label: string): Promise<void> {
  await fileRow(w, label).click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(w.locator('.create-inline__input')).toHaveValue(label)
}

/** The folder-row variant (E1b): prefilled with the RAW folder name. */
async function startRenameDir(w: Page, label: string): Promise<void> {
  await dirRow(w, label).click({ button: 'right' })
  await w.locator('.ctx-menu [role="menuitem"]', { hasText: 'Rename' }).click()
  await expect(w.locator('.create-inline__input')).toHaveValue(label)
}

const sheet = (w: Page) => w.locator('.confirm[role="dialog"]')

/**
 * The name-change confirm (⚡ YAZ-888, amending decision E / GRO-2096): since the one door in App
 * asks before any NAME change, every rename below passes this sheet — with the honest count —
 * and only a drag-MOVE still runs silently (step 6 pins that).
 */
async function confirmRename(w: Page, message?: string): Promise<void> {
  if (message !== undefined) await expect(sheet(w).locator('.confirm__text')).toHaveText(message)
  await expect(sheet(w)).toBeVisible()
  await sheet(w).locator('.confirm__btn', { hasText: 'Rename' }).click()
  await expect(sheet(w)).toHaveCount(0)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'rename-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, 'Docs'), { recursive: true })
  await mkdir(path.join(vault, 'Target'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, 'A.md'), `# A\n\n${A_BODY}\n\nSee [[B]] and [[B|Bee]] here.\n\n![[B]]\n`),
    writeFile(path.join(vault, 'B.md'), `# B\n\n${B_BODY}\n`),
    writeFile(path.join(vault, 'C.md'), '# C\n\nc-note-body\n'),
    writeFile(path.join(vault, 'D.md'), `# D\n\n${D_BODY}\n`),
    writeFile(path.join(vault, 'Docs', 'N.md'), `# N\n\n${N_BODY}\n`),
    writeFile(path.join(vault, 'R.md'), '# R\n\nSee [[Docs/N]] and [[N]] here.\n'),
    writeFile(path.join(vault, 'Target', 'M.md'), `# M\n\n${M_BODY}\n`),
    writeFile(path.join(vault, 'S.md'), '# S\n\nSee [[Target/M]] and [[M]] here.\n'),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

/**
 * Poll-friendly read: `expect.poll` ABORTS on a thrown error (no retry), and right after
 * Enter the rename pipeline (flush → index+tree snapshots → fs:rename → rewrites) is still
 * in flight — so a not-yet-existing file must read as '' and keep the poll polling.
 */
const readWhenReady = (p: string) => readFile(p, 'utf8').catch(() => '')

test('step 1 — rename B via the context menu: disk file renamed, tab and title follow, summary notice shows', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'B.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect(tabsOf(win)).toHaveText(['B'])

  await startRename(win, 'B')
  await shoot(win, 'rename-01-inline-input')
  await win.locator('.create-inline__input').fill('B2')
  await win.keyboard.press('Enter')
  // ⚡ YAZ-888: the name changed, so the sheet asks first — with the honest count (A is the one
  // note that links to B, however many times it does).
  await expect(sheet(win)).toBeVisible()
  await shoot(win, 'rename-01b-confirm-sheet')
  await confirmRename(win, "Rename 'B' to 'B2'? Links in 1 note will be updated.")

  // Disk: the file moved, content intact; nothing remains at the old path.
  await expect.poll(() => readWhenReady(path.join(vault, 'B2.md'))).toContain(B_BODY)
  await expect(readFile(path.join(vault, 'B.md'), 'utf8')).rejects.toThrow()
  // The open tab follows IN PLACE — label, editor content and the window title.
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect.poll(() => win.title()).toContain('B2')
  // ONE passive summary notice: exactly one referencing note was rewritten.
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await shoot(win, 'rename-02-renamed')
})

test('step 2 — A was rewritten on disk: bare, aliased and embed forms, alias preserved', async () => {
  const a = await readFile(path.join(vault, 'A.md'), 'utf8')
  expect(a).toContain('See [[B2]] and [[B2|Bee]] here.')
  expect(a).toContain('![[B2]]')
  expect(a).not.toContain('[[B]]')
})

test('step 3 — clicking the rewritten link in A navigates to the renamed B2', async () => {
  await fileRow(win, 'A').click()
  await expect(editorOf(win)).toContainText(A_BODY)
  // The rewritten link renders collapsed (and resolved) once the index catches up.
  const link = editorOf(win).locator('.wikilink', { hasText: 'B2' }).first()
  await expect(link).toBeVisible()
  await link.click()
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await shoot(win, 'rename-03-link-navigates')
})

test('step 3b — leaving the inline box commits (YAZ-1553): click another row and the sheet asks and survives; Escape discards; unchanged is silent', async () => {
  await startRename(win, 'D')
  await win.locator('.create-inline__input').fill('D2')
  // No Enter: clicking row A is the leave. Its mousedown lands BEFORE the sheet exists, so the
  // sheet's own click-away-cancels does not fire — and A's click lands on the body, not the row.
  await fileRow(win, 'A').click()
  await expect(sheet(win)).toBeVisible()
  await shoot(win, 'rename-03b-clickaway-sheet')
  await expect(activeTab(win)).toHaveText('B2')
  await confirmRename(win, "Rename 'D' to 'D2'? No other notes link to it.")
  await expect.poll(() => readWhenReady(path.join(vault, 'D2.md'))).toContain(D_BODY)
  await expect(readFile(path.join(vault, 'D.md'), 'utf8')).rejects.toThrow()
  await expect(fileRow(win, 'D2')).toBeVisible()

  // Escape is the only discard: the box closes, no sheet, nothing moves.
  await startRename(win, 'D2')
  await win.locator('.create-inline__input').fill('Discarded')
  await win.keyboard.press('Escape')
  await expect(win.locator('.create-inline__input')).toHaveCount(0)
  await expect(sheet(win)).toHaveCount(0)
  await expect(fileRow(win, 'D2')).toBeVisible()
  expect(await readFile(path.join(vault, 'D2.md'), 'utf8')).toContain(D_BODY)

  // Leaving with the unchanged name is silent: the parent's same-name no-op, no sheet.
  await startRename(win, 'D2')
  await fileRow(win, 'A').click()
  await expect(win.locator('.create-inline__input')).toHaveCount(0)
  await expect(sheet(win)).toHaveCount(0)
  await expect(fileRow(win, 'D2')).toBeVisible()
})

test('step 4 — renaming onto an existing name is DECLINED with a passive notice; nothing moves', async () => {
  await startRename(win, 'A')
  await win.locator('.create-inline__input').fill('C')
  await win.keyboard.press('Enter')
  // The sheet asks about a name nobody links to, then the never-overwrite rule declines it.
  await confirmRename(win, "Rename 'A' to 'C'? No other notes link to it.")
  await expect(win.locator('.link-notice')).toHaveText('Can\'t rename: "C.md" already exists')
  // Both files untouched; the row is still A.
  expect(await readFile(path.join(vault, 'A.md'), 'utf8')).toContain(A_BODY)
  expect(await readFile(path.join(vault, 'C.md'), 'utf8')).toContain('c-note-body')
  await expect(fileRow(win, 'A')).toBeVisible()
  await shoot(win, 'rename-04-decline-notice')
  await quitApp(app)
})

// ---------- E1b (GRO-2241): folder rename + drag-move, fresh launch on the same vault ----------

test('step 5 — folder rename via its context menu: disk moves, PATHED link rewritten, bare link BYTE-IDENTICAL, open tab follows', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Docs', 'N.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(N_BODY)
  await expect(tabsOf(win)).toHaveText(['N'])

  await startRenameDir(win, 'Docs')
  await shoot(win, 'rename-05-folder-inline-input')
  await win.locator('.create-inline__input').fill('Notes')
  await win.keyboard.press('Enter')
  // A FOLDER name is a name too (⚡ YAZ-888), and its count is the DIR-mode one: R's PATHED
  // link is what the rewrite would touch — the bare [[N]] keeps resolving and is not counted.
  await confirmRename(win, "Rename 'Docs' to 'Notes'? Links in 1 note will be updated.")

  // Disk: the folder moved with its file; nothing remains at the old path.
  await expect.poll(() => readWhenReady(path.join(vault, 'Notes', 'N.md'))).toContain(N_BODY)
  await expect(readFile(path.join(vault, 'Docs', 'N.md'), 'utf8')).rejects.toThrow()
  // R.md pinned WHOLE: the pathed link rewrote, the bare [[N]] is byte-identical (LOCKED).
  await expect.poll(() => readWhenReady(path.join(vault, 'R.md'))).toBe('# R\n\nSee [[Notes/N]] and [[N]] here.\n')
  // The open tab under the folder followed by prefix — same label, NEW path — and the
  // window still works (editor alive, title tracks the active tab).
  await expect(activeTab(win)).toHaveText('N')
  await expect(activeTab(win)).toHaveAttribute('title', path.join(vault, 'Notes', 'N.md'))
  await expect(editorOf(win)).toContainText(N_BODY)
  await expect.poll(() => win.title()).toContain('N')
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await shoot(win, 'rename-06-folder-renamed')
})

test('step 6 — drag a file row onto a folder row: the file moves there, bare link unchanged, pathed link rewritten', async () => {
  await dirRow(win, 'Target').click() // expand to reveal M
  await expect(fileRow(win, 'M')).toBeVisible()
  await fileRow(win, 'M').dragTo(dirRow(win, 'Notes'))

  // A MOVE keeps the name, so it stays SILENT (⚡ YAZ-888): no sheet, ever, on a drag.
  await expect(sheet(win)).toHaveCount(0)
  await expect.poll(() => readWhenReady(path.join(vault, 'Notes', 'M.md'))).toContain(M_BODY)
  await expect(readFile(path.join(vault, 'Target', 'M.md'), 'utf8')).rejects.toThrow()
  // S.md pinned WHOLE: [[Target/M]] → [[Notes/M]]; the bare [[M]] still resolves — unchanged.
  await expect.poll(() => readWhenReady(path.join(vault, 'S.md'))).toBe('# S\n\nSee [[Notes/M]] and [[M]] here.\n')
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await shoot(win, 'rename-07-drag-move')
})

test('step 7 — renaming a folder onto an EXISTING folder is DECLINED with a passive notice; nothing moves', async () => {
  await startRenameDir(win, 'Target')
  await win.locator('.create-inline__input').fill('Notes')
  await win.keyboard.press('Enter')
  // The sheet stands in the way of this one too. Only the NAMES are pinned here: N is read off
  // whatever index snapshot the window holds at that instant, and step 6 moved a file moments
  // ago — the counted set depends on how far the 300ms-debounced refetch has caught up.
  await expect(sheet(win).locator('.confirm__text')).toContainText("Rename 'Target' to 'Notes'?")
  await confirmRename(win)
  await expect(win.locator('.link-notice')).toHaveText('Can\'t rename: "Notes" already exists')
  // Both folders untouched.
  expect((await stat(path.join(vault, 'Target'))).isDirectory()).toBe(true)
  expect(await readFile(path.join(vault, 'Notes', 'N.md'), 'utf8')).toContain(N_BODY)
  await expect(dirRow(win, 'Target')).toBeVisible()
  await shoot(win, 'rename-08-folder-decline')
  await quitApp(app)
})
