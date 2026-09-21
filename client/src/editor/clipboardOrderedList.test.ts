/**
 * Clipboard payload for a list numbered by `toggleNumberedChildren` (YAZ-731). Pins what
 * `@milkdown/plugin-clipboard` (always loaded by Crepe) hands to text/plain and text/html, so a
 * Milkdown upgrade that changes it fails here instead of in a user's paste. No product code.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe } from './createCrepe'
import { toggleNumberedChildren } from './outline/numberChildren'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<{ crepe: Crepe; view: EditorView; ctx: Ctx }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  // Crepe's trailing plugin appends an empty paragraph on the first doc change; get it out of the way.
  view.dispatch(view.state.tr)
  return { crepe, view, ctx: crepe.editor.ctx }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** `posAtCoords().inside` for the list_item whose first paragraph reads `label`. */
function insideOf(view: EditorView, label: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'list_item' && node.firstChild?.textContent === label) found = pos
  })
  if (found === -1) throw new Error(`list_item not found: ${label}`)
  return found
}

/** Position of the first text node whose text is `text` (start of the word). */
function textStart(view: EditorView, text: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos
  })
  if (found === -1) throw new Error(`text not found: ${text}`)
  return found
}

function nodePos(view: EditorView, typeName: string): number {
  let found = -1
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === typeName) found = pos
  })
  if (found === -1) throw new Error(`node not found: ${typeName}`)
  return found
}

/** What the clipboard plugin would put on text/plain and text/html for the current selection. */
function payload(view: EditorView): { text: string; html: string } {
  const slice = view.state.selection.content()
  const text = view.someProp('clipboardTextSerializer', (f) => f(slice, view)) ?? ''
  const { dom } = view.serializeForClipboard(slice)
  return { text, html: dom.innerHTML }
}

async function mountNumbered(): Promise<{ view: EditorView }> {
  const { view, ctx } = await mount('* Parent\n  * Setup\n  * VS Code\n')
  const tr = toggleNumberedChildren(view.state, insideOf(view, 'Parent'), ctx)
  expect(tr).not.toBeNull()
  view.dispatch(tr!)
  return { view }
}

describe('clipboard payload of a numbered child list', () => {
  it('text selection across both items carries the numbers and an <ol>', async () => {
    const { view } = await mountNumbered()
    const from = textStart(view, 'Setup')
    const to = textStart(view, 'VS Code') + 'VS Code'.length
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
    const { text, html } = payload(view)
    expect(text).toBe('1. Setup\n2. VS Code')
    expect(html).toContain('<ol')
  })

  it('node selection of the nested ordered_list is the bare numbered list', async () => {
    const { view } = await mountNumbered()
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos(view, 'ordered_list'))))
    const { text, html } = payload(view)
    expect(text).toBe('1. Setup\n2. VS Code')
    expect(html).toContain('<ol')
  })

  it('selecting inside the single word "Setup" copies pure text with no number and no <ol> — this is the rule, not a bug', async () => {
    const { view } = await mountNumbered()
    const from = textStart(view, 'Setup')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 'Setup'.length)))
    const { text, html } = payload(view)
    expect(text).toBe('Setup')
    expect(html).not.toContain('<ol')
  })
})
