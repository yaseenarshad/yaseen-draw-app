/**
 * Desktop G3 (GRO-2180): multi-window, deep-link and Open With scenarios against the REAL app.
 * Same harness as smoke.spec.ts (temp `--user-data-dir`, COPY of a generated fixture vault,
 * `g3-` step screenshots). Serial by design across three launches:
 *
 *   launch 1 (vault A, one seeded window) — scenario 1 (⌘⇧N twin windows + live sync),
 *     scenario 2 (conflict bar when dirty), scenario 3 (⌘-click → new window);
 *   launch 2 (no seed) — scenario 6: the three windows those scenarios left behind restore;
 *   launch 3 (vaults A+B seeded) — scenario 4 (hot deep link routes to the right vault's
 *     window), scenario 5 (link to a recents-only vault opens a new window), scenario 7
 *     (bonus: Finder's `open-file` rides the same pipeline).
 *
 * Focus is asserted through routing effects (shown file / title / window count), never through
 * OS focus — `BrowserWindow.focus()` is unreliable when the app is not frontmost on the runner.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileLink } from '../../shared/links'
import {
  appWindow,
  buildFixtureVault,
  clickMenuItem,
  closeWindow,
  copyVault,
  emitOpenFile,
  emitOpenUrl,
  extraWindow,
  LAST_BULLET,
  launchApp,
  multiWindowState,
  quitApp,
  readState,
  SEED_BODY,
  SEED_FILE,
  seededState,
  shoot,
  windowCount,
  winParam,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** WINDOW_CASCADE_PX (desktop/src/main/windows.ts) — duplicate offsets the copy by this. */
const CASCADE = 24
const SYNC_MARKER = 'twin-sync-4d7'
const DIRTY_MARKER = 'conflict-dirty-8a2'
const EXTERNAL_BODY = 'external-overwrite-b2e'
/** Bodies of the fixture's other files (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const ROADMAP_BODY = 'synthetic-roadmap-body'

/** The OS window title contract (client/src/lib/windowTitle.ts): `<file — folder>`. */
const titleOf = (root: string, file: string): string => `${path.basename(file).replace(/\.md$/, '')} — ${path.basename(root)}`

let userData: string
let vaultSrc: string
let vaultA: string
let vaultB: string
let noteA: string // vault A's seeded file (SEED_FILE)
let app: ElectronApplication
let winA: Page
let winB: Page
let winBId: string

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'g3-userdata-'))
  vaultSrc = await buildFixtureVault()
  vaultA = await copyVault(vaultSrc)
  vaultB = await copyVault(vaultSrc)
  noteA = path.join(vaultA, SEED_FILE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vaultA, vaultB].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('scenario 1 — ⌘⇧N duplicates the window: same file, cascaded bounds, live sync', async () => {
  app = await launchApp({ userData, seedState: seededState(vaultA, noteA) })
  winA = await appWindow(app, 'w1')
  await expect(winA.locator('.ProseMirror')).toContainText(SEED_BODY)

  // The REAL ⌘⇧N path: File › New Window through the application menu (menu.file.new-window),
  // with w1 focused first so the handler's `focusedEntry()` resolves it.
  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  winB = await extraWindow(app, ['w1'])
  winBId = winParam(winB)!
  expect(await windowCount(app)).toBe(2)
  await expect(winB.locator('.ProseMirror')).toContainText(SEED_BODY) // same file open
  await expect.poll(() => winB.title()).toBe(titleOf(vaultA, noteA))
  // The duplicate's state entry: same root/file, bounds cascaded from the seed's (60, 60).
  await expect.poll(async () => (await readState(userData)).windows.length).toBe(2)
  const entryB = (await readState(userData)).windows.find((w) => w.id === winBId)!
  expect(entryB.root).toBe(vaultA)
  expect(entryB.file).toBe(noteA)
  expect(entryB.bounds.x).toBe(60 + CASCADE)
  expect(entryB.bounds.y).toBe(60 + CASCADE)
  await shoot(winB, 'g3-01a-twin-window')

  // Edit in A (inside an existing bullet — never right after Enter, Milkdown remaps the caret):
  // autosave writes the file, the shared watcher tells B, and B — clean — reloads silently.
  await winA.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await winA.keyboard.press('End')
  await winA.keyboard.type(` ${SYNC_MARKER}`, { delay: 15 })
  await expect(winA.locator('.ProseMirror')).toContainText(SYNC_MARKER)
  await expect(winB.locator('.ProseMirror')).toContainText(SYNC_MARKER, { timeout: 10_000 })
  await expect(winB.locator('.conflict-bar')).toHaveCount(0) // clean reload path, no conflict bar
  await shoot(winB, 'g3-01b-live-sync')
})

test('scenario 2 — external edit while B is dirty raises the conflict bar; Reload adopts disk', async () => {
  // Make B dirty, then land an external write BEFORE its 500ms autosave debounce fires:
  // the watcher event (or the resulting 409) must find unsaved changes.
  await winB.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await winB.keyboard.press('End')
  await winB.keyboard.type(` ${DIRTY_MARKER}`, { delay: 10 })
  await writeFile(noteA, `# Welcome\n\n${EXTERNAL_BODY}\n`) // plain fs write: different content, fresh mtime

  await expect(winB.locator('.conflict-bar')).toBeVisible({ timeout: 10_000 })
  await expect(winB.locator('.conflict-bar')).toContainText('File changed on disk.')
  await shoot(winB, 'g3-02a-conflict-bar')

  // Resolution: Reload — the editor adopts the disk version, the dirty edit is discarded.
  await winB.locator('.conflict-bar').getByRole('button', { name: 'Reload' }).click()
  await expect(winB.locator('.ProseMirror')).toContainText(EXTERNAL_BODY)
  await expect(winB.locator('.ProseMirror')).not.toContainText(DIRTY_MARKER)
  await expect(winB.locator('.conflict-bar')).toHaveCount(0)
  // Reload never writes: the disk still holds exactly the external version.
  expect(await readFile(noteA, 'utf8')).toContain(EXTERNAL_BODY)
  expect(await readFile(noteA, 'utf8')).not.toContain(DIRTY_MARKER)
  await shoot(winB, 'g3-02b-reload-resolved')
})

test('scenario 3 — ⌘-click on a sidebar file opens a BACKGROUND TAB; the context menu still opens a new window', async () => {
  // The REAL gesture (Tree.tsx: metaKey click on a file row → openBackground — I3, GRO-2235).
  await winA.locator('.tree__row--file', { hasText: 'Ideas' }).click({ modifiers: ['Meta'] })
  // A background tab in THIS window: the strip gains a tab, activation unchanged, NO new window.
  await expect(winA.locator('.tabbar [role="tab"]')).toHaveCount(2)
  await expect(winA.locator('.tabbar [role="tab"][aria-selected="true"]')).toHaveText('Welcome note')
  await expect(winA.locator('.tree__row--active')).toContainText('Welcome note')
  expect(await windowCount(app)).toBe(2)
  await shoot(winA, 'g3-03a-cmd-click-background-tab')

  // "Open in ▸ New window" lives on the context menu alone (the LOCKED I3 ruling): the row's
  // right-click flyout item opens an independent window on {root, file} — the pre-I3 assertion set.
  await winA.locator('.tree__row--file', { hasText: 'Ideas' }).click({ button: 'right' })
  await winA.locator('.ctx-menu__item', { hasText: 'Open in' }).hover()
  await winA.locator('.ctx-menu__sub .ctx-menu__item', { hasText: 'New window' }).click()
  const winC = await extraWindow(app, ['w1', winBId])
  expect(await windowCount(app)).toBe(3)
  await expect(winC.locator('.ProseMirror')).toContainText(IDEAS_BODY)
  await expect.poll(() => winC.title()).toBe(titleOf(vaultA, path.join(vaultA, 'Ideas.md')))
  // The origin window stayed put: same active file/tab, untouched.
  await expect(winA.locator('.tabbar [role="tab"][aria-selected="true"]')).toHaveText('Welcome note')
  await shoot(winC, 'g3-03b-context-menu-new-window')
})

test('scenario 6 — relaunch restores all three windows with their roots and files', async () => {
  await quitApp(app) // real quit: flush handshake per window, windows[] kept
  const flushed = await readState(userData)
  expect(flushed.windows).toHaveLength(3)

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  for (const [i, entry] of flushed.windows.entries()) {
    const win = await appWindow(app, entry.id)
    expect(entry.root).toBe(vaultA)
    await expect.poll(() => win.title()).toBe(titleOf(entry.root!, entry.file!))
    await shoot(win, `g3-06${'abc'[i]}-restored-${path.basename(entry.file!, '.md').replace(/\s+/g, '-')}`)
  }
  expect(await windowCount(app)).toBe(3)
  await quitApp(app)
})

test('scenario 4 — hot deep link routes to the window on its vault; the other window untouched', async () => {
  const noteB = path.join(vaultB, SEED_FILE)
  app = await launchApp({
    userData,
    seedState: multiWindowState(
      [
        { id: 'wa', root: vaultA, file: noteA },
        { id: 'wb', root: vaultB, file: noteB },
      ],
      [vaultA, vaultB],
    ),
  })
  winA = await appWindow(app, 'wa')
  winB = await appWindow(app, 'wb')
  await expect(winA.locator('.ProseMirror')).toContainText(EXTERNAL_BODY) // vault A note as scenario 2 left it
  await expect(winB.locator('.ProseMirror')).toContainText(SEED_BODY) // vault B copy is pristine

  const roadmapB = path.join(vaultB, 'Projects', 'Roadmap.md')
  await emitOpenUrl(app, fileLink(roadmapB)) // macOS's open-url, exactly as main receives it

  // Routing effect: the vault-B window switches to the linked file; no third window; A untouched.
  await expect.poll(() => winB.title()).toBe(titleOf(vaultB, roadmapB))
  await expect(winB.locator('.ProseMirror')).toContainText(ROADMAP_BODY)
  expect(await windowCount(app)).toBe(2)
  await expect.poll(() => winA.title()).toBe(titleOf(vaultA, noteA))
  await expect(winA.locator('.tree__row--active')).toContainText('Welcome note')
  await shoot(winB, 'g3-04-hot-link-routed')
})

test('scenario 5 — deep link to a recents-only vault opens a new window on that vault', async () => {
  // Close the vault-B window (real close path): only vault A stays open, vault B stays in recents.
  await closeWindow(app, 'wb')
  await expect.poll(() => windowCount(app)).toBe(1)
  await expect.poll(async () => (await readState(userData)).windows.map((w) => w.id)).toEqual(['wa'])

  const ideasB = path.join(vaultB, 'Ideas.md')
  await emitOpenUrl(app, fileLink(ideasB))

  const winNew = await extraWindow(app, ['wa'])
  expect(await windowCount(app)).toBe(2)
  await expect(winNew.locator('.ProseMirror')).toContainText(IDEAS_BODY)
  await expect.poll(() => winNew.title()).toBe(titleOf(vaultB, ideasB)) // rooted at vault B, file open
  await expect
    .poll(async () => (await readState(userData)).windows.find((w) => w.id === winParam(winNew))?.root)
    .toBe(vaultB)
  await expect.poll(() => winA.title()).toBe(titleOf(vaultA, noteA)) // vault A window untouched
  await shoot(winNew, 'g3-05-recents-link-new-window')
})

test('scenario 7 (bonus) — Finder "Open With" (open-file) rides the same link pipeline', async () => {
  const roadmapA = path.join(vaultA, 'Projects', 'Roadmap.md')
  await emitOpenFile(app, roadmapA) // main encodes it as a yaseendraw:// link and routes it

  // Routed into the existing vault-A window (its root contains the file) — no new window.
  await expect.poll(() => winA.title()).toBe(titleOf(vaultA, roadmapA))
  await expect(winA.locator('.ProseMirror')).toContainText(ROADMAP_BODY)
  expect(await windowCount(app)).toBe(2)
  await shoot(winA, 'g3-07-open-file-routed')
  await quitApp(app)
})
