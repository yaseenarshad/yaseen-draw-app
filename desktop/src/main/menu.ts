/**
 * The application menu (B3, GRO-2161). `buildMenuTemplate` is a pure function of its inputs
 * (recents, isDev, handlers) so structure, accelerators and roles unit-test without Electron;
 * `createMenuHandlers` needs only the injected `MenuHost` for the Electron bits (focused
 * window, external links). The `Menu.buildFromTemplate`/`setApplicationMenu` apply layer
 * lives in `main/index.ts`.
 */
import type { MenuItemConstructorOptions } from 'electron'
import type { RecentRoots, ZoomStep } from '@shared/types'
import { CH } from '../channels'
import type { Store } from './store'
import type { WindowManager } from './windows'

/** Help › Yaseen Draw on GitHub: the repo README (origin URL of this repo). */
export const HELP_URL = 'https://github.com/yaseenarshad/yaseen-draw-app#readme'

export interface MenuHandlers {
  /** File › New Window (⌘⇧N, D6): duplicate the focused window — same folder, same file. */
  newWindow(): void
  /** File › Switch Vault… (⌘O, YAZ-1767 D8): the focused window's renderer opens its sidebar vault switcher. */
  switchVault(): void
  /** File › Open Folder… (⌘⇧O): the focused window's renderer runs its pick-folder flow. */
  openFolder(): void
  /** File › Open Recent › item: in place in the focused window; `beside` (⌥-click) in a new one. */
  openRecent(path: string, beside: boolean): void
  /** File › Search Vault (⌘K, YAZ-804): the focused window's renderer focuses its sidebar search bar. */
  search(): void
  /** Yaseen Draw › Settings… (⌘,, YAZ-1679): the focused window's renderer opens its settings dialog. */
  settings(): void
  /** File › Close Tab (⌘W, GRO-2232): the focused window's renderer closes its active tab. */
  closeTab(): void
  /** Window › Next Tab (⌃Tab / ⌘⇧], GRO-2232): the focused window's renderer activates the tab to the right. */
  nextTab(): void
  /** Window › Previous Tab (⌃⇧Tab / ⌘⇧[, GRO-2232): the focused window's renderer activates the tab to the left. */
  prevTab(): void
  /** View › Toggle Sidebar: ask only the focused renderer to toggle its window identity. */
  toggleSidebar(): void
  /** View › Zoom In / Out / Actual Size (⌘+ / ⌘− / ⌘0): app-wide zoom on the focused window (YAZ-1710). */
  zoom(step: ZoomStep): void
  openHelp(): void
}

export interface MenuInputs {
  /** MRU order, straight from `AppState.recents`. */
  recents: RecentRoots
  /** Dev builds get View › Toggle Developer Tools. */
  isDev: boolean
}

/**
 * The whole menu bar as a template. Item `id`s are stable so a live check can drive items
 * through `Menu.getApplicationMenu().getMenuItemById(...)`.
 */
export function buildMenuTemplate({ recents, isDev }: MenuInputs, handlers: MenuHandlers): MenuItemConstructorOptions[] {
  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: 'No Recent Folders', enabled: false }]
      : recents.map((r, i) => ({
          id: `menu.file.open-recent.${i}`,
          label: r.path,
          // Electron hands the modifier state of the triggering gesture to click; ⌥ = open beside.
          // A programmatic `menuItem.click()` passes NO event at all — that opens in place.
          click: (_item, _win, event) => handlers.openRecent(r.path, event?.altKey === true),
        }))
  return [
    // macOS titles the first menu with the running app's name; the label only matters off-mac.
    {
      label: 'Yaseen Draw',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        // ⌘, is the platform's settings key (YAZ-1679); the renderer owns the dialog, so the
        // gesture goes to the focused window's renderer like Search Vault does.
        { id: 'menu.app.settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => handlers.settings() },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { id: 'menu.file.new-window', label: 'New Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => handlers.newWindow() },
        { type: 'separator' },
        // ⌘O opens the sidebar header's vault switcher (YAZ-1767 D8): the renderer owns the panel,
        // so the gesture goes to the focused window's renderer like Search Vault does.
        { id: 'menu.file.switch-vault', label: 'Switch Vault…', accelerator: 'CmdOrCtrl+O', click: () => handlers.switchVault() },
        { id: 'menu.file.open-folder', label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: () => handlers.openFolder() },
        { id: 'menu.file.open-recent', label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        // ⌘K focuses the sidebar's search bar (D4, YAZ-739 amended): the renderer owns the bar,
        // so the gesture goes to the focused window's renderer — un-collapsing the sidebar first.
        { id: 'menu.file.search', label: 'Search Vault', accelerator: 'CmdOrCtrl+K', click: () => handlers.search() },
        { type: 'separator' },
        // ⌘W is Close Tab (GRO-2232, locked): the renderer owns tab state, so the gesture goes to
        // the focused window's renderer. Close Window moves to ⌘⇧W and keeps `role: 'close'` — the
        // OS close that windows.ts intercepts for the flush handshake.
        { id: 'menu.file.close-tab', label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => handlers.closeTab() },
        { id: 'menu.file.close-window', role: 'close', label: 'Close Window', accelerator: 'CmdOrCtrl+Shift+W' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { id: 'menu.view.toggle-sidebar', label: 'Toggle Sidebar', click: () => handlers.toggleSidebar() },
        { type: 'separator' },
        { role: 'reload' },
        ...(isDev ? [{ role: 'toggleDevTools' } satisfies MenuItemConstructorOptions] : []),
        { type: 'separator' },
        // Not the stock zoom roles (YAZ-1710): a registered accelerator never reaches the page on
        // macOS, so main applies the step to the focused window's webContents itself.
        { id: 'menu.view.zoom-reset', label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => handlers.zoom(0) },
        { id: 'menu.view.zoom-in', label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => handlers.zoom(1) },
        // Electron's own zoomIn role also answers ⌘= (no shift); keep that hidden twin.
        { id: 'menu.view.zoom-in-eq', label: 'Zoom In', accelerator: 'CmdOrCtrl+=', visible: false, click: () => handlers.zoom(1) },
        { id: 'menu.view.zoom-out', label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => handlers.zoom(-1) },
      ],
    },
    // Top-level role `window` marks this submenu as macOS's Windows menu, so the OS appends the window list.
    {
      label: 'Window',
      role: 'window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        // Tab switching (GRO-2232): the visible pair carries the macOS-conventional ⌃Tab / ⌃⇧Tab;
        // hidden duplicates carry the ⌘⇧] / ⌘⇧[ equivalents (`acceleratorWorksWhenHidden`, macOS).
        { id: 'menu.window.next-tab', label: 'Next Tab', accelerator: 'Control+Tab', click: () => handlers.nextTab() },
        { id: 'menu.window.prev-tab', label: 'Previous Tab', accelerator: 'Control+Shift+Tab', click: () => handlers.prevTab() },
        { id: 'menu.window.next-tab-alt', label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', visible: false, acceleratorWorksWhenHidden: true, click: () => handlers.nextTab() },
        { id: 'menu.window.prev-tab-alt', label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', visible: false, acceleratorWorksWhenHidden: true, click: () => handlers.prevTab() },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    { label: 'Help', role: 'help', submenu: [{ id: 'menu.help.github', label: 'Yaseen Draw on GitHub', click: () => handlers.openHelp() }] },
  ]
}

export interface ContextMenuActions {
  /** Swap the misspelled word under the cursor for the suggestion the user picked. */
  replace(word: string): void
  /** Teach the spellchecker a word it flagged, for good. */
  addToDictionary(word: string): void
}

/**
 * The right-click menu (YAZ-672). Electron ships no default one, so the spellchecker's squiggles
 * had nothing to act on. Pure like `buildMenuTemplate`; the `context-menu` event and the
 * `Menu.buildFromTemplate(...).popup()` apply layer live in `main/index.ts`.
 */
export function buildContextMenuTemplate(
  params: Pick<Electron.ContextMenuParams, 'misspelledWord' | 'dictionarySuggestions' | 'editFlags'>,
  actions: ContextMenuActions,
): MenuItemConstructorOptions[] {
  const suggestions: MenuItemConstructorOptions[] = params.dictionarySuggestions.map((s) => ({ label: s, click: () => actions.replace(s) }))
  const dictionary: MenuItemConstructorOptions[] =
    params.misspelledWord === ''
      ? []
      : [
          ...(suggestions.length === 0 ? [] : [{ type: 'separator' } satisfies MenuItemConstructorOptions]),
          { label: 'Add to Dictionary', click: () => actions.addToDictionary(params.misspelledWord) },
          { type: 'separator' },
        ]
  return [
    ...suggestions,
    ...dictionary,
    { role: 'cut', enabled: params.editFlags.canCut },
    { role: 'copy', enabled: params.editFlags.canCopy },
    { role: 'paste', enabled: params.editFlags.canPaste },
  ]
}

/**
 * The window a menu action targets (GRO-2197): the OS-focused one when there is one, else the
 * most recently focused LIVE window, else any live window, else undefined. WHY a fallback at
 * all: macOS reports NO focused window while the app is not frontmost — `getFocusedWindow()`
 * returns null even with a sole visible, unminimized window, and `win.focus()` cannot change
 * that (macOS refuses to activate a background app) — and a menu item that silently does
 * nothing is the worst possible answer. Electron-free and structural on purpose so
 * `menu.test.ts` fakes windows in a few lines; generic so `index.ts` gets `BrowserWindow`
 * back out. `lastFocusedId` is a `webContents.id` (tracked via `browser-window-focus`).
 */
export function pickMenuTargetWindow<W extends { webContents: { id: number }; isDestroyed(): boolean }>(
  focused: W | null,
  all: readonly W[],
  lastFocusedId: number | undefined,
): W | undefined {
  if (focused !== null && !focused.isDestroyed()) return focused
  const live = all.filter((w) => !w.isDestroyed())
  return live.find((w) => w.webContents.id === lastFocusedId) ?? live[0]
}

/** The Electron-only half, injected by `main/index.ts` (like windows.ts's `WindowHost`). */
export interface MenuHost {
  /**
   * The webContents a menu action targets. The fallback IS the contract (GRO-2197): the
   * OS-focused window's when there is one, else the most recently focused live window's, else
   * any live window's — undefined ONLY when no window exists at all. `index.ts` implements
   * this through `pickMenuTargetWindow` (see its comment for why macOS forces the fallback).
   */
  focusedWebContents(): { id: number; send(channel: string, ...args: unknown[]): void } | undefined
  /** App-wide zoom on the focused window: level ± 0.5, or back to 0 (YAZ-1710). */
  zoom(step: ZoomStep): void
  openExternal(url: string): void
}

type MenuWindows = Pick<WindowManager, 'idFor' | 'duplicateWindow' | 'openRecentBeside'>

export function createMenuHandlers(store: Store, windows: MenuWindows, host: MenuHost): MenuHandlers {
  /** The focused window's `AppState.windows` entry (lookup: `webContents.id` → entry id). */
  const focusedEntry = () => {
    const wc = host.focusedWebContents()
    const id = wc === undefined ? undefined : windows.idFor(wc)
    return id === undefined ? undefined : store.get().windows.find((w) => w.id === id)
  }
  return {
    newWindow() {
      const entry = focusedEntry()
      if (entry !== undefined) windows.duplicateWindow(entry)
    },
    switchVault() {
      host.focusedWebContents()?.send(CH.menuSwitchVault)
    },
    openFolder() {
      host.focusedWebContents()?.send(CH.menuOpenFolder)
    },
    openRecent(path, beside) {
      // Beside is the window manager's one open-recent door (YAZ-1767 D1): it probes the directory,
      // prunes a dead one from the MRU, bumps a live one and opens it on its remembered last file.
      if (beside) {
        windows.openRecentBeside(path)
        return
      }
      host.focusedWebContents()?.send(CH.menuOpenRoot, path)
    },
    search() {
      host.focusedWebContents()?.send(CH.menuSearch)
    },
    settings() {
      host.focusedWebContents()?.send(CH.menuSettings)
    },
    closeTab() {
      host.focusedWebContents()?.send(CH.menuCloseTab)
    },
    nextTab() {
      host.focusedWebContents()?.send(CH.menuNextTab)
    },
    prevTab() {
      host.focusedWebContents()?.send(CH.menuPrevTab)
    },
    toggleSidebar() {
      host.focusedWebContents()?.send(CH.menuToggleSidebar)
    },
    zoom(step) {
      host.zoom(step)
    },
    openHelp() {
      host.openExternal(HELP_URL)
    },
  }
}

/**
 * Rebuild only when `recents` actually changed: store snapshots reuse untouched sub-objects,
 * so reference identity of `state.recents` skips every settings/window/folder write for free.
 */
export function subscribeMenuRebuild(store: Store, rebuild: () => void): () => void {
  let last = store.get().recents
  return store.onChange((state) => {
    if (state.recents === last) return
    last = state.recents
    rebuild()
  })
}
