import { useRef, useState } from 'react'
import { validateEntryName } from './createEntry'

interface RenameInlineProps {
  /** The current name minus its extension — the prefill (the extension re-appends on commit). */
  initial: string
  /** Left padding so the input lines up with the file row it replaces. */
  indent: number
  /** Called with the validated, non-empty name; rejects with a message to keep editing. */
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/**
 * Inline rename input replacing a file row's label (Links E1, GRO-2194). ONE door (YAZ-1553):
 * LEAVING the field commits — click-away, Enter, Cmd-Tab all reach `onBlur` — and Escape is the
 * only discard. An empty name cancels (nothing to commit); a `validateEntryName` error keeps the
 * input open so the typing is not lost. Bridge failures never land here: the submit handler
 * routes them to the passive notice.
 */
export function RenameInline({ initial, indent, onSubmit, onCancel }: RenameInlineProps) {
  const [error, setError] = useState<string | null>(null)
  // ONE door (YAZ-1553): leaving the field is the commit, so `onBlur` is `leave`'s only caller.
  // `settled` flips the moment the edit is over — Chromium fires one last blur when a focused
  // field is removed, and that blur must do nothing. Same verbs as `PageTitle`.
  const settled = useRef(false)

  const discard = () => {
    settled.current = true
    onCancel()
  }

  /** The one door: the name the user left behind, whichever way they left. */
  const leave = async (value: string) => {
    if (settled.current) return
    const name = value.trim()
    if (name === '') return discard()
    const invalid = validateEntryName(name)
    if (invalid !== null) {
      setError(invalid)
      return
    }
    settled.current = true
    try {
      await onSubmit(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename')
      settled.current = false
    }
  }

  return (
    <div className="create-inline" style={{ paddingLeft: indent }}>
      <input
        autoFocus
        className={`create-inline__input${error !== null ? ' create-inline__input--error' : ''}`}
        defaultValue={initial}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          // preventDefault is load-bearing since ⚡ YAZ-888: a NAME change now opens the confirm
          // sheet, which takes focus on CANCEL — and Enter's own default activation would then
          // land on that freshly focused button and cancel the rename the keystroke just asked for.
          if (e.key === 'Enter') {
            e.preventDefault()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') discard()
          else setError(null)
        }}
        onBlur={(e) => void leave(e.currentTarget.value)}
      />
      {error !== null && <p className="create-inline__error">{error}</p>}
    </div>
  )
}
