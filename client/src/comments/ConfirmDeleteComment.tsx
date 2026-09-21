import { useEffect, useRef } from 'react'

/**
 * The delete-comment sheet's copy (YAZ-1472) — PURE and separately tested, like every other
 * sheet's. A comment has no Trash behind it: the entry leaves the note's frontmatter for good,
 * and a parent takes its replies with it (🔒 D7), so the copy names both. `label` is the number
 * the row wears (`#3`, `#3.1`); a hand-written comment without one is "this comment".
 */
export function deleteCommentMessage(label: string | null, replies: number): string {
  const what = label === null ? 'this comment' : `comment ${label}`
  const tail = replies === 0 ? '' : ` and its ${replies === 1 ? 'reply' : `${replies} replies`}`
  return `Delete ${what}${tail}? This cannot be undone.`
}

interface ConfirmDeleteCommentProps {
  label: string | null
  replies: number
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Deliberately a MIRROR of `sidebar/ConfirmDelete` — the app's own sheet, never a native dialog:
 * initial focus on CANCEL so a stray Enter destroys nothing, Esc cancels, Enter confirms,
 * click-away cancels, `role="dialog"` + `aria-modal` labelled by its own text, the confirm
 * button `--danger` because something IS destroyed. No "Don't ask me again": there is no Trash
 * to recover a comment from, so the sheet is the only undo there is.
 */
export function ConfirmDeleteComment({ label, replies, onConfirm, onCancel }: ConfirmDeleteCommentProps) {
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
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-comment-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-delete-comment-text">
          {deleteCommentMessage(label, replies)}
        </p>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn confirm__btn--danger" onClick={onConfirm}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
