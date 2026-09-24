/**
 * Loaded BEFORE draw.io's viewer on a shared diagram's page (🔒 YAZ-1802 D11), published as
 * `/assets/drawio/config.js` — the twin of the app's `yaseen-render-config.js`. Every path the viewer
 * would otherwise take from viewer.diagrams.net points at this Worker's `/assets/drawio/`, even the
 * ones nothing is published under (styles, shapes, mxgraph): unset, they default to that third party.
 * Published there: the stencils (`js/stencils.min.js`, looked up under `STENCIL_PATH`), `img/` and
 * the MathJax in `math4/` (`DRAWIO_SHARE_FILES` / `DRAWIO_SHARE_DIRS`).
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
