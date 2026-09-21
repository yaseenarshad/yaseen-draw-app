import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { registerClipboardIpc, MAX_COPY_TEXT_LENGTH } from './clipboard'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const frame = { url: 'app://yaseen/index.html?win=w1' }
const sender = { id: 1, mainFrame: frame, isDestroyed: () => false }
const event = { sender, senderFrame: frame }
let target: { id: number } | undefined
let formats: Record<string, string>
const writeText = vi.fn((text: string) => { formats = { 'text/plain': text } })
const invoke = (event: unknown, ...args: unknown[]) => {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === CH.menuCopyText)?.[1]
  return (handler as unknown as (event: unknown, ...args: unknown[]) => Promise<Envelope<void>>)(event, ...args)
}
const bad = { ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST' }) }

beforeEach(() => {
  vi.mocked(ipcMain.handle).mockClear()
  writeText.mockClear()
  target = sender
  formats = { 'text/plain': 'old', 'text/html': '<b>old</b>' }
  registerClipboardIpc({ idFor: (wc) => wc.id === 1 ? 'w1' : undefined }, {
    target: () => target,
    writeText,
    rendererUrl: 'app://yaseen/index.html',
  })
})

describe('private explicit copy IPC', () => {
  it('writes selected text only, replacing previous rich clipboard formats', async () => {
    expect(await invoke(event, '# literal\ntext')).toEqual({ ok: true, value: undefined })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('# literal\ntext')
    expect(formats).toEqual({ 'text/plain': '# literal\ntext' })
  })

  it('leaves the clipboard intact for an empty selection', async () => {
    expect(await invoke(event, '')).toEqual({ ok: true, value: undefined })
    expect(writeText).not.toHaveBeenCalled()
    expect(formats['text/html']).toBe('<b>old</b>')
  })

  it('rejects unknown, destroyed, or no longer targeted senders and subframes', async () => {
    expect(await invoke({ ...event, sender: { ...sender, id: 9 } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, sender: { ...sender, isDestroyed: () => true } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, senderFrame: { ...frame } }, 'text')).toEqual(bad)
    expect(await invoke({ ...event, senderFrame: null }, 'text')).toEqual(bad)
    target = { id: 2 }
    expect(await invoke(event, 'text')).toEqual(bad)
    target = undefined
    expect(await invoke(event, 'text')).toEqual(bad)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('rejects a registered window navigated away from the configured renderer', async () => {
    for (const url of ['https://example.com/index.html', 'app://other/index.html', 'app://yaseen/untrusted.html', 'not a URL']) {
      const otherFrame = { url }
      expect(await invoke({ sender: { ...sender, mainFrame: otherFrame }, senderFrame: otherFrame }, 'text')).toEqual(bad)
    }
    expect(writeText).not.toHaveBeenCalled()
  })

  it('accepts the exact configured development renderer, including its window query', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    registerClipboardIpc({ idFor: () => 'w1' }, { target: () => sender, writeText, rendererUrl: 'http://localhost:5173/' })
    const devFrame = { url: 'http://localhost:5173/?win=w1' }
    expect(await invoke({ sender: { ...sender, mainFrame: devFrame }, senderFrame: devFrame }, 'text')).toEqual({ ok: true, value: undefined })
  })

  it('rejects non-text and oversized payloads before writing', async () => {
    for (const value of [null, undefined, 123, { text: 'text', html: '<b>text</b>' }, 'x'.repeat(MAX_COPY_TEXT_LENGTH + 1)]) {
      expect(await invoke(event, value)).toEqual(bad)
    }
    expect(writeText).not.toHaveBeenCalled()
  })
})
