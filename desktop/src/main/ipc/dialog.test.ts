import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { registerDialogIpc } from './dialog'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const showOpenDialog = vi.mocked(dialog.showOpenDialog)
const fromWebContents = vi.mocked(BrowserWindow.fromWebContents)
const sender = { id: 1 }

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  showOpenDialog.mockReset()
  fromWebContents.mockReset().mockReturnValue(null)
  registerDialogIpc()
})

const pick = () => registered(CH.dialogPickFolder)({ sender })
const open = () => registered(CH.dialogOpenFile)({ sender })

describe('dialog:pick-folder', () => {
  it('registers exactly the two dialog channels', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).toEqual([CH.dialogPickFolder, CH.dialogOpenFile])
  })

  it('opens an openDirectory dialog parented to the calling window and answers { path }', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    expect(fromWebContents).toHaveBeenCalledWith(sender)
    expect(showOpenDialog).toHaveBeenCalledWith(win, { title: 'Open folder', properties: ['openDirectory', 'createDirectory'] })
  })

  it('falls back to an unparented dialog when the sender has no window', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    expect(showOpenDialog).toHaveBeenCalledWith({ title: 'Open folder', properties: ['openDirectory', 'createDirectory'] })
  })

  it('answers { cancelled: true } when the dialog is dismissed or returns no path', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
  })

  it('strips trailing slashes from the picked path, except for the filesystem root', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/vault//'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/' } })
  })

  it('a dialog failure comes out as PICKER_FAILED', async () => {
    showOpenDialog.mockRejectedValue(new Error('no display'))
    expect(await pick()).toEqual({ ok: false, error: { code: 'PICKER_FAILED', message: 'no display' } })
  })
})

describe('one dialog in flight per window', () => {
  /** A dialog the test settles by hand, so a pick can be held open mid-flight. */
  function pendingDialog() {
    let settle!: (v: Electron.OpenDialogReturnValue) => void
    showOpenDialog.mockReturnValueOnce(
      new Promise<Electron.OpenDialogReturnValue>((r) => {
        settle = r
      }),
    )
    return { settle }
  }

  it('a second call while a dialog is open for the window resolves { cancelled: true }; the guard lifts when it settles', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    const { settle } = pendingDialog()
    const first = pick()
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await first).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/other'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/other' } })
  })

  it('windows are guarded independently — a dialog open for one does not block another', async () => {
    const a = { id: 'a' } as unknown as BrowserWindow
    const b = { id: 'b' } as unknown as BrowserWindow
    fromWebContents.mockReturnValueOnce(a).mockReturnValueOnce(b)
    const heldA = pendingDialog()
    const heldB = pendingDialog()
    const pickA = pick()
    const pickB = pick()
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
    heldA.settle({ canceled: false, filePaths: ['/vault/a'] })
    heldB.settle({ canceled: false, filePaths: ['/vault/b'] })
    expect(await pickA).toEqual({ ok: true, value: { path: '/vault/a' } })
    expect(await pickB).toEqual({ ok: true, value: { path: '/vault/b' } })
  })

  it('windowless senders share one guard bucket', async () => {
    const { settle } = pendingDialog()
    const first = pick()
    expect(await pick()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: true, filePaths: [] })
    expect(await first).toEqual({ ok: true, value: { cancelled: true } })
  })

  it('the guard lifts on dialog failure too', async () => {
    showOpenDialog.mockRejectedValueOnce(new Error('no display'))
    expect(await pick()).toEqual({ ok: false, error: { code: 'PICKER_FAILED', message: 'no display' } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/x/vault'] })
    expect(await pick()).toEqual({ ok: true, value: { path: '/Users/x/vault' } })
  })
})


/**
 * The import picker (YAZ-1833). It answers the picked file's BYTES, so these run against a real
 * temp file — the read is the door's own, not a mock's.
 */
describe('dialog:open-file', () => {
  let dir = ''
  const made: string[] = []
  const file = async (name: string, content: string) => {
    if (dir === '') {
      dir = await mkdtemp(path.join(tmpdir(), 'yd-dialog-'))
      made.push(dir)
    }
    const p = path.join(dir, name)
    await writeFile(p, content, 'utf8')
    return p
  }
  afterAll(async () => {
    for (const d of made) await rm(d, { recursive: true, force: true })
  })

  it('opens an openFile dialog filtered to .excalidraw, parented to the calling window', async () => {
    const win = { id: 'w' } as unknown as BrowserWindow
    fromWebContents.mockReturnValue(win)
    const picked = await file('03 Legacy embedded.excalidraw', '{"type":"excalidraw","elements":[]}')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] })
    expect(await open()).toEqual({
      ok: true,
      value: { path: picked, name: '03 Legacy embedded', content: '{"type":"excalidraw","elements":[]}' },
    })
    expect(showOpenDialog).toHaveBeenCalledWith(win, {
      title: 'Import Excalidraw JSON',
      properties: ['openFile'],
      filters: [{ name: 'Excalidraw', extensions: ['excalidraw'] }],
    })
  })

  it('answers { cancelled: true } when the dialog is dismissed or returns no path', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await open()).toEqual({ ok: true, value: { cancelled: true } })
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await open()).toEqual({ ok: true, value: { cancelled: true } })
  })

  it('a filter can be defeated by typing a name, so the extension is checked again', async () => {
    const picked = await file('notes.txt', 'hello')
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [picked] })
    expect(await open()).toEqual({ ok: false, error: { code: 'UNSUPPORTED_EXTENSION', message: 'only .excalidraw files are editable', path: picked } })
  })

  it('a file that has gone between the pick and the read is NOT_FOUND, never a crash', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path.join(tmpdir(), 'yd-dialog-missing', 'gone.excalidraw')] })
    const answer = (await open()) as { ok: false; error: { code: string } }
    expect(answer.ok).toBe(false)
    expect(answer.error.code).toBe('NOT_FOUND')
  })

  it('shares the one-dialog-in-flight guard with the folder picker', async () => {
    let settle!: (v: Electron.OpenDialogReturnValue) => void
    showOpenDialog.mockReturnValueOnce(
      new Promise<Electron.OpenDialogReturnValue>((r) => {
        settle = r
      }),
    )
    const first = pick()
    expect(await open()).toEqual({ ok: true, value: { cancelled: true } })
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
    settle({ canceled: true, filePaths: [] })
    expect(await first).toEqual({ ok: true, value: { cancelled: true } })
  })
})
