import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { registerVaultConfigIpc } from './vaultConfig'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: vi.fn() } }
}

const bounds = { x: 0, y: 0, width: 800, height: 600 }
const sender = { id: 1 }

let dir: string
let vault: string
let store: Store
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-vaultcfg-ipc-'))
  vault = path.join(dir, 'vault')
  await mkdir(vault) // the root exists (an open vault always does); its dotfolder does not
  store = createStore(path.join(dir, 'yaseendraw.json'))
  registerVaultConfigIpc(store)
})
afterEach(async () => {
  // Dropping every window releases this test's config watcher (the next register drops strays).
  for (const w of store.get().windows) store.removeWindow(w.id)
  await until(() => activeConfigWatcherRoots().length === 0)
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('registerVaultConfigIpc', () => {
  it('registers exactly the vaultConfig channels the preload invokes', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.vaultConfigRead, CH.vaultConfigWrite].sort())
  })

  it('read and write round-trip through the envelope; bad arguments answer error envelopes', async () => {
    expect(await registered(CH.vaultConfigRead)({ sender }, vault, 'types.json')).toEqual(ok(null))
    expect(await registered(CH.vaultConfigWrite)({ sender }, vault, 'types.json', { a: 1 })).toEqual(ok(undefined))
    expect(await registered(CH.vaultConfigRead)({ sender }, vault, 'types.json')).toEqual(ok({ a: 1 }))
    expect(await registered(CH.vaultConfigRead)({ sender }, 'rel', 'types.json')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.vaultConfigRead)({ sender }, vault, '../up.json')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.vaultConfigWrite)({ sender }, vault, 'a.txt', {})).toEqual(bad('UNSUPPORTED_EXTENSION'))
  })

  it('subscribes one config watcher per open-vault root and drops it when the last window leaves', async () => {
    expect(activeConfigWatcherRoots()).toEqual([])
    store.upsertWindow({ id: 'w1', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds })
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.upsertWindow({ id: 'w2', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds })
    expect(activeConfigWatcherRoots()).toEqual([vault]) // shared, not doubled
    store.upsertWindow({ id: 'w3', root: null, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds }) // Welcome window: no root, no watcher
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.removeWindow('w1')
    expect(activeConfigWatcherRoots()).toEqual([vault])
    store.removeWindow('w2')
    await until(() => activeConfigWatcherRoots().length === 0)
  })

  it('broadcasts vaultConfig:changed to every live window on an own write and on an external edit', async () => {
    const a = fakeWindow()
    const b = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a, b] as unknown as BrowserWindow[])
    store.upsertWindow({ id: 'w1', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds })
    a.webContents.send.mockClear()
    b.webContents.send.mockClear()

    await registered(CH.vaultConfigWrite)({ sender }, vault, 'types.json', { a: 1 })
    const change = { root: vault, name: 'types.json' }
    expect(a.webContents.send).toHaveBeenCalledWith(CH.vaultConfigChanged, change)
    expect(b.webContents.send).toHaveBeenCalledWith(CH.vaultConfigChanged, change)

    a.webContents.send.mockClear()
    await new Promise((r) => setTimeout(r, 300)) // let the watcher settle on the just-created dotfolder
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, 'types.json'), '{"a":2}')
    await until(() => a.webContents.send.mock.calls.some(([ch, c]) => ch === CH.vaultConfigChanged && (c as { name: string }).name === 'types.json'))
  })
})
