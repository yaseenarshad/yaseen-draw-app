/**
 * The "Drawing" slash-menu item (YAZ-877) — a row on Crepe's OWN BlockEdit menu, never a
 * parallel slash plugin. Crepe builds its stock groups and then hands the builder to
 * `featureConfigs[CrepeFeature.BlockEdit].buildMenu`, so appending to the existing
 * `advanced` group (Image / Code / Table / Math) puts Drawing exactly where a block-level
 * embed belongs, with filtering, keyboard navigation and hiding all inherited for free.
 *
 * Insertion matches the stock items' mechanism as far as it can: `clearTextInCurrentBlockCommand`
 * first — the same call every stock `onRun` opens with, and what removes the `/query` the user
 * typed. Where the stock items then call a schema command (`setBlockTypeCommand` etc.), a
 * drawing embed is PLAIN MARKDOWN TEXT (🔒 no schema change, round-trip byte-identical outside
 * the one inserted line), so the paragraph is filled by `tr.insertText` at the caret instead.
 *
 * `onRun` is synchronous in Crepe's contract while creating the sidecar is not: the clear runs
 * now, the file is written, and the text lands when the write resolves. The view is re-read at
 * THAT moment (never captured across the await) and the insert goes at the live selection, so a
 * caret that moved meanwhile is respected rather than overwritten. A failed write inserts
 * nothing and goes to the host's notice path — the same passive notice a failed wikilink create
 * uses, never a dialog.
 */
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'

/** How the menu item reaches the host's file layer (App/Editor own the root and the notice). */
export interface DrawingCreator {
  /** Creates one empty scene and resolves its `<name>.excalidraw` basename (`drawings/createDrawing.ts`). */
  create: () => Promise<string>
  /** Create failure: the passive in-window notice, never a dialog. Absent → failures are silent. */
  onNotice?: (message: string) => void
}

/**
 * The slice of Crepe's `GroupBuilder` this item touches. Crepe does not export the class or
 * its config types from the package root, so the shape is declared structurally here — the
 * assignment in `createCrepe()` is what type-checks it against the real `buildMenu` signature.
 */
export interface SlashMenuBuilder {
  getGroup: (key: string) => {
    addItem: (key: string, item: { label: string; icon: string; onRun?: (ctx: Ctx) => void }) => unknown
  }
}

/** The embed a new drawing leaves in the note (Obsidian's embed syntax; basename resolution). */
export const drawingEmbed = (name: string) => `![[${name}]]`

/** Pencil-on-a-square, drawn to match the stock 24px items (Crepe renders the string as-is). */
const drawingIcon = `
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="24"
    height="24"
    viewBox="0 0 24 24"
  >
    <path
      d="M5 21C4.45 21 3.979 20.804 3.587 20.413C3.196 20.021 3 19.55 3 19V5C3 4.45 3.196 3.979 3.587 3.587C3.979 3.196 4.45 3 5 3H12.925L10.925 5H5V19H19V13.05L21 11.05V19C21 19.55 20.804 20.021 20.413 20.413C20.021 20.804 19.55 21 19 21H5ZM9 15V11.75L17.175 3.575C17.375 3.375 17.6 3.229 17.85 3.137C18.1 3.046 18.35 3 18.6 3C18.867 3 19.121 3.05 19.363 3.15C19.604 3.25 19.825 3.4 20.025 3.6L21.425 5C21.608 5.2 21.75 5.421 21.85 5.663C21.95 5.904 22 6.15 22 6.4C22 6.65 21.954 6.9 21.863 7.15C21.771 7.4 21.625 7.625 21.425 7.825L13.25 16H10L9 15ZM11 14H12.4L17.2 9.2L16.5 8.5L15.775 7.8L11 12.575V14Z"
    />
  </svg>
`

/**
 * The `buildMenu` callback for `featureConfigs[CrepeFeature.BlockEdit]`. Only ever built when
 * the host supplies a creator — a mount without one adds no row at all (decoration-only and
 * test mounts keep Crepe's stock menu exactly).
 */
export function drawingMenu(drawing: DrawingCreator): (builder: SlashMenuBuilder) => void {
  return (builder) => {
    builder.getGroup('advanced').addItem('drawing', {
      label: 'Drawing',
      icon: drawingIcon,
      onRun: (ctx) => {
        ctx.get(commandsCtx).call(clearTextInCurrentBlockCommand.key)
        void drawing
          .create()
          .then((name) => {
            const view = ctx.get(editorViewCtx)
            view.dispatch(view.state.tr.insertText(drawingEmbed(name)))
          })
          .catch((err: unknown) => drawing.onNotice?.(`Can't create a drawing: ${err instanceof Error ? err.message : String(err)}`))
      },
    })
  }
}
