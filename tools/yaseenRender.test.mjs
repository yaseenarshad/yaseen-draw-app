import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { deflateRawSync } from 'node:zlib'
import { JSDOM, VirtualConsole } from 'jsdom'
import { afterEach, describe, expect, it } from 'vitest'
import { DRAWIO_TAG } from './packDrawio.mjs'

/**
 * THE DIAGRAM PICTURE PAGE (🔒 YAZ-1802 D9 / D16) run for real: our `yaseen-render-config.js`, the
 * pinned draw.io viewer and our `yaseen-render.js`, in page order in jsdom, on a stand-in drawio
 * origin that serves the webapp's own files (the font sheet and the fonts packDrawio lays beside
 * it). The test is the renderer's parent frame: it posts requests and reads the answers. jsdom
 * has no layout and no canvas, so this pins WHAT is drawn — the page, the colours, the fonts
 * inside — as SVG; how it looks, and the PNG, are a look in the app.
 */
const WEBAPP = fileURLToPath(new URL(`../desktop/.cache/drawio/${DRAWIO_TAG}/`, import.meta.url))
const OVERLAY = fileURLToPath(new URL('../desktop/drawio-overlay/', import.meta.url))
const ORIGIN = 'app://drawio'

/** draw.io reads the fonts with XMLHttpRequest as x-user-defined text; this one answers from the webapp folder. */
class WebappXhr {
  open(method, url, async) {
    this.url = new URL(url, `${ORIGIN}/`)
    this.async = async !== false
  }
  setRequestHeader() {}
  overrideMimeType() {}
  send() {
    requested.push(this.url.href)
    // `app:` is no special scheme, so its URL has no origin to compare: the host says it is ours.
    const file = this.url.protocol === 'app:' && this.url.host === 'drawio' ? `${WEBAPP}${decodeURIComponent(this.url.pathname.slice(1))}` : null
    const bytes = file !== null && existsSync(file) ? readFileSync(file) : null
    this.readyState = 4
    this.status = bytes === null ? 404 : 200
    this.responseText = bytes === null ? '' : bytes.toString('latin1')
    if (this.async) setTimeout(() => this.onreadystatechange?.())
  }
}

let page = null
/** Every URL the page asked for over XMLHttpRequest (draw.io loads stencil sets that way), in the current test. */
let requested = []

afterEach(() => {
  page?.close()
  page = null
  requested = []
})

async function openRenderer() {
  const { window } = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: `${ORIGIN}/yaseen-render.html`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() })
  page = window
  const answers = []
  window.XMLHttpRequest = WebappXhr
  // The app is Chromium, so draw.io must take its Chromium paths: jsdom's `navigator.vendor` is
  // Safari's, and draw.io leaves the diagram-wide shadow out on Safari (`mxClient.IS_SF`).
  Object.defineProperty(window.navigator, 'vendor', { value: 'Google Inc.' })
  // jsdom has no canvas; draw.io measures wrapped labels with one, so it gets a monospace-ish ruler.
  window.HTMLCanvasElement.prototype.getContext = () => ({ font: '', measureText: (text) => ({ width: text.length * 6 }) })
  window.fetch = async (url) => new Response(readFileSync(`${WEBAPP}${url}`, 'utf8'))
  // A top-level page is its own parent: what the page posts "up" is what the test reads.
  window.postMessage = (data) => answers.push(JSON.parse(data))
  // The page's own scripts in its own order — ours from the overlay, draw.io's (the stencils bundle
  // among them, 🔒 YAZ-1802 D5) from the pruned webapp.
  const scripts = [...readFileSync(`${OVERLAY}yaseen-render.html`, 'utf8').matchAll(/<script src="([^"]+)"/g)].map((m) => m[1])
  expect(scripts).toEqual(['js/yaseen-render-config.js', 'js/viewer-static.min.js', 'js/stencils.min.js', 'js/yaseen-render.js'])
  for (const script of scripts) window.eval(readFileSync(existsSync(`${OVERLAY}${script}`) ? `${OVERLAY}${script}` : `${WEBAPP}${script}`, 'utf8'))
  await expect.poll(() => answers).toEqual([{ event: 'ready' }])
  let serial = 0
  /** One request, as the renderer's `renderDiagram.ts` sends it; resolves with the page's answer. */
  const render = async (xml, over = {}) => {
    const id = `t${++serial}`
    window.dispatchEvent(new window.MessageEvent('message', { data: JSON.stringify({ id, xml, theme: 'light', adaptive: 'auto', format: 'svg', scale: 1, padding: 16, ...over }), source: window }))
    await expect.poll(() => answers.find((a) => a.id === id), { timeout: 5000 }).toBeDefined()
    return answers.find((a) => a.id === id)
  }
  return { render }
}

/** The SVG inside a picture the page answered; a failure answer fails the test with its reason. */
function svgOf(answer) {
  if (answer.ok !== true) throw new Error(`the page could not draw it: ${answer.error}`)
  return Buffer.from(answer.dataUrl.slice('data:image/svg+xml;base64,'.length), 'base64').toString('utf8')
}

const cell = (id, label, x, style = 'rounded=1;whiteSpace=wrap;html=1;') => `<mxCell id="${id}" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="10" width="140" height="60" as="geometry"/></mxCell>`
const model = (cells, attrs = '') => `<mxGraphModel${attrs}><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel>`
const mxfile = (...pages) => `<mxfile>${pages.map((p, i) => `<diagram id="p${i}" name="Page-${i + 1}">${p}</diagram>`).join('')}</mxfile>`

describe.skipIf(!existsSync(`${WEBAPP}js/viewer-static.min.js`))(`yaseen-render.html on the pinned draw.io ${DRAWIO_TAG}`, () => {
  it('draws page 1 of a multi-page diagram, and a COMPRESSED page 1 the same way', async () => {
    const { render } = await openRenderer()
    const plain = svgOf(await render(mxfile(model(cell('a', 'First page', 10)), model(cell('b', 'Second page', 10)))))
    expect(plain).toContain('First page')
    expect(plain).not.toContain('Second page')
    const compressed = deflateRawSync(Buffer.from(encodeURIComponent(model(cell('a', 'Packed page', 10))))).toString('base64')
    expect(svgOf(await render(mxfile(compressed)))).toContain('Packed page')
  })

  it('carries the font faces the diagram uses — and only those — inside the SVG, as data', async () => {
    const { render } = await openRenderer()
    const svg = svgOf(await render(mxfile(model(cell('a', 'Title', 10, 'text;html=1;fontFamily=Assistant;')))))
    expect(svg).toMatch(/font-family: 'Assistant'[^}]*url\("data:application\/font-woff2/)
    expect(svg).not.toContain("font-family: 'Inter'")
    expect(svg).not.toContain('app://drawio/yaseen-fonts')
  })

  it('keeps a designed card`s gradient, soft shadow and rich label — and a diagram-wide shadow', async () => {
    const { render } = await openRenderer()
    const card = cell('a', '&lt;b&gt;Growth&lt;/b&gt;&lt;br&gt;flywheel', 10, 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;gradientColor=#7ea6e0;shadow=1;')
    const svg = svgOf(await render(mxfile(model(card))))
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('drop-shadow')
    expect(svg).toContain('<b>Growth</b>')
    expect(svgOf(await render(mxfile(model(cell('a', 'x', 10), ' shadow="1"'))))).toContain('drop-shadow')
  })

  it('follows the theme and the dark-mode colour setting, and a file that keeps its colours keeps them (🔒 YAZ-1802 D16)', async () => {
    const { render } = await openRenderer()
    const scheme = async (attrs, over) => /color-scheme: (\w+)/.exec(svgOf(await render(mxfile(model(cell('a', 'x', 10), attrs)), over)))?.[1]
    expect(await scheme('', { theme: 'dark', adaptive: 'auto' })).toBe('dark')
    expect(await scheme('', { theme: 'dark', adaptive: 'none' })).toBe('light')
    expect(await scheme(' adaptiveColors="none"', { theme: 'dark', adaptive: 'auto' })).toBe('light')
    expect(await scheme('', { theme: 'light', adaptive: 'auto' })).toBe('light')
  })

  it('fits a preview inside its bounds, and draws an export at its scale', async () => {
    const { render } = await openRenderer()
    const wide = mxfile(model([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => cell(`c${i}`, `Box ${i}`, i * 200)).join('')))
    const width = (svg) => Number(/<svg[^>]* width="(\d+)/.exec(svg)?.[1])
    // draw.io rounds its crop up and widens it by the half pixel an odd stroke paints: a pixel at most.
    expect(width(svgOf(await render(wide, { maxWidth: 400, maxHeight: 300 })))).toBeLessThanOrEqual(401)
    expect(width(svgOf(await render(wide, { scale: 1, padding: 10 })))).toBeGreaterThan(1900)
  })

  it('draws library shapes from the one stencils bundle — the pack ships no per-set file, and none is asked for (🔒 YAZ-1802 D5)', async () => {
    const { render } = await openRenderer()
    const icons = [
      cell('a', '', 10, 'shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;fillColor=#ED7100;'),
      cell('b', '', 200, 'shape=mxgraph.cisco19.rect;prIcon=router;'),
      cell('c', '', 400, 'shape=mxgraph.flowchart.decision;'),
    ].join('')
    const svg = svgOf(await render(mxfile(model(icons))))
    expect(page.mxStencilRegistry.getStencil('mxgraph.aws4.lambda')).not.toBeNull()
    expect(page.mxStencilRegistry.getStencil('mxgraph.flowchart.decision')).not.toBeNull()
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(3)
    expect(requested.filter((url) => url.includes('/stencils/'))).toEqual([])
  })

  it('an empty page is the empty string; a file that is no diagram is a readable failure', async () => {
    const { render } = await openRenderer()
    expect(await render(mxfile(model('')))).toMatchObject({ ok: true, dataUrl: '' })
    expect(await render('not xml at all')).toMatchObject({ ok: false, error: expect.any(String) })
    expect(await render('<svg xmlns="http://www.w3.org/2000/svg"/>')).toMatchObject({ ok: false, error: 'not a draw.io diagram' })
  })
})
