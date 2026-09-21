/**
 * Whole-line selection (YAZ-1734). The full rule lives in docs/CONTRACTS.md, Keyboard table,
 * `Shift-ArrowUp` / `Shift-ArrowDown` row — this header is only the map.
 *
 * Why: the editor bound nothing on ⇧↑ / ⇧↓, so the browser moved the head by PIXEL column and,
 * from a block edge, landed mid-text on a neighbour that is indented differently, is a heading,
 * or wraps — ⌫ then took a ragged chunk of two lines.
 *
 *  - `lineKeymap` — ⇧↓ / ⇧↑ (`extendByLine`): a line is the textblock (D1); only the head moves,
 *    edge → same edge of the next VISIBLE textblock, mid-line → own edge first (D2); never past
 *    the anchor (D5); hidden lines skipped (D6). ⌫ / Delete / Enter over a range that spans
 *    hidden lines: `deleteVisible` / `enterVisible` remove only the visible pieces (D6, D7).
 *  - `visibleTypeOver` — the same for typing (`handleTextInput`).
 *  - `liftHeadlessItems` — a list_item whose first child is a list yields its kids one level up,
 *    whatever produced it (D3).
 *  - `isHiddenTextblock` — the fold / heading-fold / zoom plugins' own STATE, never the DOM.
 *
 * Priority 100 (Crepe's keymaps are 50), like `outline/hotkeys.ts`; registered before
 * `outlinerKeymap` in `createCrepe.ts`.
 */
import type { Node as ProseNode, ResolvedPos } from '@milkdown/kit/prose/model'
import { type Command, type EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection, type Transaction } from '@milkdown/kit/prose/state'
import { liftTarget } from '@milkdown/kit/prose/transform'
import { $prose, $shortcut } from '@milkdown/kit/utils'
import { collapsedHeadingsHiding } from './outline/headingFolding'
import { isListItem, LIST_NODE_NAMES } from './outline/listNodes'
import { collapsedItemsHiding } from './outline/outlineFolding'
import { getZoomedItemPos } from './outline/zoom'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

type Edge = 'start' | 'end'

/** Which edge of its textblock `$head` sits on; an empty block answers the edge the press prefers — ⇧↓ start, ⇧↑ end (D2). */
const edgeAt = ($head: ResolvedPos, dir: 1 | -1): Edge | null => {
  const atStart = $head.parentOffset === 0
  const atEnd = $head.parentOffset === $head.parent.content.size
  if (atStart && atEnd) return dir > 0 ? 'start' : 'end'
  if (atStart) return 'start'
  if (atEnd) return 'end'
  return null
}

/**
 * Is the textblock around `$pos` hidden from view (D6)? Asks the three plugins that hide
 * things, through their own state: outside the zoomed item's subtree (`getZoomedItemPos` — the
 * zoom decorations hide every block off the root → item path, the ancestors' own text included),
 * inside a collapsed bullet's nested list (`collapsedItemsHiding`), or inside a collapsed heading's
 * section (`collapsedHeadingsHiding`). All three answer from plugin state, which is what their
 * `display: none` decorations are computed from — no DOM, no re-derived fold logic.
 */
const isHiddenTextblock = (state: EditorState, $pos: ResolvedPos): boolean => {
  const pos = $pos.pos
  const zoomed = getZoomedItemPos(state)
  if (zoomed !== null) {
    const item = state.doc.nodeAt(zoomed)
    if (item !== null && !(pos > zoomed && pos < zoomed + item.nodeSize)) return true
  }
  return collapsedItemsHiding(state, pos).length > 0 || collapsedHeadingsHiding(state, pos).length > 0
}

/**
 * A position inside the nearest VISIBLE textblock in `dir` from `$head`'s block; `'leaf'` when a
 * leaf block (`hr`) comes first — a line of its own that this keymap cannot select (D2); null at
 * a document / zoom edge. `findFrom` without textOnly lands INSIDE the next textblock (D1) or,
 * for a block atom, on a `NodeSelection` of it; hidden textblocks are stepped over.
 */
const nextVisibleTextblock = (state: EditorState, $head: ResolvedPos, dir: 1 | -1): ResolvedPos | 'leaf' | null => {
  let from = dir > 0 ? $head.after() : $head.before()
  for (;;) {
    const found = Selection.findFrom(state.doc.resolve(from), dir, false)
    if (found === null) return null
    if (found instanceof NodeSelection) return 'leaf'
    const $n = found.$from
    if (!isHiddenTextblock(state, $n)) return $n
    from = dir > 0 ? $n.after() : $n.before()
  }
}

/** Move the selection head to its own line's near edge, or one whole VISIBLE textblock in `dir` from an edge; anchor untouched (D2). */
const extendByLine = (dir: 1 | -1): Command => (state, dispatch) => {
  const sel = state.selection
  if (!(sel instanceof TextSelection)) return false
  const { $head, anchor, head } = sel
  const { doc } = state
  const edge = edgeAt($head, dir)
  // D5: the way back retraces the way out. A press towards the anchor never crosses it and
  // always reaches it — even when no neighbour line exists in that direction (first/last line).
  const toward = dir > 0 ? anchor > head : anchor < head
  let newHead: number
  if (edge === null) {
    // Mid-line: the rest of THIS line first — ⇧↓ to its end, ⇧↑ to its start (D2).
    newHead = dir > 0 ? $head.end() : $head.start()
  } else {
    const $n = nextVisibleTextblock(state, $head, dir)
    if ($n === null || $n === 'leaf') {
      if (!toward) {
        // Document or zoom edge: consumed, unchanged — never hand native a step into hidden DOM
        // (D6); a leaf block in the gap: native move (D2).
        return $n === null
      }
      newHead = anchor
    } else {
      newHead = edge === 'start' ? $n.start() : $n.end()
    }
  }
  if (toward && (dir > 0 ? newHead > anchor : newHead < anchor)) newHead = anchor
  if (dispatch) dispatch(state.tr.setSelection(TextSelection.create(doc, anchor, newHead)).scrollIntoView())
  return true
}

/**
 * The shape D6's delete claims: a non-empty `TextSelection` whose ends sit in two different
 * VISIBLE textblocks with at least one hidden textblock inside `[from, to]`. Returns the
 * positions of the visible textblocks strictly between the ends, in document order; null for
 * every other shape so the ordinary delete path stays untouched.
 */
const planVisibleDelete = (state: EditorState): number[] | null => {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || sel.empty) return null
  const { from, to, $from, $to } = sel
  if (!$from.parent.isTextblock || !$to.parent.isTextblock || $from.sameParent($to)) return null
  if (isHiddenTextblock(state, $from) || isHiddenTextblock(state, $to)) return null
  let hidden = false
  const between: number[] = []
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true
    if (isHiddenTextblock(state, state.doc.resolve(pos + 1))) hidden = true
    else if (pos !== $from.before() && pos !== $to.before()) between.push(pos)
    return false
  })
  return hidden ? between : null
}

/** Delete the textblock at `$tb` as a NODE, together with every wrapper it was the only child of (never the doc). */
const deleteBlockAndEmptyWrappers = (tr: Transaction, $tb: ResolvedPos): void => {
  let depth = $tb.depth
  while (depth > 1 && $tb.node(depth - 1).childCount === 1) depth--
  tr.delete($tb.before(depth), $tb.after(depth))
}

/**
 * D6's deletion, in REVERSE document order so earlier positions stay valid: the last block, the
 * visible blocks `between`, then the first. `joins` (first block cut mid-text): the last block goes
 * as a node and its tail after `to` joins the first block's head (marks preserved). Otherwise the
 * first block is selected from its start and goes as a node; the last block only loses its prefix
 * up to `to` (or goes whole when `to` is its end). Hidden blocks are never in `between`, never
 * touched. Returns the caret: `from` in the join case, else the mapped cut with the nearest text
 * position.
 */
const applyVisibleDelete = (tr: Transaction, sel: Selection, between: number[]): Selection => {
  const { from, to, $from, $to } = sel
  const joins = from > $from.start()
  if (joins || to === $to.end()) deleteBlockAndEmptyWrappers(tr, $to)
  else tr.delete($to.start(), to)
  for (const pos of [...between].reverse()) deleteBlockAndEmptyWrappers(tr, tr.doc.resolve(pos + 1))
  if (joins) {
    tr.replaceWith(from, $from.end(), $to.parent.content.cut(to - $to.start()))
    return TextSelection.create(tr.doc, from)
  }
  deleteBlockAndEmptyWrappers(tr, $from)
  return Selection.near(tr.doc.resolve(tr.mapping.map(from)), 1)
}

/**
 * `⌫` / `Delete` over a selection spanning hidden lines: remove only the visible pieces (D6) and
 * leave the caret at the cut. False when the selection is not that shape.
 */
export const deleteVisible: Command = (state, dispatch) => {
  const between = planVisibleDelete(state)
  if (between === null) return false
  if (dispatch) {
    const tr = state.tr
    tr.setSelection(applyVisibleDelete(tr, state.selection, between))
    dispatch(tr.scrollIntoView())
  }
  return true
}

/**
 * `Enter` over a selection spanning hidden lines (D7): remove the visible pieces, then press Enter
 * AGAIN on the view so the ordinary Enter — the outliner's (a parent keeps its kids), Crepe's list
 * split, or the base split — runs on the caret this left behind. Re-dispatching is deliberate: the
 * keymap hands every handler of one key the SAME pre-delete state, so merely declining would let the
 * outliner see a non-empty selection and Crepe's split move the kids under the new item. On the
 * second pass this handler finds no hidden line inside the (now empty) selection and declines. The
 * re-press is a synthetic KeyboardEvent through `handleKeyDown` — the path a real key takes, with
 * no keymap plumbing. A dry run (no dispatch) never re-presses.
 * ⌘X stays the ordinary cut on purpose: it MOVES the whole range, hidden kids included, and paste
 * brings them back — nothing is destroyed.
 */
const enterVisible: Command = (state, dispatch, view) => {
  if (!deleteVisible(state, dispatch)) return false
  if (!dispatch || !view) return true
  const again = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handle) => handle(view, again)) ?? true
}

/** Keymap plugin; register with `editor.use(lineKeymap)`. */
export const lineKeymap = $shortcut(() => ({
  ExtendLineDown: { key: 'Shift-ArrowDown', priority: PRIORITY, onRun: () => extendByLine(1) },
  ExtendLineUp: { key: 'Shift-ArrowUp', priority: PRIORITY, onRun: () => extendByLine(-1) },
  // D6 / D7. The outliner's Backspace/Enter (next in chain) decline non-empty selections (`caretInFirstBlock`).
  DeleteVisibleBack: { key: 'Backspace', priority: PRIORITY, onRun: () => deleteVisible },
  DeleteVisibleForward: { key: 'Delete', priority: PRIORITY, onRun: () => deleteVisible },
  EnterVisible: { key: 'Enter', priority: PRIORITY, onRun: () => enterVisible },
}))

const visibleTypeOverKey = new PluginKey('mdapp-visible-type-over')

/** Typing over a selection that spans hidden lines: D6's deletion, then the text at the cut. Register with `editor.use(visibleTypeOver)`. */
export const visibleTypeOver = $prose(
  () =>
    new Plugin({
      key: visibleTypeOverKey,
      props: {
        handleTextInput: (view, _from, _to, text) => deleteVisible(view.state, (tr) => view.dispatch(tr.insertText(text))),
      },
    }),
)

/** The nested list a list_item holds as its FIRST child — an item with no textblock of its own (D3's invalid resting state) — or null. */
const headlessList = (node: ProseNode): ProseNode | null => {
  const first = node.firstChild
  return isListItem(node) && first !== null && LIST_NODE_NAMES.has(first.type.name) ? first : null
}

/**
 * Replace the headless item at `pos` with its children, one level up (D3). `tr.lift` of the nested
 * list's items out through the item removes both wrappers when the list is the item's only child,
 * and maps positions INSIDE the lifted items exactly (the caret stays on its line); anything the
 * item held AFTER the list is split off as a following item, so nothing is lost. The item is
 * re-read from `tr.doc` because an earlier lift (a headless item nested inside this one) may have
 * reshaped it. `liftTarget` cannot fail for `list_item > list > list_item`: the outer list takes
 * list_items.
 */
const liftHeadlessItem = (tr: Transaction, pos: number): void => {
  const item = tr.doc.nodeAt(pos)
  const list = item === null ? null : headlessList(item)
  if (list === null) return
  // Just inside the nested list: before its first item, after its last.
  const range = tr.doc.resolve(pos + 2).blockRange(tr.doc.resolve(pos + list.nodeSize))!
  tr.lift(range, liftTarget(range)!)
}

const liftHeadlessItemsKey = new PluginKey('mdapp-lift-headless-items')

/** Normaliser; register with `editor.use(liftHeadlessItems)`. */
export const liftHeadlessItems = $prose(
  () =>
    new Plugin({
      key: liftHeadlessItemsKey,
      appendTransaction(trs, _old, state) {
        if (!trs.some((tr) => tr.docChanged)) return null
        // Every headless item, deepest / last first so each lift leaves the remaining positions valid.
        const positions: number[] = []
        state.doc.descendants((node, pos) => {
          if (headlessList(node) !== null) positions.push(pos)
          return true
        })
        if (positions.length === 0) return null
        const tr = state.tr
        for (const pos of positions.reverse()) liftHeadlessItem(tr, pos)
        return tr.docChanged ? tr : null
      },
    }),
)
