/**
 * What a README capture is made with, on top of the real app (lib/app.mjs):
 *
 *  - `openStage`   a fresh demo vault + profile + app for one picture, its page exactly VIEW at 2×
 *  - `Pointer`     the page's mouse, moved in small eased steps, with a large pointer DRAWN where it
 *                  is (a page capture has no cursor), a ring on each click and keycaps for a shortcut
 *  - `Recorder`    the window's own frames (Chromium's screencast) with their real timestamps
 *  - `still`       a 2× screenshot of the page
 *
 * The overlay only ever shows what the script really did: the pointer sits where `page.mouse` is,
 * a keycap appears when that key is pressed. Nothing of the app's own UI is drawn here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { writeProfile } from '../../lib/seedKit.mjs'
import { launchApp, quitApp, sleep } from './app.mjs'
import { buildVault } from './demoVault.mjs'

/** The page's size in CSS px; captures are 2× this. */
export const VIEW = { width: 1200, height: 675 }
/** macOS's title bar: the window is this much taller than its page. */
const TITLE_BAR = 32
export const SIDEBAR_WIDTH = 250

/**
 * A fresh vault, profile and app under `<work>/<name>/`. `open` and `tabs` are board keys
 * (lib/demoVault.mjs `BOARDS`); `root: null` starts on the Welcome screen instead.
 */
export async function openStage({ work, name, open = null, tabs = open ? [open] : [], welcome = false, env = {}, show = false, prepare }) {
  const dir = path.join(work, name)
  fs.rmSync(dir, { recursive: true, force: true })
  const vault = path.join(dir, 'My Boards')
  const profile = path.join(dir, 'profile')
  const boards = buildVault(vault)
  prepare?.({ dir, vault, boards })
  const bounds = { x: 40, y: 40, width: VIEW.width, height: VIEW.height + TITLE_BAR }
  writeProfile(profile, welcome ? null : vault, {
    theme: 'light',
    sidebarWidth: SIDEBAR_WIDTH,
    recents: welcome ? [] : undefined,
    file: open ? boards[open] : null,
    tabs: tabs.map((key) => boards[key]),
    bounds,
  })
  const { app, page } = await launchApp({ work: dir, profile, env, show })
  // Every picture is drawn at 2×, Retina screen or not: on a 1× display the page is zoomed to 200 %
  // (which is what makes `devicePixelRatio` 2), and the window is then sized until the page is
  // exactly VIEW — it may end up larger than the screen, which nobody sees.
  const measure = () => page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio }))
  const win = await app.browserWindow(page)
  let size = await measure()
  const asLaunched = JSON.stringify(size)
  if (size.scale !== 2) {
    await win.evaluate((w, factor) => w.webContents.setZoomFactor(factor), 2 / size.scale)
    await sleep(300)
    size = await measure()
  }
  for (let tries = 0; tries < 4 && (size.width !== VIEW.width || size.height !== VIEW.height); tries++) {
    await win.evaluate((w, [fx, fy]) => {
      const [cw, ch] = w.getContentSize()
      w.setContentSize(Math.round(cw * fx), Math.round(ch * fy))
    }, [VIEW.width / size.width, VIEW.height / size.height])
    await sleep(400)
    size = await measure()
  }
  // Off the screens, as far as macOS lets a window go (it keeps a 40 pt strip on the last one): a
  // window under the real pointer is told when that pointer enters it, even one that ignores the
  // mouse, and the page then takes it for a mouse move — in the middle of a drag or a hover.
  await app.evaluate(({ screen, BrowserWindow }) => {
    const displays = screen.getAllDisplays().map((d) => d.bounds)
    const right = Math.max(...displays.map((b) => b.x + b.width))
    const bottom = Math.max(...displays.map((b) => b.y + b.height))
    for (const w of BrowserWindow.getAllWindows()) w.setPosition(right + 400, bottom + 400)
  })
  await sleep(300)
  size = await measure()
  // A board is fitted to the canvas once, when it opens: after a change of size it must open again.
  if (JSON.stringify(size) !== asLaunched) {
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  }
  if (size.width !== VIEW.width || size.height !== VIEW.height || size.scale !== 2) {
    await quitApp(app)
    throw new Error(`the page is ${size.width}×${size.height} at ${size.scale}×, not ${VIEW.width}×${VIEW.height} at 2×`)
  }
  await installOverlay(page)
  return { app, page, dir, vault, boards, pointer: new Pointer(page), close: () => quitApp(app) }
}

// ---------------------------------------------------------------- the overlay
const OVERLAY_CSS = `
#rm-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; font-family: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif; }
#rm-pointer { position: absolute; left: 0; top: 0; width: 34px; height: 34px; display: none; filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); will-change: transform; }
#rm-pointer.rm-on { display: block; }
#rm-pointer::before { content: ''; position: absolute; left: -17px; top: -19px; width: 44px; height: 44px; border-radius: 50%; background: rgba(255, 212, 59, .5); border: 1.5px solid rgba(240, 180, 0, .75); box-sizing: border-box; }
#rm-pointer svg { position: relative; }
.rm-ring { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; border: 3px solid #4263eb; background: rgba(66,99,235,.18); animation: rm-ring .45s ease-out forwards; }
@keyframes rm-ring { from { transform: scale(.35); opacity: 1 } to { transform: scale(1.25); opacity: 0 } }
#rm-keys { position: absolute; left: 24px; bottom: 64px; display: none; gap: 10px; align-items: center; padding: 12px 16px; border-radius: 16px; background: rgba(28,30,36,.88); box-shadow: 0 10px 30px rgba(0,0,0,.28); }
#rm-keys.rm-on { display: flex; }
#rm-keys.rm-right { left: auto; right: 36px; bottom: 36px; }
.rm-key { min-width: 44px; height: 46px; padding: 0 13px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; border-radius: 9px; background: linear-gradient(#fdfdfd, #e9ecef); border-bottom: 3px solid #adb5bd; color: #1e1e1e; font-size: 23px; font-weight: 600; line-height: 1; }
.rm-key-text { color: #fff; font-size: 19px; font-weight: 500; padding: 0 4px 0 6px; }
#rm-box { position: absolute; display: none; border: 3px solid #f03e3e; border-radius: 12px; box-shadow: 0 0 0 4px rgba(240,62,62,.18); }
#rm-box.rm-on { display: block; }
`
const POINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 34 34" width="34" height="34"><path d="M5 3 L5 27 L11.5 21.2 L16 31 L20.6 28.9 L16.2 19.3 L25 19.3 Z" fill="#111" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg>`

/** Adds the overlay to `page` (again after a reload: it lives in the document). */
export async function installOverlay(page) {
  await page.evaluate(
    ({ css, svg }) => {
      if (document.getElementById('rm-overlay')) return
      const style = document.createElement('style')
      style.textContent = css
      document.head.append(style)
      const root = document.createElement('div')
      root.id = 'rm-overlay'
      root.setAttribute('aria-hidden', 'true')
      root.innerHTML = `<div id="rm-box"></div><div id="rm-keys"></div><div id="rm-pointer">${svg}</div>`
      document.body.append(root)
    },
    { css: OVERLAY_CSS, svg: POINTER_SVG },
  )
}

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

/** The mouse, and the pointer drawn where it is. */
export class Pointer {
  x = VIEW.width / 2
  y = VIEW.height / 2
  constructor(page) {
    this.page = page
  }
  #draw(x, y) {
    return this.page.evaluate(([px, py]) => {
      const el = document.getElementById('rm-pointer')
      el.classList.add('rm-on')
      el.style.transform = `translate(${px - 5}px, ${py - 3}px)`
    }, [x, y])
  }
  /** Puts the pointer at (x, y) with no travel — where a picture starts. */
  async place(x, y) {
    this.x = x
    this.y = y
    await this.page.mouse.move(x, y)
    await this.#draw(x, y)
  }
  async hide() {
    await this.page.evaluate(() => document.getElementById('rm-pointer').classList.remove('rm-on'))
  }
  /** Travels to (x, y) in about `ms`, easing in and out; the real mouse moves with every step. */
  async move(x, y, ms = 600) {
    const [x0, y0] = [this.x, this.y]
    const start = Date.now()
    for (;;) {
      const t = Math.min(1, (Date.now() - start) / ms)
      const k = ease(t)
      const [px, py] = [x0 + (x - x0) * k, y0 + (y - y0) * k]
      await this.page.mouse.move(px, py)
      await this.#draw(px, py)
      if (t >= 1) break
      await sleep(12)
    }
    this.x = x
    this.y = y
  }
  /** The centre of `locator`'s box, or a point `at` (0…1, 0…1) inside it. */
  async pointOf(locator, at = [0.5, 0.5]) {
    const box = await locator.boundingBox()
    if (box === null) throw new Error('nothing to point at')
    return [box.x + box.width * at[0], box.y + box.height * at[1]]
  }
  async moveTo(locator, ms, at) {
    const [x, y] = await this.pointOf(locator, at)
    await this.move(x, y, ms)
  }
  async #ring() {
    await this.page.evaluate(([px, py]) => {
      const ring = document.createElement('div')
      ring.className = 'rm-ring'
      ring.style.left = `${px}px`
      ring.style.top = `${py}px`
      document.getElementById('rm-overlay').append(ring)
      setTimeout(() => ring.remove(), 600)
    }, [this.x, this.y])
  }
  /** A real click where the pointer is, with a ring so the eye sees it. */
  async click({ button = 'left', count = 1 } = {}) {
    await this.#ring()
    await this.page.mouse.click(this.x, this.y, { button, clickCount: count })
  }
  async clickOn(locator, { ms = 600, at, pause = 120, button } = {}) {
    await this.moveTo(locator, ms, at)
    await sleep(pause)
    await this.click({ button })
  }
  /** Presses the mouse here and drags to (x, y). */
  async drag(x, y, ms = 700) {
    await this.#ring()
    await this.page.mouse.down()
    await this.move(x, y, ms)
    await this.page.mouse.up()
  }
}

/**
 * Shows keycaps (and an optional word after them) under the sidebar's tree — or, with `right`, in the
 * bottom-right corner of the page; `hideKeys` removes them.
 */
export async function showKeys(page, keys, text = '', { right = false } = {}) {
  await page.evaluate(
    ([caps, word, onRight]) => {
      const bar = document.getElementById('rm-keys')
      bar.classList.toggle('rm-right', onRight)
      bar.replaceChildren(
        ...caps.map((cap) => Object.assign(document.createElement('span'), { className: 'rm-key', textContent: cap })),
        ...(word ? [Object.assign(document.createElement('span'), { className: 'rm-key-text', textContent: word })] : []),
      )
      bar.classList.add('rm-on')
    },
    [keys, text, right],
  )
}
export const hideKeys = (page) => page.evaluate(() => document.getElementById('rm-keys').classList.remove('rm-on'))

/** One box around `locator` — a still's single mark. `pad` is the air between the box and the thing. */
export async function boxAround(page, locator, pad = 8) {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('nothing to box')
  await page.evaluate(
    ([x, y, w, h]) => {
      const el = document.getElementById('rm-box')
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` })
      el.classList.add('rm-on')
    },
    [box.x - pad - 3, box.y - pad - 3, box.width + pad * 2, box.height + pad * 2],
  )
}

/** The drawing canvas in the page: right of the sidebar, under the tab bar. */
export const CANVAS = { x: SIDEBAR_WIDTH + 3, y: 30, width: VIEW.width - SIDEBAR_WIDTH - 3, height: VIEW.height - 30 }

/**
 * Where a point of a demo board lands in the page when the board has just been opened: the board's
 * own margin rectangle (lib/sketch.mjs `margin`) is what the app fits to the canvas.
 */
export function sceneToPage(boardFile) {
  const margin = JSON.parse(fs.readFileSync(boardFile, 'utf8')).elements.find((el) => el.id === 'margin')
  const zoom = Math.min(CANVAS.width / margin.width, CANVAS.height / margin.height, 1)
  const left = CANVAS.x + (CANVAS.width - margin.width * zoom) / 2
  const top = CANVAS.y + (CANVAS.height - margin.height * zoom) / 2
  return (x, y) => [left + (x - margin.x) * zoom, top + (y - margin.y) * zoom]
}

// ---------------------------------------------------------------- frames
/**
 * Records the window's frames as it paints them (CDP screencast: a frame per repaint, each with its
 * time), into `<dir>/NNNNN.jpg` plus the list `stop()` returns: `{ file, at }`, `at` in seconds
 * from `start()`.
 */
export class Recorder {
  #frames = []
  #pending = []
  constructor(page, dir) {
    this.page = page
    this.dir = dir
  }
  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true })
    fs.mkdirSync(this.dir, { recursive: true })
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.t0 = null
    this.cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      void this.cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
      if (this.t0 === null) this.t0 = metadata.timestamp
      const file = path.join(this.dir, `${String(this.#frames.length).padStart(5, '0')}.jpg`)
      this.#frames.push({ file, at: metadata.timestamp - this.t0 })
      this.#pending.push(fs.promises.writeFile(file, Buffer.from(data, 'base64')))
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: VIEW.width * 2, maxHeight: VIEW.height * 2, everyNthFrame: 1 })
  }
  /** Seconds since the first frame. */
  now() {
    return this.#frames.length === 0 ? 0 : this.#frames[this.#frames.length - 1].at
  }
  async stop() {
    await this.cdp.send('Page.stopScreencast')
    await Promise.all(this.#pending)
    await this.cdp.detach()
    return this.#frames
  }
}

/** A 2× PNG of the page: the window's own pixels, straight from Chromium (Playwright's screenshot would scale them to the screen's 1×). */
export async function still(page, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const cdp = await page.context().newCDPSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await cdp.detach()
  fs.writeFileSync(file, Buffer.from(data, 'base64'))
  return file
}

export { sleep }
