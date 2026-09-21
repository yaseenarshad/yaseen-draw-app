import { useEffect, useRef } from 'react'
import { basename } from '../lib/paths'

/** What the sheet is about to delete; counts come from the caller (C3) so this stays pure. */
export interface DeleteTarget {
  path: string
  kind: 'file' | 'dir'
  /** Notes and subfolders inside a folder target; ignored for a file. */
  children?: { notes: number; folders: number }
  /** Notes whose `[[links]]` resolve to this target; omitted when the index was unavailable. */
  backlinks?: number
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
/** Verb agreement: one thing "moves"/"links", several "move"/"link". */
const verb = (n: number, singular: string) => (n === 1 ? `${singular}s` : singular)

/**
 * The confirm sheet's copy (GRO-2272 `C2-`). Pure and separately tested — the component is
 * then trivial. Deliberate details:
 *  - an EMPTY folder does not print "0 notes and 0 folders";
 *  - a folder with only notes (or only subfolders) does not print the empty half;
 *  - zero backlinks prints NOTHING, not "0 notes link to this";
 *  - singular and plural both read correctly.
 */
export function deleteConfirmMessage({ path, kind, children, backlinks }: DeleteTarget): string {
  const name = basename(path)
  const parts: string[] = []
  if (kind === 'dir' && children !== undefined && children.notes + children.folders > 0) {
    const inside = [children.notes > 0 ? plural(children.notes, 'note') : null, children.folders > 0 ? plural(children.folders, 'folder') : null]
      .filter((p): p is string => p !== null)
      .join(' and ')
    parts.push(`Delete "${name}"? ${inside} ${verb(children.notes + children.folders, 'move')} to the Trash.`)
  } else {
    parts.push(`Delete "${name}"? It moves to the Trash.`)
  }
  if (backlinks !== undefined && backlinks > 0) parts.push(`${plural(backlinks, 'note')} ${verb(backlinks, 'link')} to this.`)
  return parts.join(' ')
}

interface ConfirmDeleteProps {
  target: DeleteTarget
  /** `confirmDelete` is cleared when the user ticks "Don't ask me again" (GRO-2272 `C4-`). */
  onConfirm: (dontAskAgain: boolean) => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for delete (GRO-2272 — LOCKED decision B). Not a native dialog: the app
 * has a standing never-a-native-dialog convention, native dialogs are painful to drive in
 * Playwright, and only our own sheet can show the backlink count.
 *
 * The sheet IS the undo: `shell.trashItem` has no programmatic un-trash, so there is no in-app
 * restore behind it. Hence initial focus lands on **Cancel**, not Delete — a stray Enter
 * arriving from the tree must not destroy anything.
 */
export function ConfirmDelete({ target, onConfirm, onCancel }: ConfirmDeleteProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dontAskRef = useRef<HTMLInputElement>(null)

  useEffect(() => cancelRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm(dontAskRef.current?.checked === true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="confirm-overlay" onMouseDown={onCancel}>
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-delete-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-delete-text">
          {deleteConfirmMessage(target)}
        </p>
        <label className="confirm__ask">
          <input ref={dontAskRef} type="checkbox" />
          Don&apos;t ask me again
        </label>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn confirm__btn--danger" onClick={() => onConfirm(dontAskRef.current?.checked === true)}>
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
