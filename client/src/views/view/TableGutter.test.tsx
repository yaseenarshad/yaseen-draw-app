/**
 * The `#` gutter (YAZ-1513): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`; the
 * table's first column numbers the rows 1-based in DISPLAY order and restarts at every group
 * header — each innermost section counts from 1, a two-level outer's direct rows count from 1 and
 * then every child section restarts. It is display position, never an id: a sort renumbers, a
 * fanned-out record carries a number in EACH group, a collapsed group shows none and the group
 * after it still starts at 1. The gutter is outside the arrow-key grid (no `data-cell`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FOLDER_PAGE = testFolderPage()

/** In-memory stand-in for the main-owned store (same shape as TableGroups.test.tsx). */
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

const FLAT = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
`
const GROUPED = `${FLAT}    groupBy:
      property: note.status
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={onChange} root="/vault" thisFile="/vault/pillars.md" records={TEST_RECORDS} folderPage={FOLDER_PAGE} onOpenFile={vi.fn()} {...props} />,
      ),
    )
  draw()
  return { el: container }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  groupStore.clear()
  vi.clearAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

/** Data rows only (headers and spacers excluded), in document order. */
const dataRows = (el: ParentNode): HTMLTableRowElement[] =>
  [...el.querySelectorAll<HTMLTableRowElement>('.view-table tbody tr:not(.view-table__spacer):not(.view-table__group)')]
/** `[name, #]` per data row, in display order. */
const numbered = (el: ParentNode): [string, string][] =>
  dataRows(el).map((tr) => [q(tr, '.view-table__link').textContent ?? '', q(tr, 'td.view-table__gutter').textContent ?? ''])
const gutters = (el: ParentNode): string[] => numbered(el).map(([, n]) => n)
/** The grouped tbody as `{ 'group label': [#...] }`, in document order. */
function sections(el: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current = ''
  for (const tr of el.querySelectorAll('.view-table tbody tr')) {
    if (tr.classList.contains('view-table__group')) {
      current = q(tr, '.view-group__value').textContent ?? ''
      out[current] = []
    } else if (!tr.classList.contains('view-table__spacer')) {
      out[current]?.push(q(tr, 'td.view-table__gutter').textContent ?? '')
    }
  }
  return out
}

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  properties,
})

// ---------- tests ----------

describe('the # gutter (YAZ-1513)', () => {
  it('numbers ungrouped rows 1..N in display order', () => {
    const { el } = mount(FLAT)
    expect(gutters(el)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('is display position: a DESC sort renumbers the same pages', () => {
    const asc = mount(`${FLAT}    sort:\n      - property: file.name\n        direction: ASC\n`)
    const ascNames = numbered(asc.el).map(([name]) => name)
    expect(gutters(asc.el)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    act(() => root?.unmount())
    container?.remove()

    const desc = mount(`${FLAT}    sort:\n      - property: file.name\n        direction: DESC\n`)
    const descNames = numbered(desc.el).map(([name]) => name)
    expect(descNames).toEqual([...ascNames].reverse())
    // the numbers do not follow the pages: position 1 is whoever is shown first
    expect(gutters(desc.el)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('one-level grouping restarts at 1 per group — the No value group included', () => {
    const { el } = mount(GROUPED)
    expect(sections(el)).toEqual({ drafting: ['1'], idea: ['1', '2'], published: ['1', '2'], 'No value': ['1', '2', '3'] })
  })

  it('two-level grouping: the direct rows count from 1, then each child section restarts', () => {
    // The merge rule (YAZ-745, as TableNestedGroups.test.tsx pins it): an inner value equal to the
    // outer's is a DIRECT row of the outer, not a child section.
    const records = [
      rec('alphaDirect', { dept: 'A', proc: 'A' }),
      rec('alpha1', { dept: 'A', proc: 'p1' }),
      rec('alpha2', { dept: 'A', proc: 'p2' }),
      rec('alpha3', { dept: 'A', proc: 'p2' }),
      rec('beta1', { dept: 'B', proc: 'p1' }),
    ]
    const { el } = mount(`${FLAT}    groupBy:\n      - property: note.dept\n      - property: note.proc\n`, { records })
    expect(numbered(el)).toEqual([
      ['alphaDirect', '1'],
      ['alpha1', '1'],
      ['alpha2', '1'],
      ['alpha3', '2'],
      ['beta1', '1'],
    ])
  })

  it('fan-out: the same record carries a number in EACH group it sits in', () => {
    const { el } = mount(`${FLAT}    groupBy:\n      property: note.tags\n`)
    const repeated = numbered(el).filter(([name]) => name === 'Agentic Agency')
    expect(repeated).toHaveLength(2)
    for (const [, n] of repeated) expect(n).toMatch(/^\d+$/)
    // every section still starts at 1
    for (const numbers of Object.values(sections(el))) expect(numbers[0]).toBe('1')
  })

  it('a collapsed group renders no numbers, and the group after it still starts at 1', () => {
    const { el } = mount(GROUPED)
    click(q(el, '[aria-label="Toggle group idea"]'))
    const after = sections(el)
    expect(after.idea).toEqual([])
    expect(after.published).toEqual(['1', '2'])
    expect(after['No value']).toEqual(['1', '2', '3'])
  })

  it('rowNumbers: false hides the gutter — no header cell, no row cell, full-width rows span only the keys', () => {
    const { el } = mount(`${GROUPED}    rowNumbers: false\n`)
    expect(el.querySelector('.view-table__gutter')).toBeNull()
    expect(el.querySelectorAll('.view-table thead th')).toHaveLength(2) // keys.length
    expect(dataRows(el)[0].cells).toHaveLength(2)
    expect(q<HTMLTableCellElement>(el, '.view-table__group td').colSpan).toBe(2)
  })

  it('rowNumbers: false puts the frozen offsets back at 0 and the table width back to the columns alone', () => {
    const { el } = mount(`${FLAT}    frozenColumns: 2\n    rowNumbers: false\n`)
    const header = [...el.querySelectorAll<HTMLElement>('.view-table thead th')]
    expect(header.map((th) => th.style.left)).toEqual(['0px', '150px'])
    expect(q<HTMLElement>(el, '.view-table').style.width).toBe('300px')
    // the ungrouped summary row has no gutter cell either
    expect(el.querySelectorAll('.view-table tfoot td')).toHaveLength(2)
  })

  it('rowNumbers: true is the same as absent — shown', () => {
    const { el } = mount(`${FLAT}    rowNumbers: true\n`)
    expect(gutters(el)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
  })

  it('sits outside the arrow-key grid and adds exactly one header cell', () => {
    const { el } = mount(FLAT)
    const gutter = q<HTMLTableCellElement>(dataRows(el)[0], 'td.view-table__gutter')
    expect(gutter.hasAttribute('data-cell')).toBe(false)
    expect(gutter.hasAttribute('tabindex')).toBe(false)
    expect(gutter).toBe(dataRows(el)[0].cells[0])
    const ths = [...el.querySelectorAll('.view-table thead th')]
    expect(ths).toHaveLength(2 + 1) // keys.length + 1
    expect(ths[0].textContent).toBe('#')
    expect(ths[0].classList.contains('view-table__gutter')).toBe(true)
    expect(dataRows(el)[0].querySelectorAll('[data-cell]')).toHaveLength(2)
  })
})

describe('declared columns show by default (YAZ-1549)', () => {
  const NO_ORDER = `views:
  - type: table
    name: T
`
  it('a newborn page with no members and no order already carries its declared Status header', () => {
    const folderPage = testFolderPage({ settings: { columns: { status: { kind: 'select', options: ['1-Backlog'] } }, views: [], problems: [] } })
    const { el } = mount(NO_ORDER, { records: [], folderPage })
    const headers = [...el.querySelectorAll('thead th:not(.view-table__gutter)')].map((th) => th.textContent?.trim())
    expect(headers).toEqual(['Name', 'Status'])
  })

  it('a declared key a member also carries is one column, not two', () => {
    const folderPage = testFolderPage({ settings: { columns: { status: { kind: 'text' } }, views: [], problems: [] } })
    const { el } = mount(NO_ORDER, { folderPage })
    const headers = [...el.querySelectorAll('thead th:not(.view-table__gutter)')].map((th) => th.textContent?.trim())
    expect(headers.filter((h) => h === 'Status')).toHaveLength(1)
  })
})
