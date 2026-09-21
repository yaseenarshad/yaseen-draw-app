import type { AssetResponse, AssetWriteRequest, AssetWriteResponse, BridgeError, BridgeErrorCode, ColdStartDiffResponse, CreateDirResponse, CreateFileRequest, CreateFileResponse, DeleteRequest, DeleteResponse, FileClipRequest, FileClipState, FileResponse, FileWriteRequest, FileWriteResponse, GithubSyncStatus, ImageResponse, IndexResponse, OpenLinkRequest, PasteRequest, PasteResponse, PdfResponse, PickFolderResponse, PropertiesResponse, PropertyDecl, RenameFileRequest, RenameFileResponse, RevealRequest, RevealResponse, TreeResponse } from '@shared/types'

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
  readFile: (path: string) => call<FileResponse>(() => window.yaseenDraw.readFile(path)),
  readPdf: (path: string) => call<PdfResponse>(() => window.yaseenDraw.readPdf(path)),
  readImage: (path: string) => call<ImageResponse>(() => window.yaseenDraw.readImage(path)),
  writeFile: (body: FileWriteRequest) => call<FileWriteResponse>(() => window.yaseenDraw.writeFile(body)),
  createDir: (path: string) => call<CreateDirResponse>(() => window.yaseenDraw.createDir(path)),
  createFile: (req: string | CreateFileRequest) => call<CreateFileResponse>(() => window.yaseenDraw.createFile(req)),
  /** In-app rename: file rename/move or folder rename, never overwrites (Links E1 GRO-2194, E1b GRO-2241). */
  rename: (req: RenameFileRequest) => call<RenameFileResponse>(() => window.yaseenDraw.file.rename(req)),
  /** Store/tab repair for a rename that ALREADY happened on disk (Links E1c, GRO-2242); reuses the `file:renamed` downstream. */
  repairRename: (req: RenameFileRequest) => call<RenameFileResponse>(() => window.yaseenDraw.file.repairRename(req)),
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
  /** Copy for Agent (YAZ-1617): the three-line handshake for a page; main composes it, the caller writes the clipboard. Stale path → NOT_FOUND. */
  agentPrompt: (req: RevealRequest) => call<string>(() => window.yaseenDraw.shell.agentPrompt(req)),
  /** Open in the OS default app (YAZ-1577) — how a row with no in-app viewer opens; stale path → NOT_FOUND. */
  openDefault: (req: RevealRequest) => call<RevealResponse>(() => window.yaseenDraw.shell.openDefault(req)),
  /** Open a standard Markdown-link target through the OS; main owns validation and resolution. */
  openLink: (req: OpenLinkRequest) => call<void>(() => window.yaseenDraw.shell.openLink(req)),
  /** Bases property index for `root` (GRO-2129). */
  index: (root: string) => call<IndexResponse>(() => window.yaseenDraw.index(root)),
  /** The cold-start reconcile diff for `root` (Links E1c, GRO-2242); null before the first index build. */
  coldDiff: (root: string) => call<ColdStartDiffResponse | null>(() => window.yaseenDraw.coldDiff(root)),
  /** Local image or drawing under `root` (GRO-2139, drawings YAZ-876); `ref` = wikilink target or path. */
  readAsset: (root: string, ref: string) => call<AssetResponse>(() => window.yaseenDraw.readAsset(root, ref)),
  /** Writes a `.excalidraw` sidecar under `root` (YAZ-876): drawings only, explicit path, never fuzzy. */
  writeAsset: (req: AssetWriteRequest) => call<AssetWriteResponse>(() => window.yaseenDraw.writeAsset(req)),
  /** Native open-directory dialog parented to this window; resolves when the user picks or cancels. */
  pickFolder: () => call<PickFolderResponse>(() => window.yaseenDraw.pickFolder()),
  /** Vault-wide property declarations over `.yaseendraw/properties.json` (YAZ-835); consumed via `useProperties`. */
  properties: {
    get: (root: string) => call<PropertiesResponse>(() => window.yaseenDraw.properties.get(root)),
    setProperty: (root: string, name: string, def: PropertyDecl) => call<void>(() => window.yaseenDraw.properties.setProperty(root, name, def)),
    removeProperty: (root: string, name: string) => call<void>(() => window.yaseenDraw.properties.removeProperty(root, name)),
    onChange: (listener: (properties: PropertiesResponse) => void) => window.yaseenDraw.properties.onChange(listener),
  },
  /** The Favorites list over `.yaseendraw/favorites.json` (YAZ-1766 6A): absolute paths in the user's order; a malformed file rejects `set` with INVALID_CONFIG. */
  favorites: {
    get: (root: string) => call<string[]>(() => window.yaseenDraw.favorites.get(root)),
    set: (root: string, paths: readonly string[]) => call<void>(() => window.yaseenDraw.favorites.set(root, paths)),
    onChanged: (listener: (change: { root: string }) => void) => window.yaseenDraw.favorites.onChanged(listener),
  },
  /** Per-vault GitHub sync (YAZ-1081): off by default, toggled through `.yaseendraw/github.json`; every call answers the same status the push carries. */
  github: {
    status: (root: string) => call<GithubSyncStatus>(() => window.yaseenDraw.github.status(root)),
    syncNow: (root: string) => call<GithubSyncStatus>(() => window.yaseenDraw.github.syncNow(root)),
    setEnabled: (root: string, enabled: boolean) => call<GithubSyncStatus>(() => window.yaseenDraw.github.setEnabled(root, enabled)),
    onStatus: (listener: (status: GithubSyncStatus) => void) => window.yaseenDraw.github.onStatus(listener),
  },
}
