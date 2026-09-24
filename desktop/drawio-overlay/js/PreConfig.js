/**
 * Yaseen Draw's PreConfig (🔒 YAZ-1802 D12) — laid over draw.io's own stub by `tools/packDrawio.mjs`.
 * draw.io's `bootstrap.js` loads this BEFORE `app.min.js` whenever the page is not on a draw.io
 * domain, which `app://drawio` never is. It is a config hook, not draw.io code: the first block is
 * draw.io's stub verbatim, the second is ours.
 *
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.DRAWIO_PUBLIC_BUILD = true;
window.EXPORT_URL = null; // With null, export to PDF uses the print dialog
window.DRAWIO_BASE_URL = null;
window.DRAWIO_VIEWER_URL = null;
window.DRAWIO_LIGHTBOX_URL = null;
window.DRAW_MATH_URL = 'math4/es5';
window.DRAWIO_CONFIG = null; // Configured by the host over postMessage instead (configure=1)
urlParams['sync'] = 'manual';

// ---- Yaseen Draw ----
// 🔒 YAZ-1802 D12: nothing about a diagram opens with the page view on, whatever the file says.
// `pv=0` is draw.io's own switch (Editor.readGraphState): the page view is OFF on screen, and the
// file's own `page` attribute is kept for the next save, so opening a diagram never rewrites it.
urlParams['pv'] = '0';
