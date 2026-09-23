/**
 * THE SHARE DIALOG (YAZ-1799 D6, prototype) — the Google Docs model Yasin approved. ONE dialog
 * behind both entry points (File › Share Link ⌘⇧L, sidebar right-click "Share"):
 *
 *   Share "<board>"                                          ✕
 *   General access
 *   (🌐)  Anyone with the link ▾               View and download ▾
 *         Anyone on the internet with the link can view and download
 *   ● Up to date · yesterday
 *   [🔗 Copy link]                                           [Done]
 *
 * The two pickers are borderless text buttons that open the app's own popover
 * (`ContextMenuSurface`, `.ctx-menu__item`, the sort menu's ✓ hint) — not native selects.
 *
 * "Anyone with the link" creates the share (the Export Drawing file, uploaded); "Not shared"
 * deletes it (the link dies at once) — no separate Stop button, no confirm. The "can …" choice
 * flips a flag on the SAME link without re-uploading; the Worker enforces it. Every save of a
 * shared board re-uploads by itself (`liveShare.ts`), so the status line only reports.
 *
 * Main owns every Cloudflare detail; the dialog never sees a token or a password.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { TriangleIcon } from '../components/icons'
import { MAX_SHARE_BYTES, type ShareEntry, type ShareStatus } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { basename, stripExt } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { isPending, onLiveShareChange } from './liveShare'
import { buildShareContent, formatMB } from './shareContent'
import './share.css'

interface ShareDialogProps {
  root: string
  path: string
  onClose: () => void
  onOpenSettings: () => void
}

type Busy = null | 'sharing' | 'unsharing' | 'permission'

export const formatWhen = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function errorText(err: unknown): string {
  if (err instanceof BridgeRequestError) return err.message
  if (err instanceof SyntaxError) return "This board's file isn't valid JSON, so it can't be shared."
  return err instanceof Error ? err.message : String(err)
}

/** The one status line, shared with the Settings list. */
export function liveLine(entry: ShareEntry, pending: boolean, now: number): { tone: 'ok' | 'busy' | 'error'; text: string } {
  if (entry.sync.state === 'uploading' || pending) return { tone: 'busy', text: 'Uploading…' }
  if (entry.sync.state === 'failed') return { tone: 'error', text: `Couldn't update: ${entry.sync.message ?? 'unknown error'}` }
  return { tone: 'ok', text: `Up to date · ${relativeTime(entry.updatedAt, now)}` }
}

/** One option of a picker menu. */
interface Choice<V extends string> {
  value: V
  label: string
}

/**
 * A borderless text button with a chevron that opens the app's own popover under it, the current
 * option ticked. Keyboard: Enter / Space open (it is a button), ↑ / ↓ move, Enter / Space pick,
 * Esc closes the menu first (the dialog's capture listener asks `pickerCloser`).
 */
function Picker<V extends string>({ value, choices, onPick, disabled, label, testId, align = 'left' }: { value: V; choices: readonly Choice<V>[]; onPick: (v: V) => void; disabled?: boolean; label: string; testId: string; align?: 'left' | 'right' }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const current = choices.find((c) => c.value === value) ?? choices[0]

  const open = () => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (r === undefined) return
    setAt({ x: align === 'right' ? r.right - 220 : r.left - 6, y: r.bottom + 4 })
  }
  const close = (refocus = true) => {
    setAt(null)
    if (refocus) buttonRef.current?.focus()
  }
  // While open, this menu is the one Esc (and a click elsewhere in the dialog) closes first.
  useEffect(() => {
    if (at === null) return
    const closer = () => close()
    pickerCloser.current = closer
    return () => {
      if (pickerCloser.current === closer) pickerCloser.current = null
    }
  }, [at])

  // Focus the ticked option once the menu is on screen.
  useEffect(() => {
    if (at === null) return
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')
    const i = choices.findIndex((c) => c.value === value)
    items?.[Math.max(0, i)]?.focus()
  }, [at !== null])

  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') {
      // Tab leaves the menu the way Esc does: closed, focus back on its button.
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus()
  }

  return (
    <>
      <button ref={buttonRef} type="button" className="share-picker" aria-haspopup="menu" aria-expanded={at !== null} aria-label={`${label}: ${current.label}`} data-testid={testId} aria-disabled={disabled === true} onClick={() => (disabled === true ? undefined : at === null ? open() : close())}>
        <span>{current.label}</span>
        <TriangleIcon up={at !== null} />
      </button>
      {at !== null && (
        <ContextMenuSurface x={at.x} y={at.y} width={220} className="share-menu" onClose={() => close(false)}>
          <div ref={menuRef} role="group" aria-label={label} onKeyDown={onMenuKey}>
            {choices.map((c) => (
              <button
                key={c.value}
                type="button"
                role="menuitemradio"
                aria-checked={c.value === value}
                className="ctx-menu__item"
                data-hint={c.value === value ? '✓' : undefined}
                onClick={() => {
                  close()
                  if (c.value !== value) onPick(c.value)
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        </ContextMenuSurface>
      )}
    </>
  )
}

/** The open picker's closer, if any — so Esc and a click elsewhere in the dialog close the MENU first. */
const pickerCloser: { current: (() => void) | null } = { current: null }

const ACCESS: readonly Choice<'none' | 'anyone'>[] = [
  { value: 'none', label: 'Not shared' },
  { value: 'anyone', label: 'Anyone with the link' },
]
const PERMISSION: readonly Choice<'download' | 'view'>[] = [
  { value: 'download', label: 'View and download' },
  { value: 'view', label: 'View only' },
]

const LockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
)
const GlobeIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </svg>
)
const LinkIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
)

export function ShareDialog({ root, path, onClose, onOpenSettings }: ShareDialogProps) {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [entry, setEntry] = useState<ShareEntry | null | undefined>(undefined)
  const [pending, setPending] = useState(() => isPending(path))
  const [busy, setBusy] = useState<Busy>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const name = stripExt(basename(path))
  const busyRef = useRef(busy)
  busyRef.current = busy
  const dialogRef = useRef<HTMLDivElement>(null)
  const loadedOnce = useRef(false)

  // Modal focus: once the content is on screen, focus goes to the access picker (or the first
  // button) so keys never land on the sidebar or canvas behind; whatever had focus gets it back.
  useEffect(() => {
    const previous = document.activeElement
    return () => {
      if (previous instanceof HTMLElement) previous.focus()
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const [s, e] = await Promise.all([api.share.status(), api.share.get({ root, path })])
      setStatus(s)
      setEntry(e)
      setNow(Date.now())
    } catch (err) {
      setProblem(errorText(err))
      setEntry(null)
    }
  }, [root, path])

  useEffect(() => {
    void refresh()
    const offMain = api.share.onChanged(() => {
      if (busyRef.current === null) void refresh()
    })
    const offLocal = onLiveShareChange(() => setPending(isPending(path)))
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      offMain()
      offLocal()
      clearInterval(tick)
    }
  }, [refresh, path])

  // Esc: an open picker menu first, then the dialog. Capture phase, so it runs before anything else.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (pickerCloser.current !== null) pickerCloser.current()
      else if (busyRef.current === null) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setProblem(null)
    setNote(null)
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      setProblem(errorText(err))
    } finally {
      setBusy(null)
      setNow(Date.now())
    }
  }

  const share = () =>
    run('sharing', async () => {
      const built = await buildShareContent(root, path)
      if (built.tooLarge)
        throw new Error(`This board is ${formatMB(built.bytes)} once its images are packed in; Cloudflare's free plan takes at most ${formatMB(MAX_SHARE_BYTES)} per upload. Use fewer or smaller images, or split the board.`)
      setEntry(await api.share.publish({ root, path, content: built.content }))
    })

  const unshare = () =>
    run('unsharing', async () => {
      await api.share.stop({ root, path })
      setEntry(null)
      setNote('Link turned off.')
    })

  const setPermission = (allowDownload: boolean) =>
    run('permission', async () => {
      setEntry(await api.share.setPermission({ root, path, allowDownload }))
    })

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const ready = status?.state === 'ready'
  const loading = status === null || entry === undefined
  const shared = entry !== null && entry !== undefined
  const on = shared || busy === 'sharing'
  const line: { tone: 'ok' | 'busy' | 'error'; text: string } | null =
    busy === 'sharing' ? { tone: 'busy', text: 'Uploading…' } : busy === 'unsharing' ? { tone: 'busy', text: 'Turning the link off…' } : shared ? liveLine(entry, pending, now) : null
  useEffect(() => {
    if (loading || loadedOnce.current) return
    loadedOnce.current = true
    const el = dialogRef.current
    ;(el?.querySelector<HTMLElement>('[data-testid=share-access]') ?? el?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()
  }, [loading])

  /** Keys stay in the dialog: Tab cycles inside it, and nothing typed here reaches the app behind (sidebar arrows, canvas shortcuts). */
  const onDialogKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (focusable.length === 0) return
    const i = focusable.indexOf(document.activeElement as HTMLElement)
    const next = e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : i === focusable.length - 1 ? 0 : i + 1
    e.preventDefault()
    focusable[next].focus()
  }

  // Who, not what: the permission picker on the same row already says what people can do.
  const helper = on ? 'Anyone on the internet with this link' : 'Only you can open this board'

  return (
    <div className="share-overlay" onMouseDown={() => busy === null && onClose()}>
      <div
        ref={dialogRef}
        className="share-dialog"
        role="dialog"
        onKeyDown={onDialogKey}
        aria-modal="true"
        aria-label={`Share ${name}`}
        onMouseDown={(e) => {
          e.stopPropagation()
          // A click on a picker's own button toggles it; anywhere else in the dialog closes an open menu.
          if (!(e.target as Element).closest('.share-picker')) pickerCloser.current?.()
        }}
        data-testid="share-dialog"
      >
        <header className="share-dialog__head">
          <h2 className="share-dialog__title" title={name}>
            Share “{name}”
          </h2>
          <button type="button" className="share-dialog__close" aria-label="Close" onClick={onClose} disabled={busy !== null}>
            ✕
          </button>
        </header>

        {loading ? (
          <p className="share-dialog__muted">…</p>
        ) : !ready ? (
          <div className="share-setup-note">
            <p>
              <strong>Sharing isn't set up on this computer yet.</strong> It uses your own free Cloudflare account; setting it up takes about two minutes and one pasted key.
            </p>
            <button
              type="button"
              className="share-btn share-btn--primary"
              onClick={() => {
                onClose()
                onOpenSettings()
              }}
            >
              Open Settings › Sharing
            </button>
          </div>
        ) : (
          <>
            <h3 className="share-access__label">General access</h3>
            <div className="share-access">
              <span className={`share-access__icon${on ? ' share-access__icon--on' : ''}`} aria-hidden>
                {on ? <GlobeIcon /> : <LockIcon />}
              </span>
              <div className="share-access__text">
                <Picker label="General access" testId="share-access" value={on ? 'anyone' : 'none'} choices={ACCESS} disabled={busy !== null} onPick={(v) => void (v === 'anyone' ? share() : unshare())} />
                <p className="share-access__helper" title={helper}>
                  {helper}
                </p>
              </div>
              {shared && (
                <div className="share-access__perm">
                  <Picker label="People with the link can" testId="share-permission" align="right" value={entry.allowDownload ? 'download' : 'view'} choices={PERMISSION} disabled={busy !== null} onPick={(v) => void setPermission(v === 'download')} />
                </div>
              )}
            </div>

            {line !== null && (
              <p className={`share-status share-status--${line.tone}`} role="status" data-testid="share-live">
                <span className="share-status__dot" aria-hidden />
                {line.text}
              </p>
            )}
            {note !== null && problem === null && line === null && <p className="share-status">{note}</p>}
            {problem !== null && (
              <p className="share-dialog__error" role="alert">
                {problem}
              </p>
            )}

            <footer className="share-dialog__footer">
              <button type="button" className="share-btn share-btn--outline" onClick={() => shared && void copy(entry.url)} disabled={!shared || entry.url === ''} data-testid="share-copy">
                <LinkIcon />
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" className="share-btn share-btn--primary" onClick={onClose} disabled={busy !== null} data-testid="share-done">
                Done
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
