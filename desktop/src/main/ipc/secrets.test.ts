import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain, safeStorage } from 'electron'
import { CH, type Envelope } from '../../channels'
import type { Secrets } from '../secrets'
import { registerSecretsIpc } from './secrets'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((s: string) => Buffer.from(`enc:${s}`)),
    decryptString: vi.fn((b: Buffer) => b.toString().slice(4)),
  },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })
const sender = { id: 1 }

let userData: string
let secrets: Secrets
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
  userData = await mkdtemp(path.join(tmpdir(), 'yd-secrets-ipc-'))
  secrets = registerSecretsIpc(userData)
})
afterEach(() => rm(userData, { recursive: true, force: true }))

const set = (req: unknown) => registered(CH.secretsSet)({ sender }, req)
const has = (req: unknown) => registered(CH.secretsHas)({ sender }, req)

describe('registerSecretsIpc (🔒 YAZ-1775 D4, YAZ-1817)', () => {
  it('registers set and has — and NO channel that answers a value', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()).toEqual([CH.secretsHas, CH.secretsSet].sort())
  })

  it('set stores through safeStorage into `<userData>/secrets.json`; has flips; null clears; main reads the plaintext', async () => {
    expect(await has({ name: 'pixabayApiKey' })).toEqual(ok(false))
    expect(await set({ name: 'pixabayApiKey', value: 'abc123' })).toEqual(ok(undefined))
    expect(await has({ name: 'pixabayApiKey' })).toEqual(ok(true))
    const raw = await readFile(path.join(userData, 'secrets.json'), 'utf8')
    expect(raw).not.toContain('abc123')
    expect(safeStorage.encryptString).toHaveBeenCalledWith('abc123')
    expect(await secrets.read('pixabayApiKey')).toBe('abc123')
    expect(await set({ name: 'pixabayApiKey', value: null })).toEqual(ok(undefined))
    expect(await has({ name: 'pixabayApiKey' })).toEqual(ok(false))
  })

  it('refuses a missing name, an empty value, or a non-string value with BAD_REQUEST', async () => {
    expect(await set(undefined)).toEqual(bad('BAD_REQUEST'))
    expect(await set({ name: '', value: 'x' })).toEqual(bad('BAD_REQUEST'))
    expect(await set({ name: 'a', value: '' })).toEqual(bad('BAD_REQUEST'))
    expect(await set({ name: 'a', value: 7 })).toEqual(bad('BAD_REQUEST'))
    expect(await has({ name: 3 })).toEqual(bad('BAD_REQUEST'))
    expect(await has({ name: 'a' })).toEqual(ok(false))
  })

  it('without a keychain, set answers ENCRYPTION_UNAVAILABLE and has answers false', async () => {
    await set({ name: 'a', value: 'x' })
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    expect(await set({ name: 'b', value: 'y' })).toEqual(bad('ENCRYPTION_UNAVAILABLE'))
    expect(await has({ name: 'a' })).toEqual(ok(false))
  })
})
