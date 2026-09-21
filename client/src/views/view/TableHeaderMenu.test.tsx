/**
 * The table header's context menu (YAZ-1513): ViewsPane mounted with react-dom in jsdom over
 * `TEST_RECORDS`; a right-click on a column `<th>` offers Rename / Hide / Add-to-the-right, and
 * on the `#` header only Hide row numbers. Every write is one `onChange` (the Properties menu's own
 * rules: `setDisplayName`, `setViewOrder`) or one `setColumns` — the folder page host's door.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { type ParsedViews, type ViewSet, parseViews, serializeViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'
import { insertAfter } from './TableHeaderMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const BASE = `views:
  - type: table
    name: T
    frozenColumns: 2
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
  const setColumns = vi.fn()
  const deleteColumn = vi.fn(async () => {})
  const folderPage = testFolderPage({ settings: { columns: { status: { kind: 'text' } }, views: [], problems: [] }, setColumns, deleteColumn })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane parsed={parsed} onChange={onChange} root="/vault" thisFile="/vault/pillars.md" records={TEST_RECORDS} folderPage={folderPage} onOpenFile={vi.fn()} {...props} />,
      ),
    )
  draw()
  return { el: container, onChange, setColumns, deleteColumn, yaml: () => serializeViews(parsed), def: (): ViewSet => parsed.def }
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.restoreAllMocks()
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

function rightClick(el: EventTarget): void {
  act(() => void el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 20 })))
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

const headers = (el: ParentNode): string[] => [...el.querySelectorAll('.view-table thead th:not(.view-table__gutter)')].map((t) => t.textContent ?? '')
const th = (el: ParentNode, index: number): HTMLElement => [...el.querySelectorAll<HTMLElement>('.view-table thead th:not(.view-table__gutter)')][index]
const menuItems = (el: ParentNode): string[] => [...el.querySelectorAll('.ctx-menu [role="menuitem"]')].map((b) => b.textContent ?? '')
const item = (el: ParentNode, text: string): HTMLElement => {
  const n = [...el.querySelectorAll<HTMLElement>('.ctx-menu [role="menuitem"]')].find((b) => b.textContent === text)
  if (n === undefined) throw new Error(`missing menu item ${text}`)
  return n
}

// ---------- tests ----------

describe('the header menu (YAZ-1513)', () => {
  it('opens on a column header with Rename / Hide / Add to the right; Escape closes it without a write', () => {
    const { el, onChange } = mount()
    expect(el.querySelector('.ctx-menu')).toBeNull()
    rightClick(th(el, 1))
    expect(menuItems(el)).toEqual(['Rename column…', 'Hide column', 'Add column to the right…', 'Delete column…'])
    press(window.document.body, 'Escape')
    expect(el.querySelector('.ctx-menu')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Rename column…: an inline field prefilled with the current label; Enter writes def.properties[key].displayName', () => {
    const { el, onChange, def, yaml } = mount()
    expect(headers(el)).toEqual(['Name', 'Status', 'Priority'])
    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Status"]')
    expect(field.value).toBe('') // no stored name yet: the default label is the placeholder (YAZ-1549)
    expect(field.placeholder).toBe('Status')

    setValue(field, 'Stage')
    press(field, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toEqual({ status: { displayName: 'Stage' } })
    expect(yaml()).toContain('displayName: Stage')
    expect(headers(el)).toEqual(['Name', 'Stage', 'Priority'])
    expect(el.querySelector('.ctx-menu')).toBeNull() // done closes the menu
    // the KEY is untouched
    expect(def().views[0].order).toEqual(['file.name', 'note.status', 'note.priority'])
  })

  it('Rename column…: an emptied field clears the label back to the default and leaves no key behind; Esc cancels', () => {
    const { el, onChange, def, yaml } = mount(`${BASE}properties:\n  status:\n    displayName: Stage\n`)
    expect(headers(el)[1]).toBe('Stage')
    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const field = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Stage"]')
    expect(field.value).toBe('Stage') // the stored name, editable as-is
    expect(field.placeholder).toBe('Status')
    setValue(field, 'Nope')
    press(field, 'Escape')
    expect(onChange).not.toHaveBeenCalled()
    expect(headers(el)[1]).toBe('Stage')
    expect(el.querySelector('.ctx-menu')).toBeNull()

    rightClick(th(el, 1))
    click(item(el, 'Rename column…'))
    const again = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Rename Stage"]')
    setValue(again, '')
    press(again, 'Enter')
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().properties).toBeUndefined()
    expect(yaml()).not.toContain('displayName')
    expect(headers(el)[1]).toBe('Status')
  })

  it('Hide column removes the key from view.order and clamps frozenColumns — file.name included, a table may hide it (YAZ-1007)', () => {
    const { el, onChange, def } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Hide column'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].order).toEqual(['file.name', 'note.priority'])
    expect(def().views[0].frozenColumns).toBe(2)
    expect(headers(el)).toEqual(['Name', 'Priority'])

    rightClick(th(el, 0))
    click(item(el, 'Hide column'))
    expect(def().views[0].order).toEqual(['note.priority'])
    expect(def().views[0].frozenColumns).toBe(1)
    expect(headers(el)).toEqual(['Priority'])
  })

  it('Add column to the right…: the "+ Add column" form, declaring through setColumns with the new key inserted right after this column', () => {
    const { el, onChange, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    const name = q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]')
    setValue(name, 'owner')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))

    expect(setColumns).toHaveBeenCalledExactlyOnceWith(
      { status: { kind: 'text' }, owner: { kind: 'text' } },
      [{ type: 'table', name: 'T', frozenColumns: 2, order: ['file.name', 'note.owner', 'note.status', 'note.priority'] }],
    )
    expect(onChange).not.toHaveBeenCalled() // ONE write, the host's
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('Add column to the right… refuses a key the page already offers, and Cancel closes without a write', () => {
    const { el, setColumns } = mount()
    rightClick(th(el, 0))
    click(item(el, 'Add column to the right…'))
    setValue(q<HTMLInputElement>(el, '.ctx-menu input[aria-label="Column name"]'), 'status')
    click(q(el, '.ctx-menu [aria-label="Save column"]'))
    expect(q(el, '.ctx-menu [role="alert"]').textContent).toBe('status is already a column')
    expect(setColumns).not.toHaveBeenCalled()
    click(q(el, '.ctx-menu [aria-label="Cancel column"]'))
    expect(el.querySelector('.ctx-menu')).toBeNull()
  })

  it('the # header offers only Hide row numbers, which writes rowNumbers: false', () => {
    const { el, onChange, def, yaml } = mount()
    rightClick(q(el, '.view-table thead th.view-table__gutter'))
    expect(menuItems(el)).toEqual(['Hide row numbers'])
    click(item(el, 'Hide row numbers'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(def().views[0].rowNumbers).toBe(false)
    expect(yaml()).toContain('rowNumbers: false')
    expect(el.querySelector('.view-table__gutter')).toBeNull()
  })

  it('Delete column…: asks first — the sheet names the label, the key and the carrying-member count; Cancel deletes nothing', () => {
    const { el, deleteColumn, onChange } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    expect(el.querySelector('.ctx-menu')).toBeNull() // the menu yields to the sheet
    const sheet = q<HTMLElement>(el, '.confirm[role="dialog"]')
    // TEST_RECORDS: five of the eight carry `status`
    expect(q(sheet, '.confirm__text').textContent).toBe('Delete "Status"? This removes the column from this page and the "status" value from 5 notes.')
    expect(document.activeElement?.textContent).toBe('Cancel')
    click([...sheet.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Cancel')!)
    expect(el.querySelector('.confirm')).toBeNull()
    expect(deleteColumn).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('Delete column…: confirming hands the key to FolderPageMode.deleteColumn — the ONE function — and closes the sheet', () => {
    const { el, deleteColumn } = mount()
    rightClick(th(el, 1))
    click(item(el, 'Delete column…'))
    click([...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === 'Delete')!)
    expect(deleteColumn).toHaveBeenCalledExactlyOnceWith('note.status')
    expect(el.querySelector('.confirm')).toBeNull()
  })

  it('Delete column… is disabled with the tooltip on file.name — hide it instead', () => {
    const { el } = mount()
    rightClick(th(el, 0))
    const del = item(el, 'Delete column…') as HTMLButtonElement
    expect(del.disabled).toBe(true)
    expect(del.title).toBe('Built-in column — hide it instead')
    press(window.document.body, 'Escape')
    rightClick(th(el, 1))
    expect((item(el, 'Delete column…') as HTMLButtonElement).disabled).toBe(false)
  })

  it('insertAfter lands the key right after its anchor, or last when the anchor is not shown', () => {
    expect(insertAfter(['file.name', 'note.a', 'note.b'], 'note.a', 'note.x')).toEqual(['file.name', 'note.a', 'note.x', 'note.b'])
    expect(insertAfter(['file.name', 'a'], 'note.a', 'note.x')).toEqual(['file.name', 'a', 'note.x']) // canonical match
    expect(insertAfter(['file.name'], 'note.gone', 'note.x')).toEqual(['file.name', 'note.x'])
  })
})
