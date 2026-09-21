import type { BridgeError } from '@shared/types'

/** IPC channel names shared by main and preload. One place, so a typo cannot split them. */
export const CH = {
  fsTree: 'fs:tree',
  fsRead: 'fs:read',
  fsWrite: 'fs:write',
  fsCreateDir: 'fs:create-dir',
  fsCreateFile: 'fs:create-file',
  // The drawing DOCUMENT's two doors (🔒 YAZ-1810) — one per direction, because a scene and the
  // bytes it names are ONE thing: a load is "the scene, then its images", a save is "the images,
  // then the scene", and splitting either would let a renderer land half of it.
  drawingLoad: 'drawing:load',
  drawingSave: 'drawing:save',
  fsRename: 'fs:rename',
  fsDelete: 'fs:delete',
  fsClip: 'fs:clip',
  fsPaste: 'fs:paste',
  fsClipState: 'fs:clip-state',
  fileRenamed: 'file:renamed',
  fileDeleted: 'file:deleted',
  clipChanged: 'clip:changed',
  shellReveal: 'shell:reveal',
  shellOpenVsCode: 'shell:openVsCode',
  shellOpenDefault: 'shell:openDefault',
  shellOpenLink: 'shell:open-link',
  dialogPickFolder: 'dialog:pick-folder',
  watchSubscribe: 'watch:subscribe',
  watchUnsubscribe: 'watch:unsubscribe',
  watchEvent: 'watch:event',
  stateGet: 'state:get',
  stateSetSettings: 'state:set-settings',
  stateSetSidebarWidth: 'state:set-sidebar-width',
  statePushRecent: 'state:push-recent',
  stateRemoveRecent: 'state:remove-recent',
  stateSetFolder: 'state:set-folder',
  stateChanged: 'state:changed',
  windowIdentity: 'window:identity',
  windowSetIdentity: 'window:set-identity',
  windowOpen: 'window:open',
  windowDuplicate: 'window:duplicate',
  windowOpenRecent: 'window:open-recent',
  windowCloseSelf: 'window:close-self',
  windowZoom: 'window:zoom',
  menuOpenFolder: 'menu:open-folder',
  menuOpenRoot: 'menu:open-root',
  menuSearch: 'menu:search',
  menuSwitchVault: 'menu:switch-vault',
  menuSettings: 'menu:settings',
  menuToggleSidebar: 'menu:toggle-sidebar',
  menuCloseTab: 'menu:close-tab',
  menuNextTab: 'menu:next-tab',
  menuPrevTab: 'menu:prev-tab',
  // The two canvas gestures that left the engine's own menu (🔒 D10): they reach the focused
  // window's renderer, which routes them to the VISIBLE drawing layer.
  menuExportImage: 'menu:export-image',
  menuCanvasBackground: 'menu:canvas-background',
  linkOpenFile: 'link:open-file',
  linkNotice: 'link:notice',
  vaultConfigRead: 'vaultConfig:read',
  vaultConfigWrite: 'vaultConfig:write',
  vaultConfigChanged: 'vaultConfig:changed',
  favoritesGet: 'favorites:get',
  favoritesSet: 'favorites:set',
  favoritesChanged: 'favorites:changed',
  githubStatus: 'github:status',
  githubSyncNow: 'github:sync-now',
  githubSetEnabled: 'github:set-enabled',
  githubStatusChanged: 'github:status-changed',
  appFlush: 'app:flush',
  appFlushed: 'app:flushed',
} as const

/**
 * Every `ipcMain.handle` answers with an envelope: Electron serialises a thrown Error down to
 * its message, so a structured `BridgeError` must travel as data. The preload unwraps it.
 */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: BridgeError }
