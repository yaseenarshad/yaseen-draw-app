/**
 * Header drag-to-reorder (YAZ-1548): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`;
 * a property `<th>` drags, the hovered header shows the slot on its left or right half, and the
 * drop is ONE `view.order` write through the shared `setViewOrder` — the Properties list's own
 * writer — so `frozenColumns` follows positionally exactly as it does there. The `#` gutter is
 * neither source nor target, the resize grip never starts a drag, a self-drop writes nothing, and
 * Esc cancels. Same synthetic-drag harness as `GroupDrag.test.tsx` and the Properties reorder
 * tests: `MouseEvent`s carry the pointer, `dataTransfer` is absent and guarded.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { propertyKeys } from '../engine'
import { type ParsedViews, type ViewSet, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const FOLDER_PAGE = testFolderPage()

const BASE = `views:
  - type: table
    name: T
    order:
      - file.name
      - note.status
      - note.priority
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = BASE, props: Partial<ViewsPaneProps> = {}) {
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
  return { el: container, onChange, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
}

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

/** A synthetic drag event: jsdom has no `DragEvent`, so a `MouseEvent` carries the pointer and `dataTransfer` is absent. */
function fire(target: Element, type: string, clientX = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX })
  act(() => void target.dispatchEvent(event))
  draw()
  return event
}

function pressEscape(): void {
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  draw()
}

/** The property headers (the `#` gutter excluded), in order. */
const ths = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')]
const headers = (el: ParentNode): string[] => ths(el).map((t) => t.textContent ?? '')
const gutter = (el: ParentNode): HTMLElement => q(el, '.view-table thead th.view-table__gutter')
/** Left half of a header (jsdom rects sit at 0): the slot BEFORE it; right half: AFTER it. */
const LEFT = -5
const RIGHT = 5

// ---------- tests ----------

describe('header drag-to-reorder (YAZ-1548)', () => {
  it('property headers are draggable; the # gutter is not', () => {
    const { el } = mount()
    for (const th of ths(el)) expect(th.getAttribute('draggable')).toBe('true')
    expect(gutter(el).getAttribute('draggable')).not.toBe('true')
  })

  it('moves a column RIGHT: dropping on the right half of a later header lands after it, in ONE write', () => {
    const { el, onChange, def, yaml } = mount()
    fire(ths(el)[0], 'dragstart')
    expect(ths(el)[0].classList.contains('view-table__th--drag-source')).toBe(true)
    fire(ths(el)[2], 'dragover', RIGHT)
    expect(ths(el)[2].classList.contains('view-table__th--insert-after')).toBe(true) // the end slot
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['note.status', 'note.priority', 'file.name'])
    expect(headers(el)).toEqual(['Status', 'Priority', 'Name'])
    expect(yaml()).toContain('- note.status\n      - note.priority\n      - file.name')
    expect(el.querySelector('[class*="view-table__th--"]')).toBeNull() // indicators cleared
  })

  it('moves a column LEFT: dropping on the left half of an earlier header lands before it', () => {
    const { el, onChange, def } = mount()
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', LEFT)
    expect(ths(el)[0].classList.contains('view-table__th--insert-before')).toBe(true)
    fire(ths(el)[0], 'drop', LEFT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
  })

  it('the slot follows the cursor half: right half of the FIRST header is between it and the second', () => {
    const { el, def } = mount()
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'dragover', RIGHT)
    expect(ths(el)[1].classList.contains('view-table__th--insert-before')).toBe(true)
    fire(ths(el)[0], 'drop', RIGHT)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
  })

  it('INTO the frozen prefix: the prefix is positional (YAZ-1007), so the column dropped into it freezes and the one pushed out thaws', () => {
    const { el, def } = mount(`${BASE}    frozenColumns: 1\n`)
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, false, false])
    fire(ths(el)[2], 'dragstart')
    fire(ths(el)[0], 'drop', LEFT)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(1)
    expect(headers(el)).toEqual(['Priority', 'Name', 'Status'])
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, false, false])
  })

  it('OUT of the frozen prefix: a frozen header drags too, and the count stays — the next column takes its place in the prefix', () => {
    const { el, def } = mount(`${BASE}    frozenColumns: 2\n`)
    fire(ths(el)[0], 'dragstart')
    fire(ths(el)[2], 'drop', RIGHT)
    expect(def().views[0].order).toEqual(['note.status', 'note.priority', 'file.name'])
    expect(def().views[0].frozenColumns).toBe(2)
    expect(ths(el).map((t) => t.classList.contains('view-table__frozen'))).toEqual([true, true, false])
  })

  it('a self-drop — either half of the grabbed header — writes NOTHING', () => {
    const { el, onChange } = mount()
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[1], 'drop', LEFT)
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[1], 'drop', RIGHT)
    // …and so does a drop that lands the column exactly where it already is
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[0], 'drop', RIGHT) // the slot between 0 and 1 = its own place
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[2], 'drop', LEFT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the # gutter is not a drop target: dragover is not accepted, a drop there writes nothing, and nothing lands before it', () => {
    const { el, onChange } = mount()
    fire(ths(el)[1], 'dragstart')
    const over = fire(gutter(el), 'dragover', RIGHT)
    expect(over.defaultPrevented).toBe(false)
    fire(gutter(el), 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
    expect(gutter(el).className).not.toContain('view-table__th--')
    // the leftmost slot is BEFORE the first property header — still after the gutter
    fire(ths(el)[0], 'drop', LEFT)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(headers(el)).toEqual(['Status', 'Name', 'Priority'])
    expect(gutter(el).textContent).toBe('#')
  })

  it('the resize grip does not start a drag: a dragstart there is refused and nothing later drops', () => {
    const { el, onChange } = mount()
    const grip = q<HTMLElement>(ths(el)[0], '.view-table__resize')
    const start = fire(grip, 'dragstart')
    expect(start.defaultPrevented).toBe(true)
    expect(el.querySelector('.view-table__th--drag-source')).toBeNull()
    const over = fire(ths(el)[2], 'dragover', RIGHT)
    expect(over.defaultPrevented).toBe(false)
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Esc cancels an in-flight drag: the indicator clears and a later drop writes nothing', () => {
    const { el, onChange } = mount()
    fire(ths(el)[0], 'dragstart')
    fire(ths(el)[2], 'dragover', RIGHT)
    expect(el.querySelector('.view-table__th--insert-after')).not.toBeNull()
    pressEscape()
    expect(el.querySelector('[class*="view-table__th--"]')).toBeNull()
    fire(ths(el)[2], 'drop', RIGHT)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a view with NO explicit order writes the full current keys list in the new order — what the Properties list does on its first reorder', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n')
    expect(def().views[0].order).toBeUndefined()
    const before = propertyKeys(def(), def().views[0], TEST_RECORDS)
    expect(before[0]).toBe('file.name')
    expect(before.length).toBeGreaterThan(3)
    fire(ths(el)[1], 'dragstart')
    fire(ths(el)[0], 'drop', LEFT)
    const [first, second, ...rest] = before
    expect(def().views[0].order).toEqual([second, first, ...rest])
  })

  it('keyboard navigation, resize and the header menu keep working around the drag wiring', () => {
    const { el, def } = mount()
    // resize still writes columnSize through mouseup, untouched by the drag handlers
    const grip = q<HTMLElement>(ths(el)[1], '.view-table__resize')
    act(() => void grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 })))
    act(() => void window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 130 })))
    act(() => void window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 130 })))
    draw()
    expect(def().views[0].columnSize).toEqual({ 'note.status': 180 })
    // arrow keys still walk the data cells
    const cell = q<HTMLElement>(el, '[data-cell="0:0"]')
    act(() => cell.focus())
    act(() => void cell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(document.activeElement?.getAttribute('data-cell')).toBe('0:1')
    // the header menu still opens on right-click
    act(() => void ths(el)[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    draw()
    expect(el.querySelector('.ctx-menu')).not.toBeNull()
  })
})
