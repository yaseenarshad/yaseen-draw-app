/** Numbers are manual-only (YAZ-793/YAZ-1329): typing and Mod-Alt-7 cannot create them; bullet rules stay. */
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { afterEach, expect, test } from 'vitest'
import { createCrepe, getMarkdownForSave } from './createCrepe'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

async function mount() {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: 'hello\n' })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Type `text` at the start of the first paragraph the way the browser would: one char per input. */
function typeAtStart(view: EditorView, text: string) {
  for (let i = 0; i < text.length; i++) {
    const pos = 1 + i
    const handled = view.someProp('handleTextInput', (f) => f(view, pos, pos, text[i], () => view.state.tr.insertText(text[i], pos)))
    if (!handled) view.dispatch(view.state.tr.insertText(text[i], pos))
  }
}

test('typing "1. " at line start stays text — no numbered list is created', async () => {
  const { crepe, view } = await mount()
  typeAtStart(view, '1. ')
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  expect(getMarkdownForSave(crepe)).toBe('1\\. hello\n')
})

test('typing "- " at line start still creates a bullet list', async () => {
  const { crepe, view } = await mount()
  typeAtStart(view, '- ')
  expect(view.state.doc.firstChild?.type.name).toBe('bullet_list')
  expect(getMarkdownForSave(crepe)).toBe('* hello\n')
})

test('Mod-Alt-7 does not create a numbered list', async () => {
  const { crepe, view } = await mount()
  const isMac = /Mac/.test(navigator.platform)
  const event = new KeyboardEvent('keydown', {
    key: '7',
    code: 'Digit7',
    keyCode: 55,
    altKey: true,
    ...(isMac ? { metaKey: true } : { ctrlKey: true }),
    bubbles: true,
    cancelable: true,
  })
  const handled = view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  expect(handled).toBe(false)
  expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  expect(getMarkdownForSave(crepe)).toBe('hello\n')
})
