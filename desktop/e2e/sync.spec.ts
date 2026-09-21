/**
 * GitHub sync 4A (YAZ-1092): the happy path through the REAL app — real window, real Crepe, real
 * chip, real git, real remote. Everything below `desktop/src/main/git/` is unit-tested to death
 * against fakes; this spec is the ONE place the whole pipeline is wired end to end, so it is
 * deliberately about the seams the unit tests cannot reach: chokidar → manager → IPC broadcast →
 * React chip → IPC invoke → `git push` → a commit that actually exists on a remote.
 *
 * The remote is a LOCAL BARE REPO (`git init --bare` in a second temp dir, wired as `origin`).
 * That is not a compromise: `push`/`fetch` over a filesystem path exercise the same argv, the same
 * `execFile`, the same classification and the same refs as GitHub does — only the transport
 * differs, and the transport is the one part of this that is not ours. A spec that needed a token
 * would be a spec nobody could run.
 *
 * `<vault>/.yaseendraw/github.json` is written `{ "enabled": true }` BEFORE launch and committed
 * with the seed, and the app is never told to turn sync on. That is the SECOND-MACHINE path (D4):
 * the switch travels with the folder, and opening the vault is what adopts it (D3, adoption pulls).
 *
 * The chip's click is the instant path on purpose — the edit debounce is 30 s (`manager.ts`
 * DEFAULTS), which is longer than this suite's per-test timeout and is exactly why the chip is a
 * button (🔒 D5). What the debounce guarantees is unit-tested; what a CLICK does is this.
 *
 * Same harness as smoke.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture vault,
 * `github-sync-` step screenshots (folderSync.spec.ts already owns the bare `sync-` prefix).
 * Serial — one launch, and each step continues the last one's state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { VAULT_CONFIG_DIR } from '../../shared/types'
import { appWindow, buildFixtureVault, copyVault, LAST_BULLET, launchApp, quitApp, SEED_FILE, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const MARKER = 'sync-proof-7c2'
const BRANCH = 'main'

// ---------- the system git, driven exactly the way the app drives it ----------

/** `git/exec.ts`'s own candidate list: the runner is a dev Mac, and this spec must use ITS git. */
const GIT_CANDIDATES = ['/usr/bin/git', '/opt/homebrew/bin/git'] as const

const execFileAsync = promisify(execFile)
let gitBin = ''

async function resolveGit(): Promise<string> {
  for (const bin of GIT_CANDIDATES) {
    const st = await stat(bin).catch(() => null)
    if (st?.isFile() === true) return bin
  }
  throw new Error(`no git binary at ${GIT_CANDIDATES.join(' or ')} — this spec drives the real thing`)
}

/**
 * One git run, argv only (no shell — the app's rule, and the vault path has a space in it).
 * `GIT_TERMINAL_PROMPT=0` for the same reason `exec.ts` sets it: a prompt nobody can answer would
 * hang the whole suite rather than fail it.
 */
async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(gitBin, args, { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
  return stdout.trim()
}

/** Read a fact out of the BARE remote — the only witness that counts for "it was pushed". */
const remote = (args: string[]): Promise<string> => git(['--git-dir', bare, ...args])

// ---------- the chip ----------

/** Both chips live in one row (🔒 D5); the sync one is a button because the status IS the action. */
const chips = (w: Page) => w.locator('.status-chips')
const syncChip = (w: Page) => chips(w).locator('.sync-indicator')
const saveChip = (w: Page) => chips(w).locator('.save-indicator')

/**
 * Records every `sync-indicator--<state>` the chip WEARS, in order, so a transition can be proved
 * instead of raced for. A poll cannot catch `syncing`: it lasts exactly as long as one git pass,
 * and it is bounded by two IPC broadcasts rather than by anything this side can wait on. A
 * MutationObserver sees each one land. Test-only, and it lives entirely inside the page.
 */
async function recordChipStates(w: Page): Promise<void> {
  await w.evaluate(() => {
    const trail: string[] = []
    ;(window as unknown as { __syncTrail: string[] }).__syncTrail = trail
    const read = (): void => {
      const el = document.querySelector('.sync-indicator')
      const state = el === null ? undefined : Array.from(el.classList).find((c) => c.startsWith('sync-indicator--'))
      if (state !== undefined && trail[trail.length - 1] !== state) trail.push(state)
    }
    read()
    // The whole document, because React is free to replace the button rather than restyle it.
    new MutationObserver(read).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] })
  })
}

const chipTrail = (w: Page): Promise<string[]> => w.evaluate(() => (window as unknown as { __syncTrail: string[] }).__syncTrail)

// ---------- fixture ----------

let userData: string
let vaultSrc: string
let vault: string
let bare: string
let notePath: string
let configPath: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  gitBin = await resolveGit()
  userData = await mkdtemp(path.join(tmpdir(), 'sync-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  bare = await mkdtemp(path.join(tmpdir(), 'sync-remote-'))
  notePath = path.join(vault, SEED_FILE)
  configPath = path.join(vault, VAULT_CONFIG_DIR, 'github.json')

  // A Home the vault already has. An ADOPTED vault (one with `.yaseendraw/`) whose `[[Home]]`
  // resolves to nothing gets one written on open (YAZ-849) — a byte the sync engine would rightly
  // report as `pending` a beat after adoption, and a race this spec has no business running.
  await writeFile(path.join(vault, 'Home.md'), '# Home\n\nsynthetic-home-body\n')

  // THE SWITCH, ON, BEFORE THE APP EVER RUNS — and committed with everything else, so the working
  // tree is clean at launch and `synced` means "agrees with the remote", not "just committed".
  await mkdir(path.dirname(configPath), { recursive: true })
  await writeFile(configPath, `${JSON.stringify({ enabled: true }, null, 2)}\n`)

  await git(['init', '-b', BRANCH, vault])
  // Identity and signing are per-repo on purpose: the runner's own global git config must not be
  // able to decide whether this spec can commit.
  await git(['-C', vault, 'config', 'user.name', 'Yaseen Draw E2E'])
  await git(['-C', vault, 'config', 'user.email', 'e2e@yaseendraw.test'])
  await git(['-C', vault, 'config', 'commit.gpgsign', 'false'])
  await git(['init', '--bare', '-b', BRANCH, bare])
  await git(['-C', vault, 'remote', 'add', 'origin', bare])
  await git(['-C', vault, 'add', '-A'])
  await git(['-C', vault, 'commit', '-m', 'seed'])
  await git(['-C', vault, 'push', '-u', 'origin', BRANCH])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault, bare].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — a vault that arrives with sync already on adopts itself, and the chip says so', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText(LAST_BULLET) // the seeded note is open

  // Two chips, one row: the sync chip immediately LEFT of the per-tab save state (🔒 D5).
  await expect(syncChip(win)).toBeVisible()
  await expect(saveChip(win)).toBeVisible()

  // Nobody clicked "On": `github.json` travelled with the folder and OPENING it ran a pass (D3).
  // A clean tree that already agrees with the remote can only land on `synced`.
  await expect(syncChip(win)).toHaveClass(/sync-indicator--synced/)
  await expect(syncChip(win)).toHaveText('Synced')
  await shoot(win, 'github-sync-01-adopted-synced')
})

test('step 2 — an edit goes Pending, and ONE click on the chip commits and pushes it', async () => {
  const tipBefore = await remote(['rev-parse', BRANCH])

  // Typed into the REAL Crepe, smoke.spec.ts's gesture: append inside the existing last bullet
  // rather than pressing Enter, which remaps the caret mid-typing.
  await win.locator('.ProseMirror').getByText(LAST_BULLET).click()
  await win.keyboard.press('End')
  await win.keyboard.type(` ${MARKER}`, { delay: 15 })
  await expect(win.locator('.ProseMirror')).toContainText(MARKER)

  // Autosave (500 ms debounce) is what puts the byte on disk — and the disk is what the watcher
  // sees, so poll it rather than trusting the chip to tell us about a write it did not make.
  await expect.poll(async () => (await readFile(notePath, 'utf8')).includes(MARKER), { timeout: 10_000 }).toBe(true)
  await expect(saveChip(win)).toHaveClass(/save-indicator--saved/)

  // chokidar → manager → broadcast → chip. The instant a byte changes, the UI says "not on GitHub
  // yet"; the 30 s quiet period is about WHEN it commits, never about when it admits there is work.
  await expect(syncChip(win)).toHaveClass(/sync-indicator--pending/)
  await expect(syncChip(win)).toHaveText('Pending')
  await shoot(win, 'github-sync-02-pending')

  await recordChipStates(win)
  await syncChip(win).click() // the whole "sync now" affordance: the chip IS the button
  await expect(syncChip(win)).toHaveClass(/sync-indicator--synced/, { timeout: 20_000 })
  await expect(syncChip(win)).toHaveText('Synced')
  // It did not teleport: the pass announced itself first (`syncing`), then reported its result.
  expect(await chipTrail(win)).toEqual(['sync-indicator--pending', 'sync-indicator--syncing', 'sync-indicator--synced'])
  await shoot(win, 'github-sync-03-synced-after-click')

  // ---------- and now the only witness that matters: the BARE REMOTE ----------
  const subject = await remote(['log', '-1', '--format=%s', BRANCH])
  expect(subject.startsWith('sync:')).toBe(true)
  expect(subject).toContain(SEED_FILE)
  const tipAfter = await remote(['rev-parse', BRANCH])
  expect(tipAfter).not.toBe(tipBefore)
  expect(tipAfter).toBe(await git(['-C', vault, 'rev-parse', 'HEAD'])) // the push landed the LOCAL tip
  // The bytes themselves, read back out of the remote's object store.
  expect(await remote(['show', `${BRANCH}:${SEED_FILE}`])).toContain(MARKER)
})

test('step 3 — the settings dialog turns sync off: the chip says Sync off and the vault config agrees', async () => {
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  // One scrolling page (YAZ-1679): the Sync row is on it already, addressed by `data-setting`,
  // never by position — Playwright scrolls it into view for the click.
  const row = win.locator('.settings-dialog [data-setting="githubSync"]')
  await expect(row).toBeVisible()
  // The switch's honest read-back (3B): the vault arrived enabled, so On is the active option
  // before anything is clicked — the dialog is showing the engine's state, not a local guess.
  await expect(row.getByRole('button', { name: 'On', exact: true })).toHaveClass(/settings__option--active/)
  await expect(row.locator('.setting__hint')).toContainText(bare) // the remote it detected
  await shoot(win, 'github-sync-04-settings-on')

  await row.getByRole('button', { name: 'Off', exact: true }).click()
  await expect(row.getByRole('button', { name: 'Off', exact: true })).toHaveClass(/settings__option--active/)
  await win.keyboard.press('Escape') // close the dialog so the shot shows the app, not the modal

  // Off is immediate and total: the chip stops claiming anything about GitHub…
  await expect(syncChip(win)).toHaveClass(/sync-indicator--off/)
  await expect(syncChip(win)).toHaveText('Sync off')
  // …and the switch that travels with the vault was rewritten, not just remembered in memory.
  await expect.poll(async () => JSON.parse(await readFile(configPath, 'utf8')) as unknown, { timeout: 10_000 }).toEqual({ enabled: false })
  await shoot(win, 'github-sync-05-off')
  await quitApp(app)
})
