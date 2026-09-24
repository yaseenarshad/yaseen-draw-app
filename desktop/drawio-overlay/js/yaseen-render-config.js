/**
 * Loaded BEFORE draw.io's viewer on `yaseen-render.html` (🔒 YAZ-1802 D9): every path the viewer
 * would otherwise take from viewer.diagrams.net points at this origin instead. The CSP would block
 * the network anyway; this makes the stencils and styles actually resolve.
 */
(function()
{
	var base = window.location.origin;
	window.DRAWIO_BASE_URL = base;
	window.PROXY_URL = null;
	window.STYLE_PATH = base + '/styles';
	window.SHAPES_PATH = base + '/shapes';
	window.STENCIL_PATH = base + '/stencils';
	window.DRAW_MATH_URL = base + '/math4/es5';
	window.GRAPH_IMAGE_PATH = base + '/img';
	window.mxImageBasePath = base + '/mxgraph/images';
	window.mxBasePath = base + '/mxgraph/';
	window.mxLoadResources = false;
	window.mxLoadStylesheets = false;
})();
