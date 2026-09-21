import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type { PickFolderResponse } from '@shared/types'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import { handleWithEvent } from './envelope'

const OPTIONS: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }

/**
 * `window.yaseenDocs.pickFolder()`: the native open-directory dialog, parented to the calling window.
 * One dialog in flight per window (`inFlight`; windowless senders share the `null` bucket): a second
 * call while that window's dialog is open resolves `{ cancelled: true }` — a benign no-op for the
 * renderer, same as dismissing the dialog — rather than stacking another sheet or rejecting.
 */
export async function pickFolder(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<PickFolderResponse> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return { cancelled: true }
  inFlight.add(win)
  let result: Electron.OpenDialogReturnValue
  try {
    result = await (win === null ? dialog.showOpenDialog(OPTIONS) : dialog.showOpenDialog(win, OPTIONS))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  return { path: picked.replace(/\/+$/, '') || '/' }
}

export function registerDialogIpc(): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CH.dialogPickFolder, (e) => pickFolder(e, inFlight))
}
