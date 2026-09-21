/**
 * Bullet threading / bullet paths (GRO-2094), the Roam / Logseq-dev-theme look: the vertical
 * lines from each list's top down to the bullet at the caret — and the glyphs on that path — take
 * the accent colour and stop at the active bullet.
 *
 * Design: view state only, like folding and zoom. Nothing is stored; the decorations are derived
 * from `state.selection.$from` on every update and are plain node classes on the `list_item`
 * blocks (`div.milkdown-list-item-block`):
 *  - THREAD_NODE_CLASS on every list_item on the root → caret path (glyph accent);
 *  - inside each NESTED list on the path (top-level lists have no guide line, same as Logseq),
 *    THREAD_SEG_CLASS on the items from the list's first child down to the path child, whose
 *    segment is cut at its glyph centre by THREAD_STOP_CLASS. Contiguous full-height segments
 *    make one continuous line that ends at the active bullet.
 * Drawing is pure CSS (bulletThreading.css), gated by `data-threading` on `.app` (settings cog).
 */
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { isListItem } from './listNodes'

export const THREAD_NODE_CLASS = 'outline-thread-node'
export const THREAD_SEG_CLASS = 'outline-thread-seg'
export const THREAD_STOP_CLASS = 'outline-thread-stop'

const pluginKey = new PluginKey('mdapp-bullet-threading')

/** One decoration per block with the merged class list (several per range would work too; one keeps tests plain). */
const buildDecorations = (state: EditorState): Decoration[] => {
  const $from = state.selection.$from
  const classes = new Map<number, { node: ProseNode; names: Set<string> }>()
  const add = (pos: number, node: ProseNode, name: string) => {
    const entry = classes.get(pos) ?? { node, names: new Set<string>() }
    entry.names.add(name)
    classes.set(pos, entry)
  }

  for (let depth = 1; depth <= $from.depth; depth++) {
    const item = $from.node(depth)
    if (!isListItem(item)) continue
    add($from.before(depth), item, THREAD_NODE_CLASS)
    // The list holding this item is at depth-1; it is nested iff a list_item owns it (depth-2).
    if (depth < 2 || !isListItem($from.node(depth - 2))) continue
    const list = $from.node(depth - 1)
    const pathIndex = $from.index(depth - 1)
    for (let index = 0; index <= pathIndex; index++) {
      const pos = $from.posAtIndex(index, depth - 1)
      add(pos, list.child(index), THREAD_SEG_CLASS)
      if (index === pathIndex) add(pos, list.child(index), THREAD_STOP_CLASS)
    }
  }

  return [...classes].map(([pos, { node, names }]) =>
    Decoration.node(pos, pos + node.nodeSize, { class: [...names].join(' ') }),
  )
}

export const bulletThreading = $prose(
  () =>
    new Plugin({
      key: pluginKey,
      props: {
        decorations: (state) => {
          const decorations = buildDecorations(state)
          return decorations.length === 0 ? DecorationSet.empty : DecorationSet.create(state.doc, decorations)
        },
      },
    }),
)
