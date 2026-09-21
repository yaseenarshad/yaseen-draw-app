/**
 * PASTING AN IMAGE (YAZ-1668, phase 4A of YAZ-1656 "images first-class") against the REAL app and
 * the REAL system clipboard.
 *
 * WHAT IT PROVES — the paste contract end to end, which no unit test can reach because every
 * link in it is somebody else's process: Electron's clipboard holds real pixels, Chromium turns
 * them into a `File` on the paste event, `insertImage.ts` writes them through the bridge into the
 * vault, remark serializes the node, autosave puts it on disk, and main's `app://vault/` protocol
 * serves the file back to the `<img>` that now stands in the note.
 *
 * WHY IT MATTERS, clause by clause:
 *  1 a wide screenshot lands as a FILE in `assets/images/`, never as a blob in the markdown, and
 *    the note gains exactly one line — `![<name>|400](assets/images/<name>.png)`. The `|400`
 *    (`PASTED_IMAGE_WIDTH`) is display width only: the FILE keeps every pixel it arrived with.
 *  2 a NARROW image is left at its natural size — a 16px icon must never be blown up to 400.
 *  3 from a NESTED note the link is still ROOT-relative (`assets/images/…`, never `../../`),
 *    which is what makes the same line resolve from anywhere in the vault — and it renders.
 *  4 inside a fenced code block a pasted image writes NOTHING and inserts NOTHING. The fence is
 *    CodeMirror's (Crepe's `CodeMirror` feature), so the guard being proved here is that the
 *    image path never reaches over a focused fence — from ProseMirror's side the selection is a
 *    NodeSelection whose parent is the doc, not code, so a leak here would silently REPLACE the
 *    user's code block with a picture.
 *  5 the same image pasted three times is three files: writes are create-only, so a same-second
 *    collision retries `-2`, `-3` and nothing is ever overwritten.
 *  6 and it all survives the app: quit, relaunch cold, the image is still on the page — and a
 *    re-save that changes nothing leaves the markdown BYTE-IDENTICAL (no `|400` drift, no src
 *    rewrite, no re-encoding of the link).
 *
 * ON THE BYTES: the assertion is "a real PNG of the fixture's pixel dimensions", not a byte-for-
 * byte compare with the fixture file. The clipboard is a PIXEL surface — `nativeImage` decodes
 * the fixture on the way in and Chromium re-encodes on the way out — so identical bytes were
 * never on offer through a real clipboard, and demanding them would be a test of Skia's PNG
 * encoder rather than of this feature. What matters is what the feature promises: the file is a
 * decodable image of the right size, whole, and never re-sized to the display width.
 *
 * Same harness as drawing.spec.ts / pasteRoundTrip.spec.ts: temp `--user-data-dir`, a COPY of a
 * generated fixture vault, one `test.describe`, serial (each step continues the previous state),
 * `imagePaste-` step screenshots as evidence.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, buildFixtureVault, copyVault, expandDirs, launchApp, quitApp, seededState, shoot } from './helpers'
import { NARROW_HEIGHT, NARROW_PNG, NARROW_WIDTH, WIDE_HEIGHT, WIDE_PNG, WIDE_WIDTH, isPng, pngSize } from './imageFixtures'

test.describe.configure({ mode: 'serial' })

/** `insertImage.ts`'s `IMAGES_DIR` and `PASTED_IMAGE_WIDTH`, restated (importing that module would
    pull the renderer's `api` bridge into the Node test process). A drift here is a real failure. */
const IMAGES_DIR = path.join('assets', 'images')
const PASTED_IMAGE_WIDTH = 400

/**
 * One note per paste so every assertion can be the note's WHOLE bytes rather than a substring —
 * each body line is both the editor-is-ready gate and the "nothing else moved" baseline. Already
 * in remark's normalised form, so the only diff a save can make is the inserted image line.
 */
const NOTES = {
  paste: { rel: 'Paste.md', body: 'paste-note-body' },
  narrow: { rel: 'Narrow.md', body: 'narrow-note-body' },
  nested: { rel: path.join('Guides', 'Deep', 'Nested.md'), body: 'nested-note-body' },
  repeat: { rel: 'Repeat.md', body: 'repeat-note-body' },
} as const

/** The fenced-code note: CodeMirror owns this block, and a paste into it must do nothing at all. */
const CODE_NOTE = 'Code.md'
const CODE_BODY = 'code-fence-body'
const CODE_NOTE_TEXT = `\`\`\`\n${CODE_BODY}\n\`\`\`\n`

/** `<note-with-spaces-as-dashes>-<yyyyMMdd-HHmmss>[-N].<ext>` — `insertImage.ts`'s `imageName`. */
const imageNameRe = (stem: string) => new RegExp(`^${stem}-(\\d{8}-\\d{6})(?:-(\\d+))?\\.png$`)

let userData: string
let vaultSrc: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE editor — hidden per-tab layers keep their own `.ProseMirror` mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const editorOf = (w: Page) => layer(w).locator('.ProseMirror')
/** The YAZ-1656 node view, in its three states. */
const imageViews = (w: Page) => editorOf(w).locator('.image-view')
const readyImages = (w: Page) => editorOf(w).locator('.image-view--ready img')

const noteFile = (rel: string) => path.join(vault, rel)
const readNote = (rel: string) => readFile(noteFile(rel), 'utf8')
const listImages = async (): Promise<string[]> => (await readdir(path.join(vault, IMAGES_DIR)).catch(() => [])).sort()
const readImageFile = (name: string) => readFile(path.join(vault, IMAGES_DIR, name))

/** What the browser actually decoded — 0 (or a throw) when the src never loaded. */
const naturalWidthOf = (img: Locator): Promise<number> => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'imgpaste-userdata-'))
  vaultSrc = await buildFixtureVault()
  vault = await copyVault(vaultSrc)
  await mkdir(path.dirname(noteFile(NOTES.nested.rel)), { recursive: true })
  await Promise.all([
    ...Object.values(NOTES).map((n) => writeFile(noteFile(n.rel), `${n.body}\n`)),
    writeFile(noteFile(CODE_NOTE), CODE_NOTE_TEXT),
  ])
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vaultSrc, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

/**
 * Real pixels on the REAL system clipboard. `nativeImage.createFromBuffer` decodes the fixture
 * PNG; `clipboard.writeImage` puts the bitmap on the pasteboard, which is what a screenshot
 * (⇧⌘4) leaves behind — the case this whole feature exists for.
 */
async function putImageOnClipboard(bytes: Buffer): Promise<void> {
  await app.evaluate(({ clipboard, nativeImage }, b64) => {
    clipboard.clear()
    clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(b64, 'base64')))
  }, bytes.toString('base64'))
}

/**
 * ⌘V, the only way it can be driven from here: a CDP key event carries no clipboard payload, so
 * Chromium's editing layer ignores it. `webContents.paste()` IS the ⌘V menu command — the same
 * door pasteRoundTrip.spec.ts uses, and it fires a genuine `paste` event at the focused element.
 */
async function pressPaste(): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('win=w1'))!
      .webContents.paste()
  })
}

/** Caret on a FRESH empty paragraph under the paragraph reading `afterText` — where a paste lands. */
async function caretOnNewBlockAfter(w: Page, afterText: string): Promise<void> {
  await editorOf(w).locator('p').filter({ hasText: afterText }).last().click()
  // Home/End do not move the caret on macOS; ⌘→ does (see helpers.ts's caret notes).
  await w.keyboard.press('Meta+ArrowRight')
  await w.keyboard.press('Enter')
}

/** Opens a vault note by clicking its row in the Files tree — the gesture a user makes. */
async function openNote(w: Page, rel: string, body: string): Promise<void> {
  const row = w.locator(`.tree__row--file[data-path="${noteFile(rel)}"]`)
  await expect(row).toBeVisible()
  await row.click()
  await expect(editorOf(w)).toContainText(body)
}

/** How many files in `IMAGES_DIR` were named after the note `stem` — pollable while a write lands. */
const countImagesFor = async (stem: string): Promise<number> => (await listImages()).filter((n) => imageNameRe(stem).test(n)).length

/** The PNGs in `IMAGES_DIR` named after `stem`, asserted to be exactly `expected` of them. */
async function imagesFor(stem: string, expected: number): Promise<string[]> {
  const mine = (await listImages()).filter((n) => imageNameRe(stem).test(n))
  expect(mine).toHaveLength(expected)
  return mine
}

test('step 1 — a wide screenshot pastes into a FILE plus one root-relative line carrying |400', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, noteFile(NOTES.paste.rel)) })
  win = await appWindow(app, 'w1')
  await expect(editorOf(win)).toContainText(NOTES.paste.body)
  // The images home is made by the first write, never scaffolded.
  expect(await listImages()).toEqual([])

  await caretOnNewBlockAfter(win, NOTES.paste.body)
  await putImageOnClipboard(WIDE_PNG)
  await pressPaste()

  // --- the file ---
  await expect.poll(listImages).toHaveLength(1)
  const [name] = await imagesFor('Paste', 1)
  const written = await readImageFile(name)
  expect(isPng(written)).toBe(true)
  // Full resolution on disk: `|400` is a DISPLAY width, and `writeImage` never re-encodes.
  expect(pngSize(written)).toEqual({ width: WIDE_WIDTH, height: WIDE_HEIGHT })

  // --- the note ---
  const stem = name.slice(0, -'.png'.length)
  await expect
    .poll(() => readNote(NOTES.paste.rel))
    .toBe(`${NOTES.paste.body}\n\n![${stem}|${PASTED_IMAGE_WIDTH}](${IMAGES_DIR}/${name})\n`)

  // --- the page ---
  await expect(imageViews(win)).toHaveCount(1)
  await expect(readyImages(win)).toHaveCount(1)
  // The `app://vault/` protocol actually served the bytes — a broken chip would never decode.
  await expect.poll(() => naturalWidthOf(readyImages(win).first())).toBe(WIDE_WIDTH)
  await shoot(win, 'imagePaste-01-wide-pasted')
})

test('step 2 — a narrow image keeps its natural size: no |400 anywhere in the line', async () => {
  await openNote(win, NOTES.narrow.rel, NOTES.narrow.body)
  await caretOnNewBlockAfter(win, NOTES.narrow.body)
  await putImageOnClipboard(NARROW_PNG)
  await pressPaste()

  await expect.poll(() => countImagesFor('Narrow')).toBe(1)
  const [name] = await imagesFor('Narrow', 1)
  expect(pngSize(await readImageFile(name))).toEqual({ width: NARROW_WIDTH, height: NARROW_HEIGHT })

  const stem = name.slice(0, -'.png'.length)
  await expect.poll(() => readNote(NOTES.narrow.rel)).toBe(`${NOTES.narrow.body}\n\n![${stem}](${IMAGES_DIR}/${name})\n`)
  expect(await readNote(NOTES.narrow.rel)).not.toContain('|')

  await expect(readyImages(win)).toHaveCount(1)
  await expect.poll(() => naturalWidthOf(readyImages(win).first())).toBe(NARROW_WIDTH)
  await shoot(win, 'imagePaste-02-narrow-natural-size')
})

test('step 3 — from a NESTED note the link is still root-relative, and it renders', async () => {
  await expandDirs(win, [path.join(vault, 'Guides'), path.join(vault, 'Guides', 'Deep')])
  await openNote(win, NOTES.nested.rel, NOTES.nested.body)
  await caretOnNewBlockAfter(win, NOTES.nested.body)
  await putImageOnClipboard(WIDE_PNG)
  await pressPaste()

  await expect.poll(() => countImagesFor('Nested')).toBe(1)
  const [name] = await imagesFor('Nested', 1)
  const stem = name.slice(0, -'.png'.length)
  await expect
    .poll(() => readNote(NOTES.nested.rel))
    .toBe(`${NOTES.nested.body}\n\n![${stem}|${PASTED_IMAGE_WIDTH}](${IMAGES_DIR}/${name})\n`)
  const body = await readNote(NOTES.nested.rel)
  // 🔒 ROOT-relative, from three levels down: never `../`, never the note's own directory.
  expect(body).toContain(`](${IMAGES_DIR}/`)
  expect(body).not.toContain('../')
  // And main resolves it: root-relative is resolution step 2, after note-relative.
  await expect(readyImages(win)).toHaveCount(1)
  await expect.poll(() => naturalWidthOf(readyImages(win).first())).toBe(WIDE_WIDTH)
  await shoot(win, 'imagePaste-03-nested-root-relative')
})

test('step 4 — pasted inside a fenced code block: no file, no node, not one byte moved', async () => {
  const filesBefore = await listImages()
  await openNote(win, CODE_NOTE, CODE_BODY)
  // The fence is a CodeMirror node view; clicking its text is how the caret gets inside it.
  const fence = layer(win).locator('.cm-content')
  await expect(fence).toContainText(CODE_BODY)
  await fence.click()

  await putImageOnClipboard(WIDE_PNG)
  await pressPaste()
  await shoot(win, 'imagePaste-04-code-fence-inert')

  // Nothing was written, nothing was inserted, and the fence is still the user's own text.
  await expect(imageViews(win)).toHaveCount(0)
  expect(await listImages()).toEqual(filesBefore)
  await expect(fence).toContainText(CODE_BODY)
  expect(await readNote(CODE_NOTE)).toBe(CODE_NOTE_TEXT)
})

test('step 5 — the same image pasted three times is THREE files; create-only never overwrites', async () => {
  await openNote(win, NOTES.repeat.rel, NOTES.repeat.body)
  await caretOnNewBlockAfter(win, NOTES.repeat.body)
  for (let i = 0; i < 3; i++) {
    await putImageOnClipboard(WIDE_PNG)
    await pressPaste()
    await expect(imageViews(win)).toHaveCount(i + 1)
    // Enter off the just-inserted node so the next paste gets its own paragraph; the caret is
    // already where the insert left it (drawing.spec.ts's step 1 relies on the same guarantee).
    if (i < 2) await win.keyboard.press('Enter')
  }

  await expect.poll(() => countImagesFor('Repeat')).toBe(3)
  const names = await imagesFor('Repeat', 3)
  expect(new Set(names).size).toBe(3)

  // The suffix rule, stated exactly and without depending on where a second boundary fell (three
  // pastes usually share a second, but they need not): the names sharing ONE stamp carry the
  // suffixes 1…k with no gaps and no repeats — i.e. `<stamp>`, `<stamp>-2`, … `<stamp>-k`.
  const bySecond = new Map<string, number[]>()
  for (const name of names) {
    const m = imageNameRe('Repeat').exec(name)!
    bySecond.set(m[1], [...(bySecond.get(m[1]) ?? []), m[2] === undefined ? 1 : Number(m[2])])
  }
  for (const suffixes of bySecond.values()) {
    expect([...suffixes].sort((a, b) => a - b)).toEqual(suffixes.map((_, i) => i + 1))
  }

  // None of the three was clipped or overwritten: three whole, identical copies of one image.
  const bytes = await Promise.all(names.map(readImageFile))
  for (const b of bytes) {
    expect(pngSize(b)).toEqual({ width: WIDE_WIDTH, height: WIDE_HEIGHT })
    expect(b.equals(bytes[0])).toBe(true)
  }
  await expect(readyImages(win)).toHaveCount(3)
  await shoot(win, 'imagePaste-05-three-files-no-overwrite')
})

test('step 6 — it survives the app, and a no-op re-save leaves the markdown byte-identical', async () => {
  const before = await readNote(NOTES.paste.rel)
  await quitApp(app) // the REAL quit path: pending autosaves and the state write are flushed

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await openNote(win, NOTES.paste.rel, NOTES.paste.body)

  // Read COLD off disk: the file, the line and the protocol all still agree.
  await expect(readyImages(win)).toHaveCount(1)
  await expect.poll(() => naturalWidthOf(readyImages(win).first())).toBe(WIDE_WIDTH)
  expect(await readNote(NOTES.paste.rel)).toBe(before)
  await shoot(win, 'imagePaste-06-survives-relaunch')

  // A full save cycle with no net edit: type a character, watch it reach disk (which is the
  // proof autosave actually RAN), delete it, and the file must come back to the same bytes —
  // no `|400` drift, no src re-encoding, no image node round-tripping into something else.
  await editorOf(win).locator('p').filter({ hasText: NOTES.paste.body }).last().click()
  await win.keyboard.press('Meta+ArrowRight')
  await win.keyboard.type('Z', { delay: 15 })
  await expect.poll(() => readNote(NOTES.paste.rel), { timeout: 10_000 }).toContain(`${NOTES.paste.body}Z`)
  await win.keyboard.press('Backspace')
  await expect.poll(() => readNote(NOTES.paste.rel), { timeout: 10_000 }).toBe(before)
  await shoot(win, 'imagePaste-07-byte-identical-resave')
})
