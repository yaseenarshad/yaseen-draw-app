/**
 * Links E1c (GRO-2242): external rename/move resilience, against the REAL app — a file renamed
 * on disk OUTSIDE the app (node fs here, standing in for Finder/terminal/sync tools) is
 * detected and offered as a PASSIVE confirmation banner: "Looks like X became Y — update N
 * links?" — CONFIRM-FIRST, never automatic, never a dialog.
 *
 * Three flows, serial (each step continues the last):
 *  - WHILE-RUNNING (steps 1–2): rename a linked note via node fs with the app open → the
 *    watcher-driven index refetch pairs the vanished/appeared records by (size, mtime) → the
 *    banner names both paths; nothing is rewritten until Update, which repairs the open tab
 *    (label follows) and rewrites the referencing note on disk with the summary notice.
 *  - DISMISS (step 3): the banner's Dismiss rewrites NOTHING, and the hypothesis stays gone
 *    for the session (a later index refetch must not re-offer it).
 *  - COLD-START (step 4): quit (the persistent index cache flushes), rename on disk while the
 *    app is CLOSED, relaunch → the cache reconcile diff feeds the same detector → banner →
 *    Update → rewritten.
 *
 * Same harness as rename.spec.ts (temp --user-data-dir, COPY of a generated fixture vault).
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const B_BODY = 'b-external-body'
const E_BODY = 'e-external-body'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
const banner = (w: Page) => w.locator('.rename-banner')

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'ext-rename-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(path.join(vault, 'A.md'), '# A\n\nSee [[B]] here.\n'),
    writeFile(path.join(vault, 'B.md'), `# B\n\n${B_BODY}\n`),
    writeFile(path.join(vault, 'D.md'), '# D\n\nSee [[E]] here.\n'),
    writeFile(path.join(vault, 'E.md'), `# E\n\n${E_BODY}\n`),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a rename on disk while the app runs banners with both names; NOTHING rewrites before confirmation', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'B.md')) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(B_BODY)
  // Let the FIRST index snapshot land (the while-running diff needs a before-picture).
  await win.waitForTimeout(1500)

  await rename(path.join(vault, 'B.md'), path.join(vault, 'B2.md')) // the external mover

  await expect(banner(win)).toContainText('Looks like B.md became B2.md — update 1 link?')
  await shoot(win, 'ext-rename-01-banner')
  // Confirm-first, ALWAYS: the referencing note is untouched while the banner waits.
  expect(await readFile(path.join(vault, 'A.md'), 'utf8')).toContain('[[B]]')
})

test('step 2 — Update repairs the open tab and rewrites the referencing note; summary notice; banner gone', async () => {
  await banner(win).locator('button', { hasText: 'Update' }).click()

  await expect.poll(() => readFile(path.join(vault, 'A.md'), 'utf8')).toBe('# A\n\nSee [[B2]] here.\n')
  // The open tab followed through the SAME file:renamed downstream as an in-app rename.
  await expect(activeTab(win)).toHaveText('B2')
  await expect(editorOf(win)).toContainText(B_BODY)
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await expect(banner(win)).toHaveCount(0)
  await shoot(win, 'ext-rename-02-updated')
})

test('step 3 — Dismiss rewrites nothing and the hypothesis stays dismissed for the session', async () => {
  await rename(path.join(vault, 'E.md'), path.join(vault, 'E2.md'))
  await expect(banner(win)).toContainText('Looks like E.md became E2.md — update 1 link?')
  await banner(win).locator('button', { hasText: 'Dismiss' }).click()
  await expect(banner(win)).toHaveCount(0)

  // Force another watcher-driven refetch: the dismissed pair must NOT be re-offered.
  await writeFile(path.join(vault, 'Ideas.md'), '# Ideas\n\nsynthetic-idea-body touched\n')
  await win.waitForTimeout(1500)
  await expect(banner(win)).toHaveCount(0)
  // And the referencing note was never rewritten.
  expect(await readFile(path.join(vault, 'D.md'), 'utf8')).toBe('# D\n\nSee [[E]] here.\n')
  await shoot(win, 'ext-rename-03-dismissed')
  await quitApp(app) // flushes the persistent index cache — step 4's before-picture
})

test('step 4 — cold start: renamed while the app was CLOSED → the cache reconcile diff banners; Update rewrites', async () => {
  await rename(path.join(vault, 'B2.md'), path.join(vault, 'B3.md')) // moved between sessions

  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, 'A.md')) })
  win = await appWindow(app, 'w1')
  await expect(banner(win)).toContainText('Looks like B2.md became B3.md — update 1 link?')
  await shoot(win, 'ext-rename-04-cold-banner')
  expect(await readFile(path.join(vault, 'A.md'), 'utf8')).toContain('[[B2]]') // untouched until confirmed

  await banner(win).locator('button', { hasText: 'Update' }).click()
  await expect.poll(() => readFile(path.join(vault, 'A.md'), 'utf8')).toBe('# A\n\nSee [[B3]] here.\n')
  await expect(win.locator('.link-notice')).toHaveText('Updated links in 1 note')
  await expect(banner(win)).toHaveCount(0)
  await shoot(win, 'ext-rename-05-cold-updated')
  await quitApp(app)
})
