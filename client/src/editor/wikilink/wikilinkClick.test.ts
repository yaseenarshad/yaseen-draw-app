/**
 * Wikilink click navigation (Links C, GRO-2192): real editor (`createCrepe({ wikilinkNav })`),
 * real mousedown events on the rendered `.wikilink` spans. Pinned here: navigation happens on
 * MOUSEDOWN with the default prevented (no caret in the match, no raw-text flash — editing
 * stays keyboard/adjacency-only), plain click → `openCurrent`, ⌘-click → `openBackground`,
 * an unresolved link creates its page first (bare targets under `nav.createFolder()` — the
 * Files & Links location setting, C2- GRO-2240; '' = the vault root, the default) and then
 * opens by the same gesture, `[[#h]]` no-ops, revealed raw text and alt/shift/ctrl-modified
 * clicks fall through to plain editing, and failures land in `onNotice` — never a dialog.
 * F2 (GRO-2197) added two more notices for otherwise invisible outcomes: a click during the
 * pre-index window, and a ⌘-click whose freshly created note landed in a background tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { TreeNode } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { buildViewOnlyCatalog } from '../../links/viewOnlyCatalog'
import { createCrepe } from '../createCrepe'
import { WIKILINK_CLASS, WIKILINK_UNRESOLVED_CLASS, createWikilinkResolveSource } from './wikilinkPlugin'
import { createViewOnlyLinkSource, type MutableViewOnlyLinkSource } from './viewOnlyLinkSource'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    createDir: vi.fn(async (path: string) => ({ path })),
    createFile: vi.fn(async (path: string) => ({ path, mtime: 1, size: 0 })),
  },
}))

const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)

interface NavMocks {
  root: string
  createFolder: () => string
  openCurrent: Mock
  openBackground: Mock
  onNotice: Mock
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** Resolver used across the suite: only 'Known' exists, at /vault/Known.md. */
const resolveKnown = (target: string) => (target === 'Known' ? '/vault/Known.md' : null)

async function mount(markdown: string, resolve?: (target: string) => string | null, createFolder: () => string = () => '', viewOnly?: MutableViewOnlyLinkSource) {
  const source = createWikilinkResolveSource()
  if (resolve !== undefined) source.update(resolve)
  const nav: NavMocks = { root: '/vault', createFolder, openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() }
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinks: source, viewOnlyLinks: viewOnly, wikilinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, nav, source }
}

const viewNode = (path: string, kind: 'text' | 'pdf' | 'image'): TreeNode => ({ type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1 })
function viewSource(...nodes: TreeNode[]): MutableViewOnlyLinkSource {
  const source = createViewOnlyLinkSource()
  source.update(buildViewOnlyCatalog('/vault', nodes))
  return source
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

/** The rendered collapsed-link span showing `text` (throws when the link is not collapsed). */
function linkSpan(root: HTMLElement, text: string): Element {
  const span = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).find((el) => el.textContent === text)
  if (span === undefined) throw new Error(`no collapsed .wikilink span showing "${text}"`)
  return span
}

/** Real mousedown (what the plugin acts on); returns false when the default was PREVENTED. */
function mousedown(el: Element, init: MouseEventInit = {}): boolean {
  return el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))
}

function expectNoNav(nav: NavMocks): void {
  expect(nav.openCurrent).not.toHaveBeenCalled()
  expect(nav.openBackground).not.toHaveBeenCalled()
  expect(nav.onNotice).not.toHaveBeenCalled()
}

beforeEach(() => {
  // Milkdown's resolved clock promises retain defensive 3 s timeout callbacks. Keep them inside
  // this jsdom lifetime so a full parallel suite cannot execute them after teardown.
  vi.useFakeTimers()
  vi.clearAllMocks()
  createDir.mockImplementation(async (path: string) => ({ path }))
  createFile.mockImplementation(async (req) => ({ path: req as string, mtime: 1, size: 0 }))
})

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('wikilink click: resolved links (GRO-2192)', () => {
  it('plain mousedown opens in the CURRENT tab and prevents the default — no caret, no raw-text reveal', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const prevented = !mousedown(linkSpan(root, 'Known'))
    expect(prevented).toBe(true)
    expect(nav.openCurrent).toHaveBeenCalledTimes(1)
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
    expect(nav.openBackground).not.toHaveBeenCalled()
    // The match stayed collapsed: the selection never landed inside it, so no reveal happened.
    expect(linkSpan(root, 'Known')).toBeDefined()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('⌘(meta)-mousedown opens a BACKGROUND tab instead; default still prevented (focus untouched)', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const prevented = !mousedown(linkSpan(root, 'Known'), { metaKey: true })
    expect(prevented).toBe(true)
    expect(nav.openBackground).toHaveBeenCalledTimes(1)
    expect(nav.openBackground).toHaveBeenCalledWith('/vault/Known.md')
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('an alias click navigates to the target ([[Known|shown]] → Known)', async () => {
    const { root, nav } = await mount('x [[Known|shown]] y\n', resolveKnown)
    mousedown(linkSpan(root, 'shown'))
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
  })

  it('[[a#h]] navigates to a — on either segment; the heading jump itself is GRO-2239', async () => {
    const { root, nav } = await mount('x [[Known#head]] y\n', resolveKnown)
    mousedown(linkSpan(root, 'head')) // the sub segment carries .wikilink too
    expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Known.md')
    mousedown(linkSpan(root, 'Known'))
    expect(nav.openCurrent).toHaveBeenCalledTimes(2)
    expect(nav.openCurrent).toHaveBeenLastCalledWith('/vault/Known.md')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('wikilink click: navigation-only view files (YAZ-1310)', () => {
  it('defaults to a passive pre-catalog source so recognized targets can never create Markdown', async () => {
    const { root, nav } = await mount('x [[missing.json]] y\n', resolveKnown)
    mousedown(linkSpan(root, 'missing.json'))
    expect(nav.onNotice).toHaveBeenCalledWith('File catalog is still loading — try that link again in a moment')
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it.each([
    ['data.json', '/vault/data.json', 'text'],
    ['tool.py', '/vault/tool.PY', 'text'],
    ['REPORT.pdf', '/vault/report.PDF', 'pdf'],
    ['photo.png', '/vault/photo.PNG', 'image'],
    ['Outbound Lead Qualifier.json', '/vault/deep/Outbound Lead Qualifier.json', 'text'],
    ['deep/data.JSON', '/vault/deep/data.JSON', 'text'],
  ] as const)('opens %s in the current viewer without invoking Markdown creation', async (target, path, kind) => {
    const views = viewSource(
      viewNode('/vault/data.json', 'text'),
      viewNode('/vault/tool.PY', 'text'),
      viewNode('/vault/report.PDF', 'pdf'),
      viewNode('/vault/photo.PNG', 'image'),
      viewNode('/vault/deep/Outbound Lead Qualifier.json', 'text'),
      viewNode('/vault/deep/data.JSON', 'text'),
    )
    const { root, nav } = await mount(`x [[${target}]] y\n`, resolveKnown, () => '', views)
    mousedown(linkSpan(root, target))
    expect(nav.openCurrent).toHaveBeenCalledExactlyOnceWith(path)
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('uses |text only for display and preserves command-click background navigation for images', async () => {
    const views = viewSource(viewNode('/vault/deep/Launch Photo.PNG', 'image'))
    const { root, nav } = await mount('x [[Launch Photo.PNG|Launch art]] y\n', resolveKnown, () => '', views)
    mousedown(linkSpan(root, 'Launch art'), { metaKey: true })
    expect(nav.openBackground).toHaveBeenCalledExactlyOnceWith('/vault/deep/Launch Photo.PNG')
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
  })

  it('pre-catalog and missing recognized targets notice passively and never create Markdown', async () => {
    const loading = createViewOnlyLinkSource()
    const first = await mount('x [[missing.png]] y\n', resolveKnown, () => '', loading)
    mousedown(linkSpan(first.root, 'missing.png'))
    expect(first.nav.onNotice).toHaveBeenCalledWith('File catalog is still loading — try that link again in a moment')

    const empty = viewSource()
    const second = await mount('x [[missing.png]] y\n', resolveKnown, () => '', empty)
    mousedown(linkSpan(second.root, 'missing.png'))
    expect(second.nav.onNotice).toHaveBeenCalledWith('Can\'t open "missing.png": file not found')
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('a removed target restyles unresolved and cannot fall through to create-on-click', async () => {
    const views = viewSource(viewNode('/vault/data.json', 'text'))
    const { root, nav } = await mount('x [[data.json]] y\n', resolveKnown, () => '', views)
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(false)
    views.update(buildViewOnlyCatalog('/vault', []))
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    mousedown(linkSpan(root, 'data.json'))
    expect(nav.onNotice).toHaveBeenCalledWith('Can\'t open "data.json": file not found')
    expect(createFile).not.toHaveBeenCalled()
  })

  it('headings/blocks on view-only targets stay unresolved and never gain Markdown semantics', async () => {
    const views = viewSource(viewNode('/vault/data.json', 'text'))
    const { root, nav } = await mount('x [[data.json#heading]] y\n', resolveKnown, () => '', views)
    expect(linkSpan(root, 'data.json').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    mousedown(linkSpan(root, 'heading'))
    expect(nav.onNotice).toHaveBeenCalledWith('Can\'t open "data.json#heading": headings and blocks aren\'t supported for read-only files')
    expect(createFile).not.toHaveBeenCalled()
  })
})

describe('wikilink click: unresolved links create the page (GRO-2192)', () => {
  it('plain click creates <root>/<name>.md at the VAULT ROOT (locked default) and opens it in the current tab', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    expect(mousedown(linkSpan(root, 'Missing'))).toBe(false) // default prevented
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Missing.md'))
    expect(createFile).toHaveBeenCalledWith('/vault/Missing.md')
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it('⌘-click on an unresolved link creates it and opens it in a BACKGROUND tab (same gesture after create)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    mousedown(linkSpan(root, 'Missing'), { metaKey: true })
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalledWith('/vault/Missing.md'))
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('a ⌘-click that CREATES notices too, naming the note — the background tab is invisible (GRO-2197)', async () => {
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    mousedown(linkSpan(root, 'Missing'), { metaKey: true })
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalledWith('/vault/Missing.md'))
    expect(nav.onNotice).toHaveBeenCalledWith('Created "Missing" in a background tab')
  })

  it("a ⌘-click LOSING the creation race stays silent — nothing was freshly created (and plain-click creates open visibly, so they never notice)", async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    mousedown(linkSpan(root, 'Missing'), { metaKey: true })
    await vi.waitFor(() => expect(nav.openBackground).toHaveBeenCalledWith('/vault/Missing.md'))
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it('a pathed target creates parents and the file root-relatively', async () => {
    const { root, nav } = await mount('go [[Sub/Page]] now\n', () => null)
    mousedown(linkSpan(root, 'Sub/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Sub/Page.md'))
    expect(createDir).toHaveBeenCalledWith('/vault/Sub')
    expect(createFile).toHaveBeenCalledWith('/vault/Sub/Page.md')
  })

  it("a bare target creates under nav.createFolder() — the Files & Links setting's folder, read at CLICK time (C2-, GRO-2240)", async () => {
    let base = 'Notes/Inbox'
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown, () => base)
    mousedown(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Notes/Inbox/Missing.md'))
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/vault/Notes', '/vault/Notes/Inbox'])
    // The getter is live: a settings change lands on the NEXT click without any remount.
    base = ''
    mousedown(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Missing.md'))
  })

  it('a PATHED target stays root-relative whatever the base — an explicit path is an explicit aim (Obsidian)', async () => {
    const { root, nav } = await mount('go [[Sub/Page]] now\n', () => null, () => 'Notes')
    mousedown(linkSpan(root, 'Sub/Page'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Sub/Page.md'))
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/vault/Sub'])
  })

  it('ALREADY_EXISTS (creation race) still opens the page — the race is benign', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    mousedown(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Missing.md'))
    expect(nav.onNotice).not.toHaveBeenCalled()
  })

  it('a create failure surfaces as a passive notice — nothing opens, never a dialog', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const { root, nav } = await mount('pad [[Missing]] tail\n', resolveKnown)
    mousedown(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledWith('Can\'t create "Missing": disk on fire'))
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
  })

  it('an invalid name notices without touching the bridge', async () => {
    const { root, nav } = await mount('pad [[.hidden]] tail\n', () => null)
    mousedown(linkSpan(root, '.hidden'))
    await vi.waitFor(() => expect(nav.onNotice).toHaveBeenCalledWith('Can\'t create ".hidden": Names starting with "." are hidden'))
    expect(createFile).not.toHaveBeenCalled()
    expect(nav.openCurrent).not.toHaveBeenCalled()
  })

  it('after creation the index update flips the unresolved styling live (A-\'s restyle, no remount)', async () => {
    const { root, nav, source } = await mount('pad [[Missing]] tail\n', resolveKnown)
    expect(linkSpan(root, 'Missing').classList.contains(WIKILINK_UNRESOLVED_CLASS)).toBe(true)
    mousedown(linkSpan(root, 'Missing'))
    await vi.waitFor(() => expect(nav.openCurrent).toHaveBeenCalledWith('/vault/Missing.md'))
    // The watcher-driven index refetch delivers a resolver that now knows the new file.
    source.update((target) => (target === 'Missing' ? '/vault/Missing.md' : resolveKnown(target)))
    expect(root.querySelectorAll(`.${WIKILINK_UNRESOLVED_CLASS}`)).toHaveLength(0)
    expect(linkSpan(root, 'Missing')).toBeDefined()
  })
})

describe('wikilink click: what does NOT navigate (GRO-2192)', () => {
  it('same-file [[#h]] is a no-op: swallowed (no caret) but nothing opens or is created', async () => {
    const { root, nav } = await mount('jump [[#heading]] now\n', () => null)
    expect(mousedown(linkSpan(root, 'heading'))).toBe(false)
    await Promise.resolve()
    expectNoNav(nav)
    expect(createFile).not.toHaveBeenCalled()
  })

  it('REVEALED raw text falls through to plain editing: no navigation, default untouched', async () => {
    // 'pad [[Known]] tail' — caret at 7 sits inside the match, which reveals it (Links A).
    const { crepe, root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    const view = viewOf(crepe)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)))
    expect(root.querySelectorAll(`.${WIKILINK_CLASS}`)).toHaveLength(0) // raw, editable
    const paragraph = root.querySelector('.ProseMirror p')
    expect(paragraph).not.toBeNull()
    expect(mousedown(paragraph as Element)).toBe(true) // NOT prevented — normal caret placement
    expectNoNav(nav)
  })

  it('alt-, shift- and ctrl-modified clicks are left to their defaults (future gestures, context menus)', async () => {
    const { root, nav } = await mount('pad [[Known]] tail\n', resolveKnown)
    expect(mousedown(linkSpan(root, 'Known'), { altKey: true })).toBe(true)
    expect(mousedown(linkSpan(root, 'Known'), { shiftKey: true })).toBe(true)
    expect(mousedown(linkSpan(root, 'Known'), { ctrlKey: true })).toBe(true)
    expect(mousedown(linkSpan(root, 'Known'), { button: 2 })).toBe(true)
    expectNoNav(nav)
  })

  it('before the index has loaded (resolve null) nothing opens or is created — but a notice says the index is loading (GRO-2197)', async () => {
    const { root, nav } = await mount('pad [[Whatever]] tail\n') // source never updated
    expect(mousedown(linkSpan(root, 'Whatever'))).toBe(false)
    await Promise.resolve()
    expect(nav.openCurrent).not.toHaveBeenCalled()
    expect(nav.openBackground).not.toHaveBeenCalled()
    expect(createFile).not.toHaveBeenCalled()
    expect(nav.onNotice).toHaveBeenCalledWith('Vault index is still loading — try that link again in a moment')
  })

  it('without wikilinkNav the click plugin is not registered at all: clicks are plain editing', async () => {
    const source = createWikilinkResolveSource()
    source.update(resolveKnown)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: 'pad [[Known]] tail\n', wikilinks: source })
    await crepe.create()
    mounted.push({ crepe, root })
    expect(mousedown(linkSpan(root, 'Known'))).toBe(true) // default untouched
  })
})
