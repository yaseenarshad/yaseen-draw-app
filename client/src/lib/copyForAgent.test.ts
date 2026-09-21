import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BridgeRequestError } from '../api'
import { copyForAgent } from './copyForAgent'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { agentPrompt: vi.fn() },
}))

const { api } = await import('../api')
const agentPrompt = vi.mocked(api.agentPrompt)

let writeText: ReturnType<typeof vi.fn>
const hadClipboard = 'clipboard' in navigator
beforeEach(() => {
  agentPrompt.mockReset()
  writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
})
afterEach(() => {
  if (!hadClipboard) delete (navigator as unknown as Record<string, unknown>).clipboard
})

describe('copyForAgent', () => {
  it('asks main for the handshake, writes it to the clipboard, and says so', async () => {
    agentPrompt.mockResolvedValue('three\nlines\nhere')
    const notice = vi.fn()
    await copyForAgent('/vault/Note.md', notice)
    expect(agentPrompt).toHaveBeenCalledExactlyOnceWith({ path: '/vault/Note.md' })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('three\nlines\nhere')
    expect(notice).toHaveBeenCalledExactlyOnceWith('Copied for agent')
  })

  it('a page that is gone is reported by name; any other failure by message; nothing reaches the clipboard', async () => {
    const notice = vi.fn()
    agentPrompt.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'no such file'))
    await copyForAgent('/vault/sub/Deep Note.md', notice)
    expect(notice).toHaveBeenLastCalledWith('Can\'t copy "Deep Note.md" for an agent — it is no longer there')
    agentPrompt.mockResolvedValueOnce('text')
    writeText.mockRejectedValueOnce(new Error('denied'))
    await copyForAgent('/vault/Note.md', notice)
    expect(notice).toHaveBeenLastCalledWith("Can't copy for agent: denied")
    expect(writeText).toHaveBeenCalledTimes(1)
  })
})
