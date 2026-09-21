/**
 * Sidebar file-row gestures: ⌘-click opens a BACKGROUND TAB in this window (I3 LOCKED ruling,
 * GRO-2235); the row's context-menu "Open in new window" still opens a new window on
 * {root, file} over the bridge (D2, GRO-2168) — either way the current window's active file
 * is untouched (onOpenFile never fires). Plain click and folder/blank-space context menus are
 * unchanged, and activating a stale tab probes a fresh tree before onFileMissing fires.
 * Real Tree/ContextMenu render against the jsdom bridge stub.
 */
import { newFolderPageProperties } from '../views/folderPageSettings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, defaultAppState, defaultRightPanelIdentity, type AppState, type FileClipRequest, type FileClipState, type PasteResponse, type TreeNode, type WatchEvent, type WindowIdentity } from '@shared/types'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import { EMPTY_SELECTION } from '../lib/selection'
// Focus Mode's persistence is the REAL storage module (no mock in this file): a spy on its read is
// how a test hands the Sidebar a focus restored from an earlier session (YAZ-1605).
import { storage } from '../lib/storage'

// Forward uses the one-key writer; reverse uses its shared whole-file transform because the
// migrated outline and flag must change atomically (YAZ-1022).
vi.mock('../views/writeProperty', () => ({ transformFile: vi.fn(), writeProperty: vi.fn() }))
import { transformFile, writeProperty } from '../views/writeProperty'
import { turnIntoFolderPage } from '../views/folderPageSettings'
import { countChildren, Sidebar, type SidebarClipboard } from './Sidebar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const TREE: TreeNode[] = [
  { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
  { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
]

/** Just the bridge surface the Sidebar tree touches (the jsdom stub pattern, App.test.tsx). */
function installBridge() {
  const bridge = {
    tree: vi.fn(async (root: string) => ({ root, tree: TREE, generatedAt: 1 })),
    // The delete confirm sheet reads the index for its backlink count (GRO-2272 C3).
    index: vi.fn(async (root: string) => ({ root, records: [] as unknown[], generatedAt: 1 })),
    // The inline-create flow (GRO-2022; "New folder page" YAZ-841). `createFile` takes the bare
    // path OR `{ path, content }` — the content form is the atomic born-with-frontmatter call.
    createFile: vi.fn(async (req: string | { path: string; content?: string }) => ({ path: typeof req === 'string' ? req : req.path, mtime: 2, size: 0 })),
    createDir: vi.fn(async (path: string) => ({ path })),
    // Birth from a Topics folder-page row (8H, YAZ-869) probes the folder page's template through
    // the ordinary readFile door. The default vault has none — the bridge rejects the way main
    // does, with a bare BridgeError object, which `api` gives its class back.
    readFile: vi.fn(async (path: string) => {
      throw { code: 'NOT_FOUND', message: `no such file: ${path}` }
    }),
    state: { get: vi.fn(async () => defaultAppState()), setFolder: vi.fn(async () => undefined), onChange: vi.fn((_listener: (state: AppState) => void) => () => undefined) },
    window: {
      open: vi.fn(async () => undefined),
      // Focus Mode is window identity (YAZ-1628): `storage.init()` boots from `identity`, writes go to `setIdentity`.
      identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: '/v', file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [] })),
      setIdentity: vi.fn(async () => undefined),
    },
    // The file clipboard (YAZ-1674, 🔒 D1) lives in main behind `file.*`: two invokes and the
    // `clip:changed` push every window gets. `onClipChanged` hands back an unsubscribe; a test that
    // wants to PUSH a state captures the listener through `mockImplementation`.
    file: {
      clip: vi.fn(async (_req: FileClipRequest) => undefined),
      paste: vi.fn(async (_req: { targetDir: string }): Promise<PasteResponse> => ({ pasted: [], failed: [] })),
      // Read ONCE on mount, so a window opened after a clip labels Paste from the start.
      clipState: vi.fn(async (): Promise<FileClipState> => null),
      onClipChanged: vi.fn((_listener: (state: FileClipState) => void) => () => undefined),
    },
    // The Favorites list (YAZ-1766 6A): `.yaseendocs/favorites.json` behind main; absolute paths both ways.
    // Empty by default; the favorites block seeds `get` and captures the `onChanged` listener.
    favorites: {
      get: vi.fn(async (_root: string): Promise<string[]> => []),
      set: vi.fn(async (_root: string, _paths: readonly string[]) => undefined),
      onChanged: vi.fn((_listener: (change: { root: string }) => void) => () => undefined),
    },
    // Reveal in Finder (GRO-2274) goes through the shell namespace.
    shell: {
      reveal: vi.fn(async ({ path }: { path: string }) => ({ path })),
      // Open in default app (YAZ-1577): the row with no viewer's click, and its menu item.
      openDefault: vi.fn(async ({ path }: { path: string }) => ({ path })),
    },
  }
  Object.defineProperty(window, 'yaseenDocs', { value: bridge, configurable: true, writable: true })
  return bridge
}

let root: Root | null = null
let container: HTMLElement | null = null

type SidebarProps = Parameters<typeof Sidebar>[0]

async function mount(over: Partial<SidebarProps> = {}, tweakBridge?: (bridge: ReturnType<typeof installBridge>) => unknown) {
  const bridge = installBridge()
  await tweakBridge?.(bridge) // before the first render: the loading/error tree states only exist there
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  const props: SidebarProps = {
    root: '/v',
    activeFile: null,
    watch: { subscribe: () => () => undefined },
    onOpenFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    // A folder search row (🔒 D3, YAZ-1491): App flips to Files and issues the reveal request.
    onRevealInFiles: vi.fn(),
    onPickFolder: vi.fn(),
    pickDisabled: false,
    // The header's vault switcher (YAZ-1767): 0 = no ⌘O pending; the panel itself is VaultSwitcher.test's subject.
    switcherOpenRequest: 0,
    onCollapse: vi.fn(),
    // Every test below this line is about the FILE TREE, so the harness mounts the FILES lens
    // (YAZ-847). The app's own default is Topics — App owns and persists the value, and the
    // "lens tabs" describe mounts each lens explicitly, including the default.
    lens: 'files',
    onLensChange: vi.fn(),
    revealRequest: null,
    onRevealConsumed: vi.fn(),
    settings: { ...DEFAULT_SETTINGS },
    onChangeSettings: vi.fn(),
    onOpenSettings: vi.fn(),
    onRootMissing: vi.fn(),
    onFileMissing: vi.fn(),
    onRenameFile: vi.fn(async () => undefined),
    onDeleteFile: vi.fn(async () => undefined),
    onNotice: vi.fn(),
    // The window's already-on index feed (WikilinkIndexBridge's source): empty unless a test
    // hands over a snapshot, which is exactly the pre-first-index state.
    indexSource: { resolve: null, records: [], subscribe: () => () => undefined },
    pendingSearchFocus: false,
    onSearchFocusHandled: vi.fn(),
    // 6C (YAZ-849): App's per-vault verdict, threaded to the Topics lens. False = adopted, the
    // ordinary case — the offer card is TopicsTree.test's own subject.
    unadopted: false,
    onCreateHome: vi.fn(),
    // ⌘⇧C's box (🔒 D4, YAZ-1338): App's in production, the harness's here — every mount gets a
    // fresh one, and the "hands its selection up" case reads it back.
    selectionRef: { current: EMPTY_SELECTION },
    // ⌘C / ⌘X / ⌘V's handle (D6 amended, YAZ-1674): App's listener asks it; the chord tests hold their own box.
    clipboardRef: { current: null },
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Sidebar {...props} /></StrictMode>))
  /** Re-render the SAME Sidebar instance with changed props (the App-driven activation path). */
  const rerender = async (next: Partial<SidebarProps>) =>
    act(async () => root?.render(<StrictMode><Sidebar {...props} {...next} /></StrictMode>))
  return { bridge, props, el, rerender }
}

const fileRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file')
const searchInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[aria-label="Search notes"]')
/**
 * Drive the CONTROLLED search input like a user: native value setter + input event (SettingsDialog
 * idiom). Async because the index feed is LAZY since YAZ-808 — the first non-empty query is what
 * starts the read, so a keystroke now has settling to do.
 */
const type = async (input: HTMLInputElement, value: string) => {
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const menuItems = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')]
const itemByLabel = (el: HTMLElement, label: string) => menuItems(el).find((b) => b.textContent === label)
/**
 * The "Open in ▸" flyout (D7 amended, YAZ-1674): open it (a click on the parent — hover works too)
 * and read its children. `subItemByLabel` is undefined when the parent is absent OR the child is
 * not offered, which is exactly the two "no such item" answers the gating tests below ask for.
 */
const openFlyout = (el: HTMLElement) => {
  const parent = itemByLabel(el, 'Open in')
  if (parent !== undefined) act(() => parent.click())
  return [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu__sub .ctx-menu__item')]
}
const subLabels = (el: HTMLElement) => openFlyout(el).map((b) => b.textContent)
const subItemByLabel = (el: HTMLElement, label: string) => openFlyout(el).find((b) => b.textContent === label)
/** Open the flyout OUTSIDE the click's own `act`: a nested `act` does not flush, so the child must exist before that act begins. */
const clickSub = (el: HTMLElement, label: string) => {
  const child = subItemByLabel(el, label)
  act(() => child?.click())
}
const clickSubAsync = async (el: HTMLElement, label: string) => {
  const child = subItemByLabel(el, label)
  await act(async () => child?.click())
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  delete (window as unknown as Record<string, unknown>).yaseenDocs
  vi.restoreAllMocks()
})

/**
 * A row with no in-app viewer (`kind: null`, YAZ-1577 D2): the OS default app IS the viewer, so
 * every open gesture hands the path to `shell.openDefault` and no tab callback fires. Shift is
 * still the selection gesture and still wins (YAZ-1336 🔒 D2).
 */
describe('rows with no viewer open in the OS default app (YAZ-1577 D2)', () => {
  const NO_VIEWER_TREE: TreeNode[] = [
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'book.epub', path: '/v/book.epub', size: 1, mtime: 1, kind: null },
  ]
  const withNoViewerTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: NO_VIEWER_TREE, generatedAt: 1 })
  const epubRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--file[title="/v/book.epub"]')

  it('is marked external and keeps its full filename; a viewer-able row is not marked', async () => {
    const { el } = await mount({}, withNoViewerTree)
    expect(epubRow(el)?.classList.contains('tree__row--external')).toBe(true)
    expect(epubRow(el)?.textContent).toBe('book.epub')
    expect(fileRow(el)?.classList.contains('tree__row--external')).toBe(false)
  })

  it('a plain click hands the path to the OS and opens no tab', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => epubRow(el)?.click())
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/book.epub' })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('⌘-click does the same — there is no tab to background', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => void epubRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/book.epub' })
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('shift-click selects the row and opens nothing anywhere', async () => {
    const { bridge, props, el } = await mount({}, withNoViewerTree)
    await act(async () => void epubRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(epubRow(el)?.classList.contains('tree__row--selected')).toBe(true)
    expect(bridge.shell.openDefault).not.toHaveBeenCalled()
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('a stale row (deleted outside the app) surfaces a passive notice', async () => {
    const { props, el } = await mount({}, (bridge) => {
      withNoViewerTree(bridge)
      bridge.shell.openDefault.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    })
    await act(async () => epubRow(el)?.click())
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t open "book.epub" — it is no longer there', 'error')
  })

  it('every file row\'s "Open in ▸" flyout offers "Default app" directly beside "VS Code" (D7 amended)', async () => {
    const { bridge, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = subLabels(el)
    expect(labels.indexOf('Default app')).toBe(labels.indexOf('VS Code') + 1)
    await clickSubAsync(el, 'Default app')
    expect(bridge.shell.openDefault).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
  })
})

describe('Sidebar file-row open gestures (D2 GRO-2168, I3 GRO-2235)', () => {
  it('a plain click on a file row opens it in place (onOpenFile), never over the bridge', async () => {
    const { bridge, props, el } = await mount()
    act(() => fileRow(el)?.click())
    expect(props.onOpenFile).toHaveBeenCalledWith('/v/a.md')
    expect(bridge.window.open).not.toHaveBeenCalled()
  })

  it('⌘-click on a file row opens a BACKGROUND TAB in this window (the LOCKED I3 ruling), never a new window', async () => {
    const { bridge, props, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(1)
    expect(props.onOpenFileBackground).toHaveBeenCalledWith('/v/a.md')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(bridge.window.open).not.toHaveBeenCalled()
  })

  it('the file row context menu offers "Open in ▸ New window" above "Copy path"; it routes to the bridge and closes', async () => {
    const { bridge, props, el } = await mount()
    act(() => void fileRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    const labels = menuItems(el).map((b) => b.textContent)
    expect(labels).toContain('Open in')
    expect(labels).toContain('Copy path')
    expect(subLabels(el)).toContain('New window')
    clickSub(el, 'New window')
    expect(bridge.window.open).toHaveBeenCalledTimes(1)
    expect(bridge.window.open).toHaveBeenCalledWith({ root: '/v', file: '/v/a.md' })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('folder rows and blank space get no "Open in new window" item', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
  })
})

describe('Sidebar view-only file routing (YAZ-1301)', () => {
  const VIEW_ONLY_TREE: TreeNode[] = [
    { type: 'file', name: 'data.json', path: '/v/data.json', size: 1, mtime: 1, kind: 'text' },
    { type: 'file', name: 'report.PDF', path: '/v/report.PDF', size: 1, mtime: 1, kind: 'pdf' },
  ]
  const withViewOnlyTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: VIEW_ONLY_TREE, generatedAt: 1 })

  it('shows exact extensions, selects the active file, and routes plain and command clicks through the existing tab callbacks', async () => {
    const { el, props } = await mount({ activeFile: '/v/data.json' }, withViewOnlyTree)
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.tree__row--file')]
    expect(rows.map((row) => row.textContent)).toEqual(['data.json', 'report.PDF'])
    expect(rows[0]?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    expect(rows[1]?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('false')

    act(() => rows[1]?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/report.PDF')
    act(() => void rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/data.json')
  })

  it.each([
    ['/v/data.json'],
    ['/v/report.PDF'],
  ] as const)('keeps %s on the standard file menu while hiding semantic Markdown actions', async (path) => {
    const { bridge, el, props } = await mount({ settings: { ...DEFAULT_SETTINGS, confirmDelete: false } }, withViewOnlyTree)
    const row = el.querySelector(`[title="${path}"]`)

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((item) => item.textContent)).toEqual(expect.arrayContaining([
      'Open in',
      'Copy path',
      'Rename',
      'Delete',
    ]))
    expect(subLabels(el)).toEqual(['New window', 'VS Code', 'Default app', 'Reveal in Finder'])
    expect(itemByLabel(el, 'Turn into folder page')).toBeUndefined()
    expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()

    clickSub(el, 'New window')
    expect(bridge.window.open).toHaveBeenCalledExactlyOnceWith({ root: '/v', file: path })

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path })

    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith(path)
  })
})

/**
 * "Copy link" is GONE (YAZ-1554): it sat directly under "Copy path" and the two were easy to
 * confuse, and the `[[` picker already links from inside a note. One tombstone test, so the
 * item cannot creep back on any row kind.
 */
describe('Sidebar copy link (retired, YAZ-1554)', () => {
  it('no row kind offers "Copy link" — file, folder or blank space — while "Copy path" stays', async () => {
    const { el } = await mount()
    for (const selector of ['.tree__row--file', '.tree__row--dir', '.sidebar__body']) {
      act(() => void el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      expect(itemByLabel(el, 'Copy link')).toBeUndefined()
      expect(itemByLabel(el, 'Copy path')).toBeDefined()
      act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    }
  })
})

describe('Sidebar folder rename + file drag-move (E1b, GRO-2241)', () => {
  /** Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard `dataTransfer` (the TabBar idiom). */
  const fire = (target: Element | null | undefined, type: string) =>
    act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))
  const dirRow = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.tree__row--dir')

  it.each([
    ['data.json', 'profile', '/v/profile.json', 'text'],
    ['report.PDF', 'brief.PDF', '/v/brief.PDF', 'pdf'],
  ] as const)('shows the full view-only filename for %s and renames it deterministically', async (name, nextName, target, kind) => {
    const node: TreeNode = { type: 'file', name, path: `/v/${name}`, size: 1, mtime: 1, kind }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    const row = el.querySelector<HTMLButtonElement>(`.tree__row--file[title="/v/${name}"]`)
    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe(name)
    act(() => {
      input!.value = nextName
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith(`/v/${name}`, target, 'file')
  })

  it('submitting an unchanged full view-only filename is a no-op', async () => {
    const node: TreeNode = { type: 'file', name: 'data.json', path: '/v/data.json', size: 1, mtime: 1, kind: 'text' }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('data.json')
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => undefined)
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('submitting an unchanged compound view-only filename is a no-op', async () => {
    const node: TreeNode = { type: 'file', name: 'schema.graphql.ts', path: '/v/schema.graphql.ts', size: 1, mtime: 1, kind: 'text' }
    const { props, el } = await mount({}, (bridge) =>
      bridge.tree.mockResolvedValue({ root: '/v', tree: [node], generatedAt: 1 }),
    )
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('schema.graphql.ts')
    act(() => input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    await act(async () => undefined)
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('a FOLDER row\'s context menu offers "Rename"; committing routes old→new (no extension logic) through onRenameFile', async () => {
    const { props, el } = await mount()
    act(() => void dirRow(el)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Rename')?.click())
    const input = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(input?.value).toBe('sub') // the raw folder name — no extension stripping for dirs
    act(() => {
      input!.value = 'archive'
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => undefined)
    expect(props.onRenameFile).toHaveBeenCalledWith('/v/sub', '/v/archive', 'dir')
  })

  it('dragging a file row onto a folder row moves it there (onRenameFile old→new parent); the target highlights while hovered', async () => {
    const { props, el } = await mount()
    fire(fileRow(el), 'dragstart')
    fire(dirRow(el), 'dragover')
    expect(dirRow(el)?.classList.contains('tree__row--drop')).toBe(true)
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).toHaveBeenCalledWith('/v/a.md', '/v/sub/a.md', 'file')
    expect(el.querySelector('.tree__row--drop')).toBeNull() // drag state cleared
  })

  it('dropping on the ROOT HEADER targets the vault root — a no-op for a file already there; dragend abandons cleanly', async () => {
    const { props, el } = await mount()
    const header = el.querySelector<HTMLElement>('.sidebar__header')
    fire(fileRow(el), 'dragstart')
    fire(header, 'dragover')
    expect(header?.classList.contains('sidebar__header--drop')).toBe(true)
    fire(header, 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // `/v/a.md` already lives at the root
    fire(fileRow(el), 'dragstart')
    fire(fileRow(el), 'dragend')
    fire(dirRow(el), 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled() // an abandoned drag drops nothing
  })
})

describe('Sidebar stale tab activation (I3, GRO-2235)', () => {
  it('activating a file the tree does not show probes a FRESH tree and fires onFileMissing when it is really gone', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: '/v/a.md' })
    bridge.tree.mockClear()
    await rerender({ activeFile: '/v/gone.md' })
    expect(bridge.tree).toHaveBeenCalledWith('/v') // the confirmation probe
    expect(props.onFileMissing).toHaveBeenCalledTimes(1)
  })

  it('a just-created file missing from the CACHED tree but present in the fresh one stays open (the inline-create race)', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: '/v/a.md' })
    const created: TreeNode = { type: 'file', name: 'new.md', path: '/v/new.md', size: 1, mtime: 2, kind: 'markdown' }
    bridge.tree.mockImplementation(async (r: string) => ({ root: r, tree: [...TREE, created], generatedAt: 2 }))
    await rerender({ activeFile: '/v/new.md' })
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })

  it('activating a file the cached tree shows probes nothing; out-of-root activations are skipped', async () => {
    const { bridge, props, rerender } = await mount({ activeFile: null })
    bridge.tree.mockClear()
    await rerender({ activeFile: '/v/a.md' }) // in the cached tree: no probe
    await rerender({ activeFile: '/elsewhere/pasted.md' }) // outside the root: never in the tree, never probed
    expect(bridge.tree).not.toHaveBeenCalled()
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })

  it('a file deleted WHILE active stays open: a tree refresh without an activation change never re-validates', async () => {
    // Boot on a: the first tree validates it. Then a is deleted on disk mid-edit — the
    // watcher-driven refresh delivers a tree WITHOUT it, but the boot validation is spent and
    // no activation changed, so nothing fires (the file is recreated by the next save).
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { bridge, props } = await mount({ activeFile: '/v/a.md', watch })
    bridge.tree.mockImplementation(async (r: string) => ({ root: r, tree: TREE.filter((n) => n.path !== '/v/a.md'), generatedAt: 3 }))
    await act(async () => emit?.({ type: 'unlink', path: '/v/a.md' }))
    expect(props.onFileMissing).not.toHaveBeenCalled()
  })
})

describe('Show in sidebar — Files reveal (YAZ-1063)', () => {
  const TARGET = '/v/target/deep/Note.md'
  const DEEP_TREE: TreeNode[] = [
    {
      type: 'dir', name: 'other', path: '/v/other',
      children: [{ type: 'file', name: 'Keep.md', path: '/v/other/Keep.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    {
      type: 'dir', name: 'target', path: '/v/target',
      children: [{
        type: 'dir', name: 'deep', path: '/v/target/deep',
        children: [{ type: 'file', name: 'Note.md', path: TARGET, size: 1, mtime: 1, kind: 'markdown' }],
      }],
    },
  ]
  const withDeepTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: DEEP_TREE, generatedAt: 1 })
  const dirRow = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')].find((row) => row.querySelector('.tree__label')?.textContent === label)

  it('waits for the initial tree snapshot, then opens only the missing ancestor chain and exposes an exact-path row', async () => {
    const { el, props } = await mount({ revealRequest: { id: 1, path: TARGET, lens: 'files' } }, withDeepTree)
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(dirRow(el, 'target')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'deep')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector(`[data-path="${TARGET}"]`)?.classList.contains('tree__row--revealed')).toBe(true)
  })

  it('preserves unrelated expansion when a later request opens the target chain', async () => {
    const { el, rerender } = await mount({}, withDeepTree)
    act(() => dirRow(el, 'other')?.click())
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    await rerender({ revealRequest: { id: 1, path: TARGET, lens: 'files' } })
    expect(dirRow(el, 'other')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'target')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
    expect(dirRow(el, 'deep')?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')).toBe('true')
  })

  it('reports one passive notice when the loaded Files tree cannot show the path', async () => {
    const { props } = await mount({ revealRequest: { id: 1, path: '/v/Missing.md', lens: 'files' } }, withDeepTree)
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "Missing.md" in Files — it is no longer there', 'error')
  })
})

/**
 * A launch shows the restored tab but does not open its folders (YAZ-1642, D2). Only the file the
 * Sidebar MOUNTS with is exempt; every later `activeFile` reveals exactly as before. Fresh vault per
 * mount (the expand-all idiom below): the app-state cache is module-level.
 */
describe('launch: the restored tab is shown, not revealed (YAZ-1642)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: path.split('/').pop()!, path, size: 1, mtime: 1, kind: 'markdown' })
  const DEEP = (v: string): TreeNode[] => [
    { type: 'dir', name: 'other', path: `${v}/other`, children: [note(`${v}/other/Keep.md`)] },
    { type: 'dir', name: 'target', path: `${v}/target`, children: [{ type: 'dir', name: 'deep', path: `${v}/target/deep`, children: [note(`${v}/target/deep/Note.md`)] }] },
  ]
  let vaults = 0
  const mountVault = async (activeFile: (v: string) => string) => {
    const v = `/v-launch-${++vaults}`
    const m = await mount({ root: v, activeFile: activeFile(v) }, (b) => b.tree.mockResolvedValue({ root: v, tree: DEEP(v), generatedAt: 1 } as never))
    return { ...m, v }
  }
  const isOpen = (el: HTMLElement, path: string) => el.querySelector(`.tree__row[data-path="${path}"]`)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')

  it('mounting with an active file leaves its ancestors closed', async () => {
    const { el, v } = await mountVault((v) => `${v}/target/deep/Note.md`)
    expect(isOpen(el, `${v}/target`)).toBe('false')
    expect(el.querySelector(`[data-path="${v}/target/deep/Note.md"]`)).toBeNull()
  })

  it('a file opened after the mount still opens its ancestors', async () => {
    const { el, v, rerender } = await mountVault((v) => `${v}/other/Keep.md`)
    expect(isOpen(el, `${v}/other`)).toBe('false')
    await rerender({ activeFile: `${v}/target/deep/Note.md` })
    expect(isOpen(el, `${v}/target`)).toBe('true')
    expect(isOpen(el, `${v}/target/deep`)).toBe('true')
    expect(isOpen(el, `${v}/other`)).toBe('false')
  })

  it('coming back to the restored tab after another file reveals it too', async () => {
    const { el, v, rerender } = await mountVault((v) => `${v}/target/deep/Note.md`)
    await rerender({ activeFile: `${v}/other/Keep.md` })
    expect(isOpen(el, `${v}/other`)).toBe('true')
    await rerender({ activeFile: `${v}/target/deep/Note.md` })
    expect(isOpen(el, `${v}/target`)).toBe('true')
    expect(isOpen(el, `${v}/target/deep`)).toBe('true')
  })
})

/**
 * The context menu's per-item TARGET matrix (GRO-2296). Each menu item resolves its own
 * target; no item derives its visibility from another item's value. These assertions are the
 * guard rail for GRO-2297 (blank-space Copy path → the vault ROOT), GRO-2302 (Reveal in
 * Finder) and GRO-2285 (Delete), all of which add items to this same menu: the blank-space
 * row below is what stops a root fallback for Copy path from silently switching on Rename
 * for the vault root, which main refuses outright (BAD_REQUEST, GRO-2241).
 */
describe('context menu target matrix (GRO-2296)', () => {
  const open = async (selector: string) => {
    const { el } = await mount()
    act(() => void el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return el
  }

  it('a FILE row targets every item: rename, copy path, open in new window', async () => {
    const el = await open('.tree__row--file')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(subItemByLabel(el, 'New window')).toBeDefined()
  })

  it('a FOLDER row targets rename and copy path; the file-only items stay hidden', async () => {
    const el = await open('.tree__row--dir')
    expect(itemByLabel(el, 'Rename')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
  })

  it('BLANK SPACE shows no Rename — the vault root is never renameable (the GRO-2297 guard rail)', async () => {
    const el = await open('.sidebar__body')
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
    expect(subItemByLabel(el, 'New window')).toBeUndefined()
    // The create actions are always available on blank space (they target the root) — and the
    // FILES lens keeps "New folder", which only the Topics lens drops (YAZ-948).
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(itemByLabel(el, 'New folder')).toBeDefined()
  })

  it('Rename on a FOLDER row opens the inline input in DIRECTORY mode (raw name, no extension logic)', async () => {
    const el = await open('.tree__row--dir')
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('sub')
  })

  it('Rename on a FILE row opens the inline input in FILE mode (extension stripped)', async () => {
    const el = await open('.tree__row--file')
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(el.querySelector<HTMLInputElement>('.create-inline__input')?.value).toBe('a')
  })
})

/**
 * Blank-space "Copy path" (GRO-2273): right-clicking below the tree copies the VAULT ROOT's
 * absolute path — the blank area already means "the root" everywhere else in this menu
 * (`targetDirFor` sends "New note" there). VS Code's empty-Explorer menu behaves the same.
 * Copy path only: Copy Relative Path was declined (LOCKED, GRO-2273).
 */
describe('blank-space copy path (GRO-2273)', () => {
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('copies the vault ROOT path, with no trailing slash, and closes the menu', async () => {
    const writeText = installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('/v')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('still offers no Rename on blank space — the root fallback must not leak into it', async () => {
    installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
  })

  it('file and folder rows still copy their OWN path, not the root', async () => {
    const writeText = installClipboard()
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledWith('/v/a.md')
    act(() => void el.querySelector('.tree__row--dir')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledWith('/v/sub')
  })
})

/**
 * Delete (GRO-2272 `C1-`/`C3-`): the menu entry, the confirm sheet, and what actually reaches
 * App. The blank-space case is the one that matters most — a destructive item must never
 * appear with no target, and main refuses the vault root anyway.
 */
describe('delete (GRO-2272)', () => {
  const openOn = async (selector: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over)
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const sheet = (el: HTMLElement) => el.querySelector('.confirm')
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  it('file and folder rows offer Delete; BLANK SPACE does not', async () => {
    const f = await openOn('.tree__row--file')
    expect(itemByLabel(f.el, 'Delete')).toBeDefined()
    const d = await openOn('.tree__row--dir')
    expect(itemByLabel(d.el, 'Delete')).toBeDefined()
    const b = await openOn('.sidebar__body')
    expect(itemByLabel(b.el, 'Delete')).toBeUndefined()
  })

  it('clicking Delete opens the confirm sheet and deletes NOTHING yet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)).not.toBeNull()
    expect(props.onDeleteFile).not.toHaveBeenCalled()
  })

  it('confirming calls onDeleteFile with the absolute path', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('cancelling calls nothing and closes the sheet', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(props.onDeleteFile).not.toHaveBeenCalled()
    expect(sheet(el)).toBeNull()
  })

  it('a FOLDER target shows the sheet and deletes the folder path', async () => {
    const { el, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)?.textContent).toContain('"sub"')
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })

  it('"Don\'t ask me again" persists confirmDelete: false through onChangeSettings', async () => {
    const { el, props } = await openOn('.tree__row--file')
    act(() => itemByLabel(el, 'Delete')?.click())
    act(() => void el.querySelector<HTMLInputElement>('.confirm__ask input')?.click())
    await act(async () => sheetBtn(el, 'Delete')?.click())
    expect(props.onChangeSettings).toHaveBeenCalledWith(expect.objectContaining({ confirmDelete: false }))
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('confirmDelete: false deletes DIRECTLY — no sheet at all (YAZ-857: the setting finally gates)', async () => {
    const { el, props } = await openOn('.tree__row--file', { settings: { ...DEFAULT_SETTINGS, confirmDelete: false } })
    act(() => itemByLabel(el, 'Delete')?.click())
    expect(sheet(el)).toBeNull()
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('shows the backlink count when notes link to the target', async () => {
    // One note whose body link resolves to a.md — the shared resolver is what countLinkReferences uses.
    // The TARGET must be in the record set too: the shared resolver resolves a link NAME
    // against the indexed records, so without a.md there is nothing for [[a]] to point at.
    // `basename` (no extension) and `folder` are what the shared resolver matches on — a
    // record missing them resolves nothing, which is how the first draft of this test passed
    // vacuously against an empty count.
    const rec = (base: string, links: string[] = []) => ({
      path: `/v/${base}.md`, name: `${base}.md`, basename: base, folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links, embeds: [],
    })
    const records = [rec('a'), rec('hub', ['a'])]
    const m = await mount()
    m.bridge.index.mockResolvedValue({ root: '/v', records, generatedAt: 1 } as never)
    act(() => void m.el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(m.el)?.textContent).toContain('1 note links to this')
  })

  it('says nothing about links when nothing links to the target', async () => {
    const { el } = await openOn('.tree__row--file')
    await act(async () => itemByLabel(el, 'Delete')?.click())
    await act(async () => undefined)
    expect(sheet(el)?.textContent).not.toContain('link to this')
    expect(sheet(el)?.textContent).not.toContain('links to this')
  })

  it('an unavailable index still opens the sheet and still deletes — a missing count never blocks', async () => {
    const m = await mount()
    m.bridge.index.mockRejectedValue(new Error('no index'))
    act(() => void m.el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    await act(async () => itemByLabel(m.el, 'Delete')?.click())
    expect(sheet(m.el)).not.toBeNull()
    await act(async () => sheetBtn(m.el, 'Delete')?.click())
    expect(m.props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })
})

describe('countChildren (GRO-2272 C3)', () => {
  const TREE_DEEP: TreeNode[] = [
    {
      type: 'dir',
      name: 'Docs',
      path: '/v/Docs',
      children: [
        { type: 'file', name: 'a.md', path: '/v/Docs/a.md', size: 1, mtime: 1, kind: 'markdown' },
        { type: 'dir', name: 'deep', path: '/v/Docs/deep', children: [{ type: 'file', name: 'b.md', path: '/v/Docs/deep/b.md', size: 1, mtime: 1, kind: 'markdown' }] },
      ],
    },
    { type: 'file', name: 'x.md', path: '/v/x.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('counts the WHOLE subtree, not just direct children — a delete takes all of it', () => {
    expect(countChildren(TREE_DEEP, '/v/Docs')).toEqual({ notes: 2, folders: 1 })
  })

  it('counts a nested folder found by descent', () => {
    expect(countChildren(TREE_DEEP, '/v/Docs/deep')).toEqual({ notes: 1, folders: 0 })
  })

  it('an unknown or empty folder counts zero rather than throwing', () => {
    expect(countChildren(TREE_DEEP, '/v/nope')).toEqual({ notes: 0, folders: 0 })
    expect(countChildren([], '/v/Docs')).toEqual({ notes: 0, folders: 0 })
  })
})

/**
 * Reveal in Finder (GRO-2274). Available on every row type AND on blank space, where it
 * targets the vault ROOT — the same target Copy path uses. Reveal-in-parent for all of them
 * (LOCKED, VS Code parity): there is no branching on kind, which is the point.
 */
describe('reveal in Finder (GRO-2274)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }

  it('a FILE row reveals its own path', async () => {
    const { el, bridge } = await openOn('.tree__row--file')
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/a.md' })
  })

  it('a FOLDER row reveals the folder itself — no branching on kind', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub' })
  })

  it('BLANK SPACE reveals the vault root — unlike Delete, which has no blank-space target', async () => {
    const { el, bridge } = await openOn('.sidebar__body')
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v' })
  })

  it('a stale row surfaces a passive notice rather than looking like a dead menu item', async () => {
    const { el, bridge, props } = await openOn('.tree__row--file')
    bridge.shell.reveal.mockRejectedValue(Object.assign(new Error('path does not exist'), { code: 'NOT_FOUND' }))
    await clickSubAsync(el, 'Reveal in Finder')
    await act(async () => undefined)
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('no longer there'), 'error')
  })

  it('closes the menu after revealing', async () => {
    const { el } = await openOn('.tree__row--file')
    clickSub(el, 'Reveal in Finder')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * Menu ORDER (GRO-2272 `C1a-`, LOCKED): VS Code's Explorer grouping — read-only utilities
 * first, then the create actions, then Rename and Delete LAST. Pinned here because order is a
 * deliberate safety property, not an accident of JSX: Delete used to sit directly under
 * Rename, which is the misclick pair that matters most.
 */
/**
 * The persistent search bar (YAZ-801): row 2 of the sidebar chrome, ALWAYS present — loading,
 * error and empty vault included, since a bar that comes and goes with the tree would be a view,
 * which is exactly what the rescinded design was. Typing changes nothing below on purpose;
 * YAZ-803 swaps the body to results. The ⌘K focus handshake has no key binding yet (YAZ-804),
 * so it is driven here through the prop — including at MOUNT, which is the ⌘K-while-collapsed path.
 */
describe('persistent search bar (YAZ-801)', () => {
  const pressEscape = (input: HTMLInputElement) => act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

  it('renders while the tree is still loading', async () => {
    const { el } = await mount({}, (b) => b.tree.mockImplementation(() => new Promise(() => undefined)))
    expect(el.textContent).toContain('Loading…')
    expect(searchInput(el)).not.toBeNull()
  })

  it('renders when the tree failed to load', async () => {
    const { el } = await mount({}, (b) => b.tree.mockRejectedValue(new Error('nope')))
    expect(el.querySelector('.sidebar__msg--error')).not.toBeNull()
    expect(searchInput(el)).not.toBeNull()
  })

  it('renders in an empty vault', async () => {
    const { el } = await mount({}, (b) => b.tree.mockImplementation(async (r: string) => ({ root: r, tree: [], generatedAt: 1 })))
    expect(el.textContent).toContain('No notes here.')
    expect(searchInput(el)).not.toBeNull()
  })

  it('typing updates the query', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    await type(input, 'meeting')
    expect(input.value).toBe('meeting')
  })

  it('Escape with text clears the query and KEEPS focus', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    act(() => input.focus())
    await type(input, 'meeting')
    pressEscape(input)
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
  })

  it('Escape with an empty input gives up focus', async () => {
    const { el } = await mount()
    const input = searchInput(el)!
    act(() => input.focus())
    pressEscape(input)
    expect(document.activeElement).not.toBe(input)
  })

  it('mounting with pendingSearchFocus focuses the input and reports back (⌘K while collapsed)', async () => {
    const { el, props } = await mount({ pendingSearchFocus: true })
    expect(document.activeElement).toBe(searchInput(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('flipping pendingSearchFocus false → true on a mounted sidebar focuses the input and reports back', async () => {
    const { el, props, rerender } = await mount()
    expect(document.activeElement).not.toBe(searchInput(el))
    await rerender({ pendingSearchFocus: true })
    expect(document.activeElement).toBe(searchInput(el))
    expect(props.onSearchFocusHandled).toHaveBeenCalled()
  })

  it('a plain mount steals no focus', async () => {
    const { el, props } = await mount()
    expect(document.activeElement).not.toBe(searchInput(el))
    expect(props.onSearchFocusHandled).not.toHaveBeenCalled()
  })
})

/**
 * Search results in the body (YAZ-803, 🔒 flat-list ruling on YAZ-739): a typed query swaps the
 * tree for a FLAT ranked list and clearing brings the tree straight back — the swap is a
 * conditional render, so nothing about the tree is torn down. The list is driven entirely from
 * the bar, which never loses focus: arrows clamp at both ends (no wrap, the `[[` picker's rule),
 * Enter opens in place, ⌘Enter in a background tab, and the list stays up either way.
 */
describe('search results (YAZ-803)', () => {
  const record = (basename: string, folder = '') => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`, name: `${basename}.md`, basename, folder, ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  })
  const RECORDS = [record('Alpha'), record('Anchor', 'Docs')]

  /** Mount over an index of Alpha + Docs/Anchor, then type `query` into the bar. */
  const search = async (query: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over, (b) => b.index.mockResolvedValue({ root: '/v', records: RECORDS, generatedAt: 1 } as never))
    const input = searchInput(m.el)!
    await type(input, query)
    return { ...m, input }
  }
  const rowLabels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__row .search-results__label')].map((n) => n.textContent)
  const activeLabel = (el: HTMLElement) => el.querySelector('.search-results__row--active .search-results__label')?.textContent ?? null
  const press = (input: HTMLInputElement, key: string, metaKey = false) =>
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))

  it('typing swaps the tree for the ranked result list; clearing brings the tree back', async () => {
    const { el, input } = await search('a')
    expect(el.querySelector('.tree')).toBeNull()
    expect(rowLabels(el)).toEqual(['Alpha', 'Anchor'])
    await type(input, '')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(el.querySelector('.tree__row--file')).not.toBeNull()
  })

  it('a reveal request for the current lens clears search so that lens tree can render', async () => {
    const { el, input, rerender } = await search('a')
    await rerender({ revealRequest: { id: 1, path: '/v/a.md', lens: 'files' } })
    expect(input.value).toBe('')
    expect(el.querySelector('.tree__row--file')).not.toBeNull()
  })

  it('a request pinned to another lens does not disturb the current search', async () => {
    const { input, rerender } = await search('a')
    await rerender({ revealRequest: { id: 1, path: '/v/a.md', lens: 'topics' } })
    expect(input.value).toBe('a')
  })

  it('a query nothing matches says so, and still hides the tree', async () => {
    const { el } = await search('zzz')
    expect(el.textContent).toContain('No matches')
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('a folder label rides along on rows that have one', async () => {
    const { el } = await search('anch')
    expect(el.querySelector('.search-results__folder')?.textContent).toBe('Docs')
  })

  it('the top row starts selected; ArrowDown/ArrowUp clamp at both ends and never wrap', async () => {
    const { el, input } = await search('a')
    expect(activeLabel(el)).toBe('Alpha')
    await press(input, 'ArrowUp')
    expect(activeLabel(el)).toBe('Alpha') // already at the top
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor')
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor') // already at the bottom
    await press(input, 'ArrowUp')
    expect(activeLabel(el)).toBe('Alpha')
  })

  it('Enter opens the SELECTED row in the current tab and leaves the list up', async () => {
    const { el, input, props } = await search('a')
    await press(input, 'ArrowDown')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Anchor.md')
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    expect(input.value).toBe('a')
    expect(rowLabels(el)).toEqual(['Alpha', 'Anchor'])
  })

  it('⌘Enter opens the selected row in a background tab instead', async () => {
    const { input, props } = await search('a')
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/Alpha.md')
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  /** An editor stand-in: layoutless jsdom always answers `offsetParent: null`, so it declares its own. */
  const editorStub = (): HTMLElement => {
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.tabIndex = -1
    Object.defineProperty(pm, 'offsetParent', { get: () => document.body })
    instance.appendChild(pm)
    document.body.appendChild(instance)
    return pm
  }

  it('a second Enter on the page ALREADY open commits the caret into it, and never re-opens it (YAZ-961)', async () => {
    // The tree rows' rule (YAZ-921), on the search list: the first Enter previews — focus stays
    // in the bar, so the walk continues — and the second is the deliberate "take me in".
    const pm = editorStub()
    const { input, props } = await search('alph', { activeFile: '/v/Alpha.md' })
    await press(input, 'Enter')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(pm)
    pm.remove()
  })

  it('⌘-Enter on the open page still opens a background tab — never the commit (YAZ-961)', async () => {
    const pm = editorStub()
    const { input, props } = await search('alph', { activeFile: '/v/Alpha.md' })
    await press(input, 'Enter', true)
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/Alpha.md')
    expect(document.activeElement).not.toBe(pm)
    pm.remove()
  })

  it('changing the query re-selects the top row', async () => {
    const { el, input } = await search('a')
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor')
    await type(input, 'an')
    expect(activeLabel(el)).toBe('Anchor') // the new ranking's FIRST row, not the carried index
    expect(rowLabels(el)).toEqual(['Anchor'])
  })

  it('an index refresh that shrinks the list keeps the highlight on the LAST row, and Enter opens that row (YAZ-808)', async () => {
    // The watcher fans out to every subscriber (useWatch's shape) — here the tree's and search's.
    const listeners: ((ev: WatchEvent) => void)[] = []
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        listeners.push(l)
        return () => void listeners.splice(listeners.indexOf(l), 1)
      },
    }
    const { el, input, bridge, props } = await search('a', { watch })
    await press(input, 'ArrowDown')
    expect(activeLabel(el)).toBe('Anchor') // index 1 of two rows
    bridge.index.mockResolvedValue({ root: '/v', records: [record('Alpha')], generatedAt: 2 } as never)
    await act(async () => [...listeners].forEach((l) => l({ type: 'unlink', path: '/v/Docs/Anchor.md' })))
    expect(rowLabels(el)).toEqual(['Alpha'])
    expect(activeLabel(el)).toBe('Alpha') // the stale index 1 clamps onto the last row, not onto nothing
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Alpha.md')
  })

  it('right-clicking the results offers no menu — "New note" there would have no target', async () => {
    const { el } = await search('a')
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * Folders in the search list (YAZ-1491). 🔒 D1: the rows come from the tree the Sidebar already
 * holds (`dirs`), not from the index feed. 🔒 D2: one flat list, the same matcher — a folder is
 * one row, a note still never matches on its folder. 🔒 D3: choosing a folder row REVEALS it in
 * Files — `onRevealInFiles`, never `onOpenFile` — from EITHER lens and by keyboard OR click, and
 * the Files reveal path accepts a DIR: ancestors AND the dir itself open, the dir row flashes.
 * 🔒 D4: the row looks like a folder.
 */
describe('folder rows in search (YAZ-1491)', () => {
  const rowLabels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__row .search-results__label')].map((n) => n.textContent)
  const dirResult = (el: HTMLElement) => el.querySelector<HTMLLIElement>('.search-results__row--dir')
  const press = (input: HTMLInputElement, key: string, metaKey = false) =>
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey, bubbles: true })))
  const dirRow = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')].find((row) => row.querySelector('.tree__label')?.textContent === label)
  const expandedState = (el: HTMLElement, label: string) => dirRow(el, label)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')

  /** A folder AND a note both called `sub`, so the tie-break is observable. */
  const SUB_NOTE = { path: '/v/sub.md', name: 'sub.md', basename: 'sub', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [] }
  const search = async (query: string, over: Partial<SidebarProps> = {}) => {
    const m = await mount(over, (b) => b.index.mockResolvedValue({ root: '/v', records: [SUB_NOTE], generatedAt: 1 } as never))
    const input = searchInput(m.el)!
    await type(input, query)
    return { ...m, input }
  }

  it('a folder of the loaded tree is a row — above the same-named note — marked as a folder (🔒 D1/D2/D4)', async () => {
    const { el } = await search('sub')
    expect(rowLabels(el)).toEqual(['sub', 'sub'])
    const [folder, note] = [...el.querySelectorAll('.search-results__row')]
    expect(folder.classList.contains('search-results__row--dir')).toBe(true)
    expect(folder.getAttribute('aria-label')).toBe('Search result sub, folder')
    expect(folder.querySelector('.search-results__glyph')).not.toBeNull()
    expect(note.classList.contains('search-results__row--dir')).toBe(false)
  })

  it('Enter on a folder row asks App to reveal it in Files and opens nothing (🔒 D3)', async () => {
    const { el, input, props } = await search('sub')
    expect(dirResult(el)?.classList.contains('search-results__row--active')).toBe(true)
    await press(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('⌘-Enter on a folder row reveals too — there is no background tab for a folder', async () => {
    const { input, props } = await search('sub')
    await press(input, 'Enter', true)
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('a click on a folder row goes through the SAME rule as Enter', async () => {
    const { el, props } = await search('sub')
    act(() => dirResult(el)?.click())
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('the note row beneath still OPENS — the rule is per row, not per list', async () => {
    const { input, props } = await search('sub')
    await press(input, 'ArrowDown')
    await press(input, 'Enter')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub.md')
    expect(props.onRevealInFiles).not.toHaveBeenCalled()
  })

  it('from the TOPICS lens a folder row still reveals in Files (🔒 D3: whichever tab was showing)', async () => {
    const { el, input, props } = await search('sub', { lens: 'topics' })
    expect(dirResult(el)).not.toBeNull()
    await press(input, 'Enter')
    expect(props.onRevealInFiles).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })

  it('App\'s reply — the Files reveal request — clears the query and flashes the folder row', async () => {
    const { el, input, props, rerender } = await search('sub')
    await press(input, 'Enter')
    // What `revealInFiles` in App does next: the lens is already Files here, so only the request lands.
    await rerender({ revealRequest: { id: 1, path: '/v/sub', lens: 'files' } })
    expect(input.value).toBe('')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(dirRow(el, 'sub')?.classList.contains('tree__row--revealed')).toBe(true)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a Files reveal request for a DIR opens its ancestors AND itself and flashes its row — no "no longer there"', async () => {
    // Its own root: expansion persists PER ROOT across the tests in this file, so a sibling under
    // `/v` could already be open from an earlier click. Nothing has ever touched `/w`.
    const DIR = '/w/target/deep'
    const DEEP_TREE: TreeNode[] = [
      { type: 'dir', name: 'other', path: '/w/other', children: [] },
      {
        type: 'dir', name: 'target', path: '/w/target',
        children: [{
          type: 'dir', name: 'deep', path: DIR,
          children: [{ type: 'file', name: 'Note.md', path: `${DIR}/Note.md`, size: 1, mtime: 1, kind: 'markdown' }],
        }],
      },
    ]
    const { el, props } = await mount(
      { root: '/w', revealRequest: { id: 1, path: DIR, lens: 'files' } },
      (b) => b.tree.mockResolvedValue({ root: '/w', tree: DEEP_TREE, generatedAt: 1 }),
    )
    expect(props.onRevealConsumed).toHaveBeenCalledExactlyOnceWith(1)
    expect(expandedState(el, 'target')).toBe('true')
    expect(expandedState(el, 'deep')).toBe('true') // the folder opens ITSELF too
    expect(expandedState(el, 'other')).toBe('false')
    expect(el.querySelector(`.tree__row--dir[data-path="${DIR}"]`)?.classList.contains('tree__row--revealed')).toBe(true)
    expect(props.onNotice).not.toHaveBeenCalled()
  })

  it('a reveal for a folder the tree no longer has still reports the passive notice', async () => {
    const { props } = await mount({ revealRequest: { id: 1, path: '/v/gone', lens: 'files' } })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "gone" in Files — it is no longer there', 'error')
  })
})

/**
 * The lens tabs (🔒 D4/D5, YAZ-847): chrome v2 ROW 1, above the persistent search bar. Topics is
 * the DEFAULT lens and holds the folder-page tree (YAZ-848, pinned in `TopicsTree.test.tsx` —
 * what matters HERE is only which body the tabs swap in); Files is today's file explorer,
 * unchanged, behind a tab. The VALUE is App's (window identity, `WindowEntry.sidebarLens`, since YAZ-1628): the
 * sidebar renders the row and reports clicks, and App hands the new lens back down. Switching is
 * a conditional render, never a teardown — the search wave's rule, re-proved here on the tree's
 * expansion. Search keeps working from both lenses and the query survives a lens switch (🔒 D5).
 */
describe('lens tabs (🔒 D4/D5, YAZ-847)', () => {
  const record = (basename: string, folder = '') => ({
    path: `/v/${folder === '' ? '' : `${folder}/`}${basename}.md`, name: `${basename}.md`, basename, folder, ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
  })
  const RECORDS = [record('Alpha'), record('Anchor', 'Docs')]
  const withIndex = (b: ReturnType<typeof installBridge>) => b.index.mockResolvedValue({ root: '/v', records: RECORDS, generatedAt: 1 } as never)
  /** The window's live feed with a snapshot in it — what the Topics tree reads (YAZ-848). */
  const topicsFeed = { resolve: () => null, records: RECORDS, subscribe: () => () => undefined }

  const tabs = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses[role="tablist"] [role="tab"]')]
  const tabByLabel = (el: HTMLElement, label: string) => tabs(el).find((b) => b.textContent === label)
  const selectedTabs = (el: HTMLElement) => tabs(el).filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.textContent)
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const resultLabels = (el: HTMLElement) => [...el.querySelectorAll('.search-results__row .search-results__label')].map((n) => n.textContent)
  const dirItem = (el: HTMLElement) => el.querySelector('.tree__row--dir')?.closest('[role="treeitem"]') ?? null

  it('renders a tablist of exactly Topics, Files then Favorites (YAZ-1766 D1), the active one aria-selected and no other', async () => {
    const { el } = await mount({ lens: 'topics' })
    expect(tabs(el).map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Topics', 'Files', 'Favorites'])
    expect(selectedTabs(el)).toEqual(['Topics'])
    const files = await mount({ lens: 'files' })
    expect(selectedTabs(files.el)).toEqual(['Files'])
  })

  it('the default lens is Topics: the folder-page tree, never the file tree — and the search bar is still there', async () => {
    // The harness's index feed is empty (the pre-first-index state), so the Topics tree renders
    // nothing at all — and above all NOT the file tree, which is the other tab's body.
    const { el } = await mount({ lens: 'topics' })
    expect(el.querySelector('.tree__row--file')).toBeNull()
    expect(el.querySelector('.sidebar__body')?.textContent).toBe('')
    expect(searchInput(el)).not.toBeNull() // ALWAYS visible, on both lenses (the locked YAZ-739 rule)
    // With a snapshot in hand it is the MEANING tree: this vault declares no folder page, so
    // every page lands in Uncategorized (YAZ-848 owns the rest of that behaviour).
    const fed = await mount({ lens: 'topics', indexSource: topicsFeed })
    expect(fed.el.querySelector('.tree__row--muted')?.textContent).toBe('Uncategorized2')
    expect(fed.el.querySelector('.tree__row--file')).toBeNull()
  })

  it('the Files lens is today\'s tree, unchanged', async () => {
    const { el } = await mount({ lens: 'files' })
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(fileRow(el)?.textContent).toBe('a')
  })

  it('clicking a tab reports UP to App and flips nothing by itself — the value is App\'s', async () => {
    const { el, props } = await mount({ lens: 'topics' })
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(selectedTabs(el)).toEqual(['Topics']) // still Topics until App hands the new lens back
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('App handing the new lens back down is what swaps the body', async () => {
    const { el, rerender } = await mount({ lens: 'topics' })
    await rerender({ lens: 'files' })
    expect(selectedTabs(el)).toEqual(['Files'])
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(bodyMsg(el)).toBeNull()
  })

  it('switching Files → Topics → Files never tears the tree down: its expansion is waiting', async () => {
    const { el, rerender } = await mount({ lens: 'files' })
    const before = dirItem(el)?.getAttribute('aria-expanded')
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--dir')?.click())
    const toggled = dirItem(el)?.getAttribute('aria-expanded')
    expect(toggled).not.toBe(before)
    await rerender({ lens: 'topics' })
    expect(el.querySelector('.tree')).toBeNull()
    await rerender({ lens: 'files' })
    expect(dirItem(el)?.getAttribute('aria-expanded')).toBe(toggled)
  })

  it('a query on TOPICS replaces the topic tree with the flat results; clearing brings the tree back', async () => {
    const { el } = await mount({ lens: 'topics', indexSource: topicsFeed }, withIndex)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(resultLabels(el)).toEqual(['Alpha', 'Anchor'])
    expect(el.querySelector('.tree')).toBeNull()
    await type(input, '')
    expect(el.querySelector('.search-results')).toBeNull()
    expect(el.querySelector('.tree__row--muted')?.textContent).toBe('Uncategorized2')
  })

  it('the tabs row stays visible and clickable DURING a search, and a lens switch keeps the query (🔒 D5)', async () => {
    const { el, props, rerender } = await mount({ lens: 'topics' }, withIndex)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(selectedTabs(el)).toEqual(['Topics'])
    act(() => tabByLabel(el, 'Files')?.click())
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    await rerender({ lens: 'files' })
    expect(input.value).toBe('a') // the query is untouched by the switch…
    expect(resultLabels(el)).toEqual(['Alpha', 'Anchor']) // …and still replaces the ACTIVE tab's body
    expect(el.querySelector('.tree')).toBeNull()
    await type(input, '')
    expect(el.querySelector('.tree')).not.toBeNull() // clearing lands on the lens that is now active
  })

  /**
   * YAZ-948 retires \u{1F512} YAZ-847's withholding: it kept the blank-space menu out of Topics only
   * until that tree had a menu of its own to be consistent with, which YAZ-865 gave its rows.
   * Blank space means the same thing in either lens — the vault ROOT — with ONE difference,
   * ruled by Yasin: the Topics lens never offers "New folder", because a disk folder made from
   * a lens that browses by MEANING lands where that lens cannot show it.
   */
  it('BLANK SPACE in Topics opens the same root-targeted menu — without "New folder"', async () => {
    const { el } = await mount({ lens: 'topics' })
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
    expect(menuItems(el).map((b) => b.textContent)).toEqual(['Copy path', 'New note', 'New folder page', 'Open in'])
  })

  it('a typed query still offers nothing on either lens — a result list has no root to target (YAZ-803)', async () => {
    const { el } = await mount({ lens: 'topics' }, withIndex)
    await type(searchInput(el)!, 'a')
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })
})

/**
 * Expand / collapse all (⚡ YAZ-862): ONE double-chevron button at the end of the lens row,
 * replacing the whole expanded set in a single dispatch. Anything open means the click collapses;
 * only a fully closed tree expands. This describe is the FILES half; it belongs to the tree BODY,
 * so it is GONE (never disabled) while a query is typed and in a vault with no folders to open.
 * The Topics half — and the two stores' independence — is the ⚡ YAZ-873 describe below.
 */
describe('expand / collapse all (⚡ YAZ-862)', () => {
  const note = (path: string): TreeNode => ({ type: 'file', name: 'n.md', path, size: 1, mtime: 1, kind: 'markdown' })
  /** Two depths of folder: docs/ holding deep/, notes/ empty beside it, and a note at the top. */
  const NESTED = (v: string): TreeNode[] => [
    {
      type: 'dir',
      name: 'docs',
      path: `${v}/docs`,
      children: [{ type: 'dir', name: 'deep', path: `${v}/docs/deep`, children: [note(`${v}/docs/deep/n.md`)] }],
    },
    { type: 'dir', name: 'notes', path: `${v}/notes`, children: [] },
    note(`${v}/n.md`),
  ]

  // Expansion is persisted per ROOT in the app-state cache, which is module-level and outlives a
  // test — so every mount here opens its OWN vault and therefore starts from an empty set.
  let vaults = 0
  const mountVault = async (nodes: (v: string) => TreeNode[] = NESTED, over: Partial<SidebarProps> = {}) => {
    const vault = `/v-all-${++vaults}`
    return mount({ root: vault, ...over }, (b) => b.tree.mockResolvedValue({ root: vault, tree: nodes(vault), generatedAt: 1 } as never))
  }
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
  const label = (el: HTMLElement) => allButton(el)?.getAttribute('aria-label') ?? null
  const dirLabels = (el: HTMLElement) => [...el.querySelectorAll('.tree__row--dir .tree__label')].map((n) => n.textContent)
  const dirRow = (el: HTMLElement, i: number) => el.querySelectorAll<HTMLButtonElement>('.tree__row--dir')[i]

  it('a closed tree offers "Expand all", and one click opens every folder at every depth', async () => {
    const { el } = await mountVault()
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
    expect(allButton(el)?.title).toBe('Expand all')
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'deep', 'notes'])
    expect(label(el)).toBe('Collapse all')
    expect(allButton(el)?.title).toBe('Collapse all')
  })

  it('an open tree — fully or PARTLY — offers "Collapse all", and one click closes the lot', async () => {
    const { el } = await mountVault()
    act(() => allButton(el)?.click())
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
    // One open folder is enough — the button never offers to expand a tree that is already part way.
    act(() => dirRow(el, 1)?.click())
    expect(label(el)).toBe('Collapse all')
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['docs', 'notes'])
    expect(label(el)).toBe('Expand all')
  })

  it('there is no button while a query is typed, on the Topics lens, or in a vault with no folders', async () => {
    const searched = await mountVault()
    const input = searchInput(searched.el)!
    await type(input, 'a')
    expect(allButton(searched.el)).toBeNull()
    await type(input, '')
    expect(allButton(searched.el)).not.toBeNull() // back with the tree it belongs to

    // The lens row's button acts on the ACTIVE lens since ⚡ YAZ-873, so Topics over this
    // harness's EMPTY feed has nothing to unfold — the same "nothing to open" rule, not a
    // lens exclusion. The folder tree standing right there does not lend it one.
    const topics = await mountVault(NESTED, { lens: 'topics' })
    expect(allButton(topics.el)).toBeNull()

    const flat = await mountVault((v) => [note(`${v}/n.md`)])
    expect(flat.el.querySelector('.tree__row--file')).not.toBeNull()
    expect(allButton(flat.el)).toBeNull()
  })
})

/**
 * Focus Mode on the FILES lens (YAZ-1605): the tree narrows to the folders you picked — they are
 * the ONLY top rows — and the eye beside the chevrons is the way out. The focus lives in the same
 * per-vault storage bucket as `expanded`, so (exactly as above) every mount here opens its OWN
 * vault and therefore starts from no focus at all.
 */
describe('focus mode (YAZ-1605)', () => {
  const note = (path: string, name: string): TreeNode => ({ type: 'file', name, path, size: 1, mtime: 1, kind: 'markdown' })
  /** Notes/ holding Sub/, Projects/ holding Alpha/, the prefix-sharing Projects-Archive/, and a root note. */
  const FOCUS = (v: string): TreeNode[] => [
    {
      type: 'dir', name: 'Notes', path: `${v}/Notes`,
      children: [{ type: 'dir', name: 'Sub', path: `${v}/Notes/Sub`, children: [] }, note(`${v}/Notes/n.md`, 'n.md')],
    },
    {
      type: 'dir', name: 'Projects', path: `${v}/Projects`,
      children: [
        { type: 'dir', name: 'Alpha', path: `${v}/Projects/Alpha`, children: [note(`${v}/Projects/Alpha/a.md`, 'a.md')] },
        note(`${v}/Projects/p.md`, 'p.md'),
      ],
    },
    { type: 'dir', name: 'Projects-Archive', path: `${v}/Projects-Archive`, children: [note(`${v}/Projects-Archive/old.md`, 'old.md')] },
    note(`${v}/top.md`, 'top.md'),
  ]

  let vaults = 0
  /**
   * One fresh vault AND one fresh WINDOW per mount (`storage.init()` against this mount's bridge).
   * `focus` seeds a PERSISTED focus the way main hands it over at boot — in the window's identity
   * (YAZ-1628), never the vault bucket — so the Sidebar restores it through the real storage module.
   */
  const mountVault = async (over: Partial<SidebarProps> = {}, opts: { nodes?: (v: string) => TreeNode[]; focus?: string[] } = {}) => {
    const v = `/v-focus-${++vaults}`
    const m = await mount({ root: v, ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: (opts.nodes ?? FOCUS)(v), generatedAt: 1 } as never)
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: (opts.focus ?? []).map((p) => `${v}${p}`), focusTopics: [], focusFavorites: [] })
      await storage.init()
    })
    return { ...m, v }
  }

  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const dirLabels = (el: HTMLElement) => [...el.querySelectorAll('.tree__row--dir .tree__label')].map((n) => n.textContent)
  /** Only the rows drawn at depth 0 — every nested list is a `role="group"`, so this is what "at the top" means. */
  const topLabels = (el: HTMLElement) => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((n) => n.textContent)
  const lensButtons = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sidebar__lenses button')]
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
  const eye = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__focus-off')
  const isOpen = (el: HTMLElement, path: string) => rowByPath(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  /** The only way in: right-click the row and take the menu's Focus item. */
  const focusRow = async (el: HTMLElement, path: string, label = 'Focus on folder') => {
    rightClick(rowByPath(el, path))
    await act(async () => itemByLabel(el, label)?.click())
  }

  it('offers "Focus on folder" on a folder row — never on a file row or on blank space', async () => {
    const { el, v } = await mountVault()
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(itemByLabel(el, 'Focus on folder')).toBeDefined()
    closeMenu(el)
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Focus on folder')).toBeUndefined()
    closeMenu(el)
    rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Focus on folder')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined() // the menu is there; only Focus is missing
  })

  it('focusing a folder makes it the only top row, opens it, and stores the one path', async () => {
    const { el, v, bridge } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    expect(topLabels(el)).toEqual(['Projects'])
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(dirLabels(el)).toEqual(['Projects', 'Alpha'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ focusDirs: [`${v}/Projects`] })
    expect(bridge.state.setFolder).not.toHaveBeenCalledWith(v, expect.objectContaining({ focusDirs: expect.anything() })) // never the vault bucket (YAZ-1628)
  })

  it('the eye is lit only while focused and sits directly before the chevrons', async () => {
    const { el, v } = await mountVault()
    expect(eye(el)).toBeNull()
    await focusRow(el, `${v}/Projects`)
    expect(eye(el)?.getAttribute('aria-label')).toBe('Exit focus mode')
    const row = lensButtons(el)
    expect(row.indexOf(eye(el)!)).toBe(row.indexOf(allButton(el)!) - 1)
  })

  it('clicking the eye brings every top row back and clears the stored focus', async () => {
    const { el, v, bridge } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    await act(async () => eye(el)?.click())
    expect(eye(el)).toBeNull()
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'Projects-Archive', 'top'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ focusDirs: [] })
  })

  it('a focus restored from this window\'s identity narrows the first render and is never written back', async () => {
    const { el, bridge } = await mountVault({}, { focus: ['/Projects'] })
    expect(topLabels(el)).toEqual(['Projects'])
    expect(eye(el)).not.toBeNull()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
  })

  it('expand all while focused opens only the folders inside the focus', async () => {
    const { el, v } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    act(() => allButton(el)?.click()) // focusing opened Projects, so the first click is the collapse…
    expect(allButton(el)?.getAttribute('aria-label')).toBe('Expand all')
    act(() => allButton(el)?.click())
    expect(isOpen(el, `${v}/Projects/Alpha`)).toBe('true')
    await act(async () => eye(el)?.click())
    expect(dirLabels(el)).toEqual(['Notes', 'Projects', 'Alpha', 'Projects-Archive']) // Notes never opened
  })

  it('collapse all while focused leaves a fold outside the focus exactly as it was', async () => {
    const { el, v } = await mountVault()
    act(() => rowByPath(el, `${v}/Notes`)?.click())
    expect(dirLabels(el)).toEqual(['Notes', 'Sub', 'Projects', 'Projects-Archive'])
    await focusRow(el, `${v}/Projects`)
    act(() => allButton(el)?.click())
    expect(dirLabels(el)).toEqual(['Projects'])
    await act(async () => eye(el)?.click())
    expect(dirLabels(el)).toEqual(['Notes', 'Sub', 'Projects', 'Projects-Archive'])
  })

  it('a focus on /Projects never shows the prefix-sharing /Projects-Archive', async () => {
    const { el, v } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    expect(topLabels(el)).toEqual(['Projects'])
    expect(rowByPath(el, `${v}/Projects-Archive`)).toBeNull()
  })

  it('a 2-folder selection reads "Focus on 2 folders" and puts both at the top in TREE order', async () => {
    const { el, v } = await mountVault()
    shiftClickRow(rowByPath(el, `${v}/Projects`)) // click order Projects → Notes…
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    rightClick(rowByPath(el, `${v}/Notes`))
    expect(itemByLabel(el, 'Focus on 2 folders')).toBeDefined()
    await act(async () => itemByLabel(el, 'Focus on 2 folders')?.click())
    expect(topLabels(el)).toEqual(['Notes', 'Projects']) // …tree order out
  })

  it('a selection of files only offers no Focus item', async () => {
    const { el, v } = await mountVault()
    act(() => rowByPath(el, `${v}/Projects`)?.click()) // open it so a nested note is a row too…
    // …and let go of it: since D9 (YAZ-1674) that click SELECTED the folder, and this case is about files only.
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, `${v}/top.md`))
    shiftClickRow(rowByPath(el, `${v}/Projects/p.md`))
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(menuItems(el).map((b) => b.textContent).some((t) => t?.startsWith('Focus'))).toBe(false)
  })

  it('a selection of one folder and one file focuses the folder — "Focus on folder", singular', async () => {
    const { el, v } = await mountVault()
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    shiftClickRow(rowByPath(el, `${v}/top.md`))
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Focus on folder')).toBeDefined()
    await act(async () => itemByLabel(el, 'Focus on folder')?.click())
    expect(topLabels(el)).toEqual(['Projects'])
  })

  it('focusing a folder AND its own subfolder draws the subfolder once, under its parent', async () => {
    const { el, v } = await mountVault()
    act(() => rowByPath(el, `${v}/Projects`)?.click()) // open it so Alpha is a row to select — and SELECT it (D9, YAZ-1674)
    shiftClickRow(rowByPath(el, `${v}/Projects/Alpha`)) // shift ADDS the subfolder beside its parent
    rightClick(rowByPath(el, `${v}/Projects/Alpha`))
    await act(async () => itemByLabel(el, 'Focus on 2 folders')?.click())
    expect(topLabels(el)).toEqual(['Projects'])
    expect(dirLabels(el)).toEqual(['Projects', 'Alpha'])
  })

  /** The watcher-driven refresh idiom: a new tree answers the next `bridge.tree`, an event triggers it. */
  const withWatcher = () => {
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    return { watch, fire: (ev: WatchEvent) => emit?.(ev) }
  }

  it('a focused folder that leaves the tree ends the focus and brings the whole vault back', async () => {
    const { watch, fire } = withWatcher()
    const { el, v, bridge } = await mountVault({ watch })
    await focusRow(el, `${v}/Projects`)
    bridge.tree.mockResolvedValue({ root: v, tree: FOCUS(v).filter((n) => n.path !== `${v}/Projects`), generatedAt: 2 } as never)
    await act(async () => fire({ type: 'unlinkDir', path: `${v}/Projects` }))
    expect(eye(el)).toBeNull()
    expect(topLabels(el)).toEqual(['Notes', 'Projects-Archive', 'top'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ focusDirs: [] })
  })

  it('with two folders focused, the survivor keeps the focus when the other vanishes', async () => {
    const { watch, fire } = withWatcher()
    const { el, v, bridge } = await mountVault({ watch })
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    rightClick(rowByPath(el, `${v}/Notes`))
    await act(async () => itemByLabel(el, 'Focus on 2 folders')?.click())
    bridge.tree.mockResolvedValue({ root: v, tree: FOCUS(v).filter((n) => n.path !== `${v}/Projects`), generatedAt: 2 } as never)
    await act(async () => fire({ type: 'unlinkDir', path: `${v}/Projects` }))
    expect(eye(el)).not.toBeNull()
    expect(topLabels(el)).toEqual(['Notes'])
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ focusDirs: [`${v}/Notes`] })
  })

  it('a reveal OUTSIDE the focus ends it and still shows the target', async () => {
    const { el, v, rerender } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    await rerender({ revealRequest: { id: 1, path: `${v}/Notes/n.md`, lens: 'files' } })
    expect(eye(el)).toBeNull()
    expect(rowByPath(el, `${v}/Notes/n.md`)?.classList.contains('tree__row--revealed')).toBe(true)
  })

  it('a reveal INSIDE the focus keeps it', async () => {
    const { el, v, rerender } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    await rerender({ revealRequest: { id: 1, path: `${v}/Projects/Alpha/a.md`, lens: 'files' } })
    expect(eye(el)).not.toBeNull()
    expect(topLabels(el)).toEqual(['Projects'])
    expect(rowByPath(el, `${v}/Projects/Alpha/a.md`)?.classList.contains('tree__row--revealed')).toBe(true)
  })

  it('a typed query hides the eye; clearing it brings the eye back, still narrowed', async () => {
    const { el, v } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    const input = searchInput(el)!
    await type(input, 'a')
    expect(eye(el)).toBeNull()
    await type(input, '')
    expect(eye(el)).not.toBeNull()
    expect(topLabels(el)).toEqual(['Projects'])
  })

  it('a Files focus survives a trip through Topics — the eye belongs to the ACTIVE lens', async () => {
    const { el, v, rerender } = await mountVault()
    await focusRow(el, `${v}/Projects`)
    await rerender({ lens: 'topics' })
    expect(eye(el)).toBeNull() // Topics carries its own focus, and it is empty
    await rerender({ lens: 'files' })
    expect(eye(el)).not.toBeNull()
    expect(topLabels(el)).toEqual(['Projects'])
  })
})

/**
 * The Favorites tab (YAZ-1766): a third lens listing the files and folders the user pinned from any
 * row's menu, in insertion order, each a full tree row — a pinned folder unfolds in place through
 * the Files tree's own expansion (D7), a pinned file inside a pinned folder shows twice (root and
 * nested), the toast names the kind, the list persists in the vault's `.yaseendocs/favorites.json`
 * through `favorites.get/set` (D2, in the vault since 6A/D11), root rows drag to reorder (D4), and
 * Focus keeps its own per-window list here (D5). One fresh vault and window per mount, as the Focus
 * block above does it.
 */
describe('favorites (YAZ-1766)', () => {
  const note = (path: string, name: string): TreeNode => ({ type: 'file', name, path, size: 1, mtime: 1, kind: 'markdown' })
  const FAV = (v: string): TreeNode[] => [
    { type: 'dir', name: 'Notes', path: `${v}/Notes`, children: [note(`${v}/Notes/n.md`, 'n.md')] },
    {
      type: 'dir', name: 'Projects', path: `${v}/Projects`,
      children: [{ type: 'dir', name: 'Alpha', path: `${v}/Projects/Alpha`, children: [] }, note(`${v}/Projects/p.md`, 'p.md')],
    },
    note(`${v}/top.md`, 'top.md'),
  ]

  let vaults = 0
  /** A fresh vault + window; `favorites` seeds what `favorites.get` answers — the vault file's list, absolute, as main hands it over (6A). */
  const mountVault = async (over: Partial<SidebarProps> = {}, opts: { favorites?: string[]; focusFavorites?: string[]; nodes?: (v: string) => TreeNode[] } = {}) => {
    const v = `/v-fav-${++vaults}`
    let emit: ((c: { root: string }) => void) | undefined
    const m = await mount({ root: v, lens: 'files', ...over }, async (b) => {
      b.tree.mockResolvedValue({ root: v, tree: (opts.nodes ?? FAV)(v), generatedAt: 1 } as never)
      b.favorites.get.mockResolvedValue((opts.favorites ?? []).map((p) => `${v}${p}`))
      b.favorites.onChanged.mockImplementation((l) => {
        emit = l
        return () => undefined
      })
      b.window.identity.mockResolvedValue({ id: 'w1', root: v, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusTopics: [], focusFavorites: (opts.focusFavorites ?? []).map((p) => `${v}${p}`) })
      await storage.init()
    })
    return { ...m, v, emit: (c: { root: string }) => emit?.(c) }
  }

  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const rowsByPath = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)]
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const closeMenu = (el: HTMLElement) => act(() => void el.querySelector('.ctx-overlay')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  const topLabels = (el: HTMLElement) => [...el.querySelectorAll('ul.tree[role="tree"] > li > .tree__row .tree__label')].map((n) => n.textContent)
  const bodyMsg = (el: HTMLElement) => el.querySelector('.sidebar__body .sidebar__msg')?.textContent ?? null
  const eye = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__focus-off')
  const isOpen = (el: HTMLElement, path: string) => rowByPath(el, path)?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
  const pick = async (el: HTMLElement, path: string, label: string) => {
    rightClick(rowByPath(el, path))
    await act(async () => itemByLabel(el, label)?.click())
  }
  /** jsdom has no DragEvent: a MouseEvent with the row's edge in `clientY` (the zero rect reads `< 0` as "before"). */
  const drag = (target: Element | null | undefined, type: string, clientY = 0) =>
    act(() => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))

  it('the tab is the third, and starts on the empty hint', async () => {
    const { el } = await mountVault({ lens: 'favorites' })
    expect([...el.querySelectorAll('.sidebar__lenses [role="tab"]')].map((b) => b.textContent || b.getAttribute('aria-label'))).toEqual(['Topics', 'Files', 'Favorites'])
    expect(bodyMsg(el)).toBe('No favorites yet. Right-click a file or folder → Add to favorites.')
    expect(el.querySelector('.tree')).toBeNull()
  })

  it('New note from a ROOT favorited FILE hops to Files — its parent dir is not on the tab; from a favorited FOLDER the input mounts in place (3B1)', async () => {
    const { el, v, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes/n.md', '/Projects'] })
    await pick(el, `${v}/Notes/n.md`, 'New note')
    expect(props.onLensChange).toHaveBeenCalledExactlyOnceWith('files')
    expect(el.querySelector('.create-inline')).toBeNull() // the tab has no `Notes` node to mount it under
    vi.mocked(props.onLensChange).mockClear()
    await pick(el, `${v}/Projects`, 'New note')
    expect(props.onLensChange).not.toHaveBeenCalled()
    expect(el.querySelector('.create-inline')).not.toBeNull()
  })

  it('"Add to favorites" is on file AND folder rows in Files, never on blank space; adding toasts, persists to the vault file and lists the row on the tab', async () => {
    const { el, v, bridge, props, rerender } = await mountVault()
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Add to favorites')).toBeDefined()
    closeMenu(el)
    rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Add to favorites')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
    closeMenu(el)
    await pick(el, `${v}/Projects`, 'Add to favorites')
    expect(props.onNotice).toHaveBeenCalledWith('Added to favorites', 'favorite')
    expect(bridge.favorites.set).toHaveBeenCalledWith(v, [`${v}/Projects`])
    expect(bridge.state.setFolder).not.toHaveBeenCalled() // vault content, not app state (D15)
    expect(bridge.window.setIdentity).not.toHaveBeenCalled() // nor window identity
    await rerender({ lens: 'favorites' })
    expect(topLabels(el)).toEqual(['Projects'])
    // The pinned row now reads Remove, on the Favorites tab and back on Files alike.
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(itemByLabel(el, 'Remove from favorites')).toBeDefined()
    closeMenu(el)
    await rerender({ lens: 'files' })
    rightClick(rowByPath(el, `${v}/Projects`))
    expect(itemByLabel(el, 'Remove from favorites')).toBeDefined()
  })

  it('every favorites row carries the full row menu — Focus, Copy path, Rename, Open in, Delete', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects', '/top.md'] })
    rightClick(rowByPath(el, `${v}/Projects`))
    for (const label of ['Focus on folder', 'Cut', 'Copy', 'Copy path', 'New note', 'Rename', 'Remove from favorites', 'Open in', 'Delete']) expect(itemByLabel(el, label), label).toBeDefined()
    closeMenu(el)
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
    expect(itemByLabel(el, 'Focus on folder')).toBeUndefined()
  })

  it('"Remove from favorites" drops the row, toasts, and persists the shorter list', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects', '/top.md'] })
    expect(topLabels(el)).toEqual(['Projects', 'top'])
    await pick(el, `${v}/Projects`, 'Remove from favorites')
    expect(topLabels(el)).toEqual(['top'])
    expect(props.onNotice).toHaveBeenCalledWith('Removed from favorites', 'favorite')
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`])
  })

  it('a restored list renders in STORED order (not tree order) and is never written back', async () => {
    const { el, bridge } = await mountVault({ lens: 'favorites' }, { favorites: ['/top.md', '/Projects', '/Notes'] })
    expect(topLabels(el)).toEqual(['top', 'Projects', 'Notes'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('a favorited folder unfolds in place, and its fold is the Files tree\'s own (D7)', async () => {
    const { el, v, rerender } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects'] })
    expect(isOpen(el, `${v}/Projects`)).toBe('false')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(rowByPath(el, `${v}/Projects/p.md`)).not.toBeNull()
    await rerender({ lens: 'files' })
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
  })

  it('redundancy: a file AND its parent folder both listed — the file at the root and again inside the folder', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects/p.md', '/Projects'] })
    expect(topLabels(el)).toEqual(['p', 'Projects'])
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(rowsByPath(el, `${v}/Projects/p.md`)).toHaveLength(2)
  })

  it('a 2-row selection reads "Add 2 to favorites" and pins both in panel order; a MIXED one reads Add and pins only the missing; all-pinned reads "Remove 2 from favorites"', async () => {
    const { el, v, bridge } = await mountVault()
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    rightClick(rowByPath(el, `${v}/Notes`))
    await act(async () => itemByLabel(el, 'Add 2 to favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, `${v}/Projects`)) // already pinned…
    shiftClickRow(rowByPath(el, `${v}/top.md`)) // …this one not
    rightClick(rowByPath(el, `${v}/top.md`))
    expect(itemByLabel(el, 'Add 2 to favorites')).toBeDefined()
    await act(async () => itemByLabel(el, 'Add 2 to favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/Notes`, `${v}/Projects`, `${v}/top.md`])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, `${v}/Notes`))
    shiftClickRow(rowByPath(el, `${v}/Projects`))
    rightClick(rowByPath(el, `${v}/Notes`))
    expect(itemByLabel(el, 'Remove 2 from favorites')).toBeDefined()
    await act(async () => itemByLabel(el, 'Remove 2 from favorites')?.click())
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`])
  })

  it('Focus on the Favorites tab writes THIS window\'s focusFavorites — never focusDirs or the vault file — and the eye is lens-local', async () => {
    const { el, v, bridge, rerender } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    await pick(el, `${v}/Projects`, 'Focus on folder')
    expect(topLabels(el)).toEqual(['Projects'])
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(bridge.window.setIdentity).toHaveBeenCalledWith({ focusFavorites: [`${v}/Projects`] })
    expect(bridge.window.setIdentity).not.toHaveBeenCalledWith(expect.objectContaining({ focusDirs: expect.anything() }))
    expect(bridge.favorites.set).not.toHaveBeenCalled() // the fold it opened is the one write, and that is app state
    expect(eye(el)?.getAttribute('aria-label')).toBe('Exit focus mode')
    await rerender({ lens: 'files' })
    expect(eye(el)).toBeNull() // Files carries its own focus, and it is empty
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    await rerender({ lens: 'favorites' })
    expect(eye(el)).not.toBeNull()
    await act(async () => eye(el)?.click())
    expect(eye(el)).toBeNull()
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    expect(bridge.window.setIdentity).toHaveBeenLastCalledWith({ focusFavorites: [] })
  })

  it('a restored focusFavorites narrows the first render and is never written back', async () => {
    const { el, bridge } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects'], focusFavorites: ['/Notes'] })
    expect(topLabels(el)).toEqual(['Notes'])
    expect(eye(el)).not.toBeNull()
    expect(bridge.window.setIdentity).not.toHaveBeenCalled()
  })

  it('root rows drag to reorder: a drop indicator on the hovered edge, the new order persisted; nested rows do not drag; Files is untouched', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    expect(rowByPath(el, `${v}/Notes`)?.getAttribute('draggable')).toBe('true')
    expect(rowByPath(el, `${v}/top.md`)?.getAttribute('draggable')).toBe('true')
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    expect(rowByPath(el, `${v}/Projects/Alpha`)?.getAttribute('draggable')).toBe('false')
    expect(rowByPath(el, `${v}/Projects/p.md`)?.getAttribute('draggable')).toBe('false')
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    expect(rowByPath(el, `${v}/Notes`)?.classList.contains('tree__row--drop-before')).toBe(true)
    drag(rowByPath(el, `${v}/Notes`), 'drop')
    expect(topLabels(el)).toEqual(['top', 'Notes', 'Projects'])
    expect(el.querySelector('.tree__row--drop-before, .tree__row--drop-after')).toBeNull()
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [`${v}/top.md`, `${v}/Notes`, `${v}/Projects`])
    // Below the midpoint lands AFTER; nothing moved on disk at any point.
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/Projects`), 'dragover', 1)
    expect(rowByPath(el, `${v}/Projects`)?.classList.contains('tree__row--drop-after')).toBe(true)
    drag(rowByPath(el, `${v}/Projects`), 'drop')
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    expect(props.onRenameFile).not.toHaveBeenCalled()
  })

  it('dragging a favorites row onto a nested folder moves nothing on disk, and dragend abandons cleanly', async () => {
    const { el, v, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects', '/top.md'] })
    act(() => rowByPath(el, `${v}/Projects`)?.click())
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/Projects/Alpha`), 'dragover')
    expect(rowByPath(el, `${v}/Projects/Alpha`)?.classList.contains('tree__row--drop')).toBe(false)
    drag(rowByPath(el, `${v}/Projects/Alpha`), 'drop')
    expect(props.onRenameFile).not.toHaveBeenCalled()
    expect(topLabels(el)).toEqual(['Notes', 'Projects', 'top'])
    drag(rowByPath(el, `${v}/top.md`), 'dragstart')
    drag(rowByPath(el, `${v}/top.md`), 'dragend')
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    expect(el.querySelector('.tree__row--drop-before')).toBeNull()
  })

  it('reorder is off while the tab is focused — the focus list is what is shown, not the favorites order', async () => {
    const { el, v, bridge } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes', '/Projects'], focusFavorites: ['/Notes', '/Projects'] })
    drag(rowByPath(el, `${v}/Projects`), 'dragstart')
    drag(rowByPath(el, `${v}/Notes`), 'dragover', -1)
    expect(el.querySelector('.tree__row--drop-before')).toBeNull()
    drag(rowByPath(el, `${v}/Notes`), 'drop')
    expect(topLabels(el)).toEqual(['Notes', 'Projects'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('another window\'s — or a synced — write lands through favorites:changed for THIS root: re-read, never re-written', async () => {
    const { el, v, bridge, emit } = await mountVault({ lens: 'favorites' })
    expect(bodyMsg(el)).not.toBeNull()
    const reads = bridge.favorites.get.mock.calls.length // the mount read (StrictMode runs the effect twice)
    await act(async () => emit({ root: '/some-other-vault' }))
    expect(bridge.favorites.get).toHaveBeenCalledTimes(reads) // another vault's change is not this window's
    bridge.favorites.get.mockResolvedValue([`${v}/top.md`])
    await act(async () => emit({ root: v }))
    expect(topLabels(el)).toEqual(['top'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('a refused write (a malformed favorites.json → INVALID_CONFIG, D12) reverts the list and toasts an error', async () => {
    const { el, v, bridge, props } = await mountVault({ lens: 'favorites' }, { favorites: ['/Notes'] })
    bridge.favorites.set.mockRejectedValueOnce({ code: 'INVALID_CONFIG', message: 'favorites.json is malformed; fix or delete it' })
    await pick(el, `${v}/Notes`, 'Remove from favorites')
    expect(bridge.favorites.set).toHaveBeenLastCalledWith(v, [])
    expect(topLabels(el)).toEqual(['Notes']) // reverted
    expect(props.onNotice).toHaveBeenCalledWith("Can't save favorites: favorites.json is malformed; fix or delete it", 'error')
  })

  it('a favorite the tree lacks (not synced yet, or gone) draws no row and is NOT pruned — no write (D14)', async () => {
    let fire: ((ev: WatchEvent) => void) | undefined
    const watch = { subscribe: (l: (ev: WatchEvent) => void) => ((fire = l), () => undefined) }
    const { el, v, bridge } = await mountVault({ lens: 'favorites', watch }, { favorites: ['/Ghost.md', '/Notes', '/Projects'] })
    expect(topLabels(el)).toEqual(['Notes', 'Projects'])
    bridge.tree.mockResolvedValue({ root: v, tree: FAV(v).filter((n) => n.path !== `${v}/Projects`), generatedAt: 2 } as never)
    await act(async () => fire?.({ type: 'unlinkDir', path: `${v}/Projects` }))
    expect(topLabels(el)).toEqual(['Notes'])
    expect(bridge.favorites.set).not.toHaveBeenCalled()
  })

  it('expand / collapse all acts on the favorited folders only', async () => {
    const { el, v } = await mountVault({ lens: 'favorites' }, { favorites: ['/Projects'] })
    const all = el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
    expect(all?.getAttribute('aria-label')).toBe('Expand all')
    act(() => all?.click())
    expect(isOpen(el, `${v}/Projects`)).toBe('true')
    expect(isOpen(el, `${v}/Projects/Alpha`)).toBe('true')
    expect(storage.getExpanded(v)).not.toContain(`${v}/Notes`)
  })
})

/**
 * The Topics half of the same button (⚡ YAZ-873): ONE control at the end of the lens row acting
 * on whichever lens is ACTIVE. On Topics it replaces the lifted `topicsExpanded` set with
 * `allExpandableTopics` — the guarded walk's answer — and empties it when anything is open. The
 * two lenses keep their OWN stores: one button, never one set. Gone, as ever, when the active
 * reading has nothing to unfold.
 *
 * YAZ-920 reshapes what it acts ON, not what it does: Home is a pinned leaf and the topics it
 * held stand at the ROOT beside it, so "expand all" now opens one rung shallower and "collapse
 * all" comes back down to that wider set of roots.
 */
describe('expand / collapse all on TOPICS (⚡ YAZ-873)', () => {
  const rec = (v: string, basename: string, properties: Record<string, unknown> = {}) => ({
    path: `${v}/${basename}.md`, name: `${basename}.md`, basename, folder: '', ext: 'md',
    size: 1, ctime: 1, mtime: 1, properties, aliases: [] as string[], tags: [] as string[], links: [] as string[], embeds: [] as string[],
  })
  const folder = (v: string, basename: string, properties: Record<string, unknown> = {}) => rec(v, basename, { folder_page: true, ...properties })
  const belongs = (...entries: string[]): Record<string, unknown> => ({ folder_pages: entries })
  /** The window's feed over one snapshot, resolved by basename the way `makeResolver` keys it. */
  const feedOver = (records: ReturnType<typeof rec>[]) => ({
    records,
    resolve: (target: string) => records.find((r) => r.basename.toLowerCase() === target.replace(/[[\]]/g, '').trim().toLowerCase())?.path ?? null,
    subscribe: () => () => undefined,
  })
  /**
   * Two depths of meaning: Metrics names Home and so stands beside it as a ROOT (YAZ-920), and
   * Metrics holds a leaf that never unfolds.
   */
  const TOPICS = (v: string) => [folder(v, 'Home'), folder(v, 'Metrics', belongs('[[Home]]')), rec(v, 'Revenue', belongs('[[Metrics]]'))]
  /** One folder on disk beside them, so the FILES lens has something of its own to open. */
  const FILES = (v: string): TreeNode[] => [{ type: 'dir', name: 'docs', path: `${v}/docs`, children: [] }]

  // Both buckets are per ROOT in the module-level app-state cache, so every mount opens its OWN
  // vault and starts closed — the YAZ-862 describe's isolation idiom.
  let vaults = 0
  const mountVault = async (records: (v: string) => ReturnType<typeof rec>[] = TOPICS, over: Partial<SidebarProps> = {}) => {
    const vault = `/v-topics-${++vaults}`
    return mount({ root: vault, lens: 'topics', indexSource: feedOver(records(vault)), ...over }, (b) =>
      b.tree.mockResolvedValue({ root: vault, tree: FILES(vault), generatedAt: 1 } as never),
    )
  }
  const allButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')
  const label = (el: HTMLElement) => allButton(el)?.getAttribute('aria-label') ?? null
  const topicLabels = (el: HTMLElement) => [...el.querySelectorAll('[aria-label="Topics"] .tree__label')].map((n) => n.textContent)

  it('a closed topic tree offers "Expand all", and one click unfolds every page at every depth', async () => {
    const { el } = await mountVault()
    expect(topicLabels(el)).toEqual(['Home', 'Metrics'])
    expect(label(el)).toBe('Expand all')
    act(() => allButton(el)?.click())
    expect(topicLabels(el)).toEqual(['Home', 'Metrics', 'Revenue'])
    expect(label(el)).toBe('Collapse all')
  })

  it('and the click back is "Collapse all" — down to the roots, in one dispatch', async () => {
    const { el } = await mountVault()
    act(() => allButton(el)?.click())
    act(() => allButton(el)?.click())
    // The roots are the pinned Home AND every topic promoted beside it (YAZ-920).
    expect(topicLabels(el)).toEqual(['Home', 'Metrics'])
    expect(label(el)).toBe('Expand all')
  })

  it('the two lenses keep their OWN stores: expanding all of Files leaves Topics fully closed', async () => {
    const { el, rerender } = await mountVault(TOPICS, { lens: 'files' })
    act(() => allButton(el)?.click())
    expect(label(el)).toBe('Collapse all')
    await rerender({ lens: 'topics' })
    // One button, two readings of the vault: the folder tree being open says nothing about
    // whether a topic is, so Topics still offers to expand.
    expect(label(el)).toBe('Expand all')
    expect(topicLabels(el)).toEqual(['Home', 'Metrics'])
    await rerender({ lens: 'files' })
    expect(label(el)).toBe('Collapse all') // …and the Files store was never touched meanwhile
  })

  it('there is no button on Topics when nothing can unfold — a vault of leaves offers nothing', async () => {
    const { el } = await mountVault((v) => [folder(v, 'Home'), rec(v, 'Loose')])
    expect(topicLabels(el)).toEqual(['Home'])
    expect(allButton(el)).toBeNull()
  })
})

describe('context menu order (GRO-2272 C1a)', () => {
  it('a FILE row renders utilities, then create actions, then Rename and Delete last', async () => {
    const { el } = await mount()
    act(() => void el.querySelector('.tree__row--file')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(menuItems(el).map((b) => b.textContent?.replace('▸', '').trim())).toEqual([
      // The Open group (🔒 D7 amended, YAZ-1674) is EMPTY on one file row — the OS verbs fold into
      // the "Open in ▸" flyout, which stands in its own group before Delete — so the clipboard leads.
      // The clipboard group: the file clipboard first (Paste is DISABLED, not hidden, while it is
      // empty — 🔒 D5), then the text clipboard. Hints are `data-hint`, so the text stays bare.
      'Cut',
      'Copy',
      'Paste',
      'Copy path',
      'Copy for Agent',
      'New note',
      // "New folder page" (🔒 D4, YAZ-817): second in the create group, directly after the
      // note it is a kind of — it CREATES beside the right-clicked row, so it stays in the
      // create group and never drifts down to the act-on-this-row toggle.
      'New folder page',
      'New folder',
      'New dated folder',
      // The folder-page toggle joins the row between the create group and Rename (🔒 D2,
      // YAZ-817): it acts on the right-clicked page, so it belongs with the other
      // act-on-this-row items — and above the destructive pair, which stays last.
      'Turn into folder page',
      'Rename',
      // The favorite toggle (YAZ-1766 D3) leads the "Open in ▸" group, one hairline above Delete.
      'Add to favorites',
      'Open in',
      'Delete',
    ])
  })

  it('Delete is the LAST item wherever it appears', async () => {
    for (const row of ['.tree__row--file', '.tree__row--dir']) {
      const m = await mount()
      act(() => void m.el.querySelector(row)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
      const labels = menuItems(m.el).map((b) => b.textContent)
      expect(labels[labels.length - 1]).toBe('Delete')
    }
  })
})

/**
 * "New folder page" (YAZ-841 — 🔒 D4 + D1 on YAZ-817): the create group's second item, and the
 * only birth gesture for a folder page. It is the EXISTING inline-create flow with one branch at
 * the end — same validation, same placement rule (the file lands where the right-click happened),
 * same open-after-create — so the page is born through `createNewNote` carrying the flag and
 * (since YAZ-1513) the default `status` Select declaration under `folder_page_settings` — spelled
 * by `newFolderPageProperties`, never a sidebar literal — with no body and no `folder_pages`.
 */
describe('New folder page (🔒 D4 / 🔒 D1, YAZ-841)', () => {
  const openOn = async (selector: string) => {
    const m = await mount()
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')
  const errorText = (el: HTMLElement) => el.querySelector('.create-inline__error')?.textContent ?? null
  /** Type a name into the open inline input and commit it with Enter. */
  const commit = async (el: HTMLElement, name: string) => {
    const field = input(el)!
    await act(async () => {
      field.value = name
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }
  /** The birth content (🔒 D1, amended YAZ-1513): one frontmatter block — the flag and the default `status` column — no body. */
  const BORN = '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n'

  it('is offered wherever the create group is — file rows, folder rows and blank space alike', async () => {
    for (const selector of ['.tree__row--file', '.tree__row--dir', '.sidebar__body']) {
      const { el } = await openOn(selector)
      expect(itemByLabel(el, 'New folder page')).toBeDefined()
    }
  })

  it('opens the SAME inline input as New note, under its own placeholder, and closes the menu', async () => {
    const { el } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder page')?.click())
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(input(el)).not.toBeNull()
    expect(input(el)?.placeholder).toBe('New folder page')
  })

  it('committing a name creates the page born with the flag AND the default status column, in the right-clicked folder, then opens it', async () => {
    const { el, bridge, props } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New folder page')?.click())
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/sub/Growth.md', content: BORN })
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Growth.md')
    expect(input(el)).toBeNull() // the input is done
  })

  it('takes the same placement rule as New note: a FILE row creates beside it, blank space at the root', async () => {
    const onFile = await openOn('.tree__row--file')
    act(() => itemByLabel(onFile.el, 'New folder page')?.click())
    await commit(onFile.el, 'Growth')
    expect(onFile.bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Growth.md', content: BORN })

    const onBlank = await openOn('.sidebar__body')
    act(() => itemByLabel(onBlank.el, 'New folder page')?.click())
    await commit(onBlank.el, 'Growth')
    expect(onBlank.bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Growth.md', content: BORN })
  })

  it('leaves New note alone — the same flow with no seed at all, still the bare-path call', async () => {
    const { el, bridge } = await openOn('.tree__row--dir')
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/sub/Growth.md')
  })

  it('validates through the SHARED path: an invalid name gives New note\'s exact error and writes nothing', async () => {
    const note = await openOn('.tree__row--dir')
    act(() => itemByLabel(note.el, 'New note')?.click())
    await commit(note.el, 'a/b')
    const shared = errorText(note.el)
    expect(shared).not.toBeNull()
    expect(note.bridge.createFile).not.toHaveBeenCalled()

    const page = await openOn('.tree__row--dir')
    act(() => itemByLabel(page.el, 'New folder page')?.click())
    await commit(page.el, 'a/b')
    expect(errorText(page.el)).toBe(shared)
    expect(page.bridge.createFile).not.toHaveBeenCalled()
    expect(input(page.el)).not.toBeNull() // the input stays open to fix the name
  })
})

/**
 * The folder-page toggle (YAZ-840 — 🔒 D1/D2/D3/D5 on YAZ-817): the first user-facing
 * folder-page gesture. ONE state-aware item on MARKDOWN FILE rows.
 *
 *  - forward (🔒 D1) is IMMEDIATE and goes through ONE content transform — `turnIntoFolderPage`,
 *    the settings module's own, which writes the flag and seeds the default `status` column only
 *    when the page has no settings yet (YAZ-1513) — with no confirm to click through for
 *    something this same item undoes;
 *  - reverse (🔒 D5) asks first, restores the migrated outline to the Markdown body, removes the
 *    active outline value and flag together, and leaves every other setting and member entry.
 *
 * The flag state behind the label comes off the window's ALREADY-ON index feed (the same
 * snapshot WikilinkIndexBridge pushes at the wikilink resolver), read when the menu opens — no
 * second feed and no fetch of its own.
 */
describe('folder-page toggle (YAZ-840)', () => {
  const transform = vi.mocked(transformFile)
  const write = vi.mocked(writeProperty)

  const MIXED_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  const record = (path: string, properties: Record<string, unknown> = {}) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    return { path, name, basename: name.replace(/\.[^.]+$/, ''), folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [] }
  }
  /** A stubbed index feed holding this snapshot — the shape App hands over from the bridge's source. */
  const feed = (...records: ReturnType<typeof record>[]): SidebarProps['indexSource'] =>
    ({ resolve: null, records, subscribe: () => () => undefined }) as SidebarProps['indexSource']

  /** Mount over the mixed tree, then right-click one row (or the blank body). */
  const openOn = async (selector: string, indexSource: SidebarProps['indexSource']) => {
    const m = await mount({ indexSource }, (b) =>
      b.tree.mockImplementation(async (r: string) => ({ root: r, tree: MIXED_TREE, generatedAt: 1 })),
    )
    act(() => void m.el.querySelector(selector)?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    return m
  }

  const sheetText = (el: HTMLElement) => el.querySelector('#confirm-turn-back-text')?.textContent ?? null
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  beforeEach(() => {
    transform.mockReset()
    transform.mockResolvedValue({ mtime: 2, content: '' })
    write.mockReset()
    write.mockResolvedValue({ mtime: 2 })
  })

  it('offers "Turn into folder page" on a markdown row whose flag is off', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
    expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()
  })

  it('offers "Turn back into normal page" once that row IS a folder page', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    expect(itemByLabel(el, 'Turn back into normal page')).toBeDefined()
    expect(itemByLabel(el, 'Turn into folder page')).toBeUndefined()
  })

  it('reads the flag through isFolderPage — only the boolean true is on', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: 'true' })))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
  })

  it('shows no toggle at all on folder rows or on blank space', async () => {
    for (const selector of ['.tree__row--dir', '.sidebar__body']) {
      const { el } = await openOn(selector, feed(record('/v/a.md', { folder_page: true })))
      expect(itemByLabel(el, 'Turn into folder page')).toBeUndefined()
      expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()
      expect(el.querySelector('.ctx-menu')).not.toBeNull() // the menu itself is still there
    }
  })

  it('FORWARD is ONE transform through turnIntoFolderPage — the flag plus the seeded default column — with NO confirm sheet (🔒 D1, YAZ-1513)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    await act(async () => itemByLabel(el, 'Turn into folder page')?.click())
    expect(transform).toHaveBeenCalledExactlyOnceWith('/v/a.md', turnIntoFolderPage)
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('REVERSE opens the sheet with the LOCKED copy and writes nothing yet (🔒 D5)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    expect(sheetText(el)).toBe(
      "Turn 'a.md' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.",
    )
    expect(write).not.toHaveBeenCalled()
  })

  it('Cancel on the sheet writes NOTHING and closes it', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Cancel')?.click())
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('confirming restores the body through one whole-file transform (🔒 D3)', async () => {
    const { el } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Turn back')?.click())
    expect(transform).toHaveBeenCalledExactlyOnceWith('/v/a.md', expect.any(Function))
    expect(write).not.toHaveBeenCalled()
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a failed write surfaces as the passive notice — never a dialog', async () => {
    transform.mockRejectedValue(new Error('read-only volume'))
    const { el, props } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md')))
    await act(async () => itemByLabel(el, 'Turn into folder page')?.click())
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('read-only volume'), 'error')
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('a failed turn-BACK names that direction in the notice', async () => {
    transform.mockRejectedValue(new Error('read-only volume'))
    const { el, props } = await openOn('[title="/v/a.md"]', feed(record('/v/a.md', { folder_page: true })))
    act(() => itemByLabel(el, 'Turn back into normal page')?.click())
    await act(async () => sheetBtn(el, 'Turn back')?.click())
    expect(props.onNotice).toHaveBeenCalledWith(expect.stringContaining('back into a normal page'), 'error')
  })
})

/**
 * The TOPICS context menu (8G-, YAZ-865 — the ⚡ amendment on YAZ-821, ruled by Yasin): a Topics
 * PAGE row gets the SAME menu a FILE row gets, on the page's own file. Not a menu of that lens'
 * own — `TopicsTree` reports the row and the Sidebar opens its ONE `ContextMenu`, so the items,
 * their order, every target (GRO-2296) and every pipeline behind them are literally the file
 * tree's and cannot drift between the two readings of one vault.
 *
 * What gets NOTHING: the Uncategorized HEADER (there is no page behind it), the offer card, and
 * blank space — whose menu stays the FILE tree's, its guard untouched (🔒 D7 and YAZ-847 both hold).
 */
describe('the Topics context menu (8G-, YAZ-865)', () => {
  const record = (path: string, properties: Record<string, unknown> = {}) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const rel = path.slice('/v/'.length)
    return {
      path,
      name,
      basename: name.replace(/\.[^.]+$/, ''),
      folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [],
    }
  }
  /**
   * Docs is a topic under Home — and since YAZ-920 Home is a PINNED LEAF, so a member hangs off
   * Docs, never off Home itself. Docs has ONE member, and that member lives in a SUBFOLDER — so
   * "create beside the page's file" has a folder of its own to prove, which is exactly the fact
   * this lens hides. Loose belongs nowhere and waits under Uncategorized.
   */
  const HOME = record('/v/Home.md', { folder_page: true })
  const DOCS = record('/v/Docs.md', { folder_page: true, folder_pages: ['[[Home]]'] })
  const GUIDE = record('/v/Docs/Guide.md', { folder_pages: ['[[Docs]]'] })
  const LOOSE = record('/v/Loose.md')
  const INBOX_NOTE = record('/v/inbox/Loose.md')
  /**
   * A folder page that DECLARES things (8H, YAZ-869): two columns for the scaffold to empty out
   * and a parking `folder`, so a birth from its row has something to prove beyond "it happened".
   */
  const METRICS = record('/v/Metrics.md', {
    folder_page: true,
    folder_pages: ['[[Home]]'],
    folder_page_settings: { folder: 'KPIs', columns: { owner: { kind: 'text' }, funnels: { kind: 'multi-link' } } },
  })
  const feedOver = (...records: ReturnType<typeof record>[]): SidebarProps['indexSource'] =>
    ({
      // The links this vault declares, keyed like the real resolver (lowered, brackets and all).
      resolve: (target: string) =>
        ({
          '[[home]]': records.includes(HOME) ? HOME.path : null,
          '[[docs]]': records.includes(DOCS) ? DOCS.path : null,
          '[[metrics]]': records.includes(METRICS) ? METRICS.path : null,
        })[target.trim().toLowerCase()] ?? null,
      records,
      subscribe: () => () => undefined,
    }) as SidebarProps['indexSource']

  const topics = (over: Partial<SidebarProps> = {}) => mount({ lens: 'topics', indexSource: feedOver(HOME, DOCS, GUIDE, LOOSE), ...over })
  const topicsWithInbox = (over: Partial<SidebarProps> = {}) =>
    mount({ lens: 'topics', indexSource: feedOver(HOME, DOCS, GUIDE, INBOX_NOTE), ...over })
  const rowFor = (el: HTMLElement, label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === label)
  const rightClick = (node: Element | null | undefined) => act(() => void node?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  /**
   * 🔒 D3: the chevron is the expand gesture; the row itself opens the page. It is DOCS' chevron
   * since YAZ-920 — Home is a pinned leaf now and offers none at all.
   */
  const expandDocs = (el: HTMLElement) => act(() => el.querySelector<HTMLElement>('[aria-label="Expand Docs"]')?.click())
  const inlineInput = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.create-inline__input')
  const commit = async (el: HTMLElement, name: string) => {
    const field = inlineInput(el)!
    await act(async () => {
      field.value = name
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
  }
  const confirmBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('a PAGE row opens the file tree\'s OWN menu — item for item, in the same order (GRO-2272 C1a)', async () => {
    const { el } = await topics()
    await rightClick(rowFor(el, 'Home'))
    expect(menuItems(el).map((b) => b.textContent)).toEqual([
      // Cut / Copy on any row (🔒 D5, YAZ-1674) — but NO Paste: a PAGE row is a meaning row, and
      // Paste goes exactly where "New folder" goes.
      'Cut',
      'Copy',
      'Copy path',
      'Copy for Agent',
      'New note',
      'New folder page',
      // …and NOT 'New folder' (YAZ-948, ruled by Yasin): this lens browses by MEANING, so a disk
      // folder made from it would land where the lens cannot show it. The Files lens keeps it.
      // Home IS a folder page, so the ONE state-aware item shows the REVERSE label (🔒 D2).
      'Turn back into normal page',
      'Rename',
      'Add to favorites',
      'Open in',
      'Delete',
    ])
  })

  it('the toggle\'s label follows THAT row\'s flag: a leaf is offered the forward direction', async () => {
    const { el } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide'))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
    expect(itemByLabel(el, 'Turn back into normal page')).toBeUndefined()
  })

  it('every item resolves the PAGE\'s own file: Reveal and Copy path name it exactly (GRO-2296)', async () => {
    const writeText = installClipboard()
    const { el, bridge } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide'))
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/Docs/Guide.md' })
    await rightClick(rowFor(el, 'Guide'))
    act(() => itemByLabel(el, 'Copy path')?.click())
    // The PAGE's path, never the vault root's — the blank-space fallback stays where it belongs.
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/Docs/Guide.md')
  })

  it('Delete flows through the EXISTING pipeline: the same sheet, then onDeleteFile with the page\'s path', async () => {
    const { el, props } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide'))
    await act(async () => itemByLabel(el, 'Delete')?.click())
    expect(el.querySelector('.confirm')).not.toBeNull()
    expect(props.onDeleteFile).not.toHaveBeenCalled() // opening the sheet deletes nothing
    await act(async () => confirmBtn(el, 'Delete')?.click())
    expect(props.onDeleteFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Guide.md')
  })

  it('Rename opens the inline input ON the Topics row and commits through the rename pipeline', async () => {
    const { el, props } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide'))
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(inlineInput(el)?.value).toBe('Guide') // the name minus its extension — the file tree's prefill
    expect(rowFor(el, 'Guide')).toBeUndefined() // …IN PLACE of the row, never beside it
    await commit(el, 'Manual')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Guide.md', '/v/Docs/Manual.md', 'file')
  })

  it('a page standing under TWO parents renames through ONE input — two autofocused ones would fight', async () => {
    // The diamond (⚡ D6): Guide belongs to two topics, so it renders twice. An inline input is
    // ONE input — the second's mount would blur, and so CANCEL, the first. Both parents are real
    // topics: since YAZ-920 Home descends into nothing, so it can never be one half of a diamond.
    const OPS = record('/v/Ops.md', { folder_page: true })
    const SHARED = record('/v/Docs/Guide.md', { folder_pages: ['[[Docs]]', '[[Ops]]'] })
    const both = {
      records: [HOME, DOCS, OPS, SHARED],
      resolve: (target: string) =>
        ({ '[[home]]': HOME.path, '[[docs]]': DOCS.path, '[[ops]]': OPS.path })[target.trim().toLowerCase()] ?? null,
      subscribe: () => () => undefined,
    } as SidebarProps['indexSource']
    const { el } = await topics({ indexSource: both })
    await expandDocs(el)
    await act(() => el.querySelector<HTMLElement>('[aria-label="Expand Ops"]')?.click())
    const guides = () => [...el.querySelectorAll('.tree__row .tree__label')].filter((n) => n.textContent === 'Guide').length
    expect(guides()).toBe(2)
    await rightClick(rowFor(el, 'Guide'))
    act(() => itemByLabel(el, 'Rename')?.click())
    expect(el.querySelectorAll('.create-inline__input')).toHaveLength(1)
    expect(guides()).toBe(1) // the FIRST occurrence became the input; the other stays a row
  })

  it('the create group lands BESIDE the page\'s file on disk — the file tree\'s own rule', async () => {
    const { el, bridge, props } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide'))
    act(() => itemByLabel(el, 'New note')?.click())
    // The input is drawn under the row it was asked from; the row itself stays put.
    expect(inlineInput(el)?.placeholder).toBe('New note')
    expect(rowFor(el, 'Guide')).toBeDefined()
    await commit(el, 'Nearby')
    // `/v/Docs`, the folder this lens never shows — belonging is meaning, the file is still a file.
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Nearby.md')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/Docs/Nearby.md')
  })

  /**
   * YAZ-948 follow-up (Yasin, dogfooding: "i just tried to click 'create folder page' and its not
   * working"): the blank-space menu opened a create whose inline input had NOWHERE to draw. The
   * Topics tree only ever rendered the input BESIDE its anchor row, and blank space has no row —
   * so the item silently did nothing. A blank-space create is a ROOT create, so the input belongs
   * at the top of the tree, above the roots, at their own indent.
   */
  it('"New folder page" from BLANK SPACE draws its input at the root and is born there', async () => {
    const { el, bridge } = await topics()
    await rightClick(el.querySelector('.sidebar__body'))
    act(() => itemByLabel(el, 'New folder page')?.click())
    const field = inlineInput(el)
    expect(field).not.toBeNull() // the bug: no input rendered at all, so the click did nothing
    expect(field?.closest('.tree')).not.toBeNull() // …and it belongs INSIDE the tree, not floating
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Growth.md', content: '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n' })
  })

  it('"New note" from BLANK SPACE lands in the vault root too — the same anchorless path', async () => {
    const { el, bridge } = await topics()
    await rightClick(el.querySelector('.sidebar__body'))
    act(() => itemByLabel(el, 'New note')?.click())
    expect(inlineInput(el)).not.toBeNull()
    await commit(el, 'Loose thought')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/Loose thought.md')
  })

  it('"New folder page" on a LEAF Topics row is born with the flag and the default status column, beside that page (🔒 D1 + YAZ-1513)', async () => {
    const { el, bridge } = await topics()
    await expandDocs(el)
    await rightClick(rowFor(el, 'Guide')) // a leaf: nothing to belong to, so nothing is declared
    act(() => itemByLabel(el, 'New folder page')?.click())
    await commit(el, 'Growth')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith({ path: '/v/Docs/Growth.md', content: '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n' })
  })

  /**
   * 8H (⚡ YAZ-869, Yasin's dogfooding ruling): "New note" ON a topic means "a note IN this topic".
   * The birth travels the folder page's OWN declaration path — the same `newPageFromFolderPage`
   * the contents block's New uses — and parks where that page's members live. Pinned here rather
   * than in a unit: the whole point is that the SIDEBAR's create group reaches it.
   *
   * Metrics names only Home, so since YAZ-920 it stands at the ROOT: these cases right-click it
   * where it sits, with nothing to unfold first.
   */
  const topicsWithMetrics = (over: Partial<SidebarProps> = {}, tweak?: (b: ReturnType<typeof installBridge>) => void) =>
    mount({ lens: 'topics', indexSource: feedOver(HOME, DOCS, METRICS, GUIDE, LOOSE), ...over }, tweak)
  /** The frontmatter of the single content-at-create call, parsed — key ORDER included. */
  const born = (bridge: ReturnType<typeof installBridge>) => {
    expect(bridge.createFile).toHaveBeenCalledTimes(1)
    const req = bridge.createFile.mock.calls[0][0] as { path: string; content: string }
    const { frontmatter, body } = splitFrontmatter(req.content)
    return { path: req.path, properties: parseFrontmatter(frontmatter).properties, body }
  }

  it('"New note" on a FLAGGED row births a MEMBER: declared columns empty, folder_pages LAST, parked per settings', async () => {
    const { el, bridge, props } = await topicsWithMetrics()
    await rightClick(rowFor(el, 'Metrics'))
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    // The parking folder is created level by level before the file lands (locked Q5/Q6).
    expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith('/v/KPIs')
    const page = born(bridge)
    expect(page.path).toBe('/v/KPIs/Growth.md')
    // The DECLARATION is the schema: every column, empty by kind — and the birth key LAST, so the
    // card reads columns-then-parent.
    expect(Object.keys(page.properties)).toEqual(['owner', 'funnels', 'folder_pages'])
    expect(page.properties).toEqual({ owner: null, funnels: [], folder_pages: ['[[Metrics]]'] })
    expect(page.body).toBe('')
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/KPIs/Growth.md')
  })

  it("…and the folder page's TEMPLATE rides along, without ever displacing the birth key", async () => {
    const { el, bridge } = await topicsWithMetrics({}, (b) => {
      b.readFile = vi.fn(async (path: string) => {
        if (path !== '/v/.yaseendocs/templates/Metrics.md') throw { code: 'NOT_FOUND', message: path }
        return { path, content: '---\nowner: Yasin\nstage: draft\nfolder_pages: ["[[Elsewhere]]"]\n---\n\n## Notes\n', mtime: 1, size: 1 }
      })
    })
    await rightClick(rowFor(el, 'Metrics'))
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Growth')
    const page = born(bridge)
    // Template values win over the empty scaffold, template-only keys are KEPT (frontmatter is the
    // source of truth and the declaration gates no content) — and the template's own attempt to
    // redirect the belonging is overwritten AND pushed back to last.
    expect(Object.keys(page.properties)).toEqual(['owner', 'funnels', 'stage', 'folder_pages'])
    expect(page.properties).toEqual({ owner: 'Yasin', funnels: [], stage: 'draft', folder_pages: ['[[Metrics]]'] })
    expect(page.body).toBe('\n## Notes\n')
  })

  it('"New folder page" on a FLAGGED row is a SUB-TOPIC: the flag, and the belonging beside it', async () => {
    const { el, bridge } = await topicsWithMetrics()
    await rightClick(rowFor(el, 'Metrics'))
    act(() => itemByLabel(el, 'New folder page')?.click())
    await commit(el, 'Retention')
    const page = born(bridge)
    expect(page.path).toBe('/v/KPIs/Retention.md') // parked with Metrics' other members
    // YAZ-1513: born like every folder page — the flag AND the default `status` declaration —
    // and 8H adds only the one entry that nests it. Still no template, no body.
    expect(Object.keys(page.properties)).toEqual(['folder_page', 'folder_page_settings', 'folder_pages'])
    expect(page.properties).toEqual({ ...newFolderPageProperties(), folder_pages: ['[[Metrics]]'] })
    expect(page.body).toBe('')
    expect(bridge.readFile).not.toHaveBeenCalled()
  })

  it('"New folder" is not offered from a Topics row at all (YAZ-948) — the create group keeps the rest', async () => {
    // It USED to create beside the page's file (a folder is never a member, so the flag was
    // irrelevant). YAZ-948 removes the item from this lens instead: browsing by meaning cannot
    // show what a disk folder is, so the honest answer is not to offer it. Files keeps it.
    const { el, bridge } = await topicsWithMetrics()
    await rightClick(rowFor(el, 'Metrics'))
    expect(itemByLabel(el, 'New folder')).toBeUndefined()
    expect(itemByLabel(el, 'New dated folder')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(itemByLabel(el, 'New folder page')).toBeDefined()
    expect(bridge.createDir).not.toHaveBeenCalled()
  })

  it('the FILES lens is untouched, even on a row whose file IS a folder page', async () => {
    // The same kind of record that births members in Topics, right-clicked in the FILE tree:
    // `topicsAnchor` is null there, so the create group falls straight through to the file rule.
    const A = record('/v/a.md', { folder_page: true, folder_page_settings: { folder: 'KPIs' } })
    const { el, bridge } = await mount({ lens: 'files', indexSource: feedOver(A) })
    await rightClick(fileRow(el))
    act(() => itemByLabel(el, 'New note')?.click())
    await commit(el, 'Nearby')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/Nearby.md')
    expect(bridge.createDir).not.toHaveBeenCalled()
  })

  it('an UNCATEGORIZED member is a page like any other: same menu, its own path', async () => {
    const { el, bridge } = await topics()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click()) // expand the section
    await rightClick(rowFor(el, 'Loose'))
    expect(itemByLabel(el, 'Turn into folder page')).toBeDefined()
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/Loose.md' })
  })

  it('an Uncategorized DISK FOLDER opens the exact applicable Files folder menu', async () => {
    const { el } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())
    await rightClick(rowFor(el, 'inbox'))

    // 🔒 D7 (YAZ-1674) order — and a DISK-folder row is the honest exception in this lens: it gets
    // the disk verb Paste (disabled while the clipboard is empty) exactly as it gets "New folder".
    expect(menuItems(el).map((button) => button.textContent)).toEqual([
      'Cut',
      'Copy',
      'Paste',
      'Copy path',
      'New note',
      'New folder page',
      'New folder',
      'New dated folder',
      'Rename',
      'Add to favorites',
      'Open in',
      'Delete',
    ])
  })

  it('folder utilities target the selected disk folder rather than the vault root', async () => {
    const writeText = installClipboard()
    const { el, bridge } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())

    await rightClick(rowFor(el, 'inbox'))
    act(() => itemByLabel(el, 'Copy path')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/inbox')

    await rightClick(rowFor(el, 'inbox'))
    clickSub(el, 'Reveal in Finder')
    expect(bridge.shell.reveal).toHaveBeenCalledExactlyOnceWith({ path: '/v/inbox' })
  })

  it('folder Rename replaces that mini-tree row and commits through the shared directory pipeline', async () => {
    const { el, props } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())
    await rightClick(rowFor(el, 'inbox'))
    act(() => itemByLabel(el, 'Rename')?.click())

    expect(inlineInput(el)?.value).toBe('inbox')
    expect(rowFor(el, 'inbox')).toBeUndefined()
    await commit(el, 'Archive')
    expect(props.onRenameFile).toHaveBeenCalledExactlyOnceWith('/v/inbox', '/v/Archive', 'dir')
  })

  it('folder create actions draw beneath the selected branch and use it as the filesystem parent', async () => {
    const { el, bridge } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())
    act(() => rowFor(el, 'inbox')?.click()) // create must reopen a collapsed target, as Files does
    await rightClick(rowFor(el, 'inbox'))
    act(() => itemByLabel(el, 'New note')?.click())

    expect(inlineInput(el)?.placeholder).toBe('New note')
    expect(inlineInput(el)?.parentElement?.style.paddingLeft).toBe('36px')
    await commit(el, 'Nearby')
    expect(bridge.createFile).toHaveBeenCalledExactlyOnceWith('/v/inbox/Nearby.md')
  })

  it('New folder remains hidden from Topics pages and blank space but works on a disk-folder row', async () => {
    const { el, bridge } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())

    await rightClick(rowFor(el, 'Loose'))
    expect(itemByLabel(el, 'New folder')).toBeUndefined()
    expect(itemByLabel(el, 'New dated folder')).toBeUndefined()
    await rightClick(rowFor(el, 'inbox'))
    act(() => itemByLabel(el, 'New folder')?.click())
    expect(inlineInput(el)?.placeholder).toBe('New folder')
    await commit(el, 'Later')
    expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith('/v/inbox/Later')
  })

  // The caret and the no-op Enter on a bare seed are CreateInline.test's; this pins only the wiring:
  // the item opens the SAME box, seeded with today's date, in the right-clicked folder.
  it('New dated folder opens the create box pre-filled with today\'s `MM_DD- ` in that folder (YAZ-1604)', async () => {
    const { el, bridge } = await topicsWithInbox()
    act(() => el.querySelector<HTMLButtonElement>('.tree__row--muted')?.click())
    vi.useFakeTimers({ toFake: ['Date'] }) // only Date: the seed is read when the item is clicked
    vi.setSystemTime(new Date(2026, 5, 22))
    try {
      await rightClick(rowFor(el, 'inbox'))
      act(() => itemByLabel(el, 'New dated folder')?.click())
      expect(inlineInput(el)?.value).toBe('06_22- ')
      await commit(el, '06_22- Launch')
      expect(bridge.createDir).toHaveBeenCalledExactlyOnceWith('/v/inbox/06_22- Launch')
    } finally {
      vi.useRealTimers()
    }
  })

  /**
   * YAZ-948: ONE rule for this lens — a PAGE row opens that page's menu, and everything else in
   * the body (blank space, the Uncategorized header, the offer card) opens the VAULT ROOT's, the
   * same menu Files has always given its blank space. Neither the header nor the card is a page,
   * so neither claims the event; they fall through to the body exactly as bare space does. What
   * used to be "no menu at all" was never a decision about these two — it was 🔒 YAZ-847
   * withholding the blank-space menu from the whole lens, which YAZ-948 retires.
   */
  it('the Uncategorized HEADER has no page behind it, so it opens the ROOT menu, not a page menu', async () => {
    const { el } = await topics()
    await rightClick(el.querySelector('.tree__row--muted'))
    expect(menuItems(el).map((b) => b.textContent)).toEqual(['Copy path', 'New note', 'New folder page', 'Open in'])
    // No page target anywhere in it: the row-only items stay absent.
    expect(itemByLabel(el, 'Rename')).toBeUndefined()
    expect(itemByLabel(el, 'Delete')).toBeUndefined()
  })

  it('the offer card and BLANK SPACE open that same root menu — nothing in this lens offers "New folder"', async () => {
    // Un-adopted AND nothing answers [[Home]]: the 6C card is up, over an otherwise bare lens.
    const { el } = await topics({ unadopted: true, indexSource: feedOver(LOOSE) })
    expect(el.querySelector('.topics-offer')).not.toBeNull()
    await rightClick(el.querySelector('.topics-offer'))
    expect(itemByLabel(el, 'New folder page')).toBeDefined()
    expect(itemByLabel(el, 'New folder')).toBeUndefined()
    expect(itemByLabel(el, 'New dated folder')).toBeUndefined()
    await rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(itemByLabel(el, 'New folder')).toBeUndefined()
    expect(itemByLabel(el, 'New dated folder')).toBeUndefined()
  })
})

/**
 * Multi-select (YAZ-1334 → YAZ-1336). Shift+click TOGGLES a file row in/out of a path-keyed
 * selection (🔒 D2 amended: toggle-accumulate, range is out of v1) — it never opens, never
 * previews. Selection is Sidebar-owned view state (🔒 D1): Escape and a lens switch clear it;
 * since D9 (YAZ-1674) a plain click — and ⌘-click's LOCKED background-open gesture (I3) — makes
 * it EXACTLY the clicked row, so every clipboard chord has a target the moment a row is clicked.
 */
describe('Sidebar multi-select via shift+click (YAZ-1336)', () => {
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withMultiTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) =>
    el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClick = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const selectedPaths = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((r) => r.dataset.path)

  it('shift+click toggles file rows into and out of the selection without opening anything', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/b.md'))
    expect(selectedPaths(el)).toEqual(['/v/a.md', '/v/b.md'])
    expect(rowByPath(el, '/v/a.md')?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    shiftClick(rowByPath(el, '/v/a.md'))
    expect(selectedPaths(el)).toEqual(['/v/b.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('plain click makes the selection EXACTLY the clicked file and opens it as before (D9, YAZ-1674)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/b.md'))
    act(() => rowByPath(el, '/v/c.md')?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/c.md')
    expect(selectedPaths(el)).toEqual(['/v/c.md'])
  })

  it('a MOUSE click on the file ALREADY open only selects it — no re-open, no caret jump into the editor (D11, YAZ-1674)', async () => {
    // Click-then-⌘C must work on the open note too: YAZ-961's "take me in" is Enter's (detail 0), never the mouse's.
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.tabIndex = -1
    Object.defineProperty(pm, 'offsetParent', { get: () => document.body })
    instance.appendChild(pm)
    document.body.appendChild(instance)
    const { el, props } = await mount({ activeFile: '/v/a.md' }, withMultiTree)
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })))
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    expect(document.activeElement).not.toBe(pm)
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })))
    expect(document.activeElement).toBe(pm) // Enter (detail 0) still takes the caret in (YAZ-961)
    instance.remove()
  })

  it('⌘-click selects the clicked row too and still opens a background tab (LOCKED I3)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    act(() => void rowByPath(el, '/v/b.md')?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith('/v/b.md')
    expect(selectedPaths(el)).toEqual(['/v/b.md'])
  })

  it('shift+click on a dir row toggles it in and out beside files — folders select too (YAZ-1578, 🔒 D1)', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    shiftClick(rowByPath(el, '/v/sub'))
    expect(selectedPaths(el)).toEqual(['/v/sub', '/v/a.md']) // panel order, not click order
    expect(rowByPath(el, '/v/sub')?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    shiftClick(rowByPath(el, '/v/sub'))
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('Escape clears the selection', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    expect(selectedPaths(el)).toEqual(['/v/a.md'])
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(selectedPaths(el)).toEqual([])
  })

  it('switching lens clears the selection', async () => {
    const { el, rerender } = await mount({}, withMultiTree)
    shiftClick(rowByPath(el, '/v/a.md'))
    await rerender({ lens: 'topics' })
    await rerender({ lens: 'files' })
    expect(selectedPaths(el)).toEqual([])
  })
})

/** The other two ways a selection ends (YAZ-1336), and the one press that must NOT be taken. */
describe('Sidebar multi-select: search, Escape-when-empty, and the prune', () => {
  const selectedRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.tree__row--selected')]
  const shiftClick = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))

  it('a typed query ends it: the tree comes back with nothing selected', async () => {
    const { el } = await mount()
    shiftClick(fileRow(el))
    expect(selectedRows(el)).toHaveLength(1)
    // 🔒 the flat-list ruling (YAZ-739): a query REPLACES the tree, so a selection cannot survive
    // underneath it and be waiting when the query clears.
    await type(searchInput(el) as HTMLInputElement, 'a')
    expect(el.querySelector('.tree')).toBeNull()
    await type(searchInput(el) as HTMLInputElement, '')
    expect(el.querySelector('.tree')).not.toBeNull()
    expect(selectedRows(el)).toHaveLength(0)
  })

  it('Escape with NOTHING selected is left alone — the key still belongs to everyone else', async () => {
    const { el } = await mount()
    const body = el.querySelector('.sidebar__body') as HTMLElement
    const spare = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void body.dispatchEvent(spare))
    expect(spare.defaultPrevented).toBe(false)
    // With a selection standing it IS the selection's key: taken, not passed on.
    shiftClick(fileRow(el))
    const taken = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => void body.dispatchEvent(taken))
    expect(taken.defaultPrevented).toBe(true)
    expect(selectedRows(el)).toHaveLength(0)
  })

  it('a file that leaves the tree leaves the selection with it, and the rest stays selected', async () => {
    const A: TreeNode = { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' }
    const B: TreeNode = { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' }
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { el, bridge } = await mount({ watch }, (b) => b.tree.mockResolvedValue({ root: '/v', tree: [A, B], generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClick(row)
    expect(selectedRows(el)).toHaveLength(2)
    // b is deleted on disk: the watcher-driven refresh brings the tree that no longer has it.
    bridge.tree.mockResolvedValue({ root: '/v', tree: [A], generatedAt: 2 })
    await act(async () => emit?.({ type: 'unlink', path: '/v/b.md' }))
    expect(selectedRows(el).map((r) => r.dataset.path)).toEqual(['/v/a.md'])
  })

  it('a refresh keeps a selected FOLDER that is still on disk and drops one that left (YAZ-1578)', async () => {
    const A: TreeNode = { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' }
    const KEPT: TreeNode = { type: 'dir', name: 'kept', path: '/v/kept', children: [] }
    const GONE: TreeNode = { type: 'dir', name: 'gone', path: '/v/gone', children: [] }
    let emit: ((ev: WatchEvent) => void) | undefined
    const watch = {
      subscribe: (l: (ev: WatchEvent) => void) => {
        emit = l
        return () => undefined
      },
    }
    const { el, bridge } = await mount({ watch }, (b) => b.tree.mockResolvedValue({ root: '/v', tree: [GONE, KEPT, A], generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row[data-path]')) shiftClick(row)
    expect(selectedRows(el)).toHaveLength(3)
    bridge.tree.mockResolvedValue({ root: '/v', tree: [KEPT, A], generatedAt: 2 })
    await act(async () => emit?.({ type: 'unlinkDir', path: '/v/gone' }))
    expect(selectedRows(el).map((r) => r.dataset.path)).toEqual(['/v/kept', '/v/a.md'])
  })
})

/**
 * Multi-select context-menu actions (YAZ-1334 → YAZ-1337, 🔒 D5). Right-clicking a row that is
 * INSIDE a 2+ selection adds "Copy N paths" / "Open N in new tabs" ABOVE the singular items —
 * plural targets live in their OWN MenuTargets fields per the one-field-per-item doctrine.
 * Right-clicking outside the selection clears it; blank space leaves it alone. Copied paths come
 * out in VISIBLE tree order (not click order), newline-joined, deduped by construction.
 */
describe('Sidebar multi-select context menu (YAZ-1337)', () => {
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withMultiTree = (bridge: ReturnType<typeof installBridge>) =>
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) =>
    el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null) =>
    act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const selectedCount = (el: HTMLElement) => el.querySelectorAll('.tree__row--selected').length
  function installClipboard() {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('right-click inside a 2-selection: "Open 2 in new tabs" LEADS, "Copy 2 paths" leads the clipboard group; copy is VISIBLE order, selection survives', async () => {
    const writeText = installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/c.md')) // click order c → a…
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    const labels = menuItems(el).map((b) => b.textContent)
    // 🔒 D7 (YAZ-1674) loosens YAZ-1337's "the plural pair leads": the plural OPEN still leads the
    // whole menu, but the plural COPY now sits in the clipboard group, below the Open group —
    // directly above the singular "Copy path", which it still leads.
    expect(labels[0]).toBe('Open 2 in new tabs')
    expect(labels.indexOf('Copy 2 paths')).toBeGreaterThan(labels.indexOf('Open 2 in new tabs'))
    expect(labels.indexOf('Copy 2 paths')).toBe(labels.indexOf('Copy path') - 1)
    expect(labels).toContain('Open 2 in new tabs')
    expect(labels).toContain('Copy path') // singular items still target the clicked row
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/a.md\n/v/c.md') // …but tree order out
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(2)
    await act(async () => {})
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 paths') // YAZ-1341: a copy SAYS SO
  })

  it('the singular "Copy path" confirms too — every copy speaks with the one voice (YAZ-1341)', async () => {
    installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    rightClick(rowByPath(el, '/v/a.md'))
    act(() => itemByLabel(el, 'Copy path')?.click())
    await act(async () => {})
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied path')
  })

  it('"Open N in new tabs" background-opens every selected path and keeps the selection', async () => {
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    rightClick(rowByPath(el, '/v/b.md'))
    act(() => itemByLabel(el, 'Open 3 in new tabs')?.click())
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(3)
    expect((props.onOpenFileBackground as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['/v/a.md', '/v/b.md', '/v/c.md'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(3)
  })

  it('a 1-selection gets no plural items — the singular menu already is that menu', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 1 paths')).toBeUndefined()
    expect(itemByLabel(el, 'Copy 1 path')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
  })

  it('right-click on a row OUTSIDE the selection SELECTS that row (D9, Finder) and shows the ordinary menu', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(rowByPath(el, '/v/c.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined()
    expect(selectedCount(el)).toBe(1)
    expect(rowByPath(el, '/v/c.md')?.classList.contains('tree__row--selected')).toBe(true)
  })

  it('right-click on blank space leaves the selection alone and stays plural-free', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(el.querySelector('.sidebar__body'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'New note')).toBeDefined()
    expect(selectedCount(el)).toBe(2)
  })

  // ---- Mixed selections (YAZ-1578, 🔒 D3): folders copy, only files open ----

  it('right-click a selected FOLDER in a mixed selection: "Copy N paths" lists all N, "Open N in new tabs" opens only the files', async () => {
    const writeText = installClipboard()
    const { el, props } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/b.md'))
    shiftClickRow(rowByPath(el, '/v/sub'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Copy 3 paths')).toBeDefined()
    expect(itemByLabel(el, 'Open 2 in new tabs')).toBeDefined()
    expect(itemByLabel(el, 'Copy path')).toBeDefined() // the singular items still target the folder
    act(() => itemByLabel(el, 'Copy 3 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/sub\n/v/a.md\n/v/b.md') // panel order
    rightClick(rowByPath(el, '/v/sub'))
    act(() => itemByLabel(el, 'Open 2 in new tabs')?.click())
    expect(props.onOpenFileBackground).toHaveBeenCalledTimes(2)
    expect(props.onOpenFileBackground).toHaveBeenNthCalledWith(1, '/v/a.md')
    expect(props.onOpenFileBackground).toHaveBeenNthCalledWith(2, '/v/b.md')
    expect(selectedCount(el)).toBe(3)
  })

  it('a folders-only selection offers "Copy N paths" and no "Open … in new tabs"', async () => {
    const TWO_DIRS: TreeNode[] = [
      { type: 'dir', name: 'one', path: '/v/one', children: [] },
      { type: 'dir', name: 'two', path: '/v/two', children: [] },
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: TWO_DIRS, generatedAt: 1 }))
    shiftClickRow(rowByPath(el, '/v/one'))
    shiftClickRow(rowByPath(el, '/v/two'))
    rightClick(rowByPath(el, '/v/two'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    expect(menuItems(el).map((b) => b.textContent).some((t) => /in new tabs$/.test(t ?? ''))).toBe(false)
  })

  // ---- Polish pins (YAZ-1340): shift means selection EVERYWHERE, and one Escape does one thing ----

  it('shift+click on a dir row selects it and never folds it; a plain click folds it and selects it (YAZ-1578 🔒 D1; D9 YAZ-1674 supersedes its D4)', async () => {
    // Expansion PERSISTS per root across mounts in this file (storage-backed), so this test
    // assumes nothing about the starting state and puts it back the way it found it.
    const { el } = await mount({}, withMultiTree)
    const dirRow = () => el.querySelector<HTMLButtonElement>('.tree__row--dir')
    const expandedNow = () => dirRow()?.closest('[role="treeitem"]')?.getAttribute('aria-expanded')
    const before = expandedNow()
    shiftClickRow(dirRow())
    expect(expandedNow()).toBe(before) // shift never folds…
    expect(selectedCount(el)).toBe(1) // …it selects the folder
    act(() => dirRow()?.click())
    expect(expandedNow()).not.toBe(before) // a plain click still folds…
    expect(selectedCount(el)).toBe(1) // …and the folder is the selection (D9: it was already, so nothing changes)
    act(() => dirRow()?.click())
    expect(expandedNow()).toBe(before)
  })

  it('Escape with the context menu open closes the MENU and leaves the selection standing', async () => {
    const { el } = await mount({}, withMultiTree)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/b.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    act(() => void el.querySelector('.sidebar__body')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(selectedCount(el)).toBe(2)
  })
})

/**
 * The plural items' harder halves (YAZ-1337): the TOPICS lens reaches them through the very same
 * `openMenu` (`openTopicsMenu` only adds the anchor), where one page can stand under two parents —
 * so the count and the copied text must say ONE path, not one per row (🔒 D3). And a clipboard the
 * OS refuses has to be reported, not swallowed.
 */
describe('Sidebar multi-select context menu: Topics dedup and the copy failure (YAZ-1337)', () => {
  const record = (path: string, properties: Record<string, unknown> = {}) => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const rel = path.slice('/v/'.length)
    return {
      path,
      name,
      basename: name.replace(/\.[^.]+$/, ''),
      folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      ext: 'md', size: 1, ctime: 1, mtime: 1, properties, aliases: [], tags: [], links: [], embeds: [],
    }
  }
  // Shared is claimed by BOTH topics, so the tree draws it twice (⚡ D6 of YAZ-814); Loose belongs
  // nowhere and waits under Uncategorized, which puts it LAST in visible order.
  const HOME = record('/v/Home.md', { folder_page: true })
  const DOCS = record('/v/Docs.md', { folder_page: true, folder_pages: ['[[Home]]'] })
  const NOTES = record('/v/Notes.md', { folder_page: true, folder_pages: ['[[Home]]'] })
  const SHARED = record('/v/Shared.md', { folder_pages: ['[[Docs]]', '[[Notes]]'] })
  const LOOSE = record('/v/Loose.md')
  const feed = (...records: ReturnType<typeof record>[]): SidebarProps['indexSource'] =>
    ({
      resolve: (target: string) =>
        ({ '[[home]]': HOME.path, '[[docs]]': DOCS.path, '[[notes]]': NOTES.path })[target.trim().toLowerCase()] ?? null,
      records,
      subscribe: () => () => undefined,
    }) as SidebarProps['indexSource']
  /** The same files on disk, so the tree-backed prune (YAZ-1336) has nothing to take away. */
  const DISK: TreeNode[] = [HOME, DOCS, NOTES, SHARED, LOOSE].map((r) => ({ type: 'file', name: r.name, path: r.path, size: 1, mtime: 1, kind: 'markdown' }) as const)
  const rowsByPath = (el: HTMLElement, path: string) => [...el.querySelectorAll<HTMLElement>(`.tree__row[data-path="${path}"]`)]
  const shiftClickRow = (row: HTMLElement | undefined) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null | undefined) =>
    act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const expand = (el: HTMLElement, label: string) => act(() => el.querySelector<HTMLElement>(`[aria-label="Expand ${label}"]`)?.click())
  /** Both topics open, plus Uncategorized (🔒 D7 starts closed) — so all four rows are on screen. */
  const mountTopics = async () => {
    const mounted = await mount({ lens: 'topics', indexSource: feed(HOME, DOCS, NOTES, SHARED, LOOSE) }, (b) =>
      b.tree.mockResolvedValue({ root: '/v', tree: DISK, generatedAt: 1 }),
    )
    await expand(mounted.el, 'Docs')
    await expand(mounted.el, 'Notes')
    await act(async () => mounted.el.querySelector<HTMLElement>('.tree__row--muted')?.click())
    return mounted
  }

  it('a page standing under TWO parents counts and copies ONCE (🔒 D3), still in visible order', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el } = await mountTopics()
    expect(rowsByPath(el, SHARED.path)).toHaveLength(2) // both occurrences are on screen…
    shiftClickRow(rowsByPath(el, SHARED.path)[0])
    shiftClickRow(rowsByPath(el, LOOSE.path)[0])
    // …and BOTH light up off the ONE selected path, which is the whole reason the count can lie.
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(3)
    rightClick(rowsByPath(el, SHARED.path)[1]) // the occurrence under Notes: either one is the page
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined()
    expect(itemByLabel(el, 'Copy 3 paths')).toBeUndefined()
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/Shared.md\n/v/Loose.md')
  })

  it('"Open 2 in new tabs" from a Topics row opens each page once, dedup included', async () => {
    const { el, props } = await mountTopics()
    shiftClickRow(rowsByPath(el, SHARED.path)[0])
    shiftClickRow(rowsByPath(el, LOOSE.path)[0])
    rightClick(rowsByPath(el, SHARED.path)[0])
    act(() => itemByLabel(el, 'Open 2 in new tabs')?.click())
    expect((props.onOpenFileBackground as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(['/v/Shared.md', '/v/Loose.md'])
  })

  it('a clipboard the OS refuses is REPORTED through the panel notice, never swallowed', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('DENIED')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const MULTI: TreeNode[] = [
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el, props } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: MULTI, generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClickRow(row)
    rightClick(el.querySelector('.tree__row[data-path="/v/a.md"]'))
    await act(async () => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(props.onNotice).toHaveBeenCalledWith("Can't copy paths: DENIED")
  })

  it('a right-click on a DIR row outside the selection makes the selection THAT folder (D9)', async () => {
    const TREE_WITH_DIR: TreeNode[] = [
      { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
      { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'file', name: 'b.md', path: '/v/b.md', size: 1, mtime: 1, kind: 'markdown' },
    ]
    const { el } = await mount({}, (b) => b.tree.mockResolvedValue({ root: '/v', tree: TREE_WITH_DIR, generatedAt: 1 }))
    for (const row of el.querySelectorAll<HTMLElement>('.tree__row--file')) shiftClickRow(row)
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
    rightClick(el.querySelector('.tree__row--dir'))
    expect([...el.querySelectorAll<HTMLElement>('.tree__row--selected')].map((r) => r.dataset.path)).toEqual(['/v/sub'])
    expect(itemByLabel(el, 'Copy 2 paths')).toBeUndefined()
    expect(itemByLabel(el, 'New folder')).toBeDefined() // …and the dir's own ordinary menu stands
  })
})

/**
 * ⚡ Fable's ruling on YAZ-1338, at the panel: THE SELECTION IS THE TRUTH, THE DOM IS ONLY THE
 * ORDER. Folding a folder over a selected note hides its ROW; the note stays picked, so N keeps
 * counting it and the copy keeps carrying it — after the paths still on screen. The `selectionRef`
 * window App reads for ⌘⇧C is the same fact, handed up.
 */
describe('Sidebar multi-select: folded rows and the ⌘⇧C window (YAZ-1338)', () => {
  const NESTED: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [{ type: 'file', name: 'b.md', path: '/v/sub/b.md', size: 1, mtime: 1, kind: 'markdown' }] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  const withNested = (bridge: ReturnType<typeof installBridge>) => bridge.tree.mockResolvedValue({ root: '/v', tree: NESTED, generatedAt: 1 })
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  /**
   * Expand / Collapse all (⚡ YAZ-862) is the fold gesture here: since D9 (YAZ-1674) a plain click
   * on the folder row would make the selection THAT folder, and this test is about a pick that
   * survives its row disappearing — the all-button folds without touching the selection.
   */
  const foldAll = (el: HTMLElement) => act(() => el.querySelector<HTMLButtonElement>('.sidebar__lenses .sidebar__expand-all')?.click())
  const rightClickRow = (row: HTMLElement | null) =>
    act(() => void row?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))

  it('a selected note inside a folder the user then FOLDS still counts, and copies after the visible ones', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { el } = await mount({}, withNested)
    // Expansion persists per root across mounts in this file, so ENSURE the states rather than
    // toggling blind — this test must not care what its neighbours left behind.
    if (rowByPath(el, '/v/sub/b.md') === null) foldAll(el) // "Expand all": open `sub` so its note has a row to pick
    shiftClickRow(rowByPath(el, '/v/sub/b.md'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    foldAll(el) // "Collapse all": the row goes, the pick does not
    expect(rowByPath(el, '/v/sub/b.md')).toBeNull()
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1)
    rightClickRow(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Copy 2 paths')).toBeDefined() // N is the SELECTION's size, not the DOM's
    act(() => itemByLabel(el, 'Copy 2 paths')?.click())
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/a.md\n/v/sub/b.md')
  })

  it('hands its selection up through selectionRef and empties it on the way out (🔒 D4)', async () => {
    const selectionRef = { current: EMPTY_SELECTION }
    const { el } = await mount({ selectionRef }, withNested)
    expect(selectionRef.current.size).toBe(0)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    expect([...selectionRef.current]).toEqual(['/v/a.md'])
    // D9: a PLAIN click is a one-row selection, so App's ⌘⇧C copies the clicked row's path.
    act(() => rowByPath(el, '/v/sub/b.md')?.click() ?? el.querySelector<HTMLButtonElement>('.tree__row--dir')?.click())
    expect(selectionRef.current.size).toBe(1)
    // The sidebar collapsing IS this component unmounting (App renders it conditionally), and a
    // chord must never copy a selection nobody can see any more.
    act(() => root?.unmount())
    root = null
    expect(selectionRef.current).toBe(EMPTY_SELECTION)
  })
})

describe('settings cog (YAZ-1679)', () => {
  it('the footer cog only asks App for the dialog — the sidebar edits no setting itself', async () => {
    const { el, props } = await mount()
    act(() => el.querySelector<HTMLButtonElement>('.settings-button')?.click())
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(props.onChangeSettings).not.toHaveBeenCalled()
  })
})

/**
 * Cut / Copy / Paste (YAZ-1674): the menu items (🔒 D5) and the chords (D6) both hand the ORDERED
 * selection to main's one app-wide clipboard (🔒 D1) over `file.clip`, and Paste goes to the menu's
 * `targetDir` — or, from ⌘V, beside the first selected row — over `file.paste`. "Paste N items"
 * reads the `clip:changed` push, so a copy in ANOTHER window labels this one's menu.
 */
describe('Cut / Copy / Paste (YAZ-1674)', () => {
  type ClipState = { count: number; op: 'copy' | 'cut' } | null
  const MULTI_TREE: TreeNode[] = [
    { type: 'dir', name: 'sub', path: '/v/sub', children: [] },
    { type: 'file', name: 'a.md', path: '/v/a.md', size: 1, mtime: 1, kind: 'markdown' },
    { type: 'file', name: 'c.md', path: '/v/c.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  /** The bridge's clipboard push, captured so a test can play "another window just copied". */
  let pushClip: ((state: ClipState) => void) | null = null
  const withClipboard = (bridge: ReturnType<typeof installBridge>) => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: MULTI_TREE, generatedAt: 1 })
    bridge.file.onClipChanged.mockImplementation((listener) => {
      pushClip = listener
      return () => undefined
    })
  }
  const rowByPath = (el: HTMLElement, path: string) => el.querySelector<HTMLButtonElement>(`.tree__row[data-path="${path}"]`)
  const shiftClickRow = (row: HTMLElement | null) => act(() => void row?.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
  const rightClick = (target: Element | null) => act(() => void target?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
  const body = (el: HTMLElement) => el.querySelector('.sidebar__body')

  beforeEach(() => {
    pushClip = null
  })

  it('a row offers Cut and Copy with their hints, and a DISABLED Paste while the clipboard is empty (🔒 D5)', async () => {
    const { el } = await mount({}, withClipboard)
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Cut')?.getAttribute('data-hint')).toBe('⌘X')
    expect(itemByLabel(el, 'Copy')?.getAttribute('data-hint')).toBe('⌘C')
    const paste = itemByLabel(el, 'Paste')
    expect(paste?.disabled).toBe(true)
    expect(paste?.getAttribute('data-hint')).toBe('⌘V')
    // Five groups drawn on one Markdown file row: clipboard, create, this-row, "Open in" alone, Delete —
    // the Open group is empty here (no plural open, nothing to focus) and the renderer skips it.
    expect(el.querySelectorAll('.ctx-menu__group')).toHaveLength(5)
  })

  it('blank space offers no Cut / Copy (nothing to clip) but keeps the disabled Paste — the root is a paste target', async () => {
    const { el } = await mount({}, withClipboard)
    rightClick(body(el))
    expect(itemByLabel(el, 'Cut')).toBeUndefined()
    expect(itemByLabel(el, 'Copy')).toBeUndefined()
    expect(itemByLabel(el, 'Paste')?.disabled).toBe(true)
    // No row to rename or delete: clipboard, create, and the root's own "Open in" — three groups.
    expect(el.querySelectorAll('.ctx-menu__group')).toHaveLength(3)
  })

  it('Cut on a single row clips that one path and SAYS SO (YAZ-1341); the menu closes', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    rightClick(rowByPath(el, '/v/a.md'))
    await act(async () => itemByLabel(el, 'Cut')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md'], op: 'cut' })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Cut 1 item', 'cut')
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('inside a 2-selection the items count it — "Copy 2 items" — and clip the ORDERED selection, which stands', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    shiftClickRow(rowByPath(el, '/v/c.md')) // click order c → a…
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(itemByLabel(el, 'Cut 2 items')).toBeDefined()
    await act(async () => itemByLabel(el, 'Copy 2 items')?.click())
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md', '/v/c.md'], op: 'copy' }) // …tree order out
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 items', 'copy')
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
  })

  it('a clipboard push labels Paste "Paste 2 items"; clicking it pastes into the row\'s targetDir, refreshes and reports', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValue({ pasted: [{ from: '/w/x.md', to: '/v/sub/x.md', kind: 'file' }, { from: '/w/y.md', to: '/v/sub/y.md', kind: 'file' }], failed: [] })
    const treeReads = bridge.tree.mock.calls.length
    act(() => pushClip?.({ count: 2, op: 'copy' }))
    rightClick(rowByPath(el, '/v/sub'))
    const paste = itemByLabel(el, 'Paste 2 items')
    expect(paste?.disabled).toBe(false)
    await act(async () => paste?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/sub' })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Pasted 2 items', 'paste')
    expect(bridge.tree.mock.calls.length).toBe(treeReads + 1) // the explicit refresh: a copy broadcasts nothing
  })

  it('a FILE row pastes into its PARENT (the "New note" rule), and per-entry failures are counted and named', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValue({ pasted: [{ from: '/w/x.md', to: '/v/x.md', kind: 'file' }], failed: [{ from: '/w/Note.md', code: 'ALREADY_EXISTS', message: 'already exists' }] })
    act(() => pushClip?.({ count: 2, op: 'cut' }))
    rightClick(rowByPath(el, '/v/a.md'))
    await act(async () => itemByLabel(el, 'Paste 2 items')?.click())
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v' })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Pasted 1 item, skipped 1: Note.md — already exists', 'paste')
  })

  it('nothing pasted → "Couldn\'t paste: …"; a rejected paste → a notice, never a throw', async () => {
    const { el, bridge, props } = await mount({}, withClipboard)
    bridge.file.paste.mockResolvedValueOnce({ pasted: [], failed: [{ from: '/w/Note.md', code: 'NOT_FOUND', message: 'gone' }] })
    act(() => pushClip?.({ count: 1, op: 'copy' }))
    rightClick(body(el))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith("Couldn't paste: Note.md — gone", 'error')
    bridge.file.paste.mockRejectedValueOnce({ code: 'NOT_FOUND', message: 'target dir is gone' })
    rightClick(body(el))
    await act(async () => itemByLabel(el, 'Paste 1 item')?.click())
    expect(props.onNotice).toHaveBeenLastCalledWith("Can't paste: target dir is gone", 'error')
  })

  it('a window opened AFTER a clip reads the clipboard ONCE on mount: Paste is labelled and enabled from the start', async () => {
    const { el, bridge } = await mount({}, (bridge) => {
      withClipboard(bridge)
      bridge.file.clipState.mockResolvedValue({ count: 2, op: 'copy' })
    })
    expect(bridge.file.clipState).toHaveBeenCalled()
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 2 items')?.disabled).toBe(false)
  })

  it('a push that lands while the mount read is in flight WINS over the read', async () => {
    let settle: ((state: { count: number; op: 'copy' | 'cut' } | null) => void) | null = null
    const { el, bridge } = await mount({}, (bridge) => {
      withClipboard(bridge)
      bridge.file.clipState.mockImplementation(() => new Promise((resolve) => (settle = resolve)))
    })
    expect(bridge.file.clipState).toHaveBeenCalled()
    act(() => pushClip?.({ count: 3, op: 'cut' }))
    await act(async () => settle?.({ count: 1, op: 'copy' }))
    rightClick(rowByPath(el, '/v/sub'))
    expect(itemByLabel(el, 'Paste 3 items')).toBeDefined()
  })

  it('Topics: a PAGE row gets Cut / Copy but no Paste — a disk verb never lands on a meaning row (🔒 D5)', async () => {
    const record = { path: '/v/Home.md', name: 'Home.md', basename: 'Home', folder: '', ext: 'md', size: 1, ctime: 1, mtime: 1, properties: { folder_page: true }, aliases: [], tags: [], links: [], embeds: [] }
    // The feed's resolver is keyed like the real one (lowered, brackets and all) — the YAZ-865 harness's idiom.
    const indexSource = { resolve: (target: string) => (target.trim().toLowerCase() === '[[home]]' ? '/v/Home.md' : null), records: [record], subscribe: () => () => undefined } as SidebarProps['indexSource']
    const { el } = await mount({ lens: 'topics', indexSource }, withClipboard)
    const home = [...el.querySelectorAll<HTMLButtonElement>('.tree__row')].find((r) => r.querySelector('.tree__label')?.textContent === 'Home') ?? null
    expect(home).not.toBeNull()
    rightClick(home)
    expect(itemByLabel(el, 'Cut')).toBeDefined()
    expect(itemByLabel(el, 'Copy')).toBeDefined()
    expect(itemByLabel(el, 'Paste')).toBeUndefined()
  })

  // ---- The chords' handle (D6 amended): App's window listener asks these; the RULES are here ----

  /** A box App would hold; the Sidebar fills it every render and empties it on unmount. */
  const box = () => ({ current: null as SidebarClipboard | null })
  const verb = (ref: { current: SidebarClipboard | null }, op: 'copy' | 'cut' | 'paste') =>
    op === 'paste' ? (ref.current?.paste() ?? false) : (ref.current?.cutOrCopy(op) ?? false)

  it('cutOrCopy with a selection clips the ORDERED paths and answers true; the cut is the same call with its op', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    shiftClickRow(rowByPath(el, '/v/c.md'))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    expect(verb(clipboardRef, 'copy')).toBe(true)
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md', '/v/c.md'], op: 'copy' })
    expect(verb(clipboardRef, 'cut')).toBe(true)
    expect(bridge.file.clip).toHaveBeenLastCalledWith({ paths: ['/v/a.md', '/v/c.md'], op: 'cut' })
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2) // the selection stands
  })

  it('with NO selection cutOrCopy answers false and clips nothing — the key is not ours', async () => {
    const clipboardRef = box()
    const { bridge } = await mount({ clipboardRef }, withClipboard)
    expect(verb(clipboardRef, 'copy')).toBe(false)
    expect(bridge.file.clip).not.toHaveBeenCalled()
  })

  it('paste answers false with an empty clipboard; with one it pastes beside the FIRST selected row — a folder → into it, a file → its parent, none → the root', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    expect(verb(clipboardRef, 'paste')).toBe(false)
    expect(bridge.file.paste).not.toHaveBeenCalled()
    act(() => pushClip?.({ count: 1, op: 'copy' }))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith({ targetDir: '/v' })
    shiftClickRow(rowByPath(el, '/v/sub'))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith({ targetDir: '/v/sub' })
    act(() => void body(el)?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenLastCalledWith({ targetDir: '/v' })
    expect(bridge.file.paste).toHaveBeenCalledTimes(3)
  })

  it('an open context menu owns the verbs: both answer false while it stands', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.({ count: 1, op: 'copy' }))
    shiftClickRow(rowByPath(el, '/v/a.md'))
    rightClick(rowByPath(el, '/v/a.md'))
    expect(verb(clipboardRef, 'copy')).toBe(false)
    expect(verb(clipboardRef, 'paste')).toBe(false)
    expect(bridge.file.clip).not.toHaveBeenCalled()
    expect(bridge.file.paste).not.toHaveBeenCalled()
  })

  it('the handle is emptied on unmount — a collapsed sidebar has no verbs to offer', async () => {
    const clipboardRef = box()
    await mount({ clipboardRef }, withClipboard)
    expect(clipboardRef.current).not.toBeNull()
    act(() => root?.unmount())
    root = null
    expect(clipboardRef.current).toBeNull()
  })

  it('D9: a plain click on a file, then copy, clips exactly that file; ⌘⇧C sees the same one-row selection', async () => {
    const clipboardRef = box()
    const selectionRef = { current: EMPTY_SELECTION }
    const { el, bridge, props } = await mount({ selectionRef, clipboardRef }, withClipboard)
    act(() => rowByPath(el, '/v/a.md')?.click())
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith('/v/a.md')
    expect([...selectionRef.current]).toEqual(['/v/a.md'])
    expect(verb(clipboardRef, 'copy')).toBe(true)
    expect(bridge.file.clip).toHaveBeenCalledExactlyOnceWith({ paths: ['/v/a.md'], op: 'copy' })
  })

  it('D9: a plain click on a FOLDER selects it, so paste goes INTO it', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.({ count: 1, op: 'copy' }))
    act(() => rowByPath(el, '/v/sub')?.click())
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v/sub' })
    act(() => rowByPath(el, '/v/sub')?.click()) // fold it back the way it was found
  })

  it('a plain LEFT click on BLANK SPACE clears the selection, so paste goes to the ROOT; a right-click there keeps it (YAZ-1337)', async () => {
    const clipboardRef = box()
    const { el, bridge } = await mount({ clipboardRef }, withClipboard)
    act(() => pushClip?.({ count: 1, op: 'copy' }))
    act(() => rowByPath(el, '/v/sub')?.click())
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1)
    act(() => void body(el)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(1) // a right-click is not a pick
    act(() => void body(el)?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(0)
    await act(async () => void verb(clipboardRef, 'paste'))
    expect(bridge.file.paste).toHaveBeenCalledExactlyOnceWith({ targetDir: '/v' })
    act(() => rowByPath(el, '/v/sub')?.click()) // fold it back the way it was found
  })

  it('a LEFT mousedown ON a row is the row\'s own gesture — it never clears through the body', async () => {
    const { el } = await mount({}, withClipboard)
    shiftClickRow(rowByPath(el, '/v/a.md'))
    shiftClickRow(rowByPath(el, '/v/c.md'))
    act(() => void rowByPath(el, '/v/a.md')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 })))
    expect(el.querySelectorAll('.tree__row--selected')).toHaveLength(2)
  })
})
