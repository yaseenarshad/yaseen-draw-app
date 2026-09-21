/**
 * FOLDING AN IMAGE BULLET (YAZ-1724, the e2e half of YAZ-1709 "image collapse") against the REAL
 * app.
 *
 * WHAT IT PROVES, and why only a real app can prove it: the fold is a DECORATION (rule 5's
 * `data-outline-folded-image`, stamped by the outline fold plugin), the chip is a STYLESHEET
 * (`imageView.css` reads the decoration and shrinks the `<img>` to a text-height box), and the
 * claim that matters — a folded image row is EXACTLY as tall as a text row, so folding a page of
 * screenshots reads like a page of bullets — is a layout fact only a real Chromium can measure.
 * The unit tests pin the decoration and the CSS text; this pins the pixels.
 *
 *  1 ⌘↑ with the caret in an image bullet folds it like a parent: the chevron says
 *    `aria-expanded="false"`, the image carries `data-outline-folded-image="true"`, and the
 *    row's height equals the adjacent text-only row's to within half a pixel. The other image
 *    bullet is untouched — a fold is per item.
 *  2 a click on the folded THUMBNAIL unfolds it (the chevron's toggle, from the chip).
 *  3 an expanded image inside a foldable item shows its corner fold button on hover
 *    (`button.image-view__fold`, "Collapse image"), and a press on it folds the bullet again —
 *    and none of that is a document change: the markdown on disk is byte-identical to the
 *    fixture and its mtime never moved (rule 5 — toggles are metadata-only transactions, no
 *    autosave).
 *  4 the fold is persisted by key (`folders[root].folds[note]`), so a cold relaunch on the same
 *    user-data-dir comes back with the image bullet still folded — and still text-height.
 *
 * Same harness as imageRender.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture
 * vault, one `test.describe`, serial (each step continues the previous state), `imageFold-`
 * screenshots as evidence; the PNGs are encoded at test time by `imageFixtures.ts`.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, readState, seededState, shoot } from './helpers'
import { pngBytes } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

const NOTE = 'Shots.md'
const ROW_ONE = 'text row one'
const ROW_TWO = 'text row two'
const IMAGES_DIR = path.join('assets', 'images')
/**
 * Wider than their `|W`, so the expanded image is a real picture (400 × 150) and the fold has
 * something to shrink.
 */
const SHOT = { file: 'shot.png', bytes: pngBytes(800, 300, 17) }
const PAIR = { file: 'pair.png', bytes: pngBytes(600, 400, 43) }

/**
 * Four bullets, two of them image bullets — one image alone on its line, one with words after it.
 * Already in remark's normalised form, and the whole point is that it is never rewritten anyway.
 */
const NOTE_TEXT = `* ${ROW_ONE}\n* ![Shot|400](${IMAGES_DIR}/${SHOT.file})\n* ${ROW_TWO}\n* ![Pair|300](${IMAGES_DIR}/${PAIR.file}) and words after it\n`

/** Rule 5's decorations, as the DOM shows them. */
const FOLDED = 'data-outline-folded-image'
const FOLDABLE = 'data-outline-foldable-image'

let userData: string
let vaultSrc: string
let vault: string
let notePath: string
let mtimeBefore: number
let app: ElectronApplication
let win: Page

/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
/**
 * The four bullets in document order — Crepe's `div.milkdown-list-item-block > li.list-item` is
 * one ROW each (bullets.css).
 */
const rows = (w: Page) => editorOf(w).locator('li.list-item')
const shotRow = (w: Page) => rows(w).nth(1)
const textRow = (w: Page) => rows(w).nth(2)
const pairRow = (w: Page) => rows(w).nth(3)
const shotView = (w: Page) => shotRow(w).locator('.image-view')
const shotImg = (w: Page) => shotView(w).locator('img')
/**
 * The fold widget at the start of the item's content
 * (`li.list-item > .children > .content-dom > .outline-toggle`).
 */
const shotChevron = (w: Page) => shotRow(w).locator('.outline-toggle')

const rowHeight = (row: Locator): Promise<number> => row.evaluate((el) => el.getBoundingClientRect().height)
const readNote = () => readFile(notePath, 'utf8')
const foldKeys = async () => (await readState(userData)).folders[vault]?.folds[notePath] ?? []

/**
 * The folded chip, measured: the image row and the text row beside it are the SAME height, to
 * half a pixel.
 */
async function expectFoldedRowIsTextHeight(w: Page): Promise<void> {
  await expect(shotView(w)).toHaveAttribute(FOLDED, 'true')
  await expect(shotChevron(w)).toHaveAttribute('aria-expanded', 'false')
  const [shot, text] = await Promise.all([rowHeight(shotRow(w)), rowHeight(textRow(w))])
  expect(Math.abs(shot - text)).toBeLessThanOrEqual(0.5)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'imgfold-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  notePath = path.join(vault, NOTE)
  await mkdir(path.join(vault, IMAGES_DIR), { recursive: true })
  await Promise.all([
    writeFile(notePath, NOTE_TEXT),
    writeFile(path.join(vault, IMAGES_DIR, SHOT.file), SHOT.bytes),
    writeFile(path.join(vault, IMAGES_DIR, PAIR.file), PAIR.bytes),
  ])
  mtimeBefore = (await stat(notePath)).mtimeMs
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — ⌘↑ folds the image bullet into a chip exactly one text row tall', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, notePath) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(ROW_ONE)
  await expect(rows(win)).toHaveCount(4)

  // Expanded: a real picture, a chevron even though the bullet is a leaf (rule 5), no fold yet.
  await expect(shotView(win)).toHaveClass(/\bimage-view--ready\b/)
  await expect(shotView(win)).toHaveAttribute(FOLDABLE, 'true')
  expect(await shotView(win).getAttribute(FOLDED)).toBeNull()
  await expect(shotChevron(win)).toHaveAttribute('aria-expanded', 'true')
  // The `|400` picture stands taller than a line of text — that is what the fold takes away.
  expect(await rowHeight(shotRow(win))).toBeGreaterThan((await rowHeight(textRow(win))) + 40)
  await shoot(win, 'imageFold-01-expanded')

  // The caret in the image bullet (a click on the atom is PM's NodeSelection, inside the item),
  // then the outliner's own fold key — `Meta+ArrowUp` (hotkeys.ts, Logseq's default).
  await shotImg(win).click()
  await win.keyboard.press('Meta+ArrowUp')
  await expectFoldedRowIsTextHeight(win)
  // The key is derived from the item's label, and an image's label is its alt with the width
  // stripped.
  await expect(shotChevron(win)).toHaveAttribute('aria-label', 'Expand Shot')
  // Per item: the other image bullet is foldable but still expanded.
  await expect(pairRow(win).locator('.image-view')).toHaveAttribute(FOLDABLE, 'true')
  expect(await pairRow(win).locator('.image-view').getAttribute(FOLDED)).toBeNull()
  await shoot(win, 'imageFold-02-folded-by-key')
})

test('step 2 — a click on the thumbnail unfolds it', async () => {
  await shotImg(win).click()
  await expect.poll(() => shotView(win).getAttribute(FOLDED)).toBeNull()
  await expect(shotChevron(win)).toHaveAttribute('aria-expanded', 'true')
  await expect(shotChevron(win)).toHaveAttribute('aria-label', 'Collapse Shot')
  expect(await rowHeight(shotRow(win))).toBeGreaterThan((await rowHeight(textRow(win))) + 40)
  await shoot(win, 'imageFold-03-unfolded-by-thumbnail')
})

test('step 3 — the corner fold button appears on hover and folds it back; the file never moved', async () => {
  const fold = shotView(win).locator('button.image-view__fold')
  await expect(fold).toHaveAttribute('aria-label', 'Collapse image')
  // Shown (display) because the item is foldable and the image expanded; REVEALED (opacity) by
  // the hover.
  await shotImg(win).hover()
  await expect.poll(() => fold.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  await shoot(win, 'imageFold-04-corner-button-on-hover')

  // The plugin takes the press on mousedown, so the click never becomes a node selection.
  await fold.click()
  await expectFoldedRowIsTextHeight(win)
  await shoot(win, 'imageFold-05-folded-by-corner-button')

  // Three toggles, zero document changes: the bytes are the fixture's and the mtime is the write's.
  expect(await readNote()).toBe(NOTE_TEXT)
  expect((await stat(notePath)).mtimeMs).toBe(mtimeBefore)
})

test('step 4 — the fold is persisted by key and survives a cold relaunch, still text-height', async () => {
  await quitApp(app) // the REAL quit path: the pending state write is flushed before exit
  // Exactly one bullet fold key (heading folds are the `h:` keys) — the Shot bullet's.
  const keys = await foldKeys()
  expect(keys.filter((k) => !k.startsWith('h:'))).toHaveLength(1)
  expect(await readNote()).toBe(NOTE_TEXT)
  expect((await stat(notePath)).mtimeMs).toBe(mtimeBefore)

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(ROW_ONE)
  await expect(shotView(win)).toHaveClass(/\bimage-view--ready\b/)
  await expectFoldedRowIsTextHeight(win)
  await shoot(win, 'imageFold-06-relaunch-still-folded')
  await quitApp(app)
})
