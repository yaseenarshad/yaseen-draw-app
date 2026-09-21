/** YAZ-1280 regression: Milkdown keeps ownership of Mod-b on a real editable selection. */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
const IS_MAC = /Mac/.test(navigator.platform)

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('Milkdown bold ownership (YAZ-1280)', () => {
  it('Mod-b toggles strong on a selection inside the real contenteditable editor', async () => {
    const crepe = await mount('hello world\n')
    const handled = crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      expect(view.dom.getAttribute('contenteditable')).toBe('true')
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7, 12)))
      const event = new KeyboardEvent('keydown', {
        key: 'b',
        code: 'KeyB',
        ...(IS_MAC ? { metaKey: true } : { ctrlKey: true }),
        bubbles: true,
        cancelable: true,
      })
      return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
    })
    expect(handled).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('hello **world**\n')
  })
})
