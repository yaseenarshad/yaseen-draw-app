import { afterEach, describe, expect, it } from 'vitest'
import { CrepeFeature, type Crepe, useCrepeFeatures } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { gapCursorPlugin, dropIndicatorState } from '@milkdown/kit/plugin/cursor'
import { TextSelection } from '@milkdown/kit/prose/state'
import { undo } from '@milkdown/kit/prose/history'
import { createCrepe } from './createCrepe'
import { lockToBullets, outlineFeatures } from './outline/bulletsOnly'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []
afterEach(async () => {
  for (const { crepe, root } of mounted.splice(0)) { await crepe.destroy(); root.remove() }
})

async function mount(markdown: string, outline = false) {
  const root = document.createElement('div')
  document.body.append(root)
  const crepe = createCrepe({ root, defaultValue: markdown, ...(outline ? { features: outlineFeatures } : {}) })
  if (outline) lockToBullets(crepe)
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  view.focus()
  return { crepe, root, view }
}

describe('native text caret', () => {
  it.each([false, true])('does not hide the native caret or paint an overlay (outline=%s)', async (outline) => {
    const { crepe, root, view } = await mount(outline ? '- Before text after' : 'Before text after', outline)
    let pos = 0
    view.state.doc.descendants((node, start) => { if (node.isText) pos = start + 7 })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    const original = view.state.doc.toJSON()
    // jsdom checks editor behavior only; real renderer checks prove zoom geometry.
    for (const zoom of [0.5, 1, 1.25, 1.5, 2]) {
      root.style.zoom = String(zoom)
      view.dispatch(view.state.tr)
      expect(view.dom.classList.contains('virtual-cursor-enabled')).toBe(false)
      expect(root.querySelector('.prosemirror-virtual-cursor')).toBeNull()
      expect(view.state.selection.head).toBe(pos)
      expect(view.state.doc.toJSON()).toEqual(original)
    }
    expect(useCrepeFeatures(crepe.editor.ctx).get()).toContain(CrepeFeature.Cursor)
    expect(view.state.plugins).toContain(gapCursorPlugin.plugin())
    expect(crepe.editor.ctx.get(dropIndicatorState.key)).toBeNull()
    view.dispatch(view.state.tr.insertText('X'))
    expect(view.state.doc.textContent).toBe('Before Xtext after')
    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(view.state.doc.toJSON()).toEqual(original)
  })

  it.each([
    { markdown: 'before **bold** after', word: 'bold', offset: 0, key: 'ArrowRight' },
    { markdown: 'before `code` after', word: 'code', offset: 4, key: 'ArrowLeft' },
  ])('does not consume an extra $key step at the $word boundary', async ({ markdown, word, offset, key }) => {
    const { view } = await mount(markdown)
    let pos = 0
    view.state.doc.descendants((node, start) => { if (node.isText && node.text === word) pos = start + offset })
    expect(pos).toBeGreaterThan(0)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)).setStoredMarks([]))
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(view.state.storedMarks).toEqual([])
  })
})
