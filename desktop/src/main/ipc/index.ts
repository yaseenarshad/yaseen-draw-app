import type { GitSyncManager } from '../git/manager'
import type { Store } from '../store'
import type { WindowManagerIpc } from '../windows'
import { registerDialogIpc } from './dialog'
import { registerDrawingIpc } from './drawing'
import { registerFavoritesIpc } from './favorites'
import { registerFsIpc } from './fs'
import { registerGithubIpc } from './github'
import { registerStateIpc } from './state'
import { registerVaultConfigIpc } from './vaultConfig'
import { registerWatchIpc } from './watch'
import { registerWindowIpc } from './window'

/**
 * Every `ipcMain` handler the preload's bridge invokes; call once before the first window loads.
 *
 * Returns the GitHub sync manager (YAZ-1081, 2C) — the one registration with triggers no renderer
 * can send (window focus, OS wake, the last flush before quit), which `main/index.ts` owns.
 */
export function registerIpc(store: Store, windows: WindowManagerIpc): GitSyncManager {
  registerFsIpc(store, windows)
  registerDrawingIpc()
  registerDialogIpc()
  registerWatchIpc()
  registerStateIpc(store)
  registerVaultConfigIpc(store)
  registerFavoritesIpc(store)
  registerWindowIpc(store, windows)
  return registerGithubIpc(store)
}
