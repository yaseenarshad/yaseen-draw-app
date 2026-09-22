/**
 * "Library folder" (Settings › Files, 🔒 YAZ-1775 D5): the one folder every vault shares, where media
 * favorites and saved components will live (3A / 3B / 3C fill it).
 *
 * A component rather than an inline `render` because the row shows the RESOLVED path, and only
 * main knows what null resolves to (`<userData>/library`) — so it asks, once per value.
 * Choosing goes through the native folder dialog, the same `pickFolder` door the vault switcher
 * uses, and "Reset to default" writes null, never `''`: an empty string would resolve to the
 * process cwd.
 */
import { useEffect, useState } from 'react'
import type { SettingsState } from '@shared/types'
import { api } from '../api'
import { usePickFolder } from '../hooks/usePickFolder'

interface LibraryFolderControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

/** The resolved folder for the current setting; `''` while the first fetch is in flight. */
export function useResolvedLibraryFolder(setting: string | null): string {
  const [resolved, setResolved] = useState(setting ?? '')
  useEffect(() => {
    let live = true
    // A chosen path IS the answer — main would only echo it back.
    if (setting !== null) {
      setResolved(setting)
      return
    }
    api.drawing.libraryFolder().then(
      (p) => {
        if (live) setResolved(p)
      },
      // A bridge that cannot answer leaves the row saying "…" rather than a wrong path.
      () => {
        if (live) setResolved('')
      },
    )
    return () => {
      live = false
    }
  }, [setting])
  return resolved
}

/** The resolved path, as the row's live hint. */
export function LibraryFolderHint({ setting }: { setting: string | null }) {
  const resolved = useResolvedLibraryFolder(setting)
  return (
    <p className="settings__path" data-testid="library-folder-path">
      {resolved === '' ? '…' : resolved}
      {setting === null && resolved !== '' ? ' (default)' : ''}
    </p>
  )
}

export function LibraryFolderControl({ settings, onChange }: LibraryFolderControlProps) {
  const { pick, picking } = usePickFolder({ onPicked: (path) => onChange({ ...settings, libraryFolder: path }) })
  return (
    <>
      <button type="button" className="settings__option" onClick={pick} disabled={picking} aria-label="Choose library folder">
        Choose…
      </button>
      <button type="button" className="settings__option" onClick={() => onChange({ ...settings, libraryFolder: null })} disabled={settings.libraryFolder === null}>
        Reset to default
      </button>
    </>
  )
}
