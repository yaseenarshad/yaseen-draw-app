/**
 * Links C (GRO-2192): wiki-link click navigation against the REAL app — real mouse events on
 * the rendered `.wikilink` decoration spans. Plain click opens in the CURRENT tab (an
 * already-open file's tab is activated, never duplicated), ⌘-click appends a BACKGROUND tab
 * (activation and the visible editor stay put), and a click on an UNRESOLVED link CREATES the
 * page at the vault root and opens it. Steps 6-7 add Links E2 (GRO-2214): a page declaring
 * frontmatter `aliases` is reachable by them — `[[CAC]]` renders RESOLVED and opens the aliased
 * page, and typing `[[cac` in the picker inserts the piped `[[Metrics|CAC]]` on disk.
 * Same harness as tabs.spec.ts (temp `--user-data-dir`, COPY of a generated fixture vault,
 * `links-` step screenshots); serial by design — each step continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  windowCount,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** Seeded on top of the fixture vault: a hub note whose body is wiki links. */
const HUB_FILE = 'Links hub.md'
const HUB_BODY = 'hub-links-body'
/** Bodies of the fixture's other files (helpers.buildFixtureVault). */
const IDEAS_BODY = 'synthetic-idea-body'
const ROADMAP_BODY = 'synthetic-roadmap-body'
/** The unresolved link's target — no such file until step 5 creates it. */
const FRESH = 'Fresh note'
/** The aliased page (E2): `Metrics.md` declares `aliases: [CAC]`, so `[[CAC]]` reaches it. */
const METRICS_FILE = 'Metrics.md'
const METRICS_BODY = 'synthetic-metrics-body'
const ALIAS = 'CAC'

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
/** The collapsed link span showing `text`, inside the VISIBLE editor only. */
const linkIn = (w: Page, text: string) => editorOf(w).locator('.wikilink', { hasText: text }).first()

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'links-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  // The hub: three resolved links (Roadmap lives in Projects/ — bare-basename resolution; CAC is
  // an ALIAS of Metrics.md — E2) and one unresolved.
  await writeFile(
    path.join(vault, HUB_FILE),
    `# Hub\n\n${HUB_BODY}\n\nGo [[Ideas]] or [[Roadmap]] or [[${ALIAS}]] or [[${FRESH}]] now.\n`,
  )
  await writeFile(path.join(vault, METRICS_FILE), `---\naliases: [${ALIAS}]\n---\n\n${METRICS_BODY}\n`)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all(
    [userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })),
  )
})

test('step 1 — the hub renders collapsed links; the index dims only the unresolved one', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, HUB_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(HUB_BODY)
  // The unresolved dimming appears only once the vault index has fed the resolve source —
  // clicks are inert before that, so every later step is gated on this styling.
  await expect(win.locator(`.wikilink--unresolved`)).toHaveText(FRESH)
  await expect(tabsOf(win)).toHaveCount(1)
  await shoot(win, 'links-01-hub-rendered')
})

test('step 2 — ⌘-click a resolved link: background tab appended, activation and editor stay put', async () => {
  await linkIn(win, 'Ideas').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Links hub', 'Ideas'])
  await expect(activeTab(win)).toHaveText('Links hub')
  await expect(editorOf(win)).toContainText(HUB_BODY) // still the hub — focus never moved
  expect(await windowCount(app)).toBe(1)

  // ⌘-click a link to an ALREADY-OPEN file: the tabs dedupe — count and activation unchanged.
  await linkIn(win, 'Ideas').click({ modifiers: ['Meta'] })
  await expect(tabsOf(win)).toHaveText(['Links hub', 'Ideas'])
  await expect(activeTab(win)).toHaveText('Links hub')
  await shoot(win, 'links-02-background-tab')
})

test('step 3 — plain click a link whose file is already open: its tab activates, no duplicate', async () => {
  await linkIn(win, 'Ideas').click()
  await expect(activeTab(win)).toHaveText('Ideas')
  await expect(editorOf(win)).toContainText(IDEAS_BODY)
  await expect(tabsOf(win)).toHaveText(['Links hub', 'Ideas']) // activated, never duplicated
  await shoot(win, 'links-03-activate-existing')
})

test('step 4 — plain click a resolved link: the target replaces the CURRENT tab (count unchanged)', async () => {
  await tabsOf(win).filter({ hasText: 'Links hub' }).click() // back on the hub
  await expect(editorOf(win)).toContainText(HUB_BODY)
  await linkIn(win, 'Roadmap').click()
  await expect(activeTab(win)).toHaveText('Roadmap')
  await expect(editorOf(win)).toContainText(ROADMAP_BODY)
  await expect(tabsOf(win)).toHaveText(['Roadmap', 'Ideas']) // the hub's slot, not a new tab
  await shoot(win, 'links-04-open-current')
})

test('step 5 — click an UNRESOLVED link: the note is created beside the hub (at the vault root) and opened', async () => {
  // Reopen the hub (replaces the Roadmap tab) and wait for the index gate again.
  await win.locator('.tree__row--file', { hasText: 'Links hub' }).click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  await expect(win.locator('.wikilink--unresolved')).toHaveText(FRESH)

  await linkIn(win, FRESH).click()
  await expect(activeTab(win)).toHaveText(FRESH) // opened in the CURRENT tab…
  await expect(tabsOf(win)).toHaveText([FRESH, 'Ideas']) // …so the count is unchanged
  // …and the file exists ON DISK at the vault root, empty: the default location is the SOURCE page's
  // folder (YAZ-1643), and the hub is seeded at the root, so 'current' == root here.
  await expect.poll(() => readFile(path.join(vault, `${FRESH}.md`), 'utf8')).toBe('')
  await shoot(win, 'links-05-create-on-click')
})

test('step 6 — an ALIAS-form link renders resolved and opens the aliased page (E2)', async () => {
  await win.locator('.tree__row--file', { hasText: 'Links hub' }).click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  await expect(win.locator('.wikilink--unresolved')).toHaveText(FRESH) // index gate: only Fresh note dims
  await expect(linkIn(win, ALIAS)).not.toHaveClass(/wikilink--unresolved/) // `[[CAC]]` found Metrics.md
  await linkIn(win, ALIAS).click()
  await expect(activeTab(win)).toHaveText('Metrics')
  await expect(editorOf(win)).toContainText(METRICS_BODY)
  await shoot(win, 'links-06-alias-resolved')
})

test('step 7 — the picker suggests the page by alias and inserts the PIPED form on disk (E2)', async () => {
  await win.locator('.tree__row--file', { hasText: 'Links hub' }).click()
  await expect(editorOf(win)).toContainText(HUB_BODY)
  // Type at the end of the hub's link paragraph (never Enter — see smoke.spec step 3).
  await editorOf(win).getByText(HUB_BODY).click()
  await win.keyboard.press('End')
  await win.keyboard.type(' [[cac', { delay: 15 })
  const suggestion = win.locator('.wikilink-picker [role="option"]')
  await expect(suggestion).toHaveText([`${ALIAS} — Metrics`]) // alias row, disambiguated by page name
  await shoot(win, 'links-07-alias-suggestion')
  await win.keyboard.press('Enter')
  await expect
    .poll(async () => (await readFile(path.join(vault, HUB_FILE), 'utf8')).includes(`[[Metrics|${ALIAS}]]`), { timeout: 10_000 })
    .toBe(true)
  await quitApp(app)
})
