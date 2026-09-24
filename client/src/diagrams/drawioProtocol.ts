/**
 * The draw.io EMBED PROTOCOL as this app speaks it (🔒 YAZ-1802 D4) — pure, so the rules test
 * without an iframe. `DrawioEditor` is the only caller.
 *
 * The editor is jgraph's own webapp on its own origin, `app://drawio` (main serves it, see
 * `desktop/src/main/drawio/assets.ts`). The renderer and the iframe talk ONLY by postMessage, in
 * draw.io's `proto=json` dialect: every message is a JSON STRING. A message counts only when it
 * comes from THAT iframe's window AND from `DRAWIO_ORIGIN` — anything else on `window` is ignored.
 *
 * The conversation, in order:
 *   iframe → `{ event: 'yaseenReady' }`  our PostConfig.js has patched draw.io (D12)
 *   iframe → `{ event: 'configure' }`    → host `{ action: 'configure', config }` (after yaseenReady)
 *   iframe → `{ event: 'init' }`         → host `{ action: 'load', xml, autosave: 1 }`
 *   iframe → `{ event: 'load', xml }`    the document is on screen: the autosave baseline
 *   iframe → `{ event: 'autosave', xml }` on every change; `{ event: 'save', xml }` on ⌘S
 * and, from the host at any time: `{ action: 'load', … }` again (an outside change on a clean tab)
 * and `{ action: 'invokeAction', actionName: 'darkMode' | 'lightMode' }` (the app's theme, live).
 */

/** The iframe's origin — main's `app://` scheme, `drawio` host (🔒 YAZ-1802 D4). */
export const DRAWIO_ORIGIN = 'app://drawio'

/**
 * The iframe URL (🔒 YAZ-1802 D4): embed mode over JSON, configured by us, no save or exit button
 * (autosave is the save), and every door to the network shut — `offline`, `stealth`, `lockdown`,
 * no plugins, no PWA, no Google / Dropbox / OneDrive / GitHub / GitLab / Trello. `pv=0` keeps the
 * page view off (D12); `dark` is the app's theme at mount, later changes go by message.
 */
export function drawioFrameUrl(theme: 'light' | 'dark'): string {
  const params = new URLSearchParams({
    embed: '1',
    proto: 'json',
    configure: '1',
    spin: '1',
    noSaveBtn: '1',
    noExitBtn: '1',
    saveAndExit: '0',
    offline: '1',
    stealth: '1',
    lockdown: '1',
    plugins: '0',
    pwa: '0',
    gapi: '0',
    db: '0',
    od: '0',
    gh: '0',
    gl: '0',
    tr: '0',
    pv: '0',
    dark: theme === 'dark' ? '1' : '0',
    ui: 'simple',
  })
  return `${DRAWIO_ORIGIN}/index.html?${params.toString()}`
}

/** Excalidraw's open-colour palette, lightest to darkest per family — the colour dialog's grid (D12). */
const OPEN_COLOUR: readonly (readonly string[])[] = [
  ['F8F9FA', 'E9ECEF', 'CED4DA', '868E96', '343A40'],
  ['FFF5F5', 'FFC9C9', 'FF8787', 'FA5252', 'E03131'],
  ['FFF0F6', 'FCC2D7', 'F783AC', 'E64980', 'C2255C'],
  ['F8F0FC', 'EEBEFA', 'DA77F2', 'BE4BDB', '9C36B5'],
  ['F3F0FF', 'D0BFFF', '9775FA', '7950F2', '6741D9'],
  ['E7F5FF', 'A5D8FF', '4DABF7', '228BE6', '1971C2'],
  ['E3FAFC', '99E9F2', '3BC9DB', '15AABF', '0C8599'],
  ['E6FCF5', '96F2D7', '38D9A9', '12B886', '099268'],
  ['EBFBEE', 'B2F2BB', '69DB7C', '40C057', '2F9E44'],
  ['FFF9DB', 'FFEC99', 'FFD43B', 'FAB005', 'F08C00'],
  ['FFF4E6', 'FFD8A8', 'FFA94D', 'FD7E14', 'E8590C'],
  ['F8F1EE', 'EADDD7', 'D2BAB0', 'A18072', '846358'],
]

/**
 * The `configure` reply (🔒 YAZ-1802 D3 / D12). Every key is one draw.io v31.5.2 reads in
 * `Editor.configure` (verified in `js/diagramly/Editor.js`). Fonts are NOT here: their
 * `@font-face` sheet lives on the drawio origin and our PostConfig.js hands it to
 * `Editor.configureFontCss` itself, so the host never needs to know the files.
 */
export function drawioConfig(): Record<string, unknown> {
  return {
    // D3: plain, uncompressed XML on every save (sets Editor.compressXml and defaultCompressed).
    compressXml: false,
    // D12: page view and grid off for anything new; the snapping GUIDES off (Excalidraw's
    // "object snap off") while connection snapping and arrow binding stay draw.io's own.
    defaultPageVisible: false,
    defaultGridEnabled: false,
    enablePositionGuides: false,
    enableDistanceGuides: false,
    enableSizeGuides: false,
    zoomWheel: false,
    compact: true,
    enableInlineToolbar: true,
    defaultVertexStyle: { strokeWidth: 2, rounded: 1, absoluteArcSize: 1, arcSize: 16, fontFamily: 'Assistant' },
    defaultEdgeStyle: { strokeWidth: 2, fontFamily: 'Assistant' },
    defaultFonts: ['Assistant', 'Inter', 'Roboto', 'IBM Plex Mono', 'Liberation Serif'],
    presetColors: ['none', '1E1E1E', 'E03131', '2F9E44', '1971C2', 'F08C00', 'FFC9C9', 'B2F2BB', 'A5D8FF', 'FFEC99'],
    defaultColors: ['none', 'FFFFFF', '1E1E1E', ...OPEN_COLOUR.flat()],
    // D12 keymap, the no-selection half (the colour letters branch in PostConfig.js): clear
    // draw.io's own bare-letter tools that now mean something else, map the rest.
    keyboardShortcuts: [
      { keyCode: 'S', action: null }, // was insertNote
      { keyCode: 'F', action: null }, // was insertEllipse — Excalidraw's F is the frame tool, which draw.io has not got
      { keyCode: 'L', action: 'insertEdge' }, // was insertLink
      { keyCode: 'X', action: 'insertFreehand' },
      { keyCode: 220, control: true, action: 'removeFormat' }, // ⌘\
    ],
  }
}

/** Every message the iframe sends that the host acts on. */
export type DrawioMessage =
  | { event: 'yaseenReady' }
  | { event: 'configure' }
  | { event: 'init' }
  | { event: 'load'; xml?: string }
  | { event: 'autosave'; xml: string }
  | { event: 'save'; xml: string }

/**
 * One `message` event, if it is the iframe speaking: the right window, the right origin, a JSON
 * string, an event we know. Everything else — another frame, a devtools poke, draw.io's own
 * `exit` or an unknown event — is null and ignored.
 */
export function readDrawioMessage(ev: { source: unknown; origin: string; data: unknown }, frame: unknown): DrawioMessage | null {
  if (frame == null || ev.source !== frame || ev.origin !== DRAWIO_ORIGIN || typeof ev.data !== 'string') return null
  let msg: unknown
  try {
    msg = JSON.parse(ev.data)
  } catch {
    return null
  }
  if (typeof msg !== 'object' || msg === null) return null
  const { event, xml } = msg as Record<string, unknown>
  switch (event) {
    case 'yaseenReady':
    case 'configure':
    case 'init':
      return { event }
    case 'load':
      return typeof xml === 'string' ? { event, xml } : { event }
    case 'autosave':
    case 'save':
      return typeof xml === 'string' ? { event, xml } : null
    default:
      return null
  }
}
