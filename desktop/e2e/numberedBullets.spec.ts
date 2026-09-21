/**
 * Numbered bullets (YAZ-732, C2): the block-handle context menu's "Number children" row flips a
 * bullet's direct child list to an ordered list (and back), without touching text — the
 * hand-typed `1) Setup` prefix stays (D2). Proven through the REAL app: menu → GUI labels →
 * autosaved markdown on disk → the system clipboard (`1.` markers, `<ol>`) → one-step undo.
 * Serial: the steps share one app and the real clipboard.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Numbered.md'
// The fixture includes legacy explicit escapes; YAZ-1329 canonicalizes them away when the row is
// saved as a bullet, while preserving the visible `1) x` text and preventing CommonMark nesting.
const NOTE_BODY = '# Numbered\n\n* Fundamentals\n  * 1\\) Setup\n    * deep\n  * 2\\) VS Code\n  * 3\\) WisprFlow\n'
const CHILDREN = ['1) Setup', '2) VS Code', '3) WisprFlow']

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let app: ElectronApplication
let win: Page

const editorOf = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .ProseMirror')
/** Direct-child path from a `li.list-item` to its own paragraph (nested rows have their own). */
const PARA = 'xpath=./div[contains(@class,"children")]/div[contains(@class,"content-dom")]/p'
/** The `li.list-item` whose OWN paragraph is `text` — "Fundamentals" does not match its children. */
const rowOf = (w: Page, text: string): Locator =>
  editorOf(w)
    .locator('li.list-item')
    .filter({ has: w.locator(`${PARA}[normalize-space(.)="${text}"]`) })
const paraOf = (row: Locator) => row.locator(PARA)
const labelOf = (row: Locator) => row.locator('xpath=./div[contains(@class,"label-wrapper")]//*[contains(@class,"label")]').first()
const menu = (w: Page) => w.locator('.ctx-menu--editor')
const menuRow = (w: Page) => menu(w).locator('.ctx-menu__item')

/**
 * Hover a row's paragraph so Crepe's block handle attaches to it (its mousemove is throttled
 * 200ms, so retry the hover until the handle shows ON THIS ROW — it may still be showing on the
 * previously hovered row; alternating x so Chromium does not dedupe the mousemove), then
 * right-click the 6-dot glyph (the LAST `.operation-item` — the plus is display:none).
 */
async function openHandleMenu(w: Page, text: string): Promise<void> {
  // 60s, so the 30s `toPass` budget below is actually SPENDABLE (YAZ-861): the config's per-test
  // timeout is 30s, which the probe alone would exhaust — step 5 opens the menu twice. Set here
  // rather than per test so it covers every caller, present and future; healthy runs spend none.
  test.setTimeout(60_000)
  const para = paraOf(rowOf(w, text))
  const handle = w.locator('.tabstack__layer:not(.tabstack__layer--hidden) .milkdown-block-handle')
  await expect(async () => {
    // A SWEEP, not discrete hops (the YAZ-861 rework, after the two-hop version flaked across
    // three waves): the handle's mousemove listener is throttled ~200ms, and any finite set of
    // synthetic single events can land entirely inside stale throttle windows on a loaded
    // machine. `mouse.move(..., steps)` emits a continuous stream of real events while the
    // pointer crosses the paragraph — some event ALWAYS falls in a fresh window over this row.
    const box = await para.boundingBox()
    if (box === null) throw new Error('paragraph not laid out yet')
    await w.mouse.move(box.x - 10, box.y + 8) // enter from outside so the crossing is real
    await w.mouse.move(box.x + Math.min(80, box.width / 2), box.y + box.height / 2, { steps: 12 })
    await expect(handle).toHaveAttribute('data-show', 'true', { timeout: 1000 })
    const [p, h] = await Promise.all([para.boundingBox(), handle.boundingBox()])
    const mid = h!.y + h!.height / 2
    expect(mid).toBeGreaterThanOrEqual(p!.y)
    expect(mid).toBeLessThanOrEqual(p!.y + p!.height)
    // Hover-probe headroom under full-suite load (YAZ-819 → YAZ-847 → YAZ-848 → YAZ-904): every
    // wave that adds a spec ahead of this one leaves the machine warmer here, and the throttled
    // mousemove is the first thing to feel it. Raised again with 6B-'s `topics.spec.ts`, and again
    // with 8H-'s `folderPageOutline.spec.ts`, which sorts ahead of this file and drives a second
    // Milkdown instance. Healthy runs pass on the FIRST attempt and never spend any of this — the
    // budget only buys retries. NOTE the budget is only spendable because the steps that call this
    // raise their OWN timeout past it: a 30s probe inside a 30s test can never retry at all.
  }).toPass({ timeout: 30_000 })
  await handle.locator('.operation-item').last().click({ button: 'right' })
  await expect(menu(w)).toBeVisible()
}

const diskHasNumbers = async () => /^ *1\. 1\\\) Setup$/m.test(await readFile(notePath, 'utf8'))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'numbered-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await writeFile(notePath, NOTE_BODY)
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText('WisprFlow')
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — right-click on the handle of "Fundamentals" offers exactly "Number children"', async () => {
  test.setTimeout(60_000) // room for openHandleMenu's documented retry budget (YAZ-904)
  for (const text of CHILDREN) await expect(labelOf(rowOf(win, text))).toHaveClass(/\bbullet\b/)
  await openHandleMenu(win, 'Fundamentals')
  await expect(menuRow(win)).toHaveCount(1)
  await expect(menuRow(win)).toHaveText('Number children')
  await expect(menuRow(win)).toBeEnabled()
  await shoot(win, 'numbered-menu')
})

test('step 2 — Number children: 1. 2. 3. labels, grandchild stays a bullet, text untouched, disk has 1. markers', async () => {
  await menuRow(win).click()
  await expect(menu(win)).toBeHidden()
  for (const [i, text] of CHILDREN.entries()) {
    const label = labelOf(rowOf(win, text))
    await expect(label).toHaveClass(/\bordered\b/)
    await expect(label).toHaveText(`${i + 1}.`)
  }
  await expect(labelOf(rowOf(win, 'deep'))).toHaveClass(/\bbullet\b/)
  await expect(editorOf(win)).toContainText('1) Setup') // D2: the hand-typed prefix is never touched
  await shoot(win, 'numbered-after')
  await expect.poll(diskHasNumbers, { timeout: 10_000 }).toBe(true)
  const md = await readFile(notePath, 'utf8')
  expect(md).toMatch(/^ *2\. 2\\\) VS Code$/m)
  expect(md).toMatch(/^ *3\. 3\\\) WisprFlow$/m)
  expect(md).toMatch(/^ *\* deep$/m)
  expect(md).toMatch(/^\* Fundamentals$/m)
})

test('step 3 — copying the three children puts 1. markers on text/plain and an <ol> on text/html', async () => {
  const first = paraOf(rowOf(win, CHILDREN[0]))
  const last = paraOf(rowOf(win, CHILDREN[2]))
  // Left edge of the paragraph so Home / Shift+End span exactly the three rows.
  await first.click({ position: { x: 1, y: 8 } })
  await win.keyboard.press('Home')
  await last.click({ modifiers: ['Shift'], position: { x: 1, y: 8 } })
  await win.keyboard.press('Shift+End')
  await expect.poll(() => win.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('WisprFlow')
  await win.keyboard.press('ControlOrMeta+c')
  await expect
    .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()), { timeout: 5_000 })
    .toMatch(/1\. 1\\?\) Setup/)
  const text = await app.evaluate(({ clipboard }) => clipboard.readText())
  const html = await app.evaluate(({ clipboard }) => clipboard.readHTML())
  expect(text).toMatch(/2\. 2\\?\) VS Code/)
  expect(text).toMatch(/3\. 3\\?\) WisprFlow/)
  expect(html).toContain('<ol')
})

test('step 4 — one undo restores the bullets in the GUI and on disk', async () => {
  await win.keyboard.press('ControlOrMeta+z')
  for (const text of CHILDREN) await expect(labelOf(rowOf(win, text))).toHaveClass(/\bbullet\b/)
  await expect.poll(diskHasNumbers, { timeout: 10_000 }).toBe(false)
  expect(await readFile(notePath, 'utf8')).toMatch(/^ *\* 1\) Setup$/m)
})

test('step 5 — re-number, then the row reads "Bullet children" and flips back', async () => {
  test.setTimeout(90_000) // TWO hover probes, so twice the documented retry budget (YAZ-904)
  await openHandleMenu(win, 'Fundamentals')
  await expect(menuRow(win)).toHaveText('Number children')
  await menuRow(win).click()
  await expect(labelOf(rowOf(win, CHILDREN[0]))).toHaveClass(/\bordered\b/)
  await openHandleMenu(win, 'Fundamentals')
  await expect(menuRow(win)).toHaveText('Bullet children')
  await expect(menuRow(win)).toBeEnabled()
  await menuRow(win).click()
  await expect(menu(win)).toBeHidden()
  for (const text of CHILDREN) await expect(labelOf(rowOf(win, text))).toHaveClass(/\bbullet\b/)
  await expect.poll(diskHasNumbers, { timeout: 10_000 }).toBe(false)
})

test('step 6 — a leaf ("deep") still shows the row, disabled', async () => {
  test.setTimeout(60_000) // room for openHandleMenu's documented retry budget (YAZ-904)
  await openHandleMenu(win, 'deep')
  await expect(menuRow(win)).toHaveCount(1)
  await expect(menuRow(win)).toHaveText('Number children')
  await expect(menuRow(win)).toBeDisabled()
  await shoot(win, 'numbered-leaf-disabled')
  await win.keyboard.press('Escape')
  await expect(menu(win)).toBeHidden()
})
