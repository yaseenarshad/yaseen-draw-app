/**
 * Inline `<br>` ↔ hardbreak (YAZ-1452). Real `createCrepe()` round-trips, no mocks.
 *
 * Milkdown's `remarkPreserveEmptyLine` deleted every inline `<br>` on parse, so a `<br>` in a
 * table cell vanished on load and was gone from disk on the next autosave; and remark writes a
 * hardbreak inside a table cell as a space. Cases 1–5, 9 and 10 fail without `inlineBreaks`;
 * 6–8 guard the behaviours that must NOT change.
 */
import { describe, it, expect } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { Node as PMNode } from '@milkdown/kit/prose/model'
import type { Crepe } from '@milkdown/crepe'
import { createCrepe, getMarkdownForSave } from './createCrepe'

/** One row of yaseen-draw `fa72c8c:Thinking Clearly - Nick.md`, exactly as the agent wrote it. */
const AGENT_ROW =
  '| The collection of mental processes that lets a person notice information, hold it in mind, reason about it, and act is called {{cognition}}. | **Cognition** is {{the collection of processes involved in thinking and knowing}}. <br><br>The course organizes it into {{attention}}, {{working memory}}, and {{executive function}}. <br><br>**Used in a sentence:** After a sleepless night, Maya’s cognition {{slowed enough that planning and remembering instructions became difficult}}. |'
const AGENT_TABLE = `| Front | Back |\n| --- | --- |\n${AGENT_ROW}`

const table = (cell: string, header = 'h') => `| ${header} |\n| - |\n| ${cell} |`

async function open(markdown: string): Promise<{ crepe: Crepe; close: () => Promise<void> }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  return {
    crepe,
    close: async () => {
      await crepe.destroy()
      root.remove()
    },
  }
}

async function roundTrip(markdown: string): Promise<string> {
  const { crepe, close } = await open(markdown)
  const out = getMarkdownForSave(crepe)
  await close()
  return out
}

/** Inline node type names of the first paragraph inside the first node of `type`. */
async function inlineTypes(markdown: string, type: string): Promise<string[]> {
  const { crepe, close } = await open(markdown)
  const doc = crepe.editor.ctx.get(editorViewCtx).state.doc
  let found: PMNode | null = null
  doc.descendants((node) => {
    if (found === null && node.type.name === type) found = node
    return found === null
  })
  const node = found as PMNode | null
  const paragraph = node?.type.name === 'paragraph' ? node : node?.firstChild
  const names: string[] = []
  paragraph?.forEach((child) => names.push(child.type.name))
  await close()
  return names
}

/** The saved markdown row for `cell`, whitespace-normalised (remark pads columns). */
const savedCell = (out: string): string => out.split('\n')[2].replace(/^\|\s*/, '').replace(/\s*\|$/, '')

/** Caret right after the text `text` (first match). */
function caretAfter(view: EditorView, text: string): void {
  let pos = -1
  view.state.doc.descendants((node, p) => {
    if (pos === -1 && node.isText && node.text === text) pos = p + text.length
    return pos === -1
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** A real Enter keydown through ProseMirror's keymap plugins (jsdom needs keyCode too). */
const pressEnter = (view: EditorView, mods: { shiftKey?: boolean; metaKey?: boolean } = {}): void => {
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, ...mods, bubbles: true, cancelable: true }))
}
const shiftEnter = (view: EditorView): void => pressEnter(view, { shiftKey: true })

describe('inline <br> inside table cells', () => {
  it('1. loads as a hardbreak and saves as <br>', async () => {
    expect(await inlineTypes(table('x<br>y'), 'table_cell')).toEqual(['text', 'hardbreak', 'text'])
    expect(savedCell(await roundTrip(table('x<br>y')))).toBe('x<br>y')
  })

  it("2. the agent's real row: <br><br> is two hardbreaks and the cell is byte-identical", async () => {
    const out = await roundTrip(AGENT_TABLE)
    const back = out.split('\n')[2].split(' | ')[1].replace(/\s*\|$/, '')
    expect(back).toBe(AGENT_ROW.split(' | ')[1].replace(/\s*\|$/, ''))
    expect(back.match(/<br>/g)).toHaveLength(4)
  })

  it('3. every spelling loads as a hardbreak and saves as <br>', async () => {
    for (const br of ['<br/>', '<br />', '<BR>', '<br  >']) {
      expect(await inlineTypes(table(`x${br}y`), 'table_cell'), br).toEqual(['text', 'hardbreak', 'text'])
      expect(savedCell(await roundTrip(table(`x${br}y`))), br).toBe('x<br>y')
    }
  })

  it('4. header cells behave the same', async () => {
    expect(await inlineTypes(table('x', 'a<br>b'), 'table_header')).toEqual(['text', 'hardbreak', 'text'])
    expect(await roundTrip(table('x', 'a<br>b'))).toMatch(/^\| a<br>b \|/)
  })

  it('9. Shift-Enter inside a cell saves as <br>, not a space', async () => {
    const { crepe, close } = await open(table('xy'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'xy')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    shiftEnter(view)
    expect(savedCell(getMarkdownForSave(crepe))).toBe('x<br>y')
    await close()
  })

  it('11. two Shift-Enters in a row stay in the cell (Milkdown would split the table)', async () => {
    const { crepe, close } = await open(table('x'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'x')
    shiftEnter(view)
    shiftEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('x<br><br>')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('12. two Shift-Enters in an EMPTY cell stay in the cell', async () => {
    const { crepe, close } = await open(table(''))
    const view = crepe.editor.ctx.get(editorViewCtx)
    let cellPos = -1
    view.state.doc.descendants((node, p) => {
      if (cellPos === -1 && node.type.name === 'table_cell') cellPos = p + 2
      return cellPos === -1
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cellPos)))
    shiftEnter(view)
    shiftEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('<br><br>')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('14. leading and trailing breaks in a cell round-trip (no decay across saves)', async () => {
    for (const cell of ['x<br>', 'x<br><br>', '<br>x<br>', '<br>']) {
      expect(savedCell(await roundTrip(table(cell))), cell).toBe(cell)
    }
  })

  it('15. an empty cell saves empty (Milkdown wrote `<br />`); a lone `<br />` in a cell is one break', async () => {
    expect(savedCell(await roundTrip(table('')))).toBe('')
    expect(await inlineTypes(table('<br />'), 'table_cell')).toEqual(['hardbreak'])
    expect(savedCell(await roundTrip(table('<br />')))).toBe('<br>')
  })

  it('17. Enter inside a cell is a new line in the cell (🔒 YAZ-1462), saved as <br>', async () => {
    const { crepe, close } = await open(table('xy'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'xy')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    pressEnter(view)
    const out = getMarkdownForSave(crepe)
    expect(savedCell(out)).toBe('x<br>y')
    expect(out.split('\n').filter((l) => l.startsWith('|'))).toHaveLength(3)
    await close()
  })

  it('18. Mod-Enter inside a cell still exits the table', async () => {
    const { crepe, close } = await open(table('x'))
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'x')
    pressEnter(view, { metaKey: true })
    expect(view.state.selection.$from.node(1).type.name).toBe('paragraph')
    expect(savedCell(getMarkdownForSave(crepe))).toBe('x')
    await close()
  })

  it('19. Enter outside a table is untouched (splits the paragraph)', async () => {
    const { crepe, close } = await open('ab')
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'ab')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    pressEnter(view)
    expect(getMarkdownForSave(crepe)).toBe('a\n\nb\n')
    await close()
  })

  it('13. Shift-Enter outside a table is untouched (Milkdown hardbreak, backslash on save)', async () => {
    const { crepe, close } = await open('ab')
    const view = crepe.editor.ctx.get(editorViewCtx)
    caretAfter(view, 'ab')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.from - 1)))
    shiftEnter(view)
    expect(getMarkdownForSave(crepe)).toBe('a\\\nb\n')
    await close()
  })

  it('10. renders a real <br> element inside the cell', async () => {
    const { crepe, close } = await open(table('x<br>y'))
    const cell = crepe.editor.ctx.get(editorViewCtx).dom.querySelector('td p')
    expect(cell?.innerHTML).toBe('x<br data-type="hardbreak" data-is-inline="false">y')
    await close()
  })
})

describe('inline <br> elsewhere', () => {
  it('5. in a paragraph: hardbreak, saved as backslash + newline', async () => {
    expect(await inlineTypes('a<br>b', 'paragraph')).toEqual(['text', 'hardbreak', 'text'])
    expect(await roundTrip('a<br>b')).toBe('a\\\nb\n')
  })

  it('16. trailing <br>s at the end of a prose paragraph are dropped (CommonMark has no trailing hard break)', async () => {
    expect(await inlineTypes('a<br><br>\n\nb', 'paragraph')).toEqual(['text'])
    expect(await roundTrip('a<br><br>\n\nb')).toBe('a\n\nb\n')
    expect(await roundTrip('a<br>')).toBe('a\n')
  })
})

describe('unchanged behaviours', () => {
  it("6. a lone <br /> paragraph (Milkdown's blank-line marker) still round-trips", async () => {
    expect(await roundTrip('p1\n\n<br />\n\np2')).toBe('p1\n\n<br />\n\np2\n')
  })

  it('7. an empty bullet written as `* <br />` still saves as a bare marker', async () => {
    expect(await roundTrip('* item\n\n* <br />\n\n* next')).toBe('* item\n\n*\n\n* next\n')
  })

  it('8. underline still round-trips', async () => {
    expect(await roundTrip('a <u>u</u> b')).toBe('a <u>u</u> b\n')
  })
})
