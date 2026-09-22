/**
 * "Pixabay API key" (Settings › Images, 🔒 YAZ-1775 D4): the one place the key is ever typed. It goes
 * straight to main through `secrets:set` and is never shown again — the row's whole read-back is
 * `secrets:has`, "Key set" or "No key". A component rather than an inline `render` because the
 * row owns state no `SettingsState` field holds: the draft being typed, and main's yes/no.
 *
 * Save is disabled until something is typed; Clear until a key is set. A failed save is told in
 * the status line instead of a dialog (report, don't block).
 */
import { useEffect, useState } from 'react'
import { PIXABAY_SECRET } from '@shared/types'
import { api } from '../api'

/** `null` while the first `secrets:has` is in flight. */
type KeyStatus = boolean | null

export function PixabayKeyControl() {
  const [has, setHas] = useState<KeyStatus>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.secrets.has({ name: PIXABAY_SECRET }).then(
      (v) => {
        if (live) setHas(v)
      },
      () => {
        if (live) setHas(false)
      },
    )
    return () => {
      live = false
    }
  }, [])

  const write = async (value: string | null) => {
    setBusy(true)
    setProblem(null)
    try {
      await api.secrets.set({ name: PIXABAY_SECRET, value })
      setHas(value !== null)
      setDraft('')
    } catch (err) {
      setProblem('The key could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const status = problem ?? (has === null ? '…' : has ? 'Key set' : 'No key')
  return (
    <>
      <p className="settings__path" data-testid="pixabay-key-status">
        {status}
      </p>
      <div className="settings__options" role="group" aria-label="Pixabay API key">
        <input type="password" className="settings__input settings__input--secret" aria-label="Pixabay API key" autoComplete="off" spellCheck={false} placeholder="Paste your key" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
        <button type="button" className="settings__option" onClick={() => void write(draft)} disabled={busy || draft === ''}>
          Save
        </button>
        <button type="button" className="settings__option" onClick={() => void write(null)} disabled={busy || has !== true}>
          Clear
        </button>
      </div>
    </>
  )
}
