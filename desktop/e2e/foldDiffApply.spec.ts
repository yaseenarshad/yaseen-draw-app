/**
 * External edits apply as diffs (YAZ-1347): the REAL built app, one pointed proof of the case
 * YAZ-1342 declared its boundary. Collapse a numbered bullet → an "agent" renumbers every line,
 * REWORDS the collapsed line itself and appends a bullet → the silent reload shows the new content,
 * the fold is still collapsed, and yaseendraw.json carries the key of the NEW label. Serial like
 * foldExternalEdit.spec.ts; screenshots are the evidence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, readState, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'AgentRenumbered.md'
const CHILD = 'child-bullet-e2e'
const KID = 'kid-bullet-e2e'
const ADDED = 'agent-added-bullet-e2e'
const BODY = `# Notes

* 1) Parent bullet
  * ${CHILD}
* 2) Second bullet
  * ${KID}
`
const RENAMED = '2) Parent bullet renamed by the agent'
const EDITED = `# Notes

* ${RENAMED}
  * ${CHILD}
* 3) Second bullet
  * ${KID}
* 4) ${ADDED}
`

let userData: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const foldKeys = async () => (await readState(userData)).folders[vault]?.folds[notePath] ?? []
const hasBulletKey = (keys: readonly string[]) => keys.some((k) => !k.startsWith('h:'))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'fda-userdata-'))
  vault = await mkdtemp(path.join(tmpdir(), 'fda-vault-'))
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, BODY)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — collapse the numbered parent; its key lands in app state', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(win.locator('.ProseMirror')).toContainText(CHILD)

  await win.locator('.ProseMirror').getByText(CHILD).hover()
  await win.locator('.outline-toggle[aria-label="Collapse 1) Parent bullet"]').click()
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()
  await expect(win.locator('.ProseMirror').getByText(KID)).toBeVisible()

  await expect.poll(async () => hasBulletKey(await foldKeys()), { timeout: 10_000 }).toBe(true)
  await shoot(win, 'fda-01-collapsed')
})

test('step 2 — the agent renumbers everything and rewords the collapsed line; the fold survives', async () => {
  await writeFile(notePath, EDITED)

  // The diff apply delivers the agent's new content...
  await expect(win.locator('.ProseMirror')).toContainText(ADDED, { timeout: 15_000 })
  // ...and the fold rides position mapping through the reword of its OWN line (YAZ-1342's retired boundary).
  await expect(win.locator('.ProseMirror').getByText(CHILD)).toBeHidden()
  await expect(win.locator(`.outline-toggle[aria-label="Expand ${RENAMED}"]`)).toBeAttached()
  await expect(win.locator('.ProseMirror').getByText(KID)).toBeVisible()

  // Persisted keys re-derive from the live label, so cold start would restore this exact fold.
  await expect.poll(async () => hasBulletKey(await foldKeys()), { timeout: 10_000 }).toBe(true)
  expect(await readFile(notePath, 'utf8')).toBe(EDITED)
  await shoot(win, 'fda-02-diff-apply-kept-fold')

  await quitApp(app)
  expect(hasBulletKey(await foldKeys())).toBe(true)
})
