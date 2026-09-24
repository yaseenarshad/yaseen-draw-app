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
 *   iframe → `{ event: 'yaseenReady' }`  our PostConfig.js has patched draw.io (D12a / D12b)
 *   iframe → `{ event: 'configure' }`    → host `{ action: 'configure', config }` (after yaseenReady)
 *   iframe → `{ event: 'init' }`         → host `{ action: 'load', xml, autosave: 1 }`
 *   iframe → `{ event: 'load', xml }`    the document is on screen: the autosave baseline
 *   iframe → `{ event: 'autosave', xml }` on every change; `{ event: 'save', xml }` on ⌘S
 * and, from the host at any time: `{ action: 'load', … }` again (an outside change on a clean tab),
 * `{ action: 'invokeAction', actionName: 'darkMode' | 'lightMode' }` (the app's theme, live) and
 * `{ action: 'yaseenAdaptiveColors', value }` (the dark-mode colour setting, live — ours, answered
 * by our PostConfig.js, because draw.io has no embed action for it).
 * From the iframe at any time: `{ event: 'shortcut', command: 'toggleSidebar' }` — an APP shortcut
 * pressed inside draw.io, where the host page never sees the key (see `DrawioMessage`).
 */
import type { DiagramDarkColors } from '@shared/types'

/** The iframe's origin — main's `app://` scheme, `drawio` host (🔒 YAZ-1802 D4). */
export const DRAWIO_ORIGIN = 'app://drawio'

/**
 * 🔒 YAZ-1802 D16: the app's "draw.io diagrams in dark mode" setting as draw.io's own
 * `Graph.defaultAdaptiveColors` — `auto` re-colours a diagram for dark mode, `none` keeps its
 * colours. It is the default a file's own `adaptiveColors` attribute overrides.
 */
export function drawioAdaptiveColors(setting: DiagramDarkColors): 'auto' | 'none' {
  return setting === 'adapt' ? 'auto' : 'none'
}

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

/**
 * Excalidraw's open-colour palette as the colour dialog's grid (🔒 YAZ-1802 D12a): draw.io lays
 * `defaultColors` out twelve to a row, so each row is one shade across the twelve families (gray,
 * red, pink, grape, violet, blue, cyan, teal, green, yellow, orange, bronze), lightest first, and
 * each column one family.
 */
const OPEN_COLOUR_GRID = [
  'F8F9FA', 'FFF5F5', 'FFF0F6', 'F8F0FC', 'F3F0FF', 'E7F5FF', 'E3FAFC', 'E6FCF5', 'EBFBEE', 'FFF9DB', 'FFF4E6', 'F8F1EE',
  'E9ECEF', 'FFC9C9', 'FCC2D7', 'EEBEFA', 'D0BFFF', 'A5D8FF', '99E9F2', '96F2D7', 'B2F2BB', 'FFEC99', 'FFD8A8', 'EADDD7',
  'CED4DA', 'FF8787', 'F783AC', 'DA77F2', '9775FA', '4DABF7', '3BC9DB', '38D9A9', '69DB7C', 'FFD43B', 'FFA94D', 'D2BAB0',
  '868E96', 'FA5252', 'E64980', 'BE4BDB', '7950F2', '228BE6', '15AABF', '12B886', '40C057', 'FAB005', 'FD7E14', 'A18072',
  '343A40', 'E03131', 'C2255C', '9C36B5', '6741D9', '1971C2', '0C8599', '099268', '2F9E44', 'F08C00', 'E8590C', '846358',
]

/**
 * 🔒 YAZ-1802 D12b, the NO-SELECTION half of the keymap (PostConfig.js has the selection half):
 * Excalidraw's tool letters on draw.io's own insert actions, and draw.io's clashing S (note) and
 * F (ellipse — Excalidraw's F is the frame tool, which draw.io has not got) cleared. X already is
 * draw.io's freehand pen.
 */
const TOOL_KEYS = [
  { keyCode: 'R', action: 'insertRectangle' },
  { keyCode: 'O', action: 'insertEllipse' },
  { keyCode: 'T', action: 'insertText' },
  { keyCode: 'A', action: 'insertEdge' },
  { keyCode: 'D', action: 'insertEdge' },
  { keyCode: 'L', action: 'insertEdge' },
  { keyCode: 'W', action: 'insertFreehand' },
  { keyCode: 'P', action: 'insertFreehand' },
  { keyCode: 'S', action: null },
  { keyCode: 'F', action: null },
  { keyCode: 220, control: true, action: 'removeFormat' }, // ⌘\ clears the formatting
]

/**
 * draw.io's own bindings on chords the app's MENU owns (`desktop/src/main/menu.ts`): ⌘K Search,
 * ⌘, Settings, ⌘⇧O Open Folder, ⌘0 / ⌘+ / ⌘− zoom (every key code draw.io reads as plus or
 * minus). On macOS a menu accelerator fires before the page sees the key anyway; off macOS the page
 * handles it first and draw.io's binding would swallow it. Cleared, the menu gets it everywhere.
 */
const MENU_CHORDS = [
  ...[75, 188, 48, 61, 107, 187, 222, 109, 173, 189].map((keyCode) => ({ keyCode, control: true, action: null })),
  { keyCode: 79, control: true, shift: true, action: null },
]

/**
 * The `configure` reply (🔒 YAZ-1802 D3 / D12a / D12b). Every key is one draw.io v31.5.2 reads in
 * `Editor.configure` (verified in `js/diagramly/Editor.js`), and every action name one it defines
 * (`tools/drawioOverlay.test.mjs` checks the pinned bundle). Fonts are NOT here: their
 * `@font-face` sheet lives on the drawio origin and our PostConfig.js hands it to
 * `Editor.configureFontCss` itself, so the host never needs to know the files.
 */
export function drawioConfig(darkColors: DiagramDarkColors): Record<string, unknown> {
  return {
    // D3: plain, uncompressed XML on every save (sets Editor.compressXml and defaultCompressed).
    compressXml: false,
    // D16: the dark-mode colour setting at startup; a change afterwards goes by `yaseenAdaptiveColors`.
    defaultAdaptiveColors: drawioAdaptiveColors(darkColors),
    // D12a: page view and grid off for anything new. Alignment guides start off the same way — a new
    // diagram is born `guides="0"` (Excalidraw's "object snap" off) — but stay a per-diagram toggle
    // (View › Guides), like the grid; connection snapping and arrow binding stay draw.io's own.
    defaultPageVisible: false,
    defaultGridEnabled: false,
    zoomWheel: false,
    compact: true,
    enableInlineToolbar: true,
    // D12a: 2 px lines, 8 px corners (16 on the absolute arc scale), Assistant — Excalidraw's look.
    defaultVertexStyle: { strokeWidth: 2, rounded: 1, absoluteArcSize: 1, arcSize: 16, fontFamily: 'Assistant' },
    defaultEdgeStyle: { strokeWidth: 2, fontFamily: 'Assistant' },
    defaultFonts: ['Assistant', 'Inter', 'Roboto', 'IBM Plex Mono', 'Liberation Serif'],
    // Excalidraw's quick picks: transparent, black and its four stroke colours, its four backgrounds.
    presetColors: ['none', '1E1E1E', 'E03131', '2F9E44', '1971C2', 'F08C00', 'FFC9C9', 'B2F2BB', 'A5D8FF', 'FFEC99'],
    defaultColors: [...OPEN_COLOUR_GRID, 'none', 'FFFFFF', '1E1E1E'],
    keyboardShortcuts: [...TOOL_KEYS, ...MENU_CHORDS],
  }
}

/**
 * Every message the iframe sends that the host acts on. `shortcut` is draw.io's own event for a
 * chord the host claims; our PostConfig.js sends it. Only a RENDERER-owned chord needs it — a menu
 * accelerator fires whatever frame has focus — and of those only ⌘B means something in a diagram:
 * the sidebar toggle with nothing selected (with a selection it stays draw.io's bold).
 */
export type DrawioMessage =
  | { event: 'yaseenReady' }
  | { event: 'configure' }
  | { event: 'init' }
  | { event: 'load'; xml?: string }
  | { event: 'autosave'; xml: string }
  | { event: 'save'; xml: string }
  | { event: 'shortcut'; command: 'toggleSidebar' }

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
  const { event, xml, command } = msg as Record<string, unknown>
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
    case 'shortcut':
      return command === 'toggleSidebar' ? { event, command } : null
    default:
      return null
  }
}
