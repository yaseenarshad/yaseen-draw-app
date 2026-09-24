/**
 * THE VIEWER PAGE (YAZ-1799, 🔒 D5/D9/D13): what someone who opens a share link sees.
 * A read-only Excalidraw (pan and zoom only) and the board's name. ONE link per board; when the
 * owner allows downloads (the default) it adds Download .excalidraw and Download PNG, which the
 * Worker also enforces (`/raw/<id>` is 403 when off). No login, no editing, no app. A draw.io
 * diagram gets draw.io's own read-only viewer instead, and Download .drawio (🔒 YAZ-1802 D11).
 *
 * A template string, not a file on disk: the page itself ships inside the Worker bundle as this
 * module. Its script — React plus the app's own vendored Excalidraw — and the fonts are the
 * Worker's STATIC ASSETS (`share/dist/assets/`, built by `tools/buildShareViewer.mjs`, uploaded
 * at setup), served from `/assets/`. Nothing is fetched from a third-party CDN at view time, and
 * there is no inline script: the Worker's CSP allows scripts from `/assets/` only.
 */


const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
/** JSON that is safe inside a <script> element. */
const scriptJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c')

/**
 * 🔒 YAZ-1802 D11: what the page loads for each kind of board. A diagram runs draw.io's own
 * read-only viewer, after `drawio/config.js` has pointed it at this Worker's assets (classic scripts,
 * in order), and our `diagram.js` module after both. It has no Download PNG: draw.io draws labels as
 * HTML inside the SVG, and a canvas holding that cannot be read back out as a PNG.
 */
const KIND_PAGES = {
  drawing: {
    noun: 'drawing',
    stylesheet: '/assets/viewer.css',
    downloads: '<button id="dl-excalidraw" type="button">Download .excalidraw</button>\n  <button id="dl-png" type="button" disabled>Download PNG</button>',
    scripts: '<script type="module" src="/assets/viewer.js"></script>',
  },
  diagram: {
    noun: 'diagram',
    stylesheet: '/assets/drawio/fonts.css',
    downloads: '<button id="dl-drawio" type="button">Download .drawio</button>',
    scripts: '<script src="/assets/drawio/config.js"></script>\n<script src="/assets/drawio/js/viewer-static.min.js"></script>\n<script type="module" src="/assets/diagram.js"></script>',
  },
}

const STYLE = `
  :root { color-scheme: light; --bar: #ffffff; --ink: #1e1e1e; --muted: #6b6b76; --line: #e4e4ea; --accent: #6965db; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #f6f6f9; color: var(--ink); font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .bar { height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 16px; background: var(--bar); border-bottom: 1px solid var(--line); }
  .bar h1 { font-size: 15px; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar .meta { color: var(--muted); font-size: 12px; white-space: nowrap; }
  .bar .spacer { flex: 1; }
  .bar button { font: inherit; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; white-space: nowrap; }
  .bar button:hover { border-color: var(--accent); color: var(--accent); }
  .bar button:disabled { opacity: .5; cursor: default; }
  #canvas { position: absolute; top: 52px; left: 0; right: 0; bottom: 0; }
  .note { position: absolute; inset: 52px 0 0 0; display: grid; place-items: center; color: var(--muted); }
  @media (max-width: 560px) { .bar .meta { display: none; } .bar button { padding: 6px 8px; } }
`

/** The page for a live share. `id` has passed the Worker's shape check; `allowDownload` is the owner's flag. */
export function viewerPage({ id, kind, allowDownload, name, updatedAt }) {
  const downloads = allowDownload === true
  const page = KIND_PAGES[kind]
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(name)} — shared ${page.noun}</title>
<link rel="stylesheet" href="${page.stylesheet}">
<style>${STYLE}</style>
</head>
<body>
<header class="bar">
  <h1 id="name">${escapeHtml(name)}</h1>
  <span class="meta" id="meta"></span>
  <span class="spacer"></span>
  ${downloads ? page.downloads : ''}
</header>
<div id="canvas"><div class="note" id="note">Loading ${page.noun}…</div></div>
<script id="board" type="application/json">${scriptJson({ id, allowDownload: downloads, name, updatedAt })}</script>
${page.scripts}
</body>
</html>`
}

/** The page for an id that was stopped, never existed, or is malformed — deliberately the same page for all three. */
export function missingPage(message = 'This link was stopped or never existed.') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Link not available</title>
<style>${STYLE}
  main { min-height: 100%; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 420px; text-align: center; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 32px 28px; }
  .card h1 { font-size: 18px; margin: 0 0 8px; }
  .card p { color: var(--muted); margin: 0; }
</style>
</head>
<body>
<main><div class="card"><h1>${escapeHtml(message)}</h1><p>If someone sent you this link, ask them to share the drawing again.</p></div></main>
</body>
</html>`
}
