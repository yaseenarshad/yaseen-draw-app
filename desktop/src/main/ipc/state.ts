import type { FolderState } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import { isRecord, isSettings, isStringArray, type Store } from '../store'
import { broadcastAll } from './broadcast'
import { handle } from './envelope'

/** The patch crosses IPC from a sandboxed renderer: only `expanded` / `lastFile` / `topicsExpanded`, each type-checked. */
function requireFolderPatch(raw: unknown): Partial<Pick<FolderState, 'expanded' | 'lastFile' | 'topicsExpanded'>> {
  if (!isRecord(raw)) throw new BridgeFailure('BAD_REQUEST', 'patch must be an object')
  const patch: Partial<Pick<FolderState, 'expanded' | 'lastFile' | 'topicsExpanded'>> = {}
  if (raw.expanded !== undefined) {
    if (!isStringArray(raw.expanded)) throw new BridgeFailure('BAD_REQUEST', "'expanded' must be a string array")
    patch.expanded = raw.expanded
  }
  // The Topics tree's open pages (YAZ-848) ride the SAME patch as the file tree's open dirs —
  // one per-root bucket of paths, one channel, capped by the store on the way in.
  if (raw.topicsExpanded !== undefined) {
    if (!isStringArray(raw.topicsExpanded)) throw new BridgeFailure('BAD_REQUEST', "'topicsExpanded' must be a string array")
    patch.topicsExpanded = raw.topicsExpanded
  }
  if (raw.lastFile !== undefined) {
    if (raw.lastFile !== null && typeof raw.lastFile !== 'string') throw new BridgeFailure('BAD_REQUEST', "'lastFile' must be a string or null")
    patch.lastFile = raw.lastFile
  }
  return patch
}

/** The `state.*` half of `window.yaseenDocs` over the main-owned store (GRO-2159). */
export function registerStateIpc(store: Store): void {
  handle(CH.stateGet, async () => store.get())
  handle(CH.stateSetSettings, async (settings: unknown) => {
    if (!isSettings(settings)) throw new BridgeFailure('BAD_REQUEST', "'settings' must be a complete SettingsState")
    store.setSettings(settings)
  })
  handle(CH.stateSetSidebarWidth, async (width: unknown) => {
    if (typeof width !== 'number' || !Number.isFinite(width)) throw new BridgeFailure('BAD_REQUEST', "'width' must be a finite number")
    store.setSidebarWidth(width)
  })
  handle(CH.statePushRecent, async (path: unknown) => {
    store.pushRecent(requireAbsPath(path, 'path'))
  })
  handle(CH.stateRemoveRecent, async (path: unknown) => {
    store.removeRecent(requireAbsPath(path, 'path'))
  })
  handle(CH.stateSetFolder, async (root: unknown, patch: unknown) => {
    store.setFolder(requireAbsPath(root, 'root'), requireFolderPatch(patch))
  })
  handle(CH.stateSetFolds, async (root: unknown, file: unknown, keys: unknown) => {
    const r = requireAbsPath(root, 'root')
    const f = requireAbsPath(file, 'file')
    if (!isStringArray(keys)) throw new BridgeFailure('BAD_REQUEST', "'keys' must be a string array")
    store.setFolds(r, f, keys)
  })
  handle(CH.stateSetBaseGroups, async (root: unknown, key: unknown, collapsed: unknown) => {
    const r = requireAbsPath(root, 'root')
    if (typeof key !== 'string' || key === '') throw new BridgeFailure('BAD_REQUEST', "'key' must be a non-empty string")
    if (!isStringArray(collapsed)) throw new BridgeFailure('BAD_REQUEST', "'collapsed' must be a string array")
    store.setBaseGroups(r, key, collapsed)
  })
  // Every live window gets the new state (`state.onChange` in the renderer), whichever window changed it.
  store.onChange((state) => broadcastAll(CH.stateChanged, state))
}
