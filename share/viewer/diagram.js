/**
 * THE VIEWER'S SCRIPT for a draw.io diagram (🔒 YAZ-1802 D11), bundled by `tools/buildShareViewer.mjs`
 * into `share/dist/assets/diagram.js`. The diagram is drawn read-only by draw.io's own viewer
 * (`GraphViewer`, the D9 renderer), which the page has already loaded — `drawio/config.js`, then
 * `drawio/js/viewer-static.min.js` — before this module runs. Its hover toolbar zooms and turns
 * pages; dragging or scrolling pans. Everything it fetches, the library shapes' stencils included,
 * comes from this Worker's `/assets/drawio/`.
 */
import { board, loadBoard, note, wireDownload } from './board.js'

/**
 * 🔒 YAZ-1802 D5 (YAZ-1973): draw.io's stencil sets ship as ONE file, the editor's own
 * `js/stencils.min.js` (every set) — the app carries no per-set files to upload. It is
 * loaded only for a diagram that names a library shape (`shape=mxgraph.…`, looked for inside
 * compressed pages too), so a plain diagram's link never pays for it.
 */
function usesLibraryShapes(doc, xml) {
  try {
    const pages = [...doc.getElementsByTagName('diagram')].map((page) => (page.firstElementChild === null && page.textContent.trim() !== '' ? Graph.decompress(page.textContent) : ''))
    return /mxgraph\./i.test([xml, ...pages].join('\n'))
  } catch {
    return true // a page it cannot read ahead of the viewer: load the stencils rather than guess
  }
}

/** A classic script from this Worker; the viewer still draws if it fails, just without library icons. */
const loadScript = (src) =>
  new Promise((resolve) => {
    const script = document.createElement('script')
    script.src = src
    script.onload = script.onerror = resolve
    document.head.appendChild(script)
  })

async function main() {
  const xml = await loadBoard('diagram')
  if (xml === null) return
  if (board.allowDownload) wireDownload(document.getElementById('dl-drawio'), 'drawio', 'diagram')
  const doc = mxUtils.parseXml(xml)
  if (usesLibraryShapes(doc, xml)) await loadScript('/assets/drawio/js/stencils.min.js')
  note.remove()
  // GraphViewer keeps its container's size only when it is set inline; any other container is
  // resized to the diagram, so this one fills the area below the bar.
  const container = document.createElement('div')
  container.style.cssText = 'width:100%;height:100%'
  document.getElementById('canvas').appendChild(container)
  const { graph } = new GraphViewer(container, doc.documentElement, {
    toolbar: 'zoom pages layers',
    'toolbar-position': 'inline',
    // Opens fitted to the page, never past 100% — like the desktop app and the drawing viewer.
    'auto-fit': true,
    center: true,
    resize: false,
    lightbox: false,
  })
  // The viewer scrolls (and so pans) only a diagram WIDER than its container, re-deciding on every
  // resize; a zoomed-in diagram that is only taller must pan too.
  graph.container.style.overflow = 'auto'
  graph.addListener(mxEvent.SIZE, () => (graph.container.style.overflow = 'auto'))
}

void main()
