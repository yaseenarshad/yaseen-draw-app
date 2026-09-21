import { useEffect, useRef } from 'react'
import { basename } from '../lib/paths'

/** What the sheet is about to delete; counts come from the caller (C3) so this stays pure. */
export interface DeleteTarget {
  path: string
  kind: 'file' | 'dir'
  /** Files and subfolders inside a folder target; ignored for a file. */
  children?: { files: number; folders: number }
}

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`
/** Verb agreement: one thing "moves", several "move". */
const verb = (n: number, singular: string) => (n === 1 ? `${singular}s` : singular)

/**
 * The confirm sheet's copy (GRO-2272 `C2-`). Pure and separately tested — the component is
 * then trivial. Deliberate details:
 *  - an EMPTY folder does not print "0 files and 0 folders";
 *  - a folder with only files (or only subfolders) does not print the empty half;
 *  - singular and plural both read correctly.
 */
export function deleteConfirmMessage({ path, kind, children }: DeleteTarget): string {
  const name = basename(path)
  if (kind === 'dir' && children !== undefined && children.files + children.folders > 0) {
    const inside = [children.files > 0 ? plural(children.files, 'file') : null, children.folders > 0 ? plural(children.folders, 'folder') : null]
      .filter((p): p is string => p !== null)
      .join(' and ')
    return `Delete "${name}"? ${inside} ${verb(children.files + children.folders, 'move')} to the Trash.`
  }
  return `Delete "${name}"? It moves to the Trash.`
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
 * a live check, and only our own sheet can carry the app's copy.
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
