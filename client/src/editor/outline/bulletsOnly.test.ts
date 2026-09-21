/**
 * The bullets-only lock (YAZ-901, 🔒 F3) on the REAL editor: `createCrepe({ features:
 * outlineFeatures })` + `lockToBullets`, keys dispatched through ProseMirror's `handleKeyDown` and
 * text through `handleTextInput` (so the input rules take part exactly as they do for a user), then
 * the serialised markdown is asserted — the same idiom as `listCommands.test.ts`.
 *
 * Markdown normalises on the way out (`* ` markers, 2-space nesting): never assert byte-equality
 * with what went in, only the structure.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { Fragment, Slice, type Node as ProseNode, type Schema } from '@milkdown/kit/prose/model'
import { Selection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { isBulletsOnly, lockToBullets, outlineFeatures } from './bulletsOnly'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, features: outlineFeatures })
  lockToBullets(crepe)
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

/** Caret at the end of the first text node containing `text` (or at `offset` into it). */
function caretIn(crepe: Crepe, text: string, offset = text.length): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let pos = -1
    view.state.doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index + offset
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  })
}

/** Caret at the very start of the document (first bullet, offset 0). */
function caretAtStart(crepe: Crepe): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(Selection.atStart(view.state.doc)))
  })
}

/** The document's plain text, one line per block — what the user actually sees. */
function textOf(crepe: Crepe): string {
  return crepe.editor.action((ctx) => {
    const { doc } = ctx.get(editorViewCtx).state
    return doc.textBetween(0, doc.content.size, '\n')
  })
}

const bulletsOnly = (crepe: Crepe) => crepe.editor.action((ctx) => isBulletsOnly(ctx.get(editorViewCtx).state.doc))

/** Type `text` one character at a time, the way input rules see it. */
function type(crepe: Crepe, text: string): void {
  for (const char of text) {
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const { from, to } = view.state.selection
      const deflt = () => view.state.tr.insertText(char, from, to)
      const handled = view.someProp('handleTextInput', (handler) => handler(view, from, to, char, deflt)) ?? false
      if (!handled) view.dispatch(deflt())
    })
  }
}

function press(crepe: Crepe, key: 'Tab' | 'Shift-Tab' | 'Enter' | 'Backspace'): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const name = key === 'Shift-Tab' ? 'Tab' : key
    const event = new KeyboardEvent('keydown', { key: name, code: name, shiftKey: key === 'Shift-Tab', bubbles: true, cancelable: true })
    view.someProp('handleKeyDown', (handler) => handler(view, event))
  })
}

const md = (crepe: Crepe) => getMarkdownForSave(crepe)

/** Paste `nodes` at the caret, exactly as the clipboard plugin does: transformPasted, then the fit. */
function paste(crepe: Crepe, nodes: (schema: Schema) => ProseNode[]): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const parsed = Slice.maxOpen(Fragment.from(nodes(view.state.schema)))
    const slice = view.someProp('transformPasted', (transform) => transform(parsed, view, false)) ?? parsed
    view.dispatch(view.state.tr.replaceSelection(slice))
  })
}

describe('bullets-only outline editor (YAZ-901)', () => {
  it('seeds from markdown as one bullet list', async () => {
    const crepe = await mount('- a\n    - b\n- c\n')
    expect(md(crepe)).toBe('* a\n  * b\n* c\n')
  })

  it('a bare marker seeds one empty bullet', async () => {
    const crepe = await mount('-')
    expect(md(crepe)).toBe('*\n')
  })

  it('drops BlockEdit and Toolbar, keeps the outline features', () => {
    expect(outlineFeatures).toMatchObject({ 'block-edit': false, toolbar: false, 'list-item': true, placeholder: true })
  })

  describe('markdown input rules decline instead of firing', () => {
    it.each([['heading', '# '], ['blockquote', '> '], ['ordered list', '1. '], ['thematic break', '***'], ['code fence', '```']])(
      '%s stays list text',
      async (_name, typed) => {
        const crepe = await mount('- a')
        caretAtStart(crepe)
        type(crepe, typed)
        expect(textOf(crepe)).toBe(`${typed}a`)
        expect(bulletsOnly(crepe)).toBe(true)
      },
    )

    it('an image stays list text', async () => {
      const crepe = await mount('- a')
      caretIn(crepe, 'a')
      type(crepe, ' ![alt](x.png)')
      expect(textOf(crepe)).toBe('a ![alt](x.png)')
      expect(bulletsOnly(crepe)).toBe(true)
    })
  })

  describe('the document can never stop being one bullet list', () => {
    it('Enter on an empty level-1 bullet does not lift it out of the list', async () => {
      const crepe = await mount('- a\n-')
      caretIn(crepe, 'a')
      press(crepe, 'Enter')
      caretAtStart(crepe)
      press(crepe, 'Backspace')
      expect(md(crepe).split('\n').filter(Boolean).every((line) => line.trimStart().startsWith('*'))).toBe(true)
    })

    it('Backspace at the very start keeps the first bullet a bullet', async () => {
      const crepe = await mount('- a\n- b')
      caretAtStart(crepe)
      press(crepe, 'Backspace')
      expect(md(crepe)).toBe('* a\n* b\n')
    })

    // A real clipboard EVENT cannot be driven in jsdom (no DataTransfer, no DOM paste pipeline);
    // these two exercise the pipeline it feeds — `transformPasted` then ProseMirror's fit — with
    // the slice `@milkdown/plugin-clipboard` builds (`DOMParser.parseSlice` → `Slice.maxOpen`).
    it('a pasted heading + code block becomes two bullets of plain text', async () => {
      const crepe = await mount('- a')
      caretIn(crepe, 'a')
      paste(crepe, (schema) => [
        schema.nodes.heading.create({ level: 1 }, schema.text('Title')),
        schema.nodes.code_block.create(null, schema.text('code')),
      ])
      expect(bulletsOnly(crepe)).toBe(true)
      expect(md(crepe)).toBe('* aTitle\n* code\n')
    })

    it('a pasted outline keeps its nesting', async () => {
      const crepe = await mount('- a')
      caretIn(crepe, 'a')
      paste(crepe, (schema) => {
        const item = (text: string, nested?: ProseNode) =>
          schema.nodes.list_item.create(null, [schema.nodes.paragraph.create(null, schema.text(text)), ...(nested ? [nested] : [])])
        return [schema.nodes.bullet_list.create(null, [item('x', schema.nodes.bullet_list.create(null, [item('y')]))])]
      })
      expect(md(crepe)).toBe('* ax\n  * y\n')
    })
  })

  it('Tab indents a bullet under its previous sibling', async () => {
    const crepe = await mount('- a\n- b\n')
    caretIn(crepe, 'b')
    press(crepe, 'Tab')
    expect(md(crepe)).toBe('* a\n  * b\n')
  })

  it('Shift-Tab outdents it again', async () => {
    const crepe = await mount('- a\n    - b\n')
    caretIn(crepe, 'b')
    press(crepe, 'Shift-Tab')
    expect(md(crepe)).toBe('* a\n* b\n')
  })

  it('Enter splits a bullet into two bullets', async () => {
    const crepe = await mount('- ab')
    caretIn(crepe, 'ab', 1)
    press(crepe, 'Enter')
    expect(md(crepe)).toBe('* a\n* b\n')
  })
})
