/**
 * The rename confirm (⚡ YAZ-888, amending decision E / GRO-2096 for NAME changes): a rename
 * triggers a chain — the file on disk, then links across the vault — so a NAME change asks first,
 * with the honest count from `countLinkReferences`. Moves stay silent (a confirm on every drag
 * would be hostile, and bare links keep resolving). The sheet itself lands with YAZ-888; the
 * LOCKED copy lives here first, `deleteConfirmMessage`'s idiom, so the component stays trivial.
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { basename, stripExt } from '../lib/paths'

/** The LOCKED copy (⚡ YAZ-888): both spellings, the honest count, and no promise about nothing. */
export function renameConfirmMessage(oldName: string, newName: string, count: number): string {
  const links = count === 0 ? 'No other notes link to it.' : `Links in ${count} ${count === 1 ? 'note' : 'notes'} will be updated.`
  return `Rename '${oldName}' to '${newName}'? ${links}`
}

/**
 * THE RULE (⚡ YAZ-888), asked at App's one rename door and nowhere else: a changed NAME asks,
 * a MOVE stays silent. Both gestures reach that door as (oldPath, newPath), and the whole
 * difference between them is the last segment — a drag-move keeps it, a rename replaces it.
 */
export const isNameChange = (oldPath: string, newPath: string): boolean => basename(oldPath) !== basename(newPath)

/** How the sheet (and the title) name a page: the file name minus its extension (🔒 title IS the file name). */
export const pageName = (path: string): string => stripExt(basename(path))

interface ConfirmRenameProps {
  /** The page as it stands; only its NAME reaches the copy. */
  oldPath: string
  /** Where the rename would land — same directory for a name change, which is the only case that asks. */
  newPath: string
  /** The honest N: `countLinkReferences` over the window's own index snapshot. */
  count: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for a NAME change (⚡ YAZ-888). A MIRROR of `ConfirmTurnBack` — which
 * documents next door why these sheets are copied rather than shelled — so the behaviour is the
 * same one users already know: our own sheet and never a native dialog, initial focus on CANCEL
 * so a stray Enter arriving from the tree or the title input renames nothing, Esc cancels, Enter
 * confirms, click-away cancels, `dialog` + `aria-modal` labelled by its own text.
 *
 * The same two omissions as the turn-back sheet, for the same reasons: the confirm button is NOT
 * `--danger` (nothing is destroyed — the copy promises the links follow), and there is no "Don't
 * ask me again" (a rename that silently rewrites N notes is exactly the gesture that earns a beat).
 *
 * ONE deliberate departure from that mirror, and it is load-bearing: the keys are bound to the
 * OVERLAY, not to `window`. This is the first sheet a KEYSTROKE can open — Enter in the title
 * input, Enter in the sidebar's inline rename — and React flushes this component's effects inside
 * that very keydown's dispatch, so a window listener hears the Enter that opened the sheet and
 * confirms before the user has read a word (the e2e caught exactly that). Bound here, the sheet
 * only ever hears keys from inside itself, which is where focus is: Cancel takes it on mount.
 */
export function ConfirmRename({ oldPath, newPath, count, onConfirm, onCancel }: ConfirmRenameProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  // preventDefault matters on both keys: Enter would otherwise ALSO activate the focused Cancel.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onConfirm()
    }
  }

  return (
    <div className="confirm-overlay" onMouseDown={onCancel} onKeyDown={onKeyDown}>
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-rename-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-rename-text">
          {renameConfirmMessage(pageName(oldPath), pageName(newPath), count)}
        </p>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn" onClick={onConfirm}>
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}
