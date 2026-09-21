/**
 * Inline `<br>` ↔ hardbreak (YAZ-1452).
 *
 * Milkdown's `remarkPreserveEmptyLine` deletes EVERY inline `<br>` html node on parse, so a
 * `<br>` inside a table cell (the only way GFM can break a line in a cell) vanished on load and
 * was gone from disk on the next autosave. Three pieces fix that:
 *
 *  1. `inlineBreaksRemark` ($remark): runs BEFORE Milkdown's plugin (see createCrepe) and turns a
 *     `<br>` into an mdast `break`. In a prose paragraph a `<br>` with nothing after it is
 *     meaningless (CommonMark has no trailing hard break; remark would write a stray `\`), so those
 *     are dropped — which also keeps Milkdown's lone `<br />` blank-line marker round-tripping.
 *     Its stringify handler writes a break inside a table cell back as `<br>` (remark's default
 *     writes a space there).
 *  2. `cellSchemas` ($nodeSchema extensions): a table cell serialises its paragraph content
 *     directly. Milkdown's paragraph runner always drops a paragraph's LAST hardbreak (right for
 *     prose, wrong in a cell — a trailing `<br>` would decay one per save), and wrote `<br />` for
 *     an empty cell. Several paragraphs in one cell are joined by a break.
 *  3. `cellBreakKeymap` ($shortcut): Enter and Shift-Enter inside a table cell always insert a
 *     hardbreak — a new line in the cell, as in Google Docs (🔒 YAZ-1462); Mod-Enter still exits
 *     the table. Milkdown's own Shift-Enter refuses to run inside tables, and its "second
 *     Shift-Enter after a break makes a new paragraph" rule would split the table.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { hardbreakSchema } from '@milkdown/kit/preset/commonmark'
import { tableCellSchema, tableHeaderSchema } from '@milkdown/kit/preset/gfm'
import type { Node as PMNode, ResolvedPos } from '@milkdown/kit/prose/model'
import type { Command } from '@milkdown/kit/prose/state'
import type { SerializerState } from '@milkdown/kit/transformer'
import { $remark, $shortcut } from '@milkdown/kit/utils'
import type { RootContent } from 'mdast'
import { defaultHandlers } from 'mdast-util-to-markdown'
import type { Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { visit } from 'unist-util-visit'

const BR = /^<br\s*\/?>$/i
const isBr = (node: RootContent): boolean => node.type === 'html' && BR.test(node.value.trim())

const toMarkdownExtension: ToMarkdownOptions = {
  handlers: {
    break: (node, parent, state, info) =>
      state.stack.includes('tableCell') ? '<br>' : defaultHandlers.break(node, parent, state, info),
  },
}

export const inlineBreaksRemark = $remark('mdapp-inline-breaks', () => function inlineBreaks() {
  const data = this.data() as { toMarkdownExtensions?: ToMarkdownOptions[] }
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => {
    visit(tree, 'html', (node, index, parent) => {
      if (!parent || index === undefined || !isBr(node)) return
      const trailingInProse = parent.type === 'paragraph' && !parent.children.slice(index + 1).some((n) => !isBr(n))
      if (!trailingInProse) {
        parent.children[index] = { type: 'break' }
        return
      }
      parent.children.splice(index, 1)
      return index
    })
  }
})

const cellToMarkdown = (typeName: string) => ({
  match: (node: PMNode) => node.type.name === typeName,
  runner: (state: SerializerState, node: PMNode) => {
    state.openNode('tableCell')
    node.forEach((paragraph, _, i) => {
      if (i > 0) state.addNode('break')
      state.next(paragraph.content)
    })
    state.closeNode()
  },
})

export const cellSchemas = [
  tableCellSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), toMarkdown: cellToMarkdown('table_cell') })),
  tableHeaderSchema.extendSchema((prev) => (ctx) => ({ ...prev(ctx), toMarkdown: cellToMarkdown('table_header') })),
]

const CELL_TYPES = new Set(['table_cell', 'table_header'])

const inCell = ($pos: ResolvedPos): boolean => {
  for (let depth = $pos.depth; depth > 0; depth--) if (CELL_TYPES.has($pos.node(depth).type.name)) return true
  return false
}

/** Inside a table cell: insert a hardbreak. Elsewhere: not handled (Milkdown's Shift-Enter runs). */
export const insertCellBreak = (ctx: Ctx): Command => (state, dispatch) => {
  if (!inCell(state.selection.$from)) return false
  dispatch?.(state.tr.replaceSelectionWith(hardbreakSchema.type(ctx).create()).scrollIntoView())
  return true
}

/**
 * Above Milkdown's keymaps (50), BELOW the wikilink picker and outliner keymaps (100): an open
 * `[[` picker must take Enter before a cell does.
 */
const PRIORITY = 90

export const cellBreakKeymap = $shortcut((ctx: Ctx) => ({
  InsertCellBreak: { key: 'Enter', priority: PRIORITY, onRun: () => insertCellBreak(ctx) },
  InsertCellBreakShift: { key: 'Shift-Enter', priority: PRIORITY, onRun: () => insertCellBreak(ctx) },
}))

/** Register with `editor.use(inlineBreaks)` — BEFORE Milkdown's `remarkPreserveEmptyLinePlugin`. */
export const inlineBreaks = [inlineBreaksRemark, ...cellSchemas, cellBreakKeymap].flat()
