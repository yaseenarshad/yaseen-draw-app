/**
 * COLLAPSED ON RELAUNCH (YAZ-1642, proven here for YAZ-1647): a launch remembers nothing about
 * the sidebar's two trees. Both open lists (`folders[root].expanded`, `topicsExpanded`) are
 * session state — held in main's memory, shared by every window on the root, stripped by `toDisk`
 * before every write — and the Sidebar no longer unfolds the ancestors of the file it mounts with.
 *
 * The seed is therefore a state file that STILL holds both lists, as a pre-1642 app left it: the
 * claim is not "the app did not write it" but "the app does not read it either".
 *
 * Same harness as the rest of the suite: temp `--user-data-dir`, a generated vault, `collapsed-`
 * step screenshots, serial.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, clickMenuItem, closeWindow, expandDirs, extraWindow, launchApp, quitApp, readState, seededState, shoot, windowCount, winParam } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The active file: THREE folders down, so nothing but a real gesture can put its row on screen. */
const DEEP = path.join('Projects', 'alpha', 'beta', 'Deep note.md')
const DEEP_BODY = 'collapsed-deep-body'
/** The dirs the seed claims are open — the whole chain to the active file, plus a sibling. */
const SEEDED_DIRS = [path.join('Projects', 'alpha', 'beta'), path.join('Projects', 'alpha'), 'Projects', 'Reference']
/** The two the test opens BY HAND, outermost first — `beta` is deliberately left folded below them. */
const OPEN_BY_HAND = ['Projects', path.join('Projects', 'alpha')]
/** The Topics lens's own shape: a Home to hang from, one promoted topic, and its single member. */
const TOPIC = 'Atlas.md'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

// ---------- locators (the suite's own) ----------

const dirRow = (w: Page, label: string) => w.locator('.tree__row--dir').filter({ hasText: new RegExp(`^${label}$`) })
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })
/** Every dir the tree currently draws OPEN — the one number this whole file is about. */
const openDirs = (w: Page) => w.locator('.sidebar__body li[role="treeitem"][aria-expanded="true"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
const lensTab = (w: Page, label: 'Topics' | 'Files') => w.locator('.sidebar__lenses [role="tab"]', { hasText: label })
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')

/**
 * A small vault three folders deep, with a folder-page pair on top so the Topics lens has
 * something of its own to fold: `Home` leads, `Atlas` is promoted to a root beside it (its only
 * parent is Home), and the deep note is Atlas's one member — so Atlas wears a chevron.
 */
async function buildVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'yaz1642-vault-'))
  await mkdir(path.join(root, 'Projects', 'alpha', 'beta'), { recursive: true })
  await mkdir(path.join(root, 'Reference'), { recursive: true })
  await Promise.all([
    writeFile(path.join(root, 'Home.md'), '---\nfolder_page: true\n---\n\n# Home\n'),
    writeFile(path.join(root, TOPIC), '---\nfolder_page: true\nfolder_pages: ["[[Home]]"]\n---\n\n# Atlas\n'),
    writeFile(path.join(root, 'Loose note.md'), '# Loose note\n\ncollapsed-loose-body\n'),
    writeFile(path.join(root, 'Projects', 'Charter.md'), '# Charter\n\ncollapsed-charter-body\n'),
    writeFile(path.join(root, 'Projects', 'alpha', 'Alpha brief.md'), '# Alpha brief\n\ncollapsed-alpha-body\n'),
    writeFile(path.join(root, DEEP), `---\nfolder_pages: ["[[Atlas]]"]\n---\n\n# Deep note\n\n${DEEP_BODY}\n`),
    writeFile(path.join(root, 'Reference', 'Handbook.md'), '# Handbook\n\ncollapsed-handbook-body\n'),
  ])
  return root
}

/** The pre-YAZ-1642 state file: both lists filled in, on a window opened deep in the vault. */
function legacyState(vaultPath: string) {
  const state = seededState(vaultPath, path.join(vaultPath, DEEP))
  state.folders[vaultPath].expanded = SEEDED_DIRS.map((d) => path.join(vaultPath, d))
  state.folders[vaultPath].topicsExpanded = [path.join(vaultPath, TOPIC)]
  return state
}

// ---------- lifecycle ----------

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'yaz1642-userdata-'))
  vault = await buildVault()
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

// ---------------------------------------------------------------- the launch

test('step 1 — a state file full of open dirs launches FOLDED, with the deep tab restored', async () => {
  app = await launchApp({ userData, seedState: legacyState(vault) })
  win = await appWindow(app, 'w1')

  // The tab is the half that DOES restore: the file three folders down is open and reading.
  await expect(activeTab(win)).toHaveText('Deep note')
  await expect(editorOf(win)).toContainText(DEEP_BODY)

  // …and the tree behind it is at its root: two dirs and three files, every dir shut. The seed
  // named four open dirs and the active file's own chain among them; not one of them took.
  await expect(dirRow(win, 'Projects')).toBeVisible()
  await expect(dirRow(win, 'Reference')).toBeVisible()
  await expect(fileRow(win, 'Loose note')).toBeVisible()
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Deep note')).toHaveCount(0) // the ACTIVE file's row is not drawn either
  await expect(fileRow(win, 'Charter')).toHaveCount(0)
  await expect(fileRow(win, 'Handbook')).toHaveCount(0)
  await shoot(win, 'collapsed-01-launch')
})

// ---------------------------------------------------------------- the session list is SHARED

test('step 2 — two dirs opened by hand are open in a second window on the same vault', async () => {
  await expandDirs(win, OPEN_BY_HAND.map((d) => path.join(vault, d)))
  await expect(openDirs(win)).toHaveCount(2)
  await expect(fileRow(win, 'Charter')).toBeVisible()
  await expect(fileRow(win, 'Alpha brief')).toBeVisible()
  await expect(dirRow(win, 'beta')).toBeVisible()
  await expect(fileRow(win, 'Deep note')).toHaveCount(0) // `beta` was left folded on purpose

  // A second window on the same root (⌘⇧N duplicates it) reads the SAME in-memory list — that is
  // what "session, shared by every window on the root" means, and it is only observable here.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  const dup = await extraWindow(app, ['w1'])
  const dupId = winParam(dup)!
  expect(await windowCount(app)).toBe(2)
  for (const dir of OPEN_BY_HAND) {
    await expect(dup.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${path.join(vault, dir)}"])`)).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  }
  await expect(dup.locator('.tree__row--file').filter({ hasText: /^Alpha brief$/ })).toBeVisible()
  await shoot(dup, 'collapsed-02-second-window')

  // Back to one window, so the relaunch below restores exactly the one this file follows.
  await closeWindow(app, dupId)
  await expect.poll(() => windowCount(app)).toBe(1)
})

// ---------------------------------------------------------------- the quit, and the next launch

test('step 3 — the quit writes neither list, and the relaunch is folded again with the tab still there', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  const flushed = (await readState(userData)).folders[vault]
  // Stripped, not emptied: the keys are not in the file at all (desktop/src/main/store.ts `toDisk`).
  expect(flushed).not.toHaveProperty('expanded')
  expect(flushed).not.toHaveProperty('topicsExpanded')
  // …and the rest of the bucket is untouched, which is how we know the strip is surgical.
  expect(flushed.lastFile).toBe(path.join(vault, DEEP))

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(activeTab(win)).toHaveText('Deep note')
  await expect(editorOf(win)).toContainText(DEEP_BODY)
  await expect(openDirs(win)).toHaveCount(0)
  await expect(fileRow(win, 'Deep note')).toHaveCount(0)
  await expect(fileRow(win, 'Alpha brief')).toHaveCount(0) // step 2's two dirs went with the session
  await shoot(win, 'collapsed-03-relaunch')

  // THE OTHER TREE, same promise: the seed named `Atlas` open and a whole session ran since, and
  // the Topics lens still comes up at its roots — Home leading, the one promoted topic beside it.
  await lensTab(win, 'Topics').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Atlas', 'Uncategorized'])
  await expect(win.locator('.sidebar__body .tree__chevron--open')).toHaveCount(0)
  await shoot(win, 'collapsed-04-topics-folded')
  await quitApp(app)
})
