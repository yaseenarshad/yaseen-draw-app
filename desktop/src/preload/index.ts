import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileClipState, FileDeletedEvent, FileRenamedEvent, GithubSyncStatus, VaultConfigChange, WatchEvent, YaseenDrawApi } from '@shared/types'
import { CH, type Envelope } from '../channels'

/** invoke + unwrap: resolves the value or rejects with the plain `BridgeError` object. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const env = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (env.ok) return env.value
  throw env.error
}

/** One main→renderer push channel as a subscribe function: `on(listener)` returns the unsubscribe. */
function on<T>(channel: string): (listener: (payload: T) => void) => () => void {
  return (listener) => {
    const handler = (_e: unknown, payload: T) => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * The close/quit flush handshake (GRO-2160): main sends `app:flush` and holds the window until
 * `app:flushed` comes back. Every registered listener is awaited (none registered — e.g. the
 * Welcome window — acks at once); a rejection still acks, main's 5s cap is the only other out.
 */
const flushListeners = new Set<() => Promise<void> | void>()
ipcRenderer.on(CH.appFlush, () => {
  void Promise.allSettled([...flushListeners].map(async (listener) => listener())).then(() => ipcRenderer.send(CH.appFlushed))
})

const api: YaseenDrawApi = {
  tree: (root) => call(CH.fsTree, root),
  readFile: (path) => call(CH.fsRead, path),
  writeFile: (req) => call(CH.fsWrite, req),
  createDir: (path) => call(CH.fsCreateDir, path),
  createFile: (req) => call(CH.fsCreateFile, req),
  // The drawing DOCUMENT's two doors (🔒 YAZ-1810): the only way a `.excalidraw` tab reads and writes.
  drawing: {
    load: (req) => call(CH.drawingLoad, req),
    save: (req) => call(CH.drawingSave, req),
    libraryFolder: () => call(CH.drawingLibraryFolder),
  },
  pickFolder: () => call(CH.dialogPickFolder),
  watch: (root, listener) => {
    const id = crypto.randomUUID()
    const onEvent = (_e: unknown, msg: { id: string; ev: WatchEvent }) => {
      if (msg.id === id) listener(msg.ev)
    }
    ipcRenderer.on(CH.watchEvent, onEvent)
    ipcRenderer.send(CH.watchSubscribe, { id, root })
    return () => {
      ipcRenderer.removeListener(CH.watchEvent, onEvent)
      ipcRenderer.send(CH.watchUnsubscribe, id)
    }
  },
  state: {
    get: () => call(CH.stateGet),
    setSettings: (settings) => call(CH.stateSetSettings, settings),
    setSidebarWidth: (width) => call(CH.stateSetSidebarWidth, width),
    pushRecent: (path) => call(CH.statePushRecent, path),
    removeRecent: (path) => call(CH.stateRemoveRecent, path),
    setFolder: (root, patch) => call(CH.stateSetFolder, root, patch),
    onChange: on<AppState>(CH.stateChanged),
  },
  window: {
    identity: () => call(CH.windowIdentity),
    setIdentity: (patch) => call(CH.windowSetIdentity, patch),
    open: (opts) => call(CH.windowOpen, opts),
    duplicate: () => call(CH.windowDuplicate),
    // The vault switcher's door (YAZ-1767 D1): true = the vault is in front (raised or newly opened), false = dead folder, pruned.
    openRecent: (path) => call(CH.windowOpenRecent, path),
    closeSelf: () => call(CH.windowCloseSelf),
    zoom: (step) => call(CH.windowZoom, step),
    onFlush: (listener) => {
      flushListeners.add(listener)
      return () => {
        flushListeners.delete(listener)
      }
    },
  },
  // Menu gestures (GRO-2161; tabs GRO-2232): main sends these to the focused window only.
  menu: {
    onOpenFolder: on<void>(CH.menuOpenFolder),
    onOpenRoot: on<string>(CH.menuOpenRoot),
    onSearch: on<void>(CH.menuSearch),
    onSwitchVault: on<void>(CH.menuSwitchVault),
    onSettings: on<void>(CH.menuSettings),
    onToggleSidebar: on<void>(CH.menuToggleSidebar),
    onCloseTab: on<void>(CH.menuCloseTab),
    onNextTab: on<void>(CH.menuNextTab),
    onPrevTab: on<void>(CH.menuPrevTab),
    // 🔒 D10: File › Export Image… and View › Canvas Background ▸, which main enables only while
    // the focused window's active tab is a drawing.
    onExportImage: on<void>(CH.menuExportImage),
    onCanvasBackground: on<string>(CH.menuCanvasBackground),
  },
  // Deep links (E1, GRO-2171): main routes a yaseendraw:// URL to the best window.
  link: {
    onOpenFile: on<string>(CH.linkOpenFile),
    onNotice: on<string>(CH.linkNotice),
  },
  // In-app rename (Links E1, GRO-2194): the invoke plus the renamed push every window gets.
  // In-app delete (GRO-2272) rides the same shape: one invoke, one push to every window.
  // Cut/Copy/Paste (YAZ-1674): two invokes against main's ONE app-wide clipboard, plus the
  // `clip:changed` push every window gets so its menu can label "Paste N items".
  file: {
    rename: (req) => call(CH.fsRename, req),
    onRenamed: on<FileRenamedEvent>(CH.fileRenamed),
    delete: (req) => call(CH.fsDelete, req),
    onDeleted: on<FileDeletedEvent>(CH.fileDeleted),
    clip: (req) => call(CH.fsClip, req),
    paste: (req) => call(CH.fsPaste, req),
    clipState: () => call(CH.fsClipState),
    onClipChanged: on<FileClipState>(CH.clipChanged),
  },
  // OS-level actions: reveal in the system file manager (GRO-2274), open in VS Code (YAZ-963), open in the default app (YAZ-1577).
  shell: {
    reveal: (req) => call(CH.shellReveal, req),
    openVsCode: (req) => call(CH.shellOpenVsCode, req),
    openDefault: (req) => call(CH.shellOpenDefault, req),
    openLink: (req) => call(CH.shellOpenLink, req),
  },
  // The Favorites list over `.yaseendraw/favorites.json` (YAZ-1766 6A).
  favorites: {
    get: (root) => call(CH.favoritesGet, root),
    set: (root, paths) => call(CH.favoritesSet, root, paths),
    onChanged: on<{ root: string }>(CH.favoritesChanged),
  },
  // Vault-local config in `<root>/.yaseendraw/` (Desktop J, GRO-2188).
  vaultConfig: {
    read: (root, name) => call(CH.vaultConfigRead, root, name),
    write: (root, name, value) => call(CH.vaultConfigWrite, root, name, value),
    onChange: on<VaultConfigChange>(CH.vaultConfigChanged),
  },
  // The cross-vault media library over `<library>/media.json` (🔒 D4 / D5, YAZ-1817): pointers only, every window hears every change.
  media: {
    favorites: (req) => call(CH.mediaFavorites, req),
    recent: (req) => call(CH.mediaRecent, req),
    onChanged: on<void>(CH.mediaChanged),
    // The provider doors (🔒 D4, YAZ-1818): main holds the key, does the fetching and caches.
    search: (req) => call(CH.mediaSearch, req),
    preview: (req) => call(CH.mediaPreview, req),
    import: (req) => call(CH.mediaImport, req),
  },
  // The secrets door (🔒 D4): write and ask, never read — there is no channel that answers a value.
  secrets: {
    set: (req) => call(CH.secretsSet, req),
    has: (req) => call(CH.secretsHas, req),
  },
  // Per-vault GitHub sync over `.yaseendraw/github.json` (YAZ-1081); every window gets every status.
  github: {
    status: (root) => call(CH.githubStatus, root),
    syncNow: (root) => call(CH.githubSyncNow, root),
    setEnabled: (root, enabled) => call(CH.githubSetEnabled, root, enabled),
    onStatus: on<GithubSyncStatus>(CH.githubStatusChanged),
  },
}

contextBridge.exposeInMainWorld('yaseenDraw', api)

/** Exported for the completeness test only (the preload is otherwise side-effect driven). */
export { api as bridge }
