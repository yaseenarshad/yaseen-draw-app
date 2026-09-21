import { BrowserWindow } from 'electron'
import type { AppState, PropertiesResponse } from '@shared/types'
import { CH } from '../../channels'
import { getProperties, removeProperty, setProperty, subscribeProperties } from '../properties'
import type { Store } from '../store'
import { handle } from './envelope'

/** Main's own properties subscription per open-vault root; dropped when the last window on that root goes. */
const subs = new Map<string, () => void>()

/** Every live window gets the fresh declarations; renderers filter by their own root (the `state:changed` posture). */
function broadcast(properties: PropertiesResponse): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(CH.propertiesChanged, { root: properties.root, properties })
  }
}

/** The open-vault roots are `AppState.windows` (null = Welcome); one `subscribeProperties` each, no more. */
function syncSubscriptions(state: AppState): void {
  const roots = new Set(state.windows.map((w) => w.root).filter((r): r is string => r !== null))
  for (const [root, off] of subs) {
    if (!roots.has(root)) {
      off()
      subs.delete(root)
    }
  }
  for (const root of roots) {
    if (!subs.has(root)) subs.set(root, subscribeProperties(root, broadcast))
  }
}

/** The `properties.*` half of `window.yaseenDocs` (YAZ-835). */
export function registerPropertiesIpc(store: Store): void {
  handle(CH.propertiesGet, getProperties)
  handle(CH.propertiesSetProperty, setProperty)
  handle(CH.propertiesRemoveProperty, removeProperty)
  store.onChange(syncSubscriptions)
  syncSubscriptions(store.get())
}
