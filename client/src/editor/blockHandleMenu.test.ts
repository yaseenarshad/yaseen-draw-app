/**
 * Block handle menu (YAZ-726) on a real Crepe in jsdom. The Crepe is built directly (not via
 * createCrepe) because createCrepe already registers the menu with the real numberChildrenRow
 * provider, whose capture contextmenu listener would swallow the event before the test's provider ran.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createBlockHandleMenu, type MenuRow, type RowProvider } from './blockHandleMenu'
import { features } from './featureConfig'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(rows: RowProvider): Promise<{ crepe: Crepe; view: EditorView; handle: HTMLElement; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = new Crepe({ root, defaultValue: 'alpha\n\nbravo\n', features })
  crepe.editor.use(createBlockHandleMenu(rows))
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  view.posAtCoords = () => ({ pos: 1, inside: 0 })
  return { crepe, view, handle, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** The popup exists only while open. */
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const itemsOf = (view: EditorView) => Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))

function contextmenu(target: Element): MouseEvent {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })
  target.dispatchEvent(e)
  return e
}

const twoRows = (): MenuRow[] => [
  { label: 'One', run: vi.fn() },
  { label: 'Two', run: vi.fn() },
]

describe('open', () => {
  it('renders the provider rows at the pointer and prevents the native menu', async () => {
    const { view, item } = await mount(twoRows)
    const e = contextmenu(item)
    expect(e.defaultPrevented).toBe(true)
    expect(popupOf(view)).not.toBeNull()
    expect(itemsOf(view).map((b) => b.textContent)).toEqual(['One', 'Two'])
  })

  it('click runs the row once and closes', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [{ label: 'Go', run }])
    contextmenu(item)
    itemsOf(view)[0]!.click()
    expect(run).toHaveBeenCalledTimes(1)
    expect(popupOf(view)).toBeNull()
  })

  it('disabled row carries the attribute and does not run', async () => {
    const run = vi.fn()
    const { view, item } = await mount(() => [{ label: 'Nope', disabled: true, run }])
    contextmenu(item)
    const [button] = itemsOf(view)
    expect(button!.hasAttribute('disabled')).toBe(true)
    button!.click()
    expect(run).not.toHaveBeenCalled()
  })

  it('never shows for an empty provider', async () => {
    const { view, item } = await mount(() => [])
    contextmenu(item)
    expect(popupOf(view)).toBeNull()
  })

  it('ignores a contextmenu on a paragraph', async () => {
    const { view } = await mount(twoRows)
    const e = contextmenu(view.dom.querySelector('p')!)
    expect(e.defaultPrevented).toBe(false)
    expect(popupOf(view)).toBeNull()
  })
})

describe('dismiss', () => {
  const cases: Array<[string, (view: EditorView) => void]> = [
    ['outside mousedown', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['scroll', () => document.body.dispatchEvent(new Event('scroll', { bubbles: true }))],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['doc change', (view) => view.dispatch(view.state.tr.insertText('x', 1))],
  ]
  for (const [name, dismiss] of cases) {
    it(name, async () => {
      const { view, item } = await mount(twoRows)
      contextmenu(item)
      expect(popupOf(view)).not.toBeNull()
      dismiss(view)
      expect(popupOf(view)).toBeNull()
    })
  }

  it('mousedown inside the popup keeps it open', async () => {
    const { view, item } = await mount(twoRows)
    contextmenu(item)
    itemsOf(view)[0]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(popupOf(view)).not.toBeNull()
  })
})

describe('ownership', () => {
  it('only the handle owner opens', async () => {
    const a = await mount(twoRows)
    const b = await mount(twoRows)
    contextmenu(b.item)
    expect(popupOf(a.view)).toBeNull()
    expect(popupOf(b.view)).not.toBeNull()
    contextmenu(a.item)
    expect(popupOf(a.view)).not.toBeNull()
  })
})

describe('suppressing Crepe', () => {
  it('stops right-button mousedown/mouseup at the handle, lets left-button through', async () => {
    const { item } = await mount(twoRows)
    const down = vi.fn()
    const up = vi.fn()
    item.addEventListener('mousedown', down)
    item.addEventListener('mouseup', up)
    item.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
    item.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }))
    expect(down).not.toHaveBeenCalled()
    expect(up).not.toHaveBeenCalled()
    item.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }))
    expect(down).toHaveBeenCalledTimes(1)
  })
})

describe('destroy', () => {
  it('removes the popup and stops listening', async () => {
    const { crepe, view, item } = await mount(twoRows)
    const parent = view.dom.parentElement!
    contextmenu(item)
    expect(popupOf(view)).not.toBeNull()
    await crepe.destroy()
    mounted.splice(0)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
    // `item` stays inside the editor's parent so a leaked listener would still match own().
    const down = vi.fn()
    item.addEventListener('mousedown', down)
    item.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }))
    expect(down).toHaveBeenCalledTimes(1)
    expect(contextmenu(item).defaultPrevented).toBe(false)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
  })
})
