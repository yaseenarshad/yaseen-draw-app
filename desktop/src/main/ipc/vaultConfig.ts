import type { AppState, VaultConfigChange } from '@shared/types'
import { CH } from '../../channels'
import type { Store } from '../store'
import { readConfig, subscribeConfig, writeConfig } from '../vaultConfig'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** Main's own subscription per open-vault root; dropped when the last window on that root goes. */
const subs = new Map<string, () => void>()

/** Every live window gets the change; renderers filter by their own root (same posture as `state:changed`). */
const broadcast = (change: VaultConfigChange): void => broadcastAll(CH.vaultConfigChanged, change)

/** The open-vault roots are `AppState.windows` (null = Welcome); one `subscribeConfig` each, no more. */
function syncSubscriptions(state: AppState): void {
  const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
  for (const [root, off] of subs) {
    if (!roots.has(root)) {
      off()
      subs.delete(root)
    }
  }
  for (const root of roots) {
    if (!subs.has(root)) subs.set(root, subscribeConfig(root, broadcast))
  }
}

/** The `vaultConfig.*` half of `window.yaseenDraw` (Desktop J, GRO-2188). */
export function registerVaultConfigIpc(store: Store): void {
  handle(CH.vaultConfigRead, readConfig)
  handle(CH.vaultConfigWrite, writeConfig)
  store.onChange(syncSubscriptions)
  syncSubscriptions(store.get())
}
