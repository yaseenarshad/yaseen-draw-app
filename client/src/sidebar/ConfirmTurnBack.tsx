import { useEffect, useRef } from 'react'
import { basename } from '../lib/paths'

/**
 * The turn-back sheet's copy (🔒 D5, YAZ-817) — LOCKED verbatim, and PURE + separately tested,
 * exactly like `deleteConfirmMessage` next door, so the component around it stays trivial.
 *
 * What it has to say is the whole reason the reverse asks at all: turning back changes what the
 * page means without deleting its content or memberships (🔒 D3). Belonging is plain text each
 * note writes about ITSELF — a `folder_pages` entry naming this page — so no member is rewritten
 * and no entry is dropped. They simply stop counting for as long as the flag is gone, which is
 * what puts a page with no
 * other parent in Uncategorized meanwhile. Say that plainly, then say nothing is deleted.
 *
 * The page is named the way the delete sheet names its target — `basename`, extension and all —
 * so the two sheets in this folder speak with one voice.
 */
export function turnBackConfirmMessage(path: string): string {
  return `Turn '${basename(path)}' back into a normal page? Pages that belong to it keep their entries — any that belong nowhere else will appear in Uncategorized until this is a folder page again. Nothing is deleted.`
}

interface ConfirmTurnBackProps {
  /** The folder page being turned back; only its basename reaches the copy. */
  path: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirm sheet for "Turn back into normal page" (🔒 D5, YAZ-817). Only the REVERSE asks:
 * turning INTO a folder page adds one frontmatter key and is undone by this very menu item, so
 * it fires immediately (🔒 D1). Turning back is the direction that changes what a whole page
 * MEANS to everything pointing at it, and that earns one beat.
 *
 * Deliberately a MIRROR of `ConfirmDelete`, not a shared shell with it. The two differ in the
 * confirm label, the danger styling, the labelling id AND the confirm payload — `ConfirmDelete`
 * reports its "Don't ask me again" state, whose ref its Enter handler reads. Four knobs plus a
 * checkbox slot is more shell than either sheet is worth, and building it would churn a LOCKED
 * component for no behaviour change. What IS copied exactly is the behaviour, which is the part
 * that matters: our own sheet and never a native dialog, initial focus on CANCEL so a stray
 * Enter arriving from the tree changes nothing, Esc cancels, Enter confirms, click-away cancels,
 * and the same roles (`dialog` + `aria-modal`, labelled by its own text).
 *
 * Two deliberate omissions:
 *  - NO "Don't ask me again" (🔒 D5). Delete earns one because it repeats and is unrecoverable;
 *    this is neither, and a silent version of the one gesture that unparents a whole folder page
 *    is not worth the keystroke it saves.
 *  - the confirm button is NOT `--danger`. Nothing is destroyed here (🔒 D3) and the sheet says
 *    so; red would contradict its own copy.
 */
export function ConfirmTurnBack({ path, onConfirm, onCancel }: ConfirmTurnBackProps) {
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
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="confirm-turn-back-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="confirm-turn-back-text">
          {turnBackConfirmMessage(path)}
        </p>
        <div className="confirm__actions">
          <button ref={cancelRef} type="button" className="confirm__btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="confirm__btn" onClick={onConfirm}>
            Turn back
          </button>
        </div>
      </div>
    </div>
  )
}
