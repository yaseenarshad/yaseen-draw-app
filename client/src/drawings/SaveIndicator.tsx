import type { SaveStatus } from '../lib/autosave'

const LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
}

export function SaveIndicator({ status }: { status: SaveStatus }) {
  return (
    <div className={`save-indicator save-indicator--${status}`} role="status" aria-live="polite">
      <span className="save-indicator__dot" />
      {LABEL[status]}
    </div>
  )
}
