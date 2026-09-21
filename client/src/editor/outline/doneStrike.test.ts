/**
 * A done task reads as done (YAZ-1514): the rule in `bullets.css` strikes the first line of a
 * checked item. CSS is not computed here (vitest ignores stylesheets), so the proof is the
 * rule itself — selector and declarations read from the stylesheet, so test and CSS cannot
 * drift — with the selector matched against the live DOM after `Mod-Enter`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe } from '../createCrepe'

const css = readFileSync(resolve(__dirname, 'bullets.css'), 'utf8')
const rule = css.match(/^(\.editor-instance[^{]*\.label\.checked[^{]*)\{([^}]*)\}/m)
if (!rule) throw new Error('bullets.css has no checked-task rule')
const [, DONE_SELECTOR, DONE_DECLARATIONS] = rule

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  root.className = 'editor-instance'
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  // The list node views reset the caret once on mount, in a rAF they register first; let it land.
  await new Promise(requestAnimationFrame)
  mounted.push({ crepe, root })
  return crepe
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** `metaKey`: test-setup pins `navigator.platform` to Mac. The label class repaints on Vue's next tick. */
async function pressModEnter(crepe: Crepe): Promise<void> {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      metaKey: true,
      bubbles: true,
      cancelable: true,
    } as KeyboardEventInit)
    view.someProp('handleKeyDown', (handler) => handler(view, event))
  })
  await new Promise((r) => setTimeout(r, 0))
}

function caretIn(crepe: Crepe, text: string): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let pos = -1
    view.state.doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const i = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (i >= 0) pos = nodePos + i + text.length
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })
}

// Queried from `document`: jsdom's selector engine drops `:has()` chains when scoped to the root itself.
const struck = () => [...document.querySelectorAll(DONE_SELECTOR)].map((el) => el.textContent)

describe('done tasks are struck (YAZ-1514)', () => {
  it('the rule strikes and dims', () => {
    expect(DONE_DECLARATIONS).toContain('line-through')
    expect(DONE_DECLARATIONS).toContain('var(--list-done-color)')
  })

  it('the rule matches the first line of a checked item only, and follows the Mod-Enter cycle', async () => {
    const crepe = await mount('* [x] done\n  * child\n* [ ] open\n* plain\n')
    expect(struck()).toEqual(['done'])
    caretIn(crepe, 'open')
    await pressModEnter(crepe) // [ ] → [x]
    expect(struck()).toEqual(['done', 'open'])
    await pressModEnter(crepe) // [x] → bullet
    expect(struck()).toEqual(['done'])
  })

  it('a second paragraph inside a done item is not struck', async () => {
    await mount('* [x] first line\n\n  second paragraph\n')
    expect(document.querySelectorAll('li.list-item > .children > .content-dom > p')).toHaveLength(2)
    expect(struck()).toEqual(['first line'])
  })
})
