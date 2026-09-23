/**
 * SETTINGS › STORAGE (YAZ-1801 D1): its own page (like Hotkeys — it is a report, not settings to
 * scroll past), and deliberately few numbers:
 *
 *   GitHub              ▓░░░|░░░░░░░|░░░░░░░░░   98 MB of 10 GB
 *   Your files 232 MB       1 GB    5 GB
 *   Old versions 38 MB
 *
 *   Needs attention                        (only when some file is ≥ 50 MB)
 *     ● Too big for GitHub - 110 MB   110 MB   Stays on this Mac
 *     ● Big but OK - 60 MB             60 MB   Close to the limit
 *
 *   Make boards smaller                    (only when pictures are still inside boards)
 *     9 boards still carry 232 MB of pictures inside.   [ Move pictures out ]
 *
 * THE BAR is the git history — what GitHub has to store — on a FIXED scale that always ends at
 * GitHub's 10 GB maximum (D7), with GitHub's 1 GB and 5 GB lines marked: green to 1 GB, amber to
 * 5 GB, red past it. "Your files" is everything on disk in one number.
 *
 * NEEDS ATTENTION is any file in the vault — board, picture, video — at or over 50 MiB, biggest
 * first. Red at `GITHUB_FILE_LIMIT_BYTES`, the SAME line the sync guard holds files back at, so a
 * red row is exactly a file sync will not push; amber below it.
 *
 * `stats === null` is the first measurement in flight: the bar row says "Measuring…" (or, if it
 * failed, "Couldn't measure this vault" — reopening the page retries) and the two conditional
 * groups stay hidden rather than flashing empty. Opening the page measures again (🔒 D13).
 */
import { useEffect, useState } from 'react'
import { GITHUB_FILE_LIMIT_BYTES, GITHUB_REPO_HARD_BYTES, GITHUB_REPO_MAX_BYTES, GITHUB_REPO_SOFT_BYTES, type VaultStorageFile } from '@shared/types'
import { formatBytes } from '../lib/format'
import { stripExt } from '../lib/paths'
import type { SettingsCtx, SettingsSection } from './registry'

/** The bar's fill, colour and words for a history size (see the module doc). A tiny repo still gets a 1 % sliver, so the bar never reads as broken. */
export function historyBar(bytes: number): { pct: number; tone: 'ok' | 'warn' | 'danger'; of: string } {
  const pct = Math.max(1, Math.min(100, (bytes / GITHUB_REPO_MAX_BYTES) * 100))
  const tone = bytes > GITHUB_REPO_HARD_BYTES ? 'danger' : bytes > GITHUB_REPO_SOFT_BYTES ? 'warn' : 'ok'
  return { pct, tone, of: bytes > GITHUB_REPO_MAX_BYTES ? "10 GB — over GitHub's max" : '10 GB' }
}

/** Where GitHub's 1 GB (ideal) and 5 GB (recommended) lines sit on the fixed 10 GB bar. */
const MARKS: readonly (readonly [string, number])[] = [
  ['1 GB', (GITHUB_REPO_SOFT_BYTES / GITHUB_REPO_MAX_BYTES) * 100],
  ['5 GB', (GITHUB_REPO_HARD_BYTES / GITHUB_REPO_MAX_BYTES) * 100],
]

function GithubBar({ storage }: SettingsCtx) {
  const refresh = storage?.refresh
  useEffect(() => refresh?.(), [refresh])
  const stats = storage?.stats ?? null
  if (stats === null) return <span className="storage__muted">{storage?.failed === true ? "Couldn't measure this vault" : 'Measuring…'}</span>
  if (stats.git === null) return <span className="storage__muted">Not synced with git — nothing counts against GitHub</span>
  const history = stats.git.historyBytes
  const { pct, tone, of } = historyBar(history)
  return (
    <span className="storage__meter">
      <span className="storage__track">
        <span className="storage__bar" role="img" aria-label={`${formatBytes(history)} of ${of}; GitHub's lines at 1 GB and 5 GB`}>
          <span className={`storage__fill storage__fill--${tone}`} style={{ width: `${pct}%` }} />
          {MARKS.map(([label, at]) => (
            <span key={label} className="storage__tick" style={{ left: `${at}%` }} />
          ))}
        </span>
        <span className="storage__marks" aria-hidden="true">
          {MARKS.map(([label, at]) => (
            <span key={label} className="storage__mark" style={{ left: `${at}%` }}>
              {label}
            </span>
          ))}
        </span>
      </span>
      <span className="storage__of">
        {formatBytes(history)} of {of}
      </span>
    </span>
  )
}

/** The muted lines under "GitHub": everything on disk, then — in a repo — what only history holds, one per line. */
function githubHint({ storage }: SettingsCtx): string {
  const stats = storage?.stats ?? null
  if (stats === null) return ''
  const files = `Your files ${formatBytes(stats.boards.bytes + stats.pictures.bytes + stats.other.bytes)}`
  return stats.git === null ? files : `${files}\nOld versions ${formatBytes(stats.git.oldVersionsBytes)}`
}

const overLimit = (file: VaultStorageFile) => file.bytes >= GITHUB_FILE_LIMIT_BYTES

function NeedsAttention({ storage }: SettingsCtx) {
  const large = storage?.stats?.large ?? []
  return (
    <ul className="storage__files">
      {large.map((file) => {
        const red = overLimit(file)
        return (
          <li key={file.path} className={`storage__file storage__file--${red ? 'danger' : 'warn'}`} data-path={file.path}>
            <span className="storage__dot" aria-hidden="true" />
            <span className="storage__file-name" title={file.path}>
              {stripExt(file.path)}
            </span>
            <span className="storage__file-size">{formatBytes(file.bytes)}</span>
            <span className="storage__file-note">{red ? 'Stays on this Mac' : 'Close to the limit'}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** The one action (D5). The sentence carries the numbers; the result line outlives them (it is the hook's). */
function MakeSmaller({ storage }: SettingsCtx) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  if (storage === undefined) return null
  const { bytes, boards } = storage.stats?.embedded ?? { bytes: 0, boards: 0 }
  const result = storage.lastShrink
  const run = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await storage.shrink()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="storage__action">
      {bytes > 0 && (
        <>
          <p className="storage__sentence">
            {boards} {boards === 1 ? 'board still carries' : 'boards still carry'} {formatBytes(bytes)} of pictures inside.
          </p>
          <button type="button" className="settings__option" disabled={busy} onClick={() => void run()} data-testid="storage-shrink">
            {busy ? 'Moving pictures…' : 'Move pictures out'}
          </button>
        </>
      )}
      {failed && <p className="storage__muted storage__muted--danger">The pictures could not be moved.</p>}
      {result !== null && !failed && (
        <p className="storage__muted" role="status">
          {result.shrunk === 0 ? 'No board changed' : `${result.shrunk} ${result.shrunk === 1 ? 'board' : 'boards'} ${formatBytes(result.bytesMoved)} lighter`}
          {result.skipped > 0 && ` · ${result.skipped} skipped (unsaved edits, or unreadable)`}
        </p>
      )}
    </div>
  )
}

export const STORAGE_SECTION: SettingsSection = {
  id: 'storage',
  title: 'Storage',
  standalone: true,
  available: (ctx) => ctx.storage !== undefined,
  note: 'This vault only. GitHub refuses any file over 100 MB and wants the whole repo under 1 GB.',
  groups: [
    {
      items: [
        {
          id: 'storageGithub',
          label: 'GitHub',
          hint: githubHint,
          keywords: ['storage', 'size', 'disk', 'git', 'history', 'repo', 'old versions', 'your files', '1 GB', '5 GB', 'too big'],
          render: (ctx) => <GithubBar {...ctx} />,
        },
      ],
    },
    {
      title: 'Needs attention',
      available: (ctx) => (ctx.storage?.stats?.large.length ?? 0) > 0,
      items: [{ id: 'storageLarge', label: 'Large files', keywords: ['large', 'big', 'too big', '100 MB', '50 MB', 'limit'], bare: true, render: (ctx) => <NeedsAttention {...ctx} /> }],
    },
    {
      title: 'Make boards smaller',
      available: (ctx) => (ctx.storage?.stats?.embedded.bytes ?? 0) > 0 || ctx.storage?.lastShrink != null,
      items: [{ id: 'storageShrink', label: 'Move pictures out', keywords: ['embedded', 'legacy', 'shrink', 'pictures', 'images', 'assets', 'smaller'], bare: true, render: (ctx) => <MakeSmaller {...ctx} /> }],
    },
  ],
}
