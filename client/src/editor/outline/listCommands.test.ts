/**
 * Outliner list commands (GRO-2012): the real editor (`createCrepe`) on a 4-level fixture,
 * keys dispatched through ProseMirror's `handleKeyDown` (so Crepe's own keymaps, the indent
 * plugin and our `outlinerKeymap` all take part, in priority order), then the serialised
 * markdown (`getMarkdownForSave`) is asserted — markers and indent must match depth exactly,
 * which is what bit GRO-1844. Empty bullets serialise as a bare `*` (`listItemRoundTrip.ts`);
 * empty task items as `* [ ]`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { OUTLINE_TOGGLE_CLASS } from './outlineFolding'

const OUTLINE = `* L1 a
  * L2 a
    * L3 a
      * L4 a
    * L3 b
  * L2 b
* L1 b
* L1 c
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown = OUTLINE): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

type Key = 'Tab' | 'Shift-Tab' | 'Enter' | 'Backspace'

function press(crepe: Crepe, key: Key): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const name = key === 'Shift-Tab' ? 'Tab' : key
    const event = new KeyboardEvent('keydown', { key: name, code: name, shiftKey: key === 'Shift-Tab', bubbles: true, cancelable: true })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

/** Document position of `text` (start of the first text node containing it) plus `offset`. */
function posOf(crepe: Crepe, text: string, offset = 0): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + offset
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

function select(crepe: Crepe, from: number, to = from): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
  })
}

/** Caret at the end of `text` (or `offset` characters into it). */
const caretIn = (crepe: Crepe, text: string, offset = text.length) => select(crepe, posOf(crepe, text, offset))
const caretPos = (crepe: Crepe) => crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.selection.from)
const md = (crepe: Crepe) => getMarkdownForSave(crepe)

describe('Tab (indent)', () => {
  it('indents level 1 → 2, 2 → 3, 3 → 4 under the previous sibling', async () => {
    let { crepe } = await mount()
    caretIn(crepe, 'L1 b')
    expect(press(crepe, 'Tab')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n  * L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L2 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n    * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L3 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n      * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('is a no-op on a first sibling (no literal spaces from the indent plugin)', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 a')
    expect(press(crepe, 'Tab')).toBe(true)
    expect(md(crepe)).toBe(OUTLINE)
    caretIn(crepe, 'L3 a', 1)
    press(crepe, 'Tab')
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('indents every item in a multi-item selection', async () => {
    const { crepe } = await mount()
    select(crepe, posOf(crepe, 'L1 b', 1), posOf(crepe, 'L1 c', 2))
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n  * L1 b\n  * L1 c\n')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('indents ordered and task items too', async () => {
    const { crepe } = await mount('1. one\n2. two\n\n* [ ] task a\n* [x] task b\n')
    caretIn(crepe, 'two')
    press(crepe, 'Tab')
    caretIn(crepe, 'task b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('1. one\n   1. two\n\n* [ ] task a\n  * [x] task b\n')
  })
})

describe('Shift-Tab (outdent)', () => {
  it('outdents level 4 → 3, 3 → 2, 2 → 1; following siblings nest under the lifted item', async () => {
    let { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    expect(press(crepe, 'Shift-Tab')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n    * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L3 a')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n  * L3 a\n    * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    ;({ crepe } = await mount())
    caretIn(crepe, 'L2 b')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n* L2 b\n* L1 b\n* L1 c\n')
  })

  it('turns a level-1 item into a paragraph (Obsidian); its children become a top-level list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 b')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n\nL1 b\n\n* L1 c\n')
    caretIn(crepe, 'L1 a')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('L1 a\n\n* L2 a\n  * L3 a\n    * L4 a\n  * L3 b\n* L2 b\n\nL1 b\n\n* L1 c\n')
  })

  it('GRO-1844 regression: indent 2 → 3 then outdent twice leaves markers matching depth exactly', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n    * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe(OUTLINE)
    press(crepe, 'Shift-Tab')
    const out = md(crepe)
    expect(out).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n* L2 b\n* L1 b\n* L1 c\n')
    expect(out).not.toContain('<br />')
    expect(out).not.toMatch(/^( {2})* {1}\*/m)
  })
})

describe('Enter', () => {
  it('splits mid-item into two siblings at the same depth', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b', 2)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3\n    * &#x20;b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('at the end of a childless item creates an empty sibling', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n      *\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('at the end of a parent item creates the new item as its first child', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    *\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 a') - 4)
  })

  it('at the end of a FOLDED parent item creates a sibling after the hidden subtree', async () => {
    const { crepe, root } = await mount()
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}[aria-label="Collapse L2 a"]`)?.click()
    caretIn(crepe, 'L2 a')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  *\n  * L2 b\n* L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L2 b') - 4)
  })

  it('keeps task state for new children and siblings', async () => {
    const { crepe } = await mount('* [x] done\n  * [x] child\n* [ ] todo\n')
    caretIn(crepe, 'done')
    press(crepe, 'Enter')
    caretIn(crepe, 'todo')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* [x] done\n  * [ ]\n  * [x] child\n* [ ] todo\n* [ ]\n')
  })

  it('on an empty nested item outdents it; on an empty level-1 item leaves the list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  *\n  * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n')
    caretIn(crepe, 'L1 c')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n\n<br />\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L1 c') + 8)
  })
})

describe('Backspace at the start of an item', () => {
  it('joins into the visually previous item and removes the bullet', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 b', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 bL1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L1 b'))
    caretIn(crepe, 'L3 b', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 aL3 b\n  * L2 bL1 b\n* L1 c\n')
  })

  it('joins a first child into its parent and drops the emptied nested list', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 aL4 a\n    * L3 b\n  * L2 b\n* L1 b\n* L1 c\n')
  })

  it('deletes an empty item and parks the caret at the end of the previous one', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L4 a')
    press(crepe, 'Enter')
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe(OUTLINE)
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L4 a') + 4)
  })

  it('removes an empty parent and promotes its children into its place', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L3 b')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n*\n  * L2 b\n* L1 b\n* L1 c\n')
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n* L2 b\n* L1 b\n* L1 c\n')
    expect(caretPos(crepe)).toBe(posOf(crepe, 'L3 b') + 4)
  })

  it('leaves a non-empty item that owns children alone', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L2 a', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    caretIn(crepe, 'L1 a', 0)
    expect(press(crepe, 'Backspace')).toBe(true)
    expect(md(crepe)).toBe(OUTLINE)
  })

  it('lifts the first item of the document to a paragraph', async () => {
    const { crepe } = await mount('* Solo\n* Next\n')
    caretIn(crepe, 'Solo', 0)
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('Solo\n\n* Next\n')
  })

  it('is not intercepted inside item text (native deletion) nor for a range selection', async () => {
    const { crepe } = await mount()
    caretIn(crepe, 'L1 c', 4)
    expect(press(crepe, 'Backspace')).toBe(false)
    expect(md(crepe)).toBe(OUTLINE)
    select(crepe, posOf(crepe, 'L1 b', 0), posOf(crepe, 'L1 b', 3))
    press(crepe, 'Backspace')
    expect(md(crepe)).toBe('* L1 a\n  * L2 a\n    * L3 a\n      * L4 a\n    * L3 b\n  * L2 b\n* b\n* L1 c\n')
  })
})
