import path from 'node:path'
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import { MAX_DRAWING_BYTES, type OpenDrawingResponse, type PickFolderResponse, type SaveDrawingRequest, type SaveDrawingResponse } from '@shared/types'
import { CH } from '../../channels'
import { readBoundedRegularFile } from '../fs/boundedRead'
import { atomicWrite, BridgeFailure, fsCall, requireDrawingFile } from '../fs/fsUtils'
import { isRecord } from '../store'
import { handleWithEvent } from './envelope'

const OPTIONS: Electron.OpenDialogOptions = { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] }

/** The import picker (YAZ-1833): one file, `.excalidraw` only, so the filter says what the door takes. */
const OPEN_FILE_OPTIONS: Electron.OpenDialogOptions = {
  title: 'Import Excalidraw JSON',
  properties: ['openFile'],
  filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
}

/** The export sheet (🔒 D3, YAZ-1821): one file, the extension it is getting, and no directory picking. */
const SAVE_FILE_OPTIONS: Omit<Electron.SaveDialogOptions, 'defaultPath'> = {
  title: 'Export Drawing',
  filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
  properties: ['createDirectory', 'showOverwriteConfirmation'],
}

const TOO_LARGE = `drawing exceeds ${MAX_DRAWING_BYTES} bytes`

/**
 * ONE DIALOG IN FLIGHT PER WINDOW, shared by every dialog this module opens (`inFlight`; windowless
 * senders share the `null` bucket): a second call while that window has a sheet up resolves
 * `{ cancelled: true }` — a benign no-op for the renderer, same as dismissing it — rather than
 * stacking another sheet or rejecting. Answers null when the guard refused, else the dialog result.
 */
async function showOnce<T>(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, show: (win: BrowserWindow | null) => Promise<T>): Promise<T | null> {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (inFlight.has(win)) return null
  inFlight.add(win)
  try {
    return await show(win)
  } catch (err) {
    throw new BridgeFailure('PICKER_FAILED', err instanceof Error ? err.message : String(err))
  } finally {
    inFlight.delete(win)
  }
}

const openDialog = (options: Electron.OpenDialogOptions) => (win: BrowserWindow | null) => (win === null ? dialog.showOpenDialog(options) : dialog.showOpenDialog(win, options))
const saveDialog = (options: Electron.SaveDialogOptions) => (win: BrowserWindow | null) => (win === null ? dialog.showSaveDialog(options) : dialog.showSaveDialog(win, options))

/** `window.yaseenDraw.pickFolder()`: the native open-directory dialog, parented to the calling window. */
export async function pickFolder(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>): Promise<PickFolderResponse> {
  const result = await showOnce(e, inFlight, openDialog(OPTIONS))
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
  const result = await showOnce(e, inFlight, openDialog(OPEN_FILE_OPTIONS))
  if (result === null) return { cancelled: true }
  const picked = result.filePaths[0]
  if (result.canceled || picked === undefined) return { cancelled: true }
  const file = path.resolve(picked)
  requireDrawingFile(file)
  const snapshot = await fsCall(file, () => readBoundedRegularFile(file, MAX_DRAWING_BYTES, TOO_LARGE))
  return { path: file, name: path.basename(file, path.extname(file)), content: snapshot.data.toString('utf8') }
}

function requireSaveRequest(v: unknown): SaveDrawingRequest {
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
  const { defaultName, content } = v
  if (typeof defaultName !== 'string' || defaultName === '') throw new BridgeFailure('BAD_REQUEST', "'defaultName' must be a non-empty string")
  if (typeof content !== 'string' || content === '') throw new BridgeFailure('BAD_REQUEST', "'content' must be a non-empty string")
  return { defaultName, content }
}

/**
 * `window.yaseenDraw.dialog.saveDrawing(req)` (🔒 D3, YAZ-1821): the export sheet, then the write.
 *
 * ONE DOOR, not "pick a path, then write it". A renderer holding an arbitrary absolute path it may
 * write to is exactly what the fs layer's root-relative rules exist to prevent; here the only path
 * ever written is the one the user has just typed into a native sheet, in the same call. The write
 * is the app's own `atomicWrite` (tmp + rename), so a crash mid-export cannot leave a half file,
 * and the `.excalidraw` extension is enforced because a sheet lets a name be typed freely.
 *
 * THE VAULT FILE IS NOT TOUCHED. An export reads nothing from the vault and writes nothing into
 * it; the bytes come from the renderer, which assembled them from the live canvas.
 */
export async function saveDrawingFile(e: IpcMainInvokeEvent, inFlight: Set<BrowserWindow | null>, body: unknown): Promise<SaveDrawingResponse> {
  const req = requireSaveRequest(body)
  const result = await showOnce(e, inFlight, saveDialog({ ...SAVE_FILE_OPTIONS, defaultPath: req.defaultName }))
  if (result === null) return { cancelled: true }
  const picked = result.filePath
  if (result.canceled || picked === undefined || picked === '') return { cancelled: true }
  const file = path.resolve(picked)
  requireDrawingFile(file)
  await fsCall(file, () => atomicWrite(file, req.content))
  return { path: file }
}

export function registerDialogIpc(): void {
  const inFlight = new Set<BrowserWindow | null>()
  handleWithEvent(CH.dialogPickFolder, (e) => pickFolder(e, inFlight))
  handleWithEvent(CH.dialogOpenFile, (e) => openDrawingFile(e, inFlight))
  handleWithEvent(CH.dialogSaveFile, (e, body: unknown) => saveDrawingFile(e, inFlight, body))
}
