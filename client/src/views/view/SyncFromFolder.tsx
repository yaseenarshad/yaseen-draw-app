import { useEffect, useMemo, useRef, useState } from 'react'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { foldersWithNotes, missingFromOutline } from '../folderSync'

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`

/** The vault root is a folder like any other, but `''` is not a name a user can read. */
const folderLabel = (folder: string) => (folder === '' ? 'Vault root' : folder)

/**
 * The sync sheet's copy (YAZ-952) — PURE and separately tested, exactly like
 * `ConfirmRemoveMember.tsx`'s `removeMemberMessage` next to it, so the component stays trivial.
 *
 * Two things it must say out loud:
 *  - DIRECTLY. The answer stops at the folder's own notes and never walks its subtree (🔒 5),
 *    which is a rule the user has to know BEFORE they approve, not discover afterwards.
 *  - The page itself. `foldersWithNotes` counts the folder page among its folder's notes, so a
 *    page that is the only note in its folder shows "1 note" and then offers nothing — the
 *    nothing-to-add line names that carve-out rather than leaving the count looking wrong.
 */
export function syncFromFolderMessage(picked: { folder: string; notes: number; missing: number } | null): string {
  if (picked === null) return 'Pick a folder. Only the notes directly in it are added — never those in its subfolders.'
  const { notes, missing } = picked
  const name = `"${folderLabel(picked.folder)}"`
  return missing === 0
    ? `Nothing to add — apart from this page itself, every note directly in ${name} is already listed here.`
    : `${missing} of ${plural(notes, 'note')} directly in ${name} ${missing === 1 ? 'is' : 'are'} not listed on this page yet.`
}

interface SyncFromFolderProps {
  /** The WHOLE snapshot: both the folder list and the missing set are read from the vault. */
  records: readonly IndexRecord[]
  /** The click-rule resolver — already-listed is judged by where a line RESOLVES, never by spelling. */
  resolve: ResolveLink
  /** This page's outline document, as stored. */
  outline: string
  /** The folder page itself: it never lists itself. */
  folderPagePath: string
  /** Approved: exactly the entries `missingFromOutline` produced for the picked folder. */
  onAdd: (entries: { path: string; insert: string }[]) => void
  onCancel: () => void
}

/**
 * "Sync from folder" (YAZ-952), MIRRORING the confirm sheets — our own sheet and never a native
 * dialog, `role="dialog"` + `aria-modal` labelled by its own text, Esc and click-away dismiss.
 *
 * It REPORTS ONLY: the whole sheet writes nothing, it hands the caller the entries it showed and
 * the append is the caller's (YAZ-953). Two deliberate departures from its neighbours:
 *  - no Enter-confirms. The picker rows are buttons, so a window-level Enter would fight the row
 *    under focus. Esc alone dismisses; approving is a click.
 *  - no Add button when there is nothing to add — a button that would do nothing is not offered,
 *    so the close button is the only one, and it says Dismiss rather than Cancel.
 *
 * The folder is asked EVERY time and never remembered (🔒 3): the choice is local state and no
 * setting is read or written, so a sheet always opens on the question.
 *
 * `missingFromOutline` rebuilds the vault's whole candidate list per call (~15ms at 5,000 notes),
 * hence both answers are memoized on their inputs rather than recomputed per render.
 */
export function SyncFromFolder({ records, resolve, outline, folderPagePath, onAdd, onCancel }: SyncFromFolderProps) {
  const [picked, setPicked] = useState<{ folder: string; notes: number } | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const folder = picked?.folder ?? null

  const folders = useMemo(() => foldersWithNotes(records), [records])
  const missing = useMemo(
    () => (folder === null ? [] : missingFromOutline({ records, folder, outline, folderPagePath, resolve })),
    [records, folder, outline, folderPagePath, resolve],
  )

  // The sheet is modal, so focus belongs inside it; the close button is the one control always here.
  useEffect(() => closeRef.current?.focus(), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="confirm-overlay" onMouseDown={onCancel}>
      <div className="confirm" role="dialog" aria-modal="true" aria-labelledby="sync-from-folder-text" onMouseDown={(e) => e.stopPropagation()}>
        <p className="confirm__text" id="sync-from-folder-text">
          {syncFromFolderMessage(picked === null ? null : { ...picked, missing: missing.length })}
        </p>
        <ul className="sync__folders">
          {folders.map((row) => (
            <li key={row.folder}>
              <button type="button" className="sync__folder" aria-pressed={row.folder === folder} onClick={() => setPicked(row)}>
                <span>{folderLabel(row.folder)}</span>
                <span className="sync__count">{plural(row.notes, 'note')}</span>
              </button>
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <ul className="sync__missing">
            {missing.map((entry) => (
              <li key={entry.path}>{entry.insert}</li>
            ))}
          </ul>
        )}
        <div className="confirm__actions">
          <button ref={closeRef} type="button" className="confirm__btn" onClick={onCancel}>
            {missing.length > 0 ? 'Cancel' : 'Dismiss'}
          </button>
          {missing.length > 0 && (
            <button type="button" className="confirm__btn" onClick={() => onAdd(missing)}>
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
