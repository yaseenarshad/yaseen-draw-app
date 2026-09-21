import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { DEFAULT_SETTINGS, SIDEBAR_MAX_W } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import { registerStateIpc } from './state'

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

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow(opts: { destroyed?: boolean; wcDestroyed?: boolean } = {}) {
  return {
    isDestroyed: () => opts.destroyed === true,
    webContents: { isDestroyed: () => opts.wcDestroyed === true, send: vi.fn() },
  }
}

let dir: string
let store: Store
const sender = { id: 1 }
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  dir = await mkdtemp(path.join(tmpdir(), 'yd-state-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  registerStateIpc(store)
})
afterEach(async () => {
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('registerStateIpc', () => {
  it('registers every state channel the preload invokes (and nothing else)', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual(
      [CH.stateGet, CH.stateSetSettings, CH.stateSetSidebarWidth, CH.statePushRecent, CH.stateRemoveRecent, CH.stateSetFolder, CH.stateSetFolds, CH.stateSetBaseGroups].sort(),
    )
  })

  it('state:get answers the current state', async () => {
    expect(await registered(CH.stateGet)({ sender })).toEqual(ok(store.get()))
  })

  it('state:set-settings takes a complete valid SettingsState and rejects anything else as BAD_REQUEST', async () => {
    const next = { ...DEFAULT_SETTINGS, lineSpacing: 2, threadColor: '#00aaff', contentWidth: 'full' }
    expect(await registered(CH.stateSetSettings)({ sender }, next)).toEqual(ok(undefined))
    expect(store.get().settings).toEqual(next)
    expect(await registered(CH.stateSetSettings)({ sender }, { ...DEFAULT_SETTINGS, lineSpacing: 'big' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetSettings)({ sender }, { ...DEFAULT_SETTINGS, contentWidth: 'wide' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetSettings)({ sender }, { lineSpacing: 1 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetSettings)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(store.get().settings).toEqual(next)
  })

  it('state:set-sidebar-width only takes a finite number, clamped', async () => {
    expect(await registered(CH.stateSetSidebarWidth)({ sender }, 9999)).toEqual(ok(undefined))
    expect(store.get().sidebarWidth).toBe(SIDEBAR_MAX_W)
    expect(await registered(CH.stateSetSidebarWidth)({ sender }, Number.NaN)).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetSidebarWidth)({ sender }, '300')).toEqual(bad('BAD_REQUEST'))
    expect(store.get().sidebarWidth).toBe(SIDEBAR_MAX_W)
  })

  it('state:push-recent needs an absolute path', async () => {
    expect(await registered(CH.statePushRecent)({ sender }, '/v')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/v'])
    expect(await registered(CH.statePushRecent)({ sender }, 'v')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.statePushRecent)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
  })

  it('state:remove-recent needs an absolute path and drops the entry (unknown path is a no-op)', async () => {
    store.pushRecent('/v', 1)
    store.pushRecent('/w', 2)
    expect(await registered(CH.stateRemoveRecent)({ sender }, '/v')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/w'])
    expect(await registered(CH.stateRemoveRecent)({ sender }, '/gone')).toEqual(ok(undefined))
    expect(store.get().recents.map((r) => r.path)).toEqual(['/w'])
    expect(await registered(CH.stateRemoveRecent)({ sender }, 'v')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.stateRemoveRecent)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
  })

  it('state:set-folder checks the root and the patch shape', async () => {
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { expanded: ['/v/sub'], lastFile: '/v/a.md' })).toEqual(ok(undefined))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: '/v/a.md', folds: {}, baseGroups: {}, topicsExpanded: [] })
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { lastFile: null })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].lastFile).toBeNull()
    expect(await registered(CH.stateSetFolder)({ sender }, 'v', {})).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { expanded: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { expanded: [1] })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { lastFile: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, topicsExpanded: [] })
    // The Topics tree's open pages ride the same patch (YAZ-848), checked like `expanded`.
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { topicsExpanded: ['/v/Metrics.md'] })).toEqual(ok(undefined))
    expect(store.get().folders['/v'].topicsExpanded).toEqual(['/v/Metrics.md'])
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { topicsExpanded: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { topicsExpanded: [1] })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().folders['/v'].topicsExpanded).toEqual(['/v/Metrics.md'])
    // Focus Mode's lists are window identity since YAZ-1628 (`window.setIdentity`): here they are unknown keys, ignored like any other.
    expect(await registered(CH.stateSetFolder)({ sender }, '/v', { focusDirs: ['/v/sub'] })).toEqual(ok(undefined))
    expect(store.get().folders['/v']).toEqual({ expanded: ['/v/sub'], lastFile: null, folds: {}, baseGroups: {}, topicsExpanded: ['/v/Metrics.md'] })
  })

  it('state:set-folds checks root, file and keys', async () => {
    expect(await registered(CH.stateSetFolds)({ sender }, '/v', '/v/a.md', ['k1'])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].folds).toEqual({ '/v/a.md': ['k1'] })
    expect(await registered(CH.stateSetFolds)({ sender }, '/v', 'a.md', ['k1'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.stateSetFolds)({ sender }, '/v', '/v/a.md', 'k1')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolds)({ sender }, '/v', '/v/a.md', [1])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetFolds)({ sender }, '/v', '/v/a.md', [])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].folds).toEqual({})
  })

  it('state:set-base-groups checks root, key and collapsed', async () => {
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', '/v/a.md::T', ['v:idea'])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].baseGroups).toEqual({ '/v/a.md::T': ['v:idea'] })
    expect(await registered(CH.stateSetBaseGroups)({ sender }, 'v', '/v/a.md::T', ['v:idea'])).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', 5, ['v:idea'])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', '', ['v:idea'])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', '/v/a.md::T', 'v:idea')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', '/v/a.md::T', [1])).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.stateSetBaseGroups)({ sender }, '/v', '/v/a.md::T', [])).toEqual(ok(undefined))
    expect(store.get().folders['/v'].baseGroups).toEqual({})
  })

  it('broadcasts state:changed with the new state to every live window, skipping destroyed ones', async () => {
    const live = fakeWindow()
    const gone = fakeWindow({ destroyed: true })
    const halfGone = fakeWindow({ wcDestroyed: true })
    const other = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([live, gone, halfGone, other] as unknown as BrowserWindow[])
    await registered(CH.stateSetSidebarWidth)({ sender }, 321)
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    expect(live.webContents.send).toHaveBeenCalledWith(CH.stateChanged, store.get())
    expect(other.webContents.send).toHaveBeenCalledWith(CH.stateChanged, store.get())
    expect(gone.webContents.send).not.toHaveBeenCalled()
    expect(halfGone.webContents.send).not.toHaveBeenCalled()
    // Direct store mutations (the window manager's upserts) broadcast too.
    store.removeWindow('nope') // no change → no broadcast
    expect(live.webContents.send).toHaveBeenCalledTimes(1)
    store.pushRecent('/v', 1)
    expect(live.webContents.send).toHaveBeenCalledTimes(2)
  })
})
