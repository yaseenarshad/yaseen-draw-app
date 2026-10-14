/**
 * Launching the BUILT app (`desktop/out`, from `npm run build`) for the README captures, the way
 * the E2E suite does (e2e/support/fixtures.ts): Playwright's Electron launcher, an isolated profile
 * (`YASEEN_DRAW_USER_DATA_DIR`) and `e2e/support/mainHook.cjs`, so the run never registers a URL
 * handler, never touches the real Trash and paints nothing on the desktop (windows are transparent
 * unless `show`), and `lib/quietHook.cjs`, so the invisible window takes no keyboard focus and no
 * mouse from whoever is using the Mac. The real profile and the real vault are refused outright.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron } from '@playwright/test'
import { GIT_ENV } from '../../lib/seedKit.mjs'

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const MAIN_HOOK = path.join(REPO, 'e2e/support/mainHook.cjs')
const QUIET_HOOK = path.join(REPO, 'tools/readmeMedia/lib/quietHook.cjs')
const APP_DIR = path.join(REPO, 'desktop')

/** The two places a capture run must never be pointed at. */
const FORBIDDEN = [path.join(os.homedir(), 'Library/Application Support/Yaseen Draw'), path.join(os.homedir(), 'Documents/GitHub/yaseen-draw-vault')]
export function assertScratch(dir) {
  const real = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir)
  for (const bad of FORBIDDEN) {
    if (real === bad || real.startsWith(bad + path.sep)) throw new Error(`refusing to use ${dir}: it is the real profile or the real vault`)
  }
  return real
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Starts the app on `profile`, with `work` as the hook's sandbox (the vault and the profile both
 * live under it). Returns the Electron handle and its first window, loaded.
 */
export async function launchApp({ work, profile, env = {}, show = false }) {
  assertScratch(work)
  assertScratch(profile)
  if (!fs.existsSync(path.join(APP_DIR, 'out/main/index.js'))) throw new Error('desktop/out is missing: run `npm run build` first')
  const electronPath = createRequire(import.meta.url)('electron')
  const app = await _electron.launch({
    executablePath: electronPath,
    args: ['-r', MAIN_HOOK, ...(show ? [] : ['-r', QUIET_HOOK]), APP_DIR],
    env: { ...GIT_ENV, ...env, YASEEN_DRAW_USER_DATA_DIR: profile, E2E_SANDBOX: work, ...(show ? { E2E_SHOW: '1' } : {}) },
    cwd: REPO,
    colorScheme: null, // the app's own Theme setting decides, not Playwright's emulation
  })
  app.context().setDefaultTimeout(20_000)
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

/** Quits through the app's own sequence; a process still there after 15 s is killed (only ever our own). */
export async function quitApp(app) {
  const proc = app.process()
  const exited = new Promise((resolve) => proc.once('exit', resolve))
  void app.close().catch(() => {})
  const gone = await Promise.race([exited.then(() => true), sleep(15_000).then(() => false)])
  if (!gone) {
    try {
      process.kill(-proc.pid, 'SIGKILL')
    } catch {
      proc.kill('SIGKILL')
    }
  }
}
