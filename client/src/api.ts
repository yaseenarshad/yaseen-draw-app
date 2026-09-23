import type { BridgeError, BridgeErrorCode, ComponentItem, ComponentReadResponse, ComponentRenameRequest, ComponentSaveRequest, ComponentSlugRequest, CreateDirResponse, CreateFileRequest, CreateFileResponse, DeleteRequest, DeleteResponse, DrawingLoadRequest, DrawingLoadResponse, DrawingSaveRequest, DrawingSaveResponse, FileClipRequest, FileClipState, GithubSyncStatus, MediaFavoritesRequest, MediaImportRequest, MediaImportResponse, MediaPreviewRequest, MediaPreviewResponse, MediaRecentRequest, MediaSearchRequest, MediaSearchResponse, OpenDrawingResponse, PasteRequest, PasteResponse, PickFolderResponse, RenameFileRequest, RenameFileResponse, RevealRequest, RevealResponse, SaveDrawingRequest, SaveDrawingResponse, SecretHasRequest, SecretSetRequest, ShrinkResult, StoredMediaItem, TreeResponse, VaultStorageStats } from '@shared/types'

/** Typed failure from the main process (see docs/CONTRACTS.md "Bridge API"). */
export class BridgeRequestError extends Error {
  constructor(
    readonly code: BridgeErrorCode | 'CONFLICT',
    message: string,
    /** Current on-disk mtime, only present on CONFLICT. */
    readonly mtime?: number,
    /** The offending path, when the main process attributed the failure to one. */
    readonly path?: string,
  ) {
    super(message)
    this.name = 'BridgeRequestError'
  }
}

function isBridgeError(err: unknown): err is BridgeError {
  return typeof err === 'object' && err !== null && typeof (err as BridgeError).code === 'string' && typeof (err as BridgeError).message === 'string'
}

/** The bridge rejects with a plain `BridgeError` object (no prototype survives IPC); give it a class. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isBridgeError(err)) throw new BridgeRequestError(err.code, err.message, err.mtime, err.path)
    throw new BridgeRequestError('IO_ERROR', err instanceof Error ? err.message : String(err))
  }
}

/** The fs half of `window.yaseenDraw`, with rejections wrapped in `BridgeRequestError`. */
export const api = {
  tree: (root: string) => call<TreeResponse>(() => window.yaseenDraw.tree(root)),
  createDir: (path: string) => call<CreateDirResponse>(() => window.yaseenDraw.createDir(path)),
  createFile: (req: CreateFileRequest) => call<CreateFileResponse>(() => window.yaseenDraw.createFile(req)),
  /** In-app rename: file rename/move or folder rename, never overwrites (Links E1 GRO-2194, E1b GRO-2241). */
  rename: (req: RenameFileRequest) => call<RenameFileResponse>(() => window.yaseenDraw.file.rename(req)),
  /** In-app delete to the SYSTEM Trash (GRO-2272); never `fs.rm`, and a trash failure deletes nothing. */
  delete: (req: DeleteRequest) => call<DeleteResponse>(() => window.yaseenDraw.file.delete(req)),
  /** Cut / Copy (YAZ-1674, D1): replace main's ONE app-wide clipboard with the ordered selection; nothing on disk is touched. */
  clip: (req: FileClipRequest) => call<void>(() => window.yaseenDraw.file.clip(req)),
  /** Paste INTO `targetDir` (YAZ-1674, D2–D4): per-entry outcomes, a cut moves through the rename pipeline and pastes once, a copy takes Finder's free name and pastes again. Empty clipboard → BAD_REQUEST. */
  paste: (req: PasteRequest) => call<PasteResponse>(() => window.yaseenDraw.file.paste(req)),
  /** The current app-wide clipboard (YAZ-1674): read once on mount by a window that opened after a clip; `onClipChanged` carries later changes. */
  clipState: () => call<FileClipState>(() => window.yaseenDraw.file.clipState()),
  /** Every clipboard change, in every window (YAZ-1674): `{ count, op }` or null when empty — the menu's "Paste N items" / disabled "Paste". */
  onClipChanged: (listener: (state: FileClipState) => void) => window.yaseenDraw.file.onClipChanged(listener),
  /** Reveal in the OS file manager, selected in its parent (GRO-2274); stale path → NOT_FOUND. */
  reveal: (req: RevealRequest) => call<RevealResponse>(() => window.yaseenDraw.shell.reveal(req)),
  /** Open in VS Code via the `vscode://file` deep link (YAZ-963) — never a spawn; stale path → NOT_FOUND. */
  openVsCode: (req: RevealRequest) => call<RevealResponse>(() => window.yaseenDraw.shell.openVsCode(req)),
  /** Open in the OS default app (YAZ-1577) — how a row with no in-app viewer opens; stale path → NOT_FOUND. */
  openDefault: (req: RevealRequest) => call<RevealResponse>(() => window.yaseenDraw.shell.openDefault(req)),
  /**
   * The drawing DOCUMENT's two doors (🔒 YAZ-1810). Everything a `.excalidraw` tab reads and
   * writes goes through these two calls and no other — the scene and the bytes it names travel
   * together, so neither can land without the other.
   */
  drawing: {
    load: (req: DrawingLoadRequest) => call<DrawingLoadResponse>(() => window.yaseenDraw.drawing.load(req)),
    save: (req: DrawingSaveRequest) => call<DrawingSaveResponse>(() => window.yaseenDraw.drawing.save(req)),
    /** The RESOLVED library folder (🔒 YAZ-1775 D5): the setting, or `<userData>/library` — main's answer. */
    libraryFolder: () => call<string>(() => window.yaseenDraw.drawing.libraryFolder()),
  },
  /** Native open-directory dialog parented to this window; resolves when the user picks or cancels. */
  pickFolder: () => call<PickFolderResponse>(() => window.yaseenDraw.pickFolder()),
  /** Native file dialogs (YAZ-1833): `openDrawing()` picks one `.excalidraw` and answers its bytes. */
  dialog: {
    openDrawing: () => call<OpenDrawingResponse>(() => window.yaseenDraw.dialog.openDrawing()),
    /** Pick a destination and write a standalone `.excalidraw` there — dialog AND write in one call (🔒 YAZ-1775 D3). */
    saveDrawing: (req: SaveDrawingRequest) => call<SaveDrawingResponse>(() => window.yaseenDraw.dialog.saveDrawing(req)),
  },
  /** The Favorites list over `.yaseendraw/favorites.json` (YAZ-1766 6A): absolute paths in the user's order; a malformed file rejects `set` with INVALID_CONFIG. */
  favorites: {
    get: (root: string) => call<string[]>(() => window.yaseenDraw.favorites.get(root)),
    set: (root: string, paths: readonly string[]) => call<void>(() => window.yaseenDraw.favorites.set(root, paths)),
    onChanged: (listener: (change: { root: string }) => void) => window.yaseenDraw.favorites.onChanged(listener),
  },
  /** The cross-vault media library over `<library>/media.json` (🔒 YAZ-1775 D4 / D5, YAZ-1817): pointers only; every verb answers the list it produced. */
  media: {
    favorites: (req: MediaFavoritesRequest) => call<StoredMediaItem[]>(() => window.yaseenDraw.media.favorites(req)),
    recent: (req: MediaRecentRequest) => call<StoredMediaItem[]>(() => window.yaseenDraw.media.recent(req)),
    /** Fired in EVERY window when `media.json` changes — this app's write, another vault's window, or a synced edit. */
    onChanged: (listener: () => void) => window.yaseenDraw.media.onChanged(listener),
    /** Federated provider search (🔒 YAZ-1775 D4, YAZ-1818): Iconify always, Pixabay when a key is set — `pixabayAvailable` says which. */
    search: (req: MediaSearchRequest) => call<MediaSearchResponse>(() => window.yaseenDraw.media.search(req)),
    /** One tile's picture as a dataURL, served from main's 24 h disk cache when it is there. */
    preview: (req: MediaPreviewRequest) => call<MediaPreviewResponse>(() => window.yaseenDraw.media.preview(req)),
    /** The full-size bytes to insert — never cached, because they are about to become an `assets/` file (🔒 YAZ-1775 D3). */
    import: (req: MediaImportRequest) => call<MediaImportResponse>(() => window.yaseenDraw.media.import(req)),
  },
  /**
   * The cross-vault saved-component library over `<library>/components/` (🔒 YAZ-1775 D5, YAZ-1819): a
   * component is a whole `.excalidraw` fragment with its image bytes embedded, plus a PNG preview,
   * indexed by `<library>/components.json`. Every mutation answers what it produced, and
   * `onChanged` fires in every window whichever vault it is on.
   */
  components: {
    list: () => call<ComponentItem[]>(() => window.yaseenDraw.components.list()),
    save: (req: ComponentSaveRequest) => call<ComponentItem>(() => window.yaseenDraw.components.save(req)),
    read: (req: ComponentSlugRequest) => call<ComponentReadResponse>(() => window.yaseenDraw.components.read(req)),
    rename: (req: ComponentRenameRequest) => call<ComponentItem>(() => window.yaseenDraw.components.rename(req)),
    delete: (req: ComponentSlugRequest) => call<void>(() => window.yaseenDraw.components.delete(req)),
    /** The stored `<slug>.png` as a dataURL — the grid's tile picture; NOT_FOUND when it is gone. */
    preview: (req: ComponentSlugRequest) => call<string>(() => window.yaseenDraw.components.preview(req)),
    onChanged: (listener: () => void) => window.yaseenDraw.components.onChanged(listener),
  },
  /** The secrets door (🔒 YAZ-1775 D4): write and ask, never read. */
  secrets: {
    set: (req: SecretSetRequest) => call<void>(() => window.yaseenDraw.secrets.set(req)),
    has: (req: SecretHasRequest) => call<boolean>(() => window.yaseenDraw.secrets.has(req)),
  },
  /** Per-vault GitHub sync (YAZ-1081): off by default, toggled through `.yaseendraw/github.json`; every call answers the same status the push carries. */
  github: {
    status: (root: string) => call<GithubSyncStatus>(() => window.yaseenDraw.github.status(root)),
    syncNow: (root: string) => call<GithubSyncStatus>(() => window.yaseenDraw.github.syncNow(root)),
    setEnabled: (root: string, enabled: boolean) => call<GithubSyncStatus>(() => window.yaseenDraw.github.setEnabled(root, enabled)),
    onStatus: (listener: (status: GithubSyncStatus) => void) => window.yaseenDraw.github.onStatus(listener),
  },
  /** Settings › Storage (YAZ-1801): what the vault weighs (disk + local git), and moving legacy pictures out of boards. */
  storage: {
    stats: (root: string) => call<VaultStorageStats>(() => window.yaseenDraw.storage.stats(root)),
    shrink: (root: string, skip: readonly string[]) => call<ShrinkResult>(() => window.yaseenDraw.storage.shrink(root, skip)),
  },
}
