/**
 * Table view (GRO-2136): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`; a
 * `type: table` view renders the real `<table>` (typed cells, column resize, summary row,
 * keyboard navigation, windowing) while other view types keep the placeholder list.
 * `onChange` swaps in the new `ParsedViews` and re-renders, so assertions read the YAML the
 * file would get (`serializeViews`) next to the DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { type ViewSet, type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'
import { OPEN_DELAY_MS } from './PreviewCard'

vi.mock('../../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api')>()
  return {
    ...original,
    api: {
      ...original.api,
      reveal: vi.fn().mockResolvedValue({ path: '/vault/mock.md' }),
      // Preview mode's fetch (YAZ-1244): a body for every path, so the hover card always has content.
      readFile: vi.fn(async (path: string) => ({ path, content: `body of ${path}\n`, mtime: 1, size: 1 })),
    },
  }
})
const reveal = vi.mocked(api.reveal)

/** Preview mode's Crepe (YAZ-1244) is a stand-in here — the real render is PreviewCard.crepe.test.tsx's. */
vi.mock('../../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    opts.root.textContent = opts.defaultValue ?? ''
    return { create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
  }),
}))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** file.name plus one column per value type, and a formula the evaluator cannot resolve. */
const TYPED_BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
      - note.published
      - note.tags
      - note.related
      - formula.nope
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}, options: { editorHost?: boolean } = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  if (options.editorHost === true) {
    container.className = 'editor-host'
    container.style.overflowY = 'auto'
  }
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() => {
      const pane = (
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />
      )
      root?.render(options.editorHost === true ? <div className="folder-page-contents">{pane}</div> : pane)
    })
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function byText<T extends HTMLElement>(el: ParentNode, sel: string, text: string): T {
  const n = [...el.querySelectorAll<T>(sel)].find((x) => x.textContent === text)
  if (n === undefined) throw new Error(`missing ${sel} "${text}"`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function doubleClick(el: Element): void {
  act(() => {
    const target = el as HTMLElement
    target.click()
    target.click()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init })))
  draw()
}

/** A primary click carrying modifier keys — `el.click()` cannot hold ⌘ or ⌥. */
function modClick(el: Element, init: MouseEventInit): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
  draw()
}

function mouse(el: EventTarget, type: string, clientX: number): void {
  act(() => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX })))
  draw()
}

function rightClick(el: EventTarget, clientX = 0, clientY = 0): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY })
  act(() => void el.dispatchEvent(event))
  draw()
  return event
}

const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table th:not(.view-table__gutter)')].map((t) => t.textContent ?? '')
const links = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__link')].map((b) => b.textContent ?? '')
/** Data rows only (spacers excluded). */
const bodyRows = (el: ParentNode): HTMLTableRowElement[] => [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr:not(.view-table__spacer)')]
const cells = (row: HTMLTableRowElement): HTMLTableCellElement[] => [...row.querySelectorAll<HTMLTableCellElement>('td:not(.view-table__gutter)')]

const box = (top: number, height: number, width = 600): DOMRect => new DOMRect(0, top, width, height)

function pinningHarness({ tableTop = -80, tableHeight = 600, frameId = 1, zoom = 1 } = {}) {
  const frames: FrameRequestCallback[] = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frames.push(callback)
    return frameId
  })
  let top = tableTop
  const { el } = mount(TYPED_BASE, {}, { editorHost: true })
  const table = q<HTMLElement>(el, '.view-table')
  const header = q<HTMLElement>(table, 'thead')
  const wrap = q<HTMLElement>(el, '.view-table-wrap')
  Object.defineProperty(wrap, 'currentCSSZoom', { value: zoom, configurable: true })
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(box(0, 400))
  vi.spyOn(table, 'getBoundingClientRect').mockImplementation(() => box(top * zoom, tableHeight * zoom))
  vi.spyOn(header, 'getBoundingClientRect').mockImplementation(() => box(top * zoom, 28 * zoom))

  return {
    el,
    frames,
    wrap,
    setTableTop: (next: number) => {
      top = next
    },
    scroll: (times = 1) => act(() => Array.from({ length: times }, () => el.dispatchEvent(new Event('scroll')))),
    flush: () => act(() => frames.shift()?.(0)),
  }
}

/** 600 empty notes for the windowing tests. */
function manyRecords(n = 600): IndexRecord[] {
  return Array.from({ length: n }, (_, i) => {
    const basename = `n${String(i).padStart(3, '0')}`
    return {
      path: `/vault/${basename}.md`,
      name: `${basename}.md`,
      basename,
      folder: '',
      ext: 'md',
      size: 0,
      ctime: 0,
      mtime: 0,
      properties: {},
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    }
  })
}

// ---------- tests ----------

describe('table structure', () => {
  it('a table view renders columns from order; unknown view types keep the placeholder list', () => {
    const { el } = mount(`${TYPED_BASE}  - type: bogus\n    name: L\n`)
    expect(headers(el)).toEqual(['Name', 'Priority', 'Published', 'Tags', 'Related', 'Nope'])
    expect(bodyRows(el)).toHaveLength(8)
    expect(links(el)[0]).toBe('Agentic Agency')
    expect(el.querySelector('.view-rows')).toBeNull()

    click(byText(el, '[role="tab"]', 'L'))
    expect(el.querySelector('.view-table')).toBeNull()
    expect(el.querySelectorAll('.view-row')).toHaveLength(8)
  })

  it('header labels use displayName when set', () => {
    const { el } = mount(`${TYPED_BASE}properties:\n  priority:\n    displayName: Rank\n`)
    expect(headers(el)[1]).toBe('Rank')
  })
})

describe('cells by type', () => {
  it('numbers right-align, booleans are read-only checkboxes, lists and links are chips, errors are #ERROR chips', () => {
    const { el } = mount(TYPED_BASE)
    const [agentic, levels, creator] = bodyRows(el)

    // number (priority 2), right-aligned
    const num = cells(agentic)[1]
    expect(num.textContent).toBe('2')
    expect(num.className).toContain('view-table__cell--num')

    // checkbox (published: false / true), live editor (5B, GRO-2142)
    const off = q<HTMLInputElement>(cells(agentic)[2], 'input[type="checkbox"]')
    expect(off.checked).toBe(false)
    expect(off.disabled).toBe(false)
    expect(q<HTMLInputElement>(cells(creator)[2], 'input[type="checkbox"]').checked).toBe(true)

    // list (tags) as chips
    const chips = [...cells(agentic)[3].querySelectorAll('.view-table__chip')].map((c) => c.textContent)
    expect(chips).toEqual(['agentic', 'pillar'])

    // link ([[Agentic Agency]]) as a link chip
    const link = q(cells(levels)[4], '.view-table__chip--link')
    expect(link.textContent).toBe('Agentic Agency')

    // error (unknown formula) as a red #ERROR chip with the message in title
    const err = q<HTMLElement>(cells(agentic)[5], '.view-table__chip--error')
    expect(err.textContent).toBe('#ERROR')
    expect(err.title).toBe('unknown formula nope')

    // missing value renders empty (related is unset on the first note)
    expect(cells(agentic)[4].textContent).toBe('Empty')
  })
})

describe('editable cell activation', () => {
  it('selects a declared empty property cell on click and opens its editor on double-click', () => {
    const folderPage = testFolderPage({
      settings: { columns: { empty_text: { kind: 'text' } }, views: [], problems: [] },
    })
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.empty_text\n', {
      folderPage,
    })
    const emptyCell = q<HTMLElement>(el, '[data-cell="0:1"]')
    expect(emptyCell.textContent).toBe('Empty')

    click(emptyCell)
    expect(document.activeElement).toBe(emptyCell)
    expect(emptyCell.querySelector('[aria-label="Edit empty_text"]')).toBeNull()

    doubleClick(emptyCell)
    expect(byLabel<HTMLInputElement>(emptyCell, 'Edit empty_text').value).toBe('')
  })

  it('programmatic nested activation remains exactly once', () => {
    const { el } = mount(TYPED_BASE)
    const populatedCell = q<HTMLElement>(el, '[data-cell="0:1"]')
    const control = q<HTMLElement>(populatedCell, '[data-edit]')
    let clicks = 0
    control.addEventListener('click', () => clicks++)

    click(control)

    expect(clicks).toBe(1)
    expect(byLabel<HTMLInputElement>(populatedCell, 'Edit priority')).not.toBeNull()
  })
})

describe('file.name link', () => {
  it('clicking the name cell link opens the note', () => {
    const { el, onOpenFile, onChange } = mount(TYPED_BASE)
    click(q(el, '.view-table__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('⌘-click opens a background tab, ⌥-click the right panel, ⇧-click nothing (YAZ-1557)', () => {
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(TYPED_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const agentic = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
    modClick(q(el, '.view-table__link'), { metaKey: true })
    expect(openBackground).toHaveBeenCalledExactlyOnceWith(agentic)
    modClick(q(el, '.view-table__link'), { altKey: true })
    expect(openRight).toHaveBeenCalledExactlyOnceWith(agentic)
    modClick(q(el, '.view-table__link'), { shiftKey: true })
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(openBackground).toHaveBeenCalledOnce()
    expect(openRight).toHaveBeenCalledOnce()
  })
})

describe('table-row context menu (YAZ-1053)', () => {
  const expectedPath = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
  const menuItems = (el: ParentNode) => [...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')]
  const itemNamed = (el: ParentNode, label: string) => menuItems(el).find((item) => item.textContent === label)
  let writeText: ReturnType<typeof vi.fn>
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  beforeEach(() => {
    reveal.mockReset().mockResolvedValue({ path: expectedPath })
    writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
  })

  afterEach(() => {
    if (clipboardDescriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  })

  it('selects the exact right-clicked cell first, then opens the table-owned actions at the pointer', () => {
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile, onChange } = mount(TYPED_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const cell = q<HTMLTableCellElement>(el, '[data-cell="0:0"]')
    const event = rightClick(q(cell, '.view-table__link'), 120, 42)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(cell)
    expect(q<HTMLElement>(el, '.ctx-menu').style.left).toBe('120px')
    expect(q<HTMLElement>(el, '.ctx-menu').style.top).toBe('42px')
    expect(menuItems(el).map((item) => item.textContent)).toEqual(['Open in new tab', 'Copy path', 'Reveal in Finder', 'Open in right panel'])
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('opens the exact row in the right panel without replacing the current page', () => {
    const openRight = vi.fn()
    const { el, onOpenFile } = mount(TYPED_BASE, { folderPage: testFolderPage({ openRight }) })
    rightClick(q(el, '[data-cell="0:1"]'))
    click(itemNamed(el, 'Open in right panel')!)

    expect(openRight).toHaveBeenCalledExactlyOnceWith(expectedPath)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('does not turn an ordinary cell click into a right-panel open', () => {
    const openRight = vi.fn()
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openRight }) })
    click(q(el, '[data-cell="0:1"]'))
    expect(openRight).not.toHaveBeenCalled()
  })

  it('opens the exact row in a background tab without replacing the current page', () => {
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground }) })
    rightClick(q(el, '[data-cell="0:1"]'))
    click(itemNamed(el, 'Open in new tab')!)

    expect(openBackground).toHaveBeenCalledExactlyOnceWith(expectedPath)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('copies and reveals the row absolute path, closing after either command', () => {
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground: vi.fn() }) })
    rightClick(q(el, '[data-cell="0:1"]'))
    click(itemNamed(el, 'Copy path')!)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedPath)
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(q(el, '[data-cell="0:1"]'))
    click(itemNamed(el, 'Reveal in Finder')!)
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ path: expectedPath })
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('reports a stale Reveal through the folder-page notice instead of failing silently', async () => {
    const onNotice = vi.fn()
    reveal.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground: vi.fn(), onNotice }) })
    rightClick(q(el, '[data-cell="0:0"]'))
    click(itemNamed(el, 'Reveal in Finder')!)
    await act(async () => Promise.resolve())

    expect(onNotice).toHaveBeenCalledExactlyOnceWith(`Can't reveal "Agentic Agency.md" — it is no longer there`)
  })

  it('retargets to the latest row and dismisses on Escape or an outside press', () => {
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground: vi.fn() }) })
    rightClick(q(el, '[data-cell="0:0"]'))
    rightClick(q(el, '[data-cell="1:0"]'))
    click(itemNamed(el, 'Copy path')!)
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md')

    rightClick(q(el, '[data-cell="0:0"]'))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(q(el, '[data-cell="0:0"]'))
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('leaves the native menu alone inside an active typed editor', () => {
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground: vi.fn() }) })
    const cell = q<HTMLTableCellElement>(el, '[data-cell="0:1"]')
    doubleClick(cell)
    const event = rightClick(q(cell, '.view-cell-edit__input'))

    expect(event.defaultPrevented).toBe(false)
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('still opens on a checkbox because selecting a boolean is not typed edit mode', () => {
    const { el } = mount(TYPED_BASE, { folderPage: testFolderPage({ openBackground: vi.fn() }) })
    const checkbox = q<HTMLInputElement>(el, '[data-cell="0:2"] input[type="checkbox"]')
    const event = rightClick(checkbox)

    expect(event.defaultPrevented).toBe(true)
    expect(menuItems(el).map((item) => item.textContent)).toEqual(['Open in new tab', 'Copy path', 'Reveal in Finder'])
  })

  it('targets the rendered record when file.name is hidden, grouped, or windowed', () => {
    const openRight = vi.fn()
    const hidden = mount('views:\n  - type: table\n    name: T\n    order:\n      - note.priority\n', { folderPage: testFolderPage({ openRight }) })
    rightClick(q(hidden.el, '[data-cell="0:0"]'))
    click(itemNamed(hidden.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith(expectedPath)

    act(() => root?.unmount())
    container?.remove()
    const grouped = mount('views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.status\n', { folderPage: testFolderPage({ openRight }) })
    rightClick(q(grouped.el, '[data-cell="0:0"]'))
    click(itemNamed(grouped.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith('/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md')

    act(() => root?.unmount())
    container?.remove()
    const windowedRecords = manyRecords()
    const windowed = mount('views:\n  - type: table\n    name: T\n', { records: windowedRecords, folderPage: testFolderPage({ vaultRecords: windowedRecords, openRight }) })
    rightClick(q(windowed.el, '[data-cell="0:0"]'))
    click(itemNamed(windowed.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith('/vault/n000.md')
  })

  it('keeps the exact record target when one page is fanned out into repeated grouped rows', () => {
    const openRight = vi.fn()
    const { el } = mount('views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.tags\n', { folderPage: testFolderPage({ openRight }) })
    const repeated = [...el.querySelectorAll<HTMLButtonElement>('.view-table__link')].filter((link) => link.textContent === 'Agentic Agency')
    expect(repeated).toHaveLength(2)

    rightClick(repeated[1])
    click(itemNamed(el, 'Open in right panel')!)
    expect(openRight).toHaveBeenCalledExactlyOnceWith(expectedPath)
  })

  it('does not attach the row menu to headers, summaries, or spacer rows', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    summaries:\n      note.priority: Sum\n', { records: manyRecords(), folderPage: testFolderPage({ vaultRecords: manyRecords(), openBackground: vi.fn() }) })
    for (const target of [q(el, 'tfoot td'), q(el, '.view-table__spacer td')]) {
      const event = rightClick(target)
      expect(event.defaultPrevented).toBe(false)
      expect(el.querySelector('.ctx-menu')).toBeNull()
    }
    // A header opens its OWN menu (YAZ-1513, TableHeaderMenu.test.tsx) — never the row's page actions.
    rightClick(q(el, 'thead th'))
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
    expect([...el.querySelectorAll('.ctx-menu [role="menuitem"]')].map((b) => b.textContent)).not.toContain('Open in right panel')
  })
})

describe('column resize', () => {
  it('dragging a header handle previews the width and writes columnSize once on mouseup', () => {
    const { el, onChange, def, yaml } = mount(TYPED_BASE)
    const handle = el.querySelectorAll('.view-table__resize')[1] // note.priority
    mouse(handle, 'mousedown', 100)
    mouse(window, 'mousemove', 130)
    expect(onChange).not.toHaveBeenCalled()
    expect(q<HTMLElement>(el, '.view-table th:nth-child(3)').style.width).toBe('180px') // 150 default + 30
    mouse(window, 'mouseup', 130)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 180 })
    expect(yaml()).toContain('columnSize:')
    expect(yaml()).toContain('note.priority: 180')
  })

  it('a drag starts from the stored width and clamps at the minimum', () => {
    const { el, def } = mount(`${TYPED_BASE.replace('name: T\n', 'name: T\n    columnSize:\n      note.priority: 90\n')}`)
    expect(q<HTMLElement>(el, '.view-table th:nth-child(3)').style.width).toBe('90px')
    const handle = el.querySelectorAll('.view-table__resize')[1]
    mouse(handle, 'mousedown', 200)
    mouse(window, 'mousemove', 0)
    mouse(window, 'mouseup', 0)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 60 })
  })

  it.each([0.5, 1, 1.25, 2])('turns a pointer drag into the same logical width at %× document zoom', (zoom) => {
    const { el, def } = mount(TYPED_BASE)
    const handle = el.querySelectorAll('.view-table__resize')[1]
    Object.defineProperty(handle, 'currentCSSZoom', { value: zoom, configurable: true })
    mouse(handle, 'mousedown', 100)
    mouse(window, 'mousemove', 100 + 40 * zoom)
    mouse(window, 'mouseup', 100 + 40 * zoom)
    expect(def().views[0].columnSize).toEqual({ 'note.priority': 190 })
  })

  it('only the dragged handle carries the active class, and none do once the drag ends', () => {
    const { el } = mount(TYPED_BASE)
    const active = () => [...el.querySelectorAll('.view-table__resize')].map((h) => h.className.includes('view-table__resize--active'))
    expect(active()).toEqual([false, false, false, false, false, false])
    mouse(el.querySelectorAll('.view-table__resize')[1], 'mousedown', 100)
    mouse(window, 'mousemove', 130)
    expect(active()).toEqual([false, true, false, false, false, false])
    mouse(window, 'mouseup', 130)
    expect(active()).toEqual([false, false, false, false, false, false])
  })
})

describe('vertical header pinning', () => {
  it('counter-scrolls the existing header against the outer note scroller', () => {
    const pinning = pinningHarness()

    pinning.scroll()
    expect(pinning.frames).toHaveLength(1)
    pinning.flush()
    expect(pinning.wrap.style.getPropertyValue('--view-table-header-y')).toBe('80px')
  })

  it.each([0.5, 1, 1.25, 2])('counter-scrolls by the same logical offset at %× document zoom', (zoom) => {
    const pinning = pinningHarness({ zoom })

    pinning.scroll()
    pinning.flush()

    expect(pinning.wrap.style.getPropertyValue('--view-table-header-y')).toBe('80px')
  })

  it('stays at the table start and releases at the table bottom', () => {
    const pinning = pinningHarness({ tableTop: 40, tableHeight: 200 })

    pinning.scroll()
    pinning.flush()
    expect(pinning.wrap.style.getPropertyValue('--view-table-header-y')).toBe('0px')

    pinning.setTableTop(-400)
    pinning.scroll()
    pinning.flush()
    expect(pinning.wrap.style.getPropertyValue('--view-table-header-y')).toBe('172px')
  })

  it('coalesces scroll events into one layout update per animation frame', () => {
    const pinning = pinningHarness()

    pinning.scroll(3)
    expect(pinning.frames).toHaveLength(1)
  })

  it('removes its scroll work and pending frame on unmount', () => {
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const pinning = pinningHarness({ frameId: 41 })

    pinning.scroll()
    expect(pinning.frames).toHaveLength(1)

    act(() => root?.unmount())
    root = null
    expect(cancelFrame).toHaveBeenCalledWith(41)
    expect(pinning.wrap.style.getPropertyValue('--view-table-header-y')).toBe('')

    pinning.scroll()
    expect(pinning.frames).toHaveLength(1)
  })

  it('observes the outer scroller blocks that can move the table', () => {
    const observed: Element[] = []
    class RecordingResizeObserver {
      observe(target: Element) {
        observed.push(target)
      }
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver)

    const pinning = pinningHarness()
    expect(observed).toContain(pinning.el.firstElementChild)
  })
})

describe('frozen columns', () => {
  const FROZEN_BASE = `views:
  - type: table
    name: T
    frozenColumns: 2
    order:
      - file.name
      - note.status
      - note.priority
    columnSize:
      file.name: 120
      note.status: 90
`

  it('sticks the first N real header, body and footer cells at cumulative live widths', () => {
    const { el } = mount(FROZEN_BASE)
    const header = [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')]
    const body = cells(bodyRows(el)[0])
    const footer = [...el.querySelectorAll<HTMLElement>('.view-table tfoot td:not(.view-table__gutter)')]

    for (const row of [header, body, footer]) {
      expect(row.map((cell) => cell.classList.contains('view-table__frozen'))).toEqual([true, true, false])
      expect(row.map((cell) => cell.style.left)).toEqual(['44px', '164px', ''])
    }
  })

  it('moves later frozen columns during a resize preview and keeps the offset after the write', () => {
    const { el, def } = mount(FROZEN_BASE)
    const second = () => [
      q<HTMLElement>(el, '.view-table thead th:nth-child(3)'),
      q<HTMLElement>(el, '.view-table tbody tr:not(.view-table__spacer) td:nth-child(3)'),
      q<HTMLElement>(el, '.view-table tfoot td:nth-child(3)'),
    ]
    expect(second().map((cell) => cell.style.left)).toEqual(['164px', '164px', '164px'])

    mouse(el.querySelectorAll('.view-table__resize')[0], 'mousedown', 100)
    mouse(window, 'mousemove', 160)
    expect(second().map((cell) => cell.style.left)).toEqual(['224px', '224px', '224px'])
    mouse(window, 'mouseup', 160)

    expect(def().views[0].columnSize?.['file.name']).toBe(180)
    expect(second().map((cell) => cell.style.left)).toEqual(['224px', '224px', '224px'])
  })

  it('renders malformed counts safely as zero and clamps oversized counts to every visible column', () => {
    const malformed = mount(FROZEN_BASE.replace('frozenColumns: 2', 'frozenColumns: nope'))
    expect(malformed.el.querySelector('.view-table__frozen')).toBeNull()

    act(() => root?.unmount())
    container?.remove()
    const all = mount(FROZEN_BASE.replace('frozenColumns: 2', 'frozenColumns: 99'))
    expect([...all.el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].every((cell) => cell.classList.contains('view-table__frozen'))).toBe(true)
  })
})

describe('summary row', () => {
  const SUM_BASE = `summaries:
  Total: '"n=" + values.length'
views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
`

  it('the chooser lists built-ins plus custom names, writes view.summaries and shows the value', () => {
    const { el, onChange, def, yaml } = mount(SUM_BASE)
    click(byLabel(el, 'Summarize Priority'))
    const pop = q(el, '.view-popover')
    const items = [...pop.querySelectorAll('.view-popover__item')].map((b) => b.textContent)
    expect(items[0]).toBe('None')
    expect(items).toContain('Sum')
    expect(items).toContain('Total')
    click(byText(pop, '.view-popover__item', 'Sum'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].summaries).toEqual({ 'note.priority': 'Sum' })
    expect(yaml()).toContain('note.priority: Sum')
    expect(el.querySelector('.view-popover')).toBeNull()
    expect(byLabel(el, 'Summarize Priority').textContent).toBe('Sum6') // priorities 2 + 1 + 3
  })

  it('a custom summary evaluates with values bound to the column; None deletes the key', () => {
    const { el, def, yaml } = mount(SUM_BASE.replace('name: T\n', 'name: T\n    summaries:\n      note.priority: Total\n'))
    expect(byLabel(el, 'Summarize Priority').textContent).toBe('Totaln=8')
    click(byLabel(el, 'Summarize Priority'))
    click(byText(el, '.view-popover__item', 'None'))
    expect(def().views[0].summaries).toBeUndefined()
    expect(yaml()).not.toContain('note.priority: Total')
  })
})

describe('keyboard navigation', () => {
  it('arrow keys move the focused cell; Enter on a file.name cell opens the note', () => {
    const { el, onOpenFile } = mount(TYPED_BASE)
    const cell = (r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
    act(() => cell(0, 0).focus())
    press(cell(0, 0), 'ArrowRight')
    expect(document.activeElement).toBe(cell(0, 1))
    press(cell(0, 1), 'ArrowDown')
    expect(document.activeElement).toBe(cell(1, 1))
    press(cell(1, 1), 'ArrowLeft')
    expect(document.activeElement).toBe(cell(1, 0))
    press(cell(1, 0), 'ArrowUp')
    expect(document.activeElement).toBe(cell(0, 0))
    press(cell(0, 0), 'ArrowUp') // clamped at the edges
    expect(document.activeElement).toBe(cell(0, 0))
    press(cell(0, 0), 'ArrowDown')
    press(cell(1, 0), 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md')
  })

  it('⌘⏎ and ⌥⏎ on a file.name cell follow the click rule: background tab, right panel (YAZ-1557)', () => {
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(TYPED_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const cell = q<HTMLElement>(el, '[data-cell="0:0"]')
    act(() => cell.focus())
    press(cell, 'Enter', { metaKey: true })
    expect(openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    press(cell, 'Enter', { altKey: true })
    expect(openRight).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    press(cell, 'Enter', { shiftKey: true })
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('Enter on a non-name cell starts editing instead of opening (5B, GRO-2142)', () => {
    const { el, onOpenFile } = mount(TYPED_BASE)
    const cell = q<HTMLElement>(el, '[data-cell="0:1"]')
    act(() => cell.focus())
    press(cell, 'Enter')
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(cell.querySelector('input')).not.toBeNull()
  })
})

describe('row height', () => {
  it('rowHeight presets set the CSS variable on the table', () => {
    const tall = mount(TYPED_BASE.replace('name: T\n', 'name: T\n    rowHeight: tall\n'))
    expect(q<HTMLElement>(tall.el, '.view-table').style.getPropertyValue('--view-table-row-h')).toBe('68px')
    act(() => root?.unmount())
    container?.remove()
    const short = mount(TYPED_BASE)
    expect(q<HTMLElement>(short.el, '.view-table').style.getPropertyValue('--view-table-row-h')).toBe('28px')
  })
})

describe('windowing', () => {
  it('with more than 500 rows only a slice of <tr>s is in the DOM, padded by spacer rows', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    frozenColumns: 1\n', { records: manyRecords() })
    expect(q(el, '.view-toolbar__count').textContent).toBe('600 items')
    expect(bodyRows(el).length).toBeLessThan(100)
    expect(links(el)[0]).toBe('n000')
    expect(links(el)).not.toContain('n599')
    const spacer = q<HTMLTableRowElement>(el, '.view-table__spacer')
    expect(spacer).not.toBeNull()
    expect(q<HTMLTableCellElement>(spacer, 'td').colSpan).toBe(2)
    expect(spacer.querySelector('.view-table__frozen')).toBeNull()
  })

  it('scrolling moves the rendered slice', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n', { records: manyRecords() })
    const wrap = q<HTMLElement>(el, '.view-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 5000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    expect(links(el)).not.toContain('n000')
    expect(bodyRows(el).length).toBeLessThan(100)
    expect(links(el).length).toBeGreaterThan(0)
  })

  it('500 rows or fewer render in full, no spacers', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n', { records: manyRecords(500) })
    expect(bodyRows(el)).toHaveLength(500)
    expect(el.querySelector('.view-table__spacer')).toBeNull()
  })
})

/**
 * Preview mode's wiring (YAZ-1244): `preview: true` on the view hands every data row `usePreview`'s
 * hover pair; absent attaches nothing at all. A drag start shuts the card — moving a row and
 * peeking at one are different gestures. The card's own timing/cache matrix is PreviewCard.test.tsx's.
 */
describe('preview mode (YAZ-1244)', () => {
  const PREVIEW_BASE = 'views:\n  - type: table\n    name: T\n    preview: true\n    order:\n      - file.name\n'
  const PREVIEW_GROUPED = `${PREVIEW_BASE}    groupBy:\n      property: note.status\n`
  const settle = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)).then(() => undefined))
  const hover = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const firstRow = (el: ParentNode): HTMLElement => {
    const row = q<HTMLElement>(el, 'td[data-cell]').closest('tr')
    if (row === null) throw new Error('no data row')
    return row
  }
  const card = (): HTMLElement | null => document.body.querySelector('.view-preview')

  it("resting on a row opens the card with that page's body", async () => {
    const { el } = mount(PREVIEW_BASE)
    hover(firstRow(el))
    await settle(OPEN_DELAY_MS + 50)
    expect(card()).not.toBeNull()
    expect(card()!.textContent).toContain('body of /vault/')
  })

  it('preview off: hovering opens nothing', async () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
    hover(firstRow(el))
    await settle(OPEN_DELAY_MS + 50)
    expect(card()).toBeNull()
  })

  it('a drag start closes the card', async () => {
    const { el } = mount(PREVIEW_GROUPED)
    hover(firstRow(el))
    await settle(OPEN_DELAY_MS + 50)
    expect(card()).not.toBeNull()
    act(() => void firstRow(el).dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })))
    draw()
    expect(card()).toBeNull()
  })

  it('a secondary click closes the preview and opens page actions for that exact row', async () => {
    const openBackground = vi.fn()
    const { el } = mount(PREVIEW_BASE, { folderPage: testFolderPage({ openBackground }) })
    const target = firstRow(el)
    hover(target)
    await settle(OPEN_DELAY_MS + 50)
    expect(card()).not.toBeNull()

    rightClick(q(target, 'td[data-cell]'))
    expect(card()).toBeNull()
    expect([...el.querySelectorAll('.ctx-menu [role="menuitem"]')].map((item) => item.textContent)).toEqual([
      'Open in new tab',
      'Copy path',
      'Reveal in Finder',
    ])
    click([...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]')].find((item) => item.textContent === 'Open in new tab')!)
    expect(openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })
})
