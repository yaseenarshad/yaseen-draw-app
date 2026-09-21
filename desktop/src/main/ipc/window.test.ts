import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { defaultRightPanelIdentity, type WindowEntry } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import * as windows from '../windows'
import { registerWindowIpc } from './window'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const ok = (value: unknown) => ({ ok: true, value })
const bad = (code: string) => expect.objectContaining({ ok: false, error: expect.objectContaining({ code }) })
const bounds = { x: 10, y: 20, width: 800, height: 600 }
const RIGHT = { open: true, width: 520, items: ['/v/right.md'], expanded: '/v/right.md' }
const entry: WindowEntry = { id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds }

let dir: string
let store: Store
let unregister: () => void
/** The manager slice the IPC layer drives: the real lookup, spies for the plumbing. */
let manager: {
  idFor: typeof windows.idFor
  openWindow: ReturnType<typeof vi.fn>
  duplicateWindow: ReturnType<typeof vi.fn>
  openRecentBeside: ReturnType<typeof vi.fn>
  closeWindow: ReturnType<typeof vi.fn>
  handleFlushed: ReturnType<typeof vi.fn>
}
/** `event.sender` stand-ins: webContents 1 is registered as window w1, webContents 9 is unknown. */
const sender = { id: 1 }
const stranger = { id: 9 }
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  vi.mocked(ipcMain.on).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yd-window-ipc-'))
  store = createStore(path.join(dir, 'yaseendocs.json'))
  store.upsertWindow(entry)
  unregister = windows.register({ webContents: sender }, 'w1')
  manager = { idFor: windows.idFor, openWindow: vi.fn(), duplicateWindow: vi.fn(), openRecentBeside: vi.fn(() => true), closeWindow: vi.fn(), handleFlushed: vi.fn() }
  registerWindowIpc(store, manager)
})
afterEach(async () => {
  unregister()
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

describe('window lookup', () => {
  it('maps a webContents id to its window id until unregistered', () => {
    expect(windows.idFor(sender)).toBe('w1')
    expect(windows.idFor(stranger)).toBeUndefined()
    unregister()
    expect(windows.idFor(sender)).toBeUndefined()
    unregister = windows.register({ webContents: sender }, 'w1')
  })
})

describe('registerWindowIpc', () => {
  it('registers every window channel the preload invokes (and nothing else)', () => {
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.windowIdentity, CH.windowSetIdentity, CH.windowOpen, CH.windowDuplicate, CH.windowOpenRecent, CH.windowCloseSelf, CH.windowZoom, CH.menuPasteTextFallback].sort())
  })

  it('native paste fallback inserts the captured text into only the registered sender', async () => {
    const target = { ...sender, insertText: vi.fn(async () => undefined) }
    expect(await registered(CH.menuPasteTextFallback)({ sender: target }, '# literal\nline')).toEqual(ok(undefined))
    expect(target.insertText).toHaveBeenCalledExactlyOnceWith('# literal\nline')
    expect(await registered(CH.menuPasteTextFallback)({ sender: target }, '')).toEqual(ok(undefined))
    expect(target.insertText).toHaveBeenCalledTimes(1)
    expect(await registered(CH.menuPasteTextFallback)({ sender: stranger }, 'text')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.menuPasteTextFallback)({ sender: target }, { text: 'bad' })).toEqual(bad('BAD_REQUEST'))
    expect(target.insertText).toHaveBeenCalledTimes(1)
  })

  it('window:identity answers the complete per-window identity for a registered sender', async () => {
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(ok({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [] }))
  })

  it('window:identity rejects an unregistered sender (BAD_REQUEST) and a window the state no longer has (NOT_FOUND)', async () => {
    expect(await registered(CH.windowIdentity)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(bad('NOT_FOUND'))
  })

  it('window:set-identity merges root / file into the entry, keeping id and bounds; tabs follow the invariant', async () => {
    // file → null clears tabs (tabs [] ⇔ file null); a new file not in tabs is prepended.
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: '/other', file: null })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: null, tabs: [], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds }])
    expect(await registered(CH.windowSetIdentity)({ sender }, { file: '/other/b.md' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: '/other/b.md', tabs: ['/other/b.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds }])
    // Unknown keys cannot touch id / bounds.
    expect(await registered(CH.windowSetIdentity)({ sender }, { id: 'hijack', bounds: { x: 0, y: 0, width: 1, height: 1 } })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ id: 'w1', root: '/other', file: '/other/b.md', tabs: ['/other/b.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds }])
  })

  it('window:set-identity accepts a tabs patch: de-duplicated, and the active file is prepended when missing (GRO-2232)', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { tabs: ['/v/a.md', '/v/b.md', '/v/a.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md'])
    // The invariant holds on the entry AS WRITTEN: a tabs patch missing the untouched active file repairs by prepending.
    expect(await registered(CH.windowSetIdentity)({ sender }, { tabs: ['/v/b.md', '/v/c.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0].tabs).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    // file and tabs patched together: the new file leads.
    expect(await registered(CH.windowSetIdentity)({ sender }, { file: '/v/b.md', tabs: ['/v/b.md', '/v/c.md'] })).toEqual(ok(undefined))
    expect(store.get().windows[0]).toEqual({ id: 'w1', root: '/v', file: '/v/b.md', tabs: ['/v/b.md', '/v/c.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds })
  })

  it('window:set-identity accepts one complete right-panel patch and enforces main/right exclusivity', async () => {
    const rightPanel = { open: true, width: 600, items: ['/v/a.md', '/v/b.md', '/v/b.md'], expanded: '/v/a.md' }
    expect(await registered(CH.windowSetIdentity)({ sender }, { rightPanel })).toEqual(ok(undefined))
    expect(store.get().windows[0].rightPanel).toEqual({ open: true, width: 600, items: ['/v/b.md'], expanded: null })
  })

  it('window:set-identity rejects incomplete or malformed right-panel patches atomically', async () => {
    for (const rightPanel of [
      { open: true, width: 440, items: [] },
      { open: true, width: '440', items: [], expanded: null },
      { open: true, width: 440, items: ['relative.md'], expanded: null },
      { open: true, width: 440, items: [], expanded: 3 },
    ]) {
      expect(await registered(CH.windowSetIdentity)({ sender }, { rightPanel })).toEqual(bad(rightPanel.items[0] === 'relative.md' ? 'NOT_ABSOLUTE' : 'BAD_REQUEST'))
    }
    expect(store.get().windows[0]).toEqual(entry)
  })

  it('window:set-identity validates and patches sidebar visibility without changing other identity or bounds', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarCollapsed: true })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarCollapsed: true }])
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarCollapsed: 'true' })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().windows).toEqual([{ ...entry, sidebarCollapsed: true }])
  })

  it('window:set-identity validates and patches the lens, and identity reads it back (YAZ-1628)', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarLens: 'files' })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'files' }])
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(ok({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusTopics: [], focusFavorites: [] }))
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarLens: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarLens: 1 })).toEqual(bad('BAD_REQUEST'))
    expect(store.get().windows).toEqual([{ ...entry, sidebarLens: 'files' }])
  })

  it('window:set-identity validates and patches the Focus Mode lists with the tabs rule, and identity reads them back (YAZ-1628)', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusDirs: ['/v/a', '/v/b'], focusTopics: ['/v/T.md'], focusFavorites: [] })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, focusDirs: ['/v/a', '/v/b'], focusTopics: ['/v/T.md'], focusFavorites: [] }])
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(ok({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: ['/v/a', '/v/b'], focusTopics: ['/v/T.md'], focusFavorites: [] }))
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusDirs: [] })).toEqual(ok(undefined)) // one lens' exit leaves the other alone
    expect(store.get().windows).toEqual([{ ...entry, focusDirs: [], focusTopics: ['/v/T.md'], focusFavorites: [] }])
    // A non-array, or one relative element, rejects the whole call and leaves the entry untouched.
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusDirs: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusTopics: ['/v/T.md', 'rel.md'] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusDirs: ['/v/a', 5] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(store.get().windows).toEqual([{ ...entry, focusDirs: [], focusTopics: ['/v/T.md'], focusFavorites: [] }])
  })

  it('window:set-identity validates and patches focusFavorites with the same tabs rule, and identity reads it back (YAZ-1766 D5)', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusFavorites: ['/v/a'] })).toEqual(ok(undefined))
    expect(store.get().windows).toEqual([{ ...entry, focusFavorites: ['/v/a'] }])
    expect(await registered(CH.windowIdentity)({ sender })).toEqual(ok({ id: 'w1', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel: RIGHT, sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: ['/v/a'] }))
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusFavorites: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { focusFavorites: ['/v/a', 'rel'] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(store.get().windows).toEqual([{ ...entry, focusFavorites: ['/v/a'] }])
    expect(await registered(CH.windowSetIdentity)({ sender }, { sidebarLens: 'favorites' })).toEqual(ok(undefined)) // the third lens (D1)
    expect(store.get().windows[0].sidebarLens).toBe('favorites')
  })

  it('window:set-identity rejects the whole call on any bad tabs element, leaving the entry untouched', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, { tabs: 'nope' })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { tabs: ['/v/a.md', 'rel.md'] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { tabs: ['/v/a.md', 5] })).toEqual(bad('NOT_ABSOLUTE'))
    expect(store.get().windows).toEqual([entry])
  })

  it('window:close-self hands the caller id to the manager (real close path); unknown callers are rejected', async () => {
    expect(await registered(CH.windowCloseSelf)({ sender })).toEqual(ok(undefined))
    expect(manager.closeWindow).toHaveBeenCalledWith('w1')
    expect(await registered(CH.windowCloseSelf)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    expect(manager.closeWindow).toHaveBeenCalledTimes(1)
  })

  it('window:zoom moves the caller\'s own zoom level by ±0.5 or back to 0, and rejects any other step (YAZ-1710)', async () => {
    const target = { ...sender, getZoomLevel: vi.fn(() => 1), setZoomLevel: vi.fn() }
    expect(await registered(CH.windowZoom)({ sender: target }, 1)).toEqual(ok(undefined))
    expect(await registered(CH.windowZoom)({ sender: target }, -1)).toEqual(ok(undefined))
    expect(await registered(CH.windowZoom)({ sender: target }, 0)).toEqual(ok(undefined))
    expect(target.setZoomLevel.mock.calls).toEqual([[1.5], [0.5], [0]])
    expect(await registered(CH.windowZoom)({ sender: target }, 2)).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowZoom)({ sender: target }, '1')).toEqual(bad('BAD_REQUEST'))
    expect(target.setZoomLevel).toHaveBeenCalledTimes(3)
  })

  it('window:set-identity validates the patch', async () => {
    expect(await registered(CH.windowSetIdentity)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: 'rel' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { file: 'a.md' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowSetIdentity)({ sender }, { rightPanel: defaultRightPanelIdentity(), extra: true })).toEqual(ok(undefined))
    expect(await registered(CH.windowSetIdentity)({ sender: stranger }, { root: '/v' })).toEqual(bad('BAD_REQUEST'))
    store.removeWindow('w1')
    expect(await registered(CH.windowSetIdentity)({ sender }, { root: '/v' })).toEqual(bad('NOT_FOUND'))
  })

  it('window:open validates the options and hands them to the manager (absent paths read as null)', async () => {
    expect(await registered(CH.windowOpen)({ sender }, { root: '/v', file: '/v/a.md' })).toEqual(ok(undefined))
    expect(manager.openWindow).toHaveBeenCalledWith({ root: '/v', file: '/v/a.md' })
    expect(await registered(CH.windowOpen)({ sender }, {})).toEqual(ok(undefined))
    expect(manager.openWindow).toHaveBeenCalledWith({ root: null, file: null })
    expect(await registered(CH.windowOpen)({ sender }, 'nope')).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowOpen)({ sender }, { root: 5 })).toEqual(bad('BAD_REQUEST'))
    expect(await registered(CH.windowOpen)({ sender }, { root: 'rel' })).toEqual(bad('NOT_ABSOLUTE'))
    expect(manager.openWindow).toHaveBeenCalledTimes(2)
  })

  it('window:open-recent validates the path and returns the door\'s verdict (YAZ-1767 D1)', async () => {
    expect(await registered(CH.windowOpenRecent)({ sender }, '/v/other')).toEqual(ok(true))
    expect(manager.openRecentBeside).toHaveBeenCalledExactlyOnceWith('/v/other')
    manager.openRecentBeside.mockReturnValueOnce(false)
    expect(await registered(CH.windowOpenRecent)({ sender }, '/v/gone')).toEqual(ok(false))
    expect(await registered(CH.windowOpenRecent)({ sender }, 'rel')).toEqual(bad('NOT_ABSOLUTE'))
    expect(await registered(CH.windowOpenRecent)({ sender }, undefined)).toEqual(bad('BAD_REQUEST'))
    expect(manager.openRecentBeside).toHaveBeenCalledTimes(2)
  })

  it('window:duplicate hands the caller entry to the manager; unknown callers are rejected', async () => {
    expect(await registered(CH.windowDuplicate)({ sender })).toEqual(ok(undefined))
    expect(manager.duplicateWindow).toHaveBeenCalledWith(entry)
    expect(await registered(CH.windowDuplicate)({ sender: stranger })).toEqual(bad('BAD_REQUEST'))
    expect(manager.duplicateWindow).toHaveBeenCalledTimes(1)
  })

  it('app:flushed routes the renderer ack to the manager by sender', () => {
    const call = vi.mocked(ipcMain.on).mock.calls.find(([ch]) => ch === CH.appFlushed)
    expect(call).toBeDefined()
    const handler = call?.[1] as unknown as (e: { sender: { id: number } }) => void
    handler({ sender })
    expect(manager.handleFlushed).toHaveBeenCalledWith(sender)
  })
})
