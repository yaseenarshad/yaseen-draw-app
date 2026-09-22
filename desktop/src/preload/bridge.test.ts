import { describe, expect, it, vi } from 'vitest'
import type { ComponentsApi, DialogApi, DrawingApi, FavoritesApi, FileApi, FileClipState, GithubApi, GithubSyncStatus, LinkApi, MediaApi, MenuApi, SecretsApi, ShellApi, StateApi, VaultConfigApi, WatchEvent, WindowApi, YaseenDrawApi } from '@shared/types'
import { CH } from '../channels'

const exposed: Record<string, unknown> = {}
vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, value: unknown) => void (exposed[name] = value) },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

/**
 * Compile-time exhaustive: adding a method to the contract without listing it here fails
 * typecheck. `as const satisfies` keeps each tuple's literal type (a plain `readonly (keyof T)[]`
 * annotation would widen it and make `Exhaustive<>` vacuous) while still rejecting typos.
 */
const TOP = ['tree', 'readFile', 'writeFile', 'createDir', 'createFile', 'drawing', 'pickFolder', 'dialog', 'watch', 'state', 'window', 'menu', 'link', 'file', 'shell', 'vaultConfig', 'favorites', 'media', 'components', 'secrets', 'github'] as const satisfies readonly (keyof YaseenDrawApi)[]
const STATE = ['get', 'setSettings', 'setSidebarWidth', 'pushRecent', 'removeRecent', 'setFolder', 'onChange'] as const satisfies readonly (keyof StateApi)[]
const WINDOW = ['identity', 'setIdentity', 'open', 'duplicate', 'openRecent', 'closeSelf', 'zoom', 'onFlush'] as const satisfies readonly (keyof WindowApi)[]
const MENU = ['onOpenFolder', 'onOpenRoot', 'onSearch', 'onSwitchVault', 'onSettings', 'onToggleSidebar', 'onCloseTab', 'onNextTab', 'onPrevTab', 'onExportImage', 'onCanvasBackground', 'onExportDrawing'] as const satisfies readonly (keyof MenuApi)[]
const LINK = ['onOpenFile', 'onNotice'] as const satisfies readonly (keyof LinkApi)[]
const FILE = ['rename', 'onRenamed', 'delete', 'onDeleted', 'clip', 'paste', 'clipState', 'onClipChanged'] as const satisfies readonly (keyof FileApi)[]
const SHELL = ['reveal', 'openVsCode', 'openDefault', 'openLink'] as const satisfies readonly (keyof ShellApi)[]
const VAULT_CONFIG = ['read', 'write', 'onChange'] as const satisfies readonly (keyof VaultConfigApi)[]
const FAVORITES = ['get', 'set', 'onChanged'] as const satisfies readonly (keyof FavoritesApi)[]
const DRAWING = ['load', 'save', 'libraryFolder'] as const satisfies readonly (keyof DrawingApi)[]
const DIALOG = ['openDrawing', 'saveDrawing'] as const satisfies readonly (keyof DialogApi)[]
const GITHUB = ['status', 'syncNow', 'setEnabled', 'onStatus'] as const satisfies readonly (keyof GithubApi)[]
const MEDIA = ['favorites', 'recent', 'onChanged', 'search', 'preview', 'import'] as const satisfies readonly (keyof MediaApi)[]
const COMPONENTS = ['list', 'save', 'read', 'rename', 'delete', 'preview', 'onChanged'] as const satisfies readonly (keyof ComponentsApi)[]
const SECRETS = ['set', 'has'] as const satisfies readonly (keyof SecretsApi)[]
type Exhaustive<T, K extends readonly (keyof T)[]> = Exclude<keyof T, K[number]> extends never ? true : never
const _top: Exhaustive<YaseenDrawApi, typeof TOP> = true
const _state: Exhaustive<StateApi, typeof STATE> = true
const _window: Exhaustive<WindowApi, typeof WINDOW> = true
const _menu: Exhaustive<MenuApi, typeof MENU> = true
const _link: Exhaustive<LinkApi, typeof LINK> = true
const _file: Exhaustive<FileApi, typeof FILE> = true
const _shell: Exhaustive<ShellApi, typeof SHELL> = true
const _vaultConfig: Exhaustive<VaultConfigApi, typeof VAULT_CONFIG> = true
const _favorites: Exhaustive<FavoritesApi, typeof FAVORITES> = true
const _drawing: Exhaustive<DrawingApi, typeof DRAWING> = true
const _dialog: Exhaustive<DialogApi, typeof DIALOG> = true
const _github: Exhaustive<GithubApi, typeof GITHUB> = true
const _media: Exhaustive<MediaApi, typeof MEDIA> = true
const _components: Exhaustive<ComponentsApi, typeof COMPONENTS> = true
const _secrets: Exhaustive<SecretsApi, typeof SECRETS> = true
void [_top, _state, _window, _menu, _link, _file, _shell, _vaultConfig, _favorites, _drawing, _dialog, _github, _media, _components, _secrets]

describe('preload bridge', () => {
  it('installs window.yaseenDraw with every contract method', async () => {
    await import('./index')
    const api = exposed.yaseenDraw as YaseenDrawApi
    expect(api).toBeDefined()
    for (const k of TOP) expect(api[k], k).toBeDefined()
    for (const k of STATE) expect(typeof api.state[k], `state.${k}`).toBe('function')
    for (const k of WINDOW) expect(typeof api.window[k], `window.${k}`).toBe('function')
    for (const k of MENU) expect(typeof api.menu[k], `menu.${k}`).toBe('function')
    for (const k of LINK) expect(typeof api.link[k], `link.${k}`).toBe('function')
    for (const k of FILE) expect(typeof api.file[k], `file.${k}`).toBe('function')
    for (const k of SHELL) expect(typeof api.shell[k], `shell.${k}`).toBe('function')
    for (const k of VAULT_CONFIG) expect(typeof api.vaultConfig[k], `vaultConfig.${k}`).toBe('function')
    for (const k of FAVORITES) expect(typeof api.favorites[k], `favorites.${k}`).toBe('function')
    for (const k of GITHUB) expect(typeof api.github[k], `github.${k}`).toBe('function')
    for (const k of MEDIA) expect(typeof api.media[k], `media.${k}`).toBe('function')
    for (const k of COMPONENTS) expect(typeof api.components[k], `components.${k}`).toBe('function')
    for (const k of DIALOG) expect(typeof api.dialog[k], `dialog.${k}`).toBe('function')
    for (const k of SECRETS) expect(typeof api.secrets[k], `secrets.${k}`).toBe('function')
  })

  it('media.favorites / media.recent invoke their channels with the request; media:changed reaches the listener (🔒 D5)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: [] })
    await expect(bridge.media.favorites({ op: 'list' })).resolves.toEqual([])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.mediaFavorites, { op: 'list' })
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: [] })
    await expect(bridge.media.recent({ op: 'list' })).resolves.toEqual([])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.mediaRecent, { op: 'list' })
    const listener = vi.fn()
    const off = bridge.media.onChanged(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.mediaChanged)
    const emit = calls[calls.length - 1]?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.mediaChanged && l === emit)).toBe(true)
  })

  it('components.* invoke their channels with the request; components:changed reaches the listener (🔒 D5)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: [] })
    await expect(bridge.components.list()).resolves.toEqual([])
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.componentsList)
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: { fragmentJson: '{}' } })
    await expect(bridge.components.read({ slug: 'a-card' })).resolves.toEqual({ fragmentJson: '{}' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.componentsRead, { slug: 'a-card' })
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    await expect(bridge.components.delete({ slug: 'a-card' })).resolves.toBeUndefined()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.componentsDelete, { slug: 'a-card' })
    const listener = vi.fn()
    const off = bridge.components.onChanged(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.componentsChanged)
    const emit = calls[calls.length - 1]?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.componentsChanged && l === emit)).toBe(true)
  })

  it('secrets.set / secrets.has invoke secrets:set and secrets:has — and there is no secrets.get (🔒 D4)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    await expect(bridge.secrets.set({ name: 'pixabayApiKey', value: 'k' })).resolves.toBeUndefined()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.secretsSet, { name: 'pixabayApiKey', value: 'k' })
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: true })
    await expect(bridge.secrets.has({ name: 'pixabayApiKey' })).resolves.toBe(true)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.secretsHas, { name: 'pixabayApiKey' })
    expect(Object.keys(bridge.secrets).sort()).toEqual(['has', 'set'])
  })

  it('github.setEnabled invokes github:set-enabled with the root and the flag (YAZ-1081)', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: { root: '/v', state: 'synced' } })
    const { bridge } = await import('./index')
    await expect(bridge.github.setEnabled('/v', true)).resolves.toEqual({ root: '/v', state: 'synced' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.githubSetEnabled, '/v', true)
  })

  it('forwards github:status-changed payloads to the listener and unsubscribes cleanly (YAZ-1081)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.github.onStatus(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.githubStatusChanged)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, status: GithubSyncStatus) => void
    emit(undefined, { root: '/v', state: 'pending' })
    expect(listener).toHaveBeenCalledWith({ root: '/v', state: 'pending' })
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.githubStatusChanged && l === emit)).toBe(true)
  })

  it('forwards link:open-file paths to the listener and unsubscribes cleanly (E1, GRO-2171)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.link.onOpenFile(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.linkOpenFile)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, path: string) => void
    emit(undefined, '/vaults/notes/a.excalidraw')
    expect(listener).toHaveBeenCalledWith('/vaults/notes/a.excalidraw')
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.linkOpenFile && l === emit)).toBe(true)
  })

  it('forwards file:renamed payloads to the listener and unsubscribes cleanly (Links E1, GRO-2194)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.file.onRenamed(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.fileRenamed)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, ev: { oldPath: string; newPath: string }) => void
    emit(undefined, { oldPath: '/vaults/notes/a.excalidraw', newPath: '/vaults/notes/b.excalidraw' })
    expect(listener).toHaveBeenCalledWith({ oldPath: '/vaults/notes/a.excalidraw', newPath: '/vaults/notes/b.excalidraw' })
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.fileRenamed && l === emit)).toBe(true)
  })

  it('file.rename invokes fs:rename with the request (Links E1, GRO-2194)', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: { oldPath: '/v/a.excalidraw', newPath: '/v/b.excalidraw' } })
    const { bridge } = await import('./index')
    await expect(bridge.file.rename({ oldPath: '/v/a.excalidraw', newPath: '/v/b.excalidraw' })).resolves.toEqual({ oldPath: '/v/a.excalidraw', newPath: '/v/b.excalidraw' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.fsRename, { oldPath: '/v/a.excalidraw', newPath: '/v/b.excalidraw' })
  })

  it('shell.openLink invokes shell:open-link with href and source note', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    const { bridge } = await import('./index')
    const req = { href: 'JSONs/example.json', sourcePath: '/vault/Note.excalidraw' }

    await expect(bridge.shell.openLink(req)).resolves.toBeUndefined()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.shellOpenLink, req)
  })

  it('file.clip / file.paste invoke fs:clip and fs:paste with the request (YAZ-1674)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    await expect(bridge.file.clip({ paths: ['/v/a.excalidraw'], op: 'cut' })).resolves.toBeUndefined()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.fsClip, { paths: ['/v/a.excalidraw'], op: 'cut' })
    const res = { pasted: [{ from: '/v/a.excalidraw', to: '/v/sub/a.excalidraw', kind: 'file' }], failed: [] }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: res })
    await expect(bridge.file.paste({ targetDir: '/v/sub' })).resolves.toEqual(res)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.fsPaste, { targetDir: '/v/sub' })
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: { count: 1, op: 'cut' } })
    await expect(bridge.file.clipState()).resolves.toEqual({ count: 1, op: 'cut' })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.fsClipState)
  })

  it('forwards clip:changed states (a count+op, then null) to the listener and unsubscribes cleanly (YAZ-1674)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.file.onClipChanged(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.clipChanged)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, state: FileClipState) => void
    emit(undefined, { count: 3, op: 'copy' })
    expect(listener).toHaveBeenCalledWith({ count: 3, op: 'copy' })
    emit(undefined, null)
    expect(listener).toHaveBeenLastCalledWith(null)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.clipChanged && l === emit)).toBe(true)
  })

  it('the drawing document`s two doors invoke drawing:load / drawing:save (🔒 YAZ-1810)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const loadReq = { root: '/v', path: 'Board.excalidraw' }
    const loaded = { path: '/v/Board.excalidraw', json: '{"elements":[]}', mtime: 1, size: 15, files: {}, stored: [] }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: loaded })
    await expect(bridge.drawing.load(loadReq)).resolves.toEqual(loaded)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.drawingLoad, loadReq)
    const saveReq = { root: '/v', path: 'Board.excalidraw', json: '{"elements":[]}', newFiles: [] }
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: { path: '/v/Board.excalidraw', mtime: 2, size: 15, persisted: [] } })
    await expect(bridge.drawing.save(saveReq)).resolves.toMatchObject({ mtime: 2 })
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.drawingSave, saveReq)
    // A failure comes back as the envelope's plain data, rethrown as-is.
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'drawing changed on disk since last read', mtime: 9 } })
    await expect(bridge.drawing.save(saveReq)).rejects.toEqual({ code: 'CONFLICT', message: 'drawing changed on disk since last read', mtime: 9 })
  })

  it('window.closeSelf invokes window:close-self (GRO-2232)', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    const { bridge } = await import('./index')
    await bridge.window.closeSelf()
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.windowCloseSelf)
  })

  it('forwards menu:close-tab to the listener and unsubscribes cleanly (GRO-2232)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onCloseTab(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuCloseTab)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuCloseTab && l === emit)).toBe(true)
  })

  it('forwards menu:search to the listener and unsubscribes cleanly (YAZ-804)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onSearch(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuSearch)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuSearch && l === emit)).toBe(true)
  })

  it('forwards menu:settings to the listener and unsubscribes cleanly (YAZ-1679)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onSettings(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuSettings)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuSettings && l === emit)).toBe(true)
  })

  it('forwards menu:toggle-sidebar to the listener and unsubscribes cleanly (YAZ-1280)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onToggleSidebar(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuToggleSidebar)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown) => void
    emit(undefined)
    expect(listener).toHaveBeenCalledTimes(1)
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuToggleSidebar && l === emit)).toBe(true)
  })

  it('window.zoom invokes window:zoom (YAZ-1710)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: true, value: undefined })
    await bridge.window.zoom(1)
    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CH.windowZoom, 1)
  })

  it('forwards menu:open-root paths to the listener and unsubscribes cleanly (GRO-2161)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const listener = vi.fn()
    const off = bridge.menu.onOpenRoot(listener)
    const calls = vi.mocked(ipcRenderer.on).mock.calls.filter(([ch]) => ch === CH.menuOpenRoot)
    const call = calls[calls.length - 1]
    expect(call).toBeDefined()
    const emit = call?.[1] as unknown as (e: unknown, path: string) => void
    emit(undefined, '/vaults/notes')
    expect(listener).toHaveBeenCalledWith('/vaults/notes')
    off()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.menuOpenRoot && l === emit)).toBe(true)
  })

  it('watch() multiplexes by subscription id: each listener gets only its own events; unsubscribe removes the listener and sends watch:unsubscribe', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    vi.mocked(ipcRenderer.send).mockClear()
    const a = vi.fn()
    const b = vi.fn()
    const offA = bridge.watch('/vault/a', a)
    const offB = bridge.watch('/vault/b', b)
    const subs = vi.mocked(ipcRenderer.send).mock.calls.filter(([ch]) => ch === CH.watchSubscribe)
    expect(subs).toHaveLength(2)
    const idA = (subs[0][1] as { id: string; root: string }).id
    const idB = (subs[1][1] as { id: string; root: string }).id
    expect(idA).not.toBe(idB)
    expect((subs[0][1] as { root: string }).root).toBe('/vault/a')
    expect((subs[1][1] as { root: string }).root).toBe('/vault/b')
    type WatchHandler = (e: unknown, msg: { id: string; ev: WatchEvent }) => void
    const handlers = vi
      .mocked(ipcRenderer.on)
      .mock.calls.filter(([ch]) => ch === CH.watchEvent)
      .map((c) => c[1] as unknown as WatchHandler)
      .slice(-2) // this test's two subscriptions (the module accumulates across tests)
    // Main fans every event out to every renderer listener on watch:event; the id filters them.
    const evA: WatchEvent = { type: 'change', path: '/vault/a/x.excalidraw', mtime: 1 }
    const evB: WatchEvent = { type: 'unlink', path: '/vault/b/y.excalidraw' }
    for (const h of handlers) h(undefined, { id: idA, ev: evA })
    for (const h of handlers) h(undefined, { id: idB, ev: evB })
    expect(a).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith(evA)
    expect(b).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledWith(evB)
    // Unsubscribe A: its watch:event listener is removed and main is told to drop the subscription.
    vi.mocked(ipcRenderer.send).mockClear()
    offA()
    expect(vi.mocked(ipcRenderer.removeListener).mock.calls.some(([ch, l]) => ch === CH.watchEvent && l === (handlers[0] as unknown))).toBe(true)
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.watchUnsubscribe, idA)
    // B is untouched by A's unsubscribe.
    for (const h of handlers) h(undefined, { id: idB, ev: evB })
    expect(b).toHaveBeenCalledTimes(2)
    offB()
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.watchUnsubscribe, idB)
  })

  it('rejects with the plain BridgeError when main answers an error envelope', async () => {
    const { ipcRenderer } = await import('electron')
    vi.mocked(ipcRenderer.invoke).mockResolvedValueOnce({ ok: false, error: { code: 'CONFLICT', message: 'newer on disk', mtime: 42 } })
    const { bridge } = await import('./index')
    await expect(bridge.writeFile({ path: '/x.excalidraw', content: '' })).rejects.toEqual({ code: 'CONFLICT', message: 'newer on disk', mtime: 42 })
  })

  it('acks app:flush only after every onFlush listener settled (GRO-2160 close handshake)', async () => {
    const { ipcRenderer } = await import('electron')
    const { bridge } = await import('./index')
    const call = vi.mocked(ipcRenderer.on).mock.calls.find(([ch]) => ch === CH.appFlush)
    expect(call).toBeDefined()
    const flushRequested = call?.[1] as unknown as () => void
    const settle = () => new Promise((r) => setTimeout(r))
    let release!: () => void
    const off = bridge.window.onFlush(() => new Promise<void>((r) => (release = r)))
    vi.mocked(ipcRenderer.send).mockClear()
    flushRequested()
    await settle()
    expect(ipcRenderer.send).not.toHaveBeenCalled()
    release()
    await settle()
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.appFlushed)
    // No listeners registered (Welcome window): the ack comes straight away.
    off()
    vi.mocked(ipcRenderer.send).mockClear()
    flushRequested()
    await settle()
    expect(ipcRenderer.send).toHaveBeenCalledWith(CH.appFlushed)
  })
})
