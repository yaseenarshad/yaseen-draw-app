import { useEffect, useRef } from 'react'
import type { ViewDef } from '../viewSchema'

/** PURE copy (the `ConfirmRemoveMember` idiom, tested apart): what goes, then what stays. */
export function deleteViewMessage(view: ViewDef): string {
  const goes = view.type === 'outline' ? 'Its outline document goes with it' : 'Its columns, sort, filters and grouping go with it'
  return `Delete the view '${view.name}'? ${goes} — the pages themselves stay put.`
}

interface ConfirmDeleteViewProps {
  view: ViewDef
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for a view tab's Delete (YAZ-1471), MIRRORING `ConfirmRemoveMember`: our
 * own sheet and never a native dialog, initial focus on CANCEL (a stray Space changes nothing —
 * Enter is the sheet's own confirm), Esc cancels, click-away cancels, `role="dialog"` + `aria-modal` labelled by its
 * own text. Unlike the remove sheet the confirm IS `--danger`: a view's configuration — and an
 * outline's document — has no way back.
 */
export function ConfirmDeleteView({ view, onConfirm, onCancel }: ConfirmDeleteViewProps) {
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
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-view-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-delete-view-text">
          {deleteViewMessage(view)}
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
