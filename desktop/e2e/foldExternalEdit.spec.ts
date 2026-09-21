/**
 * Folds survive an external/AI edit (YAZ-1342): the REAL built app, one pointed proof.
 * Collapse a bullet and a heading → an "agent" rewrites the file on disk (collapsed lines
 * untouched) → the clean-doc silent reload shows the new content, keeps BOTH folds, and
 * yaseendraw.json keeps both keys (the old bug also erased them from disk). Serial like
 * headingFold.spec.ts; screenshots are the evidence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'AgentEdited.md'
const ALPHA = 'alpha-body-e2e'
const CHILD = 'child-bullet-e2e'
const ADDED = 'agent-added-line-e2e'
const BODY = `# Part 1

Intro paragraph.

## Section A

${ALPHA}

## Section B

* Parent bullet
  * ${CHILD}
`
const EDITED = `${BODY}
${ADDED}
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const foldKeys = async () => (await readState(userData)).folders[vault]?.folds[notePath] ?? []
const hasBothKeys = (keys: readonly string[]) => keys.some((k) => k.startsWith('h:')) && keys.some((k) => !k.startsWith('h:'))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'fee-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'fee-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — collapse a heading and a bullet; both keys land in app state', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText(ALPHA)

  await win.locator('.ProseMirror h2', { hasText: 'Section A' }).hover()
  await win.locator('.heading-toggle[aria-label="Collapse Section A"]').click()
  await expect(win.locator('.ProseMirror').getByText(ALPHA)).toBeHidden()

  await win.locator('.ProseMirror').getByText(CHILD).hover()
  await win.locator('.outline-toggle').first().click()
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()

  await expect.poll(async () => hasBothKeys(await foldKeys()), { timeout: 10_000 }).toBe(true)
  await shoot(win, 'fee-01-collapsed')
})

test('step 2 — the agent edits the file on disk; the reload keeps both folds and both keys', async () => {
  await writeFile(notePath, EDITED)

  // The clean-doc silent reload delivers the agent's new content...
  await expect(win.locator('.ProseMirror')).toContainText(ADDED, { timeout: 15_000 })
  // ...and the folds whose lines the agent did not touch are still collapsed.
  await expect(win.locator('.ProseMirror').getByText(ALPHA)).toBeHidden()
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()
  await expect(win.locator('.heading-toggle[aria-label="Expand Section A"]')).toBeAttached()

  // The old bug's second half: the reload erased the persisted keys. They must survive.
  await expect.poll(async () => hasBothKeys(await foldKeys()), { timeout: 10_000 }).toBe(true)
  expect(await readFile(notePath, 'utf8')).toBe(EDITED)
  await shoot(win, 'fee-02-reload-kept-folds')

  // Quit → the flushed state still carries both keys (nothing wiped them on the way out).
  await quitApp(app)
  expect(hasBothKeys(await foldKeys())).toBe(true)
})
