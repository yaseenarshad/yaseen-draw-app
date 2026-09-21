/**
 * Shared renderer/main contracts for Yaseen Draw (locked in GRO-1961, bridge in GRO-2153) —
 * see docs/CONTRACTS.md for the prose version.
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
  | 'INVALID_CONFIG' // a vault config file (e.g. .yaseendraw/properties.json) is unusable; the mutation is refused, the file never touched

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown'] as const
export const TEXT_VIEW_EXTENSIONS = [
  '.txt',
  '.log',
  '.csv',
  '.tsv',
  '.json',
  '.jsonc',
  '.jsonl',
  '.ndjson',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.xml',
  '.env',
  '.properties',
  '.lock',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cc',
  '.cpp',
  '.hpp',
  '.cs',
  '.swift',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.fish',
  '.ps1',
  '.sql',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.vue',
  '.svelte',
  '.graphql',
  '.gql',
  '.mdx',
  '.rst',
  '.tex',
] as const
export const PDF_EXTENSIONS = ['.pdf'] as const
export const IMAGE_VIEW_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
} as const
export const IMAGE_VIEW_EXTENSIONS = Object.freeze(Object.keys(IMAGE_VIEW_MIME)) as readonly (keyof typeof IMAGE_VIEW_MIME)[]

/** The file kinds the app can open in-app; only `markdown` is writable and semantic. A file of no kind still lists (YAZ-1577). */
export type FileKind = 'markdown' | 'text' | 'pdf' | 'image'
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_PDF_BYTES = 50 * 1024 * 1024
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024

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
  /** Recursive tree of the root. Supported markdown/text/PDF/image files are included; every directory shows, supported files or not (GRO-2022). Hidden (dot) entries and `node_modules` skipped. */
  tree: TreeNode[]
  /** Main-process time (epoch ms) when the tree was computed. */
  generatedAt: number
}

// ---------- Bases property index (GRO-2127; bridge method index(root) — Desktop D10) ----------

/** One markdown note as the Bases query engine sees it. */
export interface IndexRecord {
  /** Absolute path. */
  path: string
  /** File name with extension. */
  name: string
  /** File name without extension. */
  basename: string
  /** Root-relative folder, '/' separators, '' at the root. */
  folder: string
  /** 'md' | 'markdown' (no dot). */
  ext: string
  size: number
  /** birthtime ms (ctime ms when the platform has no birthtime). */
  ctime: number
  mtime: number
  /** Parsed frontmatter; {} when absent or invalid (then `frontmatterError` is set). YAML core schema: dates stay strings. */
  properties: Record<string, unknown>
  frontmatterError?: string
  /**
   * Frontmatter `aliases`: extra NAMES this note answers to (Links E2, GRO-2214). List items, or
   * a scalar string as ONE alias (never comma-split, unlike `tags`); trimmed, empties and
   * non-strings dropped, de-duplicated. Resolved after path/root-relative/basename, so a real
   * name always wins. Alias values are never outgoing `links`.
   */
  aliases: string[]
  /** Frontmatter `tags`/`tag` + inline `#tags`; no leading '#'; nested 'a/b' kept; de-duplicated, order of first appearance. */
  tags: string[]
  /** `[[target]]` targets (`|alias` and `#heading` stripped) from body + frontmatter string values; embeds excluded. */
  links: string[]
  /** `![[target]]` targets. */
  embeds: string[]
}

export interface IndexResponse {
  root: string
  /** Every markdown note under `root` (dot-entries and `node_modules` skipped), sorted by path. */
  records: IndexRecord[]
  /** Main-process time (epoch ms) when this snapshot was taken. */
  generatedAt: number
}

// ---------- coldDiff(root) (Links E1c, GRO-2242) ----------

/** How the persistent index cache loaded at cold start (`desktop/src/main/vaultIndex/cache.ts`). */
export type IndexCacheStatus = 'hit' | 'miss' | 'corrupt' | 'version-mismatch'

/** One file's identity stats in a `ColdStartDiffResponse` — the (size, mtime) rename join key. */
export interface DiffFileStat {
  /** Absolute path. */
  path: string
  /** Byte size. */
  size: number
  /** mtime in epoch ms. */
  mtime: number
}

/**
 * What changed between the persistent index cache and the disk at cold start — the E1c
 * external-rename detection feed (GRO-2242). `removed` carries the CACHED stats and `added`
 * the ON-DISK ones, so an external rename/move (which preserves size + mtime) joins them 1:1.
 * Honest miss semantics: on any `cacheStatus` other than `'hit'` there was no before-snapshot,
 * so all three lists are EMPTY (never "everything added") and `cacheStatus` says why —
 * consumers MUST gate on `cacheStatus === 'hit'` before trusting them.
 */
export interface ColdStartDiffResponse {
  root: string
  /** Epoch ms when the reconcile ran. */
  scannedAt: number
  cacheStatus: IndexCacheStatus
  /** On disk but not in the cache; ON-DISK stats. Sorted by path. */
  added: DiffFileStat[]
  /** In the cache but no longer on disk; CACHED stats. Sorted by path. */
  removed: DiffFileStat[]
  /** Present in both but mtime or size moved (re-scanned). Sorted. */
  changed: string[]
}

// ---------- readFile(path) ----------

export interface FileResponse {
  path: string
  /** UTF-8 file contents; Markdown includes frontmatter and supported view-only text is strictly decoded. */
  content: string
  mtime: number
  size: number
}

/** Dedicated binary response for the native PDF viewer; never base64-encoded or sent through `readFile`. */
export interface PdfResponse {
  path: string
  data: Uint8Array
  mtime: number
  size: number
}

/** Dedicated exact-path binary response for the static raster-image viewer. */
export interface ImageResponse {
  path: string
  data: Uint8Array
  mime: (typeof IMAGE_VIEW_MIME)[keyof typeof IMAGE_VIEW_MIME]
  mtime: number
  size: number
}

// ---------- readAsset(root, ref) / writeAsset(req) (Bases 4E, GRO-2139 — Desktop D10: bridge methods, never routes) ----------

/**
 * The image extensions the asset pipe serves (no dot): `readAsset`, the `app://vault` image
 * protocol (YAZ-1658) and a byte `writeAsset` (YAZ-1661); anything else rejects
 * `UNSUPPORTED_EXTENSION` (or, over the protocol, 404s).
 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'] as const

/**
 * Drawing sidecars the asset pipe reads AND writes (Excalidraw embed, YAZ-852 / YAZ-876): scene
 * JSON standing on its own in the vault (`assets/drawings/` by default), a note holding only
 * `![[<name>.excalidraw]]`. Deliberately unsupported by the shared file classifier, so the
 * Files tree, supported-file watcher and Markdown index all omit it; it rides this pipe alone.
 */
export const DRAWING_EXTENSIONS = ['excalidraw'] as const

export interface AssetResponse {
  /** Absolute path the ref resolved to. */
  path: string
  /** Mime type derived from the extension (`application/json` for a drawing). */
  mime: string
  /** The file's bytes, base64-encoded (the renderer builds a `data:` URL, or decodes scene JSON). */
  data: string
  /** Byte size; capped at MAX_FILE_BYTES (above → `TOO_LARGE`). */
  size: number
  /**
   * Disk mtime at the moment of the read — `writeAsset`'s `expectedMtime` guard, from the door
   * that read the bytes (YAZ-879: the drawing modal loads here and saves back through that guard,
   * and a read with no mtime would have left the save with nothing honest to guard on).
   */
  mtime: number
}

/**
 * `writeAsset` — the write half of the asset pipe (YAZ-876). Drawings landed first and images
 * were deliberately NOT widened then; YAZ-1656 (images as first-class citizens, D5) reverses
 * that: THE BODY'S TYPE PICKS THE FILE KIND — bytes → an `IMAGE_EXTENSIONS` path, a string →
 * a `DRAWING_EXTENSIONS` path, any other pairing `UNSUPPORTED_EXTENSION`.
 */
export interface AssetWriteRequest {
  /** Vault root; the resolved target must sit under it (else `BAD_REQUEST`). */
  root: string
  /** The asset's vault-relative path (absolute under `root` also accepted). Never a basename search — writes are never fuzzy. */
  path: string
  /** Scene JSON as UTF-8 (a drawing), or the raw bytes of an image (YAZ-1656); above MAX_FILE_BYTES → `TOO_LARGE`. */
  content: string | Uint8Array
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

// ---------- writeFile(req) ----------

export interface FileWriteRequest {
  path: string
  /** Full file contents to write (frontmatter already re-prepended by client). Written atomically (tmp + rename). */
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
  /** The created file's byte length (0 for an empty markdown create). */
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

/** Collapsed outline fold keys per file (see client `outlineFoldKeys.ts`) are capped at this many. */
export const MAX_FOLD_KEYS_PER_FILE = 500

/** Collapsed group keys per base view (Bases 4C, GRO-2137) are capped at this many. */
export const MAX_COLLAPSED_GROUP_KEYS = 200

/** Expanded Topics-tree pages per vault (🔒 D4, YAZ-848) are capped at this many — `folds`' cap, for a bucket of the same kind: one entry per page the user opened. */
export const MAX_TOPICS_EXPANDED_PAGES = 500

/** Entries in a vault's `.yaseendraw/favorites.json` (YAZ-1766 D2, in the vault since 6A/D11) are capped at this many on read and write — `topicsExpanded`'s cap, for a list of the same kind. */
export const MAX_FAVORITES = 500

/**
 * `WindowEntry.sidebarLens` — which lens the sidebar's chrome-v2 ROW 1 tabs show (YAZ-847):
 * `topics` (the folder-page tree, an empty shell until YAZ-848), `files` (the file explorer) or
 * `favorites` (the pinned files and folders, YAZ-1766 D1 — a third tab right of Files).
 * Window identity like `sidebarCollapsed` since YAZ-1628 (global, like `sidebarWidth`, from
 * YAZ-847 until then): the tabs are not per-folder view state, so there is no per-root keying
 * and no `FolderState` entry. Default `topics` — a pre-847 state file simply gains it, and a
 * pre-1628 file's retired global value seeds every window that has none of its own.
 */
export type SidebarLens = 'topics' | 'files' | 'favorites'
/** The tabs' order, left→right: the default lens leads. */
export const SIDEBAR_LENSES: readonly SidebarLens[] = ['topics', 'files', 'favorites']
export const isSidebarLens = (v: unknown): v is SidebarLens => SIDEBAR_LENSES.includes(v as SidebarLens)

/** `AppState.sidebarWidth` — the drag-to-resize bounds (YAZ-738), clamped on every write and on load. */
export const SIDEBAR_MIN_W = 180
export const SIDEBAR_MAX_W = 520
export const SIDEBAR_DEFAULT_W = 260

/** Per-window right-panel geometry. Width persists even while the panel is hidden. */
export const RIGHT_PANEL_MIN_W = 320
export const RIGHT_PANEL_MAX_W = 720
export const RIGHT_PANEL_DEFAULT_W = 440
/** Main workspace width reserved before the right panel switches to temporary overlay mode. */
export const MAIN_WORKSPACE_MIN_W = 360

export interface RightPanelIdentity {
  open: boolean
  width: number
  /** Absolute page paths in visible header order; disjoint from the window's main `tabs`. */
  items: string[]
  /** The one expanded right item, or null when all headers are collapsed. */
  expanded: string | null
}

export function defaultRightPanelIdentity(): RightPanelIdentity {
  return { open: false, width: RIGHT_PANEL_DEFAULT_W, items: [], expanded: null }
}

/** Global content-width presets, ordered exactly as shown in Settings (YAZ-1176). */
export const CONTENT_WIDTHS = ['narrow', 'medium', 'full'] as const
export type ContentWidth = (typeof CONTENT_WIDTHS)[number]

/**
 * `AppState.settings` — app-global editor preferences (GRO-2024). Applied as CSS custom
 * properties on the app container; never written into the markdown on disk.
 */
export interface SettingsState {
  /** Line height within a block (Google-Docs-style presets). */
  lineSpacing: number
  /** Vertical padding above and below each block, px (spacing between blocks = 2×). */
  blockGap: number
  /** Accent the root → caret bullet path (GRO-2094). View-only; never written into the file. */
  bulletThreading: boolean
  /** Thread line width in px: 1 | 2 | 3, like logseq-bullet-threading (GRO-2109). */
  threadWidth: number
  /** Custom thread colour as `#rrggbb`, or null = the app accent (GRO-2109). */
  threadColor: string | null
  /** Appearance (Desktop K, GRO-2218): explicit values win; `system` tracks the OS live. */
  theme: Theme
  /** Global reading surface width (YAZ-1176): 1040px, 1440px, or fluid within the workspace. */
  contentWidth: ContentWidth
  /** Files & Links (Links C2-, GRO-2240): where a BARE unresolved `[[link]]` creates its page. */
  newNoteLocation: NewNoteLocation
  /** Root-relative folder for `newNoteLocation: 'folder'` ('' = the vault root); ignored otherwise. Interpreted per-vault against each window's root. */
  newNoteFolder: string
  /**
   * Show the confirm sheet before deleting (GRO-2272 — VS Code's `explorer.confirmDelete`).
   * Defaults TRUE and should stay that way: the sheet is the ONLY guard on delete, because
   * `shell.trashItem` has no programmatic undo, so there is no in-app restore to fall back
   * on. Cleared from the sheet's own "Don't ask me again" and re-enabled from the settings
   * cog — a one-way switch would leave hand-editing `yaseendraw.json` as the only way back.
   */
  confirmDelete: boolean
  /** Comment stream order (YAZ-1515): how you READ, global, never part of a note. */
  commentsOrder: CommentsOrder
}

export const THREAD_WIDTHS: readonly number[] = [1, 2, 3]

/** Obsidian's Appearance vocabulary and order — also exactly Electron's `nativeTheme.themeSource`. */
export type Theme = 'system' | 'light' | 'dark'
export const THEMES: readonly Theme[] = ['system', 'light', 'dark']

/**
 * Obsidian's "Default location for new notes" options and order (Links C2-, GRO-2240):
 * vault folder · same folder as current file · the folder named in `newNoteFolder`.
 */
export type NewNoteLocation = 'root' | 'current' | 'folder'
export const NEW_NOTE_LOCATIONS: readonly NewNoteLocation[] = ['root', 'current', 'folder']

/** Comment stream order (YAZ-1515): oldest-first (the model's order) or newest-first by the ROOT's `at`. */
export type CommentsOrder = 'oldest' | 'newest'
export const COMMENTS_ORDERS: readonly CommentsOrder[] = ['oldest', 'newest']

/**
 * Valid `newNoteFolder`: '' (the vault root) or root-relative — no leading/trailing `/`, no
 * empty segments, and no segment create-on-click would refuse: leading-`.` names (hidden —
 * subsumes `.` and `..`) and NUL. The segment rules mirror `validateEntryName` in
 * `client/src/sidebar/createEntry.ts`, which `createFromLink` runs over every segment at
 * click time; `shared/` cannot import from `client/`, so the rule is replicated — keep the
 * two in step (GRO-2197: `.archive` used to save cleanly here, then fail EVERY create).
 */
export function isValidNewNoteFolder(v: string): boolean {
  return v === '' || v.split('/').every((s) => s.trim() !== '' && !s.trim().startsWith('.') && !s.includes('\0'))
}

/** Matches the app's pre-settings look (Crepe: line-height 1.5, block padding 4px); threading on, 2px, accent; new notes beside the source page (YAZ-1643). */
export const DEFAULT_SETTINGS: SettingsState = {
  lineSpacing: 1.5,
  blockGap: 4,
  bulletThreading: true,
  threadWidth: 2,
  threadColor: null,
  theme: 'system',
  contentWidth: 'narrow',
  newNoteLocation: 'current',
  newNoteFolder: '',
  confirmDelete: true,
  commentsOrder: 'oldest',
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
  rightPanel: RightPanelIdentity
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
  /** Its Topics twin: the folder PAGES this window's Topics tree is narrowed to, or empty. */
  focusTopics: string[]
  /** Its Favorites twin (YAZ-1766 D5): the favorited DIRS this window's Favorites tab is narrowed to, or empty. */
  focusFavorites: string[]
  bounds: WindowBounds
}

/**
 * View state that only means something inside that folder (the retired localStorage mdapp.expanded / lastFile / folds).
 * `expanded` and `topicsExpanded` are SESSION lists (YAZ-1642): shared by every window on the
 * vault through the main-owned store, never written to disk and never restored — a launch starts
 * both trees collapsed. The other fields persist.
 */
export interface FolderState {
  expanded: string[]
  lastFile: string | null
  /** file → collapsed outline fold keys (max MAX_FOLD_KEYS_PER_FILE). Never written to the markdown. */
  folds: Record<string, string[]>
  /** `<pagePath>::<viewName>` → collapsed group keys (max MAX_COLLAPSED_GROUP_KEYS). Session chrome, never written to the page's own card (GRO-2137). */
  baseGroups: Record<string, string[]>
  /**
   * The Topics tree's expanded folder pages (🔒 D4, YAZ-848), as PAGE PATHS — max
   * MAX_TOPICS_EXPANDED_PAGES. Sibling of `expanded` (the FILE tree's open dirs): one flat
   * per-root list of absolute paths, and a path-keyed bucket, so `store.renamePath` /
   * `store.removePath` repair it exactly as they repair the other two.
   *
   * Keyed by the PAGE, never by tree position: a page reachable under two folder pages is ONE
   * entry and opens under both at once — the mockup's behaviour. Session chrome, never written
   * into any note's frontmatter.
   */
  topicsExpanded: string[]
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
  return { expanded: [], lastFile: null, folds: {}, baseGroups: {}, topicsExpanded: [] }
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
  /** Config file name inside `.yaseendraw/`, e.g. `properties.json`. */
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

// ---------- Vault-wide property declarations (`<root>/.yaseendraw/properties.json` — YAZ-835) ----------

/**
 * The editor set that exists (5B's `EditorKind`) plus the link/multi-link split. An unknown
 * `kind` string on disk is preserved there and read back as `text` (forward compat).
 */
export const PROPERTY_KINDS = ['text', 'number', 'date', 'checkbox', 'list', 'link', 'multi-link', 'select', 'multi-select'] as const
export type PropertyKind = (typeof PROPERTY_KINDS)[number]

/**
 * Property-name grammar (GRO-2200 R4): snake_case. Enforced at the properties write boundary
 * (`desktop/src/main/properties/`) — one definition so no mirror can drift from it.
 */
export const PROPERTY_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Folder-name grammar (GRO-2226, GRO-2204 audit fold-in): root-relative, '/'-separated
 * plain segments — no leading '/', no drive-like prefix, no '\' or NUL, and no '..' or other
 * leading-dot segments (dotfolders are invisible to the tree; '..' could aim a create outside
 * the vault). A STORED folder outside this grammar still reads — report-don't-block: use sites
 * treat it as absent, a vault is never refused over it.
 */
export const FOLDER_NAME = /^(?![A-Za-z]:)[^\\\0/.][^\\\0/]*(?:\/[^\\\0/.][^\\\0/]*)*$/

/** One declared property: what kind of editor it gets, and what a link points at. */
export interface PropertyDecl {
  kind: PropertyKind
  /** Ordered exact labels for Select and Multi-select; note values remain ordinary YAML strings/lists. */
  options?: string[]
  /** Display order; omitted means manual. The options array retains its manual order. */
  optionSort?: 'manual' | 'ascending' | 'descending'
  /** link/multi-link only: the picker constraint — a wikilink to a folder page ("pages that belong to [[X]]", resolved by belongsToBasenames; YAZ-831). */
  target?: string
  /** Metadata for the future validation report (report-never-block: gates nothing in v1). */
  required?: boolean
}

export interface PropertiesResponse {
  root: string
  /** The file's `version` (1 when the file is absent or unusable). >1 = readable, not mutable. */
  version: number
  /** Vault-wide declarations, keyed by bare frontmatter key. */
  properties: Record<string, PropertyDecl>
  /** Set when properties.json exists but is unusable; `properties` is then {}. */
  error?: string
}

/**
 * The vault-wide property declarations delivered as `window.yaseenDraw.properties` (YAZ-835).
 * Targeted mutators, never a whole-file PUT — the `StateApi` anti-clobber principle. Every
 * mutation is a serialised read-modify-write that preserves unknown fields at every level.
 * Property names must match `^[a-z][a-z0-9_]*$` (→ `BAD_REQUEST`). A corrupt or newer-versioned
 * properties.json rejects every mutation with `INVALID_CONFIG` and is never overwritten or
 * moved aside.
 */
export interface PropertiesApi {
  /** Empty declarations (no error) when .yaseendraw/properties.json does not exist; never creates anything. */
  get(root: string): Promise<PropertiesResponse>
  /** Upsert one vault-wide declaration. Creates the dotfolder and the file on demand. */
  setProperty(root: string, name: string, def: PropertyDecl): Promise<void>
  removeProperty(root: string, name: string): Promise<void>
  /** Fired in every window of that root after any change, internal or external. Returns an unsubscribe. */
  onChange(listener: (properties: PropertiesResponse) => void): () => void
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

/** Standard Markdown link intent; main validates and resolves it before any OS side effect. */
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
  rightPanel: RightPanelIdentity
  /** Whether this window's sidebar is hidden (YAZ-1280). */
  sidebarCollapsed: boolean
  /** Which sidebar lens this window shows (YAZ-847, per window since YAZ-1628). */
  sidebarLens: SidebarLens
  /** Focus Mode's lists (YAZ-1605, per window since YAZ-1628; Favorites' own since YAZ-1766): the same three as `WindowEntry`'s. */
  focusDirs: string[]
  focusTopics: string[]
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
  /** Merge into `folders[root]`; missing root entries are created with defaults. `topicsExpanded` is capped main-side (YAZ-848). */
  setFolder(root: string, patch: Partial<Pick<FolderState, 'expanded' | 'lastFile' | 'topicsExpanded'>>): Promise<void>
  /** Replace the fold keys for one file; an empty list removes the entry. */
  setFolds(root: string, file: string, keys: readonly string[]): Promise<void>
  /** Replace the collapsed group keys for one base view (`<basePath>::<viewName>`); an empty list removes the entry. */
  setBaseGroups(root: string, key: string, collapsed: readonly string[]): Promise<void>
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
  setIdentity(patch: Partial<Pick<WindowIdentity, 'root' | 'file' | 'tabs' | 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusTopics' | 'focusFavorites'>>): Promise<void>
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

/** Clipboard text captured when the user chooses an explicit paste mode. */
export interface ClipboardPasteRequest {
  mode: 'plain' | 'markdown'
  text: string
}

/**
 * Menu gestures from the main process (B3, GRO-2161): the renderer owns root switching at
 * runtime, so File › Open Folder… / Open Recent land on the focused window's renderer.
 */
/** One ⌘+ / ⌘− / ⌘0 press: up, down, or back to the default (YAZ-1710). */
export type ZoomStep = -1 | 0 | 1

export interface MenuApi {
  /** First focused editor returning a string claims copy; empty means no selection. Returns an unsubscribe. */
  onCopyAs(listener: (mode: 'plain' | 'markdown') => string | undefined): () => void
  /** Explicit paste targets the focused editor; return true when handled. Returns an unsubscribe. */
  onPasteAs(listener: (request: ClipboardPasteRequest) => boolean): () => void
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
  /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0) targeted this window: the renderer routes it to the focused note or the app (YAZ-1710). Returns an unsubscribe. */
  onZoom(listener: (step: ZoomStep) => void): () => void
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
  /**
   * Store/tab repair for a rename that ALREADY happened on disk (Links E1c, GRO-2242): the user
   * confirmed a detected EXTERNAL rename, so there is nothing to move — `newPath` must exist
   * (its stat derives `kind`) and `oldPath` must NOT (a live old path means the hypothesis was
   * wrong: `BAD_REQUEST`); the other validation mirrors `rename` minus the disk rename itself.
   * Runs the same store repair and pushes the same `file:renamed` to every window, so tabs,
   * editor continuity and title/hash reuse the E1 downstream unchanged.
   */
  repairRename(req: RenameFileRequest): Promise<RenameFileResponse>
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
   * recents, folder state, fold and baseGroups keys) and pushes `file:deleted` to EVERY
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
  /** Open a validated Markdown-link target through the OS; never creates an Electron window. */
  openLink(req: OpenLinkRequest): Promise<void>
  /**
   * Copy for Agent (YAZ-1617): the handshake text for `path` — the page, one sentence, and the
   * `yaseendraw` command with `--help` — which the renderer writes to the clipboard itself, the
   * way Copy path does. Main composes it because only main knows where the command lives.
   * Read-only, `reveal`'s posture: a page that no longer exists rejects `NOT_FOUND`; a
   * non-Markdown file is not a page and rejects `UNSUPPORTED_EXTENSION`.
   */
  agentPrompt(req: RevealRequest): Promise<string>
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
 * Request/response shapes are the ones above. Bases (GRO-2097) adds its methods here
 * (e.g. `index(root)`) — additive only.
 */
export interface YaseenDrawApi {
  tree(root: string): Promise<TreeResponse>
  readFile(path: string): Promise<FileResponse>
  readPdf(path: string): Promise<PdfResponse>
  readImage(path: string): Promise<ImageResponse>
  writeFile(req: FileWriteRequest): Promise<FileWriteResponse>
  createDir(path: string): Promise<CreateDirResponse>
  createFile(req: string | CreateFileRequest): Promise<CreateFileResponse>
  /** Bases property index for `root` (GRO-2129): full scan on first call, watcher-incremental after. */
  index(root: string): Promise<IndexResponse>
  /**
   * The cold-start reconcile diff for `root` (Links E1c, GRO-2242): what changed on disk while
   * the app was closed, straight from the persistent index cache's reconcile. Null before the
   * first `index(root)` build for this root (and again after idle eviction drops the entry) —
   * consumers read it AFTER the first index snapshot. Trust `added`/`removed`/`changed` only
   * when `cacheStatus === 'hit'`; on any other status they are empty.
   */
  coldDiff(root: string): Promise<ColdStartDiffResponse | null>
  /**
   * Local asset for the cards view (GRO-2139) and the drawing embed (YAZ-876): `ref` is a
   * wikilink target or path (`|alias` / `#heading` stripped) — tried root-relative, then
   * Obsidian's shortest-path rule (case-insensitive basename, first match in a deterministic
   * walk); the same resolver serves `app://vault` image URLs (YAZ-1658). Images
   * (`IMAGE_EXTENSIONS`) and drawings (`DRAWING_EXTENSIONS`) only.
   */
  readAsset(root: string, ref: string): Promise<AssetResponse>
  /** Writes a drawing (string) or an image (bytes) under `root` (YAZ-876, YAZ-1661): explicit path, atomic; see `AssetWriteRequest`. */
  writeAsset(req: AssetWriteRequest): Promise<AssetWriteResponse>
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
  /** Vault-wide property declarations over `.yaseendraw/properties.json` (YAZ-835). */
  properties: PropertiesApi
  /** The Favorites list over `.yaseendraw/favorites.json` (YAZ-1766 6A) — absolute paths in, relative on disk. */
  favorites: FavoritesApi
  /** Per-vault GitHub sync, off by default (YAZ-1081). */
  github: GithubApi
}
