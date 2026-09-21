import { app, BrowserWindow, clipboard, Menu, nativeTheme, net, powerMonitor, protocol, screen, shell } from 'electron'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileLink, parseFileLink } from '@shared/links'
import type { ClipboardPasteRequest, WindowEntry } from '@shared/types'
import { CH } from '../channels'
import type { GitSyncManager } from './git/manager'
import { registerIpc } from './ipc'
import { registerAgentIpc } from './ipc/agent'
import { registerClipboardIpc } from './ipc/clipboard'
import { createLinkQueue } from './linkQueue'
import { openLink } from './fs/openLink'
import { buildContextMenuTemplate, buildMenuTemplate, createMenuHandlers, pickMenuTargetWindow, subscribeMenuRebuild } from './menu'
import { revealItem } from './fs/reveal'
import { revealVaultImage, serveVaultImage } from './vaultProtocol'
import { createStore } from './store'
import { subscribeNativeTheme, windowBackgroundColor } from './theme'
import { applyUserDataOverride } from './userData'
import { flushIndexCache, initIndexCache } from './vaultIndex'
import { createWindowManager } from './windows'
import { createWindowOpenHandler } from './windowOpenPolicy'

// Before anything reads app.getPath('userData'): the workspace is named "desktop", the app is not.
app.setName('Yaseen Draw')
applyUserDataOverride(app, process.env.YASEEN_DRAW_USER_DATA_DIR)

/** One running instance (GRO-2160): a second launch focuses the first; a link in its argv routes (E1). */
const isPrimaryInstance = app.requestSingleInstanceLock()
if (!isPrimaryInstance) app.quit()
app.on('second-instance', (_event, argv) => {
  // Windows/Linux deliver a clicked yaseendraw:// link as an argv entry of the second launch.
  const urls = argv.filter((arg) => arg.startsWith('yaseendraw://'))
  if (urls.length > 0) {
    for (const url of urls) links.push(url)
    return // routing focuses (or opens) the right window itself
  }
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win === undefined) return
  if (win.isMinimized()) win.restore()
  win.focus()
})

// Deep links (E1, GRO-2171): the packaged bundle's `protocols` Info.plist entry is F1's job.
app.setAsDefaultProtocolClient('yaseendraw')

/** A parsed link routes to the best window; a bad one gets the unobtrusive notice, never a dialog. */
function handleLink(url: string): void {
  const parsed = parseFileLink(url)
  if (parsed === null) {
    manager.linkNotice(`Can't open link: ${url}`)
    return
  }
  manager.routeToFile(parsed.path, parsed.root)
}

/** macOS fires `open-url` before `ready` on cold start: queue until `restoreAll()` ran, then flush. */
const links = createLinkQueue(handleLink)
app.on('open-url', (event, url) => {
  event.preventDefault()
  links.push(url)
})

// Finder "Open With" (E2, GRO-2172) hands a plain absolute path — also before `ready` on cold
// start. Encoding it as a yaseendraw:// link reuses the whole E1 pipeline (queue, parse, routing,
// markdown/exists guards); fileLink ↔ parseFileLink is lossless (links.test.ts round trips). The
// packaged bundle's `fileAssociations` (role Alternate) declaration is F1's job.
app.on('open-file', (event, path) => {
  event.preventDefault()
  links.push(fileLink(path))
})

// Privileged scheme: `standard` gives a real origin (history API, relative URLs), `secure` treats it
// like https. VS Code (vscode-file://) and Obsidian (app://obsidian.md) do the same.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

const RENDERER_DIR = join(__dirname, '../renderer')

/** One user-global state file (D9, GRO-2159): `~/Library/Application Support/Yaseen Draw/yaseendraw.json`. */
const store = createStore(join(app.getPath('userData'), 'yaseendraw.json'))

/** Persistent vault-index cache (GRO-2223 D1): one JSON per vault under userData, never in the vault. */
initIndexCache(join(app.getPath('userData'), 'index-cache'))

/** Window lifecycle (GRO-2160) lives in windows.ts; this host is its Electron-only half. */
const manager = createWindowManager(store, {
  create(entry: WindowEntry) {
    const win = new BrowserWindow({
      ...entry.bounds,
      // The backing store matches the theme (K, GRO-2218): no white flash on dark launches.
      backgroundColor: windowBackgroundColor(store.get().settings.theme, nativeTheme.shouldUseDarkColors),
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, plugins: true },
    })
    win.webContents.setWindowOpenHandler(createWindowOpenHandler(openLink))
    // Electron ships no default context menu (YAZ-672), so the spellchecker's squiggles would
    // otherwise be unactionable; the template itself is pure and lives in menu.ts.
    win.webContents.on('context-menu', (_event, params) =>
      Menu.buildFromTemplate(buildContextMenuTemplate(params, {
        copyAs: (mode) => win.webContents.send(CH.menuCopyAs, mode),
        pasteAs: (mode) => win.webContents.send(CH.menuPasteAs, { mode, text: clipboard.readText() } satisfies ClipboardPasteRequest),
        replace: (s) => win.webContents.replaceMisspelling(s),
        addToDictionary: (w) => win.webContents.session.addWordToSpellCheckerDictionary(w),
        // Image rows (YAZ-1666): Chromium copies the decoded pixels at the click point; reveal
        // resolves the `<img src>` through vaultProtocol.ts, so a non-vault source is a no-op there.
        copyImage: () => win.webContents.copyImageAt(params.x, params.y),
        revealImage: (src) => void revealVaultImage(src, (file) => revealItem({ path: file })),
      })).popup({ window: win }))
    // `<renderer>?win=<id>` so the renderer can ask `window.identity()` who it is.
    const url = new URL(process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html')
    url.searchParams.set('win', entry.id)
    void win.loadURL(url.toString())
    return win
  },
  // Primary first: clampBounds keeps the earliest work area when a window is fully off-screen.
  workAreas() {
    const primary = screen.getPrimaryDisplay()
    return [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)].map((d) => d.workArea)
  },
  exists(path) {
    try {
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
  // The open-recent door's probe (YAZ-1767 D1; was the menu host's until the switcher shared the path).
  dirExists(path) {
    try {
      return statSync(path).isDirectory()
    } catch {
      return false
    }
  },
})

/**
 * The most recently focused window's `webContents.id` — pickMenuTargetWindow's fallback key
 * (GRO-2197). Never cleared on blur: macOS reporting "no focused window" (app not frontmost)
 * is exactly the state the fallback exists for, so the last id must survive it.
 */
let lastFocusedWcId: number | undefined

/** The per-vault GitHub sync manager (YAZ-1081), created with the rest of the IPC once `ready` fires. */
let gitSync: GitSyncManager | undefined

app.on('browser-window-focus', (_event, win) => {
  lastFocusedWcId = win.webContents.id
  // YAZ-1081 D2: focusing a vault's window is a PULL trigger — alt-tabbing back from another
  // machine should converge without waiting out a timer. The manager's own cooldown throttles it.
  const root = store.get().windows.find((w) => w.id === manager.idFor(win.webContents))?.root ?? null
  if (root !== null) gitSync?.notifyFocus(root)
})

app.whenReady().then(() => {
  if (!isPrimaryInstance) return
  // Appearance (K, GRO-2218): the setting IS the themeSource vocabulary. Applied from the loaded
  // store BEFORE any window is created (restoreAll below), re-applied whenever it changes — so
  // `prefers-color-scheme` in every renderer and the OS chrome follow the setting.
  subscribeNativeTheme(store, (theme) => {
    nativeTheme.themeSource = theme
  })
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url)
    // `app://vault/…` (YAZ-1658): vault images for `<img src>`, resolved by vaultProtocol.ts;
    // every other host is the renderer bundle, exactly as before.
    if (host === 'vault') return serveVaultImage(req, (u) => net.fetch(u))
    const file = join(RENDERER_DIR, pathname === '/' ? 'index.html' : pathname)
    return net.fetch(pathToFileURL(file).toString())
  })
  // Menu bar (B3, GRO-2161): the template is pure (menu.ts); only this apply layer touches Menu.
  // `focusedWebContents` resolves through pickMenuTargetWindow (GRO-2197): macOS reports no
  // focused window while the app is not frontmost, and a menu action must never silently no-op
  // — so the last-focused live window (tracked below) is the documented fallback target.
  const menuTarget = () => pickMenuTargetWindow(BrowserWindow.getFocusedWindow(), BrowserWindow.getAllWindows(), lastFocusedWcId)?.webContents
  registerClipboardIpc(manager, {
    target: menuTarget,
    writeText: (text) => clipboard.writeText(text),
    rendererUrl: process.env.ELECTRON_RENDERER_URL ?? 'app://yaseen/index.html',
  })
  // Copy for Agent (YAZ-1617): main knows where the `yaseendraw` command lives; the renderer only asks.
  registerAgentIpc({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, mainDir: __dirname })
  const handlers = createMenuHandlers(store, manager, {
    focusedWebContents: menuTarget,
    readClipboardText: () => clipboard.readText(),
    openExternal: (url) => void shell.openExternal(url),
  })
  const applyMenu = (): void =>
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({ recents: store.get().recents, isDev: !app.isPackaged }, handlers)))
  applyMenu()
  subscribeMenuRebuild(store, applyMenu)
  const sync = registerIpc(store, manager)
  gitSync = sync
  // YAZ-1081 D3: a lid that just opened is the other "the world moved on while you were away"
  // moment, and the machine that edited the vault meanwhile is usually the other one. Wired here
  // rather than at module scope because powerMonitor is only safe to touch after `ready`.
  powerMonitor.on('resume', () => sync.notifyWake())
  powerMonitor.on('unlock-screen', () => sync.notifyWake())
  manager.restoreAll()
  links.flush()
})

// Quit: flush every renderer sequentially (5s cap each, `windows[]` kept so relaunch restores them),
// write the pending state, then exit for real — `app.exit` re-runs no quit events.
// The ORDER is load-bearing for YAZ-1081 D2: the renderers flush FIRST, so the last sync commit
// contains the edit the user made a second before quitting rather than leaving it for next launch.
let quitting = false
app.on('before-quit', (event) => {
  event.preventDefault()
  if (quitting) return
  quitting = true
  void manager
    .flushAllForQuit()
    .then(() => Promise.all([store.flush(), flushIndexCache(), gitSync?.flushForQuit()]))
    .finally(() => app.exit(0))
})

// Obsidian quits when its last window closes (its main.js `window-all-closed` handler); so do we.
app.on('window-all-closed', () => app.quit())
