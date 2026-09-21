/**
 * Multi-block drag (GRO-2019, D5): dragging the block handle while a multi-block selection
 * contains the grabbed block moves the WHOLE selection, not just the hovered block.
 *
 * Root cause of the bug this fixes: Crepe's BlockService replaces the user's selection with a
 * single-block NodeSelection on handle mousedown, then dragstart serialises only that. This
 * plugin wins both races instead of forking BlockEdit:
 *  - document CAPTURE mousedown: when the grab lands inside the current selection's block
 *    range, expand the selection to whole sibling blocks, arm the plugin, and
 *    stopImmediatePropagation so Crepe's selection replacement never runs (the native drag
 *    still starts — only JS listeners are stopped, no preventDefault);
 *  - document CAPTURE dragstart: hand ProseMirror the expanded slice (dataTransfer +
 *    view.dragging). Crepe's own bubble handler then no-ops: with its mousedown suppressed it
 *    has no stored selection, so it only sets its dragging bookkeeping;
 *  - drop: ProseMirror's move logic deletes the dragged text range, which merges the origin
 *    blocks into one empty shell. The appendTransaction watches the drop (uiEvent meta) and
 *    removes that shell, walking up through wrappers (e.g. a list_item) it was the only child of.
 * Grabbing a block OUTSIDE the selection is untouched: the plugin never arms and Crepe's
 * single-block path runs as before.
 *  - Only a left-button grab on THIS editor's own handle arms the plugin (tabs keep hidden
 *    editors mounted).
 */
import { Slice, type Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'
import { handleTargetPos, isDragHandleGrab, isOwnHandleGrab } from './blockHandleTarget'

interface Armed {
  from: number
  to: number
}

type Meta = { type: 'arm'; from: number; to: number } | { type: 'disarm' }

export const multiBlockDragKey = new PluginKey<Armed | null>('mdapp-multi-block-drag')

/**
 * [start, end] covering whole sibling blocks at the deepest level containing both selection
 * ends — top-level blocks for a cross-paragraph selection, sibling list_items inside a nested
 * list. Null when the selection is empty or covers at most one block.
 */
export function expandedBlockRange(doc: ProseNode, from: number, to: number): { start: number; end: number } | null {
  if (from === to) return null
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  const shared = $from.sharedDepth(to)
  const start = $from.depth > shared ? $from.before(shared + 1) : from
  const end = $to.depth > shared ? $to.after(shared + 1) : to
  if (end <= start) return null
  const first = doc.resolve(start).nodeAfter
  if (first !== null && start + first.nodeSize >= end) return null
  return { start, end }
}

/**
 * The armed selection's content as fully CLOSED blocks. An open slice (what content() returns
 * for a text selection) makes ProseMirror's drop splice text into the target paragraph;
 * closed blocks make dropPoint land the whole blocks between blocks instead.
 */
export function armedDragSlice(state: EditorState): Slice {
  return new Slice(state.selection.content().content, 0, 0)
}

export const multiBlockDrag = $prose(
  () =>
    new Plugin<Armed | null>({
      key: multiBlockDragKey,
      state: {
        init: () => null,
        apply(tr, armed) {
          const meta = tr.getMeta(multiBlockDragKey) as Meta | undefined
          if (meta !== undefined) return meta.type === 'arm' ? { from: meta.from, to: meta.to } : null
          if (armed === null || !tr.docChanged) return armed
          return { from: tr.mapping.map(armed.from, 1), to: tr.mapping.map(armed.to, -1) }
        },
      },
      appendTransaction(trs, _old, state) {
        const armed = multiBlockDragKey.getState(state) ?? null
        if (armed === null || !trs.some((tr) => tr.getMeta('uiEvent') === 'drop')) return null
        const tr = state.tr.setMeta(multiBlockDragKey, { type: 'disarm' })
        // The move-deletion collapsed the origin to armed.from, leaving one merged empty shell.
        const $p = state.doc.resolve(Math.min(armed.from, state.doc.content.size))
        if ($p.depth === 0 || !$p.parent.isTextblock || $p.parent.content.size !== 0) return tr
        let depth = $p.depth
        while (depth > 1 && $p.node(depth - 1).childCount === 1) depth--
        tr.delete($p.before(depth), $p.after(depth))
        return tr
      },
      view(view) {
        const arm = (e: MouseEvent) => {
          if (e.button !== 0 || !isOwnHandleGrab(view, e.target)) return
          const probe = handleTargetPos(view, e)
          if (probe === null) return
          const sel = view.state.selection
          const range = expandedBlockRange(view.state.doc, sel.from, sel.to)
          if (range === null || probe.pos < range.start || probe.pos > range.end) return
          e.stopImmediatePropagation()
          const expanded = TextSelection.between(view.state.doc.resolve(range.start), view.state.doc.resolve(range.end))
          view.dispatch(
            view.state.tr
              .setSelection(expanded)
              .setMeta(multiBlockDragKey, { type: 'arm', from: expanded.from, to: expanded.to }),
          )
        }

        const dragStart = (e: DragEvent) => {
          if ((multiBlockDragKey.getState(view.state) ?? null) === null) return
          if (!isDragHandleGrab(e.target) || e.dataTransfer === null) return
          const slice = armedDragSlice(view.state)
          const { dom, text } = view.serializeForClipboard(slice)
          e.dataTransfer.effectAllowed = 'copyMove'
          e.dataTransfer.clearData()
          e.dataTransfer.setData('text/html', dom.innerHTML)
          e.dataTransfer.setData('text/plain', text)
          view.dragging = { slice, move: true }
        }

        const disarm = () => {
          if ((multiBlockDragKey.getState(view.state) ?? null) !== null) {
            view.dispatch(view.state.tr.setMeta(multiBlockDragKey, { type: 'disarm' }))
          }
        }

        document.addEventListener('mousedown', arm, true)
        document.addEventListener('dragstart', dragStart, true)
        document.addEventListener('dragend', disarm, true)
        return {
          destroy() {
            document.removeEventListener('mousedown', arm, true)
            document.removeEventListener('dragstart', dragStart, true)
            document.removeEventListener('dragend', disarm, true)
          },
        }
      },
    }),
)
