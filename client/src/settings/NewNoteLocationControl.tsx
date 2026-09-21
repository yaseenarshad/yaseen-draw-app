/**
 * "Default location for new notes" (Files & Links, Links C2- — GRO-2240): Obsidian's three
 * options in a dropdown (a stack of sentence-long buttons was too easy to change by accident —
 * YAZ-1679's fourth call), and for the third a root-relative folder input under the row. A
 * component rather than an inline render because the input carries DRAFT state; the logic moved
 * as-is from the popover (sidebar/SettingsPanel.tsx).
 *
 * The folder input is draft + commit (Enter/blur), CreateInline-style: an invalid path —
 * absolute, `..`/`.`/empty segments — keeps the STORED value and marks the input; the typed
 * text stays for fixing up. An external settings change (another window) resets the draft.
 */
import { useEffect, useState } from 'react'
import { isValidNewNoteFolder, type SettingsState } from '@shared/types'
import { Select } from './controls'
import { NEW_NOTE_LOCATION_OPTIONS } from './options'

interface NewNoteLocationControlProps {
  settings: SettingsState
  onChange: (next: SettingsState) => void
}

export function NewNoteLocationControl({ settings, onChange }: NewNoteLocationControlProps) {
  const [folderDraft, setFolderDraft] = useState(settings.newNoteFolder)
  const [folderInvalid, setFolderInvalid] = useState(false)
  useEffect(() => {
    setFolderDraft(settings.newNoteFolder)
    setFolderInvalid(false)
  }, [settings.newNoteFolder])

  const commitFolder = (raw: string) => {
    const value = raw.trim()
    if (!isValidNewNoteFolder(value)) {
      setFolderInvalid(true)
      return
    }
    setFolderInvalid(false)
    setFolderDraft(value)
    if (value !== settings.newNoteFolder) onChange({ ...settings, newNoteFolder: value })
  }

  return (
    <>
      <Select options={NEW_NOTE_LOCATION_OPTIONS} value={settings.newNoteLocation} onChange={(newNoteLocation) => onChange({ ...settings, newNoteLocation })} ariaLabel="Default location for new notes" />
      {settings.newNoteLocation === 'folder' && (
        <input
          type="text"
          className={`settings__input${folderInvalid ? ' settings__input--error' : ''}`}
          aria-label="Folder to create new notes in"
          aria-invalid={folderInvalid}
          placeholder="Example: folder 1/folder 2"
          spellCheck={false}
          value={folderDraft}
          onChange={(e) => {
            setFolderDraft(e.target.value)
            setFolderInvalid(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitFolder(e.currentTarget.value)
          }}
          onBlur={(e) => commitFolder(e.target.value)}
        />
      )}
    </>
  )
}
