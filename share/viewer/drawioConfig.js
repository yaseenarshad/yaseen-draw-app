/**
 * Loaded BEFORE draw.io's viewer on a shared diagram's page (🔒 YAZ-1802 D11) — the share page's
 * twin of the app's `yaseen-render-config.js`, published as `/assets/drawio/config.js`. Every path
 * the viewer would otherwise take from viewer.diagrams.net points at this Worker's own
 * `/assets/drawio/` instead: nothing is fetched from a third party at view time (the CSP refuses a
 * foreign script or fetch anyway, but not an image). Of these, only the stencils ship, as the one
 * file `js/stencils.min.js` that `diagram.js` loads for a diagram with library shapes — it looks each
 * set up by its path under `STENCIL_PATH` (🔒 YAZ-1802 D5); the rest is bundled into the viewer or
 * never used read-only.
 */
window.DRAWIO_BASE_URL = `${window.location.origin}/assets/drawio`
window.PROXY_URL = null
window.STYLE_PATH = `${window.DRAWIO_BASE_URL}/styles`
window.SHAPES_PATH = `${window.DRAWIO_BASE_URL}/shapes`
window.STENCIL_PATH = `${window.DRAWIO_BASE_URL}/stencils`
window.DRAW_MATH_URL = `${window.DRAWIO_BASE_URL}/math4/es5`
window.GRAPH_IMAGE_PATH = `${window.DRAWIO_BASE_URL}/img`
window.mxImageBasePath = `${window.DRAWIO_BASE_URL}/mxgraph/images`
window.mxBasePath = `${window.DRAWIO_BASE_URL}/mxgraph/`
window.mxLoadResources = false
window.mxLoadStylesheets = false
