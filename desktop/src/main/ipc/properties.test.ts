import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { PropertiesResponse } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import { activeConfigWatcherRoots, VAULT_CONFIG_DIR } from '../vaultConfig'
import { registerPropertiesIpc } from './properties'

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
  dir = await mkdtemp(path.join(tmpdir(), 'yd-properties-ipc-'))
  vault = path.join(dir, 'vault')
  await mkdir(vault) // the root exists (an open vault always does); its dotfolder does not
  store = createStore(path.join(dir, 'yaseendocs.json'))
  registerPropertiesIpc(store)
})
afterEach(async () => {
  // Dropping every window releases this test's config watcher (the next register drops strays).
  for (const w of store.get().windows) store.removeWindow(w.id)
  await until(() => activeConfigWatcherRoots().length === 0)
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('registerPropertiesIpc', () => {
  it('registers exactly the properties channels the preload invokes', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.propertiesGet, CH.propertiesSetProperty, CH.propertiesRemoveProperty].sort())
  })

  it('get and the mutators round-trip through the envelope; bad input answers error envelopes', async () => {
    expect(await registered(CH.propertiesGet)({ sender }, vault)).toEqual(ok({ root: vault, version: 1, properties: {} }))
    expect(await registered(CH.propertiesSetProperty)({ sender }, vault, 'unit', { kind: 'text' })).toEqual(ok(undefined))
    expect(await registered(CH.propertiesSetProperty)({ sender }, vault, 'related', { kind: 'multi-link' })).toEqual(ok(undefined))
    const got = (await registered(CH.propertiesGet)({ sender }, vault)) as { value: PropertiesResponse }
    expect(got.value.properties).toEqual({ unit: { kind: 'text' }, related: { kind: 'multi-link' } })
    expect(await registered(CH.propertiesRemoveProperty)({ sender }, vault, 'related')).toEqual(ok(undefined))

    expect(await registered(CH.propertiesGet)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.propertiesSetProperty)({ sender }, vault, 'Bad Name', { kind: 'text' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.propertiesSetProperty)({ sender }, vault, 'unit', { kind: 'nope' })).toEqual(bad('BAD_REQUEST'))
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, 'properties.json'), '{broken')
    expect(await registered(CH.propertiesSetProperty)({ sender }, vault, 'unit', { kind: 'text' })).toEqual(bad('INVALID_CONFIG'))
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

  it('broadcasts properties:changed { root, properties } to every live window on an own mutation and on an external edit', async () => {
    const a = fakeWindow()
    const b = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a, b] as unknown as BrowserWindow[])
    store.upsertWindow({ id: 'w1', root: vault, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds })
    a.webContents.send.mockClear()
    b.webContents.send.mockClear()

    await registered(CH.propertiesSetProperty)({ sender }, vault, 'related', { kind: 'multi-link' })
    const got = (win: ReturnType<typeof fakeWindow>) =>
      win.webContents.send.mock.calls.find(([ch]) => ch === CH.propertiesChanged)?.[1] as { root: string; properties: PropertiesResponse } | undefined
    await until(() => got(a) !== undefined && got(b) !== undefined)
    expect(got(a)?.root).toBe(vault)
    expect(got(a)?.properties.properties).toEqual({ related: { kind: 'multi-link' } })
    expect(got(b)?.properties.root).toBe(vault)

    a.webContents.send.mockClear()
    await new Promise((r) => setTimeout(r, 300)) // let the watcher settle on the just-created dotfolder
    await writeFile(path.join(vault, VAULT_CONFIG_DIR, 'properties.json'), '{"version":1,"properties":{"unit":{"kind":"text"}}}')
    await until(() => {
      const msg = got(a)
      return msg !== undefined && msg.properties.properties.unit !== undefined
    })
  })
})
