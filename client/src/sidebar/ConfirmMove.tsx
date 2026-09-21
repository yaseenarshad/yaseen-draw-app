import { useEffect, useRef } from 'react'

/**
 * The move sheet's copy (YAZ-991) — PURE and separately tested, exactly like
 * `views/view/ConfirmRemoveMember.tsx`'s `removeMemberMessage`, which this sheet mirrors in
 * every other respect too, so the component around it stays trivial.
 *
 * The whole reason this gesture asks: dragging a row from one topic onto another LOOKS like
 * moving a file between folders and is not one. The move rewrites ONE `folder_pages` list on the
 * dragged page's own frontmatter (YAZ-990) — the file does not leave its directory on disk, and
 * nothing is written to either topic. So the copy says what is NOT happening first, then answers
 * the multi-parent question by name: a page can belong to several folder pages, and dropping it
 * into one of them leaves the others exactly where they were.
 *
 * `from` is NULL for a row dragged out of Uncategorized (or off the root, where no parent stands
 * above the row): there is no source to name, so the sentence simply does not name one.
 *
 * Pages are named the way the TREE names them: `basename`, no extension, in single quotes — these
 * are the rows the user is looking at and the spelling the `[[…]]` entry itself carries.
 */
export function moveConfirmMessage(page: string, from: string | null, to: string, others: readonly string[]): string {
  const source = from === null ? '' : ` from '${from}'`
  const rest = others.length > 0 ? ` It also stays in: ${others.join(', ')}.` : ''
  return `Move '${page}'${source} into '${to}'? The file stays put — only its folder pages change.${rest}`
}

interface ConfirmMoveProps {
  /** The dragged page, by basename. */
  page: string
  /** The folder page the ROW was dragged out of, by basename; null when no parent stood above it. */
  from: string | null
  /** The folder page it was dropped onto, by basename. */
  to: string
  /** Its OTHER folder pages, by basename, in entry order — the ones this move leaves alone. */
  others: readonly string[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for the Topics tree's drag (YAZ-991), MIRRORING `ConfirmRemoveMember` —
 * which mirrors `ConfirmTurnBack`, which mirrors `ConfirmDelete` — rather than sharing a shell
 * with any of them: our own sheet and never a native dialog, initial focus on CANCEL so a stray
 * Enter from the tree moves nothing, Esc cancels, Enter confirms, click-away cancels,
 * `role="dialog"` + `aria-modal` labelled by its own text.
 *
 * Same two deliberate omissions as its siblings: no "Don't ask me again" — a drop is easy to make
 * by accident, which is the whole reason this sheet exists — and the confirm button is NOT
 * `--danger`, because nothing is destroyed here and the copy says so. Buttons are Cancel / **Move**.
 */
export function ConfirmMove({ page, from, to, others, onConfirm, onCancel }: ConfirmMoveProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="confirm-overlay" onMouseDown={onCancel}>
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-move-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-move-text">
          {moveConfirmMessage(page, from, to, others)}
        </p>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn" onClick={onConfirm}>
            Move
          </button>
        </div>
      </div>
    </div>
  )
}
