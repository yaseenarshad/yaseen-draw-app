import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SortMenu } from './SortMenu'
import type { Mutate, SortSpec, ViewSet, ViewDef } from '../viewSchema'
import type { FolderPageSettings } from '../folderPageSettings'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined
const INITIAL: SortSpec[] = [
  { property: 'note.status', direction: 'DESC' },
  { property: 'file.name', direction: 'ASC' },
  { property: 'note.priority', direction: 'DESC' },
]

function mount(view: ViewDef = { name: 'Table', type: 'table', sort: structuredClone(INITIAL) }, folderPage?: FolderPageSettings, records = TEST_RECORDS) {
  let def: ViewSet = { views: [view] }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const onUpdate = vi.fn<Mutate>((mutate) => {
    def = structuredClone(def)
    mutate(def)
    render()
  })
  const render = () => root!.render(<SortMenu def={def} view={def.views[0]} viewIndex={0} records={records} onUpdate={onUpdate} folderPage={folderPage} />)
  act(render)
  const el = container
  const grip = (index: number, label: string) => el.querySelector<HTMLButtonElement>(`[aria-label="Reorder sort ${index}: ${label}"]`)!
  const replace = (sort: SortSpec[]) => act(() => {
    def = { ...def, views: [{ ...def.views[0], sort: structuredClone(sort) }] }
    render()
  })
  return { el, grip, replace, onUpdate, sort: () => def.views[0].sort!, view: () => def.views[0] }
}

function drag(target: HTMLElement, type: string, clientY = 0) {
  act(() => { target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })) })
}
function press(target: HTMLElement, key: string) {
  act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key })) })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('SortMenu external settings refresh', () => {
  it('discards an in-flight drag after changed sort settings arrive, then reorders the replacement safely', () => {
    const { el, grip, replace, sort, onUpdate } = mount()
    drag(grip(1, 'Status'), 'dragstart')
    drag(grip(3, 'Priority').closest('li')!, 'dragover', 5)
    expect(el.querySelector('.view-prop--dragging')).not.toBeNull()
    const replacement: SortSpec[] = [
      { property: 'note.priority', direction: 'ASC' },
      { property: 'file.name', direction: 'DESC' },
    ]
    replace(replacement)
    expect(el.querySelector('.view-prop--dragging, .view-prop--insert-after')).toBeNull()
    drag(grip(2, 'Name').closest('li')!, 'drop', 5)
    expect(onUpdate).not.toHaveBeenCalled()
    expect(sort()).toEqual(replacement)

    const last = grip(2, 'Name')
    last.focus()
    press(last, 'ArrowUp')
    expect(sort()).toEqual([replacement[1], replacement[0]])
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(grip(1, 'Name'))
  })

  it('retains rule DOM identity and focused control across an equivalent freshly parsed sort array', () => {
    const { grip, replace, sort, onUpdate } = mount()
    const focused = grip(2, 'Name')
    const row = focused.closest('li')
    focused.focus()
    replace(INITIAL)
    expect(grip(2, 'Name')).toBe(focused)
    expect(grip(2, 'Name').closest('li')).toBe(row)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).not.toHaveBeenCalled()

    press(focused, 'ArrowDown')
    expect(sort()).toEqual([INITIAL[0], INITIAL[2], INITIAL[1]])
    expect(grip(3, 'Name')).toBe(focused)
    expect(document.activeElement).toBe(focused)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})


describe('Board option group direction', () => {
  const folder: FolderPageSettings = { columns: { status: { kind: 'select', options: ['Z', 'A'], optionSort: 'ascending' }, tags: { kind: 'multi-select', options: ['B', 'A'] } }, views: [], problems: [] }
  it('labels select grouping as option order and its reversal without changing stored direction semantics', () => {
    const { el, onUpdate } = mount({ name: 'Board', type: 'board', groupBy: [{ property: 'note.status' }, { property: 'note.tags', direction: 'DESC' }] }, folder)
    const outer = el.querySelector<HTMLButtonElement>('[aria-label="Group direction"]')!
    const inner = el.querySelector<HTMLButtonElement>('[aria-label="Then group direction"]')!
    expect(outer.textContent).toBe('Option order')
    expect(inner.textContent).toBe('Reversed option order')
    act(() => outer.click())
    expect(outer.textContent).toBe('Reversed option order')
    act(() => inner.click())
    expect(inner.textContent).toBe('Option order')
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
  it('keeps ASC/DESC labels for ordinary text groups and non-Board views', () => {
    const { el } = mount({ name: 'Board', type: 'board', groupBy: { property: 'note.other', direction: 'DESC' } }, folder)
    expect(el.querySelector('[aria-label="Group direction"]')?.textContent).toBe('DESC')
  })
})


it('offers a declared-only property for Board grouping with zero records', () => {
  const folder: FolderPageSettings = { columns: { Stage: { kind: 'select', options: ['Inbox', 'Ready'] } }, views: [{ type: 'table', name: 'Table', order: ['note.Stage'] }], problems: [] }
  const { el, view } = mount({ type: 'board', name: 'Board' }, folder, [])
  act(() => el.querySelector<HTMLButtonElement>('[aria-label="Group by"]')!.click())
  const choice = el.querySelector<HTMLButtonElement>('[role="option"][data-value="note.Stage"]')
  expect(choice).not.toBeNull()
  act(() => choice!.click())
  expect(view().groupBy).toEqual({ property: 'note.Stage', direction: 'ASC' })
  expect(el.querySelector('[aria-label="Group direction"]')?.textContent).toBe('Option order')
})
