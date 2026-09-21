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
  | 'TOO_LARGE' // file exceeds MAX_FILE_BYTES
  | 'IO_ERROR' // any other fs error
  | 'PICKER_FAILED' // native folder dialog could not be run
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendraw/github.json) is unusable; the mutation is refused, the file never touched

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

// ---------- readAsset(root, ref) / writeAsset(req) (Bases 4E, GRO-2139 — Desktop D10: bridge methods, never routes) ----------

/**
 * The image extensions the asset pipe serves (no dot), and the ONLY extensions it serves
 * (🔒 YAZ-1810): anything else rejects `UNSUPPORTED_EXTENSION`. A `.excalidraw` used to ride
 * this pipe too, when a drawing was a sidecar an embed pointed at; it is the DOCUMENT now, and
 * `drawing:load` / `drawing:save` are its one door per direction. Two doors to one file's bytes,
 * with different rules about its images, is the race that door exists to prevent.
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] as const

export interface AssetResponse {
  /** Absolute path the ref resolved to. */
  path: string
  /** Mime type derived from the extension. */
  mime: string
  /** The file's bytes, base64-encoded (the renderer builds a `data:` URL from them). */
  data: string
  /** Byte size; capped at MAX_FILE_BYTES (above → `TOO_LARGE`). */
  size: number
  /**
   * Disk mtime at the moment of the read — `writeAsset`'s `expectedMtime` guard, taken by the
   * door that read the bytes, since nowhere else can honestly say what version they are.
   */
  mtime: number
}

/**
 * `writeAsset` — the write half of the asset pipe (YAZ-876, narrowed to images by 🔒 YAZ-1810):
 * raw bytes onto an `IMAGE_EXTENSIONS` path, and nothing else. A text body used to mean scene
 * JSON; a drawing is written through `drawing:save` now, which is the only writer that also
 * knows what to do with the images the scene names.
 */
export interface AssetWriteRequest {
  /** Vault root; the resolved target must sit under it (else `BAD_REQUEST`). */
  root: string
  /** The asset's vault-relative path (absolute under `root` also accepted). Never a basename search — writes are never fuzzy. */
  path: string
  /** The raw bytes of an image (YAZ-1656); above MAX_FILE_BYTES → `TOO_LARGE`. */
  content: Uint8Array
  /** Optimistic-concurrency guard, `writeFile`'s exactly: a differing disk mtime rejects `CONFLICT` and nothing is written. */
  expectedMtime?: number
  /** Create mode (`createFile`'s `wx`): an existing target rejects `ALREADY_EXISTS` and is never overwritten. */
  create?: boolean
}

export interface AssetWriteResponse {
  path: string
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
   * Show the confirm sheet before deleting (GRO-2272 — VS Code's `explorer.confirmDelete`).
   * Defaults TRUE and should stay that way: the sheet is the ONLY guard on delete, because
   * `shell.trashItem` has no programmatic undo, so there is no in-app restore to fall back
   * on. Cleared from the sheet's own "Don't ask me again" and re-enabled from the settings
   * cog — a one-way switch would leave hand-editing `yaseendraw.json` as the only way back.
   */
  confirmDelete: boolean
}

/** Obsidian's Appearance vocabulary and order — also exactly Electron's `nativeTheme.themeSource`. */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

export const DEFAULT_SETTINGS: SettingsState = {
  theme: 'system',
  confirmDelete: true,
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
  /**
   * Local image under `root` (YAZ-876): `ref` is a path or bare name — tried root-relative,
   * then by basename (case-insensitive, first match in a deterministic walk).
   * `IMAGE_EXTENSIONS` only; a drawing opens through `drawing.load` (🔒 YAZ-1810).
   */
  readAsset(root: string, ref: string): Promise<AssetResponse>
  /** Writes an image under `root` (YAZ-1661): explicit path, atomic; see `AssetWriteRequest`. */
  writeAsset(req: AssetWriteRequest): Promise<AssetWriteResponse>
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
  /** Per-vault GitHub sync, off by default (YAZ-1081). */
  github: GithubApi
}
