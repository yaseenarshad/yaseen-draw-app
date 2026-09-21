import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, ClipboardPasteRequest, FileClipState, FileDeletedEvent, FileRenamedEvent, GithubSyncStatus, PropertiesResponse, VaultConfigChange, WatchEvent, YaseenDocsApi, ZoomStep } from '@shared/types'
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

// Each editor claims only its own focused surface. Ordinary inputs retain native insertion.
const pasteListeners = new Set<(request: ClipboardPasteRequest) => boolean>()
ipcRenderer.on(CH.menuPasteAs, (_event, request: ClipboardPasteRequest) => {
  for (const listener of pasteListeners) if (listener(request)) return
  void call<void>(CH.menuPasteTextFallback, request.text).catch((error: unknown) => console.error('Paste failed', error))
})

/** DOM-only fallback for ordinary controls; editor subscribers own ProseMirror and CodeMirror selections. */
function selectedNativeText(): string {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    if (active instanceof HTMLInputElement && active.type === 'password') return ''
    const { selectionStart: start, selectionEnd: end } = active
    return start === null || end === null || start === end ? '' : active.value.slice(start, end)
  }
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || !selection.anchorNode || !selection.focusNode) return ''
  // A focused button or other surface must not copy a stale selection left in another editor.
  if (active && (!active.contains(selection.anchorNode) || !active.contains(selection.focusNode))) return ''
  return selection.toString()
}

// No clipboard API crosses contextBridge: only a main-process menu gesture can initiate this path.
const copyListeners = new Set<(mode: 'plain' | 'markdown') => string | undefined>()
ipcRenderer.on(CH.menuCopyAs, (_event, mode: unknown) => {
  if (mode !== 'plain' && mode !== 'markdown') return
  let text: string | undefined
  for (const listener of copyListeners) {
    const selected = listener(mode)
    if (typeof selected === 'string') {
      text = selected
      break
    }
  }
  text ??= selectedNativeText()
  if (text !== '') void call<void>(CH.menuCopyText, text).catch((error: unknown) => console.error('Copy failed', error))
})

const api: YaseenDocsApi = {
  tree: (root) => call(CH.fsTree, root),
  readFile: (path) => call(CH.fsRead, path),
  readPdf: (path) => call(CH.fsReadPdf, path),
  readImage: (path) => call(CH.fsReadImage, path),
  writeFile: (req) => call(CH.fsWrite, req),
  createDir: (path) => call(CH.fsCreateDir, path),
  createFile: (req) => call(CH.fsCreateFile, req),
  index: (root) => call(CH.fsIndex, root),
  // The cold-start reconcile diff (Links E1c, GRO-2242): read AFTER the first index(root).
  coldDiff: (root) => call(CH.fsColdDiff, root),
  readAsset: (root, ref) => call(CH.fsReadAsset, root, ref),
  writeAsset: (req) => call(CH.fsWriteAsset, req),
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
    setFolds: (root, file, keys) => call(CH.stateSetFolds, root, file, [...keys]),
    setBaseGroups: (root, key, collapsed) => call(CH.stateSetBaseGroups, root, key, [...collapsed]),
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
    onCopyAs: (listener) => {
      copyListeners.add(listener)
      return () => { copyListeners.delete(listener) }
    },
    onPasteAs: (listener) => {
      pasteListeners.add(listener)
      return () => { pasteListeners.delete(listener) }
    },
    onOpenFolder: on<void>(CH.menuOpenFolder),
    onOpenRoot: on<string>(CH.menuOpenRoot),
    onSearch: on<void>(CH.menuSearch),
    onSwitchVault: on<void>(CH.menuSwitchVault),
    onSettings: on<void>(CH.menuSettings),
    onToggleSidebar: on<void>(CH.menuToggleSidebar),
    onZoom: on<ZoomStep>(CH.menuZoom),
    onCloseTab: on<void>(CH.menuCloseTab),
    onNextTab: on<void>(CH.menuNextTab),
    onPrevTab: on<void>(CH.menuPrevTab),
  },
  // Deep links (E1, GRO-2171): main routes a yaseendocs:// URL to the best window.
  link: {
    onOpenFile: on<string>(CH.linkOpenFile),
    onNotice: on<string>(CH.linkNotice),
  },
  // In-app rename (Links E1, GRO-2194) + external-rename repair (E1c, GRO-2242): the invokes
  // plus the renamed push every window gets (repair reuses the SAME push downstream).
  // In-app delete (GRO-2272) rides the same shape: one invoke, one push to every window.
  // Cut/Copy/Paste (YAZ-1674): two invokes against main's ONE app-wide clipboard, plus the
  // `clip:changed` push every window gets so its menu can label "Paste N items".
  file: {
    rename: (req) => call(CH.fsRename, req),
    repairRename: (req) => call(CH.fileRepairRename, req),
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
    agentPrompt: (req) => call(CH.shellAgentPrompt, req),
    openLink: (req) => call(CH.shellOpenLink, req),
  },
  // Vault-wide property declarations over `.yaseendocs/properties.json` (YAZ-835).
  properties: {
    get: (root) => call(CH.propertiesGet, root),
    setProperty: (root, name, def) => call(CH.propertiesSetProperty, root, name, def),
    removeProperty: (root, name) => call(CH.propertiesRemoveProperty, root, name),
    onChange: (listener) => {
      const on = (_e: unknown, msg: { root: string; properties: PropertiesResponse }) => listener(msg.properties)
      ipcRenderer.on(CH.propertiesChanged, on)
      return () => ipcRenderer.removeListener(CH.propertiesChanged, on)
    },
  },
  // The Favorites list over `.yaseendocs/favorites.json` (YAZ-1766 6A).
  favorites: {
    get: (root) => call(CH.favoritesGet, root),
    set: (root, paths) => call(CH.favoritesSet, root, paths),
    onChanged: on<{ root: string }>(CH.favoritesChanged),
  },
  // Vault-local config in `<root>/.yaseendocs/` (Desktop J, GRO-2188).
  vaultConfig: {
    read: (root, name) => call(CH.vaultConfigRead, root, name),
    write: (root, name, value) => call(CH.vaultConfigWrite, root, name, value),
    onChange: on<VaultConfigChange>(CH.vaultConfigChanged),
  },
  // Per-vault GitHub sync over `.yaseendocs/github.json` (YAZ-1081); every window gets every status.
  github: {
    status: (root) => call(CH.githubStatus, root),
    syncNow: (root) => call(CH.githubSyncNow, root),
    setEnabled: (root, enabled) => call(CH.githubSetEnabled, root, enabled),
    onStatus: on<GithubSyncStatus>(CH.githubStatusChanged),
  },
}

contextBridge.exposeInMainWorld('yaseenDocs', api)

/** Exported for the completeness test only (the preload is otherwise side-effect driven). */
export { api as bridge }
