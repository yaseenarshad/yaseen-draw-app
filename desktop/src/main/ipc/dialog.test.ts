import { beforeEach, describe, expect, it, vi } from 'vitest'
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

describe('dialog:pick-folder', () => {
  it('registers exactly the pick-folder channel', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).toEqual([CH.dialogPickFolder])
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
