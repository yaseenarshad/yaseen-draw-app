/**
 * Heading folding end-to-end (YAZ-1140, issue 4): the REAL built app, a heading-based note.
 * Chevron click → section hidden → `h:` key reaches yaseendocs.json → quit → relaunch → fold
 * restored — with a bullet fold coexisting in the same file's bucket the whole way (decision D3:
 * one `folds` bucket, two key spaces). Serial like smoke.spec.ts; screenshots are the evidence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Sections.md'
const ALPHA = 'alpha-body-e2e'
const BETA = 'beta-body-e2e'
const CHILD = 'child-bullet-e2e'
const BODY = `# Part 1

Intro paragraph.

## Section A

${ALPHA}

## Section B

${BETA}

* Parent bullet
  * ${CHILD}
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'hf-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'hf-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — the seeded note opens with a chevron per foldable heading', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText(ALPHA)
  // Part 1, Section A, Section B — H1/H2 with non-empty sections; nothing else.
  await expect(win.locator('.heading-toggle')).toHaveCount(3)
})

test('step 2 — collapsing Section A hides exactly its body and lands an h: key in app state', async () => {
  const noteBefore = await readFile(notePath, 'utf8')
  await win.locator('.ProseMirror h2', { hasText: 'Section A' }).hover() // reveal (opacity)
  await win.locator('.heading-toggle[aria-label="Collapse Section A"]').click()

  await expect(win.locator('[data-heading-folded="true"]').first()).toBeAttached()
  await expect(win.locator('.ProseMirror').getByText(ALPHA)).toBeHidden()
  await expect(win.locator('.ProseMirror').getByText(BETA)).toBeVisible()

  // A bullet fold in the same file: the two kinds share one bucket without clobbering (D3).
  await win.locator('.ProseMirror').getByText(CHILD).hover()
  await win.locator('.outline-toggle').first().click()
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()

  // Both keys reach yaseendocs.json (store debounces 150 ms); the file on disk never changes.
  await expect
    .poll(async () => {
      const folds = (await readState(userData)).folders[vault]?.folds[notePath] ?? []
      return folds.some((k) => k.startsWith('h:')) && folds.some((k) => !k.startsWith('h:'))
    }, { timeout: 10_000 })
    .toBe(true)
  expect(await readFile(notePath, 'utf8')).toBe(noteBefore)
  await shoot(win, 'hf-01-collapsed')
})

test('step 3 — quit flushes; relaunch restores both folds from the shared bucket', async () => {
  await quitApp(app)
  const flushed = await readState(userData)
  const folds = flushed.folders[vault]?.folds[notePath] ?? []
  expect(folds.some((k) => k.startsWith('h:'))).toBe(true)
  expect(folds.some((k) => !k.startsWith('h:'))).toBe(true)

  app = await launchApp({ userData }) // NO re-seed: whatever quit wrote is what restores
  win = await appWindow(app, flushed.windows[0].id)
  await expect(win.locator('[data-heading-folded="true"]').first()).toBeAttached()
  await expect(win.locator('.ProseMirror').getByText(ALPHA)).toBeHidden()
  await expect(win.locator('.ProseMirror').getByText(BETA)).toBeVisible()
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()
  await expect(win.locator('.heading-toggle[aria-label="Expand Section A"]')).toBeAttached()
  await shoot(win, 'hf-02-relaunch-restored')
  await quitApp(app)
})
