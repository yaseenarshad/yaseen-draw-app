import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { MAX_DRAWING_BYTES, type OpenDrawingResponse, type PickFolderResponse } from '@shared/types'
import { CH } from '../../channels'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { BridgeFailure, fsCall, requireDrawingFile } from '../fs/fsUtils'
import { handleWithEvent } from './envelope'

const OPTIONS: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }

/** The import picker (YAZ-1833): one file, `.excalidraw` only, so the filter says what the door takes. */
const OPEN_FILE_OPTIONS: Electron.OpenDialogOptions = {
  title: 'Import Excalidraw JSON',
  properties: ['openFile'],
  filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
}

const TOO_LARGE = `drawing exceeds ${MAX_DRAWING_BYTES} bytes`

/**
 * ONE DIALOG IN FLIGHT PER WINDOW, shared by every dialog this module opens (`inFlight`; windowless
 * senders share the `null` bucket): a second call while that window has a sheet up resolves
 * `{ cancelled: true }` — a benign no-op for the renderer, same as dismissing it — rather than
 * stacking another sheet or rejecting. Answers null when the guard refused, else the dialog result.
 */
async function showOnce(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return null
  inFlight.add(win)
  try {
    return await (win === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(win, options))
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
}

/** `window.yaseenDraw.pickFolder()`: the native open-directory dialog, parented to the calling window. */
export async function pickFolder(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<PickFolderResponse> {
  const result = await showOnce(e, inFlight, OPTIONS)
  if (result === null) return { cancelled: true }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  return { path: picked.replace(/\/+$/, '') || '/' }
}

/**
 * `window.yaseenDraw.dialog.openDrawing()` (YAZ-1833): pick one `.excalidraw` and get its bytes.
 *
 * The bytes come back with the path because the picked file lives OUTSIDE the vault and nothing
 * else on the bridge reads an arbitrary absolute path — opening such a door for one button would
 * be a far bigger change than reading the file the user has just pointed at. The read is bounded
 * by `MAX_DRAWING_BYTES`, the same ceiling `drawing:load` uses, because an imported scene may be a
 * legacy board that still embeds its images; a picked file that is not a `.excalidraw` (a filter
 * can be defeated by typing a name) is `UNSUPPORTED_EXTENSION`.
 */
export async function openDrawingFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<OpenDrawingResponse> {
  const result = await showOnce(e, inFlight, OPEN_FILE_OPTIONS)
  if (result === null) return { cancelled: true }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  const file = path.resolve(picked)
  requireDrawingFile(file)
  const snapshot = await fsCall(file, () => readBoundedRegularFile(file, MAX_DRAWING_BYTES, TOO_LARGE))
  return { path: file, name: path.basename(file, path.extname(file)), content: snapshot.data.toString('utf8') }
}

export function registerDialogIpc(): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CH.dialogPickFolder, (e) => pickFolder(e, inFlight))
  handleWithEvent(CH.dialogOpenFile, (e) => openDrawingFile(e, inFlight))
}
