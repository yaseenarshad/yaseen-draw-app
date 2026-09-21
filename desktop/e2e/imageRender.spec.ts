/**
 * RENDERING AN IMAGE (YAZ-1669, phase 4B of YAZ-1656 "images first-class") against the REAL app:
 * the `app://vault/` protocol, the node view's three states, the resize handles and Copy Image.
 *
 * WHAT IT PROVES, and why only a real app can prove it: link RESOLUTION lives in MAIN
 * (`fs/assets.ts`'s `resolveAsset`, reached through `main/vaultProtocol.ts`), the `<img>` that
 * asks for it lives in the RENDERER, and the answer is a real HTTP-shaped response Chromium
 * either decodes or errors on. A unit test can check either half; only this can check that
 * "what Obsidian would show, this shows" — one note, one screenful, every reference shape at once:
 *
 *   ✓ `images/a.png`            note-relative      → resolution step 1 (a note's own file wins)
 *   ✓ `assets/images/b.png`     root-relative      → step 2 (what a paste writes, YAZ-1668)
 *   ✓ `deep.png`                basename only      → step 3, Obsidian's shortest-path walk
 *   ✓ `images/has%20space.png`  percent-encoded    → decoded ONCE, so the file on disk is found
 *   ✗ `images/nope.png`         missing            → the inert broken chip, naming the src AS WRITTEN
 *   ✗ `../../outside.png`       escapes the vault  → broken EVEN THOUGH the file really exists there
 *   ✗ `blob:app://yaseen/dead`  a dead blob URL    → schemed srcs pass through and honestly fail
 *   – a fenced code block holding an image line    → text, never a node: code is code
 *   – `![[wiki.png]]`                              → not an image node at all (only `.excalidraw`
 *                                                    embeds are special, `drawingPreview.ts`)
 *   ✓ `![alt|300](images/a.png)`                   → Obsidian's width syntax, on the `<img>` itself (as `--image-width`)
 *
 * Then the two gestures a rendered image has:
 *  - RESIZE (🔒 D3): the west handle grows the image as the pointer moves LEFT, the width is
 *    committed to the document ONCE on mouseup as `alt|<width>`, autosave puts it on disk, and
 *    ⌘Z takes it back out — the width is markdown, so undo must reach it like any other edit.
 *  - COPY IMAGE (D7): the context menu's own action, driven through `webContents.copyImageAt`,
 *    puts real pixels on the system clipboard.
 *
 * Same harness as drawing.spec.ts: temp `--user-data-dir`, a COPY of a generated fixture vault,
 * one `test.describe`, serial (each step continues the previous state), `imageRender-` screenshots.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'
import { SMALL_HEIGHT, SMALL_WIDTH, smallPng } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

const NOTE = path.join('Guides', 'Cases.md')
const NOTE_BODY = 'cases-note-body'

/** In-vault image files, vault-relative. Each is a real 240×160 PNG (`imageFixtures.ts`). */
const VAULT_IMAGES = [
  path.join('Guides', 'images', 'a.png'),
  path.join('Guides', 'images', 'has space.png'),
  path.join('assets', 'images', 'b.png'),
  path.join('Archive', 'x', 'y', 'deep.png'),
  // The `![[wiki.png]]` target: it EXISTS, so the assertion below is about the syntax, not the file.
  'wiki.png',
] as const

/** A real image the note points at with `../../outside.png` — outside the vault, so still refused. */
const OUTSIDE_IMAGE = 'outside.png'

/**
 * Every reference shape, one per block, in the order the assertions read them. Already in remark's
 * normalised form so the first autosave (step 2's resize) changes only what the resize changed.
 */
const NOTE_TEXT = [
  NOTE_BODY,
  '![a](images/a.png)',
  '![b](assets/images/b.png)',
  '![deep](deep.png)',
  '![space](images/has%20space.png)',
  '![nope](images/nope.png)',
  '![out](../../outside.png)',
  '![blob](blob:app://yaseen/dead)',
  '```\n![fenced](images/a.png)\n```',
  '![[wiki.png]]',
  '![sized|300](images/a.png)',
].join('\n\n') + '\n'

/** The refs that must LOAD, by the alt each one carries; five `<img>`s with real pixels. */
const GOOD_ALTS = ['a', 'b', 'deep', 'space', 'sized'] as const
/** The refs that must BREAK, by the src the chip has to name back verbatim. */
const BROKEN_SRCS = ['images/nope.png', '../../outside.png', 'blob:app://yaseen/dead'] as const

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
/** The YAZ-1656 node view: every one of them, the loaded ones, and the broken chips. */
const imageViews = (w: Page) => editorOf(w).locator('.image-view')
const readyViews = (w: Page) => editorOf(w).locator('.image-view--ready')
const brokenChips = (w: Page) => editorOf(w).locator('.image-view__broken')
/** One image by its alt — unique here, and the only stable name a node view has. */
const imgByAlt = (w: Page, alt: string) => editorOf(w).locator(`.image-view img[alt="${alt}"]`)
const viewByAlt = (w: Page, alt: string) => editorOf(w).locator(`.image-view:has(img[alt="${alt}"])`)

const readNote = () => readFile(path.join(vault, NOTE), 'utf8')
/** What the browser actually decoded — 0 (or a throw) when the src never loaded. */
const naturalWidthOf = (img: Locator): Promise<number> => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)
/**
 * The width the node view put on the `<img>` — the `--image-width` custom property (not
 * `style.width`, so the YAZ-1709 folded chip can override it); empty when the alt carries no `|W`.
 */
const styleWidthOf = (img: Locator): Promise<string> => img.evaluate((el) => (el as HTMLImageElement).style.getPropertyValue('--image-width'))

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'imgrender-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.join(vault, 'Guides', 'images'), { recursive: true })
  await mkdir(path.join(vault, 'assets', 'images'), { recursive: true })
  await mkdir(path.join(vault, 'Archive', 'x', 'y'), { recursive: true })
  await Promise.all([
    writeFile(path.join(vault, NOTE), NOTE_TEXT),
    ...VAULT_IMAGES.map((rel, i) => writeFile(path.join(vault, rel), smallPng(i * 7))),
    // OUTSIDE the vault copy, deliberately: the escape must be refused because it is an escape,
    // not because the file happens to be missing. `<vault>/Guides/../../outside.png` is exactly here.
    writeFile(path.join(vault, '..', OUTSIDE_IMAGE), smallPng(99)),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await rm(path.join(vault, '..', OUTSIDE_IMAGE), { force: true }).catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — every reference shape resolves the way Obsidian would, or breaks honestly', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, NOTE)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(NOTE_BODY)

  // Eight image NODES: the five that load and the three that cannot. The fenced line and the
  // wiki embed are not among them — see below.
  await expect(imageViews(win)).toHaveCount(8)
  await expect(readyViews(win)).toHaveCount(5)
  await expect(brokenChips(win)).toHaveCount(3)

  // --- the good refs: main resolved each one, and Chromium decoded real pixels ---
  for (const alt of GOOD_ALTS) {
    await expect.poll(() => naturalWidthOf(imgByAlt(win, alt)), { timeout: 10_000 }).toBe(SMALL_WIDTH)
  }

  // --- the bad refs: an inert chip naming the src AS WRITTEN, so the line stays fixable ---
  expect(await brokenChips(win).allTextContents()).toEqual(BROKEN_SRCS.map((src) => `Broken image: ${src}`))

  // --- code is code: the fenced image line is TEXT, and CodeMirror holds it ---
  await expect(layer(win).locator('.cm-content')).toContainText('![fenced](images/a.png)')
  await expect(layer(win).locator('.cm-content .image-view')).toHaveCount(0)

  // --- `![[wiki.png]]` is not an image node: only `.excalidraw` embeds are special (YAZ-878),
  //     every other `![[…]]` renders exactly as it always did — as its own text.
  await expect(editorOf(win)).toContainText('![[wiki.png]]')
  await expect(editorOf(win).locator('.image-view img[src*="wiki.png"]')).toHaveCount(0)

  // --- Obsidian's `|300`: on the `<img>`, never on the file (the PNG is still 240 wide) ---
  expect(await styleWidthOf(imgByAlt(win, 'sized'))).toBe('300px')
  expect(await naturalWidthOf(imgByAlt(win, 'sized'))).toBe(SMALL_WIDTH)
  // …and the un-sized twin of the same file carries no width at all (empty when the alt has no `|W`).
  expect(await styleWidthOf(imgByAlt(win, 'a'))).toBe('')

  await shoot(win, 'imageRender-01-all-reference-shapes')
})

test('step 2 — the west handle resizes into `alt|width` on disk; ⌘Z takes it straight back out', async () => {
  // A single click on an atom is ProseMirror's stock NodeSelection, and that is what shows the handles.
  await imgByAlt(win, 'a').click()
  await expect(viewByAlt(win, 'a')).toHaveClass(/\bis-selected\b/)
  await shoot(win, 'imageRender-02-selected-with-handles')

  const handle = viewByAlt(win, 'a').locator('[data-handle="w"]')
  await expect(handle).toBeVisible()
  const box = await handle.boundingBox()
  if (box === null) throw new Error('the west handle has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2

  // West grows the image as the pointer moves LEFT (`sx = -1`), so −50px is +50px of width:
  // 240 natural → ~290. The ceiling is the editor column, which is far wider than that here.
  await win.mouse.move(x, y)
  await win.mouse.down()
  await win.mouse.move(x - 50, y, { steps: 10 })
  await win.mouse.up()

  // ONE document change per gesture, written on mouseup and autosaved — the width is markdown.
  const widthRe = /!\[a\|(\d+)]\(images\/a\.png\)/
  await expect.poll(readNote, { timeout: 10_000 }).toMatch(widthRe)
  const committed = Number(widthRe.exec(await readNote())![1])
  // A pixel or two of slack for where the synthetic pointer actually landed; the point is that
  // the drag's travel — not some default — is what got written.
  expect(committed).toBeGreaterThan(SMALL_WIDTH + 40)
  expect(committed).toBeLessThan(SMALL_WIDTH + 60)
  expect(await styleWidthOf(imgByAlt(win, 'a'))).toBe(`${committed}px`)
  await shoot(win, 'imageRender-03-resized')

  // --- undo: out of the editor markup first, then off the disk on the next autosave ---
  await win.keyboard.press('Meta+z')
  await expect.poll(() => styleWidthOf(imgByAlt(win, 'a'))).toBe('')
  await expect.poll(readNote, { timeout: 10_000 }).toContain('![a](images/a.png)')
  expect(await readNote()).not.toMatch(widthRe)
  // The sized twin was never touched: undo reached exactly the one node the drag changed.
  expect(await readNote()).toContain('![sized|300](images/a.png)')
  expect(await styleWidthOf(imgByAlt(win, 'sized'))).toBe('300px')
  await shoot(win, 'imageRender-04-undone')
})

test('step 3 — Copy Image puts real pixels on the system clipboard', async () => {
  await app.evaluate(({ clipboard }) => clipboard.clear())
  expect(await app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty())).toBe(true)

  const box = await imgByAlt(win, 'a').boundingBox()
  if (box === null) throw new Error('the image has no box')
  // `copyImageAt` takes DIPs measured from the top-left of the WEB CONTENTS, which is exactly
  // what `boundingBox()` returns (CSS px from the viewport origin) — the app never zooms, so
  // 1 CSS px = 1 DIP and the numbers pass straight through. devicePixelRatio scales the BITMAP
  // Chromium copies, never the coordinates it is asked for, so nothing is divided here.
  await app.evaluate(({ BrowserWindow }, point) => {
    // Single-window spec, so `[0]` is w1 — the same window every other gesture drives.
    BrowserWindow.getAllWindows()[0].webContents.copyImageAt(point.x, point.y)
  }, { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) })

  // The copy is asynchronous (main asks the renderer for the bitmap), so poll the pasteboard.
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readImage().isEmpty()), { timeout: 10_000 }).toBe(false)
  const size = await app.evaluate(({ clipboard }) => clipboard.readImage().getSize())
  expect(size.width).toBeGreaterThan(0)
  expect(size.height).toBeGreaterThan(0)
  // It is THIS image: the source bitmap's own aspect ratio, not the resized display box.
  expect(size.width / size.height).toBeCloseTo(SMALL_WIDTH / SMALL_HEIGHT, 1)
  await shoot(win, 'imageRender-05-copy-image')

  // The context menu ROWS themselves ("Copy Image", "Reveal in Finder") are unit-tested in main
  // (`desktop/src/main/menu.test.ts` over `buildContextMenuTemplate` with `mediaType: 'image'`):
  // a native `Menu.popup()` is an OS-owned window Playwright cannot see or click, so driving one
  // from here would be a flaky test of Electron rather than of this feature. What this spec owes
  // the menu is the other half — that an image is really rendered under the cursor for it to act
  // on, and that its action's effect (the clipboard above) is real.
  await expect(readyViews(win)).toHaveCount(5)

  await quitApp(app)
})
