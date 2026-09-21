/**
 * Document-wide fold-all hotkeys. Bullet and heading folds keep independent plugin state, but
 * Cmd+Shift+U / Cmd+Shift+I are one user gesture: one metadata-only transaction updates both and
 * one Cmd+Z restores both exact prior sets. Individual chevrons and caret-local folds stay owned by
 * their existing keymaps.
 */
import type { Command } from '@milkdown/kit/prose/state'
import { $shortcut } from '@milkdown/kit/utils'
import { addHeadingFoldAllMeta, addHeadingFoldUndoMeta } from './headingFolding'
import { addOutlineFoldAllMeta, addOutlineFoldUndoMeta } from './outlineFolding'
import { VIEW_ACTION_META, type ViewAction } from './viewActions'

const PRIORITY = 100

const setAllDocumentFolds =
  (collapsed: boolean): Command =>
  (state, dispatch) => {
    const transaction = state.tr
    const outlineChanged = addOutlineFoldAllMeta(state, transaction, collapsed)
    const headingChanged = addHeadingFoldAllMeta(state, transaction, collapsed)
    if (!outlineChanged && !headingChanged) return false

    const action: ViewAction = outlineChanged && headingChanged ? 'document-fold' : outlineChanged ? 'fold' : 'heading-fold'
    dispatch?.(transaction.setMeta(VIEW_ACTION_META, action))
    return true
  }

/** Only consumes Cmd+Z when both plugins have a pending undo — the signature of one combined fold. */
const undoCombinedDocumentFold: Command = (state, dispatch) => {
  const transaction = state.tr
  const outlinePending = addOutlineFoldUndoMeta(state, transaction)
  const headingPending = addHeadingFoldUndoMeta(state, transaction)
  if (!outlinePending || !headingPending) return false
  dispatch?.(transaction.setMeta(VIEW_ACTION_META, 'document-fold' satisfies ViewAction))
  return true
}

export const foldAllHotkeys = $shortcut(() => ({
  FoldAllDocument: {
    key: 'Mod-Shift-u',
    priority: PRIORITY,
    onRun: () => setAllDocumentFolds(true),
  },
  UnfoldAllDocument: {
    key: 'Mod-Shift-i',
    priority: PRIORITY,
    onRun: () => setAllDocumentFolds(false),
  },
  UndoCombinedDocumentFold: {
    key: 'Mod-z',
    priority: PRIORITY,
    onRun: () => undoCombinedDocumentFold,
  },
}))
