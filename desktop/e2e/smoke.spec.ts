/**
 * Desktop G1 (GRO-2178): the smoke suite — drives the REAL built app (`desktop/out/main/index.js`)
 * through the whole session arc against a temp `--user-data-dir` and a COPY of a generated
 * fixture vault. Serial by design: each step continues the previous one's app state (fresh
 * Welcome → seeded open → autosave → fold → quit-flush → restore), so a failed step skips the rest.
 * One screenshot per step lands in `desktop/e2e/artifacts/` (gitignored) — the evidence format.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  CHILD_BULLET,
  copyVault,
  expandDirs,
  LAST_BULLET,
  launchApp,
  md5,
  quitApp,
  readState,
  SEED_BODY,
  SEED_FILE,
  seededState,
  shoot,
  windowCount,
} from './helpers'

test.describe.configure({ mode: 'serial' })

const AUTOSAVE_MARKER = 'autosave-proof-3f9'

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'g1-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, SEED_FILE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('step 1 — fresh state boots one Welcome window', async () => {
  app = await launchApp({ userData })
  win = await app.firstWindow()
  await expect(win.locator('.welcome__title')).toHaveText('Yaseen Docs')
  await expect(win.locator('.welcome__empty')).toBeVisible() // brand-new state: no recents yet
  expect(await windowCount(app)).toBe(1)
  await expect.poll(() => win.title()).toBe('Yaseen Docs')
  await shoot(win, '01-fresh-welcome')
  await quitApp(app) // the real quit path, so step 2's seed overwrites a settled state file
})

test('step 2 — seeded relaunch opens the vault without the native dialog', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText(SEED_BODY) // the seeded file is open
  // The folder's tree shows: root file and folder row; the nested file only after `Projects` is
  // opened by hand — every launch is collapsed since YAZ-1642.
  await expect(win.locator('.tree__row--file', { hasText: 'Ideas' })).toBeVisible()
  await expect(win.locator('.tree__row--dir', { hasText: 'Projects' })).toBeVisible()
  await expandDirs(win, [path.join(vault, 'Projects')])
  await expect(win.locator('.tree__row--file', { hasText: 'Roadmap' })).toBeVisible()
  await expect(win.locator('.tree__row--active')).toContainText('Welcome note')
  await expect.poll(() => win.title()).toBe(`Welcome note — ${path.basename(vault)}`) // `<file — folder>`
  expect(await windowCount(app)).toBe(1)
  await shoot(win, '02-seeded-vault-open')
})

test('step 3 — typing lands on disk via autosave', async () => {
  const md5Before = await md5(notePath)
  // Append inside the existing last bullet — pressing Enter for a fresh list item makes Milkdown
  // remap the caret mid-typing (the first keystroke ends up displaced), so we deliberately avoid it.
  await win.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await win.keyboard.press('End')
  await win.keyboard.type(` ${AUTOSAVE_MARKER}`, { delay: 15 })
  await expect(win.locator('.ProseMirror')).toContainText(AUTOSAVE_MARKER) // in the DOM before we watch the disk
  // Autosave debounces 500 ms after the last keystroke, then writes — poll the disk, never sleep blind.
  await expect
    .poll(async () => (await readFile(notePath, 'utf8')).includes(AUTOSAVE_MARKER), { timeout: 10_000 })
    .toBe(true)
  expect(await md5(notePath)).not.toBe(md5Before)
  await shoot(win, '03-autosave-on-disk')
})

test('step 4 — folding a bullet hides its children and persists to app state', async () => {
  // UI path: the chevron widget (`.outline-toggle`) renders only on parent items — the fixture
  // has exactly one parent, so first() is unambiguous. (Chosen over seeding `folders[root].folds`
  // because it also proves the click → plugin → storage.setFolds pipeline.)
  await win.locator('.ProseMirror').getByText(CHILD_BULLET).hover() // reveal the chevron (opacity)
  await win.locator('.outline-toggle').first().click()
  await expect(win.locator('[data-outline-folded="true"]').first()).toBeAttached()
  await expect(win.locator('.ProseMirror').getByText(CHILD_BULLET)).toBeHidden()
  // The fold key reaches yaseendocs.json (store debounces writes by 150 ms).
  await expect
    .poll(async () => ((await readState(userData)).folders[vault]?.folds[notePath] ?? []).length, { timeout: 10_000 })
    .toBeGreaterThan(0)
  await shoot(win, '04-fold-collapsed')
})

test('step 5 — real quit flushes, relaunch restores window, file and fold', async () => {
  await quitApp(app) // before-quit handshake: autosave flush + final state write
  const flushed = await readState(userData)
  expect(flushed.windows).toHaveLength(1)
  expect(flushed.windows[0].file).toBe(notePath)
  expect((flushed.folders[vault]?.folds[notePath] ?? []).length).toBeGreaterThan(0)

  app = await launchApp({ userData }) // NO re-seed: whatever quit wrote is what restores
  win = await appWindow(app, flushed.windows[0].id)
  await expect(win.locator('.ProseMirror')).toContainText(AUTOSAVE_MARKER) // step 3's edit survived
  await expect(win.locator('[data-outline-folded="true"]').first()).toBeAttached() // fold APPLIED in the DOM
  await expect(win.locator('.ProseMirror').getByText(CHILD_BULLET)).toBeHidden()
  expect(await windowCount(app)).toBe(1)
  await expect.poll(() => win.title()).toBe(`Welcome note — ${path.basename(vault)}`)
  await shoot(win, '05-relaunch-restored')
  await quitApp(app)
})
