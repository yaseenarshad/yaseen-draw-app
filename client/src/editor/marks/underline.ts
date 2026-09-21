/**
 * Underline mark (GRO-2028): `Mod-u` ↔ `<u>text</u>`, exactly what obsidian-underline writes.
 *
 * Markdown has no underline syntax, so the vault stores it as inline HTML. remark parses
 * `a <u>b</u> c` as `text, html("<u>"), text, html("</u>"), text`, and Milkdown's commonmark
 * preset turns each `html` node into an atom `html` inline node. Three pieces map that onto a
 * real ProseMirror mark instead:
 *
 *  1. `underlineRemark` ($remark): after parsing, every `html("<u>")` … `html("</u>")` pair
 *     (nearest matching, any nesting depth) is wrapped into an mdast `underline` node with the
 *     in-between siblings as its children — the shared `htmlPairs.ts` walk, which the coloured
 *     half of `marks/highlight.ts` uses for `<mark class=…>` too. Unmatched tags and all other
 *     inline HTML (`<span>`, `<br>`, …) are left alone and keep going through the `html` node.
 *     The same plugin registers the remark-stringify handler that writes `underline` back as
 *     `<u>` + children + `</u>`.
 *  2. `underlineSchema` ($markSchema): `parseDOM` u / `text-decoration: underline`, `toDOM` u,
 *     `parseMarkdown` from / `toMarkdown` to the `underline` mdast node.
 *  3. `underlineKeymap` ($shortcut): `Mod-u` = `toggleMark`. Not a Crepe feature — the feature
 *     allowlist is untouched and the toolbar does not get a button.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { toggleMark } from '@milkdown/kit/prose/commands'
import type { Command } from '@milkdown/kit/prose/state'
import { $markSchema, $remark, $shortcut } from '@milkdown/kit/utils'
import type { Parent, PhrasingContent } from 'mdast'
import type { Handle, Options as ToMarkdownOptions } from 'mdast-util-to-markdown'
import { wrapHtmlPairs, type HtmlPairSpec } from './htmlPairs'

/** mdast node for `<u>…</u>`; registered with mdast so remark-stringify's `Handlers` knows the type. */
export interface Underline extends Parent {
  type: 'underline'
  children: PhrasingContent[]
}

declare module 'mdast' {
  interface PhrasingContentMap {
    underline: Underline
  }
  interface RootContentMap {
    underline: Underline
  }
}

const OPEN = '<u>'
const CLOSE = '</u>'

const UNDERLINE_PAIRS: HtmlPairSpec<Record<string, never>> = {
  open: (value) => (value === OPEN ? {} : null),
  close: CLOSE,
  make: (_attrs, children) => ({ type: 'underline', children }),
}

/**
 * A directly nested pair (`<u>a <u>b</u> c</u>`) is merged into its parent: one mark, since
 * ProseMirror marks of the same type do not nest and the inner close would otherwise end the
 * outer mark early. Runs inside-out, after `wrapHtmlPairs` has built the nodes.
 */
const mergeNestedUnderlines = (node: Parent): void => {
  for (const child of node.children) if ('children' in child) mergeNestedUnderlines(child)
  if (node.type !== 'underline') return
  const underline = node as Underline
  underline.children = underline.children.flatMap((child) => (child.type === 'underline' ? child.children : [child]))
}

const wrapUnderlines = (node: Parent): void => {
  wrapHtmlPairs(node, UNDERLINE_PAIRS)
  mergeNestedUnderlines(node)
}

const underlineHandle: Handle = (node: Underline, _parent, state, info) =>
  `${OPEN}${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}${CLOSE}`

const toMarkdownExtension: ToMarkdownOptions = { handlers: { underline: underlineHandle } }

/** remark plugin: mdast `html` `<u>`/`</u>` pairs ↔ `underline` nodes (parse) + stringify handler. */
export const underlineRemark = $remark('mdapp-underline', () => function underline() {
  const data = this.data()
  data.toMarkdownExtensions = [...(data.toMarkdownExtensions ?? []), toMarkdownExtension]
  return (tree) => wrapUnderlines(tree)
})

export const underlineSchema = $markSchema('underline', () => ({
  parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (value) => value === 'underline' && null }],
  toDOM: () => ['u', 0],
  parseMarkdown: {
    match: (node) => node.type === 'underline',
    runner: (state, node, markType) => {
      state.openMark(markType)
      state.next(node.children)
      state.closeMark(markType)
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === 'underline',
    runner: (state, mark) => {
      state.withMark(mark, 'underline')
    },
  },
}))

/** Priority above Crepe's keymaps (default 50), like the outliner keymaps. */
const PRIORITY = 100

const toggleUnderline = (ctx: Ctx): Command => toggleMark(underlineSchema.type(ctx))

export const underlineKeymap = $shortcut((ctx: Ctx) => ({
  ToggleUnderline: { key: 'Mod-u', priority: PRIORITY, onRun: () => toggleUnderline(ctx) },
}))

/** Register with `editor.use(underline)`. */
export const underline = [underlineRemark, underlineSchema, underlineKeymap].flat()
