/**
 * Grouped table (4C, GRO-2137): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`;
 * a `groupBy` view renders the engine's groups as sections in one flat tbody — a full-width
 * header row per group (chevron, typed value, count, per-group summaries) with the total
 * summary row gone. Collapse state persists per `<basePath>::<viewName>` through `storage`
 * (mocked here), never through `onChange` (the file). Windowing and `data-cell` keyboard
 * navigation count DATA rows only — headers are skipped seamlessly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_COLLAPSED_GROUP_KEYS, type IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'
import { groupKeyOf } from './GroupHeader'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

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

const GROUP_BASE = `views:
  - type: table
    name: T
    frozenColumns: 1
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`
/** The same grouped view plus a plain second one, so a Delete on the first is not refused as the last view. */
const TWO_VIEWS = GROUP_BASE + `  - type: table
    name: U
    order:
      - file.name
`

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

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

const links = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__link')].map((b) => b.textContent ?? '')
const headers = (el: ParentNode): HTMLTableRowElement[] => [...el.querySelectorAll<HTMLTableRowElement>('.view-table__group')]
const headerTexts = (el: ParentNode): string[] => headers(el).map((h) => q(h, '.view-group__value').textContent ?? '')
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)

/** 600 notes split into two groups for the grouped windowing tests. */
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
      properties: { g: i % 2 ? 'odd' : 'even' },
      aliases: [],
      tags: [],
      links: [],
      embeds: [],
    }
  })
}

const MANY_BASE = 'views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.g\n'

// ---------- tests ----------

describe('grouped sections', () => {
  it('renders one header row per group — value, count, per-group summaries — and no total row', () => {
    const { el } = mount(GROUP_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(headers(el).map((h) => q(h, '.view-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    // rows render inside their sections, in group order
    expect(links(el)).toEqual([
      'The Levels of an Agency',
      'Agentic Agency',
      'The Gold In Your Archive',
      'Creator Economy',
      'VSL-v1',
      'Attribution',
      'Tech & Silicon Valley',
      'List of Topics',
    ])
    // per-group Sum of note.priority: 1 / 2 / 3 / none
    expect(headers(el).map((h) => h.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    // the pinned total row moves into the group headers (Obsidian behaviour)
    expect(el.querySelector('.view-table tfoot')).toBeNull()
    // a header row spans the whole table and owns no data cells
    const groupCell = q<HTMLTableCellElement>(headers(el)[0], 'td')
    expect(groupCell.colSpan).toBe(3)
    expect(groupCell.classList.contains('view-table__group-cell')).toBe(true)
    expect(headers(el)[0].querySelector('[data-cell]')).toBeNull()
    expect(headers(el)[0].querySelector('.view-table__frozen')).toBeNull()
  })

  it('the No value group is last and muted; a list property gives one header per element', () => {
    const { el } = mount(GROUP_BASE)
    const last = headers(el)[3]
    expect(q(last, '.view-group__value').className).toContain('view-group__value--none')

    unmount()
    // Fan-out (YAZ-671 D1): 'agentic, pillar' is no longer a group — each element gets its own
    // header, so the value is a scalar and renders as plain text rather than a chip list.
    const tags = mount(GROUP_BASE.replace('property: note.status', 'property: note.tags'))
    const values = headers(tags.el).map((h) => q(h, '.view-group__value').textContent)
    expect(values.slice(0, 4)).toEqual(['agentic', 'agentic/levels', 'creator', 'pillar'])
    expect(headers(tags.el)[0].querySelectorAll('.view-table__chip')).toHaveLength(0)
  })

  it('a record in several fanned-out groups renders once per group, with unique keys (YAZ-682)', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const rec = (name: string, status: unknown): IndexRecord => ({
      ...TEST_RECORDS[0],
      path: `/vault/${name}.md`,
      name: `${name}.md`,
      basename: name,
      properties: { status },
    })
    const records = [rec('both', ['a', 'b']), rec('onlyA', ['a'])]
    const { el } = mount(GROUP_BASE, { records })

    // 'both' joins group a AND group b, so two records produce three data rows
    expect(headers(el)).toHaveLength(2)
    const data = [...el.querySelectorAll('tbody tr:not(.view-table__group)')]
    expect(data).toHaveLength(3)
    // React only warns once per duplicate-key list, and silently mis-reconciles after that
    expect(errors.mock.calls.flat().join(' ')).not.toMatch(/same key|unique "key"/i)
    errors.mockRestore()
  })
})

describe('collapse', () => {
  it('the chevron hides the section rows, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(GROUP_BASE)
    click(toggleOf(el, 'idea'))
    expect(links(el)).not.toContain('Agentic Agency')
    expect(links(el)).not.toContain('The Gold In Your Archive')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the page's own card, no autosave
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(GROUP_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(links(again.el)).not.toContain('Agentic Agency')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(links(again.el)).toContain('Agentic Agency')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [])
  })

  it('the toolbar toggle collapses every group at once, the ones search hides included', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(GROUP_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    click(byLabel(el, 'Collapse all groups'))
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', ['v:drafting', 'v:idea', 'v:published', groupKeyOf(null)])
    click(byLabel(el, 'Expand all groups'))
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [])
  })

  it('hides the toggle above the persisted cap: 201 groups have no collapse-all button', () => {
    const many: IndexRecord[] = Array.from({ length: MAX_COLLAPSED_GROUP_KEYS + 1 }, (_, i) => ({
      ...TEST_RECORDS[0],
      path: `/vault/many/n${i}.md`,
      name: `n${i}.md`,
      basename: `n${i}`,
      folder: 'many',
      properties: { ...TEST_RECORDS[0].properties, status: `s${i}` },
    }))
    const { el } = mount(GROUP_BASE, { records: many })
    expect(el.querySelectorAll('.view-table__group').length).toBe(MAX_COLLAPSED_GROUP_KEYS + 1)
    expect(el.querySelector('[aria-label="Collapse all groups"]')).toBeNull()
  })

  it('the No value group collapses under its own stable key', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(GROUP_BASE)
    click(toggleOf(el, 'No value'))
    expect(links(el)).not.toContain('Attribution')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::T', [groupKeyOf(null)])
  })

  it('a rename carries the collapsed groups to the new name and a delete drops them (YAZ-1493)', async () => {
    const { storage } = await import('../../lib/storage')
    const { el } = mount(TWO_VIEWS)
    click(toggleOf(el, 'idea'))
    expect(groupStore.get('/vault|/vault/pillars.md::T')).toEqual(['v:idea'])
    const tabOf = (name: string): HTMLElement => {
      const t = [...el.querySelectorAll<HTMLElement>('[role="tab"]')].find((x) => x.textContent === name)
      if (t === undefined) throw new Error(`no tab ${name}`)
      return t
    }
    const menuItem = (text: string): HTMLElement => {
      const b = [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((x) => x.textContent === text)
      if (b === undefined) throw new Error(`no menu item ${text}`)
      return b
    }
    const rightClick = (target: Element): void => {
      act(() => void target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
      draw()
    }
    // Rename T → Grid: the entry moves with the name, and the section stays collapsed on screen.
    rightClick(tabOf('T'))
    click(menuItem('Rename'))
    const field = byLabel<HTMLInputElement>(el, 'View name')
    setValue(field, 'Grid')
    act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
    draw()
    expect(groupStore.has('/vault|/vault/pillars.md::T')).toBe(false)
    expect(groupStore.get('/vault|/vault/pillars.md::Grid')).toEqual(['v:idea'])
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    // Delete Grid: nothing is left behind for a future view of the same name to inherit.
    rightClick(tabOf('Grid'))
    click(menuItem('Delete'))
    click(el.querySelector('.confirm__btn--danger') as HTMLElement)
    expect(groupStore.has('/vault|/vault/pillars.md::Grid')).toBe(false)
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::Grid', [])
  })
})

describe('search interplay', () => {
  it('filters within groups, drops empty groups and narrows the group summaries', () => {
    const { el } = mount(GROUP_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    // 'agency' hits one row in drafting (The Levels of an Agency) and one in idea (Agentic Agency)
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(links(el)).toEqual(['The Levels of an Agency', 'Agentic Agency'])
    expect(headers(el).map((h) => q(h, '.view-group__count').textContent)).toEqual(['1', '1'])
    // idea's Sum recomputes over its shown row only (Agentic Agency, priority 2)
    expect(headers(el)[1].querySelector('.view-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.view-toolbar__count').textContent).toBe('2 / 8 items')
  })
})

describe('keyboard navigation', () => {
  it('data-cell indices count data rows only, so arrows cross group boundaries seamlessly', () => {
    const { el, onOpenFile } = mount(GROUP_BASE)
    const cell = (r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
    act(() => cell(0, 0).focus())
    press(cell(0, 0), 'ArrowDown') // r0 = drafting's only row; r1 = idea's first row, past the header
    expect(document.activeElement).toBe(cell(1, 0))
    press(cell(1, 0), 'Enter')
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
    press(cell(1, 0), 'ArrowUp')
    expect(document.activeElement).toBe(cell(0, 0))
  })
})

describe('windowing with headers', () => {
  it('headers join the windowed slice at row height; spacers pad the rest', () => {
    const { el } = mount(MANY_BASE, { records: manyRecords() })
    // 600 rows + 2 headers = 602 lines > 500 → windowed
    expect(el.querySelectorAll('.view-table tbody tr:not(.view-table__spacer)').length).toBeLessThan(100)
    expect(el.querySelector('.view-table__spacer')).not.toBeNull()
    expect(headerTexts(el)[0]).toBe('even') // the first line is the first group's header
    expect(links(el)[0]).toBe('n000')
    expect(links(el)).not.toContain('n599')
  })

  it('scrolling moves the slice; collapsing a group shrinks the line count below the window threshold', () => {
    const { el } = mount(MANY_BASE, { records: manyRecords() })
    const wrap = q<HTMLElement>(el, '.view-table-wrap')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 5000, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    expect(links(el)).not.toContain('n000')
    act(() => {
      Object.defineProperty(wrap, 'scrollTop', { value: 0, configurable: true })
      wrap.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    draw()
    // collapse 'even' (300 rows): 302 lines remain → no windowing, every 'odd' row mounted
    click(toggleOf(el, 'even'))
    expect(el.querySelector('.view-table__spacer')).toBeNull()
    expect(links(el)).toHaveLength(300)
    expect(links(el)[0]).toBe('n001')
    expect(links(el)).toContain('n599')
  })
})
