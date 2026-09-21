/**
 * Per-level group actions in the nested table (YAZ-745 / YAZ-1101): drag and the header "+"
 * work at whichever level the user acts on, and a row always LANDS WHERE IT WAS DROPPED —
 * the 🔒 decision: a drop into an inner group under a DIFFERENT outer writes BOTH properties
 * from the target group; the seed of an inner "+" carries both for the same reason. A level
 * whose property is not `note.*` (a formula outer) shows summaries but disables its own
 * "+"/drag while the other level's actions keep working. Fan-out D3/D4 hold at the inner
 * level. `writeProperty` mocked, the folder page's `create` spied, per the sibling files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import type { NewNoteSeed } from '../newNote'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
import { writeProperties, writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)
const writeMany = vi.mocked(writeProperties)
const create = vi.fn<(seed: NewNoteSeed, name?: string) => Promise<string>>()
const seed = (n = 0): Record<string, unknown> => create.mock.calls[n][0].properties

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const NESTED_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
    groupBy:
      - property: note.dept
      - property: note.proc
`

const NESTED_BOARD = NESTED_TABLE.replace('type: table', 'type: board').replace('name: T', 'name: B')

/** A formula outer over the same data: the outer level cannot be written, the inner can. */
const FORMULA_OUTER_TABLE = `formulas:
  top: dept
views:
  - type: table
    name: T
    order:
      - file.name
    groupBy:
      - property: formula.top
      - property: note.proc
`

const FORMULA_OUTER_BOARD = FORMULA_OUTER_TABLE.replace('type: table', 'type: board').replace('name: T', 'name: B')

const rec = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  properties,
})

const NESTED_RECORDS: IndexRecord[] = [
  rec('alpha1', { dept: 'A', proc: 'p1' }),
  rec('alpha2', { dept: 'A', proc: 'p2' }),
  rec('beta1', { dept: 'B', proc: 'p1' }),
]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  let records: IndexRecord[] = NESTED_RECORDS
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
          root={null}
          thisFile={null}
          records={records}
          folderPage={testFolderPage({ create })}
          onOpenFile={vi.fn()}
          {...props}
        />,
      ),
    )
  draw()
  return {
    el: container,
    setRecords: (next: IndexRecord[]) => {
      records = next
      draw()
    },
  }
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
  writeMany.mockReset()
  writeMany.mockResolvedValue({ mtime: 1 })
  create.mockReset()
  create.mockResolvedValue('/vault/Untitled.md')
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

/** Drag events bubble like the real thing; jsdom has no DragEvent, the handlers guard `dataTransfer`. */
function fire(el: Element, type: string): void {
  act(() => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })))
  draw()
}

async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

function rowOf(el: ParentNode, name: string): HTMLElement {
  const btn = [...el.querySelectorAll<HTMLElement>('.view-table__link')].find((b) => b.textContent === name)
  const tr = btn?.closest<HTMLElement>('tr')
  if (!tr) throw new Error(`missing row ${name}`)
  return tr
}

function cardOf(el: ParentNode, name: string): HTMLElement {
  const btn = [...el.querySelectorAll<HTMLElement>('.view-board__title')].find((candidate) => candidate.textContent === name)
  const card = btn?.closest<HTMLElement>('.view-board__card')
  if (!card) throw new Error(`missing card ${name}`)
  return card
}

/** All section header rows for a label, in document order (inner labels repeat across outers). */
const headersOf = (el: ParentNode, label: string): HTMLElement[] =>
  [...el.querySelectorAll<HTMLElement>('tr.view-table__group')].filter(
    (x) => x.querySelector('.view-group__value')?.textContent === label,
  )

/** Nested table as `{ 'Outer': [direct rows], 'Outer/Inner': [rows] }`, in document order. */
function nestedSections(el: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let outer = ''
  let current = ''
  for (const tr of el.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('view-table__group')) {
      const label = q(tr, '.view-group__value').textContent ?? ''
      const nested = q(tr, 'td').classList.contains('view-table__group-cell--nested')
      if (nested) current = `${outer}/${label}`
      else outer = current = label
      out[current] = []
    } else if (!tr.classList.contains('view-table__spacer')) {
      out[current]?.push(q(tr, '.view-table__link').textContent ?? '')
    }
  }
  return out
}

describe('drag at each level (YAZ-1101)', () => {
  it('a Board drop between inner groups under the same outer writes the inner property only', () => {
    const { el } = mount(NESTED_BOARD)
    fire(cardOf(el, 'alpha1'), 'dragstart')
    fire(cardOf(el, 'alpha2'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/alpha1.md', 'proc', 'p2')
  })

  it('a Board cross-outer inner drop writes each property once without bubbling into the outer target', () => {
    const { el } = mount(NESTED_BOARD)
    fire(cardOf(el, 'alpha2'), 'dragstart')
    fire(cardOf(el, 'beta1'), 'drop')
    expect(writeMany).toHaveBeenCalledExactlyOnceWith('/vault/alpha2.md', [
      { key: 'proc', value: 'p1', prevRaw: 'p2' },
      { key: 'dept', value: 'B', prevRaw: 'A' },
    ])
    expect(write).not.toHaveBeenCalled()
  })

  it('a drop between inner groups under the same outer writes the inner property only', () => {
    const { el } = mount(NESTED_TABLE)
    fire(rowOf(el, 'alpha1'), 'dragstart')
    fire(rowOf(el, 'alpha2'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/alpha1.md', 'proc', 'p2')
    expect(nestedSections(el)['A/p2']).toContain('alpha1')
  })

  it('🔒 a drop into an inner group under a DIFFERENT outer writes BOTH properties and lands there', async () => {
    const { el, setRecords } = mount(NESTED_TABLE)
    fire(rowOf(el, 'alpha2'), 'dragstart')
    fire(rowOf(el, 'beta1'), 'drop')
    expect(writeMany).toHaveBeenCalledExactlyOnceWith('/vault/alpha2.md', [
      { key: 'proc', value: 'p1', prevRaw: 'p2' },
      { key: 'dept', value: 'B', prevRaw: 'A' },
    ])
    expect(write).not.toHaveBeenCalled()
    // optimistic: already under B/p1, and it stays put through resolve + refetch
    expect(nestedSections(el)['B/p1']).toContain('alpha2')
    await flush()
    expect(nestedSections(el)['B/p1']).toContain('alpha2')
    setRecords(NESTED_RECORDS.map((r) => (r.basename === 'alpha2' ? { ...r, properties: { dept: 'B', proc: 'p1' } } : r)))
    expect(nestedSections(el)['B/p1']).toContain('alpha2')
    expect(writeMany).toHaveBeenCalledTimes(1)
  })

  it('a drop on an outer header writes the outer property only; the inner value rides along', () => {
    const { el } = mount(NESTED_TABLE)
    fire(rowOf(el, 'beta1'), 'dragstart')
    fire(headersOf(el, 'A')[0], 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/beta1.md', 'dept', 'A')
    expect(nestedSections(el)['A/p1']).toContain('beta1')
  })

  it('inner fan-out keeps D3: a drop swaps the element it left for the one it entered', () => {
    const records = [rec('both', { dept: 'A', proc: ['p1', 'p2'] }), rec('one', { dept: 'A', proc: ['p1'] })]
    const { el } = mount(NESTED_TABLE, { records })
    fire(rowOf(el, 'one'), 'dragstart')
    fire(headersOf(el, 'p2')[0], 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/one.md', 'proc', ['p2'])
  })
})

describe('the header "+" at each level (YAZ-1101)', () => {
  it('a Board inner "+" seeds BOTH properties through the same level-aware create contract', () => {
    const { el } = mount(NESTED_BOARD)
    const plus = [...el.querySelectorAll<HTMLElement>('[aria-label="New note in group p1"]')]
    expect(plus).toHaveLength(2)
    act(() => plus[1].click()) // B's p1
    draw()
    expect(seed()).toEqual({ proc: 'p1', dept: 'B' })
  })

  it('an inner "+" seeds BOTH properties so the note lands where the user clicked', () => {
    const { el } = mount(NESTED_TABLE)
    const plus = [...el.querySelectorAll<HTMLElement>('[aria-label="New note in group p1"]')]
    expect(plus).toHaveLength(2)
    act(() => plus[1].click()) // B's p1
    draw()
    expect(seed()).toEqual({ proc: 'p1', dept: 'B' })
  })

  it('an outer "+" seeds the outer property only', () => {
    const { el } = mount(NESTED_TABLE)
    act(() => q<HTMLElement>(el, '[aria-label="New note in group A"]').click())
    draw()
    expect(seed()).toEqual({ dept: 'A' })
  })

  it('inner fan-out keeps D4: the inner seed is that group\'s own element, plus the outer', () => {
    const records = [rec('both', { dept: 'A', proc: ['p1', 'p2'] })]
    const { el } = mount(NESTED_TABLE, { records })
    act(() => q<HTMLElement>(el, '[aria-label="New note in group p2"]').click())
    draw()
    expect(seed()).toEqual({ proc: ['p2'], dept: 'A' })
  })
})

describe('a formula level disables its own actions only (YAZ-1101)', () => {
  it('a Board formula outer has no add/drop action while its writable child level keeps both', () => {
    const { el } = mount(FORMULA_OUTER_BOARD)
    const outerA = [...el.querySelectorAll<HTMLElement>('.view-board__col-header')].find(
      (header) => header.querySelector('.view-group__value')?.textContent === 'A',
    )
    if (outerA === undefined) throw new Error('missing outer A')
    expect(outerA.querySelector('[aria-label^="New note"]')).toBeNull()
    expect(el.querySelector('.view-board__subgroup [aria-label="New note in group p1"]')).not.toBeNull()

    fire(cardOf(el, 'alpha2'), 'dragstart')
    fire(cardOf(el, 'beta1'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/alpha2.md', 'proc', 'p1')
  })

  it('the outer has no "+" and rejects drops; inner drag still writes, without the outer', () => {
    const { el } = mount(FORMULA_OUTER_TABLE)
    // outer headers (A, B) carry no "+"; inner headers (p1, p2) keep theirs
    expect(headersOf(el, 'A')[0].querySelector('[aria-label^="New note"]')).toBeNull()
    expect(headersOf(el, 'p1')[0].querySelector('[aria-label^="New note"]')).not.toBeNull()

    fire(rowOf(el, 'beta1'), 'dragstart')
    fire(headersOf(el, 'A')[0], 'drop')
    expect(write).not.toHaveBeenCalled()

    // cross-outer inner drop: only the writable (inner) property is written
    fire(rowOf(el, 'alpha2'), 'dragstart')
    fire(rowOf(el, 'beta1'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/alpha2.md', 'proc', 'p1')
  })

  it('an inner "+" under a formula outer seeds the inner property alone', () => {
    const { el } = mount(FORMULA_OUTER_TABLE)
    act(() => q<HTMLElement>(el, '[aria-label="New note in group p2"]').click())
    draw()
    expect(seed()).toEqual({ proc: 'p2' })
  })
})
