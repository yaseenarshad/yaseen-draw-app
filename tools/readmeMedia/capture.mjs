#!/usr/bin/env node
/**
 * USAGE: node tools/readmeMedia/capture.mjs --work <scratch-dir> [--out docs/assets] [--only hero,share,…] [--force]
 *
 * Makes every picture and GIF of the README into `docs/assets/`, from the REAL app: the built app
 * (`npm run build` first) is launched once per picture on a fresh copy of the demo vault
 * (lib/demoVault.mjs) and an isolated profile under `<scratch-dir>`, driven like a user, and
 * captured from its own window. Each capture is then set in the one made-up desktop of the page
 * (desktop.html: wallpaper, menu bar, Dock, window frame). The whole thing is one command:
 *
 *   npm run build && node tools/readmeMedia/capture.mjs --work "$TMPDIR/yaseen-draw-readme"
 *
 * It takes about three minutes and nothing shows on screen: the windows are invisible, sit beside
 * the screens, take no keyboard focus and ignore the real mouse (lib/quietHook.cjs, lib/stage.mjs),
 * so the Mac stays usable meanwhile. Every picture is drawn at 2×, on a Retina screen or not. It
 * needs `ffmpeg` (on PATH, or `FFMPEG=<path>`). The real profile and the real vault are never read:
 * lib/app.mjs refuses both. Sharing talks to `tools/fakeCloudflare.mjs` on 127.0.0.1 — no account,
 * no real token, nothing leaves the Mac.
 *
 * What it writes (the names README.md refers to):
 *   hero.gif  browse.gif  present.gif                    1200 × 780, 20 fps, on the desktop
 *   two-tools.png  share.png  version-history.png        1600 × 1040, on the desktop
 *   step-1-folder.png  step-2-draw.png  step-3-files.png 1000 × 625, a closer look on the same wallpaper
 *   banner.png (1600 × 340, banner.html)   social-preview.png (1280 × 640, social.html)
 * The only things in them the app did not draw: the desktop, the pointer, the keycaps, and the one
 * red box on two of the step pictures. With the default `--out`, the link preview is also copied to
 * `~/Downloads/yaseen-draw-app-social-preview.png`, for the upload GitHub only takes by hand.
 *
 * `--work` IS REQUIRED AND IS REWRITTEN: a folder that exists and was not made by this script is
 * refused unless `--force`. `--only` takes the names above without their extension.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { _electron } from '@playwright/test'
import { cli } from '../lib/seedKit.mjs'
import { REPO, assertScratch, quitApp } from './lib/app.mjs'
import { weekSlot } from './lib/boards.mjs'
import { gif, png, sizeOf } from './lib/media.mjs'
import { CANVAS, Recorder, VIEW, boxAround, hideKeys, openStage, sceneToPage, showKeys, sleep, still } from './lib/stage.mjs'

const USAGE = 'usage: node tools/readmeMedia/capture.mjs --work <scratch-dir> [--out docs/assets] [--only name,name] [--force]'
const args = cli(USAGE, { '--work': 'dir', '--out': 'dir', '--only': 'value' }, ['--work'])
const WORK = args.work
const OUT = args.out ?? path.join(REPO, 'docs/assets')
const MARKER = path.join(WORK, '.yaseen-draw-readme-media')
assertScratch(WORK)
if (fs.existsSync(WORK) && fs.readdirSync(WORK).length > 0 && !fs.existsSync(MARKER) && !args.force) {
  console.error(`refusing to write into a folder this script did not make: ${WORK}\npass --force if that is really what you want\n${USAGE}`)
  process.exit(2)
}
fs.mkdirSync(WORK, { recursive: true })
fs.writeFileSync(MARKER, '')
fs.mkdirSync(OUT, { recursive: true })
const ICON = pathToFileURL(path.join(REPO, 'desktop/build/icon.png')).href

// ---------------------------------------------------------------- designed pages (desktop, banner, link preview)
/** One bare, invisible Electron window for the run's designed pages (lib/pageShot.cjs). */
let pages
/** `tools/readmeMedia/<name>.html?<query>` → `out`, a PNG of `width` × `height` CSS px at `scale`, transparent where the page is. */
async function render(name, query, { width, height, scale = 1 }, out) {
  pages ??= await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [path.join(REPO, 'tools/readmeMedia/lib/pageShot.cjs')], cwd: REPO })
  const page = await pages.firstWindow()
  const url = pathToFileURL(path.join(REPO, 'tools/readmeMedia', `${name}.html`))
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value))
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
  await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  await page.goto(url.href)
  await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].filter((img) => img.src).map((img) => img.decode())]))
  await sleep(200)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 } })
  await cdp.detach()
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(data, 'base64'))
  return out
}

/**
 * The made-up desktop, in CSS px at the GIFs' size: a menu bar, the window (a title bar over the
 * app's page, 4 % smaller than life) and the Dock under it.
 */
const DESK = { width: 1200, height: 780, bar: 28, content: { x: 24, y: 66, width: 1152, height: 648 } }
const desks = new Map()
/** The desktop at `scale` (1 for a GIF, 4/3 for a 1600 px picture): its PNG and where the app's page goes in it. */
async function desk(scale) {
  if (!desks.has(scale)) {
    const { x, y, width, height } = DESK.content
    const query = { w: DESK.width, h: DESK.height, win: [x, y - DESK.bar, width, height + DESK.bar].join(','), bar: DESK.bar, icon: ICON }
    const file = await render('desktop', query, { width: DESK.width, height: DESK.height, scale }, path.join(WORK, 'desktop', `desktop@${scale.toFixed(2)}.png`))
    const at = (n) => Math.round(n * scale)
    desks.set(scale, { png: file, content: { x: at(x), y: at(y), width: at(width), height: at(height) } })
  }
  return desks.get(scale)
}
/** A closer look: 1000 × 625 of the same wallpaper around one rounded piece of the app's page. */
const CARD = { width: 1000, height: 625, content: { x: 30, y: 28, width: 940, height: 569 } }
let cardPng
async function card() {
  const { x, y, width, height } = CARD.content
  cardPng ??= await render('desktop', { w: CARD.width, h: CARD.height, win: [x, y, width, height].join(','), bar: 0, chrome: 0 }, CARD, path.join(WORK, 'desktop', 'card.png'))
  return { png: cardPng, content: CARD.content }
}
/** The whole page of a 2× screenshot, set in the desktop at 1600 px. */
const framed = async (shot, name) => png(shot, path.join(OUT, `${name}.png`), { desktop: await desk(4 / 3) })
/** The part of a 2× screenshot `width` CSS px wide from (`x`, `y`), set in a card; its height follows the card's shape. */
async function closeUp(shot, out, { x, y, width }) {
  const height = Math.round((width * CARD.content.height) / CARD.content.width)
  const top = Math.min(VIEW.height - height, Math.max(0, Math.round(y)))
  const left = Math.min(VIEW.width - width, Math.max(0, Math.round(x)))
  png(shot, out, { crop: { x: left * 2, y: top * 2, width: width * 2, height: height * 2 }, desktop: await card() })
}

// ---------------------------------------------------------------- the app, as a user finds it
const row = (page, label) => page.locator('button.tree__row', { has: page.locator('.tree__label').getByText(label, { exact: true }) })
const tool = (page, name) => page.getByTestId(`toolbar-${name}`).filter({ visible: true })
const menuItem = (page, label) => page.getByRole('menuitem', { name: new RegExp(`^${label}`) })
/** A drawing is up: its toolbar is there and its fonts have drawn. */
async function drawingReady(page, settle = 900) {
  await tool(page, 'rectangle').waitFor()
  await page.evaluate(() => document.fonts.ready)
  await sleep(settle)
}
/** A diagram is up: draw.io, in its frame, shows `label`. */
async function diagramReady(page, label) {
  await page.frameLocator('iframe.drawio-editor__frame').getByText(label, { exact: true }).first().waitFor({ timeout: 40_000 })
  await sleep(1200)
}
/** An application-menu item, by its id (desktop/src/main/menu.ts) — what its keyboard shortcut runs. */
const menu = (app, id) => app.evaluate(({ Menu }, itemId) => Menu.getApplicationMenu()?.getMenuItemById(itemId)?.click(), id)

async function record(stage, name, play, options) {
  const rec = new Recorder(stage.page, path.join(stage.dir, 'frames'))
  await rec.start()
  await play()
  const frames = await rec.stop()
  const seconds = gif(frames, path.join(OUT, `${name}.gif`), { ...options, desktop: await desk(1) })
  return `${seconds.toFixed(1)} s`
}

// ---------------------------------------------------------------- the pictures
const pictures = {
  /** The main action: a folder of boards, open one, draw on it, open another. */
  async hero() {
    const stage = await openStage({ work: WORK, name: 'hero', open: 'soup' })
    const { page, pointer, boards } = stage
    try {
      await drawingReady(page)
      await pointer.place(620, 560)
      return await record(stage, 'hero', async () => {
        await sleep(350)
        await pointer.clickOn(row(page, 'Home'), { ms: 500 })
        await sleep(350)
        await pointer.clickOn(row(page, 'Week plan'), { ms: 400 })
        await drawingReady(page, 500)
        // Sunday has room: a rectangle, a colour, a word.
        const at = sceneToPage(boards.week)
        const [sx, sy, sw, sh] = weekSlot(6, 1)
        const [x1, y1] = at(sx, sy)
        const [x2, y2] = at(sx + sw, sy + sh)
        await pointer.clickOn(tool(page, 'rectangle'), { ms: 420 })
        await pointer.move(x1, y1, 380)
        await pointer.drag(x2, y2, 480)
        await sleep(200)
        await pointer.clickOn(page.getByTestId('color-top-pick-#ffec99').filter({ visible: true }), { ms: 380 })
        await sleep(150)
        await pointer.move((x1 + x2) / 2, (y1 + y2) / 2, 320)
        await pointer.click({ count: 2 })
        await sleep(200)
        await page.keyboard.type('Picnic', { delay: 70 })
        await sleep(200)
        await pointer.move(...at(430, 372), 320)
        await pointer.click()
        await sleep(450)
        await pointer.clickOn(row(page, 'Garden layout'), { ms: 500 })
        await drawingReady(page, 300)
        await pointer.move(CANVAS.x + 520, CANVAS.y + 590, 300)
      }, { hold: 1.6 })
    } finally {
      await stage.close()
    }
  },

  /** Finding a board: folders, the hover preview, tabs, ⌘K. */
  async browse() {
    const stage = await openStage({ work: WORK, name: 'browse', open: 'week' })
    const { app, page, pointer } = stage
    const preview = page.locator('.board-preview')
    /**
     * Rests on a row until its preview has drawn the board. The tree can re-render under a pointer
     * that is already there, which swallows the hover — a user just moves the mouse again, and so does this.
     */
    const glance = async (label, ms) => {
      await pointer.moveTo(row(page, label), 500, [0.6, 0.5])
      const drawn = preview.locator('img, svg, canvas').first()
      for (let tries = 0; tries < 8; tries++) {
        if (await drawn.waitFor({ timeout: 1_800 }).then(() => true, () => false)) break
        const [x, y] = [pointer.x, pointer.y]
        await pointer.move(x + 230, y + 30, 280)
        await pointer.move(x, y, 320)
      }
      await drawn.waitFor({ timeout: 1_800 })
      await sleep(ms)
    }
    try {
      await drawingReady(page)
      await pointer.place(600, 520)
      return await record(stage, 'browse', async () => {
        await sleep(700)
        await pointer.clickOn(row(page, 'Work'), { ms: 700 })
        await sleep(600)
        await glance('Product roadmap', 1000)
        await pointer.clickOn(row(page, 'Launch funnel'), { ms: 350, at: [0.6, 0.5] })
        await drawingReady(page, 400)
        // ⌘-click: a second tab, behind this one.
        await pointer.moveTo(row(page, 'Sign-up flow'), 450, [0.6, 0.5])
        await showKeys(page, ['⌘'], 'click')
        await sleep(350)
        await page.keyboard.down('Meta')
        await pointer.click()
        await page.keyboard.up('Meta')
        await sleep(600)
        await hideKeys(page)
        await pointer.move(CANVAS.x + 300, CANVAS.y + 520, 500)
        // ⌘K: find by name. The shortcut is the File › Search Vault menu item.
        await showKeys(page, ['⌘', 'K'])
        await sleep(350)
        await menu(app, 'menu.file.search')
        await sleep(450)
        await page.keyboard.type('soup', { delay: 100 })
        await sleep(650)
        await showKeys(page, ['⏎'])
        await sleep(250)
        await page.keyboard.press('Enter')
        await drawingReady(page, 400)
        await hideKeys(page)
      }, { hold: 1.8 })
    } finally {
      await stage.close()
    }
  },

  /** Present: each frame of the board is a slide. */
  async present() {
    const stage = await openStage({ work: WORK, name: 'present', open: 'trip' })
    const { page, pointer } = stage
    try {
      await drawingReady(page)
      await page.getByRole('button', { name: 'Open workspace panel' }).click()
      await page.locator('.app-sidebar-tab-trigger[aria-label="Presentation"]').click()
      const start = page.locator('.presentation-sidebar__footer button').first()
      await start.waitFor()
      await sleep(600)
      await pointer.place(900, 300)
      return await record(stage, 'present', async () => {
        await sleep(1000)
        await pointer.clickOn(start, { ms: 800 })
        await page.locator('.presentation-player').waitFor()
        await pointer.hide()
        await sleep(1500)
        for (let slide = 2; slide <= 5; slide++) {
          await showKeys(page, ['→'], '', { right: true })
          await sleep(150)
          await page.keyboard.press('ArrowRight')
          await sleep(550)
          await hideKeys(page)
          await sleep(750)
        }
      }, { hold: 1.5 })
    } finally {
      await stage.close()
    }
  },

  /** How it works, 1: pick a folder — the screen a first launch shows. */
  async 'step-1-folder'() {
    const stage = await openStage({ work: WORK, name: 'step-1', welcome: true })
    const { page } = stage
    try {
      const button = page.getByRole('button', { name: 'Open folder…' })
      await button.waitFor()
      await sleep(500)
      await boxAround(page, button, 10)
      const shot = await still(page, path.join(stage.dir, 'shot.png'))
      const box = await button.boundingBox()
      const width = 560
      await closeUp(shot, path.join(OUT, 'step-1-folder.png'), { x: (VIEW.width - width) / 2, y: box.y + box.height / 2 - 215, width })
    } finally {
      await stage.close()
    }
  },

  /** How it works, 2: draw — a note being added to a board, mid-stroke. */
  async 'step-2-draw'() {
    const stage = await openStage({ work: WORK, name: 'step-2', open: 'week' })
    const { page, pointer, boards } = stage
    try {
      await drawingReady(page)
      const at = sceneToPage(boards.week)
      const [sx, sy, sw, sh] = weekSlot(3, 1) // Thursday's empty second row
      await tool(page, 'rectangle').click()
      await pointer.place(...at(sx, sy))
      await page.mouse.down()
      await pointer.move(...at(sx + sw, sy + sh), 400)
      await sleep(300)
      await page.mouse.move(pointer.x, pointer.y) // the stroke ends where the pointer is, whatever else moved
      const shot = await still(page, path.join(stage.dir, 'shot.png'))
      await page.mouse.up()
      await closeUp(shot, path.join(OUT, 'step-2-draw.png'), { x: CANVAS.x, y: CANVAS.y + 6, width: 800 })
    } finally {
      await stage.close()
    }
  },

  /** How it works, 3: a board is a plain file — the tree, and one board's Info. */
  async 'step-3-files'() {
    const stage = await openStage({ work: WORK, name: 'step-3', open: 'week' })
    const { page } = stage
    try {
      await drawingReady(page)
      for (const folder of ['Home', 'Trips', 'Work']) await row(page, folder).click()
      await row(page, 'Tomato soup recipe').click({ button: 'right' })
      await menuItem(page, 'Info').click()
      const info = page.locator('.board-info')
      await info.waitFor()
      await page.mouse.move(900, 60)
      await sleep(400)
      await boxAround(page, info.locator('.board-info__name'), 6)
      const shot = await still(page, path.join(stage.dir, 'shot.png'))
      const box = await info.boundingBox()
      await closeUp(shot, path.join(OUT, 'step-3-files.png'), { x: 0, y: box.y - 175, width: 700 })
    } finally {
      await stage.close()
    }
  },

  /** Two tools, one app: a draw.io diagram open beside an Excalidraw drawing. */
  async 'two-tools'() {
    const stage = await openStage({ work: WORK, name: 'two-tools', open: 'signup', tabs: ['funnel', 'signup'] })
    const { page } = stage
    try {
      await diagramReady(page, 'Welcome!')
      await row(page, 'Work').click()
      await page.mouse.move(700, 600)
      await sleep(600)
      await framed(await still(page, path.join(stage.dir, 'shot.png')), 'two-tools')
    } finally {
      await stage.close()
    }
  },

  /** Sharing a board with a link — against the local, fake Cloudflare. */
  async share() {
    const data = path.join(WORK, 'share-cloudflare')
    fs.rmSync(data, { recursive: true, force: true })
    const fake = spawn(process.execPath, [path.join(REPO, 'tools/fakeCloudflare.mjs'), '--data', data, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'] })
    let stage
    try {
      const origin = await new Promise((resolve, reject) => {
        let out = ''
        fake.stdout.on('data', (chunk) => {
          out += chunk
          const found = /http:\/\/127\.0\.0\.1:\d+/.exec(out)
          if (found) resolve(found[0])
        })
        fake.once('exit', (code) => reject(new Error(`fakeCloudflare exited ${code}: ${out}`)))
      })
      stage = await openStage({ work: WORK, name: 'share', open: 'soup', env: { YASEEN_DRAW_CLOUDFLARE_API: `${origin}/client/v4`, YASEEN_DRAW_SHARE_ORIGIN: origin } })
      const { page } = stage
      await drawingReady(page)
      // Settings › Sharing, set up with the fake account's demo key — a user does this once.
      await page.getByRole('button', { name: 'Settings' }).click()
      const settings = page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Sharing' }).click()
      await settings.getByRole('textbox', { name: 'Cloudflare API key' }).fill('demo-good')
      await settings.getByTestId('sharing-setup').click()
      await settings.getByTestId('sharing-status').filter({ hasText: 'Sharing ready' }).waitFor({ timeout: 60_000 })
      await settings.getByRole('button', { name: 'Close settings' }).click()
      // Right-click the board › Share › Anyone with the link.
      await row(page, 'Home').click()
      await row(page, 'Tomato soup recipe').click({ button: 'right' })
      await menuItem(page, 'Share').click()
      const dialog = page.getByTestId('share-dialog')
      await dialog.getByTestId('share-access').click()
      await page.getByRole('menuitemradio', { name: 'Anyone with the link' }).click()
      await dialog.getByTestId('share-live').filter({ hasText: 'Up to date' }).waitFor({ timeout: 60_000 })
      await page.mouse.move(1100, 640)
      await sleep(600)
      await framed(await still(page, path.join(stage.dir, 'shot.png')), 'share')
    } finally {
      await stage?.close()
      fake.kill()
    }
  },

  /** Version history: the board now, with what changed since the first version marked. */
  async 'version-history'() {
    const stage = await openStage({ work: WORK, name: 'version-history', open: 'roadmap' })
    const { page } = stage
    try {
      await drawingReady(page)
      await row(page, 'Work').click()
      await row(page, 'Product roadmap').click({ button: 'right' })
      await menuItem(page, 'Version history').click()
      const history = page.getByTestId('version-history')
      await history.getByRole('listbox', { name: 'Versions' }).getByRole('option').last().click()
      await history.getByTestId('history-picture').waitFor({ timeout: 30_000 })
      await page.mouse.move(1150, 660)
      await sleep(900)
      await framed(await still(page, path.join(stage.dir, 'shot.png')), 'version-history')
    } finally {
      await stage.close()
    }
  },

  /** The banner: a designed page (banner.html), no picture of the app. */
  async banner() {
    const big = await render('banner', { icon: ICON }, { width: 1600, height: 340, scale: 2 }, path.join(WORK, 'banner', 'banner@2x.png'))
    png(big, path.join(OUT, 'banner.png'), { width: 1600, height: 340 })
  },

  /** The link preview: a designed page (social.html) around one real picture of the app at work. */
  async 'social-preview'() {
    const stage = await openStage({ work: WORK, name: 'at-work', open: 'soup' })
    const atWork = path.join(stage.dir, 'at-work.png')
    try {
      await drawingReady(stage.page)
      await row(stage.page, 'Home').click()
      await stage.page.mouse.move(900, 660)
      await sleep(500)
      await closeUp(await still(stage.page, path.join(stage.dir, 'shot.png')), atWork, { x: 0, y: 0, width: 920 })
    } finally {
      await stage.close()
    }
    const big = await render('social', { icon: ICON, shot: pathToFileURL(atWork).href }, { width: 1280, height: 640, scale: 2 }, path.join(WORK, 'at-work', 'social@2x.png'))
    const out = path.join(OUT, 'social-preview.png')
    png(big, out, { width: 1280, height: 640 })
    // GitHub takes this picture by hand only, and the file dialog opens in Downloads.
    if (!args.out) fs.copyFileSync(out, path.join(os.homedir(), 'Downloads', 'yaseen-draw-app-social-preview.png'))
  },
}

// ---------------------------------------------------------------- run
const names = args.only ? args.only.split(',').map((name) => name.trim()) : Object.keys(pictures)
const unknown = names.filter((name) => !Object.hasOwn(pictures, name))
if (unknown.length > 0) {
  console.error(`unknown picture: ${unknown.join(', ')} (there are: ${Object.keys(pictures).join(', ')})\n${USAGE}`)
  process.exit(2)
}
try {
  for (const name of names) {
    let length
    // A GIF is 8 to 14 s. One that is not was stalled by the Mac (a sleeping display stops the
    // window's frames, a busy one stretches the waits): it is taken again.
    for (let take = 1; ; take++) {
      length = await pictures[name]()
      const seconds = Number.parseFloat(length)
      if (!length || (seconds >= 8 && seconds <= 14)) break
      if (take === 3) throw new Error(`${name}.gif is ${length} long after three takes; it must be 8 to 14 s`)
      console.error(`${name}.gif came out ${length} long: taking it again`)
    }
    const file = path.join(OUT, `${name}.${length ? 'gif' : 'png'}`)
    const { width, height, bytes } = sizeOf(file)
    console.log(`${path.relative(REPO, file).padEnd(36)} ${`${width}×${height}`.padEnd(10)} ${String(bytes).padStart(9)} bytes${length ? `  ${length}` : ''}`)
  }
} finally {
  if (pages) await quitApp(pages)
}
