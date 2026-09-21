/**
 * Number children menu row (YAZ-729) through the real createCrepe wiring: label flips with the
 * child list state, the click round-trips the markdown, and the row is disabled off a list item.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; item: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.dispatch(view.state.tr)
  const handle = document.createElement('div')
  handle.className = 'milkdown-block-handle'
  const item = document.createElement('div')
  item.className = 'operation-item'
  handle.appendChild(item)
  view.dom.parentElement!.appendChild(handle)
  handle.getBoundingClientRect = () => ({ right: 0 }) as DOMRect
  return { crepe, view, item }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Point the handle at the list_item (by its first paragraph) or heading that reads `label`. */
function aimAt(view: EditorView, label: string): void {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found !== -1) return
    if (node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
    if (node.type.name === 'heading' && node.textContent === label) found = pos
  })
  if (found === -1) throw new Error(`block not found: ${label}`)
  view.posAtCoords = () => ({ pos: found + 1, inside: found })
}

const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rowOf = (view: EditorView) => {
  const rows = popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item')
  expect(rows).toHaveLength(1)
  return rows[0]!
}
const rightClick = (item: HTMLElement) =>
  item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))

const TREE = '* Fundamentals\n  * Setup\n    * deep\n  * VS Code\n'

describe('numberChildrenRow', () => {
  it('numbers then re-bullets the direct children, closes, and returns focus', async () => {
    const { crepe, view, item } = await mount(TREE)
    aimAt(view, 'Fundamentals')
    rightClick(item)
    let row = rowOf(view)
    expect(row.textContent).toBe('Number children')
    expect(row.disabled).toBe(false)
    row.click()
    expect(getMarkdownForSave(crepe)).toBe('* Fundamentals\n  1. Setup\n     * deep\n  2. VS Code\n')
    expect(popupOf(view)).toBeNull()
    expect(view.dom.contains(document.activeElement)).toBe(true)

    rightClick(item)
    row = rowOf(view)
    expect(row.textContent).toBe('Bullet children')
    row.click()
    expect(getMarkdownForSave(crepe)).toBe(TREE)
  })

  it('is disabled on a leaf item', async () => {
    const { crepe, view, item } = await mount(TREE)
    aimAt(view, 'deep')
    rightClick(item)
    const row = rowOf(view)
    expect(row.hasAttribute('disabled')).toBe(true)
    row.click()
    expect(getMarkdownForSave(crepe)).toBe(TREE)
  })

  it('is disabled on a heading', async () => {
    const { view, item } = await mount('# H\n\ntext\n')
    aimAt(view, 'H')
    rightClick(item)
    expect(rowOf(view).hasAttribute('disabled')).toBe(true)
  })
})
