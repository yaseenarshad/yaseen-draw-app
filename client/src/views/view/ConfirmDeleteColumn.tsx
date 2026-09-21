import { useEffect, useMemo, useRef } from 'react'
import type { IndexRecord } from '@shared/types'
import { membersCarrying } from '../deleteColumn'
import { propertyLabel } from '../engine'
import type { ViewSet } from '../viewSchema'
import { canonicalKey } from './keys'

/** The sheet's copy (YAZ-1513) — pure and separately tested, like `deleteConfirmMessage` next door. */
export function deleteColumnMessage(label: string, key: string, count: number): string {
  return `Delete "${label}"? This removes the column from this page and the "${key}" value from ${count} ${count === 1 ? 'note' : 'notes'}.`
}

interface ConfirmDeleteColumnProps {
  /** The column, any spelling — the sheet derives its label, bare key and count itself (YAZ-1549). */
  columnKey: string
  def: ViewSet
  /** The direct members: the count is taken ONCE, when the sheet opens. */
  records: readonly IndexRecord[]
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Confirm-first for "Delete column…" (YAZ-1513): the sidebar's delete sheet, mirrored — our own
 * sheet and never a native dialog, initial focus on CANCEL, Esc cancels, Enter confirms,
 * click-away cancels, the confirm button `--danger` because notes ARE rewritten. Keys are handled
 * on the dialog itself (it holds focus) rather than on `window`, so a Popover hosting this sheet
 * does not see the same Escape and close underneath it.
 */
export function ConfirmDeleteColumn({ columnKey, def, records, onConfirm, onCancel }: ConfirmDeleteColumnProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  const label = propertyLabel(def, columnKey)
  const propKey = canonicalKey(columnKey).slice('note.'.length)
  // Taken once at open: the number the user reads is the number the confirm meant.
  const count = useMemo(() => membersCarrying(records, columnKey).length, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(e) => {
        e.stopPropagation()
        onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        } else if (e.key === 'Enter') {
          e.preventDefault()
          e.stopPropagation()
          onConfirm()
        }
      }}
    >
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-column-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-delete-column-text">
          {deleteColumnMessage(label, propKey, count)}
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
