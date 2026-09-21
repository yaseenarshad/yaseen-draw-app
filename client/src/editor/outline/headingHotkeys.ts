/**
 * Heading fold hotkeys (YAZ-1140), the heading-shaped twin of the fold bindings in `hotkeys.ts`:
 *
 *  - `Mod-ArrowUp` / `Mod-ArrowDown` fold / unfold the section the caret sits in — the innermost
 *                  one. Declines inside a list item (the bullet handler owns ⌘↑/⌘↓ there) and
 *                  outside every section (the native document jump runs).
 *  - `Mod-z`       fold panic-undo (GRO-2075): reverts the most recent heading fold iff it is the
 *                  latest VIEW action; declines otherwise so the bullet fold undo, zoom undo and
 *                  finally history's own `Mod-z` get the key in turn.
 *
 * Fold-all bindings live in foldAllHotkeys.ts because one transaction coordinates headings + bullets.
 * Registered with priority 100 (above Crepe's 50), like `hotkeys.ts`, and BEFORE it — see the
 * ordering note in `createCrepe.ts`.
 */
import { $shortcut } from '@milkdown/kit/utils'
import { setHeadingFoldAtSelection, undoLastHeadingFold } from './headingFolding'

/** Priority above Crepe's list/table/base keymaps (default 50). */
const PRIORITY = 100

/** Keymap plugin; register with `editor.use(headingHotkeys)`. */
export const headingHotkeys = $shortcut(() => ({
  FoldHeading: { key: 'Mod-ArrowUp', priority: PRIORITY, onRun: () => setHeadingFoldAtSelection(true) },
  UnfoldHeading: { key: 'Mod-ArrowDown', priority: PRIORITY, onRun: () => setHeadingFoldAtSelection(false) },
  UndoHeadingFold: { key: 'Mod-z', priority: PRIORITY, onRun: () => undoLastHeadingFold },
}))
