import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM, VirtualConsole } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { viewerPage } from '../share/viewer/page.js'
import { DRAWIO_FILES, diagramFontCss } from './buildShareViewer.mjs'

/**
 * A SHARED DIAGRAM'S PAGE, DRAWN OFFLINE (🔒 YAZ-1802 D11): the Worker's real page with its scripts
 * run in page order in jsdom — our config, the pinned draw.io viewer, our `diagram.js` — against a
 * stand-in origin that answers `/scene/<id>` and every `/assets/…` path from exactly the files the
 * build publishes there (`DRAWIO_FILES`). Nothing leaves the process. jsdom has no layout, so this
 * pins what is drawn and fetched, not how it looks; that is a look at a live link.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url))
const ORIGIN = 'https://share.test'
const ID = 'AbCdEfGhIjKlMnOpQrStUvWx'
const VIEWER = DRAWIO_FILES.find(([at]) => at === 'drawio/viewer-static.min.js')[1]
/** A label, and an AWS library icon whose shape lives in a stencil set loaded on first use (`aws4.xml`). */
const XML = `<mxfile host="yaz-1802"><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
<mxCell id="2" value="Checkout service" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="10" y="10" width="140" height="60" as="geometry"/></mxCell>
<mxCell id="3" value="" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="1"><mxGeometry x="200" y="10" width="60" height="60" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`

/** The bytes the build publishes at `/assets/<rel>`, straight from their source; null when it publishes nothing there. */
function published(rel) {
  for (const [at, source] of DRAWIO_FILES) {
    const file = rel === at ? source : rel.startsWith(`${at}/`) ? path.join(source, rel.slice(at.length + 1)) : null
    if (file !== null) return existsSync(file) ? readFileSync(file) : null
  }
  return null
}

/** draw.io loads stencils with SYNCHRONOUS XMLHttpRequests (`mxUtils.load`); this one answers from `published`. */
const fakeXhr = (requested) =>
  class {
    open(method, url) {
      this.url = new URL(url, ORIGIN)
    }
    setRequestHeader() {}
    send() {
      requested.push(this.url.href)
      const bytes = this.url.origin === ORIGIN && this.url.pathname.startsWith('/assets/') ? published(this.url.pathname.slice('/assets/'.length)) : null
      this.readyState = 4
      this.status = bytes === null ? 404 : 200
      this.responseText = bytes === null ? '' : bytes.toString('utf8')
      this.responseXML = null
    }
  }

async function openSharedDiagram() {
  // A silent console: jsdom reports every canvas call it does not implement.
  const { window } = new JSDOM(viewerPage({ id: ID, kind: 'diagram', allowDownload: true, name: 'Checkout', updatedAt: 1 }), { url: `${ORIGIN}/b/${ID}`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: new VirtualConsole() })
  const requested = []
  window.XMLHttpRequest = fakeXhr(requested)
  window.fetch = async (url) => {
    requested.push(new URL(url, ORIGIN).href)
    return new Response(XML)
  }
  const bundled = async (entry) => (await build({ entryPoints: [entry], bundle: true, format: 'iife', write: false })).outputFiles[0].text
  for (const script of [...window.document.querySelectorAll('script[src]')]) {
    const src = script.getAttribute('src')
    window.eval(src === '/assets/diagram.js' ? await bundled(path.join(REPO, 'share', 'viewer', 'diagram.js')) : published(src.slice('/assets/'.length)).toString('utf8'))
    // jsdom lays nothing out, so every element reads as hidden and the viewer would wait for it to show.
    if (src === '/assets/drawio/viewer-static.min.js') window.GraphViewer.prototype.checkVisibleState = false
  }
  await expect.poll(() => window.document.querySelector('#canvas svg')).not.toBeNull()
  return { window, requested }
}

describe.skipIf(!existsSync(VIEWER))("a shared diagram's page, drawn offline by draw.io's pinned viewer (🔒 YAZ-1802 D11)", () => {
  it('draws the diagram, loads the library icon from the stencils the build ships, and fetches nothing from anywhere else', async () => {
    const { window, requested } = await openSharedDiagram()
    try {
      expect(window.document.querySelector('#canvas').textContent).toContain('Checkout service')
      expect(requested).toContain(`${ORIGIN}/scene/${ID}`)
      expect(requested).toContain(`${ORIGIN}/assets/drawio/stencils/aws4.xml`)
      expect(window.mxStencilRegistry.getStencil('mxgraph.aws4.lambda')).not.toBeNull()
      expect(requested.filter((url) => !url.startsWith(`${ORIGIN}/`))).toEqual([])
      expect(window.document.getElementById('note')).toBeNull()
      expect(typeof window.document.getElementById('dl-drawio').onclick).toBe('function')
    } finally {
      window.close()
    }
  })

  it("the diagram fonts sheet points at the Excalidraw fonts the build publishes under /assets/fonts/, never the app's own origin", () => {
    const fontsDir = [path.join(REPO, 'client', 'node_modules'), path.join(REPO, 'node_modules')].map((base) => path.join(base, '@excalidraw', 'excalidraw', 'dist', 'prod', 'fonts')).find(existsSync)
    const urls = [...diagramFontCss().matchAll(/url\('([^']+)'\)/g)].map((m) => m[1])
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) expect(url.startsWith('/assets/fonts/') && existsSync(path.join(fontsDir, url.slice('/assets/fonts/'.length))), url).toBe(true)
  })
})
