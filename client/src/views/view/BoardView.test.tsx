/**
 * Board view (4D, GRO-2138): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`;
 * `type: board` (our schema extension) renders the engine's groups as columns — one column
 * per group with the shared header content (chevron, typed value, count, per-column
 * summaries), cards beneath (`file.name` title button + the other `order` properties as
 * label/value rows). Column width follows numeric `cardSize`; legacy small/medium/large values
 * remain readable as 220/280/340.
 * No `groupBy` → a centered hint whose button writes a sensible default group-by through
 * the file. Collapse persists per `<basePath>::<viewName>` through `storage` (mocked here),
 * never through `onChange`; search narrows cards and drops empty columns like the table.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'
import { normalizeBoardWidth } from './PropertiesMenu'
import { OPEN_DELAY_MS } from './PreviewCard'
import viewsCss from '../views.css?inline'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** Preview mode's fetch and Crepe (YAZ-1244) are stand-ins here — the real render is PreviewCard.crepe.test.tsx's. */
vi.mock('../../api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../api')>()
  return {
    ...original,
    api: {
      ...original.api,
      reveal: vi.fn().mockResolvedValue({ path: '/vault/mock.md' }),
      readFile: vi.fn(async (path: string) => ({ path, content: `body of ${path}\n`, mtime: 1, size: 1 })),
    },
  }
})
const reveal = vi.mocked(api.reveal)
vi.mock('../../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    opts.root.textContent = opts.defaultValue ?? ''
    return { create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
  }),
}))

/** In-memory stand-in for the main-owned store: collapse state must go through here, not the file. */
const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getViewGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setViewGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))

const BOARD_BASE = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.priority
      - note.tags
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`

const NO_GROUP_BASE = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.priority
`

const NESTED_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.n
    groupBy:
      - property: note.dept
      - property: note.proc
    summaries:
      note.n: Sum
`

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  properties,
})

const NESTED_RECORDS: IndexRecord[] = [
  rec('alpha1', { dept: 'A', proc: 'p1', n: 2 }),
  rec('alpha2', { dept: 'A', proc: 'p2', n: 4 }),
  rec('alphaDirect', { dept: 'A', proc: 'A', n: 1 }),
  rec('beta1', { dept: 'B', proc: 'p1', n: 8 }),
  rec('loner', { dept: 'C', proc: 'C', n: 16 }),
]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          thisFile="/vault/pillars.md"
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeViews(parsed) }
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(() => {
  unmount()
  groupStore.clear()
  vi.clearAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

function rightClick(el: EventTarget, clientX = 0, clientY = 0): MouseEvent {
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX, clientY })
  act(() => void el.dispatchEvent(event))
  draw()
  return event
}

/** Drag events bubble like the browser's; jsdom has no DragEvent, and the handlers guard dataTransfer. */
function drag(el: Element, type: string): void {
  act(() => void el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))
  draw()
}

/** A primary click carrying modifier keys — `el.click()` cannot hold ⌘ or ⌥. */
function modClick(el: Element, init: MouseEventInit): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
  draw()
}

function blur(el: Element): void {
  act(() => {
    ;(el as HTMLElement).focus()
    ;(el as HTMLElement).blur()
  })
  draw()
}

const cols = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-board__col')]
const headerTexts = (el: ParentNode): string[] => cols(el).map((c) => q(c, '.view-group__value').textContent ?? '')
const titles = (el: ParentNode): string[] => [...el.querySelectorAll('.view-board__title')].map((b) => b.textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)
const colWidth = (el: ParentNode): string => q<HTMLElement>(el, '.view-board').style.getPropertyValue('--view-board-col-w')
const openProperties = (el: ParentNode): HTMLElement => {
  click(byLabel(el, 'Properties'))
  return q(el, '.view-popover')
}
const widthField = (el: ParentNode): HTMLInputElement => byLabel(el, 'Column width in pixels')
const menuItems = (el: ParentNode): HTMLButtonElement[] => [
  ...el.querySelectorAll<HTMLButtonElement>('.ctx-menu [role="menuitem"]'),
]
const itemNamed = (el: ParentNode, label: string): HTMLButtonElement | undefined =>
  menuItems(el).find((item) => item.textContent === label)
const cardNamed = (el: ParentNode, title: string): HTMLElement => {
  const titleButton = [...el.querySelectorAll<HTMLElement>('.view-board__title')].find((candidate) => candidate.textContent === title)
  const card = titleButton?.closest<HTMLElement>('.view-board__card')
  if (card === null || card === undefined) throw new Error(`missing card ${title}`)
  return card
}

// ---------- tests ----------

describe('board columns', () => {
  it('renders one column per group — value, count, per-column summaries — with No value last', () => {
    const { el } = mount(BOARD_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(cols(el).map((c) => q(c, '.view-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    // per-column Sum of note.priority: 1 / 2 / 3 / none
    expect(cols(el).map((c) => c.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    // the No value column is muted; cards render inside their columns, in group order
    expect(q(cols(el)[3], '.view-group__value').className).toContain('view-group__value--none')
    expect(titles(el)).toEqual([
      'The Levels of an Agency',
      'Agentic Agency',
      'The Gold In Your Archive',
      'Creator Economy',
      'VSL-v1',
      'Attribution',
      'Tech & Silicon Valley',
      'List of Topics',
    ])
  })

  it('a two-level Board renders direct cards first, then stacked inner subgroup sections in each outer column', () => {
    const { el } = mount(NESTED_BOARD, { records: NESTED_RECORDS })
    expect(headerTexts(el)).toEqual(['A', 'B', 'C'])

    const a = cols(el)[0]
    expect(a.classList).toContain('view-board__col--nested')
    expect([...a.querySelectorAll(':scope > .view-board__cards .view-board__title')].map((n) => n.textContent)).toEqual(['alphaDirect'])
    const inner = [...a.querySelectorAll<HTMLElement>(':scope > .view-board__subgroups > .view-board__subgroup')]
    expect(inner.map((section) => q(section, '.view-group__value').textContent)).toEqual(['p1', 'p2'])
    expect(inner.map((section) => q(section, '.view-board__title').textContent)).toEqual(['alpha1', 'alpha2'])
    expect(titles(el)).toEqual(['alphaDirect', 'alpha1', 'alpha2', 'beta1', 'loner'])
  })
})

describe('nested Board styling contract', () => {
  it('keeps the parent surface on its header instead of filling the nested column', () => {
    expect(viewsCss).toMatch(/\.view-board__col--nested\s*\{[^}]*background:\s*transparent;/s)
    expect(viewsCss).toMatch(
      /\.view-board__col-header\s*\{[^}]*background:\s*var\(--bg-side\);[^}]*border:\s*2px solid var\(--fg-muted\);/s,
    )
  })

  it('uses the existing view tokens for a compact child stack and its drop state', () => {
    expect(viewsCss).toMatch(/\.view-board__subgroups\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:\s*8px;/s)
    expect(viewsCss).toMatch(
      /\.view-board__subgroup\s*\{[^}]*background:\s*var\(--bg-side\);[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*6px;/s,
    )
    expect(viewsCss).toMatch(/\.view-board__subgroup--drop\s*\{[^}]*outline:\s*1px dashed var\(--accent\);/s)
  })
})

describe('cards', () => {
  it('a card is the file name title over label/value rows rendered by type; the title opens the page in the current tab', () => {
    const openRight = vi.fn()
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight }) })
    const card = q<HTMLElement>(cols(el)[1], '.view-board__card') // idea → Agentic Agency
    expect(q(card, '.view-board__title').textContent).toBe('Agentic Agency')
    // the order properties minus file.name, as label/value rows
    expect([...card.querySelectorAll('.view-board__prop-name')].map((n) => n.textContent)).toEqual(['Priority', 'Tags'])
    expect([...card.querySelectorAll('.view-board__prop-value')][0].textContent).toBe('2')
    // list values render as chips, like table cells
    expect([...card.querySelectorAll('.view-table__chip')].map((c) => c.textContent)).toEqual(['agentic', 'pillar'])
    // a missing property renders an empty value, the label stays
    const gold = [...cols(el)[1].querySelectorAll<HTMLElement>('.view-board__card')][1]
    expect([...gold.querySelectorAll('.view-board__prop-value')][0].textContent).toBe('')
    click(q(card, '.view-board__title'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    expect(openRight).not.toHaveBeenCalled()
  })

  it('a plain click on the card body SELECTS the card — focus, nothing opens (YAZ-1557 D2)', () => {
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const card = cardNamed(el, 'Agentic Agency')
    expect(card.tabIndex).toBe(0)
    click(q(card, '.view-board__prop-value'))
    expect(document.activeElement).toBe(card)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(openRight).not.toHaveBeenCalled()
    expect(openBackground).not.toHaveBeenCalled()
  })

  it('⌘ opens a background tab and ⌥ the right panel — title or body, direct, nested, repeated and title-less cards, by exact record path; ⇧ does nothing', () => {
    const agentic = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const direct = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    modClick(q(cardNamed(direct.el, 'Agentic Agency'), '.view-board__title'), { metaKey: true })
    expect(openBackground).toHaveBeenLastCalledWith(agentic)
    modClick(q(cardNamed(direct.el, 'Agentic Agency'), '.view-board__prop-value'), { altKey: true })
    expect(openRight).toHaveBeenLastCalledWith(agentic)
    modClick(q(cardNamed(direct.el, 'Agentic Agency'), '.view-board__title'), { shiftKey: true })
    modClick(cardNamed(direct.el, 'Agentic Agency'), { shiftKey: true })
    expect(direct.onOpenFile).not.toHaveBeenCalled()
    expect(openBackground).toHaveBeenCalledOnce()
    expect(openRight).toHaveBeenCalledOnce()

    unmount()
    const nested = mount(NESTED_BOARD, { records: NESTED_RECORDS, folderPage: testFolderPage({ openRight }) })
    modClick(cardNamed(nested.el, 'alpha1'), { altKey: true })
    expect(openRight).toHaveBeenLastCalledWith('/vault/alpha1.md')

    unmount()
    const fanned = mount('views:\n  - type: board\n    name: B\n    order:\n      - file.name\n    groupBy:\n      property: note.tags\n', {
      folderPage: testFolderPage({ openRight }),
    })
    const repeated = [...fanned.el.querySelectorAll<HTMLElement>('.view-board__title')].filter(
      (title) => title.textContent === 'Agentic Agency',
    )
    modClick(repeated[1].closest<HTMLElement>('.view-board__card')!, { altKey: true })
    expect(openRight).toHaveBeenLastCalledWith(agentic)

    unmount()
    const empty = mount('views:\n  - type: board\n    name: B\n    order: []\n    groupBy:\n      property: note.status\n', {
      folderPage: testFolderPage({ openRight }),
    })
    const emptyCard = q<HTMLElement>(empty.el, '.view-board__card')
    expect(emptyCard.getAttribute('role')).toBeNull()
    expect(emptyCard.getAttribute('aria-label')).toBe('The Levels of an Agency.md')
    modClick(emptyCard, { altKey: true })
    expect(openRight).toHaveBeenLastCalledWith('/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md')
    expect(openRight).toHaveBeenCalledTimes(4)
  })

  it('Enter on a selected card opens it in the current tab; ⌘⏎ a background tab, ⌥⏎ the right panel, ⇧⏎ nothing', () => {
    const levels = '/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md'
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const card = cardNamed(el, 'The Levels of an Agency')
    act(() => card.focus())
    press(card, 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith(levels)
    press(card, 'Enter', { metaKey: true })
    expect(openBackground).toHaveBeenCalledExactlyOnceWith(levels)
    press(card, 'Enter', { altKey: true })
    expect(openRight).toHaveBeenCalledExactlyOnceWith(levels)
    press(card, 'Enter', { shiftKey: true })
    press(card, ' ')
    expect(onOpenFile).toHaveBeenCalledOnce()
    // a key pressed INSIDE the card (its title button) is that control's own, never the card's open
    press(q(card, '.view-board__title'), 'Enter')
    expect(onOpenFile).toHaveBeenCalledOnce()
  })

  it('arrow keys walk cards like table cells: ↑↓ inside a column in DOM order (nested sections included), ←→ to the same row of the neighbour column, clamped at every edge', () => {
    const { el } = mount(NESTED_BOARD, { records: NESTED_RECORDS })
    const focused = (): string | null | undefined => document.activeElement?.closest('.view-board__card')?.querySelector('.view-board__title')?.textContent
    const cur = (): HTMLElement => document.activeElement as HTMLElement
    // column A in DOM order: alphaDirect (direct), alpha1 (p1), alpha2 (p2); B: beta1; C: loner
    act(() => cardNamed(el, 'alphaDirect').focus())
    press(cur(), 'ArrowDown')
    expect(focused()).toBe('alpha1')
    press(cur(), 'ArrowDown')
    expect(focused()).toBe('alpha2')
    press(cur(), 'ArrowDown') // clamped at the column's end
    expect(focused()).toBe('alpha2')
    press(cur(), 'ArrowRight') // row 2 clamps to the neighbour's only card
    expect(focused()).toBe('beta1')
    press(cur(), 'ArrowRight')
    expect(focused()).toBe('loner')
    press(cur(), 'ArrowRight') // clamped at the last column
    expect(focused()).toBe('loner')
    press(cur(), 'ArrowLeft')
    expect(focused()).toBe('beta1')
    press(cur(), 'ArrowLeft')
    expect(focused()).toBe('alphaDirect')
    press(cur(), 'ArrowUp') // clamped at the column's start
    expect(focused()).toBe('alphaDirect')
    press(cur(), 'ArrowLeft') // clamped at the first column
    expect(focused()).toBe('alphaDirect')
  })

  it('suppresses the synthetic primary click after a secondary click or completed group drag', () => {
    const openRight = vi.fn()
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight }) })
    const card = cardNamed(el, 'Agentic Agency')

    rightClick(card, 120, 42)
    modClick(card, { altKey: true })
    expect(openRight).not.toHaveBeenCalled()

    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    drag(card, 'dragstart')
    drag(card, 'dragend')
    modClick(card, { altKey: true })
    expect(openRight).not.toHaveBeenCalled()
  })
})

describe('Board-card page context menu (YAZ-1243)', () => {
  const agenticPath = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
  const levelsPath = '/vault/Content Pillars/1. Agentic Agency/The Levels of an Agency.md'
  let writeText: ReturnType<typeof vi.fn>
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

  beforeEach(() => {
    reveal.mockReset().mockResolvedValue({ path: agenticPath })
    writeText = vi.fn(() => Promise.resolve())
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true, writable: true })
  })

  afterEach(() => {
    if (clipboardDescriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  })

  it('opens the shared actions from any point in a rendered card, at the pointer, without opening or editing it', () => {
    const openRight = vi.fn()
    const openBackground = vi.fn()
    const { el, onOpenFile, onChange } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight, openBackground }) })
    const card = cardNamed(el, 'Agentic Agency')
    const event = rightClick(q(card, '.view-board__prop-value'), 120, 42)

    expect(event.defaultPrevented).toBe(true)
    expect(q<HTMLElement>(el, '.ctx-menu').style.left).toBe('120px')
    expect(q<HTMLElement>(el, '.ctx-menu').style.top).toBe('42px')
    expect(menuItems(el).map((item) => item.textContent)).toEqual(['Open in new tab', 'Copy path', 'Reveal in Finder', 'Open in right panel'])
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(el.querySelector('.view-cell-edit__input, .view-table__selected')).toBeNull()
  })

  it('opens the exact card in the right panel without replacing the current page', () => {
    const openRight = vi.fn()
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight }) })
    rightClick(cardNamed(el, 'Agentic Agency'))
    click(itemNamed(el, 'Open in right panel')!)

    expect(openRight).toHaveBeenCalledExactlyOnceWith(agenticPath)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('opens in the background, copies, and reveals the exact absolute card path, closing after every action', () => {
    const openBackground = vi.fn()
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ openBackground }) })
    const card = cardNamed(el, 'Agentic Agency')

    rightClick(card)
    click(itemNamed(el, 'Open in new tab')!)
    expect(openBackground).toHaveBeenCalledExactlyOnceWith(agenticPath)
    expect(onOpenFile).not.toHaveBeenCalled()
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(card)
    click(itemNamed(el, 'Copy path')!)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(agenticPath)
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(card)
    click(itemNamed(el, 'Reveal in Finder')!)
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ path: agenticPath })
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('reports a stale Reveal through the folder-page passive notice', async () => {
    const onNotice = vi.fn()
    reveal.mockRejectedValueOnce(new BridgeRequestError('NOT_FOUND', 'gone'))
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ openBackground: vi.fn(), onNotice }) })
    rightClick(cardNamed(el, 'Agentic Agency'))
    click(itemNamed(el, 'Reveal in Finder')!)
    await act(async () => Promise.resolve())

    expect(onNotice).toHaveBeenCalledExactlyOnceWith(`Can't reveal "Agentic Agency.md" — it is no longer there`)
  })

  it('retargets to the latest card and dismisses on Escape or an outside press', () => {
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ openBackground: vi.fn() }) })
    rightClick(cardNamed(el, 'Agentic Agency'))
    rightClick(cardNamed(el, 'The Levels of an Agency'))
    click(itemNamed(el, 'Copy path')!)
    expect(writeText).toHaveBeenCalledExactlyOnceWith(levelsPath)

    rightClick(cardNamed(el, 'Agentic Agency'))
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(cardNamed(el, 'Agentic Agency'))
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('dismisses a card menu when switching between Board tabs without resetting the whole Board', () => {
    const { el } = mount(`views:
  - type: board
    name: Board A
    order: [file.name]
    groupBy: { property: note.status }
  - type: board
    name: Board B
    order: [file.name]
    groupBy: { property: note.pillar }
`)
    const tab = (name: string): HTMLElement => {
      const button = [...el.querySelectorAll<HTMLElement>('.view-tab__btn')].find((candidate) => candidate.textContent === name)
      if (button === undefined) throw new Error(`missing tab ${name}`)
      return button
    }

    rightClick(cardNamed(el, 'Agentic Agency'))
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
    click(tab('Board B')) // `.click()` emits no outside mousedown: the view change must own dismissal.
    expect(el.querySelector('.ctx-menu')).toBeNull()
    click(tab('Board A'))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('keeps the record path when file.name is hidden, cards are nested, or one record is fanned out', () => {
    const openRight = vi.fn()
    const hidden = mount(
      'views:\n  - type: board\n    name: B\n    order:\n      - note.priority\n    groupBy:\n      property: note.status\n',
      { folderPage: testFolderPage({ openRight }) },
    )
    rightClick(q(hidden.el, '.view-board__card'))
    click(itemNamed(hidden.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith(levelsPath)

    unmount()
    const nested = mount(NESTED_BOARD, { records: NESTED_RECORDS, folderPage: testFolderPage({ openRight }) })
    rightClick(cardNamed(nested.el, 'alphaDirect'))
    click(itemNamed(nested.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith('/vault/alphaDirect.md')
    rightClick(cardNamed(nested.el, 'alpha1'))
    click(itemNamed(nested.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith('/vault/alpha1.md')

    unmount()
    const fanned = mount('views:\n  - type: board\n    name: B\n    order:\n      - file.name\n    groupBy:\n      property: note.tags\n', {
      folderPage: testFolderPage({ openRight }),
    })
    const repeated = [...fanned.el.querySelectorAll<HTMLElement>('.view-board__title')].filter(
      (title) => title.textContent === 'Agentic Agency',
    )
    expect(repeated).toHaveLength(2)
    rightClick(q(repeated[1].closest<HTMLElement>('.view-board__card')!, '.view-board__line'))
    click(itemNamed(fanned.el, 'Open in right panel')!)
    expect(openRight).toHaveBeenLastCalledWith(agenticPath)
  })

  it('keeps the exact record target on an otherwise-empty card shell', () => {
    const openRight = vi.fn()
    const { el } = mount('views:\n  - type: board\n    name: B\n    order: []\n    groupBy:\n      property: note.status\n', {
      folderPage: testFolderPage({ openRight }),
    })
    const shell = q<HTMLElement>(el, '.view-board__card')
    expect(shell.querySelector('.view-board__line')).toBeNull()

    expect(rightClick(shell).defaultPrevented).toBe(true)
    click(itemNamed(el, 'Open in right panel')!)
    expect(openRight).toHaveBeenCalledExactlyOnceWith(levelsPath)
  })

  it('leaves headers, add controls, placeholders, the no-group hint, and other view types on their native menu', () => {
    const openBackground = vi.fn()
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ openBackground }) })
    const firstCard = cardNamed(el, 'Agentic Agency')
    const drafting = cols(el)[0]
    const idea = cols(el)[1]

    for (const target of [q(el, '.view-group'), byLabel(el, 'New card')]) {
      expect(rightClick(target).defaultPrevented).toBe(false)
      expect(el.querySelector('.ctx-menu')).toBeNull()
    }
    click(byLabel(el, 'New card'))
    expect(rightClick(byLabel(el, 'New card name')).defaultPrevented).toBe(false)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    drag(firstCard, 'dragstart')
    drag(drafting, 'dragover')
    expect(rightClick(q(el, '.view-board__placeholder')).defaultPrevented).toBe(false)
    expect(el.querySelector('.ctx-menu')).toBeNull()
    drag(firstCard, 'dragend')

    unmount()
    const nested = mount(NESTED_BOARD, { records: NESTED_RECORDS, folderPage: testFolderPage({ openBackground }) })
    expect(rightClick(q(nested.el, '.view-board__subgroup > .view-group')).defaultPrevented).toBe(false)
    expect(nested.el.querySelector('.ctx-menu')).toBeNull()

    unmount()
    const hint = mount(NO_GROUP_BASE, { folderPage: testFolderPage({ openBackground }) })
    expect(rightClick(q(hint.el, '.view-board__hint')).defaultPrevented).toBe(false)
    expect(hint.el.querySelector('.ctx-menu')).toBeNull()

    unmount()
    const list = mount('views:\n  - type: list\n    name: L\n    order:\n      - file.name\n', {
      folderPage: testFolderPage({ openBackground }),
    })
    expect(rightClick(q(list.el, '.view-list__item')).defaultPrevented).toBe(false)
    expect(list.el.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('cardSize', () => {
  it('reads legacy cardSize values: small 220, absent 280, large 340', () => {
    const { el } = mount(BOARD_BASE)
    expect(colWidth(el)).toBe('280px')
    unmount()
    const small = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: small'))
    expect(colWidth(small.el)).toBe('220px')
    unmount()
    const large = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: large'))
    expect(colWidth(large.el)).toBe('340px')
  })

  it.each([
    ['absent', BOARD_BASE, '280'],
    ['numeric', BOARD_BASE.replace('name: B', 'name: B\n    cardSize: 400'), '400'],
    ['legacy preset', BOARD_BASE.replace('name: B', 'name: B\n    cardSize: small'), '220'],
    ['legacy numeric below the editor minimum', BOARD_BASE.replace('name: B', 'name: B\n    cardSize: 100'), '100'],
  ])('shows the %s width without writing on open', (_label, text, expected) => {
    const { el, onChange } = mount(text)
    const input = widthField(openProperties(el))
    expect(input.value).toBe(expected)
    expect(input.type).toBe('number')
    expect(input.min).toBe('180')
    expect(input.step).toBe('1')
    expect(input.parentElement?.textContent).toContain('px')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers Column width only for Board views', () => {
    const { el } = mount(BOARD_BASE)
    expect(openProperties(el).querySelector('[aria-label="Column width in pixels"]')).not.toBeNull()
    unmount()
    const cards = mount(BOARD_BASE.replace('type: board', 'type: cards'))
    expect(openProperties(cards.el).querySelector('[aria-label="Column width in pixels"]')).toBeNull()
  })

  it('persists 400 once and every outer column keeps the shared rendered width', () => {
    const { el, onChange, yaml } = mount(BOARD_BASE)
    const input = widthField(openProperties(el))
    setValue(input, '400')
    press(input, 'Enter')
    blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('cardSize: 400')
    expect(colWidth(el)).toBe('400px')
    expect(cols(el)).toHaveLength(4)
    expect(cols(el).every((col) => col.parentElement?.style.getPropertyValue('--view-board-col-w') === '400px')).toBe(true)
    expect(viewsCss).toMatch(/\.view-board__col\s*\{[^}]*width:\s*var\(--view-board-col-w,\s*280px\);/s)
  })

  it('persists a valid width exactly once when blur is the only commit gesture', () => {
    const { el, onChange, yaml } = mount(BOARD_BASE)
    const input = widthField(openProperties(el))
    setValue(input, '400')
    blur(input)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('cardSize: 400')
  })

  it('focus and blur leave an untouched legacy numeric width below 180 unchanged with no write', () => {
    const { el, onChange, yaml } = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: 100'))
    const input = widthField(openProperties(el))
    expect(input.value).toBe('100')
    blur(input)
    expect(input.value).toBe('100')
    expect(onChange).not.toHaveBeenCalled()
    expect(yaml()).toContain('cardSize: 100')
  })

  it('a changed draft still normalizes before comparison and visibly restores the canonical value', () => {
    const { el, onChange } = mount(BOARD_BASE)
    const input = widthField(openProperties(el))
    setValue(input, '280.4')
    press(input, 'Enter')
    expect(input.value).toBe('280')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the Board normalizer rejects an invalid draft directly', () => {
    expect(normalizeBoardWidth('not-a-width')).toBeNull()
  })

  it('deletes cardSize when the normalized width is 280, and an unchanged 280 writes nothing', () => {
    const seeded = mount(BOARD_BASE.replace('name: B', 'name: B\n    cardSize: 400'))
    const seededInput = widthField(openProperties(seeded.el))
    setValue(seededInput, '280')
    press(seededInput, 'Enter')
    expect(seeded.onChange).toHaveBeenCalledTimes(1)
    expect(seeded.yaml()).not.toContain('cardSize')

    unmount()
    const absent = mount(BOARD_BASE)
    const absentInput = widthField(openProperties(absent.el))
    setValue(absentInput, '280')
    press(absentInput, 'Enter')
    expect(absent.onChange).not.toHaveBeenCalled()
  })

  it.each([
    ['rounds decimals', '250.6', '251', '251px'],
    ['clamps below the minimum', '100', '180', '180px'],
    ['keeps huge finite values without a maximum', '999999999', '999999999', '999999999px'],
  ])('%s', (_label, draft, stored, rendered) => {
    const { el, onChange, yaml } = mount(BOARD_BASE)
    const input = widthField(openProperties(el))
    expect(input.max).toBe('')
    setValue(input, draft)
    press(input, 'Enter')
    expect(input.value).toBe(stored)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain(`cardSize: ${stored}`)
    expect(colWidth(el)).toBe(rendered)
  })

  it('restores empty, non-finite and escaped drafts without writing, then accepts a valid edit', () => {
    const { el, onChange, yaml } = mount(BOARD_BASE)
    const input = widthField(openProperties(el))

    setValue(input, '')
    blur(input)
    expect(input.value).toBe('280')
    expect(onChange).not.toHaveBeenCalled()

    setValue(input, '1e9999')
    blur(input)
    expect(input.value).toBe('280')
    expect(onChange).not.toHaveBeenCalled()

    setValue(input, '500')
    press(input, 'Escape')
    expect(input.value).toBe('280')
    expect(onChange).not.toHaveBeenCalled()

    setValue(input, '400')
    press(input, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('cardSize: 400')
  })

  it('nested boards use the same shared outer-column geometry', () => {
    const { el } = mount(NESTED_BOARD.replace('name: B', 'name: B\n    cardSize: 400'), { records: NESTED_RECORDS })
    expect(colWidth(el)).toBe('400px')
    expect(cols(el)).toHaveLength(3)
    expect(cols(el).every((col) => col.classList.contains('view-board__col'))).toBe(true)
    expect(cols(el)[0].classList).toContain('view-board__col--nested')
  })
})

describe('no groupBy', () => {
  it('shows a hint whose button writes the first non-file property as the group-by', () => {
    const { el, onChange, yaml } = mount(NO_GROUP_BASE)
    expect(el.querySelector('.view-board__col')).toBeNull()
    const hint = q<HTMLElement>(el, '.view-board__hint')
    click(q(hint, 'button'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('property: note.priority')
    // the write turns the hint into a real board immediately
    expect(el.querySelector('.view-board__hint')).toBeNull()
    expect(headerTexts(el)).toEqual(['1', '2', '3', 'No value'])
  })
})

describe('collapse', () => {
  it('the chevron hides the cards, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(BOARD_BASE)
    click(toggleOf(el, 'idea'))
    expect(titles(el)).not.toContain('Agentic Agency')
    expect(titles(el)).not.toContain('The Gold In Your Archive')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the page's own card, no autosave
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(BOARD_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(titles(again.el)).not.toContain('Agentic Agency')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(titles(again.el)).toContain('Agentic Agency')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', [])
  })

  it('an inner chevron hides only that subgroup and persists under its outer-scoped key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(NESTED_BOARD, { records: NESTED_RECORDS })
    const p1 = [...el.querySelectorAll<HTMLElement>('[aria-label="Toggle group p1"]')]
    expect(p1).toHaveLength(2)
    click(p1[0])

    const sections = [...el.querySelectorAll<HTMLElement>('.view-board__subgroup')]
    expect(sections[0].querySelector('.view-board__title')).toBeNull()
    expect(q(sections[2], '.view-board__title').textContent).toBe('beta1')
    expect(onChange).not.toHaveBeenCalled()
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::B', [`v:A\u001fv:p1`])
  })
})

describe('search interplay', () => {
  it('narrows cards, drops empty columns and recomputes counts and summaries', () => {
    const { el } = mount(BOARD_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    // 'agency' hits one card in drafting (The Levels of an Agency) and one in idea (Agentic Agency)
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(titles(el)).toEqual(['The Levels of an Agency', 'Agentic Agency'])
    expect(cols(el).map((c) => q(c, '.view-group__count').textContent)).toEqual(['1', '1'])
    expect(cols(el)[1].querySelector('.view-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.view-toolbar__count').textContent).toBe('2 / 8 items')
  })
})

describe('inline new card row (YAZ-943): the Notion add, at the bottom of every column', () => {
  const flush = () => act(async () => {})
  const press = (input: HTMLElement, key: string) => {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    draw()
  }
  /** The column whose header value reads `label`. */
  const colOf = (el: ParentNode, label: string): HTMLElement => {
    const c = cols(el).find((c) => q(c, '.view-group__value').textContent === label)
    if (c === undefined) throw new Error(`no column ${label}`)
    return c
  }
  const subgroupOf = (col: ParentNode, label: string): HTMLElement => {
    const section = [...col.querySelectorAll<HTMLElement>('.view-board__subgroup')].find(
      (candidate) => q(candidate, '.view-group__value').textContent === label,
    )
    if (section === undefined) throw new Error(`no subgroup ${label}`)
    return section
  }

  it('every column ends in a "New card" row; clicking it swaps in the name input', () => {
    const openRight = vi.fn()
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ openRight }) })
    expect(cols(el).every((c) => c.querySelector('[aria-label="New card"]') !== null)).toBe(true)
    click(byLabel(colOf(el, 'idea'), 'New card'))
    expect(colOf(el, 'idea').querySelector('[aria-label="New card name"]')).not.toBeNull()
    // Only the clicked column's row opened.
    expect(colOf(el, 'drafting').querySelector('[aria-label="New card name"]')).toBeNull()
    expect(openRight).not.toHaveBeenCalled()
  })

  it("Enter creates the page with the typed name in THAT column's group, stays on the board, and keeps the input for the next add", async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Ship it.md'))
    const { el, onOpenFile } = mount(BOARD_BASE, { folderPage: testFolderPage({ create }) })
    click(byLabel(colOf(el, 'idea'), 'New card'))
    const input = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    setValue(input, 'Ship it')
    press(input, 'Enter')
    await flush()
    draw()
    expect(create).toHaveBeenCalledTimes(1)
    const [seed, name] = create.mock.calls[0] as unknown as [{ properties: Record<string, unknown> }, string]
    expect(name).toBe('Ship it')
    expect(seed.properties.status).toBe('idea') // the column's own group value rides the seed
    expect(onOpenFile).not.toHaveBeenCalled() // inline add STAYS on the board
    const again = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    expect(again.value).toBe('') // cleared, still open, ready for the next card
  })

  it.each(['select', 'multi-select'] as const)('creates a card in an unused %s option with the correct YAML seed', async (kind) => {
    const create = vi.fn(() => Promise.resolve('/vault/First card.md'))
    const { el, onOpenFile } = mount(BOARD_BASE.replace('    name: B', '    name: B\n    showEmptyColumns: true'), {
      records: [],
      folderPage: testFolderPage({ create, settings: { columns: { status: { kind, options: ['Waiting: review'] } }, views: [], problems: [] } }),
    })
    const empty = colOf(el, 'Waiting: review')
    click(byLabel(empty, 'New card'))
    const input = byLabel<HTMLInputElement>(empty, 'New card name')
    setValue(input, 'First card')
    press(input, 'Enter')
    await flush()
    expect(create).toHaveBeenCalledExactlyOnceWith({ properties: { status: kind === 'select' ? 'Waiting: review' : ['Waiting: review'] }, folder: null }, 'First card')
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('a nested Board puts named inline add inside child sections and seeds both group levels', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/Ship it.md'))
    const { el, onOpenFile } = mount(NESTED_BOARD, { records: NESTED_RECORDS, folderPage: testFolderPage({ create }) })
    const a = colOf(el, 'A')
    const p2 = subgroupOf(a, 'p2')

    expect(a.querySelector(':scope > [aria-label="New card"]')).toBeNull()
    click(byLabel(p2, 'New card'))
    const input = byLabel<HTMLInputElement>(p2, 'New card name')
    setValue(input, 'Ship it')
    press(input, 'Enter')
    await flush()

    expect(create).toHaveBeenCalledTimes(1)
    const [createdSeed, name] = create.mock.calls[0] as unknown as [{ properties: Record<string, unknown> }, string]
    expect(createdSeed.properties).toEqual({ proc: 'p2', dept: 'A' })
    expect(name).toBe('Ship it')
    expect(onOpenFile).not.toHaveBeenCalled()
  })

  it('empty Enter creates nothing; Escape closes the input back to the row', async () => {
    const create = vi.fn(() => Promise.resolve('/vault/x.md'))
    const { el } = mount(BOARD_BASE, { folderPage: testFolderPage({ create }) })
    click(byLabel(colOf(el, 'idea'), 'New card'))
    const input = byLabel<HTMLInputElement>(colOf(el, 'idea'), 'New card name')
    press(input, 'Enter')
    await flush()
    expect(create).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(colOf(el, 'idea').querySelector('[aria-label="New card name"]')).toBeNull()
    expect(colOf(el, 'idea').querySelector('[aria-label="New card"]')).not.toBeNull()
  })

  it('a collapsed column hides its add row with its cards', () => {
    const { el } = mount(BOARD_BASE)
    click(toggleOf(el, 'idea'))
    expect(colOf(el, 'idea').querySelector('[aria-label="New card"]')).toBeNull()
  })
})

describe('card layout (YAZ-1206/YAZ-1217): cardStyle rows and the join model', () => {
  const STYLED = (order: string, cardStyle: string) => `views:
  - type: board
    name: B
    order:
${order}
    groupBy:
      property: note.status
    cardStyle:
${cardStyle}
`
  const cardIn = (el: ParentNode): HTMLElement => q<HTMLElement>(el, '.view-board__card')
  const linesIn = (card: HTMLElement): HTMLElement[] => [...card.querySelectorAll<HTMLElement>('.view-board__line')]

  it('bold and underline restyle a row; labels stay; each unjoined property is its own line', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { bold: true }\n      note.tags: { underline: true }'))
    const card = cardIn(el)
    const rows = [...card.querySelectorAll<HTMLElement>('.view-board__prop')]
    expect(rows.map((r) => q(r, '.view-board__prop-name').textContent)).toEqual(['Priority', 'Tags'])
    expect(rows[0].classList.contains('view-board__prop--bold')).toBe(true)
    expect(rows[1].classList.contains('view-board__prop--underline')).toBe(true)
    expect(linesIn(card)).toHaveLength(3)
  })

  it('hideLabel drops the muted label span and keeps the value', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { hideLabel: true }'))
    const rows = [...cardIn(el).querySelectorAll<HTMLElement>('.view-board__prop')]
    expect(rows[0].querySelector('.view-board__prop-name')).toBeNull()
    expect(q(rows[0], '.view-board__prop-value')).toBeDefined()
    expect(q(rows[1], '.view-board__prop-name').textContent).toBe('Tags')
  })

  it('join chains consecutive properties onto ONE line after the title, an en-dash element between items', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority\n      - note.tags', '      note.priority: { join: true, bold: true }\n      note.tags: { join: true }'))
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    // item, dash, item, dash, item — the dash is its OWN flex child, never a pseudo inside one
    expect(kids.map((k) => k.className.split(' ')[0])).toEqual([
      'view-board__title',
      'view-board__dash',
      'view-board__prop',
      'view-board__dash',
      'view-board__prop',
    ])
    expect(kids[1].textContent).toBe('\u2013')
    expect(kids[2].classList.contains('view-board__prop--bold')).toBe(true)
  })

  it('the title is UN-PINNED: it renders at its order position and can itself join (2 - Title.md)', () => {
    const openRight = vi.fn()
    const { el, onOpenFile } = mount(
      STYLED('      - note.priority\n      - file.name', '      note.priority: { hideLabel: true }\n      file.name: { join: true }'),
      { folderPage: testFolderPage({ openRight }) },
    )
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    expect(kids[0].classList.contains('view-board__prop')).toBe(true)
    expect(kids[1].classList.contains('view-board__dash')).toBe(true)
    expect(kids[2].classList.contains('view-board__title')).toBe(true)
    click(kids[2]) // still the name link wherever it sits: plain click → current tab (YAZ-1557)
    expect(onOpenFile).toHaveBeenCalledTimes(1)
    expect(openRight).not.toHaveBeenCalled()
  })

  it('join works the same with file.name hidden, and on the FIRST property it is a no-op', () => {
    const { el } = mount(STYLED('      - note.priority\n      - note.tags', '      note.priority: { join: true }\n      note.tags: { join: true }'))
    const card = cardIn(el)
    const rows = linesIn(card)
    expect(card.querySelector('.view-board__title')).toBeNull()
    expect(rows).toHaveLength(1)
    const kids = [...rows[0].children]
    // no dash BEFORE the first item (its join was the no-op), one between the two
    expect(kids[0].classList.contains('view-board__prop')).toBe(true)
    expect(rows[0].querySelectorAll('.view-board__dash')).toHaveLength(1)
    expect(kids[1].classList.contains('view-board__dash')).toBe(true)
  })

  it('the title button ignores bold/underline/hideLabel styling', () => {
    const { el } = mount(STYLED('      - file.name\n      - note.priority', '      file.name: { bold: true, underline: true, hideLabel: true }'))
    const title = q<HTMLElement>(cardIn(el), '.view-board__title')
    expect(title.classList.contains('view-board__prop--bold')).toBe(false)
    expect(title.classList.contains('view-board__prop--underline')).toBe(false)
  })

  it('cardStyle reaches cards inside subgroup sections through the shared cardList (YAZ-1177)', () => {
    const { el } = mount(
      `views:
  - type: board
    name: B
    order:
      - file.name
      - note.n
    groupBy:
      - property: note.dept
      - property: note.proc
    cardStyle:
      note.n: { join: true, bold: true, hideLabel: true }
`,
      { records: NESTED_RECORDS },
    )
    const sub = q<HTMLElement>(el, '.view-board__subgroup .view-board__card')
    expect(q(sub, '.view-board__dash')).toBeDefined()
    const joined = q<HTMLElement>(sub, '.view-board__dash + .view-board__prop')
    expect(joined.classList.contains('view-board__prop--bold')).toBe(true)
    expect(joined.querySelector('.view-board__prop-name')).toBeNull()
    const direct = q<HTMLElement>(el, '.view-board__col > .view-board__cards .view-board__card')
    expect(q<HTMLElement>(direct, '.view-board__dash + .view-board__prop').classList.contains('view-board__prop--bold')).toBe(true)
  })

  it('the styling contract: line, joined dash, bold and underline live in views.css', () => {
    expect(viewsCss).toMatch(/\.view-board__prop--bold\s*\{[^}]*font-weight:\s*600/s)
    expect(viewsCss).toMatch(/\.view-board__prop--underline\s*\{[^}]*text-decoration:\s*underline/s)
    expect(viewsCss).toMatch(/\.view-board__line\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*baseline/s)
    expect(viewsCss).toMatch(/\.view-board__dash\s*\{[^}]*color:\s*var\(--fg-muted\)/s)
    expect(viewsCss).not.toMatch(/view-board__inline--/)
  })
})

/**
 * Preview mode's wiring (YAZ-1244): `preview: true` hands every card `usePreview`'s hover pair;
 * absent attaches nothing. A drag start shuts the card. The card's own timing/cache matrix is
 * PreviewCard.test.tsx's.
 */
describe('preview mode (YAZ-1244)', () => {
  const PREVIEW_BOARD = `${BOARD_BASE}    preview: true\n`
  const settle = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)).then(() => undefined))
  const hover = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
  const previewCard = (): HTMLElement | null => document.body.querySelector('.view-preview')

  it("resting on a card opens the preview with that page's body", async () => {
    const { el } = mount(PREVIEW_BOARD)
    hover(q<HTMLElement>(el, '.view-board__card'))
    await settle(OPEN_DELAY_MS + 50)
    expect(previewCard()).not.toBeNull()
    expect(previewCard()!.textContent).toContain('body of /vault/')
  })

  it('preview off: hovering opens nothing', async () => {
    const { el } = mount(BOARD_BASE)
    hover(q<HTMLElement>(el, '.view-board__card'))
    await settle(OPEN_DELAY_MS + 50)
    expect(previewCard()).toBeNull()
  })

  it('a drag start closes the preview', async () => {
    const { el } = mount(PREVIEW_BOARD)
    const target = q<HTMLElement>(el, '.view-board__card')
    hover(target)
    await settle(OPEN_DELAY_MS + 50)
    expect(previewCard()).not.toBeNull()
    act(() => void target.dispatchEvent(new Event('dragstart', { bubbles: true, cancelable: true })))
    draw()
    expect(previewCard()).toBeNull()
  })

  it('a secondary click closes the preview and opens page actions for that exact card', async () => {
    const openBackground = vi.fn()
    const { el } = mount(PREVIEW_BOARD, { folderPage: testFolderPage({ openBackground }) })
    const target = cardNamed(el, 'Agentic Agency')
    hover(target)
    await settle(OPEN_DELAY_MS + 50)
    expect(previewCard()).not.toBeNull()

    rightClick(target)
    expect(previewCard()).toBeNull()
    expect(menuItems(el).map((item) => item.textContent)).toEqual(['Open in new tab', 'Copy path', 'Reveal in Finder'])
    click(itemNamed(el, 'Open in new tab')!)
    expect(openBackground).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })
})
