import {
  MAX_COLLAPSED_GROUP_KEYS,
  MAX_FOLD_KEYS_PER_FILE,
  MAX_TOPICS_EXPANDED_PAGES,
  addRecentRoot,
  defaultAppState,
  defaultFolderState,
  defaultRightPanelIdentity,
  type AppState,
  type FolderState,
  type RecentRoots,
  type RightPanelIdentity,
  type SettingsState,
  type SidebarLens,
  type WindowIdentity,
} from '@shared/types'

/**
 * The renderer's view of the app state (D9, GRO-2159): an in-memory cache of the main-owned
 * `yaseendocs.json` plus this window's identity. `init()` loads both over the bridge and
 * subscribes to `state.onChange`, so a change made in any window replaces the cache here and
 * wakes `subscribe` listeners. Reads are synchronous off the cache; writes update the cache at
 * once (optimistic) and send the targeted mutator over the bridge, fire-and-forget.
 */

let state: AppState = defaultAppState()
let identity: WindowIdentity = { id: '', root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [] }
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

/** Issues one bridge call at once without awaiting it; a rejection (or a missing bridge) is logged, never thrown. */
function send(what: string, call: () => Promise<void>): void {
  const log = (err: unknown) => console.error(`[storage] ${what} failed:`, err)
  try {
    call().catch(log)
  } catch (err) {
    log(err)
  }
}

function folderOf(root: string): FolderState {
  return state.folders[root] ?? defaultFolderState()
}

function patchFolder(root: string, patch: Partial<FolderState>): void {
  state = { ...state, folders: { ...state.folders, [root]: { ...folderOf(root), ...patch } } }
}

export const storage = {
  /** Load the state + identity and start following changes; call once before the first render. */
  async init(): Promise<void> {
    const bridge = window.yaseenDocs
    const [s, id] = await Promise.all([bridge.state.get(), bridge.window.identity()])
    state = s
    identity = id
    unsubscribe?.()
    unsubscribe = bridge.state.onChange((next) => {
      state = next
      listeners.forEach((l) => l())
    })
  },

  /** Called after a change made in ANY window landed in the cache (never for this window's own optimistic writes). */
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  getRoot: (): string | null => identity.root,
  /**
   * Changing the root clears this window's file AND tab list (Tabs rule 13, GRO-2234) and all
   * three Focus Mode lists (YAZ-1628, YAZ-1766) in the same write; re-setting the same root keeps them.
   */
  setRoot(root: string | null): void {
    const patch = root === identity.root
      ? { root }
      : { root, file: null, tabs: [] as string[], rightPanel: defaultRightPanelIdentity(), focusDirs: [] as string[], focusTopics: [] as string[], focusFavorites: [] as string[] }
    identity = { ...identity, ...patch }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity(patch))
  },

  getRecentRoots: (): RecentRoots => state.recents,
  pushRecentRoot(path: string, now = Date.now()): RecentRoots {
    const next = addRecentRoot(state.recents, path, now)
    state = { ...state, recents: next }
    send('state.pushRecent', () => window.yaseenDocs.state.pushRecent(path))
    return next
  },

  /** Drop a dead folder from the MRU (its directory vanished on disk, C2 — GRO-2164). */
  removeRecentRoot(path: string): void {
    state = { ...state, recents: state.recents.filter((r) => r.path !== path) }
    send('state.removeRecent', () => window.yaseenDocs.state.removeRecent(path))
  },

  getExpanded: (root: string): string[] => folderOf(root).expanded,
  setExpanded(root: string, dirs: string[]): void {
    patchFolder(root, { expanded: dirs })
    send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { expanded: dirs }))
  },

  /**
   * The Topics tree's expanded folder pages (🔒 D4, YAZ-848) — PAGE PATHS, not tree positions,
   * so a page under two folder pages is one entry and opens under both. `expanded`'s twin in
   * every way: same per-root bucket, same `setFolder` patch, same path-keyed repair in
   * `store.renamePath` / `store.removePath`.
   */
  getTopicsExpanded: (root: string): string[] => folderOf(root).topicsExpanded,
  setTopicsExpanded(root: string, pages: readonly string[]): void {
    const topicsExpanded = pages.slice(0, MAX_TOPICS_EXPANDED_PAGES)
    patchFolder(root, { topicsExpanded })
    send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { topicsExpanded }))
  },

  /**
   * Focus Mode (YAZ-1605): a path list per lens, empty when off. Window identity since YAZ-1628,
   * like `sidebarCollapsed` below — no root argument, and a global state broadcast never follows
   * another window's focus into this one; a root change clears both lists (`setRoot`).
   */
  getFocusDirs: (): string[] => identity.focusDirs,
  setFocusDirs(dirs: readonly string[]): void {
    const focusDirs = [...dirs]
    identity = { ...identity, focusDirs }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ focusDirs }))
  },
  getFocusTopics: (): string[] => identity.focusTopics,
  setFocusTopics(pages: readonly string[]): void {
    const focusTopics = [...pages]
    identity = { ...identity, focusTopics }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ focusTopics }))
  },
  /** The Favorites tab's own focus list (YAZ-1766 D5): the favorited dirs it is narrowed to. */
  getFocusFavorites: (): string[] => identity.focusFavorites,
  setFocusFavorites(dirs: readonly string[]): void {
    const focusFavorites = [...dirs]
    identity = { ...identity, focusFavorites }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ focusFavorites }))
  },

  /** The window identity records what is open now: THIS window's restored file, not the folder's shared lastFile (GRO-2160). */
  getFile: (): string | null => identity.file,

  /** Valid AT BOOT only (like `getFile`): the renderer owns tab state after boot (Tabs I2, GRO-2234). */
  getTabs: (): string[] => identity.tabs,

  /** Durable right-panel identity at boot; clone the ordered list so callers cannot mutate the cache. */
  getRightPanel: (): RightPanelIdentity => ({ ...identity.rightPanel, items: [...identity.rightPanel.items] }),

  getLastFile: (root: string): string | null => folderOf(root).lastFile,

  /** One durable mirror for the complete main/right workspace identity. */
  setWorkspace(root: string | null, tabs: readonly string[], file: string | null, rightPanel: RightPanelIdentity): void {
    const fileChanged = file !== identity.file
    const nextRight = { ...rightPanel, items: [...rightPanel.items] }
    identity = { ...identity, file, tabs: [...tabs], rightPanel: nextRight }
    if (root !== null && fileChanged) {
      patchFolder(root, { lastFile: file })
      send('state.setFolder', () => window.yaseenDocs.state.setFolder(root, { lastFile: file }))
    }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({
      tabs: [...tabs],
      file,
      rightPanel: { ...nextRight, items: [...nextRight.items] },
    }))
  },

  /** Already validated field-by-field by the main process on load (`desktop/src/main/store.ts`). */
  getSettings: (): SettingsState => state.settings,
  setSettings(settings: SettingsState): void {
    state = { ...state, settings }
    send('state.setSettings', () => window.yaseenDocs.state.setSettings(settings))
  },

  /** Sidebar visibility is window identity; global state broadcasts cannot change another window. */
  getSidebarCollapsed: (): boolean => identity.sidebarCollapsed,
  setSidebarCollapsed(collapsed: boolean): void {
    identity = { ...identity, sidebarCollapsed: collapsed }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ sidebarCollapsed: collapsed }))
  },

  /** Already clamped to [SIDEBAR_MIN_W, SIDEBAR_MAX_W] by the main process on load and on write. */
  getSidebarWidth: (): number => state.sidebarWidth,
  setSidebarWidth(width: number): void {
    state = { ...state, sidebarWidth: width }
    send('state.setSidebarWidth', () => window.yaseenDocs.state.setSidebarWidth(width))
  },

  /**
   * The active sidebar lens (YAZ-847): chrome, not per-folder view state, so no root argument
   * and no `FolderState` entry. Window identity since YAZ-1628, like `sidebarCollapsed` above —
   * another window's switch never lands here through a state broadcast, and a root change
   * keeps it (`setRoot` leaves it alone).
   */
  getSidebarLens: (): SidebarLens => identity.sidebarLens,
  setSidebarLens(lens: SidebarLens): void {
    identity = { ...identity, sidebarLens: lens }
    send('window.setIdentity', () => window.yaseenDocs.window.setIdentity({ sidebarLens: lens }))
  },

  getFolds: (root: string, file: string): string[] => folderOf(root).folds[file] ?? [],
  /** Replace the fold keys for one file; an empty list removes the entry (keys the plugin no longer reports are dropped). */
  setFolds(root: string, file: string, keys: readonly string[]): void {
    const folds = { ...folderOf(root).folds }
    if (keys.length === 0) delete folds[file]
    else folds[file] = keys.slice(0, MAX_FOLD_KEYS_PER_FILE)
    patchFolder(root, { folds })
    send('state.setFolds', () => window.yaseenDocs.state.setFolds(root, file, keys))
  },

  /**
   * Collapsed group keys for one view; `key` is `<pagePath>::<viewName>` (4C, GRO-2137).
   *
   * HISTORICAL NAMES (🔒 D1 of YAZ-823, kept deliberately by YAZ-858's rename): the STORED field
   * is still `baseGroups` and the bridge method / IPC channel are still `state.setBaseGroups` /
   * `state:set-base-groups`. Renaming them would either orphan every user's persisted collapse
   * state or need a migration, and would break the preload/main contract — so `shared/types.ts`'s
   * `AppState` field, `store.ts`'s mutator and the channel all keep the old spelling on purpose.
   * Only these two client accessors were renamed; the wire below is untouched.
   */
  getViewGroups: (root: string, key: string): string[] => folderOf(root).baseGroups[key] ?? [],
  /** Replace the collapsed group keys for one view; an empty list removes the entry. Session chrome, never written to the page's own frontmatter. */
  setViewGroups(root: string, key: string, collapsed: readonly string[]): void {
    const baseGroups = { ...folderOf(root).baseGroups }
    if (collapsed.length === 0) delete baseGroups[key]
    else baseGroups[key] = collapsed.slice(0, MAX_COLLAPSED_GROUP_KEYS)
    patchFolder(root, { baseGroups })
    send('state.setBaseGroups', () => window.yaseenDocs.state.setBaseGroups(root, key, collapsed))
  },
}
