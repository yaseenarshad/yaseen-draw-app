/**
 * The folder page's contents block (YAZ-819; 🔒 D1/D2/D3 of YAZ-818). Mounted with react-dom in
 * jsdom over a REAL `WikilinkResolveSource` — the App-owned feed the whole block runs on — with
 * `writeProperty` mocked (the ONE card writer, shared by the settings door and every cell) and
 * `api` mocked for the create path.
 *
 * Pinned here: the block appears only for a flagged page; its rows are the MEMBERS and nobody
 * else; link resolution and the link pickers read the WHOLE vault even though the rows are a
 * subset (🔒 D2 — the trap the design closed); a config edit is ONE `folder_page_settings` write
 * on the FOLDER PAGE while a cell edit still writes the MEMBER's own card; switching view writes
 * nothing at all; and "New" births a member from the declaration, parked per the settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { CreateFileRequest, IndexRecord } from '@shared/types'
import { resolverFor } from './engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { FolderPageContents } from './FolderPageContents'

vi.mock('./writeProperty', () => ({ writeProperty: vi.fn(), transformFile: vi.fn() }))
vi.mock('./folderPageColumns', () => ({ backfillFolderPageColumns: vi.fn() }))
vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), createDir: vi.fn(), createFile: vi.fn() },
}))
/** The real pane, wrapped: YAZ-895's columns door has no menu caller yet, so it is reached as the bundle. */
const captured = vi.hoisted(() => ({ folderPage: null as FolderPageMode | null }))
vi.mock('./ViewsPane', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ViewsPane')>()
  return {
    ...actual,
    ViewsPane: (props: ViewsPaneProps) => {
      captured.folderPage = props.folderPage
      return <actual.ViewsPane {...props} />
    },
  }
})

/** The outline's editor, stubbed (YAZ-903): a real Crepe in jsdom is `OutlineEditor.test.tsx`'s job. */
vi.mock('./view/OutlineEditor', () => ({
  OutlineEditor: ({ markdown }: { markdown: string }) => <pre className="outline-doc">{markdown}</pre>,
}))

import { api, BridgeRequestError } from '../api'
import type { FolderPageMode, ViewsPaneProps } from './ViewsPane'
import { backfillFolderPageColumns } from './folderPageColumns'
import { transformFile, writeProperty } from './writeProperty'

const write = vi.mocked(writeProperty)
/** The one-file transform behind a declaration write (`writeFolderColumn`) and a column delete's member strips. */
const transform = vi.mocked(transformFile)
const backfill = vi.mocked(backfillFolderPageColumns)
const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)
/** The atomic content-at-create form is the only one this path uses (`createNewNote`). */
const created = (call: number): CreateFileRequest => createFile.mock.calls[call][0] as CreateFileRequest

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const FUNNELS = '/vault/Funnel Stages.md'
const LEAD = '/vault/stages/Lead Gen.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const KPIS = '/vault/KPIs.md'
const OUTSIDER = '/vault/Sub/Outsider.md'

const TABLE = { type: 'table', name: 'Table', order: ['file.name', 'note.order', 'note.related'] }
/** A board view, spelled out: since YAZ-1471 retired the YAZ-935 backfill a card only has one if it SAYS so. */
const BOARD = { type: 'board', name: 'Board' }
const SETTINGS = {
  columns: { order: { kind: 'number' }, related: { kind: 'multi-link', target: '[[KPIs]]' } },
  folder: 'stages',
  views: [{ type: 'outline', name: 'Outline' }, TABLE],
}

/** The whole snapshot: the folder page, its two members, and a SECOND folder page nobody here belongs to. */
function vault(settings: unknown = SETTINGS): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: settings }),
    rec(OTHER, { title: 'not a member' }),
    rec(KPIS, { folder_page: true }),
    rec('/vault/kpis/CAC.md', { folder_pages: ['[[KPIs]]'] }),
    rec('/vault/kpis/LTV.md', { folder_pages: ['[[KPIs]]'] }),
    rec(SALES, { folder_pages: ['[[Funnel Stages]]'], order: 1 }),
    rec(LEAD, { folder_pages: ['[[Funnel Stages]]'], order: 2, owner: '[[Sub/Outsider]]' }),
    rec(OUTSIDER, {}),
  ]
}

// ---------- harness ----------

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()

/** WikilinkIndexBridge's own wrapping: THE shared resolver, unwrapped to a path. */
function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path: string, records: IndexRecord[] | null = vault(), fileContent?: string): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<FolderPageContents path={path} root="/vault" source={source} onOpenFile={onOpenFile} fileContent={fileContent} />))
  if (records !== null) feed(records)
  return container
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  write.mockResolvedValue({ mtime: 2 })
  transform.mockResolvedValue({ mtime: 2, content: '' })
  backfill.mockResolvedValue()
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createDir.mockResolvedValue({ path: '/vault/stages' })
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
})

// ---------- DOM helpers (RelationColumn.test.tsx style) ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)
const texts = (el: ParentNode, sel: string): string[] => [...el.querySelectorAll(sel)].map((n) => n.textContent ?? '')
const options = (el: ParentNode): (string | null)[] => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)
/**
 * Row names, whichever body is rendering: the placeholder list or the real table (`file.name`,
 * extension and all). The outline has no rows at all since YAZ-1152 — a member it does not name is
 * ADOPTED into the document instead.
 */
const rowNames = (el: ParentNode): string[] => texts(el, '.view-row__link, .view-table__link')
/** The outline document the editor was seeded with (YAZ-903). */
const doc = (el: ParentNode): string => q(el, '.outline-doc').textContent ?? ''

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

async function flush(): Promise<void> {
  await act(async () => {})
}

/** The filter row's Property is the searchable picker (YAZ-1466): open it, click the option. */
function chooseProperty(el: ParentNode, value: string): void {
  click(byLabel(el, 'Property'))
  const option = [...el.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.dataset.value === value)
  if (option === undefined) throw new Error(`no Property option ${value}`)
  click(option)
}

/** What that picker's trigger currently shows — its property's display label. */
const propertyShown = (el: ParentNode): string => byLabel<HTMLElement>(el, 'Property').textContent ?? ''

const openTable = (el: ParentNode): void => click(q(el, '.view-tab__btn:nth-of-type(1)'))

const openCell = (el: ParentNode, r: number, c: number): void => click(q(q<HTMLElement>(el, `[data-cell="${r}:${c}"]`), '[data-edit]'))

/** Toolbar.test's select setter: native prototype setter + bubbling change, so React's tracker sees it. */
function setSelect(el: HTMLSelectElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
const tab = (el: ParentNode, name: string): HTMLElement => {
  const t = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === name)
  if (t === undefined) throw new Error(`no view tab ${name}`)
  return t
}
/** Activate the view named `name`. Switching is session state — it writes nothing of its own. */
const selectView = (el: ParentNode, name: string): void => click(tab(el, name))
const rightClick = (el: Element): void => act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
const menuItem = (el: ParentNode, text: string): HTMLElement => {
  const b = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === text)
  if (b === undefined) throw new Error(`no menu item ${text}`)
  return b
}
const written = (): Record<string, unknown> => write.mock.calls[0][2] as Record<string, unknown>

// ---------- the block itself (🔒 D1) ----------

describe('who gets a contents block', () => {
  it('an ordinary page gets nothing at all — no chrome, no empty block', () => {
    expect(mount(OTHER).innerHTML).toBe('')
  })

  it('a page that IS one but has no snapshot yet gets nothing either (the pre-index window)', () => {
    expect(mount(FUNNELS, null).innerHTML).toBe('')
  })

  it('a flagged page renders the block, and drops it again if the flag goes away', () => {
    const el = mount(FUNNELS)
    expect(el.querySelector('.folder-page-contents')).not.toBeNull()
    feed(vault().map((r) => (r.path === FUNNELS ? rec(FUNNELS, {}) : r)))
    expect(el.innerHTML).toBe('')
  })

  it('the flag is STRICTLY the boolean (the click rule, "Links": Folder pages)', () => {
    const el = mount(FUNNELS, vault().map((r) => (r.path === FUNNELS ? rec(FUNNELS, { folder_page: 'true' }) : r)))
    expect(el.innerHTML).toBe('')
  })
})

// ---------- the rows (🔒 D2) ----------

describe('rows are the members, and only the members', () => {
  it('the lookup fills the block — never a filter over the whole vault', () => {
    const el = mount(FUNNELS)
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Sales]]') // the outline, alphabetical (the [D5] seed)
    selectView(el, 'Table')
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales']) // path order, as `pagesIn` gives them
    expect(el.textContent).not.toContain('Other')
    expect(el.textContent).not.toContain('CAC')
  })

  it('a member added on the next snapshot lands in the block with no user action', () => {
    const el = mount(FUNNELS)
    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    // ADOPTED into the document (YAZ-1152): a member it does not name is a member all the same, so
    // the outline is made to name it — at the END, through the one door. No read-only rows left.
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Sales]]\n- [[Expansion]]')
    expect(el.querySelector('.view-outline__list')).toBeNull()
  })

  it('the whole-vault resolver reaches the engine: a link pointing OUTSIDE the members resolves (🔒 D2)', () => {
    // The trap: with only the members behind it, `link("Outsider")` names nothing and the
    // spellings never meet. The row shows because the resolver came from the whole snapshot.
    const el = mount(FUNNELS, vault({ views: [{ type: 'table', name: 'T', order: ['file.name'], filters: 'owner == link("Outsider")' }] }))
    expect(rowNames(el)).toEqual(['Lead Gen'])
  })
})

describe('declared-column reconciliation (YAZ-999)', () => {
  it('hands the invariant exactly the current DIRECT members and declaration', async () => {
    mount(FUNNELS)
    await flush()

    expect(backfill).toHaveBeenCalledTimes(1)
    const [members, columns] = backfill.mock.calls[0]!
    expect(members.map((member) => member.path)).toEqual([LEAD, SALES])
    expect(columns).toEqual(SETTINGS.columns)
    expect(members.some((member) => member.path === OUTSIDER)).toBe(false)
  })

  it('runs again when membership or an externally-edited declaration changes', async () => {
    mount(FUNNELS)
    await flush()
    backfill.mockClear()

    const expansion = rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })
    feed([...vault({ ...SETTINGS, columns: { ...SETTINGS.columns, status: { kind: 'text' } } }), expansion])
    await flush()

    expect(backfill).toHaveBeenCalledTimes(1)
    const [members, columns] = backfill.mock.calls[0]!
    expect(new Set(members.map((member) => member.path))).toEqual(new Set([LEAD, SALES, expansion.path]))
    expect(columns).toEqual({ ...SETTINGS.columns, status: { kind: 'text' } })
  })

  it('reports a partial reconciliation failure without taking the folder page down', async () => {
    backfill.mockRejectedValueOnce(new Error('Could not initialize 1 column value: Sales.order'))
    const el = mount(FUNNELS)
    await flush()

    expect(q(el, '[role="alert"]').textContent).toContain('Could not initialize 1 column value: Sales.order')
    expect(el.querySelector('.folder-page-contents')).not.toBeNull()
  })

  it('clears a reconciliation failure after the next snapshot succeeds', async () => {
    backfill.mockRejectedValueOnce(new Error('Could not initialize 1 column value: Sales.order'))
    const el = mount(FUNNELS)
    await flush()
    expect(el.querySelector('[role="alert"]')).not.toBeNull()

    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()

    expect(backfill).toHaveBeenCalledTimes(2)
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })

  it('never reconciles an ordinary page', async () => {
    mount(OTHER)
    await flush()
    expect(backfill).not.toHaveBeenCalled()
  })
})

// ---------- the chrome (🔒 rule 4 + Q3) ----------

describe('an outline edited outside the app reaches the rendered document (YAZ-1356)', () => {
  const card = (outline: string) => ({ ...SETTINGS, views: [{ type: 'outline', name: 'Outline', outline }, TABLE] })

  it('the next snapshot carries the new document to the editor', () => {
    const el = mount(FUNNELS, vault(card('- [[Sales]]\n- [[Lead Gen]]')))
    feed(vault(card('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI')))
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI')
  })

  it('so does a file-seeded mount once the index has caught up to the seed (the YAZ-919 gate)', () => {
    const seed = `---\nfolder_page: true\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |\n        - [[Sales]]\n        - [[Lead Gen]]\n    - type: table\n      name: Table\n      order: [file.name, note.order, note.related]\n---\n`
    const el = mount(FUNNELS, vault(card('- [[Sales]]\n- [[Lead Gen]]\n')), seed)
    feed(vault(card('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI\n')))
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- typed by an AI\n')
  })
})

describe('the chrome is the views chrome, minus what a folder page cannot have', () => {
  it('both skins render and the tabs switch between them (🔒 Q7: outline first)', () => {
    const el = mount(FUNNELS)
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table']) // what the card lists is what you get (D3)
    expect(el.querySelector('.view-outline')).not.toBeNull() // YAZ-820's renderer
    expect(el.querySelector('.view-table')).toBeNull()
    selectView(el, 'Table')
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(rowNames(el)).toEqual(['Lead Gen', 'Sales'])
  })

  it('switching view writes NOTHING — which view is active is session state, never the card', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    selectView(el, 'Outline')
    expect(write).not.toHaveBeenCalled()
  })

  it('the tabs EDIT (YAZ-1471): "+" adds, a right-click opens the menu; the outline, a document, still offers no Filter (YAZ-1218)', () => {
    const el = mount(FUNNELS)
    expect(el.querySelector('[aria-label="Add view"]')).not.toBeNull()
    rightClick(tab(el, 'Outline'))
    expect(texts(el, '.ctx-menu[role="menu"] [role="menuitem"]')).toEqual(['Rename', 'Duplicate', 'Delete'])
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull() // documentView — rows-bearing views offer it
    expect(el.querySelector('[aria-label="Sort"]')).not.toBeNull() // the rest of the toolbar is untouched
    expect(el.querySelector('[aria-label="New note"]')).not.toBeNull()
  })

  /**
   * "+" through the REAL host (YAZ-1471, 🔒 D5): a page whose card never mentioned
   * `folder_page_settings` still opens on 🔒 Q7's three skins, and adding a fourth is ONE
   * whole-key settings write — `plain()` omits the empty `columns`, so the key that lands is the
   * views list and nothing else.
   */
  it('"+" on a page with no settings key writes the three defaults plus the new view, once', async () => {
    const el = mount(FUNNELS, vault().map((r) => (r.path === FUNNELS ? rec(FUNNELS, { folder_page: true }) : r)))
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table', 'Board'])
    click(byLabel(el, 'Add view'))
    expect(texts(el, '.view-popover--menu [role="menuitem"]')).toEqual(['Table', 'Board', 'Cards', 'List']) // Outline already there
    click(menuItem(el, 'Cards'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][1]).toBe('folder_page_settings')
    expect(written()).toEqual({
      views: [
        { type: 'outline', name: 'Outline' },
        { type: 'table', name: 'Table' },
        { type: 'board', name: 'Board' },
        { type: 'cards', name: 'Cards' },
      ],
    })
    expect(byLabel<HTMLInputElement>(el, 'View name').value).toBe('Cards') // the appended tab mounts in rename
  })
})

/**
 * Open UI vs an EXTERNAL shrink (YAZ-1488): `menu`, `confirm` and `renaming` are INDICES into
 * `views`, and another window (or a hand edit) can drop views out from under an open one. The
 * strip derives the view in render, so a stale index renders NOTHING — this block has no error
 * boundary above it, and a throw here is a blank window.
 */
describe('an open menu or sheet survives the views list shrinking under it (YAZ-1488)', () => {
  const THREE = { ...SETTINGS, views: [...SETTINGS.views, BOARD] }

  it('the right-click menu on the LAST tab goes away with the view it named', () => {
    const el = mount(FUNNELS, vault(THREE))
    rightClick(tab(el, 'Board'))
    expect(el.querySelector('[role="menu"]')).not.toBeNull()
    feed(vault(SETTINGS))
    expect(el.querySelector('[role="menu"]')).toBeNull()
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })

  it('so does the delete sheet it opened', () => {
    const el = mount(FUNNELS, vault(THREE))
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    expect(el.querySelector('[role="dialog"]')).not.toBeNull()
    feed(vault(SETTINGS))
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })
})

// ---------- the default view (YAZ-1104) ----------

describe('the default view: a saved START, while which view is ACTIVE stays session state', () => {
  it('a page with a defaultView opens on that view — and opening writes nothing', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, defaultView: 'Table' }))
    expect(el.querySelector('.view-table')).not.toBeNull()
    expect(el.querySelector('.view-outline')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('a stale saved name falls back to the first view, silently', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, defaultView: 'Ghost' }))
    expect(el.querySelector('.view-outline')).not.toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('Page → Default view is ONE whole-key settings write carrying the name', async () => {
    const el = mount(FUNNELS)
    click(tab(el, 'Table')) // the outline offers no Properties menu; switching writes nothing
    click(byLabel(el, 'Properties'))
    setSelect(byLabel<HTMLSelectElement>(el, 'Default view'), 'Table')
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, defaultView: 'Table' })
  })

  it('the dropdown shows the saved value, and First view clears the key', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, defaultView: 'Table' }))
    click(byLabel(el, 'Properties'))
    const select = byLabel<HTMLSelectElement>(el, 'Default view')
    expect(select.value).toBe('Table')
    setSelect(select, '')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual(SETTINGS)
  })

  it('renaming the default view carries the saved START along, in the SAME write', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, defaultView: 'Table' }))
    rightClick(tab(el, 'Table'))
    click(menuItem(el, 'Rename'))
    const input = byLabel<HTMLInputElement>(el, 'View name')
    setValue(input, 'Grid')
    press(input, 'Enter')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, name: 'Grid' }], defaultView: 'Grid' })
  })

  it('deleting the default view clears the START in the same write', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, defaultView: 'Table' }))
    rightClick(tab(el, 'Table'))
    click(menuItem(el, 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [SETTINGS.views[0]] })
  })

  it('an EXTERNAL edit that changes ONLY defaultView rebuilds the def (D4: it rides in the stamp)', () => {
    const el = mount(FUNNELS)
    feed(vault({ ...SETTINGS, defaultView: 'Table' }))
    click(tab(el, 'Table')) // the outline has no Properties button of its own
    click(byLabel(el, 'Properties'))
    expect(byLabel<HTMLSelectElement>(el, 'Default view').value).toBe('Table')
    expect(write).not.toHaveBeenCalled()
  })
})

// ---------- the adapter (🔒 D3) ----------

describe('config edits are ONE settings write on the folder page', () => {
  it.each(['Table', 'Board'])('bulk clearing %s writes only its order and frozen-column cleanup in one settings write', async (name) => {
    const views = [{ ...TABLE, frozenColumns: 2 }, { ...BOARD, order: ['file.name', 'note.order'], frozenColumns: 1 }]
    const settings = { ...SETTINGS, views }
    const el = mount(FUNNELS, vault(settings))
    selectView(el, name)
    click(byLabel(el, 'Properties'))
    const clear = [...el.querySelectorAll<HTMLButtonElement>('.view-menu__action')].find((button) => button.textContent === 'Unselect all')!
    click(clear)
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', {
      ...settings,
      views: views.map((view) => {
        if (view.name !== name) return view
        const { frozenColumns: _frozen, ...rest } = view
        return { ...rest, order: [] }
      }),
    })
    expect(clear.disabled).toBe(true)
    click(clear)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a Board column-width edit is one whole-key folder_page_settings write', async () => {
    const withBoard = { ...SETTINGS, views: [...SETTINGS.views, BOARD] } // the card SAYS board now (D3)
    const el = mount(FUNNELS, vault(withBoard))
    selectView(el, 'Board')
    click(byLabel(el, 'Properties'))
    const width = byLabel<HTMLInputElement>(el, 'Column width in pixels')
    setValue(width, '400')
    press(width, 'Enter')
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', {
      ...withBoard,
      views: [...SETTINGS.views, { ...BOARD, cardSize: 400 }],
    })
  })

  it('a sort change goes back through the one door, whole-key, views verbatim', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(FUNNELS) // the FOLDER PAGE's card, not a member's
    expect(key).toBe('folder_page_settings')
    expect(value).toEqual({
      ...SETTINGS,
      views: [SETTINGS.views[0], { ...TABLE, sort: [{ property: 'file.name', direction: 'ASC' }] }],
    })
  })

  it('a filter edit uses that same door, and emptying it deletes the key (YAZ-1235)', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush()

    expect(write).toHaveBeenCalledTimes(1)
    const [path, key, value] = write.mock.calls[0]
    expect(path).toBe(FUNNELS)
    expect(key).toBe('folder_page_settings')
    expect(value).toEqual({
      ...SETTINGS,
      views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['file.name.contains("")'] } }],
    })

    click(byLabel(el, 'Remove rule'))
    await flush()

    expect(write).toHaveBeenCalledTimes(2)
    const emptied = write.mock.calls[1][2] as { views: Record<string, unknown>[] }
    expect(emptied.views[1]).not.toHaveProperty('filters') // empty deletes the key, never `filters: {}`
    expect(emptied).toEqual(SETTINGS)
  })

  it('a write echo arriving after a newer optimistic edit does not take it back (YAZ-1241)', async () => {
    const settingsOf = (call: number): unknown => write.mock.calls[call][2]

    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush() // write 1: the default `file.name contains ""` rule
    chooseProperty(el, 'note.order')
    await flush() // write 2: the rule re-targeted
    expect(write).toHaveBeenCalledTimes(2)
    expect(propertyShown(el)).toContain('Order')

    // Write 1's echo lands AFTER write 2's optimistic state — the race YAZ-1234 caught in the
    // DOM. It is OUR OWN stale write, not an external edit: it must not rebuild anything.
    feed(vault(settingsOf(0)))
    expect(propertyShown(el)).toContain('Order')

    // The next gesture edits what the menu renders — the property edit must survive it.
    setSelect(byLabel<HTMLSelectElement>(el, 'Operator'), 'isEmpty')
    await flush() // write 3
    const third = (settingsOf(2) as { views: { filters?: unknown }[] }).views[1]
    expect(JSON.stringify(third.filters)).toContain('note.order')

    // The remaining echoes drain in order; an external edit afterwards still adopts as always.
    feed(vault(settingsOf(1)))
    feed(vault(settingsOf(2)))
    expect(propertyShown(el)).toContain('Order')
    feed(vault({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['note.order == 9'] } }] }))
    expect(q<HTMLInputElement>(el, '[aria-label="Value"]').value).toBe('9')
  })

  it('the edit shows immediately, without waiting for the index to come back', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(byLabel<HTMLButtonElement>(el, 'Sort property').textContent).toContain('Name')
  })

  it('a column rename lands in folder_page_settings.properties — ONE write, the label persisted, its echo not fought (YAZ-1513)', async () => {
    // Before YAZ-1513 the def's `properties` was never persisted: the pencil's rename showed until
    // the next echo and then silently vanished. Now the header menu and the pencil share one writer.
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    rightClick(q(el, '.view-table thead th:not(.view-table__gutter):nth-of-type(3)')) // note.order → "Order"
    click(menuItem(el, 'Rename column…'))
    const field = byLabel<HTMLInputElement>(el, 'Rename Order')
    setValue(field, 'Rank')
    press(field, 'Enter')
    await flush()

    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, properties: { order: { displayName: 'Rank' } } })
    const headers = () => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    // the index echoes our own write back: the label stays, nothing is rebuilt from an older def
    feed(vault({ ...SETTINGS, properties: { order: { displayName: 'Rank' } } }))
    await flush()
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a stored column label renders on mount, and an external change to it rebuilds the def (YAZ-1513)', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, properties: { order: { displayName: 'Rank' } } }))
    selectView(el, 'Table')
    const headers = () => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)
    expect(headers()).toEqual(['Name', 'Rank', 'Related'])
    feed(vault({ ...SETTINGS, properties: { order: { displayName: 'Position' } } }))
    await flush()
    expect(headers()).toEqual(['Name', 'Position', 'Related'])
    expect(write).not.toHaveBeenCalled()
  })

  it('a drag past the first tab writes the new order and the active view follows; switching alone writes nothing', async () => {
    const el = mount(FUNNELS)
    click(tab(el, 'Table'))
    expect(write).not.toHaveBeenCalled()
    const fire = (target: Element, type: string, clientX = 0) => act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX })))
    const wrap = (name: string): Element => tab(el, name).closest('.view-tab') as Element
    fire(wrap('Table'), 'dragstart')
    fire(wrap('Outline'), 'dragover', -5)
    fire(wrap('Outline'), 'drop', -5)
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual({ ...SETTINGS, views: [TABLE, SETTINGS.views[0]] })
    expect(tab(el, 'Table').getAttribute('aria-selected')).toBe('true')
  })

  it('a Board deleted through the menu STAYS deleted — nothing puts it back on the next read (D3)', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [...SETTINGS.views, BOARD] }))
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table', 'Board'])
    rightClick(tab(el, 'Board'))
    click(menuItem(el, 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    await flush()
    expect(write).toHaveBeenCalledTimes(1)
    expect(written()).toEqual(SETTINGS)
    feed(vault(written())) // the index echoes our own write back
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table'])
  })

  it('a failed write says so and never takes the block down', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Sort'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add sort')!)
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-table')).not.toBeNull()
  })
})

/**
 * The host owns the declarations AHEAD of the index (YAZ-1549): `settings.columns` on the mode is
 * what every menu spreads and hands back as `base`, and what the presence invariant walks — so a
 * column added a moment ago is neither dropped by the next write nor re-added by a member echo.
 */
describe('the declarations ride AHEAD of the index (YAZ-1549)', () => {
  const columnsOf = () => captured.folderPage!.settings.columns
  const setColumn = async (key: string, next: { kind: 'link' | 'text' }) => {
    let failure: unknown = null
    await act(async () => {
      await captured.folderPage!.setColumn(key, next, undefined).catch((err: unknown) => {
        failure = err
      })
    })
    return failure
  }

  it('a setColumn write shows in settings.columns at once — before any echo — and is ONE file transform', async () => {
    mount(FUNNELS)
    expect(columnsOf()).toEqual(SETTINGS.columns)
    expect(await setColumn('owner', { kind: 'link' })).toBeNull()
    expect(columnsOf()).toEqual({ ...SETTINGS.columns, owner: { kind: 'link' } })
    expect(transform).toHaveBeenCalledExactlyOnceWith(FUNNELS, expect.any(Function))
    expect(write).not.toHaveBeenCalled() // the declaration write is `writeFolderColumn`'s, not the whole-key door
  })

  it('the echo carrying the same columns clears the ahead copy: the index leads again, and a later different echo shows through', async () => {
    mount(FUNNELS)
    await setColumn('owner', { kind: 'link' })
    const echoed = { ...SETTINGS, columns: { ...SETTINGS.columns, owner: { kind: 'link' } } }
    feed(vault(echoed))
    await flush()
    expect(columnsOf()).toEqual(echoed.columns)
    // ahead is null now: an EXTERNAL change to that column is what the mode shows
    feed(vault({ ...SETTINGS, columns: { ...SETTINGS.columns, owner: { kind: 'text' } } }))
    await flush()
    expect(columnsOf().owner).toEqual({ kind: 'text' })
  })

  it('a refused declaration write puts the ahead copy back and rejects to the caller — the panel shows the text, the host shows what stands', async () => {
    transform.mockRejectedValueOnce(new Error('Property “owner” changed since these settings were opened. Reopen the property and try again.'))
    mount(FUNNELS)
    const failure = await setColumn('owner', { kind: 'link' })
    expect(String(failure)).toContain('changed since these settings were opened')
    expect(columnsOf()).toEqual(SETTINGS.columns)
  })

  it('two rapid writes COMPOSE: a column added, then another deleted before either echoes — the first declaration survives (the YAZ-1549 finding)', async () => {
    mount(FUNNELS)
    await setColumn('owner', { kind: 'link' })
    await act(async () => captured.folderPage!.deleteColumn('order'))
    expect(write).toHaveBeenCalledTimes(1)
    expect((write.mock.calls[0][2] as { columns: unknown }).columns).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
    expect(columnsOf()).toEqual({ related: SETTINGS.columns.related, owner: { kind: 'link' } })
  })

  it('a refused settings write ABORTS a delete: the banner says why, the ahead copy is put back, and not one member is touched', async () => {
    write.mockRejectedValueOnce(new Error('disk full'))
    const el = mount(FUNNELS)
    await act(async () => captured.folderPage!.deleteColumn('order'))
    expect(transform).not.toHaveBeenCalled() // LEAD and SALES carry `order`; neither was stripped
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(columnsOf()).toEqual(SETTINGS.columns)
  })

  it("after a delete the presence invariant walks the AHEAD columns: a member echo arriving before the page's own cannot re-add the key", async () => {
    mount(FUNNELS)
    await act(async () => captured.folderPage!.deleteColumn('order'))
    expect(transform).toHaveBeenCalledTimes(2) // Lead Gen and Sales lose `order`
    backfill.mockClear()
    // a MEMBER moves while the folder page's own echo (settings without `order`) is still in flight
    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(backfill).toHaveBeenCalled()
    const [, columns] = backfill.mock.calls.at(-1)!
    expect(columns).toEqual({ related: SETTINGS.columns.related })
  })
})

describe('setColumns is the DECLARATIONS door (YAZ-895)', () => {
  const COLUMNS = { order: { kind: 'number' as const }, owner: { kind: 'link' as const } }

  it('one write, whole-key: the new columns, the card’s views verbatim', async () => {
    mount(FUNNELS)
    act(() => captured.folderPage!.setColumns(COLUMNS))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, columns: COLUMNS })
  })

  it('columns AND views ride in that SAME single write when views are passed', async () => {
    mount(FUNNELS)
    const views = [{ type: 'outline', name: 'Outline', order: ['[[Sales]]'] }, TABLE]
    act(() => captured.folderPage!.setColumns(COLUMNS, views))
    await flush()
    expect(write).toHaveBeenCalledExactlyOnceWith(FUNNELS, 'folder_page_settings', { ...SETTINGS, columns: COLUMNS, views })
  })

  /**
   * The LIVE def, never the index snapshot (YAZ-1471 D4): `settings` is the last snapshot the
   * index handed over, so a default-view choice (or a sort/filter edit, when the caller passes no
   * `views`) whose echo is still in flight would be clobbered by the next column write — YAZ-1234's
   * two-gestures-in-a-second data loss, through the other door.
   */
  it('carries an in-flight defaultView choice the index has not echoed back yet', async () => {
    const el = mount(FUNNELS)
    click(tab(el, 'Table')) // the outline offers no Properties menu
    click(byLabel(el, 'Properties'))
    setSelect(byLabel<HTMLSelectElement>(el, 'Default view'), 'Table')
    await flush()
    expect(write).toHaveBeenCalledTimes(1)

    const columns = { ...COLUMNS, extra: { kind: 'text' as const } }
    act(() => captured.folderPage!.setColumns(columns))
    await flush()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1][2]).toEqual({ ...SETTINGS, columns, defaultView: 'Table' })
  })

  it('a failed write lands in the banner every other config edit uses', async () => {
    write.mockRejectedValue(new Error('disk full'))
    const el = mount(FUNNELS)
    act(() => captured.folderPage!.setColumns(COLUMNS))
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(el.querySelector('.view-outline')).not.toBeNull()

    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
  })
})

describe('cell editing still writes the MEMBER, typed by the folder page (🔒 Q8)', () => {
  it('the picker narrows to the pages of the folder page the column targets — from the WHOLE vault (🔒 D2)', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    openCell(el, 0, 2) // Lead Gen's empty `related` cell: multi-link by the folder page's own declaration
    const input = byLabel<HTMLInputElement>(el, 'Edit related')
    setValue(input, '[[')
    // [[KPIs]] is not a row here and neither are its pages — a picker fed the rows alone would
    // have fallen back to the two members instead.
    expect(options(el)).toEqual(['CAC', 'LTV'])
  })

  it('committing writes the member’s own card, one key, through the shared writer', () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    openCell(el, 0, 2)
    setValue(byLabel<HTMLInputElement>(el, 'Edit related'), '[[')
    click(q(el, '[role="option"]')) // completes to [[CAC]]
    press(byLabel(el, 'Edit related'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit related'), 'Enter') // empty input commits the list
    expect(write).toHaveBeenCalledExactlyOnceWith(LEAD, 'related', ['[[CAC]]'])
  })
})

describe('New births a member from the declaration (🔒 Q5)', () => {
  it('parks it in the settings folder, stamps the belonging LAST, and opens it', async () => {
    const el = mount(FUNNELS)
    click(byLabel(el, 'New note'))
    await flush()

    expect(createDir).toHaveBeenCalledWith('/vault/stages')
    expect(createFile).toHaveBeenCalledTimes(1)
    const { path, content } = created(0)
    expect(path).toBe('/vault/stages/Untitled.md') // Lead Gen / Sales are taken
    expect(content).toBe('---\norder:\nrelated: []\nfolder_pages:\n  - "[[Funnel Stages]]"\n---\n')
    expect(content).not.toContain('folder_page:') // an ORDINARY page: the flag is never born here
    expect(onOpenFile).toHaveBeenCalledWith('/vault/stages/Untitled.md')
  })

  it('a TYPED name (YAZ-943) parks the page under that name, seeded the same, and dedups like Untitled', async () => {
    mount(FUNNELS)
    await expect(captured.folderPage!.create({ properties: {}, folder: null }, 'Ship it')).resolves.toBe('/vault/stages/Ship it.md')
    // A member's basename is taken → the typed base steps to " 2", same scheme as Untitled.
    await expect(captured.folderPage!.create({ properties: {}, folder: null }, 'Lead Gen')).resolves.toBe('/vault/stages/Lead Gen 2.md')
  })

  it('a typed name with path separators is tamed (slashes become spaces); whitespace-only falls back to Untitled', async () => {
    mount(FUNNELS)
    await expect(captured.folderPage!.create({ properties: {}, folder: null }, 'a/b')).resolves.toBe('/vault/stages/a b.md')
    await expect(captured.folderPage!.create({ properties: {}, folder: null }, '   ')).resolves.toBe('/vault/stages/Untitled.md')
  })

  it('without a settings folder it lands beside the folder page itself', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, folder: undefined }))
    click(byLabel(el, 'New note'))
    await flush()
    expect(createDir).not.toHaveBeenCalled()
    expect(created(0).path).toBe('/vault/Untitled.md')
  })

  it('a create failure is reported in place, never thrown at the note', async () => {
    createFile.mockRejectedValue(new Error('read-only vault'))
    const el = mount(FUNNELS)
    click(byLabel(el, 'New note'))
    await flush()
    expect(el.textContent).toContain('read-only vault')
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('the seed reads the OPEN file, not the snapshot (YAZ-919)', () => {
  it('a just-migrated outline renders on FIRST paint, while the index still says yesterday', () => {
    // The migration rewrites the file BEFORE the editor mounts; the index echo lands only after
    // the first paint. A seed from the stale snapshot showed the OLD document — and the first
    // commit wrote it back, erasing the migrated text: the silent disappearance YAZ-919 forbids.
    const migrated = [
      '---',
      'folder_page: true',
      'folder_page_settings:',
      '  views:',
      '    - type: outline',
      '      name: Outline',
      '      outline: |-',
      '        - Migrated line',
      '        - "[[Sales-Conversion]]"',
      '---',
      '',
    ].join('\n')
    const el = mount(FUNNELS, vault(), migrated)
    expect(doc(el)).toContain('Migrated line')
  })

  it('without fileContent the snapshot seeds, exactly as before', () => {
    const el = mount(FUNNELS)
    expect(doc(el)).not.toContain('Migrated line')
  })

  it('a write landing BEFORE the index caught up still reaches the card — the past is one snapshot, not forever', () => {
    // The gate exists to stop the STALE mount-time snapshot from clobbering the seed. But a
    // settings write made right after opening moves the index STRAIGHT PAST the seed's bytes,
    // so waiting for an exact seed match gated the card shut forever — a column added and then
    // never seen (caught by the folderPageColumns e2e, red on main since YAZ-919). A SECOND,
    // different snapshot can only be a later write's echo, so it is adopted.
    const seedViews = [{ type: 'outline', name: 'Outline' }, TABLE]
    const migrated = [
      '---',
      'folder_page: true',
      'folder_page_settings:',
      '  columns:',
      '    order: { kind: number }',
      '  views:',
      '    - { type: outline, name: Outline }',
      '    - { type: table, name: Table, order: [file.name, note.order] }',
      '---',
      '',
    ].join('\n')
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: seedViews }), migrated)
    selectView(el, 'Table')
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)')).toEqual(['Name', 'Order'])

    // The user adds a column: our own write, echoing back through the index ahead of the seed.
    const added = {
      columns: { order: { kind: 'number' }, unit: { kind: 'text' } },
      views: [{ type: 'outline', name: 'Outline' }, { type: 'table', name: 'Table', order: ['file.name', 'note.order', 'note.unit'] }],
    }
    act(() => feed(vault(added)))
    expect(texts(el, '.view-table thead th:not(.view-table__gutter)')).toEqual(['Name', 'Order', 'Unit'])
  })
})

// ---------- the write-echo guard vs rapid gestures (YAZ-1241) ----------

describe('the write-echo guard vs rapid gestures (YAZ-1241)', () => {
  it('a genuinely external edit still rebuilds, even while a write is in flight', async () => {
    const el = mount(FUNNELS)
    selectView(el, 'Table')
    click(byLabel(el, 'Filter'))
    click([...el.querySelectorAll<HTMLElement>('.view-menu__action')].find((b) => b.textContent === 'Add rule')!)
    await flush()

    // An outside editor rewrites the card before our echo arrives: disk truth outranks the
    // unechoed local write (the guard's `pending` queue clears, the external state adopts).
    feed(vault({ ...SETTINGS, views: [SETTINGS.views[0], { ...TABLE, filters: { and: ['note.order == 1'] } }] }))
    expect(propertyShown(el)).toContain('Order')
  })
})
