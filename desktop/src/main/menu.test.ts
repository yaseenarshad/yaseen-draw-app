import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MenuItemConstructorOptions } from 'electron'
import { defaultRightPanelIdentity, type RecentRoots, type WindowEntry } from '@shared/types'
import { CH } from '../channels'
import { createStore, type Store } from './store'
import { HELP_URL, buildContextMenuTemplate, buildMenuTemplate, createMenuHandlers, pickMenuTargetWindow, subscribeMenuRebuild, type ContextMenuActions, type MenuHandlers, type MenuHost } from './menu'

// ---------- buildMenuTemplate (pure) ----------

const noopHandlers = (): MenuHandlers => ({
  copyAs: vi.fn(),
  pasteAs: vi.fn(),
  newWindow: vi.fn(),
  switchVault: vi.fn(),
  openFolder: vi.fn(),
  openRecent: vi.fn(),
  search: vi.fn(),
  settings: vi.fn(),
  closeTab: vi.fn(),
  zoom: vi.fn(),
  nextTab: vi.fn(),
  prevTab: vi.fn(),
  toggleSidebar: vi.fn(),
  openHelp: vi.fn(),
})

const RECENTS: RecentRoots = [
  { path: '/vaults/notes', lastOpened: 3 },
  { path: '/vaults/work', lastOpened: 2 },
  { path: '/vaults/old', lastOpened: 1 },
]

function build(recents: RecentRoots = RECENTS, isDev = false, handlers: MenuHandlers = noopHandlers()) {
  return buildMenuTemplate({ recents, isDev }, handlers)
}

function menuOf(template: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const top = template.find((m) => m.label === label)
  expect(top, label).toBeDefined()
  return top?.submenu as MenuItemConstructorOptions[]
}

/** Fires a template item's click the way Electron does (menuItem, window, KeyboardEvent). */
function click(item: MenuItemConstructorOptions | undefined, event: { altKey?: boolean } = {}): void {
  expect(item?.click).toBeTypeOf('function')
  item?.click?.(undefined as never, undefined, event as never)
}

describe('buildMenuTemplate', () => {
  it('has the six menus in order', () => {
    expect(build().map((m) => m.label)).toEqual(['Yaseen Draw', 'File', 'Edit', 'View', 'Window', 'Help'])
  })

  it('App menu: About, Settings… ⌘, in its own group (YAZ-1679), the standard Hide roles, and Quit', () => {
    const handlers = noopHandlers()
    const app = menuOf(build(RECENTS, false, handlers), 'Yaseen Draw')
    expect(app.map((i) => i.role ?? i.type ?? i.id)).toEqual(['about', 'separator', 'menu.app.settings', 'separator', 'hide', 'hideOthers', 'unhide', 'separator', 'quit'])
    const settings = app.find((i) => i.label === 'Settings…')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    click(settings)
    expect(handlers.settings).toHaveBeenCalledTimes(1)
  })

  it('File menu: New Window ⌘⇧N, Switch Vault… ⌘O, Open Folder… ⌘⇧O, Open Recent, Search Vault ⌘K, Close Tab ⌘W, Close Window ⌘⇧W', () => {
    const handlers = noopHandlers()
    const file = menuOf(build(RECENTS, false, handlers), 'File')

    const newWindow = file.find((i) => i.label === 'New Window')
    expect(newWindow?.accelerator).toBe('CmdOrCtrl+Shift+N')
    click(newWindow)
    expect(handlers.newWindow).toHaveBeenCalledTimes(1)

    // ⌘O is Switch Vault… (YAZ-1767 D8): directly ABOVE Open Folder…, into the focused renderer.
    const switchVault = file.find((i) => i.label === 'Switch Vault…')
    expect(switchVault?.accelerator).toBe('CmdOrCtrl+O')
    click(switchVault)
    expect(handlers.switchVault).toHaveBeenCalledTimes(1)

    const openFolder = file.find((i) => i.label === 'Open Folder…')
    expect(openFolder?.accelerator).toBe('CmdOrCtrl+Shift+O')
    expect(file.indexOf(openFolder as MenuItemConstructorOptions)).toBe(file.indexOf(switchVault as MenuItemConstructorOptions) + 1)
    click(openFolder)
    expect(handlers.openFolder).toHaveBeenCalledTimes(1)

    expect(file.find((i) => i.label === 'Open Recent')).toBeDefined()

    // ⌘K is Search Vault (D4, YAZ-739 amended): its own group right below Open Recent.
    const search = file.find((i) => i.label === 'Search Vault')
    expect(search?.accelerator).toBe('CmdOrCtrl+K')
    expect(file.indexOf(search as MenuItemConstructorOptions)).toBe(file.findIndex((i) => i.label === 'Open Recent') + 2)
    click(search)
    expect(handlers.search).toHaveBeenCalledTimes(1)

    // ⌘W is Close Tab (GRO-2232, locked): a click item into the focused renderer, NOT the role.
    const closeTab = file.find((i) => i.label === 'Close Tab')
    expect(closeTab?.accelerator).toBe('CmdOrCtrl+W')
    expect(closeTab?.role).toBeUndefined()
    click(closeTab)
    expect(handlers.closeTab).toHaveBeenCalledTimes(1)

    // Close Window keeps role close (the flush-handshake OS close) on ⌘⇧W.
    const close = file.find((i) => i.label === 'Close Window')
    expect(close?.role).toBe('close')
    expect(close?.accelerator).toBe('CmdOrCtrl+Shift+W')
  })

  it('Open Recent lists recents in MRU order; plain click opens in place, ⌥-click beside', () => {
    const handlers = noopHandlers()
    const file = menuOf(build(RECENTS, false, handlers), 'File')
    const recent = file.find((i) => i.label === 'Open Recent')?.submenu as MenuItemConstructorOptions[]
    expect(recent.map((i) => i.label)).toEqual(['/vaults/notes', '/vaults/work', '/vaults/old'])

    click(recent[1])
    expect(handlers.openRecent).toHaveBeenLastCalledWith('/vaults/work', false)
    click(recent[0], { altKey: true })
    expect(handlers.openRecent).toHaveBeenLastCalledWith('/vaults/notes', true)
  })

  it('a programmatic click (menuItem.click(), no event — Playwright) opens in place, not a crash', () => {
    const handlers = noopHandlers()
    const file = menuOf(build(RECENTS, false, handlers), 'File')
    const recent = file.find((i) => i.label === 'Open Recent')?.submenu as MenuItemConstructorOptions[]
    recent[0].click?.(undefined as never, undefined, undefined as never)
    expect(handlers.openRecent).toHaveBeenCalledWith('/vaults/notes', false)
  })

  it('Open Recent with no recents shows one disabled placeholder', () => {
    const file = menuOf(build([]), 'File')
    const recent = file.find((i) => i.label === 'Open Recent')?.submenu as MenuItemConstructorOptions[]
    expect(recent).toEqual([{ label: 'No Recent Folders', enabled: false }])
  })

  it('Edit keeps native roles and adds explicit paste modes with one plain-text shortcut', () => {
    const handlers = noopHandlers()
    const items = menuOf(build(RECENTS, false, handlers), 'Edit')
    expect(items.map((i) => i.role ?? i.type ?? i.label)).toEqual(['undo', 'redo', 'separator', 'cut', 'copy', 'Copy as', 'paste', 'Paste as', 'selectAll'])
    const copyModes = items.find((i) => i.label === 'Copy as')?.submenu as MenuItemConstructorOptions[]
    expect(copyModes.map((i) => [i.label, i.accelerator])).toEqual([['Plain text', undefined], ['Markdown', undefined]])
    click(copyModes[0])
    click(copyModes[1])
    expect(vi.mocked(handlers.copyAs).mock.calls).toEqual([['plain'], ['markdown']])
    const modes = items.find((i) => i.label === 'Paste as')?.submenu as MenuItemConstructorOptions[]
    expect(modes.map((i) => [i.label, i.accelerator])).toEqual([['Plain text', 'CmdOrCtrl+Shift+V'], ['Markdown', undefined]])
    click(modes[0])
    click(modes[1])
    expect(vi.mocked(handlers.pasteAs).mock.calls).toEqual([['plain'], ['markdown']])
  })

  it('View menu: Toggle Sidebar, Reload, our own zoom items (not the roles); Toggle DevTools only in dev', () => {
    const handlers = noopHandlers()
    const view = menuOf(build(RECENTS, false, handlers), 'View')
    expect(view.map((i) => i.role).filter(Boolean)).toEqual(['reload'])
    const toggle = view.find((i) => i.label === 'Toggle Sidebar')
    click(toggle)
    expect(handlers.toggleSidebar).toHaveBeenCalledTimes(1)

    const dev = menuOf(build(RECENTS, true), 'View')
    expect(dev.map((i) => i.role).filter(Boolean)).toEqual(['reload', 'toggleDevTools'])
  })

  it('View › Actual Size / Zoom In / Zoom Out own ⌘0 / ⌘+ (and hidden ⌘=) / ⌘− and hand the step to handlers.zoom (YAZ-1710)', () => {
    const handlers = noopHandlers()
    const view = menuOf(build(RECENTS, false, handlers), 'View')
    const zoom = view.filter((i) => i.id?.startsWith('menu.view.zoom'))
    expect(zoom.map((i) => [i.id, i.label, i.accelerator, i.visible ?? true])).toEqual([
      ['menu.view.zoom-reset', 'Actual Size', 'CmdOrCtrl+0', true],
      ['menu.view.zoom-in', 'Zoom In', 'CmdOrCtrl+Plus', true],
      ['menu.view.zoom-in-eq', 'Zoom In', 'CmdOrCtrl+=', false],
      ['menu.view.zoom-out', 'Zoom Out', 'CmdOrCtrl+-', true],
    ])
    zoom.forEach((item) => click(item))
    expect(vi.mocked(handlers.zoom).mock.calls).toEqual([[0], [1], [1], [-1]])
  })

  it('Window menu: role window (macOS window list) with minimize / zoom, the tab-switching items, front', () => {
    const handlers = noopHandlers()
    const top = build(RECENTS, false, handlers).find((m) => m.label === 'Window')
    expect(top?.role).toBe('window')
    const items = top?.submenu as MenuItemConstructorOptions[]
    expect(items.map((i) => i.role ?? i.id ?? i.type)).toEqual([
      'minimize',
      'zoom',
      'separator',
      'menu.window.next-tab',
      'menu.window.prev-tab',
      'menu.window.next-tab-alt',
      'menu.window.prev-tab-alt',
      'separator',
      'front',
    ])
  })

  it('tab switching (GRO-2232): ⌃Tab / ⌃⇧Tab on the visible pair; hidden ⌘⇧] / ⌘⇧[ duplicates still fire', () => {
    const handlers = noopHandlers()
    const items = menuOf(build(RECENTS, false, handlers), 'Window')
    const byId = (id: string) => items.find((i) => i.id === id)

    const next = byId('menu.window.next-tab')
    expect(next?.label).toBe('Next Tab')
    expect(next?.accelerator).toBe('Control+Tab')
    click(next)
    expect(handlers.nextTab).toHaveBeenCalledTimes(1)

    const prev = byId('menu.window.prev-tab')
    expect(prev?.label).toBe('Previous Tab')
    expect(prev?.accelerator).toBe('Control+Shift+Tab')
    click(prev)
    expect(handlers.prevTab).toHaveBeenCalledTimes(1)

    // The second accelerator pair rides hidden duplicates (acceleratorWorksWhenHidden, macOS).
    const nextAlt = byId('menu.window.next-tab-alt')
    expect(nextAlt?.accelerator).toBe('CmdOrCtrl+Shift+]')
    expect(nextAlt?.visible).toBe(false)
    expect(nextAlt?.acceleratorWorksWhenHidden).toBe(true)
    click(nextAlt)
    expect(handlers.nextTab).toHaveBeenCalledTimes(2)

    const prevAlt = byId('menu.window.prev-tab-alt')
    expect(prevAlt?.accelerator).toBe('CmdOrCtrl+Shift+[')
    expect(prevAlt?.visible).toBe(false)
    expect(prevAlt?.acceleratorWorksWhenHidden).toBe(true)
    click(prevAlt)
    expect(handlers.prevTab).toHaveBeenCalledTimes(2)
  })

  it('Help menu: role help, GitHub link item', () => {
    const handlers = noopHandlers()
    const template = build(RECENTS, false, handlers)
    const top = template.find((m) => m.label === 'Help')
    expect(top?.role).toBe('help')
    const github = (top?.submenu as MenuItemConstructorOptions[]).find((i) => i.label === 'Yaseen Draw on GitHub')
    click(github)
    expect(handlers.openHelp).toHaveBeenCalledTimes(1)
  })

  it('actionable items carry stable ids so a live check can drive them', () => {
    const file = menuOf(build(), 'File')
    expect(file.find((i) => i.label === 'New Window')?.id).toBe('menu.file.new-window')
    expect(file.find((i) => i.label === 'Switch Vault…')?.id).toBe('menu.file.switch-vault')
    expect(file.find((i) => i.label === 'Open Folder…')?.id).toBe('menu.file.open-folder')
    expect(file.find((i) => i.label === 'Search Vault')?.id).toBe('menu.file.search')
    expect(file.find((i) => i.label === 'Close Tab')?.id).toBe('menu.file.close-tab')
    expect(file.find((i) => i.label === 'Close Window')?.id).toBe('menu.file.close-window')
    const recent = file.find((i) => i.label === 'Open Recent')?.submenu as MenuItemConstructorOptions[]
    expect(recent.map((i) => i.id)).toEqual(['menu.file.open-recent.0', 'menu.file.open-recent.1', 'menu.file.open-recent.2'])
    expect(menuOf(build(), 'View').find((i) => i.label === 'Toggle Sidebar')?.id).toBe('menu.view.toggle-sidebar')
    expect((build().find((m) => m.label === 'Help')?.submenu as MenuItemConstructorOptions[])[0].id).toBe('menu.help.github')
  })
})

// ---------- buildContextMenuTemplate (pure, YAZ-672) ----------

type ContextParams = Parameters<typeof buildContextMenuTemplate>[0]

const EDIT_FLAGS: ContextParams['editFlags'] = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: true }

const noopActions = (): ContextMenuActions => ({ copyAs: vi.fn(), pasteAs: vi.fn(), replace: vi.fn(), addToDictionary: vi.fn(), copyImage: vi.fn(), revealImage: vi.fn() })

/** What Electron hands `context-menu`, defaulting to a clean right-click in an editable body. */
function context(params: Partial<ContextParams> = {}): ContextParams {
  return { misspelledWord: '', dictionarySuggestions: [], editFlags: EDIT_FLAGS, mediaType: 'none', srcURL: '', ...params }
}

const shapeOf = (items: MenuItemConstructorOptions[]) => items.map((i) => i.label ?? i.role ?? i.type)

describe('buildContextMenuTemplate', () => {
  it('a misspelling with suggestions: the suggestions, Add to Dictionary, then cut/copy/paste', () => {
    const items = buildContextMenuTemplate(context({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten', 'tea'] }), noopActions())
    expect(shapeOf(items)).toEqual(['the', 'ten', 'tea', 'separator', 'Add to Dictionary', 'separator', 'cut', 'copy', 'Copy as', 'paste', 'Paste as'])
  })

  it('a misspelling Electron has no suggestions for leads with Add to Dictionary — no dangling separator', () => {
    const items = buildContextMenuTemplate(context({ misspelledWord: 'Yaseen' }), noopActions())
    expect(shapeOf(items)).toEqual(['Add to Dictionary', 'separator', 'cut', 'copy', 'Copy as', 'paste', 'Paste as'])
  })

  it('nothing misspelled: still never empty — cut/copy/paste mirroring editFlags', () => {
    const items = buildContextMenuTemplate(context({ editFlags: { ...EDIT_FLAGS, canCut: false, canPaste: false } }), noopActions())
    expect(shapeOf(items)).toEqual(['cut', 'copy', 'Copy as', 'paste', 'Paste as'])
    expect(items.map((i) => i.enabled)).toEqual([false, true, true, false, false])
  })

  it('context copy modes follow canCopy and dispatch only to their supplied target', () => {
    const actions = noopActions()
    const items = buildContextMenuTemplate(context(), actions)
    const modes = items.find((i) => i.label === 'Copy as')?.submenu as MenuItemConstructorOptions[]
    expect(modes.every((i) => i.accelerator === undefined)).toBe(true)
    click(modes[0])
    click(modes[1])
    expect(vi.mocked(actions.copyAs).mock.calls).toEqual([['plain'], ['markdown']])
    const disabled = buildContextMenuTemplate(context({ editFlags: { ...EDIT_FLAGS, canCopy: false } }), actions)
    expect(disabled.find((i) => i.label === 'Copy as')?.enabled).toBe(false)
  })

  it('context paste modes call the supplied target and do not register duplicate accelerators', () => {
    const actions = noopActions()
    const items = buildContextMenuTemplate(context(), actions)
    const modes = items.find((i) => i.label === 'Paste as')?.submenu as MenuItemConstructorOptions[]
    expect(modes.every((i) => i.accelerator === undefined)).toBe(true)
    click(modes[0])
    click(modes[1])
    expect(vi.mocked(actions.pasteAs).mock.calls).toEqual([['plain'], ['markdown']])
  })

  it('clicking a suggestion replaces the word; Add to Dictionary teaches the misspelled one', () => {
    const actions = noopActions()
    const items = buildContextMenuTemplate(context({ misspelledWord: 'teh', dictionarySuggestions: ['the', 'ten'] }), actions)
    click(items.find((i) => i.label === 'ten'))
    expect(actions.replace).toHaveBeenCalledWith('ten')
    click(items.find((i) => i.label === 'Add to Dictionary'))
    expect(actions.addToDictionary).toHaveBeenCalledWith('teh')
  })

  // ---------- images (YAZ-1666) ----------

  it('an image under the cursor gets ONLY Copy Image and Reveal in Finder — no text rows, even mid-misspelling', () => {
    const src = 'app://vault/%2Fv/pics/pic.png?from=notes'
    const items = buildContextMenuTemplate(context({ mediaType: 'image', srcURL: src, misspelledWord: 'teh', dictionarySuggestions: ['the'] }), noopActions())
    expect(shapeOf(items)).toEqual(['Copy Image', 'Reveal in Finder'])
  })

  it('Copy Image copies; Reveal in Finder hands the src URL through verbatim for the apply layer to resolve', () => {
    const actions = noopActions()
    const src = 'app://vault/%2Fv/pics/a%20b.png'
    const items = buildContextMenuTemplate(context({ mediaType: 'image', srcURL: src }), actions)
    click(items[0])
    expect(actions.copyImage).toHaveBeenCalledTimes(1)
    click(items[1])
    expect(actions.revealImage).toHaveBeenCalledWith(src)
    expect(actions.copyAs).not.toHaveBeenCalled()
  })

  it('any other media type keeps the text menu unchanged', () => {
    for (const mediaType of ['none', 'video', 'canvas', 'file'] as const) {
      const items = buildContextMenuTemplate(context({ mediaType, srcURL: 'app://vault/%2Fv/x.mp4' }), noopActions())
      expect(shapeOf(items), mediaType).toEqual(['cut', 'copy', 'Copy as', 'paste', 'Paste as'])
    }
  })
})

// ---------- pickMenuTargetWindow (pure, GRO-2197) ----------

/** The structural slice the picker needs — no Electron anywhere. */
const fakeWin = (id: number, destroyed = false) => ({ webContents: { id }, isDestroyed: () => destroyed })

describe('pickMenuTargetWindow', () => {
  it('the OS-focused window always wins', () => {
    const focused = fakeWin(2)
    expect(pickMenuTargetWindow(focused, [fakeWin(1), focused, fakeWin(3)], 3)).toBe(focused)
  })

  it('no focused window (macOS, app not frontmost) → the last-focused live window', () => {
    const last = fakeWin(2)
    expect(pickMenuTargetWindow(null, [fakeWin(1), last, fakeWin(3)], 2)).toBe(last)
  })

  it('a destroyed last-focused window falls back to a live one', () => {
    const live = fakeWin(1)
    expect(pickMenuTargetWindow(null, [live, fakeWin(2, true)], 2)).toBe(live)
  })

  it('no last-focused id recorded yet → any live window (never a destroyed one)', () => {
    const live = fakeWin(2)
    expect(pickMenuTargetWindow(null, [fakeWin(1, true), live], undefined)).toBe(live)
  })

  it('a destroyed focused window is not a target either — the fallback chain runs', () => {
    const live = fakeWin(1)
    expect(pickMenuTargetWindow(fakeWin(9, true), [live], undefined)).toBe(live)
  })

  it('no windows at all → undefined', () => {
    expect(pickMenuTargetWindow(null, [], 1)).toBeUndefined()
  })
})

// ---------- createMenuHandlers, against fakes ----------

let dir: string
let store: Store
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-menu-'))
  store = createStore(path.join(dir, 'yaseendraw.json'))
})
afterEach(async () => {
  await store.flush()
  await rm(dir, { recursive: true, force: true })
})

const ENTRY: WindowEntry = { id: 'w1', root: '/vaults/notes', file: '/vaults/notes/a.md', tabs: ['/vaults/notes/a.md'], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } }

function makeHandlers(focused?: { id: number; send: ReturnType<typeof vi.fn> }) {
  // `openRecentBeside` is the window manager's door (YAZ-1767 D1); the probe/prune/bump rules are windows.test's.
  const windows = { idFor: vi.fn(), openRecentBeside: vi.fn(() => true), duplicateWindow: vi.fn() }
  const host: MenuHost = {
    focusedWebContents: () => focused,
    readClipboardText: vi.fn(() => '# Clipboard\n\nText'),
    openExternal: vi.fn(),
  }
  const handlers = createMenuHandlers(store, { ...windows, idFor: (wc: { id: number }) => (wc.id === 7 ? 'w1' : undefined) }, host)
  return { handlers, windows, host }
}

describe('createMenuHandlers', () => {
  it('copy modes request the selection from only the targeted window without reading the clipboard', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers, host } = makeHandlers(wc)
    handlers.copyAs('plain')
    handlers.copyAs('markdown')
    expect(wc.send.mock.calls).toEqual([[CH.menuCopyAs, 'plain'], [CH.menuCopyAs, 'markdown']])
    expect(host.readClipboardText).not.toHaveBeenCalled()
    expect(() => makeHandlers(undefined).handlers.copyAs('plain')).not.toThrow()
  })
  it('paste modes capture plain text only when there is a target and send the mode to that window', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers, host } = makeHandlers(wc)
    handlers.pasteAs('plain')
    handlers.pasteAs('markdown')
    expect(wc.send.mock.calls).toEqual([
      [CH.menuPasteAs, { mode: 'plain', text: '# Clipboard\n\nText' }],
      [CH.menuPasteAs, { mode: 'markdown', text: '# Clipboard\n\nText' }],
    ])
    expect(host.readClipboardText).toHaveBeenCalledTimes(2)
    const absent = makeHandlers(undefined)
    absent.handlers.pasteAs('plain')
    expect(absent.host.readClipboardText).not.toHaveBeenCalled()
  })

  it('newWindow duplicates the focused window entry', () => {
    store.upsertWindow(ENTRY)
    const wc = { id: 7, send: vi.fn() }
    const { handlers, windows } = makeHandlers(wc)
    handlers.newWindow()
    expect(windows.duplicateWindow).toHaveBeenCalledWith(ENTRY)
  })

  it('newWindow with no focused window is a no-op', () => {
    const { handlers, windows } = makeHandlers(undefined)
    handlers.newWindow()
    expect(windows.duplicateWindow).not.toHaveBeenCalled()
  })

  it('openFolder tells the focused renderer to run its pick-folder flow', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.openFolder()
    expect(wc.send).toHaveBeenCalledWith(CH.menuOpenFolder)
  })

  it('settings tells the focused renderer to open its settings dialog (YAZ-1679)', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.settings()
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(CH.menuSettings)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => unfocused.settings()).not.toThrow()
  })

  it('search tells the focused renderer to focus its search bar (D4, YAZ-804)', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.search()
    expect(wc.send).toHaveBeenCalledWith(CH.menuSearch)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => unfocused.search()).not.toThrow()
  })

  it('switchVault tells the focused renderer to open its vault switcher (YAZ-1767 D8)', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.switchVault()
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(CH.menuSwitchVault)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => unfocused.switchVault()).not.toThrow()
  })

  it('openRecent in place sends the path to the focused renderer', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers, windows } = makeHandlers(wc)
    handlers.openRecent('/vaults/work', false)
    expect(wc.send).toHaveBeenCalledWith(CH.menuOpenRoot, '/vaults/work')
    expect(windows.openRecentBeside).not.toHaveBeenCalled()
  })

  it('openRecent beside (⌥) goes through the window manager\'s one open-recent door (YAZ-1767 D1), never the renderer', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers, windows } = makeHandlers(wc)
    handlers.openRecent('/vaults/work', true)
    expect(windows.openRecentBeside).toHaveBeenCalledExactlyOnceWith('/vaults/work')
    expect(wc.send).not.toHaveBeenCalled()
    // The door's verdict (dead folder → false) is the manager's business; the menu ignores it.
    windows.openRecentBeside.mockReturnValueOnce(false)
    expect(() => handlers.openRecent('/vaults/gone', true)).not.toThrow()
    expect(wc.send).not.toHaveBeenCalled()
  })

  it('closeTab / nextTab / prevTab go to the focused renderer only (GRO-2232); no focused window is a no-op', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.closeTab()
    expect(wc.send).toHaveBeenLastCalledWith(CH.menuCloseTab)
    handlers.nextTab()
    expect(wc.send).toHaveBeenLastCalledWith(CH.menuNextTab)
    handlers.prevTab()
    expect(wc.send).toHaveBeenLastCalledWith(CH.menuPrevTab)
    expect(wc.send).toHaveBeenCalledTimes(3)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => {
      unfocused.closeTab()
      unfocused.nextTab()
      unfocused.prevTab()
    }).not.toThrow()
  })

  it('toggleSidebar tells only the focused renderer to run its window-local toggle', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.toggleSidebar()
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(CH.menuToggleSidebar)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => unfocused.toggleSidebar()).not.toThrow()
  })

  it('zoom forwards the step to the focused renderer only (YAZ-1710)', () => {
    const wc = { id: 7, send: vi.fn() }
    const { handlers } = makeHandlers(wc)
    handlers.zoom(1)
    expect(wc.send).toHaveBeenCalledExactlyOnceWith(CH.menuZoom, 1)

    const { handlers: unfocused } = makeHandlers(undefined)
    expect(() => unfocused.zoom(-1)).not.toThrow()
  })

  it('openHelp opens the repo README', () => {
    const { handlers, host } = makeHandlers(undefined)
    handlers.openHelp()
    expect(host.openExternal).toHaveBeenCalledWith(HELP_URL)
    expect(HELP_URL).toBe('https://github.com/yaseenarshad/yaseen-draw-app#readme')
  })
})

// ---------- subscribeMenuRebuild ----------

describe('subscribeMenuRebuild', () => {
  it('rebuilds when recents change, not on other writes', () => {
    const rebuild = vi.fn()
    subscribeMenuRebuild(store, rebuild)

    store.setSidebarWidth(321)
    store.setSettings(store.get().settings)
    store.upsertWindow(ENTRY)
    store.setFolder('/vaults/notes', { lastFile: null })
    expect(rebuild).not.toHaveBeenCalled()

    store.pushRecent('/vaults/notes')
    expect(rebuild).toHaveBeenCalledTimes(1)
    store.pushRecent('/vaults/work')
    expect(rebuild).toHaveBeenCalledTimes(2)
  })

  it('returns an unsubscribe', () => {
    const rebuild = vi.fn()
    const off = subscribeMenuRebuild(store, rebuild)
    off()
    store.pushRecent('/vaults/notes')
    expect(rebuild).not.toHaveBeenCalled()
  })
})
