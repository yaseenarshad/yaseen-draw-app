/**
 * THE LIGHTBOX AS A GALLERY (YAZ-1725, the e2e half of YAZ-1709's follow-on) against the REAL app.
 *
 * WHAT IT PROVES: the node view walks the DOCUMENT at double-click time and hands the modal every
 * image on the page in order plus the index of the one clicked (rule 30, LIGHTBOX) — no registry,
 * so what the gallery pages through is exactly what the note holds. `ImageModal.test.tsx` pins the
 * cursor arithmetic over a hand-made list; this pins that the list is the page's, built from a
 * real ProseMirror document behind a real double-click, and that the keys and the focus hand-off
 * work with a real window's focus.
 *
 *  1 double-click the SECOND of three images → the overlay opens ON it: "2 / 3", its src, its
 *    alt as the caption, both arrows live.
 *  2 → pages to "3 / 3" and the Next arrow goes dead; another → is a no-op (NO wrap-around).
 *  3 ← ← back to "1 / 3", Previous dead; another ← stays put.
 *  4 the bottom bar's own Next button pages to "2 / 3" without closing the overlay — a click in
 *    the bar is never a backdrop click — then Escape closes it and FOCUS COMES BACK to the editor
 *    (rule 30: the next keystroke must reach the caret, not `<body>`).
 *  5 a note with ONE image is the old lightbox exactly: no bar, no counter, arrows do nothing.
 *
 * Same harness as imageRender.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture
 * vault, one `test.describe`, serial, `imageGallery-` screenshots; PNGs from `imageFixtures.ts`.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'
import { pngBytes } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

const IMAGES_DIR = path.join('assets', 'images')
/**
 * Three distinct bitmaps (different sizes, different seeds) so a wrong page would show a different
 * picture.
 */
const GALLERY = {
  rel: 'Gallery.md',
  body: 'gallery-note-body',
  images: [
    { alt: 'one', file: 'one.png', bytes: pngBytes(240, 160, 11) },
    { alt: 'two', file: 'two.png', bytes: pngBytes(320, 200, 29) },
    { alt: 'three', file: 'three.png', bytes: pngBytes(200, 240, 47) },
  ],
} as const
const SINGLE = { rel: 'Single.md', body: 'single-note-body', image: { alt: 'solo', file: 'solo.png', bytes: pngBytes(260, 180, 83) } } as const

const imageLine = (alt: string, file: string) => `![${alt}](${IMAGES_DIR}/${file})`
const GALLERY_TEXT = [GALLERY.body, ...GALLERY.images.map((i) => imageLine(i.alt, i.file))].join('\n\n') + '\n'
const SINGLE_TEXT = `${SINGLE.body}\n\n${imageLine(SINGLE.image.alt, SINGLE.image.file)}\n`

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
const readyViews = (w: Page) => editorOf(w).locator('.image-view--ready')
const imgByAlt = (w: Page, alt: string) => editorOf(w).locator(`.image-view img[alt="${alt}"]`)

/**
 * The lightbox (ImageModal.tsx): one overlay, the picture, and — for more than one image — the
 * bottom bar.
 */
const overlay = (w: Page) => w.locator('.image-modal-overlay')
const modalImg = (w: Page) => overlay(w).locator('.image-modal__img')
const caption = (w: Page) => overlay(w).locator('.image-modal__caption')
const nav = (w: Page) => overlay(w).locator('.image-modal__nav')
const counter = (w: Page) => overlay(w).locator('.image-modal__count')
const prevButton = (w: Page) => overlay(w).locator('button[aria-label="Previous image"]')
const nextButton = (w: Page) => overlay(w).locator('button[aria-label="Next image"]')

/** Whether the focused element sits inside the editor — where Escape must leave it. */
const focusInEditor = (w: Page): Promise<boolean> => w.evaluate(() => document.activeElement?.closest('.ProseMirror') != null)

/** The overlay is showing image `alt` as page `n` of `m`: counter, src and caption all agree. */
async function expectPage(w: Page, alt: string, n: number, m: number): Promise<void> {
  await expect(counter(w)).toHaveText(`${n} / ${m}`)
  await expect(modalImg(w)).toHaveAttribute('src', new RegExp(`/${alt}\\.png(\\?|$)`))
  await expect(caption(w)).toHaveText(alt)
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'imggallery-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, IMAGES_DIR), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, GALLERY.rel), GALLERY_TEXT),
    writeFile(path.join(vault, SINGLE.rel), SINGLE_TEXT),
    ...GALLERY.images.map((i) => writeFile(path.join(vault, IMAGES_DIR, i.file), i.bytes)),
    writeFile(path.join(vault, IMAGES_DIR, SINGLE.image.file), SINGLE.image.bytes),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — double-click the second image: the overlay opens on it, "2 / 3"', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, GALLERY.rel)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(GALLERY.body)
  await expect(readyViews(win)).toHaveCount(3)

  await imgByAlt(win, 'two').dblclick()
  await expect(overlay(win)).toBeVisible()
  await expectPage(win, 'two', 2, 3)
  await expect(prevButton(win)).toBeEnabled()
  await expect(nextButton(win)).toBeEnabled()
  await shoot(win, 'imageGallery-01-open-at-second')
})

test('step 2 — → pages to the last, where Next is dead and another → is a no-op', async () => {
  await win.keyboard.press('ArrowRight')
  await expectPage(win, 'three', 3, 3)
  await expect(nextButton(win)).toBeDisabled()
  await expect(prevButton(win)).toBeEnabled()

  await win.keyboard.press('ArrowRight')
  await expectPage(win, 'three', 3, 3)
  await expect(overlay(win)).toBeVisible()
  await shoot(win, 'imageGallery-02-at-last-no-wrap')
})

test('step 3 — ← ← back to the first, where Previous is dead and another ← stays put', async () => {
  await win.keyboard.press('ArrowLeft')
  await win.keyboard.press('ArrowLeft')
  await expectPage(win, 'one', 1, 3)
  await expect(prevButton(win)).toBeDisabled()
  await expect(nextButton(win)).toBeEnabled()

  await win.keyboard.press('ArrowLeft')
  await expectPage(win, 'one', 1, 3)
  await shoot(win, 'imageGallery-03-at-first-no-wrap')
})

test('step 4 — the bar\'s Next button pages without closing; Escape closes and focus returns to the editor', async () => {
  await nextButton(win).click()
  await expectPage(win, 'two', 2, 3)
  await expect(overlay(win)).toBeVisible()
  await shoot(win, 'imageGallery-04-bar-next')

  await win.keyboard.press('Escape')
  await expect(overlay(win)).toHaveCount(0)
  expect(await focusInEditor(win)).toBe(true)
  await shoot(win, 'imageGallery-05-closed-focus-back')
})

test('step 5 — a single image is the old lightbox exactly: no bar, no counter', async () => {
  const row = win.locator(`.tree__row--file[data-path="${path.join(vault, SINGLE.rel)}"]`)
  await expect(row).toBeVisible()
  await row.click()
  await expect(editorOf(win)).toContainText(SINGLE.body)
  await expect(readyViews(win)).toHaveCount(1)

  await imgByAlt(win, 'solo').dblclick()
  await expect(overlay(win)).toBeVisible()
  await expect(modalImg(win)).toHaveAttribute('src', /\/solo\.png(\?|$)/)
  await expect(nav(win)).toHaveCount(0)
  await expect(counter(win)).toHaveCount(0)
  // Nothing to page to: the arrow keys are consumed by the overlay and change nothing.
  await win.keyboard.press('ArrowRight')
  await expect(overlay(win)).toBeVisible()
  await expect(modalImg(win)).toHaveAttribute('src', /\/solo\.png(\?|$)/)
  await shoot(win, 'imageGallery-06-single-image-no-bar')

  await win.keyboard.press('Escape')
  await expect(overlay(win)).toHaveCount(0)
  await quitApp(app)
})
