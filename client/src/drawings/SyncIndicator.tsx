import type { GithubSyncStatus } from '@shared/types'

/**
 * The GitHub sync chip (YAZ-1081 🔒 YAZ-1775 D4): sits immediately LEFT of the per-tab Saved
 * indicator, top-right of the editor — SaveIndicator's exact dot-plus-label idiom, so two
 * chips read as one row rather than two competing widgets.
 *
 * It is a `<button>` because the chip IS the one-click sync: the status and the action are the
 * same affordance, and there is no second place to put a "sync now". Clicking while `off` is
 * harmless — the engine answers `off` and nothing happens.
 */

const LABEL: Record<GithubSyncStatus['state'], string> = {
  synced: 'Synced',
  pending: 'Pending',
  syncing: 'Syncing…',
  attention: 'Attention',
  off: 'Sync off',
}

/** What the chip says on hover — the one place a status message reaches the user (YAZ-1081). */
function title(status: GithubSyncStatus): string {
  switch (status.state) {
    case 'synced':
      return 'Synced with GitHub — click to sync now'
    case 'pending':
      return 'Changes waiting to sync — click to sync now'
    case 'syncing':
      return 'Syncing with GitHub…'
    case 'attention':
      return status.message === undefined ? 'GitHub sync needs attention — click to try again' : `GitHub sync needs attention: ${status.message}`
    case 'off':
      return 'GitHub sync is off for this vault'
  }
}

export function SyncIndicator({ status, onSyncNow }: { status: GithubSyncStatus; onSyncNow: () => void }) {
  return (
    <button type="button" className={`sync-indicator sync-indicator--${status.state}`} title={title(status)} aria-live="polite" onClick={onSyncNow}>
      <span className="sync-indicator__dot" />
      {LABEL[status.state]}
    </button>
  )
}
