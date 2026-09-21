/**
 * Drag between groups (5C, GRO-2143): ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`, `writeProperty` mocked. Dragging a board card to another column — or a
 * grouped-table row into another section — writes `groupBy.property = <target group value>`
 * with the target's YAML type preserved (numbers stay numbers, booleans booleans); dropping
 * on "No value" deletes the key. The hovered target shows a placeholder / drop affordance,
 * Esc cancels an in-flight drag, dropping on the own column is a no-op, and the move is
 * optimistic: the card holds its new column until the index refetch delivers the value
 * (5B's clearing discipline), reverting with an inline error when the write fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn(), writeProperties: vi.fn() }))
import { writeProperty, writeProperties } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

const STATUS_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.status
    groupBy:
      property: note.status
`

const PRIORITY_BOARD = STATUS_BOARD.replace('property: note.status', 'property: note.priority')
const PUBLISHED_BOARD = STATUS_BOARD.replace('property: note.status', 'property: note.published')
const FOLDER_BOARD = STATUS_BOARD.replace('property: note.status', 'property: file.folder')

const STATUS_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
`

const FLAT_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.priority
`

const AGENTIC = '/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md'
const GOLD = '/vault/Content Pillars/2. Creator Economy/The Gold In Your Archive.md'

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  let records: IndexRecord[] = TEST_RECORDS
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
          root={null}
          thisFile={null}
          records={records}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return {
    el,
    onChange,
    /** Simulates the watcher-driven index refetch: a fresh records array re-rendered in. */
    setRecords: (next: IndexRecord[]) => {
      records = next
      draw()
    },
  }
}

beforeEach(() => {
  vi.mocked(writeProperties).mockReset().mockResolvedValue({ mtime: 1 })
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

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

function pressEscape(): void {
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  draw()
}

/** Settle the writeProperty promise so success/failure state lands. */
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

const cols = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-board__col')]

/** Board column matching its header value ('No value' for the trailing column). */
function colOf(el: ParentNode, label: string): HTMLElement {
  const c = cols(el).find((x) => q(x, '.view-group__value').textContent === label)
  if (c === undefined) throw new Error(`missing column ${label}`)
  return c
}

const titlesIn = (col: ParentNode): string[] => [...col.querySelectorAll('.view-board__title')].map((b) => b.textContent ?? '')

/** Board card by its title text. */
function cardOf(el: ParentNode, title: string): HTMLElement {
  const btn = [...el.querySelectorAll<HTMLElement>('.view-board__title')].find((b) => b.textContent === title)
  const card = btn?.closest<HTMLElement>('.view-board__card')
  if (!card) throw new Error(`missing card ${title}`)
  return card
}

/** Grouped table as `{ 'group label': [row names] }`, in document order. */
function tableSections(el: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current = ''
  for (const tr of el.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('view-table__group')) {
      current = q(tr, '.view-group__value').textContent ?? ''
      out[current] = []
    } else if (!tr.classList.contains('view-table__spacer')) {
      out[current]?.push(q(tr, '.view-table__link').textContent ?? '')
    }
  }
  return out
}

/** Grouped table row by its name-cell text. */
function rowOf(el: ParentNode, name: string): HTMLElement {
  const btn = [...el.querySelectorAll<HTMLElement>('.view-table__link')].find((b) => b.textContent === name)
  const tr = btn?.closest<HTMLElement>('tr')
  if (!tr) throw new Error(`missing row ${name}`)
  return tr
}

/** The section header row for a group label. */
function headerOf(el: ParentNode, label: string): HTMLElement {
  const tr = [...el.querySelectorAll<HTMLElement>('tr.view-table__group')].find(
    (x) => x.querySelector('.view-group__value')?.textContent === label,
  )
  if (!tr) throw new Error(`missing section ${label}`)
  return tr
}

// ---------- tests ----------

describe('board drag between columns', () => {
  it('drop on another column writes the groupBy property and moves the card optimistically without flashing back', async () => {
    const { el, setRecords } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    fire(colOf(el, 'drafting'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'drafting')
    // optimistic: the card is already in the target column
    expect(titlesIn(colOf(el, 'drafting'))).toContain('Agentic Agency')
    expect(titlesIn(colOf(el, 'idea'))).not.toContain('Agentic Agency')
    // the write resolving does NOT clear the optimistic value — only the fresh index does
    await flush()
    expect(titlesIn(colOf(el, 'drafting'))).toContain('Agentic Agency')
    // the watcher-driven refetch delivers the new value; the card stays put
    setRecords(
      TEST_RECORDS.map((r) => (r.path === AGENTIC ? { ...r, properties: { ...r.properties, status: 'drafting' } } : r)),
    )
    expect(titlesIn(colOf(el, 'drafting'))).toContain('Agentic Agency')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('the hovered column shows the drop affordance and placeholder; the own column never does', () => {
    const { el } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    fire(colOf(el, 'drafting'), 'dragover')
    expect(colOf(el, 'drafting').className).toContain('view-board__col--drop')
    expect(colOf(el, 'drafting').querySelector('.view-board__placeholder')).not.toBeNull()
    fire(colOf(el, 'drafting'), 'dragleave')
    expect(colOf(el, 'drafting').className).not.toContain('view-board__col--drop')
    expect(el.querySelector('.view-board__placeholder')).toBeNull()
    // dragging over the card's own column is not a drop target
    fire(colOf(el, 'idea'), 'dragover')
    expect(colOf(el, 'idea').className).not.toContain('view-board__col--drop')
    expect(el.querySelector('.view-board__placeholder')).toBeNull()
  })

  it('preserves the YAML type of the target group value: numbers stay numbers, booleans booleans', () => {
    const { el } = mount(PRIORITY_BOARD)
    fire(cardOf(el, 'The Gold In Your Archive'), 'dragstart')
    fire(colOf(el, '3'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith(GOLD, 'priority', 3)

    act(() => root?.unmount())
    container?.remove()
    write.mockClear()
    const published = mount(PUBLISHED_BOARD)
    fire(cardOf(published.el, 'Agentic Agency'), 'dragstart')
    fire(colOf(published.el, 'true'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'published', true)
  })

  it('drop on the No value column deletes the key', () => {
    const { el } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    fire(colOf(el, 'No value'), 'drop')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]).toEqual([AGENTIC, 'status', undefined])
    expect(titlesIn(colOf(el, 'No value'))).toContain('Agentic Agency')
  })

  it('Esc cancels an in-flight drag: no write, no affordance', () => {
    const { el } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    pressEscape()
    fire(colOf(el, 'drafting'), 'dragover')
    expect(el.querySelector('.view-board__placeholder')).toBeNull()
    fire(colOf(el, 'drafting'), 'drop')
    expect(write).not.toHaveBeenCalled()
    expect(titlesIn(colOf(el, 'idea'))).toContain('Agentic Agency')
  })

  it('dropping on the own column is a no-op', () => {
    const { el } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    fire(colOf(el, 'idea'), 'drop')
    expect(write).not.toHaveBeenCalled()
    expect(titlesIn(colOf(el, 'idea'))).toContain('Agentic Agency')
  })

  it('a failed write reverts the optimistic move and shows the inline error on the card', async () => {
    write.mockRejectedValueOnce(new Error('disk on fire'))
    const { el } = mount(STATUS_BOARD)
    fire(cardOf(el, 'Agentic Agency'), 'dragstart')
    fire(colOf(el, 'drafting'), 'drop')
    expect(titlesIn(colOf(el, 'drafting'))).toContain('Agentic Agency') // optimistic
    await flush()
    expect(titlesIn(colOf(el, 'idea'))).toContain('Agentic Agency') // reverted
    const err = q<HTMLElement>(cardOf(el, 'Agentic Agency'), '[role="alert"]')
    expect(err.title).toBe('disk on fire')
  })

  it('cards are not draggable when the grouping is not a note property', () => {
    const { el } = mount(FOLDER_BOARD)
    expect(cardOf(el, 'VSL-v1').getAttribute('draggable')).not.toBe('true')
    fire(cardOf(el, 'VSL-v1'), 'dragstart')
    fire(colOf(el, 'Content Pillars'), 'drop')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('grouped table drag between sections', () => {
  it('drop on another section writes the property and moves the row optimistically', () => {
    const { el } = mount(STATUS_TABLE)
    expect(rowOf(el, 'Agentic Agency').getAttribute('draggable')).toBe('true')
    fire(rowOf(el, 'Agentic Agency'), 'dragstart')
    // hovering the section (header or one of its rows) highlights it
    fire(headerOf(el, 'drafting'), 'dragover')
    expect(headerOf(el, 'drafting').className).toContain('view-table__group--drop')
    fire(headerOf(el, 'drafting'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'drafting')
    expect(tableSections(el).drafting).toContain('Agentic Agency')
    expect(tableSections(el).idea).not.toContain('Agentic Agency')
    expect(headerOf(el, 'drafting').className).not.toContain('view-table__group--drop')
  })

  it('dropping on a data row of another section targets that row´s section; No value deletes', () => {
    const { el } = mount(STATUS_TABLE)
    fire(rowOf(el, 'Agentic Agency'), 'dragstart')
    fire(rowOf(el, 'Attribution'), 'drop') // Attribution sits in No value
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]).toEqual([AGENTIC, 'status', undefined])
    expect(tableSections(el)['No value']).toContain('Agentic Agency')
  })

  it('rows of an ungrouped table are not draggable', () => {
    const { el } = mount(FLAT_TABLE)
    expect(rowOf(el, 'Agentic Agency').getAttribute('draggable')).not.toBe('true')
  })
})

// ---------- Fan-out: swap semantics (YAZ-671 D3) ----------

/** A record whose grouping property is a LIST, so the engine fans it out across groups. */
const listRec = (name: string, status: unknown): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  properties: { status },
})

describe('drag between fanned-out groups (YAZ-671 D3)', () => {
  it('a drop SWAPS: the source element goes, the target arrives, the rest survive', () => {
    const records = [listRec('both', ['a', 'b']), listRec('onlyC', ['c'])]
    const { el } = mount(STATUS_BOARD, { records })
    // 'both' is in column a AND column b — that is the fan-out working
    expect(titlesIn(colOf(el, 'a'))).toEqual(['both'])
    expect(titlesIn(colOf(el, 'b'))).toEqual(['both'])

    // drag the card OUT OF column a INTO column c
    fire(cardOf(colOf(el, 'a'), 'both'), 'dragstart')
    fire(colOf(el, 'c'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/both.md', 'status', ['b', 'c'])
  })

  it('dragging the SAME card out of its other group removes that element instead', () => {
    const records = [listRec('both', ['a', 'b']), listRec('onlyC', ['c'])]
    const { el } = mount(STATUS_BOARD, { records })
    fire(cardOf(colOf(el, 'b'), 'both'), 'dragstart')
    fire(colOf(el, 'c'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/both.md', 'status', ['a', 'c'])
  })

  it('a drop on "No value" removes only the dragged-from element, never the whole key', () => {
    const records = [listRec('both', ['a', 'b']), listRec('none', [])]
    const { el } = mount(STATUS_BOARD, { records })
    fire(cardOf(colOf(el, 'a'), 'both'), 'dragstart')
    fire(colOf(el, 'No value'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/both.md', 'status', ['b'])
  })

  it('a card dragged OUT of "No value" gains the target element', () => {
    const records = [listRec('empty', []), listRec('onlyA', ['a'])]
    const { el } = mount(STATUS_BOARD, { records })
    fire(cardOf(colOf(el, 'No value'), 'empty'), 'dragstart')
    fire(colOf(el, 'a'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/empty.md', 'status', ['a'])
  })

  it('link elements swap by exact target, matching how the engine grouped them (YAZ-673 Q1)', () => {
    const records = [listRec('spans', ['[[Lead Gen]]', '[[Sales]]']), listRec('other', ['[[Nurture]]'])]
    const { el } = mount(STATUS_BOARD, { records })
    // a link group header renders the bare target as a chip, not the `[[…]]` source
    fire(cardOf(colOf(el, 'Lead Gen'), 'spans'), 'dragstart')
    fire(colOf(el, 'Nurture'), 'drop')
    expect(write).toHaveBeenCalledExactlyOnceWith('/vault/spans.md', 'status', ['[[Sales]]', '[[Nurture]]'])
  })

  it('dropping on the card\'s own group stays a no-op', () => {
    const records = [listRec('both', ['a', 'b'])]
    const { el } = mount(STATUS_BOARD, { records })
    fire(cardOf(colOf(el, 'a'), 'both'), 'dragstart')
    fire(colOf(el, 'a'), 'drop')
    expect(write).not.toHaveBeenCalled()
  })
})


it('drops onto an unused Select option by writing its exact declared label', async () => {
  const { el } = mount(STATUS_BOARD.replace('    name: B', '    name: B\n    showEmptyColumns: true'), {
    folderPage: testFolderPage({ settings: { columns: { status: { kind: 'select', options: ['idea', 'Waiting: review'] } }, views: [], problems: [] } }),
  })
  expect(titlesIn(colOf(el, 'Waiting: review'))).toEqual([])
  fire(cardOf(colOf(el, 'idea'), 'Agentic Agency'), 'dragstart')
  fire(colOf(el, 'Waiting: review'), 'drop')
  expect(write).toHaveBeenCalledExactlyOnceWith(AGENTIC, 'status', 'Waiting: review')
  await flush()
  expect(titlesIn(colOf(el, 'Waiting: review'))).toContain('Agentic Agency')
})


it('drops into an empty nested group with an array value for its unused Multi-select outer option', async () => {
  const board = `views:
  - type: board
    name: Nested
    showEmptyColumns: true
    order: [file.name]
    groupBy:
      - property: note.status
      - property: note.phase
`
  const { el } = mount(board, {
    records: [{ ...TEST_RECORDS[0], properties: { status: ['Doing'], phase: 'Draft' } }],
    folderPage: testFolderPage({ settings: {
      columns: { status: { kind: 'multi-select', options: ['Doing', 'Later'] }, phase: { kind: 'select', options: ['Draft', 'Review'] } },
      views: [], problems: [],
    } }),
  })
  const later = colOf(el, 'Later')
  const target = [...later.querySelectorAll<HTMLElement>('.view-board__subgroup')].find(group => q(group, '.view-group__value').textContent === 'Review')!
  expect(target).toBeDefined()
  fire(cardOf(colOf(el, 'Doing'), 'Agentic Agency'), 'dragstart')
  fire(target, 'drop')
  expect(write).not.toHaveBeenCalled()
  expect(writeProperties).toHaveBeenCalledExactlyOnceWith(AGENTIC, [
    { key: 'phase', value: 'Review', prevRaw: 'Draft' },
    { key: 'status', value: ['Later'], prevRaw: ['Doing'] },
  ])
  await flush()
  expect(titlesIn(colOf(el, 'Later'))).toContain('Agentic Agency')
})
