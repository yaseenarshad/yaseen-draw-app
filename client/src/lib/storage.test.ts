import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, MAX_COLLAPSED_GROUP_KEYS, MAX_FOLD_KEYS_PER_FILE, MAX_TOPICS_EXPANDED_PAGES, addRecentRoot, defaultAppState, defaultRightPanelIdentity, type AppState, type WindowIdentity } from '@shared/types'
import { storage } from './storage'
import { hashFilePath } from './urlHash'

/** A fake `window.yaseenDraw` with just the state / window halves the storage module talks to. */
type IdentityFixture = Omit<WindowIdentity, 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusTopics' | 'focusFavorites'> & Partial<Pick<WindowIdentity, 'rightPanel' | 'sidebarCollapsed' | 'sidebarLens' | 'focusDirs' | 'focusTopics' | 'focusFavorites'>>

function installBridge(state: AppState, identity: IdentityFixture) {
  let listener: ((s: AppState) => void) | null = null
  const bridge = {
    state: {
      get: vi.fn(async () => state),
      setSettings: vi.fn(async () => undefined),
      setSidebarWidth: vi.fn(async () => undefined),
      pushRecent: vi.fn(async () => undefined),
      removeRecent: vi.fn(async () => undefined),
      setFolder: vi.fn(async () => undefined),
      setFolds: vi.fn(async () => undefined),
      setBaseGroups: vi.fn(async () => undefined),
      onChange: vi.fn((l: (s: AppState) => void) => {
        listener = l
        return () => {
          if (listener === l) listener = null
        }
      }),
    },
    window: {
      identity: vi.fn(async (): Promise<WindowIdentity> => ({
        ...identity,
        rightPanel: identity.rightPanel ?? defaultRightPanelIdentity(),
        sidebarCollapsed: identity.sidebarCollapsed ?? false,
        sidebarLens: identity.sidebarLens ?? 'topics',
        focusDirs: identity.focusDirs ?? [],
        focusTopics: identity.focusTopics ?? [],
        focusFavorites: identity.focusFavorites ?? [],
      })),
      setIdentity: vi.fn(async () => undefined),
      open: vi.fn(),
      duplicate: vi.fn(),
    },
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return { bridge, emit: (s: AppState) => listener?.(s), hasListener: () => listener !== null }
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0))

let b: ReturnType<typeof installBridge>
beforeEach(async () => {
  b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false })
  await storage.init()
})
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.restoreAllMocks()
})

describe('addRecentRoot', () => {
  it('prepends, de-dupes and caps at 10', () => {
    let list = addRecentRoot([], '/a', 1)
    list = addRecentRoot(list, '/b', 2)
    list = addRecentRoot(list, '/a', 3)
    expect(list).toEqual([
      { path: '/a', lastOpened: 3 },
      { path: '/b', lastOpened: 2 },
    ])
    for (let i = 0; i < 20; i++) list = addRecentRoot(list, `/x${i}`, 10 + i)
    expect(list).toHaveLength(10)
    expect(list[0].path).toBe('/x19')
  })
})

describe('storage.init', () => {
  it('loads the state and this window\'s identity from the bridge and subscribes to changes', async () => {
    const seeded: AppState = {
      ...defaultAppState(),
      settings: { ...DEFAULT_SETTINGS, lineSpacing: 2 },
      recents: [{ path: '/v', lastOpened: 5 }],
      folders: { '/v': { expanded: ['/v/sub'], lastFile: '/v/a.md', folds: { '/v/a.md': ['k1'] }, baseGroups: { '/v/b.md::T': ['v:idea'] }, topicsExpanded: ['/v/Metrics.md'] } },
    }
    const rightPanel = { open: true, width: 520, items: ['/v/b.md'], expanded: '/v/b.md' }
    b = installBridge(seeded, { id: 'w2', root: '/v', file: '/v/a.md', tabs: ['/v/a.md'], rightPanel, sidebarCollapsed: true })
    await storage.init()
    expect(b.bridge.state.get).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.identity).toHaveBeenCalledTimes(1)
    expect(b.hasListener()).toBe(true)
    expect(storage.getRoot()).toBe('/v')
    expect(storage.getFile()).toBe('/v/a.md')
    expect(storage.getTabs()).toEqual(['/v/a.md'])
    expect(storage.getRightPanel()).toEqual(rightPanel)
    expect(storage.getRightPanel()).not.toBe(rightPanel)
    expect(storage.getSettings()).toEqual({ ...DEFAULT_SETTINGS, lineSpacing: 2 })
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(storage.getRecentRoots()).toEqual([{ path: '/v', lastOpened: 5 }])
    expect(storage.getExpanded('/v')).toEqual(['/v/sub'])
    expect(storage.getLastFile('/v')).toBe('/v/a.md')
    expect(storage.getFolds('/v', '/v/a.md')).toEqual(['k1'])
    expect(storage.getViewGroups('/v', '/v/b.md::T')).toEqual(['v:idea'])
    expect(storage.getTopicsExpanded('/v')).toEqual(['/v/Metrics.md'])
  })

  it('reads fall back to defaults before init / when the bridge is unavailable', async () => {
    vi.resetModules()
    delete (window as unknown as Record<string, unknown>).yaseenDraw
    const fresh = (await import('./storage')).storage
    expect(fresh.getRoot()).toBeNull()
    expect(fresh.getTabs()).toEqual([])
    expect(fresh.getRecentRoots()).toEqual([])
    expect(fresh.getExpanded('/r')).toEqual([])
    expect(fresh.getLastFile('/r')).toBeNull()
    expect(fresh.getFolds('/r', '/r/a.md')).toEqual([])
    expect(fresh.getViewGroups('/r', '/r/a.md::T')).toEqual([])
    expect(fresh.getTopicsExpanded('/r')).toEqual([])
    expect(fresh.getSidebarCollapsed()).toBe(false)
    expect(fresh.getSettings()).toEqual(DEFAULT_SETTINGS)
    await expect(fresh.init()).rejects.toBeDefined()
  })

  it('re-initialising drops the previous change subscription', async () => {
    const first = b
    b = installBridge(defaultAppState(), { id: 'w1', root: null, file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(first.hasListener()).toBe(false)
    expect(b.hasListener()).toBe(true)
  })
})

describe('storage', () => {
  it('root is the window identity; changing it clears the file AND tabs in one write, re-setting it keeps them', () => {
    expect(storage.getRoot()).toBeNull()
    storage.setRoot('/notes')
    expect(storage.getRoot()).toBe('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), focusDirs: [], focusTopics: [], focusFavorites: [] })
    storage.setWorkspace('/notes', ['/notes/a.md'], '/notes/a.md', defaultRightPanelIdentity())
    storage.setRoot('/notes')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/notes' })
    expect(storage.getFile()).toBe('/notes/a.md')
    expect(storage.getTabs()).toEqual(['/notes/a.md'])
    storage.setRoot(null)
    expect(storage.getRoot()).toBeNull()
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: null, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), focusDirs: [], focusTopics: [], focusFavorites: [] })
    expect(storage.getFile()).toBeNull()
    expect(storage.getTabs()).toEqual([])
  })

  it('setWorkspace mirrors main and right identity in one call and keeps independent item arrays', () => {
    const rightPanel = { open: true, width: 600, items: ['/v/b.md'], expanded: '/v/b.md' }
    storage.setWorkspace('/v', ['/v/a.md'], '/v/a.md', rightPanel)
    expect(storage.getTabs()).toEqual(['/v/a.md'])
    expect(storage.getRightPanel()).toEqual(rightPanel)
    expect(storage.getRightPanel().items).not.toBe(rightPanel.items)
    expect(b.bridge.window.setIdentity).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({
      tabs: ['/v/a.md'],
      file: '/v/a.md',
      rightPanel,
    })
  })

  it('recent roots are MRU in the cache and pushed through the bridge', () => {
    expect(storage.pushRecentRoot('/a', 5)).toEqual([{ path: '/a', lastOpened: 5 }])
    storage.pushRecentRoot('/b', 6)
    expect(storage.getRecentRoots()).toEqual([
      { path: '/b', lastOpened: 6 },
      { path: '/a', lastOpened: 5 },
    ])
    expect(b.bridge.state.pushRecent.mock.calls).toEqual([['/a'], ['/b']])
  })

  it('removeRecentRoot drops the entry from the cache and sends the removal over the bridge', () => {
    storage.pushRecentRoot('/a', 5)
    storage.pushRecentRoot('/b', 6)
    storage.removeRecentRoot('/a')
    expect(storage.getRecentRoots()).toEqual([{ path: '/b', lastOpened: 6 }])
    expect(b.bridge.state.removeRecent).toHaveBeenCalledWith('/a')
  })

  it('expanded and lastFile are keyed by root; setWorkspace records lastFile and one complete identity write', () => {
    storage.setExpanded('/r1', ['/r1/a'])
    storage.setExpanded('/r2', ['/r2/b'])
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a'])
    expect(storage.getExpanded('/r2')).toEqual(['/r2/b'])
    expect(storage.getExpanded('/r3')).toEqual([])
    expect(b.bridge.state.setFolder.mock.calls).toEqual([
      ['/r1', { expanded: ['/r1/a'] }],
      ['/r2', { expanded: ['/r2/b'] }],
    ])
    storage.setWorkspace('/r1', ['/r1/a/x.md', '/r1/y.md'], '/r1/a/x.md', defaultRightPanelIdentity())
    expect(storage.getLastFile('/r1')).toBe('/r1/a/x.md')
    expect(storage.getLastFile('/r2')).toBeNull()
    expect(storage.getExpanded('/r1')).toEqual(['/r1/a']) // the other folder fields survive
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: '/r1/a/x.md' })
    // ONE explicit write carries BOTH halves — never the legacy { file }-only patch, whose
    // main-side normalization would prepend the file into tabs on its own.
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r1/a/x.md', '/r1/y.md'], file: '/r1/a/x.md', rightPanel: defaultRightPanelIdentity() })
    storage.setWorkspace('/r1', [], null, defaultRightPanelIdentity())
    expect(storage.getLastFile('/r1')).toBeNull()
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r1', { lastFile: null })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: [], file: null, rightPanel: defaultRightPanelIdentity() })
  })

  it('a tabs-only change (active file unchanged) writes the identity but NOT the folder (FN14, GRO-2197)', () => {
    storage.setWorkspace('/r', ['/r/a.md'], '/r/a.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(1)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r', { lastFile: '/r/a.md' })
    // ⌘-click background tab / drag-reorder / closing a non-active tab: `file` is identical —
    // no redundant lastFile write (which would commit, hit disk and broadcast to every window).
    storage.setWorkspace('/r', ['/r/a.md', '/r/b.md'], '/r/a.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(1)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r/a.md', '/r/b.md'], file: '/r/a.md', rightPanel: defaultRightPanelIdentity() })
    expect(storage.getTabs()).toEqual(['/r/a.md', '/r/b.md'])
    expect(storage.getLastFile('/r')).toBe('/r/a.md')
    // A REAL active-file change still writes both halves.
    storage.setWorkspace('/r', ['/r/a.md', '/r/b.md'], '/r/b.md', defaultRightPanelIdentity())
    expect(b.bridge.state.setFolder).toHaveBeenCalledTimes(2)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r', { lastFile: '/r/b.md' })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ tabs: ['/r/a.md', '/r/b.md'], file: '/r/b.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('setWorkspace on a null root (no folder to remember into) updates the identity only', () => {
    storage.setWorkspace(null, ['/x/a.md'], '/x/a.md', defaultRightPanelIdentity())
    expect(storage.getFile()).toBe('/x/a.md')
    expect(storage.getTabs()).toEqual(['/x/a.md'])
    expect(b.bridge.state.setFolder).not.toHaveBeenCalled()
    expect(b.bridge.window.setIdentity).toHaveBeenCalledWith({ tabs: ['/x/a.md'], file: '/x/a.md', rightPanel: defaultRightPanelIdentity() })
  })

  it('getFile/getTabs are the window identity: set by setWorkspace, cleared when the root changes', () => {
    expect(storage.getFile()).toBeNull()
    storage.setRoot('/v')
    storage.setWorkspace('/v', ['/v/b.md', '/v/c.md'], '/v/b.md', defaultRightPanelIdentity())
    expect(storage.getFile()).toBe('/v/b.md')
    expect(storage.getTabs()).toEqual(['/v/b.md', '/v/c.md'])
    storage.setRoot('/other')
    expect(storage.getFile()).toBeNull()
    expect(storage.getTabs()).toEqual([])
  })

  /** The workspace boot precedence: `hashFilePath(hash) ?? storage.getFile() ?? storage.getLastFile(root)`. */
  const bootFile = (hash: string, root: string) => hashFilePath(hash) ?? storage.getFile() ?? storage.getLastFile(root)

  it('boot precedence (GRO-2160): identity file wins over the folder lastFile, a pasted hash beats both', async () => {
    // Two windows on the same folder: w2 restored on b.md while the folder's lastFile is a.md.
    const seeded: AppState = { ...defaultAppState(), folders: { '/v': { expanded: [], lastFile: '/v/a.md', folds: {}, baseGroups: {}, topicsExpanded: [] } } }
    b = installBridge(seeded, { id: 'w2', root: '/v', file: '/v/b.md', tabs: ['/v/b.md'], sidebarCollapsed: false })
    await storage.init()
    expect(bootFile('', '/v')).toBe('/v/b.md')
    expect(bootFile('#/v/c.md', '/v')).toBe('/v/c.md')
    // A fresh window on the folder (identity file null) still falls back to the folder's lastFile.
    b = installBridge(seeded, { id: 'w3', root: '/v', file: null, tabs: [], sidebarCollapsed: false })
    await storage.init()
    expect(bootFile('', '/v')).toBe('/v/a.md')
  })

  it('folds are keyed by root then file, capped, and pruned when empty', () => {
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual([])
    storage.setFolds('/r1', '/r1/a.md', ['k1', 'k2'])
    storage.setFolds('/r1', '/r1/b.md', ['k3'])
    storage.setFolds('/r2', '/r2/a.md', ['k4'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k1', 'k2'])
    expect(storage.getFolds('/r1', '/r1/b.md')).toEqual(['k3'])
    expect(storage.getFolds('/r2', '/r1/a.md')).toEqual([])
    expect(b.bridge.state.setFolds).toHaveBeenCalledWith('/r1', '/r1/a.md', ['k1', 'k2'])
    // Replacing with the live set drops keys the plugin no longer reports.
    storage.setFolds('/r1', '/r1/a.md', ['k2'])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual(['k2'])
    storage.setFolds('/r1', '/r1/a.md', [])
    storage.setFolds('/r1', '/r1/b.md', [])
    expect(storage.getFolds('/r1', '/r1/a.md')).toEqual([])
    expect(b.bridge.state.setFolds).toHaveBeenLastCalledWith('/r1', '/r1/b.md', [])
    const many = Array.from({ length: MAX_FOLD_KEYS_PER_FILE + 50 }, (_, i) => `k${i}`)
    storage.setFolds('/r2', '/r2/a.md', many)
    expect(storage.getFolds('/r2', '/r2/a.md')).toHaveLength(MAX_FOLD_KEYS_PER_FILE)
    expect(b.bridge.state.setFolds).toHaveBeenLastCalledWith('/r2', '/r2/a.md', many)
  })

  it('base group collapse state is keyed by root then base::view, capped, and pruned when empty', () => {
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual([])
    storage.setViewGroups('/r1', '/r1/a.md::T', ['v:idea', '∅'])
    storage.setViewGroups('/r2', '/r2/a.md::T', ['v:x'])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual(['v:idea', '∅'])
    expect(storage.getViewGroups('/r2', '/r1/a.md::T')).toEqual([])
    expect(b.bridge.state.setBaseGroups).toHaveBeenCalledWith('/r1', '/r1/a.md::T', ['v:idea', '∅'])
    // Replacing with the live set drops keys no longer collapsed.
    storage.setViewGroups('/r1', '/r1/a.md::T', ['∅'])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual(['∅'])
    storage.setViewGroups('/r1', '/r1/a.md::T', [])
    expect(storage.getViewGroups('/r1', '/r1/a.md::T')).toEqual([])
    expect(b.bridge.state.setBaseGroups).toHaveBeenLastCalledWith('/r1', '/r1/a.md::T', [])
    const many = Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 50 }, (_, i) => `v:${i}`)
    storage.setViewGroups('/r2', '/r2/a.md::T', many)
    expect(storage.getViewGroups('/r2', '/r2/a.md::T')).toHaveLength(MAX_COLLAPSED_GROUP_KEYS)
    expect(b.bridge.state.setBaseGroups).toHaveBeenLastCalledWith('/r2', '/r2/a.md::T', many)
  })

  it('topicsExpanded is per root, capped, and rides the SAME setFolder patch as expanded (YAZ-848)', () => {
    storage.setTopicsExpanded('/r1', ['/r1/Metrics.md', '/r1/Home.md'])
    storage.setTopicsExpanded('/r2', ['/r2/Other.md'])
    expect(storage.getTopicsExpanded('/r1')).toEqual(['/r1/Metrics.md', '/r1/Home.md'])
    expect(storage.getTopicsExpanded('/r2')).toEqual(['/r2/Other.md'])
    expect(storage.getTopicsExpanded('/r3')).toEqual([])
    expect(b.bridge.state.setFolder).toHaveBeenCalledWith('/r1', { topicsExpanded: ['/r1/Metrics.md', '/r1/Home.md'] })
    // The FILE tree's own bucket is untouched by a Topics write, and vice versa.
    storage.setExpanded('/r1', ['/r1/dir'])
    expect(storage.getTopicsExpanded('/r1')).toEqual(['/r1/Metrics.md', '/r1/Home.md'])
    storage.setTopicsExpanded('/r1', [])
    expect(storage.getTopicsExpanded('/r1')).toEqual([])
    expect(storage.getExpanded('/r1')).toEqual(['/r1/dir'])
    const many = Array.from({ length: MAX_TOPICS_EXPANDED_PAGES + 50 }, (_, i) => `/r2/p${i}.md`)
    storage.setTopicsExpanded('/r2', many)
    expect(storage.getTopicsExpanded('/r2')).toHaveLength(MAX_TOPICS_EXPANDED_PAGES)
    expect(b.bridge.state.setFolder).toHaveBeenLastCalledWith('/r2', { topicsExpanded: many.slice(0, MAX_TOPICS_EXPANDED_PAGES) })
  })

  it('focusFavorites is this window identity (YAZ-1766 D5), focusDirs\' rule: setIdentity, deaf to broadcasts, cleared by a root change', async () => {
    b = installBridge(defaultAppState(), { id: 'w1', root: '/r1', file: null, tabs: [], focusFavorites: ['/r1/restored'] })
    await storage.init()
    expect(storage.getFocusFavorites()).toEqual(['/r1/restored'])
    storage.setFocusFavorites(['/r1/a'])
    expect(storage.getFocusFavorites()).toEqual(['/r1/a'])
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ focusFavorites: ['/r1/a'] })
    expect(b.bridge.state.setFolder).not.toHaveBeenCalled()
    b.emit({ ...defaultAppState(), sidebarWidth: 333 })
    expect(storage.getFocusFavorites()).toEqual(['/r1/a'])
    storage.setRoot('/r2')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r2', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), focusDirs: [], focusTopics: [], focusFavorites: [] })
    expect(storage.getFocusFavorites()).toEqual([])
  })

  it('focusDirs / focusTopics are this window identity (YAZ-1628): one list per lens through window.setIdentity, deaf to state broadcasts, cleared by a root change', async () => {
    b = installBridge(defaultAppState(), { id: 'w1', root: '/r1', file: null, tabs: [], focusDirs: ['/r1/restored'] })
    await storage.init()
    expect(storage.getFocusDirs()).toEqual(['/r1/restored']) // restored from main at boot, like sidebarCollapsed
    expect(storage.getFocusTopics()).toEqual([])
    storage.setFocusDirs(['/r1/a', '/r1/b'])
    storage.setFocusTopics(['/r1/Admin.md'])
    expect(storage.getFocusDirs()).toEqual(['/r1/a', '/r1/b'])
    expect(storage.getFocusTopics()).toEqual(['/r1/Admin.md'])
    expect(b.bridge.window.setIdentity).toHaveBeenCalledWith({ focusDirs: ['/r1/a', '/r1/b'] })
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ focusTopics: ['/r1/Admin.md'] })
    expect(b.bridge.state.setFolder).not.toHaveBeenCalled() // never the per-vault bucket
    // One lens' exit never touches the other lens' focus.
    storage.setFocusDirs([])
    expect(storage.getFocusDirs()).toEqual([])
    expect(storage.getFocusTopics()).toEqual(['/r1/Admin.md'])
    // Another window's write lands as a state broadcast; it cannot move THIS window's focus.
    b.emit({ ...defaultAppState(), sidebarWidth: 333 })
    expect(storage.getSidebarWidth()).toBe(333)
    expect(storage.getFocusTopics()).toEqual(['/r1/Admin.md'])
    // Re-setting the same root keeps both lists; a different root clears them in the root write itself.
    storage.setRoot('/r1')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r1' })
    expect(storage.getFocusTopics()).toEqual(['/r1/Admin.md'])
    storage.setRoot('/r2')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r2', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), focusDirs: [], focusTopics: [], focusFavorites: [] })
    expect(storage.getFocusDirs()).toEqual([])
    expect(storage.getFocusTopics()).toEqual([])
  })

  it('sidebarCollapsed is this window identity and round-trips through window.setIdentity', () => {
    expect(storage.getSidebarCollapsed()).toBe(false)
    storage.setSidebarCollapsed(true)
    expect(storage.getSidebarCollapsed()).toBe(true)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarCollapsed: true })
    storage.setSidebarCollapsed(false)
    expect(storage.getSidebarCollapsed()).toBe(false)
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarCollapsed: false })
  })

  it('sidebarLens is this window identity (YAZ-847, per window since YAZ-1628): restored at boot, written through window.setIdentity, deaf to state broadcasts, kept by a root change', async () => {
    expect(storage.getSidebarLens()).toBe('topics')
    storage.setSidebarLens('files')
    expect(storage.getSidebarLens()).toBe('files')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarLens: 'files' })
    storage.setSidebarLens('topics')
    expect(storage.getSidebarLens()).toBe('topics')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ sidebarLens: 'topics' })
    // Restored from main at boot, like sidebarCollapsed.
    b = installBridge(defaultAppState(), { id: 'w1', root: '/r1', file: null, tabs: [], sidebarLens: 'files' })
    await storage.init()
    expect(storage.getSidebarLens()).toBe('files')
    // Another window's write lands as a state broadcast; it cannot move THIS window's lens.
    b.emit({ ...defaultAppState(), sidebarWidth: 333 })
    expect(storage.getSidebarWidth()).toBe(333)
    expect(storage.getSidebarLens()).toBe('files')
    // A root change keeps it: the lens is a view preference, not vault content.
    storage.setRoot('/r2')
    expect(b.bridge.window.setIdentity).toHaveBeenLastCalledWith({ root: '/r2', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), focusDirs: [], focusTopics: [], focusFavorites: [] })
    expect(storage.getSidebarLens()).toBe('files')
  })

  it('settings default and round-trip through the bridge', () => {
    expect(storage.getSettings()).toEqual(DEFAULT_SETTINGS)
    const next = { ...DEFAULT_SETTINGS, lineSpacing: 2.0, blockGap: 12, bulletThreading: false, threadWidth: 1, threadColor: '#00AAff' }
    storage.setSettings(next)
    expect(storage.getSettings()).toEqual(next)
    expect(b.bridge.state.setSettings).toHaveBeenCalledWith(next)
  })

  it('a state:changed broadcast replaces the cache and notifies subscribers; unsubscribe stops them', () => {
    const seen = vi.fn()
    const off = storage.subscribe(seen)
    const next: AppState = {
      ...defaultAppState(),
      settings: { ...DEFAULT_SETTINGS, threadWidth: 3 },
      folders: { '/v': { expanded: [], lastFile: null, folds: { '/v/a.md': ['z'] }, baseGroups: {}, topicsExpanded: [] } },
    }
    b.emit(next)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(storage.getSettings().threadWidth).toBe(3)
    expect(storage.getSidebarCollapsed()).toBe(false) // another window's global-state broadcast cannot change this identity
    expect(storage.getSidebarLens()).toBe('topics') // nor the lens (YAZ-1628)
    expect(storage.getFolds('/v', '/v/a.md')).toEqual(['z'])
    off()
    b.emit(defaultAppState())
    expect(seen).toHaveBeenCalledTimes(1)
    expect(storage.getSidebarCollapsed()).toBe(false)
  })

  it('local writes do not notify subscribers (the broadcast echo does)', () => {
    const seen = vi.fn()
    storage.subscribe(seen)
    storage.setSidebarCollapsed(true)
    storage.setSettings({ ...DEFAULT_SETTINGS, blockGap: 8 })
    expect(seen).not.toHaveBeenCalled()
  })

  it('a failed bridge write is logged once and the optimistic cache value stays', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    b.bridge.state.setSettings.mockRejectedValueOnce({ code: 'BAD_REQUEST', message: 'nope' })
    storage.setSettings({ ...DEFAULT_SETTINGS, blockGap: 2 })
    await flushMicrotasks()
    expect(error).toHaveBeenCalledTimes(1)
    expect(storage.getSettings().blockGap).toBe(2)
  })
})
