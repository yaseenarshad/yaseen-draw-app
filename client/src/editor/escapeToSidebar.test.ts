/**
 * Escape steps OUT of the text, back to the sidebar's active row (YAZ-947, `createCrepe.ts`
 * `escapeToSidebar`) — the walk resumes where the page was picked. Pinned through a REAL Crepe
 * (the wikilinkPicker.test.ts idiom): priority 10, so the `[[` picker's dismiss (100) wins while
 * it is open, and the command DECLINES when no tree row is on screen — Esc stays free elsewhere.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'
import { nameCandidate } from '../links/completion'
import { WIKILINK_PICKER_CLASS, createWikilinkCandidateSource } from './wikilink/wikilinkPicker'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const candidates = createWikilinkCandidateSource()
  candidates.update([nameCandidate('Alpha')])
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinkCandidates: candidates })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  view.focus()
  return { crepe, view }
}

/** A sidebar row stand-in — the keymap looks the ACTIVE row up by class, like the commit gesture. */
function treeRow(active: boolean): HTMLElement {
  const row = document.createElement('button')
  row.className = active ? 'tree__row tree__row--active' : 'tree__row'
  document.body.appendChild(row)
  return row
}

function press(view: EditorView, key: string): boolean {
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode: 27, bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

const typeText = (view: EditorView, text: string): void => view.dispatch(view.state.tr.insertText(text))

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll('.tree__row, .sidebar__search-input').forEach((el) => el.remove())
  document.querySelectorAll(`.${WIKILINK_PICKER_CLASS}`).forEach((el) => el.remove())
})

describe('Escape returns to the sidebar (YAZ-947)', () => {
  it('lands focus on the ACTIVE tree row, and claims the key', async () => {
    treeRow(false)
    const active = treeRow(true)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(active)
  })

  it('falls back to the FIRST row when no row is active', async () => {
    const first = treeRow(false)
    treeRow(false)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(first)
  })

  it('returns to the SEARCH BAR while a query stands — the list is driven from it (YAZ-961)', async () => {
    // Search REPLACES the tree's body (🔒 D5), so there are no rows to land on: the walk lives
    // in the input, and the selection it drives is waiting there untouched.
    const input = document.createElement('input')
    input.className = 'sidebar__search-input'
    input.value = 'cac'
    document.body.appendChild(input)
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(true)
    expect(document.activeElement).toBe(input)
    input.remove()
  })

  it('DECLINES with no tree on screen — Esc falls through untouched', async () => {
    const { view } = await mount('words\n')
    expect(press(view, 'Escape')).toBe(false)
  })

  it('an OPEN [[ picker wins the key: the first Esc dismisses it, the second exits to the row', async () => {
    const active = treeRow(true)
    const { view } = await mount('start\n')
    const end = view.state.doc.content.size - 1
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
    typeText(view, '[[al')
    expect(document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).not.toBeNull()
    expect(press(view, 'Escape')).toBe(true) // the picker's dismiss (priority 100)
    expect(document.activeElement).not.toBe(active)
    expect(press(view, 'Escape')).toBe(true) // nothing above wants it now — out to the walk
    expect(document.activeElement).toBe(active)
  })
})
