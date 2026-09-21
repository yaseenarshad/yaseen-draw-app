/**
 * Desktop K (GRO-2218): Appearance end-to-end against the REAL app — the settings dialog's System/Light/Dark
 * control, the live dark flip in EVERY window (state:changed broadcast), persistence across a
 * relaunch, and System following the OS appearance (test-controlled via emulateMedia, so the
 * runner's actual OS theme never matters). Same harness as smoke.spec.ts: temp `--user-data-dir`,
 * COPY of a generated fixture vault, `k-` step screenshots. Serial: one launch + one relaunch.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  appWindow,
  buildFixtureVault,
  clickMenuItem,
  copyVault,
  extraWindow,
  launchApp,
  quitApp,
  readState,
  SEED_FILE,
  seededState,
  shoot,
  windowCount,
  winParam,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** `--bg` in client/src/app.css (light `:root` / `[data-theme='dark']`), as computed style reports it. */
const LIGHT_BG = 'rgb(255, 255, 255)'
const DARK_BG = 'rgb(30, 30, 30)'

const bgOf = (page: Page): Promise<string> => page.evaluate(() => getComputedStyle(document.body).backgroundColor)

/** Open the settings dialog from the sidebar-footer cog and click one Theme option by its label. */
async function pickAppearance(win: Page, label: 'System' | 'Light' | 'Dark'): Promise<void> {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  // The dialog opens on Appearance (YAZ-1679); the row is addressed by its `data-setting`.
  await win.locator('.settings-dialog [data-setting="theme"]').getByRole('button', { name: label, exact: true }).click()
  await win.keyboard.press('Escape') // close the dialog so screenshots show the app, not the modal
}

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let winA: Page
let winB: Page
let winBId: string

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'k-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('cog → Dark flips this window AND the other open window live', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, SEED_FILE)) })
  winA = await appWindow(app, 'w1')
  // Default is System; pin the emulated OS appearance to light so the baseline is deterministic.
  await winA.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => bgOf(winA)).toBe(LIGHT_BG)

  await clickMenuItem(app, 'menu.file.new-window', 'w1')
  winB = await extraWindow(app, ['w1'])
  winBId = winParam(winB)!
  await winB.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => bgOf(winB)).toBe(LIGHT_BG)

  // The REAL control: settings cog → Appearance → Dark. Explicit Dark must beat the
  // (still light) emulated OS appearance in BOTH windows — winB flips via state:changed.
  await pickAppearance(winA, 'Dark')
  await expect.poll(() => bgOf(winA)).toBe(DARK_BG)
  await expect.poll(() => bgOf(winB)).toBe(DARK_BG)
  await expect.poll(async () => (await readState(userData)).settings.theme).toBe('dark')
  await shoot(winA, 'k-01-dark-live')
})

test('relaunch restores Dark (both windows), and main mirrors it into nativeTheme', async () => {
  await quitApp(app)
  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  winA = await appWindow(app, 'w1')
  winB = await appWindow(app, winBId)
  expect(await windowCount(app)).toBe(2)
  await expect.poll(() => bgOf(winA)).toBe(DARK_BG)
  await expect.poll(() => bgOf(winB)).toBe(DARK_BG)
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')
  await shoot(winA, 'k-02-dark-restored')
})

test('back to System: the app follows the OS appearance, live in both directions', async () => {
  await pickAppearance(winA, 'System')
  await expect.poll(async () => (await readState(userData)).settings.theme).toBe('system')
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('system')

  // Test-controlled OS appearance: flip prefers-color-scheme and the window must track it live.
  await winA.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => bgOf(winA)).toBe(LIGHT_BG)
  await winA.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(() => bgOf(winA)).toBe(DARK_BG)
  await shoot(winA, 'k-03a-system-follows-dark')
  await winA.emulateMedia({ colorScheme: 'light' })
  await expect.poll(() => bgOf(winA)).toBe(LIGHT_BG)
  await shoot(winA, 'k-03b-system-follows-light')
  await quitApp(app)
})
