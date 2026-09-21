/**
 * View chrome (GRO-2135): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS` and
 * Yasin's base. `onChange` is a spy that swaps in the new `ParsedViews` and re-renders, so every
 * assertion can read the YAML the file would get (`serializeViews`) next to the DOM.
 *
 * YAZ-846: the mount is a FOLDER PAGE's contents block, because that is the only mount there is.
 * Two consequences run through this file — the **Filter** menu edits THIS view's `filters` and
 * nothing else (D1, YAZ-1227: a folder page's set IS the lookup, 🔒 Q3), and the tabs are
 * EDITABLE again since YAZ-1471 re-ruled 🔒 rule 4 (YAZ-819): the drag-to-reorder half is
 * pinned below, and every gesture there is ONE `update` — the same door as sort and columns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ViewSet, type ViewDef, type ParsedViews, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import type { ColumnDecl } from '../folderPageSettings'
import { TEST_RECORDS } from '../testRecords'

/** The document skin's editor is a real Crepe instance; the toolbar's own chrome is what is under test. */
vi.mock('./OutlineEditor', () => ({ OutlineEditor: () => null }))

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** Yasin's real base (also pinned in viewSchema.test.ts and engine.test.ts). */
const YASIN_BASE = `views:
  - type: table
    name: Table
    order:
      - file.name
    sort:
      - property: formula.Untitled
        direction: ASC
  - type: cards
    name: View
  - type: table
    name: View 2
    indentProperties: false
`

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text = YASIN_BASE, props: Partial<ViewsPaneProps> = {}) {
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
          root={null}
          thisFile={null}
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
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

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  const set = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

/** Choose a column through the real searchable picker, so tests exercise its save boundary. */
function chooseColumn(pop: ParentNode, label: string, value: string): void {
  const trigger = byLabel<HTMLButtonElement>(pop, label)
  if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger)
  const option = [...pop.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.dataset.value === value)
  if (!option) throw new Error(`missing ${label} option ${value}`)
  click(option)
}

/** Choose a column by typing in the picker's search and committing the top match (YAZ-1466). */
function searchColumn(scope: ParentNode, label: string, query: string): void {
  const trigger = byLabel<HTMLButtonElement>(scope, label)
  if (trigger.getAttribute('aria-expanded') !== 'true') click(trigger)
  const input = q<HTMLInputElement>(scope, '[role="combobox"]')
  setValue(input, query)
  press(input, 'Enter')
}

/** Use the definition panel's type picker rather than the retired inline select. */
function choosePropertyType(pop: ParentNode, label: string): void {
  click(q(pop, '[aria-label^="Property type:"]'))
  click(byText(pop, '[data-type-option]', label))
}

/** Let an immediate declaration write resolve (3D). */
async function settle(): Promise<void> {
  await act(async () => {})
  draw()
}

/**
 * A host that keeps its declarations AHEAD (YAZ-1549), as `FolderPageContents` does: each
 * `setColumn` lands in `settings.columns` at once, so the panel's next `base` is what just landed.
 */
function aheadHost(columns: Record<string, ColumnDecl>) {
  const settings = { columns, views: [], problems: [] }
  const setColumn = vi.fn(async (key: string, next: ColumnDecl) => {
    settings.columns[key] = next
  })
  return { settings, setColumn, folderPage: testFolderPage({ settings, setColumn }) }
}

/** Type into a TextField and commit with Enter (one onChange). */
function type(el: HTMLInputElement, text: string): void {
  setValue(el, text)
  press(el, 'Enter')
}

/** The draggable/scrolling tab is the WRAPPER, not the `[role="tab"]` button it holds. */
const wrap = (el: ParentNode, i: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-tab')][i]
/** A def whose first view is the page's ONE outline document. */
const WITH_OUTLINE = 'views:\n  - type: outline\n    name: Outline\n  - type: table\n    name: Table\n'
const tabs = (el: ParentNode): string[] => [...el.querySelectorAll('[role="tab"]')].map((t) => t.textContent ?? '')
const selected = (el: ParentNode): string | undefined => [...el.querySelectorAll('[role="tab"]')].find((t) => t.getAttribute('aria-selected') === 'true')?.textContent ?? undefined
/** Note links in the body: the table's name cells (4B) or the placeholder list of other view types. */
const rows = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table__link, .view-row__link')].map((b) => b.textContent ?? '')
const count = (el: ParentNode): string => q(el, '.view-toolbar__count').textContent ?? ''
const openMenu = (el: ParentNode, label: string): HTMLElement => {
  click(byLabel(el, label))
  return q(el, '.view-popover')
}

// ---------- tests ----------

describe('view switcher', () => {
  it('renders the tabs, count and the rows of the active view', () => {
    const { el, onChange } = mount()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
    expect(selected(el)).toBe('Table')
    expect(count(el)).toBe('8 items')
    expect(rows(el)).toHaveLength(8)
    expect(rows(el)[0]).toBe('Agentic Agency')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking a tab switches views without writing', () => {
    const { el, onChange } = mount()
    click(byText(el, '[role="tab"]', 'View 2'))
    expect(selected(el)).toBe('View 2')
    expect(onChange).not.toHaveBeenCalled()
  })
})

/**
 * Drag to reorder (YAZ-1471, re-ruling 🔒 rule 4): TabBar's insertion-slot idiom, so these are
 * TabBar.test's assertions on this strip — jsdom rects are all-zero, which reduces the
 * before/after midpoint test to the SIGN of `clientX` (negative = before the tab, else after),
 * and the handlers guard `dataTransfer` because jsdom has no `DragEvent`. A reorder is ONE
 * `update` (the same door as sort and columns); which view is ACTIVE stays session state and
 * simply follows its tab.
 */
describe('view tabs — drag to reorder (YAZ-1471)', () => {
  const strip = (el: ParentNode): HTMLElement => q<HTMLElement>(el, '[role="tablist"]')
  /** The serialized view ORDER, read off the YAML the file would get. */
  const names = (text: string): string[] => [...text.matchAll(/^\s*name: (.+)$/gm)].map((m) => m[1])
  const fire = (target: Element, type: string, clientX = 0): void => {
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX })))
    draw()
  }

  it('dropping on a tab\'s LEFT half inserts before it, in ONE write', () => {
    const { el, onChange, yaml } = mount()
    fire(wrap(el, 1), 'dragstart') // grab "View"
    expect(wrap(el, 1).classList.contains('view-tab--dragging')).toBe(true)
    fire(wrap(el, 0), 'dragover', -5) // left half of "Table"
    expect(wrap(el, 0).classList.contains('view-tab--insert-before')).toBe(true)
    fire(wrap(el, 0), 'drop', -5)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(names(yaml())).toEqual(['View', 'Table', 'View 2'])
    expect(tabs(el)).toEqual(['View', 'Table', 'View 2'])
    expect(el.querySelector('.view-tab--dragging')).toBeNull() // drag state cleared
  })

  it('dropping on the strip\'s empty tail lands the tab LAST (the last tab marks --insert-after)', () => {
    const { el, onChange, yaml } = mount()
    fire(wrap(el, 0), 'dragstart') // grab "Table"
    fire(strip(el), 'dragover') // the tail is a direct hit on the strip = the end slot
    expect(wrap(el, 2).classList.contains('view-tab--insert-after')).toBe(true)
    fire(strip(el), 'drop')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(names(yaml())).toEqual(['View', 'View 2', 'Table'])
    expect(tabs(el)).toEqual(['View', 'View 2', 'Table'])
  })

  it('dropping back on its own slot writes nothing', () => {
    const { el, onChange } = mount()
    fire(wrap(el, 1), 'dragstart')
    fire(wrap(el, 1), 'drop', -5) // before itself = the slot it came from
    expect(onChange).not.toHaveBeenCalled()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
  })

  it('the ACTIVE view follows its tab — past by another, and dragged itself', () => {
    const { el } = mount()
    click(byText(el, '[role="tab"]', 'View 2'))
    expect(selected(el)).toBe('View 2')
    fire(wrap(el, 0), 'dragstart') // "Table" past the active tab, onto the end slot
    fire(strip(el), 'drop')
    expect(tabs(el)).toEqual(['View', 'View 2', 'Table'])
    expect(selected(el)).toBe('View 2')
    fire(wrap(el, 1), 'dragstart') // now the ACTIVE tab itself, to the front
    fire(wrap(el, 0), 'drop', -5)
    expect(tabs(el)).toEqual(['View 2', 'View', 'Table'])
    expect(selected(el)).toBe('View 2')
  })

  it('a tab in RENAME is not draggable — the field owns the pointer', () => {
    const { el } = mount()
    act(() => wrap(el, 0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    draw()
    click(byText(el, '[role="menuitem"]', 'Rename'))
    expect(wrap(el, 0).getAttribute('draggable')).toBe('false')
    expect(wrap(el, 1).getAttribute('draggable')).toBe('true')
  })

  /** TabBar.test's own payload assertion on this strip: a private MIME, never `text/plain`. */
  it('writes a PRIVATE view-tab payload — a text/plain name would paste into the note body', () => {
    const { el } = mount()
    const data = { setData: vi.fn(), effectAllowed: '' } as unknown as DataTransfer
    const event = new MouseEvent('dragstart', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: data })
    act(() => void wrap(el, 1).dispatchEvent(event))
    expect(data.setData).toHaveBeenCalledExactlyOnceWith('application/x-yaseen-view-tab', 'View')
    expect(data.setData).not.toHaveBeenCalledWith('text/plain', expect.anything())
    expect(data.effectAllowed).toBe('move')
  })
})

/**
 * Right-click a tab (YAZ-1471, D2): ONE `ContextMenuSurface` at the cursor offering
 * Rename · Duplicate · Delete, and each one is a single `update` through the door sort and columns
 * already use. Rename is the inline `TextField`, so its `normalize` is the whole rule — an empty
 * name, or one another view already answers to, is REFUSED and the field snaps back with nothing
 * written. Duplicate is a `structuredClone` (the copy carries the original's order, sort and
 * everything else) named by `freeName` and activated; a page has ONE outline document, so an
 * outline view can not be duplicated. Delete asks first, through `ConfirmDeleteView` — and is not
 * offered at all when there is one view left, because `views` can never be empty.
 */
describe('view tabs — right-click menu (YAZ-1471)', () => {
  const ONE_VIEW = 'views:\n  - type: table\n    name: Only\n'
  /** The `.view-tab` WRAPPER carries the handler, not the `[role="tab"]` button inside it. */
  const wrap = (el: ParentNode, name: string): HTMLElement => {
    const w = byText<HTMLElement>(el, '[role="tab"]', name).closest<HTMLElement>('.view-tab')
    if (w === null) throw new Error(`no tab wrapper for ${name}`)
    return w
  }
  const openOn = (el: ParentNode, name: string): HTMLElement => {
    act(() => void wrap(el, name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })))
    draw()
    return q<HTMLElement>(el, '.ctx-menu[role="menu"]')
  }
  const item = (el: ParentNode, text: string): HTMLButtonElement => byText<HTMLButtonElement>(el, '[role="menuitem"]', text)
  /** Open the menu on `name`, pick Rename, and hand back the field it swapped the tab for. */
  const renameField = (el: ParentNode, name: string): HTMLInputElement => {
    click(item(openOn(el, name), 'Rename'))
    return byLabel<HTMLInputElement>(el, 'View name')
  }
  const names = (el: ParentNode, defOf: () => ViewSet): string[] => {
    expect(tabs(el)).toEqual(defOf().views.map((v) => v.name)) // the strip IS the def, always
    return tabs(el)
  }

  it('right-clicking a tab opens Rename · Duplicate · Delete, and opening writes nothing', () => {
    const { el, onChange } = mount()
    const menu = openOn(el, 'Table')
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['Rename', 'Duplicate', 'Delete'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Rename refuses a name another view already answers to — the field snaps back, nothing written', () => {
    const { el, onChange } = mount()
    const field = renameField(el, 'Table')
    expect(field.value).toBe('Table')
    type(field, 'View') // the second tab's name
    expect(onChange).not.toHaveBeenCalled()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
  })

  it('Rename refuses an empty name the same way', () => {
    const { el, onChange } = mount()
    type(renameField(el, 'Table'), '')
    expect(onChange).not.toHaveBeenCalled()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
  })

  it('a free name commits in ONE update, and the YAML carries it', () => {
    const { el, onChange, yaml } = mount()
    type(renameField(el, 'Table'), 'Grid')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('name: Grid')
    expect(tabs(el)).toEqual(['Grid', 'View', 'View 2'])
  })

  it('a BLUR commits that same edit — once, never twice', () => {
    const { el, onChange, yaml } = mount()
    const field = renameField(el, 'Table')
    setValue(field, 'Grid')
    act(() => void field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))) // React maps onBlur onto focusout
    draw()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(yaml()).toContain('name: Grid')
    expect(tabs(el)).toEqual(['Grid', 'View', 'View 2'])
  })

  it('Duplicate clones the view right after it, names it "… copy", and opens it', () => {
    const { el, onChange, def } = mount()
    click(item(openOn(el, 'Table'), 'Duplicate'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(names(el, def)).toEqual(['Table', 'Table copy', 'View', 'View 2'])
    expect(def().views[1]).toEqual({ ...def().views[0], name: 'Table copy' })
    expect(def().views[1].order).toEqual(['file.name']) // the clone is the WHOLE view, not a husk
    expect(def().views[1].sort).toEqual([{ property: 'formula.Untitled', direction: 'ASC' }])
    expect(selected(el)).toBe('Table copy')

    click(item(openOn(el, 'Table'), 'Duplicate')) // `freeName` numbers the next one
    expect(names(el, def)).toEqual(['Table', 'Table copy 2', 'Table copy', 'View', 'View 2'])
  })

  it('Duplicate is disabled for an outline view — a page has ONE document', () => {
    const { el } = mount(WITH_OUTLINE)
    expect(item(openOn(el, 'Outline'), 'Duplicate').disabled).toBe(true)
    expect(item(openOn(el, 'Table'), 'Duplicate').disabled).toBe(false)
  })

  it('Delete is disabled on the last view — `views` can never be empty', () => {
    const { el } = mount(ONE_VIEW)
    expect(item(openOn(el, 'Only'), 'Delete').disabled).toBe(true)
  })

  it('Delete asks first: Escape and a click-away both cancel, and write nothing', () => {
    const { el, onChange } = mount()
    click(item(openOn(el, 'View'), 'Delete'))
    expect(q(el, '[role="dialog"]').getAttribute('aria-modal')).toBe('true')
    expect(q(el, '.confirm__text').textContent).toBe(
      "Delete the view 'View'? Its columns, sort, filters and grouping go with it — the pages themselves stay put.",
    )
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    draw()
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()

    click(item(openOn(el, 'View'), 'Delete'))
    act(() => void q(el, '.confirm-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    draw()
    expect(el.querySelector('[role="dialog"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
  })

  it('confirming Delete is ONE update — and the view you are ON stays selected', () => {
    const { el, onChange, yaml, def } = mount() // active: Table
    click(item(openOn(el, 'View'), 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(names(el, def)).toEqual(['Table', 'View 2'])
    expect(yaml()).not.toContain('name: View\n')
    expect(selected(el)).toBe('Table')
  })

  it('deleting the ACTIVE view hands over to its right neighbour — or the left one for the last tab', () => {
    const { el, def } = mount()
    click(byText(el, '[role="tab"]', 'View'))
    click(item(openOn(el, 'View'), 'Delete'))
    click(q(el, '.confirm__btn--danger'))
    expect(names(el, def)).toEqual(['Table', 'View 2'])
    expect(selected(el)).toBe('View 2')
    click(item(openOn(el, 'View 2'), 'Delete')) // now the LAST tab
    click(q(el, '.confirm__btn--danger'))
    expect(names(el, def)).toEqual(['Table'])
    expect(selected(el)).toBe('Table')
  })
})

/**
 * "+" adds a view (YAZ-1471, 🔒 D5): a type picker at the END of the strip — outside the
 * `role="tablist"` scroller, so overflow never swallows it — offering one `role="menuitem"` per
 * `VIEW_TYPES`, labelled by the capitalised type. Picking one is ONE `update` (the same door as
 * sort, columns and the rest of the tab CRUD): the view is appended under the first FREE name off
 * its label ("Table", then "Table 2"), lands ACTIVE, and mounts straight into rename so the name
 * can be typed over without a second gesture — Escape there leaves the given name standing and
 * writes nothing more. Outline is offered only while the page has none, because ViewsPane reads
 * and writes the FIRST outline view's document and a second would shadow it.
 */
describe('view tabs — "+" adds a view (YAZ-1471)', () => {
  const plus = (el: ParentNode): HTMLButtonElement => byLabel<HTMLButtonElement>(el, 'Add view')
  const expanded = (el: ParentNode): string | null => plus(el).getAttribute('aria-expanded')
  /** Open the picker off "+" and hand back its anchored popover. */
  const openPicker = (el: ParentNode): HTMLElement => {
    click(plus(el))
    return q<HTMLElement>(el, '.view-popover--menu')
  }
  const kinds = (pop: ParentNode): string[] => [...pop.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent ?? '')
  /** Open the picker and pick `kind`; the appended tab comes back mounted in rename. */
  const add = (el: ParentNode, kind: string): void => click(byText(openPicker(el), '[role="menuitem"]', kind))
  const renameField = (el: ParentNode): HTMLInputElement => byLabel<HTMLInputElement>(el, 'View name')
  const mouseDownOutside = (): void => {
    act(() => void document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })))
    draw()
  }

  it('"+" opens a picker of every type, in menu order, and opening writes nothing', () => {
    const { el, onChange } = mount()
    expect(plus(el).getAttribute('aria-haspopup')).toBe('dialog') // `Popover` renders role=dialog
    expect(expanded(el)).toBe('false')
    expect(plus(el).closest('[role="tablist"]')).toBeNull() // the strip scrolls; "+" does not go with it
    const pop = openPicker(el)
    expect(expanded(el)).toBe('true')
    expect(kinds(pop)).toEqual(['Table', 'Board', 'Cards', 'List', 'Outline'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Outline is offered only while the page has none — a page owns ONE document', () => {
    const { el } = mount(WITH_OUTLINE)
    expect(kinds(openPicker(el))).toEqual(['Table', 'Board', 'Cards', 'List'])
  })

  it('picking a type appends it in ONE update and mounts it in rename; Escape keeps the given name', () => {
    const { el, onChange, yaml, def } = mount()
    add(el, 'Board')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views.at(-1)).toEqual({ type: 'board', name: 'Board' }) // appended LAST
    expect(yaml()).toContain('  - type: board\n    name: Board\n')
    expect(el.querySelector('.view-popover--menu')).toBeNull() // picking closes the picker
    expect(expanded(el)).toBe('false')
    const field = renameField(el)
    expect(field.value).toBe('Board')
    // While the field owns the tab there is no `[role="tab"]` for it to be selected ON — the strip
    // reads back as a tab, selected, the moment rename lets go.
    press(field, 'Escape')
    expect(el.querySelector('[aria-label="View name"]')).toBeNull()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2', 'Board'])
    expect(selected(el)).toBe('Board')
    expect(onChange).toHaveBeenCalledTimes(1) // Escape commits nothing of its own
  })

  it('the name is the first FREE one off the type label — "Table 2", then "Table 3"', () => {
    const { el, onChange, def } = mount()
    add(el, 'Table')
    press(renameField(el), 'Escape')
    expect(def().views.at(-1)).toEqual({ type: 'table', name: 'Table 2' })
    add(el, 'Table')
    press(renameField(el), 'Escape')
    expect(def().views.at(-1)).toEqual({ type: 'table', name: 'Table 3' })
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2', 'Table 2', 'Table 3'])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('Escape and a click-away both close the picker, and write nothing', () => {
    const { el, onChange } = mount()
    press(openPicker(el), 'Escape')
    expect(el.querySelector('.view-popover--menu')).toBeNull()
    expect(expanded(el)).toBe('false')

    openPicker(el)
    mouseDownOutside()
    expect(el.querySelector('.view-popover--menu')).toBeNull()
    expect(expanded(el)).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2'])
  })

  it('typing over the mounted rename is the SECOND update, and the YAML carries the typed name', () => {
    const { el, onChange, yaml, def } = mount()
    add(el, 'Cards')
    type(renameField(el), 'Grid')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views.at(-1)).toEqual({ type: 'cards', name: 'Grid' })
    expect(yaml()).toContain('name: Grid')
    expect(tabs(el)).toEqual(['Table', 'View', 'View 2', 'Grid'])
    expect(selected(el)).toBe('Grid')
  })

  /** A fresh board has no `groupBy` yet, so BoardView's root is its "pick a property" hint. */
  it.each([
    ['Board', '.view-board__hint'],
    ['List', '.view-list'],
    ['Cards', '.view-cards'],
  ])('the appended %s view renders its OWN body', (kind, root) => {
    const { el } = mount()
    add(el, kind)
    press(renameField(el), 'Escape')
    expect(selected(el)).toBe(kind)
    expect(el.querySelector(root)).not.toBeNull()
  })
})

/**
 * Overflow (YAZ-1471, 🔒 D6): the strip scrolls with NO scrollbar, and the fade at whichever edge
 * still hides tabs is pure CSS (the shared `strip-fade` on `animation-timeline: scroll(self
 * inline)`, app.css) — so the ONLY behaviour in JS is TabBar's: keep the ACTIVE tab in view on
 * every activation, and keep the "+" out of the scroller so it can never scroll away. jsdom has
 * no `scrollIntoView` (hence the effect's `?.()` in every other test here); stub it to read it.
 */
describe('view tabs — overflow (YAZ-1471)', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollIntoView = vi.fn()
    ;(Element.prototype as unknown as Record<string, unknown>).scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    delete (Element.prototype as unknown as Record<string, unknown>).scrollIntoView
  })

  it('scrolls the ACTIVE tab into view on mount, and again on every activation', () => {
    const { el } = mount()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
    expect(scrollIntoView.mock.contexts[0]).toBe(wrap(el, 0)) // the seeded view's tab

    click(byText(el, '[role="tab"]', 'View 2'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    const scrolled = scrollIntoView.mock.contexts[1] as HTMLElement
    expect(scrolled).toBe(wrap(el, 2)) // THAT tab, not the one it came from
    expect(scrolled.classList.contains('view-tab--active')).toBe(true)
    expect(scrolled.querySelector('[role="tab"]')?.textContent).toBe('View 2')
  })

  it('the tablist IS the scroller, and the "+" sits outside it', () => {
    const { el } = mount()
    expect(q(el, '.view-tabs-wrap > .view-tabs[role="tablist"]')).toBe(q(el, '[role="tablist"]'))
    expect(el.querySelectorAll('.view-tabs[role="tablist"] > .view-tab')).toHaveLength(3) // every tab scrolls
    expect(el.querySelector('[role="tablist"] [aria-label="Add view"]')).toBeNull()
    expect(el.querySelector('.view-tabs-wrap > .view-tab__add')).not.toBeNull() // the "+" is the wrap's OWN child
  })
})

/**
 * The Filter menu, back from the YAZ-846 amputation (YAZ-1227 / YAZ-1228 / YAZ-1229). Every write
 * lands on `views[i].filters` and nowhere else (D1), and the engine's own compile errors are read
 * where they are edited as well as on the muted footnote.
 */
describe('filter menu (YAZ-1227-1229)', () => {
  const RULE = `views:
  - type: table
    name: T
    filters:
      and:
        - note.status == "idea"
    order:
      - file.name
`
  const TWO = `views:
  - type: table
    name: T
    filters:
      and:
        - note.status == "idea"
        - note.priority > 1
`

  it('the approved actions sequence keeps related controls together and creation beside search', () => {
    const { el, onChange } = mount()
    const actions = q(el, '.view-toolbar__actions')
    expect([...actions.querySelectorAll('.view-toolbar__btn')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Sort',
      'Properties',
      'Filter',
      'Preview on hover',
      'New note',
      'Search',
    ])
    const pop = openMenu(el, 'Filter')
    expect(byText(pop, 'p', 'No filters')).toBeDefined()
    expect(byLabel(el, 'Filter').querySelector('.view-toolbar__badge')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the Filter popover carries its own width class, and Sort keeps hers (YAZ-1466)', () => {
    const { el } = mount()
    expect(openMenu(el, 'Filter').classList.contains('view-popover--filter')).toBe(true)
    click(byLabel(el, 'Filter'))
    expect(openMenu(el, 'Sort').classList.contains('view-popover--sort')).toBe(true)
  })

  it('an outline is a DOCUMENT, not rows: no button at all', () => {
    const { el } = mount('views:\n  - type: outline\n    name: Outline\n', { thisFile: '/vault/Topic.md' })
    expect(el.querySelector('[aria-label="Filter"]')).toBeNull()
  })

  it('Add rule writes the match-everything default, in ONE write', () => {
    const { el, onChange, def, yaml } = mount()
    click(byText(openMenu(el, 'Filter'), 'button', 'Add rule'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].filters).toEqual({ and: ['file.name.contains("")'] })
    expect(yaml()).toContain('filters:')
    expect(yaml()).toContain('and:')
    expect(yaml()).toContain('file.name.contains("")')
  })

  it('a stored expression round-trips into its builder row and counts in the badge', () => {
    const { el } = mount(RULE)
    const pop = openMenu(el, 'Filter')
    click(byLabel(pop, 'Property'))
    expect(q(pop, '[role="option"][aria-selected="true"]').getAttribute('data-value')).toBe('note.status')
    expect(byLabel<HTMLSelectElement>(pop, 'Operator').value).toBe('is')
    expect(byLabel<HTMLInputElement>(pop, 'Value').value).toBe('idea')
    expect(byText(el, '.view-toolbar__badge', '1')).toBeDefined()
    expect(byLabel(el, 'Filter').classList.contains('view-toolbar__btn--on')).toBe(true)
  })

  it('a new property re-validates the operator and drops a value of another kind', () => {
    const { el, onChange, def } = mount(RULE)
    const pop = openMenu(el, 'Filter')
    searchColumn(pop, 'Property', 'priority') // TEST_RECORDS types it number
    expect(onChange).toHaveBeenCalledTimes(1)
    // `is` is not legal on a number, so the first legal one takes over; the text value is cleared,
    // and an empty number renders as the `0` `ruleToExpr` writes for one.
    expect(def().views[0].filters).toEqual({ and: ['note.priority == 0'] })
    expect(byLabel<HTMLSelectElement>(pop, 'Operator').value).toBe('eq')
    expect(byLabel<HTMLInputElement>(pop, 'Value').value).toBe('0')
  })

  it('choosing the property the row already has writes nothing (YAZ-1466)', () => {
    const { el, onChange, yaml } = mount(RULE)
    const before = yaml()
    searchColumn(openMenu(el, 'Filter'), 'Property', 'status')
    expect(onChange).not.toHaveBeenCalled()
    expect(yaml()).toBe(before)
  })

  it('"is any of" swaps the typed value for a checklist, one write per tick (YAZ-1467)', () => {
    const { el, onChange, def, yaml } = mount(RULE)
    const pop = openMenu(el, 'Filter')
    setValue(byLabel<HTMLSelectElement>(pop, 'Operator'), 'isAnyOf')
    expect(def().views[0].filters).toEqual({ and: ['[].contains(note.status)'] })
    expect(pop.querySelector('input[aria-label="Value"]')).toBeNull()
    chooseColumn(pop, 'Value', 'idea')
    chooseColumn(pop, 'Value', 'drafting')
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(def().views[0].filters).toEqual({ and: ['["idea", "drafting"].contains(note.status)'] })
    // A leading `[` is a flow sequence, so the serializer quotes the whole expression.
    expect(yaml()).toContain('- "[\\"idea\\", \\"drafting\\"].contains(note.status)"')
  })

  it('the datalist stops at 50 suggestions, the checklist lists every value (YAZ-1469)', () => {
    const records = Array.from({ length: 60 }, (_, i) => ({ ...TEST_RECORDS[0], path: `/vault/n${i}.md`, properties: { status: `s${String(i).padStart(2, '0')}` } }))
    const { el } = mount(RULE, { records })
    const pop = openMenu(el, 'Filter')
    expect(pop.querySelectorAll('datalist option')).toHaveLength(50)
    setValue(byLabel<HTMLSelectElement>(pop, 'Operator'), 'isAnyOf')
    click(byLabel(pop, 'Value'))
    expect(pop.querySelectorAll('[role="option"]')).toHaveLength(60)
  })

  it('a stored value list reopens ticked, and going back to "is" clears it (YAZ-1467)', () => {
    // A flow sequence is the one expression the YAML must quote to stay a string.
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - \'["idea", "zzz"].contains(note.status)\'\n')
    const pop = openMenu(el, 'Filter')
    expect(byLabel<HTMLSelectElement>(pop, 'Operator').value).toBe('isAnyOf')
    const values = byLabel<HTMLButtonElement>(pop, 'Value')
    expect(values.textContent).toContain('idea, zzz')
    click(values)
    // `zzz` is in no record, so only the stored rule puts it on the list — and it is still ticked.
    expect([...pop.querySelectorAll('[role="option"][aria-selected="true"]')].map((o) => (o as HTMLElement).dataset.value)).toEqual(['zzz', 'idea'])
    setValue(byLabel<HTMLSelectElement>(pop, 'Operator'), 'is')
    expect(def().views[0].filters).toEqual({ and: ['note.status == ""'] })
    expect(byLabel<HTMLInputElement>(pop, 'Value').value).toBe('')
  })

  it('Any rewrites the conjunction over the same items', () => {
    const { el, onChange, def, yaml } = mount(TWO)
    click(byText(openMenu(el, 'Filter'), 'button', 'Any'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].filters).toEqual({ or: ['note.status == "idea"', 'note.priority > 1'] })
    expect(yaml()).toContain('or:')
  })

  it('with no rules to join, a conjunction click writes nothing', () => {
    const { el, onChange } = mount()
    click(byText(openMenu(el, 'Filter'), 'button', 'Any'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('removing the last rule deletes the key', () => {
    const { el, def, yaml } = mount(RULE)
    click(byLabel(openMenu(el, 'Filter'), 'Remove rule'))
    expect(def().views[0].filters).toBeUndefined()
    expect(yaml()).not.toContain('filters:')
  })

  it('Advanced shows each string rule raw, and commits what is typed there verbatim', () => {
    const { el, def } = mount(RULE)
    const pop = openMenu(el, 'Filter')
    expect(pop.querySelector('[aria-label="Expression"]')).toBeNull()
    click(q(pop, '.view-menu__toggle input'))
    expect(byLabel<HTMLInputElement>(pop, 'Expression').value).toBe('note.status == "idea"')
    type(byLabel(pop, 'Expression'), 'note.status.contains("dr")')
    expect(def().views[0].filters).toEqual({ and: ['note.status.contains("dr")'] })
  })

  // A well-formed `or` is a GROUP since YAZ-1231, so the raw fallback is proved on what stays odd:
  // a conjunction whose value is not a list is neither a rule nor a group the menu could edit.
  it('an item the builder cannot show stays raw, and × still removes it', () => {
    const { el, def } = mount(`views:
  - type: table
    name: T
    filters:
      and:
        - or: a == "1"
`)
    const pop = openMenu(el, 'Filter')
    expect(q(pop, '.view-rule__code').textContent).toBe('{"or":"a == \\"1\\""}')
    expect(pop.querySelector('[aria-label="Property"]')).toBeNull()
    expect(pop.querySelector('.view-rule-group')).toBeNull()
    click(byLabel(pop, 'Remove rule'))
    expect(def().views[0].filters).toBeUndefined()
  })

  it('a filters block the engine could not compile reddens the button and says so inside the menu', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    filters: 1 +\n    order:\n      - file.name\n')
    expect(byLabel(el, 'Filter').classList.contains('view-toolbar__btn--error')).toBe(true)
    const errors = q<HTMLElement>(openMenu(el, 'Filter'), '.view-menu__errors')
    expect(errors.getAttribute('role')).toBe('alert')
    expect(errors.textContent).toBe('views[0].filters unexpected end of input')
    // and the muted footnote still carries it too (YAZ-861) — the menu is an addition, not a move
    expect(q(el, '.views-pane__notes').textContent).toBe('views[0].filters: unexpected end of input')
  })

  /**
   * ONE level of nesting is editable (YAZ-1231): a top-level conjunction becomes a group block with
   * its own All/Any/None, its own rows and its own Add rule. Everything deeper stays the raw row it
   * already was — the menu edits what it understands and never destroys what it does not.
   */
  describe('nested groups (YAZ-1231)', () => {
    const NESTED = `views:
  - type: table
    name: T
    filters:
      and:
        - note.status == "idea"
        - or:
            - note.priority > 1
            - note.published == true
`
    /** The group block of the open menu (there is only ever one — the design is one level deep). */
    const groupOf = (pop: ParentNode): HTMLElement => q<HTMLElement>(pop, '.view-rule-group')

    it('a stored conjunction renders as a group of rows, not as one raw item', () => {
      const { el, onChange } = mount(NESTED)
      const pop = openMenu(el, 'Filter')
      const list = q(pop, '.view-menu__list')
      expect([...list.children].map((c) => c.className)).toEqual(['view-rule', 'view-rule-group'])
      const group = groupOf(pop)
      expect(byLabel(group, 'Match (group)').querySelector('[aria-pressed="true"]')?.textContent).toBe('Any')
      expect(group.querySelectorAll('.view-rule')).toHaveLength(2)
      expect(group.querySelector('.view-rule__code')).toBeNull()
      // the badge counts LEAVES, so the group's two rules are two of the three
      expect(byText(el, '.view-toolbar__badge', '3')).toBeDefined()
      expect(onChange).not.toHaveBeenCalled()
    })

    it('a row inside a group gets the same searchable Property picker (YAZ-1466)', () => {
      const { el, onChange, def } = mount(NESTED)
      const group = groupOf(openMenu(el, 'Filter'))
      expect(group.querySelectorAll('.column-picker')).toHaveLength(2)
      searchColumn(group, 'Property', 'file.name')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(def().views[0].filters).toEqual({
        and: ['note.status == "idea"', { or: ['file.name == ""', 'note.published == true'] }],
      })
    })

    it('Add group appends an `or` holding the match-everything default, in ONE write', () => {
      const { el, onChange, def, yaml } = mount()
      click(byText(openMenu(el, 'Filter'), 'button', 'Add group'))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(def().views[0].filters).toEqual({ and: [{ or: ['file.name.contains("")'] }] })
      expect(yaml()).toContain('and:')
      expect(yaml()).toContain('or:')
      expect(yaml()).toContain('file.name.contains("")')
    })

    it("the group's own conjunction rewrites the group and leaves the outer one alone", () => {
      const { el, onChange, def, yaml } = mount(NESTED)
      click(byText(groupOf(openMenu(el, 'Filter')), 'button', 'None'))
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(def().views[0].filters).toEqual({
        and: ['note.status == "idea"', { not: ['note.priority > 1', 'note.published == true'] }],
      })
      expect(yaml()).toContain('not:')
    })

    it("the group's Add rule lands INSIDE the group", () => {
      const { el, def, yaml } = mount(NESTED)
      click(byText(groupOf(openMenu(el, 'Filter')), 'button', 'Add rule'))
      expect(def().views[0].filters).toEqual({
        and: ['note.status == "idea"', { or: ['note.priority > 1', 'note.published == true', 'file.name.contains("")'] }],
      })
      expect(yaml()).toContain('- file.name.contains("")')
    })

    it('emptying a group removes it, and Remove group removes it with its rules still in it', () => {
      const one = mount(`views:
  - type: table
    name: T
    filters:
      and:
        - note.status == "idea"
        - or:
            - note.priority > 1
`)
      click(byLabel(groupOf(openMenu(one.el, 'Filter')), 'Remove rule'))
      expect(one.def().views[0].filters).toEqual({ and: ['note.status == "idea"'] })
      expect(one.el.querySelector('.view-rule-group')).toBeNull()

      const two = mount(NESTED)
      click(byLabel(groupOf(openMenu(two.el, 'Filter')), 'Remove group'))
      expect(two.def().views[0].filters).toEqual({ and: ['note.status == "idea"'] })
      expect(two.el.querySelector('.view-rule-group')).toBeNull()
    })

    it('a conjunction INSIDE a group is one level too deep: it stays a raw row in place', () => {
      const { el, def } = mount(`views:
  - type: table
    name: T
    filters:
      and:
        - or:
            - note.a == "1"
            - and:
                - note.b == "2"
`)
      const group = groupOf(openMenu(el, 'Filter'))
      expect(group.querySelectorAll('.view-rule-group')).toHaveLength(0)
      expect(q(group, '.view-rule__code').textContent).toBe('{"and":["note.b == \\"2\\""]}')
      expect(group.querySelectorAll('.view-rule')).toHaveLength(2)
      expect(def().views[0].filters).toEqual({ and: [{ or: ['note.a == "1"', { and: ['note.b == "2"'] }] }] })
    })
  })

  /** A text value offers what the vault already holds for its property (YAZ-1232) — a native datalist. */
  describe('value suggestions (YAZ-1232)', () => {
    const options = (pop: ParentNode): string[] => [...q(pop, 'datalist').querySelectorAll('option')].map((o) => o.value)

    it("a note property's text value lists the values TEST_RECORDS hold for it, in first-seen order", () => {
      const pop = openMenu(mount(RULE).el, 'Filter')
      const list = q<HTMLDataListElement>(pop, 'datalist')
      expect(byLabel<HTMLInputElement>(pop, 'Value').getAttribute('list')).toBe(list.id)
      expect(options(pop)).toEqual(['idea', 'drafting', 'published'])
    })

    it("file.folder lists the vault's folders, and the root's '' is not one of them", () => {
      const pop = openMenu(mount('views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - file.inFolder("Content Pillars")\n').el, 'Filter')
      expect(byLabel<HTMLSelectElement>(pop, 'Operator').value).toBe('inFolder')
      expect(options(pop)).toEqual([
        'Content Pillars/1. Agentic Agency',
        'Content Pillars/2. Creator Economy',
        'Content Pillars/3. Trust Economy & Paid Ads',
        'Content Pillars/4. Tech & Silicon Valley',
        'Content Pillars',
      ])
    })

    it('a number value has nothing to suggest', () => {
      const pop = openMenu(mount('views:\n  - type: table\n    name: T\n    filters:\n      and:\n        - note.priority > 1\n').el, 'Filter')
      expect(byLabel<HTMLInputElement>(pop, 'Value').type).toBe('number')
      expect(byLabel(pop, 'Value').getAttribute('list')).toBeNull()
      expect(pop.querySelector('datalist')).toBeNull()
    })
  })
})

describe('sort menu', () => {
  it('add / retarget / flip write view.sort in order; remove deletes the key', () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Sort')
    click(byLabel(pop, 'Remove sort')) // drop the dangling formula.Untitled sort
    expect(def().views[0].sort).toBeUndefined()
    expect(yaml()).not.toContain('sort:')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort).toEqual([{ property: 'file.name', direction: 'ASC' }])
    chooseColumn(pop, 'Sort property', 'note.priority')
    click(byLabel(pop, 'Direction'))
    expect(onChange).toHaveBeenCalledTimes(4)
    expect(def().views[0].sort).toEqual([{ property: 'note.priority', direction: 'DESC' }])
    expect(rows(el).slice(0, 3)).toEqual(['Creator Economy', 'Agentic Agency', 'The Levels of an Agency'])
  })

  it('a second sort can move above the first', () => {
    const { el, def } = mount()
    const pop = openMenu(el, 'Sort')
    click(byText(pop, 'button', 'Add sort'))
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['formula.Untitled', 'file.name'])
    press(byLabel(pop, 'Reorder sort 2: Name'), 'ArrowUp')
    expect(def().views[0].sort?.map((s) => s.property)).toEqual(['file.name', 'formula.Untitled'])
  })

  it('Group by writes view.groupBy, counts in the Sort badge, and None deletes it', () => {
    const { el, onChange, def, yaml } = mount()
    expect(byText(el, '.view-toolbar__badge', '1')).toBeDefined() // the existing sort
    const pop = openMenu(el, 'Sort')
    chooseColumn(pop, 'Group by', 'note.status')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
    expect(yaml()).toContain('groupBy:')
    expect(byText(el, '.view-toolbar__badge', '2')).toBeDefined()
    click(byLabel(pop, 'Group direction'))
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'DESC' })
    chooseColumn(pop, 'Group by', '')
    expect(def().views[0].groupBy).toBeUndefined()
  })

  it('a Then-by level writes the LIST form, omits the outer property, and clears back to the object form (YAZ-745)', () => {
    const { el, def, yaml } = mount()
    const pop = openMenu(el, 'Sort')
    chooseColumn(pop, 'Group by', 'note.status')
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'ASC' })
    click(byLabel(pop, 'Then group by'))
    expect([...pop.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.dataset.value)).not.toContain('note.status')
    chooseColumn(pop, 'Then group by', 'note.priority')
    expect(def().views[0].groupBy).toEqual([
      { property: 'note.status', direction: 'ASC' },
      { property: 'note.priority', direction: 'ASC' },
    ])
    expect(yaml()).toContain('- property: note.status')
    expect(byText(el, '.view-toolbar__badge', '3')).toBeDefined() // 1 sort + 2 grouping levels
    click(byLabel(pop, 'Then group direction'))
    expect(def().views[0].groupBy).toEqual([
      { property: 'note.status', direction: 'ASC' },
      { property: 'note.priority', direction: 'DESC' },
    ])
    click(byLabel(pop, 'Group direction')) // the outer's chip still edits the outer alone
    expect(def().views[0].groupBy).toEqual([
      { property: 'note.status', direction: 'DESC' },
      { property: 'note.priority', direction: 'DESC' },
    ])
    chooseColumn(pop, 'Then group by', '')
    expect(def().views[0].groupBy).toEqual({ property: 'note.status', direction: 'DESC' })
  })

  it('no Then-by without an outer; the outer moved onto the inner drops the inner; None clears both levels', () => {
    const { el, def } = mount()
    const pop = openMenu(el, 'Sort')
    expect(pop.querySelector('[aria-label="Then group by"]')).toBeNull()
    chooseColumn(pop, 'Group by', 'note.status')
    chooseColumn(pop, 'Then group by', 'note.priority')
    chooseColumn(pop, 'Group by', 'note.priority')
    expect(def().views[0].groupBy).toEqual({ property: 'note.priority', direction: 'ASC' })
    chooseColumn(pop, 'Then group by', 'note.status')
    chooseColumn(pop, 'Group by', '')
    expect(def().views[0].groupBy).toBeUndefined()
  })
})

describe('collapse all groups', () => {
  const GROUPED = 'views:\n  - type: table\n    name: T\n    groupBy:\n      property: note.status\n'

  it('the toggle is there only when the view is grouped', () => {
    expect(mount().el.querySelector('[aria-label="Collapse all groups"]')).toBeNull()
    expect(mount(GROUPED).el.querySelector('[aria-label="Collapse all groups"]')).not.toBeNull()
  })

  it('one click collapses every group, the next expands them, and neither writes the file', () => {
    const { el, onChange } = mount(GROUPED)
    expect(rows(el)).toHaveLength(8)
    click(byLabel(el, 'Collapse all groups'))
    expect(rows(el)).toEqual([])
    expect([...el.querySelectorAll('.view-group__toggle')].map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false'])
    click(byLabel(el, 'Expand all groups'))
    expect(rows(el)).toHaveLength(8)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('properties menu', () => {
  it.each(['table', 'board'])('selects every offered property once in %s, preserving aliases, order, and other settings', (type) => {
    const records = [{ ...TEST_RECORDS[0], properties: { status: 'idea', priority: 2 } }]
    const settings = { columns: { status: { kind: 'text' as const }, owner: { kind: 'text' as const } }, views: [], problems: [] }
    const { el, onChange, def, yaml } = mount(`formulas:
  Score: '1'
views:
  - type: ${type}
    name: Active
    order: [status, file.name]
    frozenColumns: 1
    columnSize: { status: 210 }
    cardStyle: { note.status: { bold: true } }
    groupBy: { property: note.status }
    sort: [{ property: file.name, direction: ASC }]
  - type: table
    name: Other
    order: [file.name]
`, { records, folderPage: testFolderPage({ settings, vaultRecords: records }) })
    const before = structuredClone(def())
    const pop = openMenu(el, 'Properties')
    const select = byText<HTMLButtonElement>(pop, 'button', 'Select all')
    expect(select.disabled).toBe(false)
    click(select)

    const order = ['status', 'file.name', 'note.owner', 'note.priority', 'formula.Score']
    expect(def()).toEqual({ ...before, views: [{ ...before.views[0], order }, before.views[1]] })
    expect(parseViews(yaml()).def).toEqual(def())
    expect([...pop.querySelectorAll<HTMLInputElement>('input[aria-label^="Show "]')].every((input) => input.checked)).toBe(true)
    expect(select.disabled).toBe(true)
    click(select)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it.each(['table', 'board'])('clears and restores %s properties through saved empty orders without restoring frozen columns', (type) => {
    const records = [{ ...TEST_RECORDS[0], properties: { status: 'idea', priority: 2 } }]
    const { el, onChange, def, yaml } = mount(`views:
  - type: ${type}
    name: Active
    order: [note.status, file.name, note.priority]
    frozenColumns: 2
    groupBy: { property: note.status }
  - type: table
    name: Other
    order: [file.name]
`, { records })
    const before = structuredClone(def())
    const pop = openMenu(el, 'Properties')
    const clear = byText<HTMLButtonElement>(pop, 'button', 'Unselect all')
    click(clear)

    const { frozenColumns: _frozen, ...active } = before.views[0]
    expect(def()).toEqual({ ...before, views: [{ ...active, order: [] }, before.views[1]] })
    expect(parseViews(yaml()).def.views[0].order).toEqual([])
    expect(yaml()).toContain('order: []')
    expect(yaml()).not.toContain('frozenColumns')
    expect([...pop.querySelectorAll<HTMLInputElement>('input[aria-label^="Show "]')].every((input) => !input.checked)).toBe(true)
    expect(el.querySelector('.view-table thead th:not(.view-table__gutter), .view-board__title, .view-board__prop')).toBeNull()
    if (type === 'board') expect(el.querySelectorAll('.view-board__card')).toHaveLength(1)
    expect(clear.disabled).toBe(true)
    click(clear)
    expect(onChange).toHaveBeenCalledTimes(1)

    click(byLabel(el, 'Properties'))
    const reopened = openMenu(el, 'Properties')
    click(byText(reopened, 'button', 'Select all'))
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
    expect(def().views[0].frozenColumns).toBeUndefined()
    expect(parseViews(yaml()).def).toEqual(def())
    expect(el.querySelector(type === 'table' ? '.view-table__link' : '.view-board__title')).not.toBeNull()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it.each(['table', 'board'])('handles implicit defaults and no records in %s without redundant writes', (type) => {
    const { el, onChange, def } = mount(`views:\n  - type: ${type}\n    name: Empty\n`, { records: [] })
    const pop = openMenu(el, 'Properties')
    const select = byText<HTMLButtonElement>(pop, 'button', 'Select all')
    expect(select.disabled).toBe(true)
    click(select)
    expect(onChange).not.toHaveBeenCalled()
    expect(def().views[0].order).toBeUndefined()
    click(byText(pop, 'button', 'Unselect all'))
    expect(def().views[0].order).toEqual([])
    expect(select.disabled).toBe(false)
    click(select)
    expect(def().views[0].order).toEqual(['file.name'])
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it.each(['cards', 'list'])('does not offer bulk visibility in %s', (type) => {
    const { el } = mount(`views:\n  - type: ${type}\n    name: Other\n`)
    const pop = openMenu(el, 'Properties')
    expect([...pop.querySelectorAll('button')].some((button) => ['Select all', 'Unselect all'].includes(button.textContent ?? ''))).toBe(false)
  })

  it('offers a Table-only Frozen columns select over the visible positional prefix', () => {
    const { el } = mount('views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n      - note.status\n      - note.priority\n  - type: cards\n    name: Cards\n')
    const table = openMenu(el, 'Properties')
    const select = byLabel<HTMLSelectElement>(table, 'Frozen columns')
    expect([...select.options].map((option) => option.textContent)).toEqual(['None', '1 — through Name', '2 — through Status', '3 — through Priority'])
    expect(select.value).toBe('0')

    click(byText(el, '[role="tab"]', 'Cards'))
    expect(byLabel(el, 'Properties').getAttribute('aria-expanded')).toBe('true')
    expect(q(el, '.view-popover').querySelector('[aria-label="Frozen columns"]')).toBeNull()
  })

  it('writes the selected frozen prefix once; choosing None deletes the optional key', () => {
    const { el, onChange, def, yaml } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n')
    const select = byLabel<HTMLSelectElement>(openMenu(el, 'Properties'), 'Frozen columns')

    setValue(select, '2')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].frozenColumns).toBe(2)
    expect(yaml()).toContain('frozenColumns: 2')

    setValue(select, '0')
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].frozenColumns).toBeUndefined()
    expect(yaml()).not.toContain('frozenColumns')
  })

  it('offers a Table-only Row numbers toggle (YAZ-1513): unchecking writes rowNumbers: false, checking DELETES the key', () => {
    const { el, onChange, def, yaml } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n  - type: cards\n    name: Cards\n')
    const box = byLabel<HTMLInputElement>(openMenu(el, 'Properties'), 'Row numbers')
    expect(box.checked).toBe(true)

    click(box)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].rowNumbers).toBe(false)
    expect(yaml()).toContain('rowNumbers: false')
    expect(el.querySelector('.view-table__gutter')).toBeNull()

    click(byLabel<HTMLInputElement>(el, 'Row numbers'))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].rowNumbers).toBeUndefined()
    expect(yaml()).not.toContain('rowNumbers')
    expect(el.querySelector('.view-table__gutter')).not.toBeNull()

    click(byText(el, '[role="tab"]', 'Cards'))
    expect(q(el, '.view-popover').querySelector('[aria-label="Row numbers"]')).toBeNull()
  })

  it('clamps after hides, leaves restored columns outside the prefix, and follows reorder positionally', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    frozenColumns: 2\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')

    click(byLabel(pop, 'Show Priority'))
    expect(def().views[0].frozenColumns).toBe(2)
    click(byLabel(pop, 'Show Status'))
    expect(def().views[0].order).toEqual(['file.name'])
    expect(def().views[0].frozenColumns).toBe(1)

    click(byLabel(pop, 'Show Status'))
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(1)
    press(byLabel(pop, 'Reorder Status'), 'ArrowUp')
    expect(def().views[0].order).toEqual(['note.status', 'file.name'])
    expect(def().views[0].frozenColumns).toBe(1)
  })

  it('a table can hide and re-show file.name through view.order', () => {
    const { el, onChange, def } = mount()
    const pop = openMenu(el, 'Properties')
    const name = byLabel<HTMLInputElement>(pop, 'Show Name')
    expect(name.checked).toBe(true)
    expect(name.disabled).toBe(false)

    click(byLabel(pop, 'Show Status'))
    expect(def().views[0].order).toEqual(['file.name', 'note.status'])
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')

    click(byLabel(pop, 'Show Name'))
    expect(def().views[0].order).toEqual(['note.status'])
    expect([...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)).toEqual(['Status'])
    expect(q(el, '[data-cell="0:0"]').textContent).toBe('idea')
    expect(el.querySelector('.view-table__link')).toBeNull()

    click(byLabel(pop, 'Show Name'))
    expect(def().views[0].order).toEqual(['note.status', 'file.name'])
    expect([...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((th) => th.textContent)).toEqual(['Status', 'Name'])
    expect(el.querySelector('.view-table__link')).not.toBeNull()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('round-trips board file.name visibility through view.order', () => {
    const { el, onChange, def } = mount(`views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.status
`)
    const pop = openMenu(el, 'Properties')
    const name = byLabel<HTMLInputElement>(pop, 'Show Name')
    expect(name.disabled).toBe(false)
    expect(el.querySelectorAll('.view-board__title')).toHaveLength(8)

    click(name)
    expect(def().views[0].order).toEqual([])
    expect(el.querySelector('.view-board__title')).toBeNull()
    expect(el.querySelectorAll('.view-board__card')).toHaveLength(8)
    expect(el.querySelector('.view-board__prop')).toBeNull()

    click(byLabel(pop, 'Show Name'))
    expect(def().views[0].order).toEqual(['file.name'])
    expect(el.querySelectorAll('.view-board__title')).toHaveLength(8)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it.each(['cards', 'list'])('keeps file.name disabled in %s views', (type) => {
    const { el } = mount(`views:\n  - type: ${type}\n    name: V\n`)
    expect(byLabel<HTMLInputElement>(openMenu(el, 'Properties'), 'Show Name').disabled).toBe(true)
  })

  it('allows an empty table order and keeps Properties available to restore file.name', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Show Name'))
    expect(def().views[0].order).toEqual([])
    expect(el.querySelector('.view-table thead th:not(.view-table__gutter)')).toBeNull()
    expect(byLabel<HTMLInputElement>(pop, 'Show Name').checked).toBe(false)
    click(byLabel(pop, 'Show Name'))
    expect(def().views[0].order).toEqual(['file.name'])
  })

  it('the grip reorders the shown keys only (YAZ-1207: arrows are gone)', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')
    press(byLabel(pop, 'Reorder Priority'), 'ArrowUp') // note.priority above note.status
    expect(def().views[0].order).toEqual(['file.name', 'note.priority', 'note.status'])
  })

  it('the folder page’s DECLARED columns are offered too, valueless or not (YAZ-895)', () => {
    const settings = { columns: { owner: { kind: 'link' as const } }, views: [], problems: [] }
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings }) })
    expect(byLabel(openMenu(el, 'Properties'), 'Show Owner')).toBeDefined()
  })

  it('keeps a long column identity separate from its controls (YAZ-1006)', () => {
    const name = 'campaign_narrative_summary'
    const label = 'Campaign narrative summary' // the default label (YAZ-1513); the key rides in the <small>
    const settings = { columns: { [name]: { kind: 'text' as const } }, views: [], problems: [] }
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings }) })
    const pop = openMenu(el, 'Properties')
    const row = byLabel(pop, `Show ${label}`).closest<HTMLElement>('.view-prop')
    expect(row).not.toBeNull()
    // The LIST row (YAZ-1513) is grip · checkbox · glyph · label · ›, and nothing else
    expect(q(row!, '.view-prop__name').textContent).toBe(label)
    expect(row!.querySelector('small, .property-type-button, [aria-label^="Rename "], [aria-label^="Edit property "]')).toBeNull()
    // …and the DETAIL carries the identity: the label as title, the raw key read-only, the type control
    click(byLabel(row!, `Open ${label}`))
    expect(byLabel<HTMLInputElement>(pop, 'Display name').placeholder).toBe(label) // the heading IS the name field (3D)
    expect(q(pop, '.column-detail__key').textContent).toBe(`note.${name}`)
    expect(byLabel(pop, `Edit property ${label}`)).toBeDefined()
  })

  it('+ Add column declares it and shows it, in ONE write (YAZ-896)', () => {
    const setColumns = vi.fn()
    const settings = { columns: { tag: { kind: 'text' as const } }, views: [], problems: [] }
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ settings, setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column name'), 'budget')
    choosePropertyType(pop, 'Number')
    click(byLabel(pop, 'Save column'))
    expect(setColumns).toHaveBeenCalledTimes(1)
    const [columns, views] = setColumns.mock.calls[0] as [Record<string, unknown>, ViewDef[]]
    expect(columns).toEqual({ tag: { kind: 'text' }, budget: { kind: 'number' } })
    // The order rides in that same write (🔒 D3) — never a second one through `onUpdate`.
    expect(views.map((v) => v.name)).toEqual(['Table', 'View', 'View 2'])
    expect(views[0].order).toEqual(['file.name', 'note.budget'])
    expect(views[2].indentProperties).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
    expect(pop.querySelector('[aria-label="Column name"]')).toBeNull() // collapsed again
  })

  it('an invalid or already-taken column name says so and writes nothing', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column name'), 'Budget!')
    click(byLabel(pop, 'Save column'))
    expect(q(pop, '[role="alert"]').textContent).toContain('lower case')
    setValue(byLabel(pop, 'Column name'), 'status')
    click(byLabel(pop, 'Save column'))
    expect(q(pop, '[role="alert"]').textContent).toContain('already')
    expect(setColumns).not.toHaveBeenCalled()
  })

  it('the target is offered for link kinds only, and lands in the declaration', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    expect(pop.querySelector('[aria-label="Link target"]')).toBeNull()
    choosePropertyType(pop, 'Multi-link')
    setValue(byLabel(pop, 'Column name'), 'owner')
    type(byLabel(pop, 'Link target'), '  People  ')
    click(byLabel(pop, 'Save column'))
    expect(setColumns.mock.calls[0][0]).toEqual({ owner: { kind: 'multi-link', target: 'People' } })
  })

  it("a declared link column's target writes on commit — trimmed, against the captured base — and an emptied field removes it against what just landed (3D)", async () => {
    const base = { kind: 'link' as const, target: 'People' }
    const { setColumn, folderPage } = aheadHost({ owner: base, tag: { kind: 'text' } })
    const { el } = mount(undefined, { root: '/vault', folderPage })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Owner'))
    expect(byLabel<HTMLInputElement>(pop, 'Link target').value).toBe('People')
    type(byLabel(pop, 'Link target'), '  Teams  ')
    expect(setColumn).toHaveBeenNthCalledWith(1, 'owner', { kind: 'link', target: 'Teams' }, base)
    await settle()
    type(byLabel(pop, 'Link target'), '')
    expect(setColumn).toHaveBeenNthCalledWith(2, 'owner', { kind: 'link' }, { kind: 'link', target: 'Teams' })
    expect(pop.querySelector('.frontmatter-property-menu__actions')).toBeNull() // no Save / Cancel anywhere
  })

  it('a target typed under a link kind does not ride into a non-link declaration', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    choosePropertyType(pop, 'Link')
    type(byLabel(pop, 'Link target'), 'People')
    choosePropertyType(pop, 'Text')
    setValue(byLabel(pop, 'Column name'), 'notes')
    click(byLabel(pop, 'Save column'))
    expect(setColumns.mock.calls[0][0]).toEqual({ notes: { kind: 'text' } })
  })

  it('a declared column shows its kind in the Type select; changing it writes that definition immediately, and nothing else', async () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const settings = { columns: { owner: { kind: 'link' as const, target: 'People' }, tag: { kind: 'text' as const } }, views: [], problems: [] }
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ settings, setColumn }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Owner'))
    const select = byLabel<HTMLSelectElement>(pop, 'Edit property Owner')
    expect(select.value).toBe('link')
    setValue(select, 'multi-link')
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('owner', { kind: 'multi-link', target: 'People' }, settings.columns.owner)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('an undeclared note key reads Auto; picking a kind declares it immediately', async () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ setColumn }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    const select = byLabel<HTMLSelectElement>(pop, 'Edit property Status')
    expect(select.value).toBe('')
    expect(select.selectedOptions[0]?.textContent).toBe('Auto')
    expect(setColumn).not.toHaveBeenCalled()
    setValue(select, 'date')
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('status', { kind: 'date' }, undefined)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('file.* rows get no property editor — they are not note properties; the detail reads the type instead', () => {
    const pop = openMenu(mount().el, 'Properties')
    click(byLabel(pop, 'Open Name'))
    expect(pop.querySelector('[aria-label="Edit property Name"]')).toBeNull()
    expect(q(pop, '.column-detail__key').textContent).toBe('file.name')
    expect(q(pop, '.column-detail__value').textContent).toBe('File field')
    click(byLabel(pop, 'Back to columns'))
    click(byLabel(pop, 'Open Status'))
    expect(byLabel(pop, 'Edit property Status')).toBeDefined()
  })

  it.each(['table', 'board'])('%s definition edits write immediately (3D): a type change, then an option-order change, each ONE setColumn against the previous', async viewType => {
    const base = { kind: 'select' as const, options: ['Later', 'Ready'], optionSort: 'manual' as const }
    const { setColumn, folderPage } = aheadHost({ status: base })
    const { el, onChange } = mount(`views:\n  - type: ${viewType}\n    name: Review\n    order: [file.name, note.status]\n    groupBy: { property: note.status }\n`, { folderPage })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect(byLabel<HTMLSelectElement>(pop, 'Edit property Status').value).toBe('select')
    setValue(byLabel(pop, 'Edit property Status'), 'multi-select')
    expect(setColumn).toHaveBeenNthCalledWith(1, 'status', { ...base, kind: 'multi-select' }, base)
    await settle()
    expect(byLabel<HTMLSelectElement>(pop, 'Option order').value).toBe('manual')
    setValue(byLabel(pop, 'Option order'), 'descending')
    expect(setColumn).toHaveBeenNthCalledWith(2, 'status', { ...base, kind: 'multi-select', optionSort: 'descending' }, { ...base, kind: 'multi-select' })
    expect(setColumn).toHaveBeenCalledTimes(2)
    expect(onChange).not.toHaveBeenCalled()
    expect(base).toEqual({ kind: 'select', options: ['Later', 'Ready'], optionSort: 'manual' }) // the panel never mutates a declaration in place
    expect(pop.querySelector('.frontmatter-property-menu__actions, .property-def__type-row')).toBeNull() // no Save / Cancel, no third level
  })

  it('a refused declaration write (changed since opened) shows its text inline and refreshes the panel from the live settings (3D)', async () => {
    const base = { kind: 'text' as const }
    const setColumn = vi.fn().mockRejectedValue(new Error('Property “status” changed since these settings were opened. Reopen the property and try again.'))
    const { el } = mount(undefined, { folderPage: testFolderPage({ settings: { columns: { status: base }, views: [], problems: [] }, setColumn }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    setValue(byLabel(pop, 'Edit property Status'), 'date')
    await settle()
    expect(q(pop, '[role="alert"]').textContent).toContain('changed since these settings were opened')
    expect(byLabel<HTMLSelectElement>(pop, 'Edit property Status').value).toBe('text') // the host's copy (reverted there) is what the panel shows
    expect(pop.querySelector('.column-detail')).not.toBeNull() // still in the panel
  })

  it('options (3D): add, reorder and remove each write the declaration immediately, against what just landed', async () => {
    const base = { kind: 'select' as const, options: ['A', 'B'] }
    const { setColumn, folderPage } = aheadHost({ status: base })
    const { el, onChange } = mount(undefined, { folderPage })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect([...pop.querySelectorAll('.property-def__chip')].map((c) => c.textContent)).toEqual(['A', 'B'])
    click(byLabel(pop, 'Add option'))
    setValue(byLabel(pop, 'New option'), 'C')
    click(byText(pop, '.property-def__save', 'Add'))
    expect(setColumn).toHaveBeenNthCalledWith(1, 'status', { kind: 'select', options: ['A', 'B', 'C'] }, base)
    await settle()
    press(byLabel(pop, 'Reorder A'), 'ArrowDown')
    expect(setColumn).toHaveBeenNthCalledWith(2, 'status', { kind: 'select', options: ['B', 'A', 'C'] }, { kind: 'select', options: ['A', 'B', 'C'] })
    await settle()
    click(byLabel(pop, 'Remove option B'))
    expect(setColumn).toHaveBeenNthCalledWith(3, 'status', { kind: 'select', options: ['A', 'C'] }, { kind: 'select', options: ['B', 'A', 'C'] })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the heading field (3D): Esc reverts the draft and STAYS in the panel; Enter saves; blank goes back to the default label', () => {
    const { el, onChange, def } = mount()
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    const field = byLabel<HTMLInputElement>(pop, 'Display name')
    expect(field.placeholder).toBe('Status')
    expect(field.value).toBe('')
    setValue(field, 'Stage')
    press(field, 'Escape')
    expect(field.value).toBe('')
    expect(onChange).not.toHaveBeenCalled()
    expect(pop.querySelector('.column-detail')).not.toBeNull()
    type(field, 'Stage')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    type(byLabel(pop, 'Display name'), '')
    expect(def().properties).toBeUndefined()
  })

  it('new Select columns retain their option sort mode and start with blank options', () => {
    const setColumns = vi.fn()
    const { el } = mount(undefined, { folderPage: testFolderPage({ setColumns }) })
    const pop = openMenu(el, 'Properties')
    click(byText(pop, 'button', '+ Add column'))
    setValue(byLabel(pop, 'Column name'), 'stage')
    choosePropertyType(pop, 'Select')
    expect(pop.querySelector('.property-def__chip')).toBeNull()
    setValue(byLabel(pop, 'Option order'), 'ascending')
    click(byLabel(pop, 'Save column'))
    expect(setColumns.mock.calls[0][0]).toEqual({ stage: { kind: 'select', options: [], optionSort: 'ascending' } })
  })

  it("the detail's Name field sets def.properties[key].displayName; clearing it deletes the entry (YAZ-1513: the pencil moved in here)", () => {
    const { el, onChange, def, yaml } = mount()
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect(byLabel<HTMLInputElement>(pop, 'Display name').placeholder).toBe('Status') // the default label, as a hint
    type(byLabel(pop, 'Display name'), 'Stage')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    expect(yaml()).toContain('displayName: Stage')
    expect(byLabel<HTMLInputElement>(pop, 'Display name').value).toBe('Stage') // the heading field follows
    click(byLabel(pop, 'Back to columns'))
    expect(byLabel(pop, 'Show Stage')).toBeDefined()
    click(byLabel(pop, 'Open Stage'))
    type(byLabel(pop, 'Display name'), '')
    expect(def().properties).toBeUndefined()
    expect(yaml()).not.toContain('properties:')
  })

  it('the two levels (YAZ-1513): ‹ and Esc return to the list, Esc on the list closes the popover, and the list row keeps grip + checkbox as before', () => {
    const { el } = mount()
    const pop = openMenu(el, 'Properties')
    expect(byLabel(pop, 'Show Status')).toBeDefined()
    expect(byLabel(pop, 'Reorder Name')).toBeDefined() // shown rows keep their grip
    click(byLabel(pop, 'Open Status'))
    expect(pop.querySelector('[aria-label="Show Status"]')).toBeNull() // the list is gone while the detail shows
    click(byLabel(pop, 'Back to columns'))
    expect(byLabel(pop, 'Show Status')).toBeDefined()
    click(byLabel(pop, 'Open Status'))
    press(q(pop, '.column-detail'), 'Escape')
    expect(byLabel(pop, 'Show Status')).toBeDefined() // Esc stepped back…
    expect(el.querySelector('.view-popover')).not.toBeNull() // …without closing the popover
    press(pop, 'Escape')
    expect(el.querySelector('.view-popover')).toBeNull()
  })

  it('the conditional sections (YAZ-1513): Options only for Select kinds, Relation only for note keys with a root, card styling only on a board', () => {
    const settings = { columns: { status: { kind: 'select' as const, options: ['A', 'B'] }, owner: { kind: 'link' as const, target: '[[People]]' } }, views: [], problems: [] }
    const { el } = mount(undefined, { root: '/vault', folderPage: testFolderPage({ settings }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect([...q(pop, '[aria-label="Property options"]').querySelectorAll('.property-def__chip')].map((c) => c.textContent)).toEqual(['A', 'B'])
    expect(byLabel(pop, 'Relation for Status').textContent).toBe('Make relation') // not a link kind: the seed button
    expect(pop.querySelector('[aria-label^="Bold "]')).toBeNull() // a table: no card styling
    click(byLabel(pop, 'Back to columns'))
    click(byLabel(pop, 'Open Owner'))
    expect(pop.querySelector('[aria-label="Property options"]')).toBeNull()
    expect(byLabel<HTMLInputElement>(pop, 'Link target').value).toBe('[[People]]') // a link kind: the target inline
    click(byLabel(pop, 'Back to columns'))
    click(byLabel(pop, 'Open Name'))
    expect(pop.querySelector('[aria-label^="Relation for "]')).toBeNull() // file.name is not a note property
  })

  it('the actions row (YAZ-1513): Hide in this view unchecks the column in ONE order write and returns to the list', () => {
    const { el, onChange, def } = mount('views:\n  - type: table\n    name: T\n    frozenColumns: 2\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    click(byLabel(pop, 'Hide Status in this view'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority'])
    expect(def().views[0].frozenColumns).toBe(2)
    expect(byLabel<HTMLInputElement>(pop, 'Show Status').checked).toBe(false)
    click(byLabel(pop, 'Open Status'))
    expect(byLabel<HTMLButtonElement>(pop, 'Hide Status in this view').disabled).toBe(true) // already hidden
  })

  it('the actions row (YAZ-1513): Delete column… asks first with the label, key and member count; Cancel deletes nothing; Delete calls the ONE door', () => {
    const deleteColumn = vi.fn(async () => {})
    const { el, onChange } = mount(undefined, { folderPage: testFolderPage({ deleteColumn }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    click(byLabel(pop, 'Delete column Status'))
    const sheet = q<HTMLElement>(pop, '.confirm[role="dialog"]')
    expect(q(sheet, '.confirm__text').textContent).toBe('Delete "Status"? This removes the column from this page and the "status" value from 5 notes.')
    click([...sheet.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!)
    expect(pop.querySelector('.confirm')).toBeNull()
    expect(deleteColumn).not.toHaveBeenCalled()
    expect(el.querySelector('.view-popover')).not.toBeNull() // the sheet's Cancel never reaches the popover
    click(byLabel(pop, 'Delete column Status'))
    click([...pop.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Delete')!)
    expect(deleteColumn).toHaveBeenCalledExactlyOnceWith('note.status')
    expect(onChange).not.toHaveBeenCalled()
    expect(byLabel(pop, 'Show Status')).toBeDefined() // back on the list
  })

  it('the actions row (YAZ-1513): Delete column… is disabled with the tooltip for file.*, formula.* and app-owned keys, enabled for a plain note key', () => {
    const deleteColumn = vi.fn(async () => {})
    const records = [{ ...TEST_RECORDS[0], properties: { status: 'idea', folder_pages: ['[[Home]]'] } }]
    const { el } = mount(`formulas:\n  score: '1'\nviews:\n  - type: table\n    name: T\n    order: [file.name, note.status, note.folder_pages, formula.score]\n`, { records, folderPage: testFolderPage({ deleteColumn, vaultRecords: records }) })
    const pop = openMenu(el, 'Properties')
    for (const [label, disabled] of [['Name', true], ['Score', true], ['Folder pages', true], ['Status', false]] as const) {
      click(byLabel(pop, `Open ${label}`))
      const del = byLabel<HTMLButtonElement>(pop, `Delete column ${label}`)
      expect(del.disabled).toBe(disabled)
      expect(del.title).toBe(disabled ? 'Built-in column — hide it instead' : '')
      click(byLabel(pop, 'Back to columns'))
    }
  })

  it('a label shared by two rows — file.name and a `name` property both read "Name" — shows the key beside BOTH, and nowhere else (YAZ-1549)', () => {
    const records = [{ ...TEST_RECORDS[0], properties: { name: 'alias', status: 'idea' } }]
    const { el } = mount('views:\n  - type: table\n    name: T\n    order: [file.name, note.name, note.status]\n', { records, folderPage: testFolderPage({ vaultRecords: records }) })
    const pop = openMenu(el, 'Properties')
    const rows = [...pop.querySelectorAll<HTMLElement>('.view-prop')]
    const keyed = rows.map((row) => row.querySelector('.view-prop__name small')?.textContent ?? null)
    expect(keyed).toEqual(['file.name', 'note.name', null])
  })
})

describe('search, count and body', () => {
  it('search narrows the rows client-side and the count shows shown / total', () => {
    const { el, onChange } = mount()
    click(byLabel(el, 'Search'))
    const input = byLabel<HTMLInputElement>(el, 'Search rows')
    setValue(input, 'vsl')
    expect(rows(el)).toEqual(['VSL-v1'])
    expect(count(el)).toBe('1 / 8 items')
    expect(onChange).not.toHaveBeenCalled()
    press(input, 'Escape')
    expect(el.querySelector('[aria-label="Search rows"]')).toBeNull()
    expect(count(el)).toBe('8 items')
  })

  it('search matches any rendered value, not only the name', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n')
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'drafting')
    expect(rows(el)).toEqual(['The Levels of an Agency'])
  })

  it('a view limit also reduces the count to shown / total', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    limit: 3\n')
    expect(rows(el)).toHaveLength(3)
    expect(count(el)).toBe('3 / 8 items')
  })

  it('row links open the note; the other order values are the row cells (4B)', () => {
    const { el, onOpenFile } = mount('views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    expect(q(el, '[data-cell="0:1"]').textContent).toBe('idea')
    expect(q(el, '[data-cell="0:2"]').textContent).toBe('2')
    click(q(el, '.view-table__link'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })

  it('a corrupt properties.json shows its error banner but the rows still render (report-never-block)', () => {
    const { el } = mount(YASIN_BASE, { properties: { root: '/vault', version: 1, properties: {}, error: 'properties.json is not valid JSON: x' } })
    expect(q(el, '.views-pane__error').textContent).toBe("Could not load the vault's property declarations: properties.json is not valid JSON: x")
    expect(rows(el).length).toBeGreaterThan(0)
  })
})

/**
 * The report-don't-block footnote (YAZ-861). Both halves were produced on every render and read
 * by nobody until this line existed; neither may block a row, and neither is an `alert`.
 */
describe('the notes line', () => {
  it('says nothing at all when there is nothing to say', () => {
    const { el } = mount()
    expect(el.querySelector('.views-pane__notes')).toBeNull()
  })

  it("lists the settings' problems — the one-liners folderPageSettings collects while ignoring an unusable key", () => {
    const problems = ['folder_page_settings.folder must be a root-relative folder name — ignoring it']
    const { el } = mount(YASIN_BASE, { folderPage: testFolderPage({ settings: { columns: {}, views: [], problems } }) })
    const note = q<HTMLElement>(el, '.views-pane__notes')
    expect(note.getAttribute('role')).toBe('note') // a note, never an alert: nothing here failed
    expect(note.textContent).toBe(problems[0])
    expect(rows(el).length).toBeGreaterThan(0) // and it blocks nothing above it
  })

  it("lists the engine's compile errors, `where: message`, from a hand-written filters block", () => {
    const { el } = mount('filters: 1 +\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n')
    const note = q<HTMLElement>(el, '.views-pane__notes')
    expect(note.getAttribute('role')).toBe('note')
    expect(note.textContent).toMatch(/^filters: /)
  })

  it('joins both halves into ONE line — the settings first, then the engine', () => {
    const problems = ['folder_page_settings must be a map of settings — using the defaults']
    const { el } = mount('filters: 1 +\nviews:\n  - type: table\n    name: T\n    order:\n      - file.name\n', {
      folderPage: testFolderPage({ settings: { columns: {}, views: [], problems } }),
    })
    const notes = el.querySelectorAll('.views-pane__notes')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toBe(`${problems[0]} · filters: unexpected end of input`)
  })
})

describe('popover behaviour', () => {
  it('opens focused, closes on Escape and on click-away', () => {
    const { el } = mount()
    const pop = openMenu(el, 'Sort')
    expect(pop.contains(document.activeElement)).toBe(true)
    press(window as unknown as Element, 'Escape')
    expect(el.querySelector('.view-popover')).toBeNull()

    openMenu(el, 'Sort')
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    draw()
    expect(el.querySelector('.view-popover')).toBeNull()
  })
})

/**
 * "Sync from folder" (YAZ-953). The gesture appends a disk folder's notes to the outline DOCUMENT,
 * so the button rides that skin and no other: a table or a board has nothing to append them to.
 */
describe('sync from folder', () => {
  const OUTLINE = 'views:\n  - type: outline\n    name: Outline\n'

  it('the button is offered on the document skin, and only there', () => {
    expect(mount().el.querySelector('[aria-label="Sync from folder"]')).toBeNull() // the table skin
    expect(mount(OUTLINE).el.querySelector('[aria-label="Sync from folder"]')).toBeNull() // no folder page under it, no document
    expect(byLabel(mount(OUTLINE, { thisFile: '/vault/Topic.md' }).el, 'Sync from folder')).toBeDefined()
  })
})

/**
 * The saved starting view (YAZ-1104), RE-HOMED by YAZ-1471: `defaultView` rides in the DEF next to
 * `views:` (D4), so the dropdown travels the very door sort and columns travel — ONE `update`, one
 * settings write on the host — instead of a second `setDefaultView` door of its own. Which view is
 * ACTIVE still stays session state: the def's name only decides where an open STARTS.
 */
describe('the default view', () => {
  /** The test def with the saved START written into it, at the root next to `views:`. */
  const started = (name: string) => `${YASIN_BASE}defaultView: ${name}\n`

  it('seeds the starting tab from the def’s own defaultView', () => {
    expect(selected(mount(started('View 2')).el)).toBe('View 2')
  })

  it('a stale saved name starts on the first view', () => {
    expect(selected(mount(started('Ghost')).el)).toBe('Table')
  })

  it('the properties menu ends with Page → Default view, listing First view then every view', () => {
    const { el } = mount()
    const menu = openMenu(el, 'Properties')
    const select = byLabel<HTMLSelectElement>(menu, 'Default view')
    expect([...select.options].map((o) => o.text)).toEqual(['First view', 'Table', 'View', 'View 2'])
    expect(select.value).toBe('')
  })

  it('picking a view writes the def’s defaultView — ONE update, never a second door', () => {
    const { el, onChange, yaml } = mount()
    setValue(byLabel<HTMLSelectElement>(openMenu(el, 'Properties'), 'Default view'), 'View')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].def.defaultView).toBe('View')
    expect(yaml()).toContain('defaultView: View')
  })

  it('the dropdown reflects the def’s value, and First view DELETES the key', () => {
    const { el, onChange, yaml } = mount(started('View'))
    const select = byLabel<HTMLSelectElement>(openMenu(el, 'Properties'), 'Default view')
    expect(select.value).toBe('View')
    setValue(select, '')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].def).not.toHaveProperty('defaultView')
    expect(yaml()).not.toContain('defaultView')
  })
})

describe('properties drag-to-reorder (YAZ-1207)', () => {
  const THREE = 'views:\n  - type: table\n    name: T\n    order:\n      - file.name\n      - note.status\n      - note.priority\n'
  /** TabBar's jsdom reduction, vertical: all-zero rects mean the midpoint test is the SIGN of clientY. */
  const fire = (target: Element, type: string, clientY = 0) =>
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
  const grip = (pop: ParentNode, label: string) => byLabel<HTMLButtonElement>(pop, `Reorder ${label}`)
  const rowOf = (pop: ParentNode, label: string): HTMLElement => {
    const row = grip(pop, label).closest<HTMLElement>('.view-prop')
    if (row === null) throw new Error(`no row for ${label}`)
    return row
  }

  it('every SHOWN row has a grip — file.name included — hidden rows have none, and the arrows are gone', () => {
    const { el } = mount(THREE)
    const pop = openMenu(el, 'Properties')
    expect(grip(pop, 'Name')).toBeDefined()
    expect(grip(pop, 'Status')).toBeDefined()
    expect(grip(pop, 'Priority')).toBeDefined()
    // the menu offers more keys than the three shown ones; only shown rows carry grips
    expect(pop.querySelectorAll('[aria-label^="Reorder "]')).toHaveLength(3)
    expect(pop.querySelectorAll('.view-prop').length).toBeGreaterThan(3)
    expect(pop.querySelector('[aria-label="Move up"]')).toBeNull()
    expect(pop.querySelector('[aria-label="Move down"]')).toBeNull()
  })

  it('dragging file.name past the last row writes it last, in ONE write, with drag and insertion classes', () => {
    const { el, def, onChange } = mount(THREE)
    const pop = openMenu(el, 'Properties')
    fire(grip(pop, 'Name'), 'dragstart')
    expect(rowOf(pop, 'Name').classList.contains('view-prop--dragging')).toBe(true)
    fire(rowOf(pop, 'Priority'), 'dragover', 5) // below priority's midpoint → the end slot
    expect(rowOf(pop, 'Priority').classList.contains('view-prop--insert-after')).toBe(true)
    fire(rowOf(pop, 'Priority'), 'drop', 5)
    expect(def().views[0].order).toEqual(['note.status', 'note.priority', 'file.name'])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(pop.querySelector('.view-prop--dragging')).toBeNull()
    expect(pop.querySelector('.view-prop--insert-after')).toBeNull()
  })

  it('dragging the last row above the first inserts BEFORE it', () => {
    const { el, def } = mount(THREE)
    const pop = openMenu(el, 'Properties')
    fire(grip(pop, 'Priority'), 'dragstart')
    fire(rowOf(pop, 'Name'), 'dragover', -5)
    expect(rowOf(pop, 'Name').classList.contains('view-prop--insert-before')).toBe(true)
    fire(rowOf(pop, 'Name'), 'drop', -5)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
  })

  it('dropping on the grabbed slot is a no-op and dragend clears an abandoned drag', () => {
    const { el, onChange } = mount(THREE)
    const pop = openMenu(el, 'Properties')
    fire(grip(pop, 'Status'), 'dragstart')
    fire(rowOf(pop, 'Status'), 'drop', -5) // before itself = its own slot
    expect(onChange).not.toHaveBeenCalled()
    fire(grip(pop, 'Status'), 'dragstart')
    fire(grip(pop, 'Status'), 'dragend')
    expect(pop.querySelector('.view-prop--dragging')).toBeNull()
  })

  it('ArrowDown/ArrowUp on the grip nudge one step; the ends are no-ops', () => {
    const { el, def, onChange } = mount(THREE)
    const pop = openMenu(el, 'Properties')
    press(grip(pop, 'Name'), 'ArrowDown')
    expect(def().views[0].order).toEqual(['note.status', 'file.name', 'note.priority'])
    press(grip(pop, 'Name'), 'ArrowUp')
    expect(def().views[0].order).toEqual(['file.name', 'note.status', 'note.priority'])
    press(grip(pop, 'Name'), 'ArrowUp') // already first
    press(grip(pop, 'Priority'), 'ArrowDown') // already last
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('a drag reorder keeps frozenColumns following positionally, like the arrows did', () => {
    const { el, def } = mount('views:\n  - type: table\n    name: T\n    frozenColumns: 2\n    order:\n      - file.name\n      - note.status\n      - note.priority\n')
    const pop = openMenu(el, 'Properties')
    fire(grip(pop, 'Priority'), 'dragstart')
    fire(rowOf(pop, 'Name'), 'dragover', -5)
    fire(rowOf(pop, 'Name'), 'drop', -5)
    expect(def().views[0].order).toEqual(['note.priority', 'file.name', 'note.status'])
    expect(def().views[0].frozenColumns).toBe(2)
  })
})

describe('card style toggles (YAZ-1206/YAZ-1217): per-property cardStyle writes on board views', () => {
  const BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
      - note.status
      - note.priority
    groupBy:
      property: note.status
`
  it('note rows carry B / U / hide-label / join; the file.name row carries ONLY join; non-boards none', () => {
    const { el } = mount(BOARD)
    const pop = openMenu(el, 'Properties')
    // the LIST carries none of them (YAZ-1513); the detail does
    expect(pop.querySelector('[aria-label^="Bold "], [aria-label^="Join "]')).toBeNull()
    click(byLabel(pop, 'Open Status'))
    expect(byLabel(pop, 'Bold Status on cards')).toBeDefined()
    expect(byLabel(pop, 'Underline Status on cards')).toBeDefined()
    expect(byLabel(pop, 'Hide Status label on cards')).toBeDefined()
    expect(byLabel(pop, 'Join Status to the row above')).toBeDefined()
    click(byLabel(pop, 'Back to columns'))
    click(byLabel(pop, 'Open Name'))
    expect(byLabel(pop, 'Join Name to the row above')).toBeDefined()
    expect(pop.querySelector('[aria-label="Bold Name on cards"]')).toBeNull()
    expect(pop.querySelector('[aria-label$=" of the title"]')).toBeNull() // the old left/right pair is gone
  })

  it('non-board views offer no card-style toggles', () => {
    const { el } = mount() // YASIN_BASE, table active
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect(pop.querySelector('[aria-label^="Bold "]')).toBeNull()
    expect(pop.querySelector('[aria-label^="Join "]')).toBeNull()
  })

  it('toggling writes one cardStyle entry per click and toggling off cleans the YAML completely', () => {
    const { el, onChange, def, yaml } = mount(BOARD)
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    click(byLabel(pop, 'Bold Status on cards'))
    expect(def().views[0].cardStyle).toEqual({ 'note.status': { bold: true } })
    click(byLabel(pop, 'Join Status to the row above'))
    expect(def().views[0].cardStyle).toEqual({ 'note.status': { bold: true, join: true } })
    expect(onChange).toHaveBeenCalledTimes(2)
    click(byLabel(pop, 'Join Status to the row above'))
    click(byLabel(pop, 'Bold Status on cards'))
    expect(def().views[0].cardStyle).toBeUndefined()
    expect(yaml()).not.toContain('cardStyle')
  })

  it("file.name's join round-trips through its canonical cardStyle key", () => {
    const { el, def, yaml } = mount(BOARD)
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Name'))
    click(byLabel(pop, 'Join Name to the row above'))
    expect(def().views[0].cardStyle).toEqual({ 'file.name': { join: true } })
    click(byLabel(pop, 'Join Name to the row above'))
    expect(def().views[0].cardStyle).toBeUndefined()
    expect(yaml()).not.toContain('cardStyle')
  })

  it('pressed state reflects the YAML', () => {
    const { el } = mount(`views:
  - type: board
    name: B
    order:
      - file.name
      - note.status
    groupBy:
      property: note.status
    cardStyle:
      note.status: { bold: true, join: true }
`)
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect(byLabel(pop, 'Bold Status on cards').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel(pop, 'Join Status to the row above').getAttribute('aria-pressed')).toBe('true')
    expect(byLabel(pop, 'Underline Status on cards').getAttribute('aria-pressed')).toBe('false')
    click(byLabel(pop, 'Back to columns'))
    click(byLabel(pop, 'Open Name'))
    expect(byLabel(pop, 'Join Name to the row above').getAttribute('aria-pressed')).toBe('false')
  })
})

/**
 * Preview mode's eye (YAZ-1244): per-view `preview: true` in the views YAML. The toolbar reads
 * `view.preview` and writes through `onUpdate` — one write per toggle, and off CLEANS the key
 * (absent is off). Table and board only: cards/list have no preview, and the document skin has
 * no rows to hover.
 */
describe('preview mode toggle (YAZ-1244)', () => {
  const EYE = 'Preview on hover'
  const BOARD_VIEW = 'views:\n  - type: board\n    name: B\n    groupBy:\n      property: note.status\n'
  const OUTLINE_VIEW = 'views:\n  - type: outline\n    name: Outline\n'

  it('the eye is offered on table and board views only', () => {
    const { el } = mount()
    expect(byLabel(el, EYE)).toBeDefined()
    click(byText(el, '[role="tab"]', 'View')) // the cards view
    expect(el.querySelector(`[aria-label="${EYE}"]`)).toBeNull()
    expect(byLabel(mount(BOARD_VIEW).el, EYE)).toBeDefined()
    expect(mount(OUTLINE_VIEW, { thisFile: '/vault/Topic.md' }).el.querySelector(`[aria-label="${EYE}"]`)).toBeNull()
  })

  it('toggling writes preview: true in ONE write and toggling off cleans the YAML', () => {
    const { el, def, yaml, onChange } = mount()
    click(byLabel(el, EYE))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].preview).toBe(true)
    expect(yaml()).toContain('preview: true')
    expect(def().views[1].preview).toBeUndefined()
    expect(def().views[2].preview).toBeUndefined()
    click(byLabel(el, EYE))
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(def().views[0].preview).toBeUndefined()
    expect(yaml()).not.toContain('preview')
  })

  it('pressed state reflects the YAML', () => {
    const { el } = mount('views:\n  - type: table\n    name: T\n    preview: true\n')
    const on = byLabel(el, EYE)
    expect(on.getAttribute('aria-pressed')).toBe('true')
    expect(on.className).toContain('view-toolbar__btn--on')
    const { el: el2 } = mount()
    const off = byLabel(el2, EYE)
    expect(off.getAttribute('aria-pressed')).toBe('false')
    expect(off.className).not.toContain('view-toolbar__btn--on')
  })
})

describe('searchable column controls (YAZ-1395–1397)', () => {
  const SEARCHABLE = `properties:
  status: { displayName: Stage }
views:
  - type: table
    name: Table
    order: [status, file.name, note.priority]
    frozenColumns: 3
    sort: [{ property: status, direction: DESC }]
  - type: board
    name: Board
    order: [file.name]
    groupBy: { property: note.status }
`
  const shownLabels = (pop: ParentNode) => [...pop.querySelectorAll<HTMLInputElement>('input[aria-label^="Show "]')].map((input) => input.getAttribute('aria-label'))

  it('matches display labels and raw canonical keys without saving search or changing row search', () => {
    const { el, onChange, yaml } = mount(SEARCHABLE)
    const before = yaml()
    const pop = openMenu(el, 'Properties')
    const search = byLabel<HTMLInputElement>(pop, 'Search columns')
    setValue(search, '  sTaGe  ')
    expect(shownLabels(pop)).toEqual(['Show Stage'])
    setValue(search, 'note.status')
    expect(shownLabels(pop)).toEqual(['Show Stage'])
    expect(count(el)).toBe('8 items')
    expect(yaml()).toBe(before)
    expect(onChange).not.toHaveBeenCalled()
    click(byLabel(el, 'Properties'))
    const reopened = openMenu(el, 'Properties')
    expect(byLabel<HTMLInputElement>(reopened, 'Search columns').value).toBe('')
    expect(shownLabels(reopened).length).toBeGreaterThan(1)
  })

  it.each(['Table', 'Board'])('filtered bulk operations affect only matches in %s and preserve canonical identity', (tab) => {
    const { el, def, onChange, yaml } = mount(SEARCHABLE)
    if (tab === 'Board') click(byText(el, '[role="tab"]', tab))
    const index = tab === 'Table' ? 0 : 1
    const other = structuredClone(def().views[1 - index])
    const pop = openMenu(el, 'Properties')
    const search = byLabel<HTMLInputElement>(pop, 'Search columns')
    setValue(search, 'status')
    const before = def().views[index].order!
    click(byText(pop, 'button', 'Unselect results'))
    const expected = before.filter((key) => key !== 'status' && key !== 'note.status')
    expect(def().views[index].order).toEqual(expected)
    expect(def().views[1 - index]).toEqual(other)
    click(byText(pop, 'button', 'Select results'))
    const after = def().views[index].order!
    expect(after.slice(0, -1)).toEqual(expected)
    expect(after.filter((key) => key === 'status' || key === 'note.status')).toHaveLength(1)
    expect(byText<HTMLButtonElement>(pop, 'button', 'Select results').disabled).toBe(true)
    click(byText(pop, 'button', 'Select results'))
    expect(onChange).toHaveBeenCalledTimes(tab === 'Table' ? 2 : 1)
    expect(parseViews(yaml()).def).toEqual(def())
  })

  it('filtered removal clamps the frozen prefix, and clearing the last match removes it', () => {
    const { el, def, onChange } = mount(SEARCHABLE)
    const pop = openMenu(el, 'Properties')
    setValue(byLabel(pop, 'Search columns'), 'status')
    click(byText(pop, 'button', 'Unselect results'))
    expect(def().views[0].order).toEqual(['file.name', 'note.priority'])
    expect(def().views[0].frozenColumns).toBe(2)
    setValue(byLabel(pop, 'Search columns'), 'priority')
    click(byText(pop, 'button', 'Unselect results'))
    setValue(byLabel(pop, 'Search columns'), 'file.name')
    click(byText(pop, 'button', 'Unselect results'))
    expect(def().views[0].order).toEqual([])
    expect(def().views[0].frozenColumns).toBeUndefined()
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('empty results disable bulk operations, and clearing search restores original grips and order', () => {
    const { el, def, onChange } = mount(SEARCHABLE)
    const pop = openMenu(el, 'Properties')
    const original = [...pop.querySelectorAll('[aria-label^="Reorder "]')].map((grip) => grip.getAttribute('aria-label'))
    setValue(byLabel(pop, 'Search columns'), 'status')
    expect(pop.querySelector('[aria-label^="Reorder "]')).toBeNull()
    setValue(byLabel(pop, 'Search columns'), 'no-such-column')
    expect(shownLabels(pop)).toEqual([])
    for (const label of ['Select results', 'Unselect results']) {
      const button = byText<HTMLButtonElement>(pop, 'button', label)
      expect(button.disabled).toBe(true)
      click(button)
    }
    setValue(byLabel(pop, 'Search columns'), '')
    expect([...pop.querySelectorAll('[aria-label^="Reorder "]')].map((grip) => grip.getAttribute('aria-label'))).toEqual(original)
    expect(def().views[0].order).toEqual(['status', 'file.name', 'note.priority'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a single chooser searches labels and keys, then commits exactly once without losing direction', () => {
    const { el, def, onChange } = mount(SEARCHABLE)
    const pop = openMenu(el, 'Sort')
    chooseColumn(pop, 'Sort property', 'note.status')
    expect(onChange).not.toHaveBeenCalled()
    expect(def().views[0].sort?.[0].property).toBe('status')
    click(byLabel(pop, 'Sort property'))
    const search = byLabel<HTMLInputElement>(pop, 'Search sort property columns')
    setValue(search, 'stage')
    expect([...pop.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.dataset.value)).toEqual(['note.status'])
    setValue(search, 'note.priority')
    expect(onChange).not.toHaveBeenCalled()
    chooseColumn(pop, 'Sort property', 'note.priority')
    expect(def().views[0].sort).toEqual([{ property: 'note.priority', direction: 'DESC' }])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(pop.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(byLabel(pop, 'Sort property'))
  })

  it('picker Escape closes only the chooser without saving; keyboard selection commits once', () => {
    const { el, onChange, def } = mount(SEARCHABLE)
    const pop = openMenu(el, 'Sort')
    click(byLabel(pop, 'Group by'))
    let search = byLabel<HTMLInputElement>(pop, 'Search group by columns')
    setValue(search, 'no-such-column')
    press(search, 'Enter')
    expect(onChange).not.toHaveBeenCalled()
    press(search, 'Escape')
    expect(el.querySelector('.view-popover')).toBe(pop)
    expect(pop.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(byLabel(pop, 'Group by'))
    click(byLabel(pop, 'Group by'))
    search = byLabel<HTMLInputElement>(pop, 'Search group by columns')
    expect(search.value).toBe('')
    setValue(search, 'note.priority')
    press(search, 'ArrowDown')
    press(search, 'Enter')
    expect(def().views[0].groupBy).toEqual({ property: 'note.priority', direction: 'ASC' })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('declared-only columns remain available in Properties and Sort', () => {
    const { el, onChange } = mount(SEARCHABLE, {
      folderPage: testFolderPage({ settings: { columns: { owner: { kind: 'text' } }, views: [], problems: [] } }),
    })
    const properties = openMenu(el, 'Properties')
    setValue(byLabel(properties, 'Search columns'), 'owner')
    expect(byLabel(properties, 'Show Owner')).toBeDefined()
    const pop = openMenu(el, 'Sort')
    click(byLabel(pop, 'Sort property'))
    setValue(byLabel(pop, 'Search sort property columns'), 'owner')
    expect(pop.querySelector('[role="option"][data-value="note.owner"]')).not.toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('grouped board keeps collapse beside preview and creation immediately before search', () => {
    const { el, onChange } = mount(SEARCHABLE)
    click(byText(el, '[role="tab"]', 'Board'))
    const actions = q(el, '.view-toolbar__actions')
    expect([...actions.querySelectorAll('.view-toolbar__btn')].map((button) => button.getAttribute('aria-label'))).toEqual([
      'Sort', 'Properties', 'Filter', 'Collapse all groups', 'Preview on hover', 'New note', 'Search',
    ])
    expect(actions.lastElementChild?.className).toBe('view-toolbar__count')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('sort rule drag and keyboard reordering (YAZ-1396)', () => {
  const SORTS = `views:
  - type: table
    name: Table
    sort:
      - { property: note.status, direction: DESC }
      - { property: file.name, direction: ASC }
      - { property: note.priority, direction: DESC }
`
  const fire = (target: Element, type: string, clientY = 0) => {
    act(() => void target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY })))
    draw()
  }
  const grip = (pop: ParentNode, index: number, label: string) => byLabel<HTMLButtonElement>(pop, `Reorder sort ${index}: ${label}`)
  const row = (pop: ParentNode, index: number, label: string) => grip(pop, index, label).closest<HTMLElement>('.view-rule')!

  it('drag moves a whole rule to the insertion slot in one saved write', () => {
    const { el, def, onChange, yaml } = mount(SORTS)
    const original = structuredClone(def().views[0].sort!)
    const pop = openMenu(el, 'Sort')
    expect(pop.querySelector('[aria-label="Move up"], [aria-label="Move down"]')).toBeNull()
    fire(grip(pop, 1, 'Status'), 'dragstart')
    fire(row(pop, 3, 'Priority'), 'dragover', 5)
    expect(onChange).not.toHaveBeenCalled()
    fire(row(pop, 3, 'Priority'), 'drop', 5)
    expect(def().views[0].sort).toEqual([original[1], original[2], original[0]])
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(parseViews(yaml()).def).toEqual(def())
    fire(grip(pop, 3, 'Status'), 'dragstart')
    fire(row(pop, 1, 'Name'), 'dragover', -5)
    fire(row(pop, 1, 'Name'), 'drop', -5)
    expect(def().views[0].sort).toEqual(original)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('keyboard moves retain focus on the moved rule, and boundaries do not save', () => {
    const { el, def, onChange } = mount(SORTS)
    const pop = openMenu(el, 'Sort')
    const original = structuredClone(def().views[0].sort!)
    const first = grip(pop, 1, 'Status')
    first.focus()
    press(first, 'ArrowUp')
    expect(onChange).not.toHaveBeenCalled()
    press(first, 'ArrowDown')
    expect(def().views[0].sort).toEqual([original[1], original[0], original[2]])
    expect(document.activeElement).toBe(grip(pop, 2, 'Status'))
    press(grip(pop, 2, 'Status'), 'ArrowUp')
    press(grip(pop, 3, 'Priority'), 'ArrowDown')
    expect(def().views[0].sort).toEqual(original)
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('same-slot drops and abandoned drags do not save or leak into later drags', () => {
    const { el, def, onChange } = mount(SORTS)
    const before = structuredClone(def())
    const pop = openMenu(el, 'Sort')
    fire(grip(pop, 2, 'Name'), 'dragstart')
    fire(row(pop, 2, 'Name'), 'drop', -5)
    fire(grip(pop, 1, 'Status'), 'dragstart')
    fire(row(pop, 3, 'Priority'), 'dragover', 5)
    fire(grip(pop, 1, 'Status'), 'dragend')
    fire(row(pop, 3, 'Priority'), 'drop', 5)
    expect(def()).toEqual(before)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('duplicate properties remain independent through reorder, removal, and adding a new rule', () => {
    const { el, def, onChange } = mount(`views:
  - type: table
    name: Table
    sort:
      - { property: file.name, direction: ASC }
      - { property: file.name, direction: DESC }
`)
    const pop = openMenu(el, 'Sort')
    const second = grip(pop, 2, 'Name')
    second.focus()
    press(second, 'ArrowUp')
    expect(def().views[0].sort).toEqual([
      { property: 'file.name', direction: 'DESC' },
      { property: 'file.name', direction: 'ASC' },
    ])
    expect(document.activeElement).toBe(grip(pop, 1, 'Name'))
    click(byLabel(pop, 'Remove sort'))
    click(byText(pop, 'button', 'Add sort'))
    click([...pop.querySelectorAll<HTMLElement>('[aria-label="Direction"]')][1])
    expect(def().views[0].sort).toEqual([
      { property: 'file.name', direction: 'ASC' },
      { property: 'file.name', direction: 'DESC' },
    ])
    expect(onChange).toHaveBeenCalledTimes(4)
  })
})


describe('folder-local relation shortcut', () => {
  it('uses the local declaration over a legacy vault default and saves only through setColumn', async () => {
    const setColumn = vi.fn().mockResolvedValue(undefined)
    const base = { kind: 'link' as const, target: '[[Local People]]' }
    const properties = { root: '/vault', version: 1, properties: { owner: { kind: 'multi-link' as const, target: '[[Global People]]' } } }
    const { el, onChange } = mount(undefined, { root: '/vault', properties, folderPage: testFolderPage({ settings: { columns: { owner: base }, views: [], problems: [] }, setColumn }) })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Owner'))
    expect(byLabel<HTMLInputElement>(pop, 'Link target').value).toBe('[[Local People]]') // the local declaration, not the legacy one
    type(byLabel(pop, 'Link target'), '[[Teams]]')
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('owner', { kind: 'link', target: '[[Teams]]' }, base)
    expect(properties.properties.owner).toEqual({ kind: 'multi-link', target: '[[Global People]]' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Make relation seeds from legacy metadata against a missing local base, in ONE immediate write; nothing is written before the click', async () => {
    const legacy = { kind: 'multi-link' as const, target: '[[Global People]]' }
    const { setColumn, folderPage } = aheadHost({})
    const { el } = mount(undefined, { root: '/vault', properties: { root: '/vault', version: 1, properties: { status: legacy } }, folderPage })
    const pop = openMenu(el, 'Properties')
    click(byLabel(pop, 'Open Status'))
    expect(setColumn).not.toHaveBeenCalled()
    click(byLabel(pop, 'Relation for Status'))
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('status', legacy, undefined)
    await settle()
    // the panel now holds a link kind: the target is inline and the type select says so
    expect(byLabel<HTMLSelectElement>(pop, 'Edit property Status').value).toBe('multi-link')
    expect(byLabel<HTMLInputElement>(pop, 'Link target').value).toBe(legacy.target)
  })
})
