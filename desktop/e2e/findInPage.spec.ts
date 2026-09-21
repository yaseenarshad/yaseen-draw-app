/**
 * CMD+F IN-PAGE FIND, end to end (YAZ-970, proving YAZ-962): Chrome-style find in the REAL app —
 * highlights, the N-of-M counter, Enter cycling, fold auto-reveal with the landing exception, and
 * the routing rule between a folder page's two editors.
 *
 * The two proofs that are THE feature:
 *   1 a match hidden inside a collapsed bullet is revealed the moment the query matches it, and
 *     Esc puts the fold back — unless the reader LANDED inside it (the fold under the active
 *     match stays open, so Esc never hides your own caret);
 *   2 the whole session — open, type, cycle, reveal, close — leaves the file on disk
 *     byte-identical, proven after a real quit (the autosave flush point).
 *
 * Routing (locked in YAZ-967): on a folder page both editors can be on screen; CMD+F belongs to
 * the outline view while focus stands inside it, and to the note editor otherwise.
 *
 * Same harness as every spec here: temp `--user-data-dir`, a COPY of the fixture vault, nothing
 * sleeps — every wait is a locator assertion on the UI consequence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  CHILD_BULLET,
  copyVault,
  launchApp,
  md5,
  outlineEditor,
  outlineLinkLines,
  quitApp,
  SEED_FILE,
  seededState,
  shoot,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const bar = (w: Page) => w.locator('.find-bar')
const input = (w: Page) => w.locator('.find-bar__input')
const counter = (w: Page) => w.locator('.find-bar__count')
const matches = (w: Page) => w.locator('.find-match')
const active = (w: Page) => w.locator('.find-match--active')
const folded = (w: Page) => w.locator('[data-outline-folded="true"]')

test.describe('note page: highlights, cycling, fold reveal, untouched disk', () => {
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page
  let seedBefore: string

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-'))
    vault = await copyVault(await buildFixtureVault())
    seedBefore = await md5(path.join(vault, SEED_FILE))
    app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
    win = await appWindow(app, 'w1')
    await expect(win.locator('.editor-mount .ProseMirror')).toBeVisible()
  })

  test.afterAll(async () => {
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('a collapsed match is revealed, cycled to, and the fold restored per the landing rule', async () => {
    // The fixture's "Parent bullet" owns two children; collapse it so 2 of the 3 "bullet"
    // matches start hidden.
    await win.locator('.outline-toggle').first().click()
    await expect(folded(win)).toHaveCount(1)

    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toBeVisible()
    await expect(input(win)).toBeFocused()

    await input(win).fill('bullet')
    await expect(counter(win)).toHaveText('1 of 3')
    // The reveal: the fold hiding matches 2 and 3 opened the moment the query matched inside it.
    await expect(folded(win)).toHaveCount(0)
    await expect(matches(win)).toHaveCount(3)
    await expect(active(win)).toHaveText('bullet')
    await shoot(win, 'find-note-revealed')

    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('2 of 3')
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('3 of 3')
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('1 of 3')
    await win.keyboard.press('Shift+Enter')
    await expect(counter(win)).toHaveText('3 of 3')

    // Esc with the active match INSIDE the revealed fold: the landing stays open.
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
    await expect(matches(win)).toHaveCount(0)
    await expect(folded(win)).toHaveCount(0)
    await shoot(win, 'find-note-landing-open')

    // Same search again, but END on the top-level first hit: now Esc puts the fold back exactly
    // as the reader had it. Collapse by hand first (Esc's landing left it open), then reopen —
    // the channel kept the query, and the active match starts from the caret Esc landed (3 of 3).
    await win.locator('.outline-toggle').first().click()
    await expect(folded(win)).toHaveCount(1)
    await win.keyboard.press('Meta+f')
    await expect(counter(win)).toHaveText('3 of 3')
    await expect(folded(win)).toHaveCount(0)
    await win.keyboard.press('Enter')
    await expect(counter(win)).toHaveText('1 of 3')
    await win.keyboard.press('Escape')
    await expect(folded(win)).toHaveCount(1)
    await shoot(win, 'find-note-fold-restored')
  })

  test(`the query also finds "${CHILD_BULLET}" case-insensitively`, async () => {
    await win.keyboard.press('Meta+f')
    await input(win).fill('child bullet ALPHA')
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(active(win).first()).toBeVisible()
    await win.keyboard.press('Escape')
  })

  test('the whole session left the note byte-identical on disk (proven after a real quit)', async () => {
    await quitApp(app)
    expect(await md5(path.join(vault, SEED_FILE))).toBe(seedBefore)
  })
})

test.describe('folder page: CMD+F belongs to the editor that owns focus', () => {
  const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
  /** Home's five members — adoption writes every one of them into its document (YAZ-1152). */
  const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
  /** The one this file searches for: Home's own prose does not contain the word anywhere. */
  const ADOPTED = 'Industries'
  let userData: string
  let vault: string
  let app: ElectronApplication
  let win: Page

  test.beforeAll(async () => {
    userData = await mkdtemp(path.join(tmpdir(), 'find-e2e-home-'))
    vault = await copyVault(FIXTURE)
    app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'Home.md')) })
    win = await appWindow(app, 'w1')
    await expect(outlineEditor(win.locator('body'))).toBeVisible()
    // ADOPTION settles FIRST (YAZ-1152): it writes the five members into the document and re-seeds
    // the editor to show them, and a remount landing mid-test would drop the caret the routing
    // rule below is about. Once the five lines are on screen there is nothing left to write.
    await expect.poll(() => outlineLinkLines(win.locator('body'))).toEqual(TOPICS.map((n) => `[[${n}]]`))
  })

  test.afterAll(async () => {
    await quitApp(app)
    await rm(userData, { recursive: true, force: true })
    await rm(vault, { recursive: true, force: true })
  })

  test('focus in the outline view: CMD+F opens the outline bar and finds its text', async () => {
    await outlineEditor(win.locator('body')).click()
    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toHaveCount(1)
    await expect(win.locator('.view-outline-editor .find-bar')).toBeVisible()
    await input(win).fill('root')
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(win.locator('.view-outline-editor .find-match--active')).toHaveText('root')
    await shoot(win, 'find-outline-active')
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })

  test(`an ADOPTED member is findable: CMD+F finds "${ADOPTED}", which only adoption put in the document`, async () => {
    // ⚡ THE YAZ-1152 BUG ITSELF. `Industries` is a member of Home and Home's prose never says the
    // word — before adoption its name lived in a read-only row BELOW the editor, so the outline's
    // find (which searches the DOCUMENT) could not see it and CMD+F answered "no results" about a
    // name plainly on screen. Now the membership IS a line of the document, so the find finds it.
    await outlineEditor(win.locator('body')).click()
    await win.keyboard.press('Meta+f')
    await expect(win.locator('.view-outline-editor .find-bar')).toBeVisible()
    await input(win).fill(ADOPTED)

    // Counted, not merely highlighted: one match, and it is the adopted line — the highlight is
    // INSIDE the outline editor, which is the other half of the routing rule above.
    await expect(counter(win)).toHaveText('1 of 1')
    await expect(win.locator('.view-outline-editor .find-match--active')).toHaveText(ADOPTED)
    await expect(matches(win)).toHaveCount(1)
    await shoot(win, 'find-outline-adopted-member')
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })

  test('focus outside both editors: the outline still answers — a folder page HAS no visible note editor', async () => {
    // YAZ-919 hides the note mount on folder pages (the outline IS the document), so a note bar
    // here would search a hidden document. The visibility amendment routes CMD+F to the outline
    // even from the sidebar.
    await win.getByRole('textbox', { name: 'Search notes' }).click()
    await win.keyboard.press('Meta+f')
    await expect(bar(win)).toHaveCount(1)
    await expect(win.locator('.view-outline-editor .find-bar')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(bar(win)).toHaveCount(0)
  })
})
