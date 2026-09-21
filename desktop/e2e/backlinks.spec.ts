/**
 * Links D (GRO-2193): the "Linked mentions" section against the REAL app. Two notes mention the
 * open one — Alpha by name, Gamma through the target's frontmatter ALIAS (E2, GRO-2214) — so the
 * count, the entries and the snippets all go through the ONE shared resolver. Asserted here:
 * the collapsed header carries N, expanding lists both notes with their mention lines, a click
 * opens the referencing note in the CURRENT tab, and editing a referencing note ON DISK drops N
 * LIVE (the acceptance criterion — the list rides the existing index refetch, no new watcher).
 * Same harness as links.spec.ts (temp `--user-data-dir`, COPY of a generated fixture vault,
 * `backlinks-` step screenshots); serial by design — each step continues the previous state.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The open note: the one everybody mentions. `Bee` is its frontmatter alias. */
const TARGET_FILE = 'B.md'
const TARGET_BODY = 'backlinks-target-body'
const ALIAS = 'Bee'
/** Mentions the target by NAME. */
const ALPHA_FILE = 'Alpha.md'
const ALPHA_LINE = `links to [[B]] here`
/** FN9 (GRO-2197): snippets read as the EDITOR shows the line — display text, no brackets. */
const ALPHA_SNIPPET = 'links to B here'
const ALPHA_BODY = 'backlinks-alpha-body'
/** Mentions the target by ALIAS. */
const GAMMA_FILE = 'Gamma.md'
const GAMMA_LINE = `mentions [[${ALIAS}]] by alias`
const GAMMA_SNIPPET = `mentions ${ALIAS} by alias`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

const tabsOf = (w: Page) => w.locator('.tabbar [role="tab"]')
const activeTab = (w: Page) => w.locator('.tabbar [role="tab"][aria-selected="true"]')
/** Everything below is scoped to the VISIBLE tab layer — hidden layers keep their own DOM. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const backlinks = (w: Page) => layer(w).locator('.backlinks')
const header = (w: Page) => backlinks(w).locator('.backlinks__header')
const entries = (w: Page) => backlinks(w).locator('.backlinks__note')
const snippets = (w: Page) => backlinks(w).locator('.backlinks__snippet')

/** Opens a file from the sidebar by its exact row label (basename, no extension). */
const openFromTree = (w: Page, label: string) => w.locator('.tree__row--file', { hasText: new RegExp(`^${label}$`) }).click()

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'backlinks-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await Promise.all([
    writeFile(path.join(vault, TARGET_FILE), `---\naliases: [${ALIAS}]\n---\n\n# B\n\n${TARGET_BODY}\n`),
    writeFile(path.join(vault, ALPHA_FILE), `# Alpha\n\n${ALPHA_BODY}\n\n${ALPHA_LINE}\n`),
    writeFile(path.join(vault, GAMMA_FILE), `# Gamma\n\n${GAMMA_LINE}\n`),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the open note shows "Linked mentions (2)" at the bottom, collapsed', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, TARGET_FILE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(TARGET_BODY)
  // The section appears only once the vault index has fed the source — this IS the index gate.
  await expect(header(win)).toHaveText('Linked mentions (2)')
  await expect(header(win)).toHaveAttribute('aria-expanded', 'false') // collapsed by default (locked)
  await expect(backlinks(win).locator('.backlinks__list')).toHaveCount(0)
  // It lives inside the note's own scroller, after the editor mount — it scrolls WITH the note.
  await expect(layer(win).locator('.editor-host > .backlinks')).toHaveCount(1)
  await shoot(win, 'backlinks-01-collapsed')
})

test('step 2 — expanding lists both referencing notes with their mention lines (alias included)', async () => {
  await header(win).click()
  await expect(header(win)).toHaveAttribute('aria-expanded', 'true')
  await expect(entries(win)).toHaveText(['Alpha', 'Gamma']) // path-sorted, one row per note
  await expect(snippets(win)).toHaveText([ALPHA_SNIPPET, GAMMA_SNIPPET])
  await expect(backlinks(win).locator('.backlinks__match')).toHaveText(['B', ALIAS])
  await shoot(win, 'backlinks-02-expanded')
})

test('step 3 — clicking a mention opens that note in the CURRENT tab', async () => {
  await entries(win).first().click()
  await expect(activeTab(win)).toHaveText('Alpha')
  await expect(editorOf(win)).toContainText(ALPHA_BODY)
  await expect(tabsOf(win)).toHaveCount(1) // the target's slot, not a new tab
  await shoot(win, 'backlinks-03-navigated')
})

test('step 4 — removing a link ON DISK drops the count live', async () => {
  await openFromTree(win, 'B')
  await expect(editorOf(win)).toContainText(TARGET_BODY)
  await expect(header(win)).toHaveText('Linked mentions (2)')
  // Alpha loses its link outside the app; the watcher-driven index refetch is the only feed.
  await writeFile(path.join(vault, ALPHA_FILE), `# Alpha\n\n${ALPHA_BODY}\n\nno link any more\n`)
  await expect(header(win)).toHaveText('Linked mentions (1)', { timeout: 10_000 })
  await header(win).click()
  await expect(entries(win)).toHaveText(['Gamma'])
  await shoot(win, 'backlinks-04-live-update')
  await quitApp(app)
})
