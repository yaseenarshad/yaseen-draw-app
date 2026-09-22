/**
 * Shared renderer/main contracts for Yaseen Draw (locked in GRO-1961, bridge in GRO-2153) —
 * see docs/CONTRACTS.md "Bridge API" and "App state schema" for the prose version.
 *
 * All paths are ABSOLUTE, POSIX-style (`/Users/...`). The main process imposes no
 * jail: any absolute path on the machine may be read or written.
 */

// ---------- Errors ----------

export type BridgeErrorCode =
  | 'BAD_REQUEST' // missing/invalid argument
  | 'NOT_ABSOLUTE' // path is not absolute
  | 'NOT_FOUND' // path does not exist
  | 'NOT_A_DIRECTORY' // expected a directory
  | 'NOT_A_FILE' // expected a regular file
  | 'UNSUPPORTED_EXTENSION' // file extension is not supported by the requested capability
  | 'ALREADY_EXISTS' // create target already exists
  | 'FORBIDDEN' // OS permission denied
  | 'TOO_LARGE' // file exceeds MAX_FILE_BYTES, or a media import exceeds MAX_IMPORT_BYTES (🔒 D4)
  | 'IO_ERROR' // any other fs error
  | 'PICKER_FAILED' // native folder dialog could not be run
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendraw/github.json) is unusable; the mutation is refused, the file never touched
  | 'ENCRYPTION_UNAVAILABLE' // 🔒 D4: the OS keychain cannot encrypt on this machine, so no secret can be stored
  | 'UNSUPPORTED_TYPE' // 🔒 D4: a media provider answered with something that is not an image (the worker's 415)
  | 'PROVIDER_FAILED' // 🔒 D4: a media provider was REACHED and refused, or answered nonsense (the worker's 502)
  | 'OFFLINE' // 🔒 D4: the provider could not be reached at all — a passive state in the UI, never an error banner

/** The one document extension the app opens, edits and creates (🔒 D1). */
export const DRAWING_VIEW_EXTENSIONS = ['.excalidraw'] as const

/** The file kinds the app can open in-app. A file of no kind still lists (YAZ-1577). */
export type FileKind = 'drawing'
export const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * The ceiling on ONE drawing document read through `drawing:load` (🔒 YAZ-1810). Deliberately
 * 20× `MAX_FILE_BYTES`: that cap guards a text editor's buffer, while a LEGACY `.excalidraw`
 * (an upstream export, or one this app wrote before 🔒 D3) embeds its images as base64 and is
 * routinely past 10 MiB before it has been opened once. 200 MiB is the size at which a scene
 * has stopped being a document; the store (🔒 D3) keeps every saved file far below it.
 */
export const MAX_DRAWING_BYTES = 200 * 1024 * 1024

// ---------- tree(root) ----------

export type TreeNode =
  | {
      type: 'dir'
      name: string
      path: string
      children: TreeNode[]
    }
  | {
      type: 'file'
      name: string
      path: string
      /** Byte size. */
      size: number
      /** mtime in epoch ms. */
      mtime: number
      /** Preview classification (`shared/fileKind.ts`); `null` = listed, but no in-app viewer (YAZ-1577 D1). */
      kind: FileKind | null
    }

export interface TreeResponse {
  root: string
  /** Recursive tree of the root: every file and every directory, supported or not (GRO-2022). Hidden (dot) entries and `node_modules` skipped. */
  tree: TreeNode[]
  /** Main-process time (epoch ms) when the tree was computed. */
  generatedAt: number
}

// ---------- readFile(path) ----------

export interface FileResponse {
  path: string
  /** UTF-8 file contents, strictly decoded. */
  content: string
  mtime: number
  size: number
}

// ---------- drawing:load / drawing:save (🔒 YAZ-1810, the drawing DOCUMENT's two doors) ----------

/**
 * One image the canvas holds, as it crosses the bridge: the engine's own mime plus a base64
 * `data:` URL. Deliberately NOT the engine's `BinaryFileData` — the bridge must not depend on a
 * renderer package, and `created`/`lastRetrieved` are the engine's bookkeeping, not the file's.
 */
export interface DrawingFileEntry {
  mimeType: string
  /** `data:<mime>;base64,<payload>` — the only form either side accepts. */
  dataURL: string
}

export interface DrawingLoadRequest {
  /** Vault root; the document must resolve inside it. */
  root: string
  /** The document, vault-relative or absolute under `root`. Never a basename search. */
  path: string
}

export interface DrawingLoadResponse {
  /** Absolute path that was read — what every later save addresses. */
  path: string
  /** The file's bytes as UTF-8 text, exactly as they sit on disk. */
  json: string
  /** Disk mtime of the read: the `expectedMtime` the first save goes back with. */
  mtime: number
  size: number
  /**
   * Every image the scene still references and whose bytes were found, keyed by `fileId`. An id
   * with no bytes anywhere is simply absent — the engine draws its placeholder and the document
   * still opens (🔒 D3).
   */
  files: Record<string, DrawingFileEntry>
  /**
   * The subset of `files` that came from the STORE rather than from the file's own embedded
   * `files` map. The renderer never ships these back (they are already on disk); anything else
   * it holds is `newFiles` on the next save.
   */
  stored: string[]
}

/** One image a save must land in the store before the scene that names it is written. */
export interface DrawingNewFile extends DrawingFileEntry {
  /** Excalidraw's own content id (the SHA-1 of the bytes) — the file's name under `assets/`. */
  fileId: string
}

export interface DrawingSaveRequest {
  root: string
  path: string
  /** The serialized scene. Written verbatim but for the store's own `files: {}` rewrite (🔒 D3). */
  json: string
  /** The mtime the renderer last read or wrote; a differing disk mtime rejects `CONFLICT` and writes NOTHING — assets included. */
  expectedMtime?: number
  /** Images the store does not have yet. Written first, so the scene on disk never names bytes that are missing. */
  newFiles: DrawingNewFile[]
}

export interface DrawingSaveResponse {
  path: string
  mtime: number
  size: number
  /** The ids now on disk — the renderer adds them to its persisted set so it never ships them twice. */
  persisted: string[]
}

export interface DrawingApi {
  /** Read one `.excalidraw` AS A DOCUMENT, with the bytes of the images it names. */
  load(req: DrawingLoadRequest): Promise<DrawingLoadResponse>
  /** Write one `.excalidraw`: assets first, then the scene, atomically. */
  save(req: DrawingSaveRequest): Promise<DrawingSaveResponse>
  /**
   * The RESOLVED library folder (🔒 D5): `SettingsState.libraryFolder`, or `<userData>/library`
   * when that is null. Only main knows where userData is, so only main can answer — the Settings
   * row shows what comes back. Main also makes sure the folder exists at startup, so the answer
   * always names a real directory. Its CONTENTS (`media.json`, `components/`) are 3A/3B/3C's.
   */
  libraryFolder(): Promise<string>
}

// ---------- writeFile(req) ----------

export interface FileWriteRequest {
  path: string
  /** Full file contents to write. Written atomically (tmp + rename). */
  content: string
  /**
   * Optional optimistic-concurrency guard: the mtime the renderer last read.
   * If provided and the file's current mtime differs, the call rejects with a
   * `BridgeError` whose code is `CONFLICT` (carrying the disk `mtime`) and does NOT write.
   */
  expectedMtime?: number
}

export interface FileWriteResponse {
  path: string
  mtime: number
  size: number
}

// ---------- createDir(path) ----------

export interface CreateDirResponse {
  path: string
}

// ---------- createFile(req) ----------

/**
 * `createFile` takes the bare path or `{ path, content }` (Bible B, GRO-2202): when `content`
 * is given it lands in the same atomic `wx` write — content-at-create, so scaffolded pages and
 * starter bases keep the never-overwrite guarantee without a create-then-write race.
 */
export interface CreateFileRequest {
  path: string
  /** Initial file contents; omitted → an empty file. */
  content?: string
}

export interface CreateFileResponse {
  path: string
  mtime: number
  /** The created file's byte length (0 for an empty create). */
  size: number
}

// ---------- file.rename(req) (Links E1 + E1b, GRO-2194 / GRO-2241) ----------

/**
 * In-app rename/move. Files rename in place or move between folders (extension KIND
 * unchanged: md↔md, base↔base); directories rename/move too (`kind: 'dir'` in the
 * response — no extension rules, dot-dirs and the calling window's own vault root are
 * refused `BAD_REQUEST`). The target's parent must already exist (`NOT_FOUND` — never a
 * mkdir). Never overwrites: an existing target rejects `ALREADY_EXISTS`. The same handler
 * repairs every stored path reference — for a dir, everything at or UNDER it: window
 * roots/files/tabs, recents, folder-state keys and their expanded/lastFile/fold/base-group
 * entries — and pushes `file:renamed` to every window.
 */
export interface RenameFileRequest {
  oldPath: string
  newPath: string
}

export interface RenameFileResponse {
  oldPath: string
  newPath: string
  /** What moved: a single file, or a directory (E1b — renderers then remap by prefix). */
  kind: 'file' | 'dir'
}

/** Pushed to EVERY window after a successful in-app rename; renderers remap their own tabs (a `dir` event remaps every tab under the old prefix). */
export interface FileRenamedEvent {
  oldPath: string
  newPath: string
  kind: 'file' | 'dir'
}

// ---------- file clipboard (YAZ-1674) ----------

/**
 * Cut / Copy from the sidebar (YAZ-1674, D1): the ONE app-wide clipboard lives in main, so a
 * paste in any window — on the same vault or another — takes what any window cut or copied.
 * `paths` is the ORDERED selection (one row, or the whole multi-select), absolute; `op` decides
 * what a later paste does (D2: a cut MOVES through the rename pipeline and pastes once; a copy
 * COPIES and pastes again and again). Session-only, never persisted. Rejects `BAD_REQUEST` for
 * a missing/unknown `op` or an empty `paths`, `NOT_ABSOLUTE` for a relative entry.
 */
export interface FileClipRequest {
  paths: string[]
  op: 'copy' | 'cut'
}

/** `clip:changed` — pushed to EVERY window after every clipboard change: how many, and which verb; null when empty (the menu's disabled "Paste"). */
export type FileClipState = { count: number; op: 'copy' | 'cut' } | null

/** Paste the clipboard INTO this folder (D5: a dir row → itself, a file row → its parent, blank space → the vault root). Must exist — never created. */
export interface PasteRequest {
  targetDir: string
}

/**
 * Per-entry outcome of a paste (D3): every clipboard entry lands in exactly one of the two
 * lists, in clipboard order — except a cut entry already in `targetDir`, which is skipped
 * silently (nothing to do). A copy that clashes takes Finder's next free name (`Note copy.md`,
 * `Note copy 2.md`; folders keep the whole name); a cut that clashes fails `ALREADY_EXISTS`.
 * A cut across volumes fails `IO_ERROR` ("cannot move across disks; copy it instead"); a
 * stale entry `NOT_FOUND`; a hidden source or a folder into itself `BAD_REQUEST`.
 */
export interface PasteResponse {
  pasted: { from: string; to: string; kind: 'file' | 'dir' }[]
  failed: { from: string; code: BridgeErrorCode; message: string }[]
}

// ---------- pickFolder() ----------

/**
 * Opens Electron's native open-directory dialog, parented to the calling window, and resolves
 * once the user picks a folder or cancels. Dialog failure → rejects `PICKER_FAILED`. One dialog
 * in flight per window: a call while that window's dialog is open resolves `{ cancelled: true }`.
 */
export type PickFolderResponse =
  | {
      /** Absolute path of the chosen folder, without trailing slash. */
      path: string
    }
  | {
      /** The user dismissed the dialog. */
      cancelled: true
    }

// ---------- watch(root, listener) ----------

/**
 * Delivered to the listener for as long as the subscription lives. A `ready` event is sent
 * once the watcher has completed its initial scan (at once for late joiners of a shared root).
 */
export type WatchEvent =
  | { type: 'ready'; root: string }
  | { type: 'add'; path: string; mtime: number }
  | { type: 'change'; path: string; mtime: number }
  | { type: 'unlink'; path: string }
  | { type: 'addDir'; path: string }
  | { type: 'unlinkDir'; path: string }
  | { type: 'error'; message: string }

// ---------- Canvas prefs and the canvas panel (YAZ-1775 🔒 D9 / 🔒 D10) ----------

/**
 * The user-level canvas preferences held in `SettingsState.canvas`: the engine's
 * `browser: true, export: false` appState (`packages/excalidraw/appState.ts`) plus frame
 * visibility. The TYPE and the DEFAULTS live in this leaf file; the mapping to and from the
 * engine's appState keys is `shared/canvasPrefs.ts`, which imports from here so that nothing
 * downstream of the mapping has to know about the engine.
 *
 * WHY here and not in the engine's own localStorage (the web app's answer): the engine package
 * does not persist appState, so grid / tool lock / zen would reset on every mount, be invisible
 * to the settings cog, and differ per window. One store, broadcast to every window, is the rule.
 */
export const SELECT_ON_MODES = ['wrap', 'overlap'] as const
export type SelectOn = (typeof SELECT_ON_MODES)[number]
/** The engine's roughness presets (`ROUGHNESS`): architect 0, artist 1, cartoonist 2. */
export const ROUGHNESS_LEVELS = [0, 1, 2] as const
export type Roughness = (typeof ROUGHNESS_LEVELS)[number]
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const
export type TextAlign = (typeof TEXT_ALIGNS)[number]

/**
 * The fork's `FONT_FAMILY` ids the Default font row offers (`packages/common/src/constants.ts`),
 * Assistant first because it is the value the web app forced through a one-shot localStorage
 * migration — carried here as a plain preference instead, with no migration stamp (🔒 D9).
 * Id 4 is deliberately absent: the fork leaves it unused for historical reasons.
 */
export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ id: number; label: string }> = [
  { id: 10, label: 'Assistant' },
  { id: 5, label: 'Excalifont' },
  { id: 1, label: 'Virgil' },
  { id: 2, label: 'Helvetica' },
  { id: 3, label: 'Cascadia' },
  { id: 6, label: 'Nunito' },
  { id: 7, label: 'Lilita One' },
  { id: 8, label: 'Comic Shanns' },
  { id: 9, label: 'Liberation Sans' },
  { id: 11, label: 'Inter' },
  { id: 12, label: 'Roboto' },
  { id: 13, label: 'Liberation Serif' },
  { id: 14, label: 'IBM Plex Mono' },
]

export interface CanvasPrefs {
  gridModeEnabled: boolean
  objectsSnapModeEnabled: boolean
  /** The engine's `isMidpointSnappingEnabled`. */
  snapToMidpoints: boolean
  /** The engine's `isBindingEnabled` (arrows bind to the shapes they touch). */
  arrowBinding: boolean
  /** The engine's `boxSelectionMode`: `wrap` = `contain`, `overlap` = `overlap`. */
  selectOn: SelectOn
  /** `activeTool.locked` — NOT a plain key: a live update has to merge with the CURRENT tool. */
  toolLock: boolean
  zenModeEnabled: boolean
  writingMode: boolean
  /** The engine's `currentItemWritingStrokeWidth` (`WRITING_STROKE_WIDTH.default`). */
  writingStrokeWidth: number
  /** The engine's `currentItemVectorStrokeWidth` (`STROKE_WIDTH.medium`). */
  vectorStrokeWidth: number
  /**
   * `frameRendering.outline` + `.name` together — the grey box and its label. NEVER `clip` or
   * `enabled`: turning `enabled` off would also stop frames clipping their children. Applied
   * through the engine's `updateFrameRendering`, never through appState.
   */
  framesVisible: boolean
  /** New text's font (`currentItemFontFamily`, a `FONT_FAMILY_OPTIONS` id): Assistant (10). */
  defaultFontFamily: number
  /** New shapes' sloppiness (`currentItemRoughness`): architect (0). */
  defaultRoughness: Roughness
  /** New text's alignment (`currentItemTextAlign`): the engine's `DEFAULT_NEW_TEXT_ALIGN`. */
  defaultTextAlign: TextAlign
}

/** The engine's own defaults (`appState.ts` `getDefaultAppState()` + `constants.ts`). */
export const DEFAULT_CANVAS_PREFS: CanvasPrefs = {
  gridModeEnabled: false,
  objectsSnapModeEnabled: false,
  snapToMidpoints: true,
  arrowBinding: true,
  selectOn: 'wrap',
  toolLock: false,
  zenModeEnabled: false,
  writingMode: false,
  writingStrokeWidth: 0.5,
  vectorStrokeWidth: 2,
  framesVisible: true,
  defaultFontFamily: 10,
  defaultRoughness: 0,
  defaultTextAlign: 'center',
}

/**
 * The in-canvas docked panel's tabs (⚡ D8 amended), in the order its strip shows them. The web
 * app's `boards` and `docs` tabs are not here: the shell sidebar IS the boards list, and there is
 * no Docs subsystem. The tab NAMES are the engine's sidebar tab names, kept as the web app spelled
 * them so the engine's own sidebar state reads the same on both sides.
 */
export const CANVAS_PANEL_TABS = ['image-studio', 'components', 'presentation'] as const
export type CanvasPanelTab = (typeof CANVAS_PANEL_TABS)[number]
export const isCanvasPanelTab = (v: unknown): v is CanvasPanelTab => (CANVAS_PANEL_TABS as readonly string[]).includes(v as string)

/**
 * What the canvas panel remembers between mounts (🔒 D10, and the parity checklist's §5): the tab
 * the hamburger opens on, and whether the panel is docked. The web app kept both in localStorage
 * (`yaseen-whiteboard-last-sidebar-section`, `yaseen-whiteboard-sidebar-docked:<username>`); 🔒 D9
 * carries over the BEHAVIOUR and not the keys, so they live in `SettingsState` — app-global, which
 * is exactly what one browser profile's localStorage was, and every window follows a change live.
 * Whether the panel is OPEN is not remembered: it starts closed on every mount, as the web app's
 * startup `toggleSidebar({ name: null, force: false })` did.
 */
export interface CanvasPanelState {
  tab: CanvasPanelTab
  docked: boolean
}

export const DEFAULT_CANVAS_PANEL: CanvasPanelState = { tab: 'components', docked: false }

// ---------- App state (main-owned `yaseendraw.json`, D9 — GRO-2159) ----------

/** `AppState.recents` — most-recent first, max MAX_RECENT_ROOTS, de-duplicated. */
export type RecentRoots = Array<{ path: string; lastOpened: number }>
export const MAX_RECENT_ROOTS = 10

/** Pure: prepend `path` to the MRU list, de-duplicated, capped — shared by the client cache and the main store. */
export function addRecentRoot(list: RecentRoots, path: string, now: number): RecentRoots {
  return [{ path, lastOpened: now }, ...list.filter((r) => r.path !== path)].slice(0, MAX_RECENT_ROOTS)
}

/** Entries in a vault's `.yaseendraw/favorites.json` (YAZ-1766 D2, in the vault since 6A/D11) are capped at this many on read and write. */
export const MAX_FAVORITES = 500

/**
 * `WindowEntry.sidebarLens` — which lens the sidebar's chrome-v2 ROW 1 tabs show (⚡ D8 amended):
 * `files` (the file explorer) or `favorites` (the pinned files and folders, YAZ-1766 D1).
 * Window identity like `sidebarCollapsed` since YAZ-1628: the tabs are not per-folder view
 * state, so there is no per-root keying and no `FolderState` entry. Any unrecognised stored
 * value falls back to the default, `files`.
 */
export type SidebarLens = 'files' | 'favorites'
/** The tabs' order, left→right: the default lens leads. */
export const SIDEBAR_LENSES: readonly SidebarLens[] = ['files', 'favorites']
export const isSidebarLens = (v: unknown): v is SidebarLens => SIDEBAR_LENSES.includes(v as SidebarLens)

/** `AppState.sidebarWidth` — the drag-to-resize bounds (YAZ-738), clamped on every write and on load. */
export const SIDEBAR_MIN_W = 180
export const SIDEBAR_MAX_W = 520
export const SIDEBAR_DEFAULT_W = 260

/**
 * `AppState.settings` — app-global preferences (GRO-2024), one user-global file for every vault.
 */
export interface SettingsState {
  /** Appearance (Desktop K, GRO-2218): explicit values win; `system` tracks the OS live. */
  theme: Theme
  /**
   * The one library folder every vault shares (🔒 D5): an absolute path the user chose, or null
   * for the default `<userData>/library`. Media favorites and saved components were per cloud
   * account in the web app; per-vault storage would mean re-favouriting in every vault, and app
   * userData alone would never be backed up. A folder the user can point inside a synced vault is
   * both. `drawing.libraryFolder()` resolves it; null is the default, never `''`. Its contents
   * (`media.json`, `components/`) are written by 3A / 3B / 3C.
   */
  libraryFolder: string | null
  /**
   * Show the confirm sheet before deleting (GRO-2272 — VS Code's `explorer.confirmDelete`).
   * Defaults TRUE and should stay that way: the sheet is the ONLY guard on delete, because
   * `shell.trashItem` has no programmatic undo, so there is no in-app restore to fall back
   * on. Cleared from the sheet's own "Don't ask me again" and re-enabled from the settings
   * cog — a one-way switch would leave hand-editing `yaseendraw.json` as the only way back.
   */
  confirmDelete: boolean
  /**
   * The canvas preferences every board, every window and every relaunch share (🔒 D9). Seeded
   * into the engine at mount and kept in step both ways, diff-before-write in each direction so
   * two windows can never ping-pong. See `CanvasPrefs`.
   */
  canvas: CanvasPrefs
  /** What the in-canvas docked panel remembers: its last-used tab and its dock preference (🔒 D10). */
  canvasPanel: CanvasPanelState
}

/** Obsidian's Appearance vocabulary and order — also exactly Electron's `nativeTheme.themeSource`. */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'system',
  libraryFolder: null,
  confirmDelete: true,
  canvas: DEFAULT_CANVAS_PREFS,
  canvasPanel: DEFAULT_CANVAS_PANEL,
}

export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One open window; restored on relaunch (GRO-2160). `root` null = Welcome screen.
 *
 * Tabs (GRO-2232): `tabs` is every open file as absolute paths, de-duplicated, ordered
 * left→right; `file` doubles as the ACTIVE tab — there is no separate activeTab field.
 * Invariants: `file ∈ tabs` whenever `file` is non-null, and `tabs: []` ⇔ `file: null`
 * (the no-tabs state). Deliberately additive within `AppState.version` 1 — bumping the
 * version would make `sanitizeState` treat every existing store file as corrupt. An old
 * build's field-by-field sanitizer silently drops the unknown `tabs` key and falls back
 * to `file` (graceful downgrade); this build repairs a missing `tabs` from `file`.
 */
export interface WindowEntry {
  id: string
  root: string | null
  file: string | null
  tabs: string[]
  /** Whether this window's sidebar is hidden (YAZ-1280); independent from every other window. */
  sidebarCollapsed: boolean
  /**
   * Which sidebar lens THIS window shows (YAZ-847; per window since YAZ-1628, `sidebarCollapsed`'s
   * rule): independent from every other window — a duplicate inherits it and then diverges — and
   * kept across a root change, being a view preference rather than vault content. A pre-1628
   * file's retired global value seeds every window that has none of its own.
   */
  sidebarLens: SidebarLens
  /**
   * Focus Mode (YAZ-1605; per window since YAZ-1628): the directories THIS window's Files tree
   * is narrowed to — one or several (a shift-selection) — or empty for the whole vault. Window
   * identity like `sidebarCollapsed`, so a second window on the same vault focuses on its own:
   * a duplicate inherits the list by value and then diverges, a root change clears it. A flat
   * list of absolute paths, so `store.renamePath` / `store.removePath` repair it as they repair
   * `tabs` — a renamed focus follows its folder, a deleted one drops out.
   */
  focusDirs: string[]
  /** Its Favorites twin (YAZ-1766 D5): the favorited DIRS this window's Favorites tab is narrowed to, or empty. */
  focusFavorites: string[]
  bounds: WindowBounds
}

/**
 * View state that only means something inside that folder (the retired localStorage
 * mdapp.expanded / lastFile). `expanded` is a SESSION list (YAZ-1642): shared by every window on
 * the vault through the main-owned store, never written to disk and never restored — a launch
 * starts the tree collapsed. `lastFile` persists.
 */
export interface FolderState {
  expanded: string[]
  lastFile: string | null
}

/**
 * The whole persisted app state — one user-global JSON file, owned by the main process
 * (`~/Library/Application Support/Yaseen Draw/yaseendraw.json`). Settings are global so
 * they apply to every folder and travel to another machine by copying this one file.
 */
export interface AppState {
  version: 1
  settings: SettingsState
  /** Sidebar width in px, within [SIDEBAR_MIN_W, SIDEBAR_MAX_W]. */
  sidebarWidth: number
  /** Most-recent first, max 10, de-duplicated. */
  recents: RecentRoots
  windows: WindowEntry[]
  folders: Record<string, FolderState>
}

/** A fresh default state (a factory, so no caller can mutate a shared constant). */
export function defaultAppState(): AppState {
  return { version: 1, settings: { ...DEFAULT_SETTINGS }, sidebarWidth: SIDEBAR_DEFAULT_W, recents: [], windows: [], folders: {} }
}

export function defaultFolderState(): FolderState {
  return { expanded: [], lastFile: null }
}

// ---------- Vault-local config (`<root>/.yaseendraw/`, Desktop J — GRO-2188) ----------

/**
 * The `.obsidian/`-style dotfolder that travels with a vault, and THE one definition of its name
 * (YAZ-861 — main's `vaultConfig.ts` and the client's `ensureHome.ts` each used to declare their
 * own copy of the literal). Both sides read it from here: main joins paths under it, and the
 * client probes it because its existence IS adoption (6C-, YAZ-849).
 */
export const VAULT_CONFIG_DIR = '.yaseendraw'

/**
 * Pushed to every window after a config file under `<root>/.yaseendraw/` changes — an own
 * `vaultConfig.write` or an external edit (sync tools). Renderers filter by their own root,
 * the same posture as `state:changed`, and re-read the named file.
 */
export interface VaultConfigChange {
  root: string
  /** Config file name inside `.yaseendraw/`, e.g. `github.json`. */
  name: string
}

/**
 * Per-vault config in `<root>/.yaseendraw/` — the Obsidian-`.obsidian/` analogue: travels with
 * the folder. Created lazily on first write; reading never creates it. The folder is invisible
 * everywhere (tree/sidebar, vault index, shared watcher).
 */
export interface VaultConfigApi {
  /** Parsed `<root>/.yaseendraw/<name>`, or null when the folder/file is missing or the JSON is malformed. */
  read(root: string, name: string): Promise<unknown>
  /** Creates `.yaseendraw/` on first write; atomic tmp+rename; pretty-printed JSON. `name` must be a plain `<stem>.json`. */
  write(root: string, name: string, value: unknown): Promise<void>
  /** Fired in every window after any vault's config change; returns an unsubscribe. */
  onChange(listener: (change: VaultConfigChange) => void): () => void
}

// ---------- GitHub sync (`<root>/.yaseendraw/github.json` — YAZ-1081) ----------

/**
 * The per-vault sync switch (YAZ-1081 D4), stored as `<root>/.yaseendraw/github.json` so it
 * travels with the folder like every other vault-local setting. OFF by default and off for any
 * shape that isn't exactly `{ enabled: true }` — a vault someone copies onto a second machine
 * therefore syncs there too, and a corrupt or hand-edited file fails closed rather than starting
 * background git work nobody asked for.
 */
export interface GithubSyncConfig {
  enabled: boolean
}

/**
 * Why a root is stuck, when it is. Each value is a DIFFERENT thing to say to the user, which is
 * the whole reason the set is closed: `no-git` wants "install git" (the Command Line Tools on a Mac, Git for Windows on a PC),
 * `no-identity` wants "set a name and email", `auth` wants "sign in again", `conflict` wants
 * "two machines edited the same lines" (the lossless rule: the working tree was put back exactly
 * as it was — see `git/sync.ts`), and `error` is the honest catch-all that carries a message.
 */
export type GithubSyncAttention = 'no-git' | 'no-identity' | 'auth' | 'conflict' | 'error'

/**
 * What a vault's sync is doing right now — one object per root, pushed on every transition.
 *
 * `off` is not a failure: it is a vault with sync disabled, or one that is not a repo, or a repo
 * with no `origin`. `pending` means "there is work to do and it will happen" — edits waiting out
 * the quiet period (D2 cadence) or a pass that found the network down and armed a retry — so it
 * is the one non-terminal state the UI should show as calm rather than alarming.
 */
export interface GithubSyncStatus {
  root: string
  state: 'off' | 'synced' | 'pending' | 'syncing' | 'attention'
  attention?: GithubSyncAttention
  message?: string
  /** Read-only repo facts for the settings panel; absent when they could not be read at all. */
  repo?: { remoteUrl: string | null; branch: string | null }
  /**
   * Whether the per-vault SWITCH is on — i.e. the manager is running this root. Distinct from
   * `state: 'off'`, which also covers not-a-repo and no-remote: a vault the user just enabled
   * that has no remote yet is `enabled: true` + `state: 'off'`, and the settings switch reads
   * THIS field so it never contradicts the click that set it. Stamped by the manager; absent
   * on statuses that never passed through it (a bare `syncPass` call in tests).
   */
  enabled?: boolean
}

/**
 * Per-vault GitHub sync as the renderer sees it (YAZ-1081, 2C). Four methods, because there are
 * only four things a UI ever needs: what is this vault doing, do it now, turn it on or off, and
 * tell me when it changes.
 *
 * Every call answers with the SAME `GithubSyncStatus` the push carries, so a caller never has to
 * follow a mutation with a read. `status` is the cheap one — it answers from the manager's last
 * broadcast without touching git, and for a root whose sync is OFF it falls back to a read-only
 * inspection (remote + branch) so a settings panel can show the repo it would sync to.
 */
export interface GithubApi {
  /** This root's current status; `off` for a vault with sync disabled, never a failure. */
  status(root: string): Promise<GithubSyncStatus>
  /** Run a pass NOW (the manual "sync" button). A pass already running is joined, never raced; `off` roots answer `off`. */
  syncNow(root: string): Promise<GithubSyncStatus>
  /**
   * The per-vault switch (D4), written to `<root>/.yaseendraw/github.json`. Turning it ON waits
   * for the first pass and answers with its real outcome — "synced", or what needs fixing —
   * rather than an optimistic `syncing`; turning it OFF is immediate and total (no watcher, no
   * timers, no passes).
   */
  setEnabled(root: string, enabled: boolean): Promise<GithubSyncStatus>
  /** Fired in every window on every transition of any vault; filter by `status.root`. Returns an unsubscribe. */
  onStatus(listener: (status: GithubSyncStatus) => void): () => void
}


// ---------- Favorites (`<root>/.yaseendraw/favorites.json` — YAZ-1766 6A, D11) ----------

/** The file on disk: VAULT-RELATIVE POSIX paths in the user's order (`MAX_FAVORITES` at most). */
export interface FavoritesConfig {
  version: 1
  favorites: string[]
}

/**
 * The Favorites tab's list as `window.yaseenDraw.favorites` (YAZ-1766 6A): ABSOLUTE paths over
 * `.yaseendraw/favorites.json`, so the list travels with the vault (D11). A malformed file reads
 * as `[]` and rejects every `set` with `INVALID_CONFIG`, never overwritten (D12); `set` drops
 * entries whose path is gone from disk (D14); in-app rename/delete repair the file in main (D13).
 */
export interface FavoritesApi {
  /** Absolute paths in stored order; `[]` when the file is absent or malformed. Never creates anything. */
  get(root: string): Promise<string[]>
  /** Replace the list; every path must be inside `root` (→ `BAD_REQUEST`). Creates the dotfolder and file on first write. */
  set(root: string, paths: readonly string[]): Promise<void>
  /** Fired in every window after any change to a vault's favorites.json, own or external; filter by `root`. Returns an unsubscribe. */
  onChanged(listener: (change: { root: string }) => void): () => void
}

// ---------- Media library (`<library>/media.json` — 🔒 D4 / D5, YAZ-1817) ----------

/**
 * Where the media a board can reach comes from (the web app's `ImageStudioProvider`, ported
 * verbatim): Pixabay photos and illustrations, Iconify icons and logos, and the app's own shapes.
 * `shape` needs no network and no key at all.
 */
export type MediaProvider = 'pixabay' | 'iconify' | 'shape'
export const MEDIA_PROVIDERS: readonly MediaProvider[] = ['pixabay', 'iconify', 'shape']
export const isMediaProvider = (v: unknown): v is MediaProvider => MEDIA_PROVIDERS.includes(v as MediaProvider)

/** What the item IS, independent of who served it (the web app's `ImageStudioItemKind`). */
export type MediaItemKind = 'photo' | 'illustration' | 'icon' | 'logo' | 'shape'
export const MEDIA_ITEM_KINDS: readonly MediaItemKind[] = ['photo', 'illustration', 'icon', 'logo', 'shape']
export const isMediaItemKind = (v: unknown): v is MediaItemKind => MEDIA_ITEM_KINDS.includes(v as MediaItemKind)

/**
 * A POINTER to something a provider can serve — never the bytes. Field for field the web app's
 * `mediaItemValidator` (`convex/mediaTypes.ts`) so a library written by either app reads in the
 * other: `itemKey` is the identity (de-dupe and removal both key on it), the rest is attribution
 * and layout metadata the studio shows.
 *
 * `previewUrl` is stored but NEVER TRUSTED: a provider's CDN URL expires, and a stale one in a
 * file that syncs between machines would render a broken tile. 3B re-derives every preview it
 * shows from `provider` + `providerId` and treats this field as a hint at best.
 */
export interface MediaItem {
  itemKey: string
  provider: MediaProvider
  providerId: string
  kind: MediaItemKind
  title: string
  previewUrl?: string
  creator?: string
  creatorUrl?: string
  collectionName?: string
  sourceUrl?: string
  licenseName?: string
  licenseUrl?: string
  attribution?: string
  width?: number
  height?: number
  trademarkNotice?: boolean
}

/**
 * A `MediaItem` as the library FILE holds it — the web app's `storedItemValidator`: the pointer
 * plus the moment it was last favorited or used. `updatedAt` is stamped by the main process on
 * every write and is what both lists are ordered by (newest first); a renderer never supplies it.
 */
export type StoredMediaItem = MediaItem & { updatedAt: number }

/**
 * `<library>/media.json` (🔒 D5): the cross-vault media library, ONE file for the whole account.
 * Both lists are newest-first and de-duplicated by `itemKey`; `favorites` is the user's pinned
 * set, `recent` is an MRU of what they actually placed on a board.
 */
export interface MediaLibraryFile {
  version: 1
  favorites: StoredMediaItem[]
  recent: StoredMediaItem[]
}

/** The library file's name inside the library folder. */
export const MEDIA_LIBRARY_FILE = 'media.json'
/**
 * `<library>/components/` (🔒 D5): where 3C writes a saved component's `.excalidraw` + `.png`.
 * Named here so nothing else claims it; 3A creates NOTHING — the folder appears on 3C's first write.
 */
export const LIBRARY_COMPONENTS_DIR = 'components'
/** The components index beside that folder: `<library>/components.json` (🔒 D5, YAZ-1819). */
export const COMPONENTS_INDEX_FILE = 'components.json'
/** Favorites are capped at the web app's `listFavorites` ceiling; the oldest fall off the end. */
export const MAX_MEDIA_FAVORITES = 500
/** The MRU's length, the web app's `RECENT_LIMIT` exactly. */
export const RECENT_LIMIT = 60

/** `media:favorites` — one channel, three verbs; every verb answers the resulting list. */
export type MediaFavoritesRequest = { op: 'list' } | { op: 'add'; item: MediaItem } | { op: 'remove'; itemKey: string }
/** `media:recent` — the same shape: read the MRU, or push an item to its head. */
export type MediaRecentRequest = { op: 'list' } | { op: 'record'; item: MediaItem }

/**
 * The media library as `window.yaseenDraw.media` (🔒 D4 / D5, YAZ-1817). Pointers only: the
 * BYTES never travel through here (3B's `media:import` writes them into the vault's `assets/`).
 * Every mutation answers the list it produced, so a caller that just wrote does not have to read
 * back — and `onChanged` still fires in every window, so the OTHER vaults' windows follow too.
 */
export interface MediaApi {
  /** List / add / remove favorites; `add` on an itemKey already there changes nothing. */
  favorites(req: MediaFavoritesRequest): Promise<StoredMediaItem[]>
  /** List the MRU, or record a use — which moves the item to the head and stamps it. */
  recent(req: MediaRecentRequest): Promise<StoredMediaItem[]>
  /** Fired in EVERY window whenever `media.json` changes, this app's write or an external one. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
  /** Federated provider search (🔒 D4, YAZ-1818) — main fetches, curates and caches; the renderer never reaches a provider. */
  search(req: MediaSearchRequest): Promise<MediaSearchResponse>
  /** One tile's picture as a dataURL, disk-cached 24 h. The ONLY way a preview reaches the renderer. */
  preview(req: MediaPreviewRequest): Promise<MediaPreviewResponse>
  /** The full-size bytes, NEVER cached: they are about to become an `assets/` file (🔒 D3). */
  import(req: MediaImportRequest): Promise<MediaImportResponse>
}

// ---------- Image Studio: the provider doors (🔒 D4, YAZ-1818) ----------

/**
 * Which providers a search asks. The web app's `ImageStudioSearchSource` exactly: `all` is the
 * federated mix (Iconify 14 + Pixabay 4 of `SEARCH_LIMIT` 18), the other two are one provider each.
 */
export type MediaSearchSource = 'all' | 'iconify' | 'pixabay'
export const MEDIA_SEARCH_SOURCES: readonly MediaSearchSource[] = ['all', 'iconify', 'pixabay']
export const isMediaSearchSource = (v: unknown): v is MediaSearchSource => MEDIA_SEARCH_SOURCES.includes(v as MediaSearchSource)

/**
 * A search RESULT — the same pointer `media.json` stores, so favoriting one is a copy rather than
 * a conversion. It carries NO `previewUrl`: in the web app that field held the Worker route that
 * would serve the picture, and this app has no routes — a preview is asked for by `provider` +
 * `providerId` over `media:preview`, which is also why a stored `previewUrl` is never trusted.
 */
export type StudioItem = MediaItem

/** The two providers that serve BYTES; `shape` is drawn by the renderer and never fetched. */
export type MediaBytesProvider = 'pixabay' | 'iconify'
export const MEDIA_BYTES_PROVIDERS: readonly MediaBytesProvider[] = ['pixabay', 'iconify']
export const isMediaBytesProvider = (v: unknown): v is MediaBytesProvider => MEDIA_BYTES_PROVIDERS.includes(v as MediaBytesProvider)

/** `media:search` — the query, the providers, and the opaque cursor of the page before this one. */
export interface MediaSearchRequest {
  q: string
  source: MediaSearchSource
  /** The `nextCursor` of the previous page; absent or null starts over. Opaque: main minted it, main reads it. */
  cursor?: string | null
}

/**
 * `media:search`'s answer. `nextCursor` is null when the providers are exhausted — that is what
 * stops the infinite scroll. `pixabayAvailable` is the ONE thing the renderer learns about the
 * key (🔒 D4: never the value): false hides the Pixabay section instead of showing an error.
 */
export interface MediaSearchResponse {
  items: StudioItem[]
  nextCursor: string | null
  pixabayAvailable: boolean
  /** A provider that was reached and failed while ANOTHER answered — the web app's warning banner. */
  warnings: string[]
}

/** `media:preview` / `media:import` — a provider and its own id for the item. */
export interface MediaBytesRequest {
  provider: MediaBytesProvider
  id: string
}
export type MediaPreviewRequest = MediaBytesRequest
export type MediaImportRequest = MediaBytesRequest

/** The tile picture. A dataURL because the renderer is sandboxed and there is no custom protocol. */
export interface MediaPreviewResponse {
  mimeType: string
  dataURL: string
}

/**
 * The full-size bytes, plus the item as the PROVIDER describes it now — which is how a Recent row
 * gets a fresh size and attribution even when the caller's copy came out of an old `media.json`.
 * Only the fields main can actually know are set; the caller's own item supplies the rest.
 */
export interface MediaImportResponse extends MediaPreviewResponse {
  item: StudioItem
}


// ---------- Saved components (`<library>/components/` — 🔒 D5, YAZ-1819) ----------

/**
 * ONE saved component as the index names it (🔒 D5). The SLUG is the identity: it is the file's
 * own basename (`<library>/components/<slug>.excalidraw` + `<slug>.png`), so the folder can be
 * read back into an index with nothing else on hand. The NAME is only the label, which is why a
 * rename never moves a file — a component inserted into a board is not addressed by either.
 */
export interface ComponentItem {
  slug: string
  name: string
  elementCount: number
  createdAt: number
  updatedAt: number
}

/** `<library>/components.json`: the index, rebuilt from the folder whenever it is missing or unreadable. */
export interface ComponentsIndexFile {
  version: 1
  items: ComponentItem[]
}

/**
 * `components:save` — the fragment and its picture, both already made by the renderer (only it has
 * an engine). `fragmentJson` is a whole `.excalidraw` document with the component's image bytes
 * EMBEDDED (🔒 D5: a component is small and self-contained, so it inserts into any vault);
 * `previewPng` is a `data:image/png;base64,…` dataURL, which is the only way bytes cross the bridge.
 */
export interface ComponentSaveRequest {
  name: string
  fragmentJson: string
  previewPng: string
}

/** `components:read` / `components:delete` / `components:preview` — a component by its slug. */
export interface ComponentSlugRequest {
  slug: string
}

/** `components:rename` — the label only; the slug, and therefore both files, stay put. */
export interface ComponentRenameRequest {
  slug: string
  name: string
}

/** `components:read`'s answer: the fragment's bytes, exactly as they are on disk. */
export interface ComponentReadResponse {
  fragmentJson: string
}

/** The longest name a component may carry — the web app's `MAX_SAVED_COMPONENT_NAME_LENGTH`. */
export const MAX_COMPONENT_NAME_LENGTH = 120

/**
 * The saved-component library as `window.yaseenDraw.components` (🔒 D5, YAZ-1819). The same shape
 * as `media`: every mutation answers what it produced, and ONE payload-free push tells every
 * window in every vault to re-list, because the library is one folder for all of them.
 */
export interface ComponentsApi {
  /** The index, newest-updated first; a missing or corrupt index is rebuilt from the folder. */
  list(): Promise<ComponentItem[]>
  /** Write `<slug>.excalidraw` + `<slug>.png` and index them; the slug is derived from the name and uniqued. */
  save(req: ComponentSaveRequest): Promise<ComponentItem>
  /** The fragment's bytes, for an insert. */
  read(req: ComponentSlugRequest): Promise<ComponentReadResponse>
  /** Change the label; both files keep their names. */
  rename(req: ComponentRenameRequest): Promise<ComponentItem>
  /** Both files to the OS trash (`shell.trashItem`, never `fs.rm`), and the row out of the index. */
  delete(req: ComponentSlugRequest): Promise<void>
  /** The stored `<slug>.png` as a dataURL — the grid's tile picture. */
  preview(req: ComponentSlugRequest): Promise<string>
  /** Fired in EVERY window whenever the components library changes. Returns an unsubscribe. */
  onChanged(listener: () => void): () => void
}

// ---------- Secrets (`userData/secrets.json` — 🔒 D4) ----------

/** `secrets:set` — a value to store, or null to clear the name entirely. */
export interface SecretSetRequest {
  name: string
  value: string | null
}

/** `secrets:has` — the ONLY question a renderer may ask about a secret. */
export interface SecretHasRequest {
  name: string
}

/** The name the Pixabay API key is stored under (🔒 D4); 3B reads it in main, never here. */
export const PIXABAY_SECRET = 'pixabayApiKey'

/**
 * The secrets door (🔒 D4). THE RULE, and it has no exceptions: **the renderer never receives a
 * value.** It may write one and it may ask whether one is there; reading is main's alone
 * (`readSecret` in `desktop/src/main/secrets.ts`), so a key cannot leak through `state:get`, a
 * devtools console or a crash dump of the renderer.
 */
export interface SecretsApi {
  /** Store `value` encrypted, or clear the name with null. Rejects `ENCRYPTION_UNAVAILABLE` when the OS keychain is not there. */
  set(req: SecretSetRequest): Promise<void>
  /** Whether a value is stored AND still decryptable on this machine. False whenever encryption is unavailable. */
  has(req: SecretHasRequest): Promise<boolean>
}

// ---------- Bridge: `window.yaseenDraw` (locked in GRO-2153, Desktop A1) ----------

/**
 * Every bridge promise rejects with a plain object satisfying `BridgeError` (the preload
 * unwraps the IPC envelope; `client/src/api.ts` wraps it in `BridgeRequestError`).
 * `CONFLICT` carries the current on-disk `mtime`.
 */
export interface BridgeError {
  code: BridgeErrorCode | 'CONFLICT'
  message: string
  path?: string
  mtime?: number
}

/** Reveal in Finder (GRO-2274): the absolute path to show in the OS file manager. */
export interface RevealRequest {
  path: string
}

/** Reveal in Finder (GRO-2274): echoes the revealed path. */
export interface RevealResponse {
  path: string
}

/** An external-link intent from the canvas; main validates and resolves it before any OS side effect. */
export interface OpenLinkRequest {
  href: string
  /** Absolute current-note path, required only when `href` is relative. */
  sourcePath?: string
}

/** In-app delete (GRO-2272): the absolute path of the entry to move to the system Trash. */
export interface DeleteRequest {
  path: string
}

/** In-app delete (GRO-2272): what moved to the system Trash. */
export interface DeleteResponse {
  path: string
  kind: 'file' | 'dir'
}

/** `file:deleted` — pushed to EVERY window after a successful delete (GRO-2272). */
export interface FileDeletedEvent {
  path: string
  kind: 'file' | 'dir'
}

export interface WindowIdentity {
  id: string
  root: string | null
  file: string | null
  /** Open tabs left→right (GRO-2232); `file` is the active one (same invariants as `WindowEntry.tabs`). */
  tabs: string[]
  /** Whether this window's sidebar is hidden (YAZ-1280). */
  sidebarCollapsed: boolean
  /** Which sidebar lens this window shows (YAZ-847, per window since YAZ-1628). */
  sidebarLens: SidebarLens
  /** Focus Mode's lists (YAZ-1605, per window since YAZ-1628; Favorites' own since YAZ-1766): the same three as `WindowEntry`'s. */
  focusDirs: string[]
  focusFavorites: string[]
}

export interface OpenWindowOptions {
  root: string | null
  file: string | null
}

/** Targeted mutators (not a generic patch) so several windows never lose each other's writes. */
export interface StateApi {
  get(): Promise<AppState>
  setSettings(settings: SettingsState): Promise<void>
  /** Clamped to [SIDEBAR_MIN_W, SIDEBAR_MAX_W] by the main process. */
  setSidebarWidth(width: number): Promise<void>
  /** Prepend to recents (de-duplicated, capped). */
  pushRecent(path: string): Promise<void>
  /** Drop a folder from recents (its directory vanished on disk, C2 — GRO-2164); unknown path is a no-op. */
  removeRecent(path: string): Promise<void>
  /** Merge into `folders[root]`; missing root entries are created with defaults. */
  setFolder(root: string, patch: Partial<Pick<FolderState, 'expanded' | 'lastFile'>>): Promise<void>
  /** Fired in every window after any change; returns an unsubscribe. */
  onChange(listener: (state: AppState) => void): () => void
}

export interface WindowApi {
  /** Who am I: main answers from `AppState.windows` by the `?win=<id>` in the window's URL. */
  identity(): Promise<WindowIdentity>
  /**
   * Record this window's current folder/file/tabs (the window manager persists it). Main
   * re-enforces the tabs invariant against the entry as written (GRO-2232): a non-null `file`
   * missing from `tabs` is prepended; `file: null` clears `tabs`.
   */
  setIdentity(patch: Partial<Pick<WindowIdentity, 'root' | 'file' | 'tabs' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusFavorites'>>): Promise<void>
  open(opts: OpenWindowOptions): Promise<void>
  /** `⌘⇧N`: same folder, same file, new window (GRO-2167). */
  duplicate(): Promise<void>
  /**
   * The vault switcher's one door (YAZ-1767 🔒 D1): bring a recent vault to the front and bump it
   * to the top of the MRU. Already open in some window(s) → those are RAISED, most recently
   * focused on top, and nothing new opens (🔒 D9); not open → a NEW window on that vault's
   * `folders[root].lastFile` (D2). A folder that no longer exists on disk is pruned from the MRU
   * instead and NOTHING opens — the result is `false`, so the row can say "Folder not found" the
   * way Welcome does. The menu's ⌥-click on Open Recent goes through the same door in main.
   */
  openRecent(path: string): Promise<boolean>
  /**
   * Close THIS window through the REAL close path — main calls the managed window's `close()`,
   * so the close/flush handshake runs; never a bare destroy (GRO-2232, e.g. closing the last tab).
   */
  closeSelf(): Promise<void>
  /** App-wide zoom for THIS window (YAZ-1710): what the stock `zoomIn` / `zoomOut` / `resetZoom` roles did — level ± 0.5, or back to 0. */
  zoom(step: ZoomStep): Promise<void>
  /**
   * The close/quit flush handshake (GRO-2160): main is about to close this window and holds it
   * until every registered listener settled (hard 5s cap in main). Returns an unsubscribe.
   */
  onFlush(listener: () => Promise<void> | void): () => void
}


/**
 * Menu gestures from the main process (B3, GRO-2161): the renderer owns root switching at
 * runtime, so File › Open Folder… / Open Recent land on the focused window's renderer.
 */
/** One ⌘+ / ⌘− / ⌘0 press: up, down, or back to the default (YAZ-1710). */
export type ZoomStep = -1 | 0 | 1

export interface MenuApi {
  /** File › Open Folder… (⌘⇧O) targeted this window: run the pick-folder flow. Returns an unsubscribe. */
  onOpenFolder(listener: () => void): () => void
  /** File › Open Recent chose `path` for this window: switch the root in place. Returns an unsubscribe. */
  onOpenRoot(listener: (path: string) => void): () => void
  /** File › Search Vault (⌘K) targeted this window: focus the sidebar search bar (YAZ-804). Returns an unsubscribe. */
  onSearch(listener: () => void): () => void
  /** File › Switch Vault… (⌘O) targeted this window: open the sidebar header's vault switcher, un-collapsing the sidebar first (YAZ-1767 D8). Returns an unsubscribe. */
  onSwitchVault(listener: () => void): () => void
  /** Yaseen Draw › Settings… (⌘,) targeted this window: open the settings dialog (YAZ-1679). Returns an unsubscribe. */
  onSettings(listener: () => void): () => void
  /** View › Toggle Sidebar targeted this window (YAZ-1280). Returns an unsubscribe. */
  onToggleSidebar(listener: () => void): () => void
  /** File › Close Tab (⌘W) targeted this window: close the active tab (GRO-2232). Returns an unsubscribe. */
  onCloseTab(listener: () => void): () => void
  /** Window › Next Tab (⌃Tab / ⌘⇧]) targeted this window: activate the tab to the right (GRO-2232). Returns an unsubscribe. */
  onNextTab(listener: () => void): () => void
  /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[) targeted this window: activate the tab to the left (GRO-2232). Returns an unsubscribe. */
  onPrevTab(listener: () => void): () => void
  /**
   * File › Export Image… (⌘⇧E, 🔒 D10) targeted this window: the VISIBLE drawing opens the
   * engine's own image-export dialog. There is no canvas main menu to reach it from any more, so
   * it is the application menu's; main enables the item only while the focused window's active
   * tab is a drawing. Returns an unsubscribe.
   */
  onExportImage(listener: () => void): () => void
  /**
   * View › Canvas Background › a pick (🔒 D10) targeted this window: the VISIBLE drawing takes
   * `color` as its `viewBackgroundColor`, which the engine then writes into the file — the one
   * canvas value that IS per board. Same enablement rule as Export Image…. Returns an unsubscribe.
   */
  onCanvasBackground(listener: (color: string) => void): () => void
}

/**
 * File lifecycle beyond create/write (Links E1, GRO-2194): in-app rename with automatic
 * link updates. `rename` is the invoke; `onRenamed` is the push every window receives after
 * ANY successful rename (its own included), used to remap open tabs to the new path.
 */
export interface FileApi {
  /** Same-directory FILE rename, extension kind unchanged; never overwrites (`ALREADY_EXISTS`). */
  rename(req: RenameFileRequest): Promise<RenameFileResponse>
  /** Fired in every window after a successful rename; returns an unsubscribe. */
  onRenamed(listener: (ev: FileRenamedEvent) => void): () => void
  /**
   * In-app delete (GRO-2272): move a file or folder to the SYSTEM TRASH and repair the app
   * state. `shell.trashItem` only — never `fs.rm`, and no permanent-delete fallback: a trash
   * failure rejects `IO_ERROR` and the entry stays on disk, because a filesystem with no
   * Trash is exactly where destroying the file would be worst.
   *
   * Refuses (`BAD_REQUEST`) dot-entries — invisible infrastructure the UI never showed — and
   * the CALLING window's own vault root (root identity is a recents/vault question, same
   * split as `rename`); another window rooted inside a deleted folder is allowed and falls
   * through to that window's existing `onRootMissing` repair. Missing path → `NOT_FOUND`.
   * There is no extension gate: the tree shows every folder, so every folder is deletable.
   *
   * On success the same handler drops every stored reference (`store.removePath`: window
   * `file` — promoted to an heir tab rather than nulled when other tabs survive — plus tabs,
   * recents and folder state) and pushes `file:deleted` to EVERY
   * window. The vault index needs no push: the watcher's `unlink` / `unlinkDir` echo heals it
   * (trashItem is a MOVE at the fs layer). Notes linking to a deleted page are left
   * BYTE-IDENTICAL — their `[[links]]` simply go unresolved (LOCKED decision C).
   */
  delete(req: DeleteRequest): Promise<DeleteResponse>
  /** Fired in every window after a successful delete; returns an unsubscribe. */
  onDeleted(listener: (ev: FileDeletedEvent) => void): () => void
  /**
   * Cut / Copy (YAZ-1674, D1): replaces the ONE app-wide clipboard in main with the ordered
   * selection and the verb. Nothing touches the disk here — a stale entry is reported per
   * entry at paste time. Every window then receives `clip:changed`. Rejects `BAD_REQUEST`
   * (bad `op`, empty `paths`) or `NOT_ABSOLUTE` (a relative entry) and leaves the clipboard as it was.
   */
  clip(req: FileClipRequest): Promise<void>
  /**
   * Paste (YAZ-1674, D2–D4) INTO `targetDir`, which must exist (`NOT_FOUND` / `NOT_A_DIRECTORY`,
   * never created); an empty clipboard rejects `BAD_REQUEST`. Per entry, in clipboard order:
   * a COPY is `fs.cp` under a free name (folders whole, hidden dirs inside included, timestamps
   * kept) with no store repair and no push — nothing moved, the watcher's add echo fills the
   * tree; a CUT is the EXISTING rename pipeline (store repair + `file:renamed` to every window
   * per entry), so tabs follow. A cut clears the clipboard once at least one entry landed; a
   * copy keeps it. One bad entry never stops the rest — read `failed` for the notices.
   */
  paste(req: PasteRequest): Promise<PasteResponse>
  /**
   * The CURRENT app-wide clipboard (YAZ-1674): for a window that mounts AFTER a clip — it
   * missed the push, so it reads once on mount; `onClipChanged` carries every later change.
   * Same shape as the push: `{ count, op }`, or null when empty. Never fails.
   */
  clipState(): Promise<FileClipState>
  /** Fired in every window after every clipboard change (its own included); null = empty. Returns an unsubscribe. */
  onClipChanged(listener: (state: FileClipState) => void): () => void
}

/**
 * OS-level actions (GRO-2274). Its own namespace rather than a member of `FileApi`: revealing
 * is not a file operation, and whatever OS action comes next (open-in-terminal, open-with)
 * belongs beside it rather than scattered across the file API.
 */
export interface ShellApi {
  /**
   * Show `path` in the OS file manager, selected IN ITS PARENT (`shell.showItemInFolder`) —
   * files, folders and the vault root alike. Not `openPath`: the verb is "Reveal", and VS Code
   * and Obsidian both behave this way. A path that no longer exists rejects `NOT_FOUND` rather
   * than silently doing nothing, so a stale row can surface a passive notice. Read-only, so
   * unlike `delete`/`rename` there is no dot-entry or extension guard.
   */
  reveal(req: RevealRequest): Promise<RevealResponse>
  /**
   * Open `path` in VS Code through the OS deep link (`vscode://file/<path>`, every segment
   * percent-encoded) — LOCKED: `shell.openExternal`, never a spawned process, so the app
   * couples to the scheme rather than to an install location or a `code` on PATH, and the OS
   * picks which VS Code answers. Files, folders and the vault root alike; what opening a folder
   * means is VS Code's decision. Same request/response shape and the same read-only posture as
   * `reveal`, stat included: a path that no longer exists rejects `NOT_FOUND`.
   */
  openVsCode(req: RevealRequest): Promise<RevealResponse>
  /**
   * Hand `path` to the OS default application (YAZ-1577) — how a tree row with no in-app viewer
   * (`kind: null`) opens. Files, folders and the vault root alike. Same request/response shape and
   * read-only posture as `reveal`, stat included: a path that no longer exists rejects `NOT_FOUND`;
   * an OS refusal (`shell.openPath`'s returned message) rejects `IO_ERROR` carrying that message.
   */
  openDefault(req: RevealRequest): Promise<RevealResponse>
  /** Open a validated link target through the OS; never creates an Electron window. */
  openLink(req: OpenLinkRequest): Promise<void>
}

/**
 * Deep links (E1, GRO-2171): main parses a `yaseendraw://` URL (`shared/links.ts`) and routes
 * it to the best window; these are the pushes the routed-to renderer receives.
 */
export interface LinkApi {
  /** A link resolved to this window: open `path` (guaranteed inside this window's root). Returns an unsubscribe. */
  onOpenFile(listener: (path: string) => void): () => void
  /** A link could not be opened (bad URL, unsupported, missing or non-regular file): show `message` unobtrusively. Returns an unsubscribe. */
  onNotice(listener: (message: string) => void): () => void
}

/**
 * The single typed surface the renderer uses for everything outside the DOM, installed by
 * the preload as `window.yaseenDraw` (`contextBridge`, `ipcMain.handle` on the main side).
 * Request/response shapes are the ones above; new methods are additive only.
 */
export interface YaseenDrawApi {
  tree(root: string): Promise<TreeResponse>
  readFile(path: string): Promise<FileResponse>
  writeFile(req: FileWriteRequest): Promise<FileWriteResponse>
  createDir(path: string): Promise<CreateDirResponse>
  createFile(req: string | CreateFileRequest): Promise<CreateFileResponse>
  /** The drawing DOCUMENT's two doors (🔒 YAZ-1810): the only way a `.excalidraw` tab reads and writes. */
  drawing: DrawingApi
  /** Native open-directory dialog parented to the calling window (GRO-2163). */
  pickFolder(): Promise<PickFolderResponse>
  /** One chokidar watcher per root in main, shared by every window; late joiners get `ready` at once. */
  watch(root: string, listener: (ev: WatchEvent) => void): () => void
  state: StateApi
  window: WindowApi
  menu: MenuApi
  link: LinkApi
  /** In-app file rename + the renamed push (Links E1, GRO-2194). */
  file: FileApi
  /** OS-level actions: Reveal in Finder (GRO-2274) and Open in VS Code (YAZ-963). */
  shell: ShellApi
  /** Vault-local config in `<root>/.yaseendraw/` (Desktop J, GRO-2188). */
  vaultConfig: VaultConfigApi
  /** The Favorites list over `.yaseendraw/favorites.json` (YAZ-1766 6A) — absolute paths in, relative on disk. */
  favorites: FavoritesApi
  /** The cross-vault media library over `<library>/media.json` (🔒 D4 / D5, YAZ-1817). */
  media: MediaApi
  /** The cross-vault saved-component library over `<library>/components/` (🔒 D5, YAZ-1819). */
  components: ComponentsApi
  /** Encrypted secrets in `userData/secrets.json` (🔒 D4) — write and ask, never read. */
  secrets: SecretsApi
  /** Per-vault GitHub sync, off by default (YAZ-1081). */
  github: GithubApi
}
