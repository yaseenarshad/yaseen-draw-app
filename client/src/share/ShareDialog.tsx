/**
 * THE SHARE DIALOG (YAZ-1799 D6) — the Google Docs model Yasin approved. ONE dialog behind both
 * entry points (File › Share Link ⌘⇧L, sidebar right-click "Share"):
 *
 *   Share "<board>"                                          ✕
 *   General access
 *   (🌐)  Anyone with the link ▾               View and download ▾
 *         Anyone on the internet with this link can view and download
 *   ● Up to date · yesterday
 *   [🔗 Copy link]                                           [Done]
 *
 * "Anyone with the link" shares the board (the Export Drawing file, uploaded, "View and download"
 * by default); "Not shared" deletes it and the link dies at once. The permission flips a flag on
 * the SAME link without re-uploading; the Worker enforces it. Every save of a shared board
 * re-uploads by itself (`liveShare.ts`), so the status line only reports.
 *
 * MODAL KEYS: focus moves in the moment the dialog mounts (not once it has loaded), Tab cycles
 * inside it, and a window capture listener swallows any key aimed OUTSIDE it — nothing typed while
 * it is open reaches the sidebar tree or the canvas behind.
 *
 * Main owns every Cloudflare detail; the dialog never sees a token or a password.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ContextMenuSurface } from '../components/ContextMenuSurface'
import { GlobeIcon, LinkIcon, LockIcon, TriangleIcon } from '../components/icons'
import type { ShareEntry, ShareStatus } from '@shared/types'
import { api } from '../api'
import { basename, stripExt } from '../lib/paths'
import { isPending, onLiveShareChange } from './liveShare'
import { buildShareContent } from './shareContent'
import { errorText, liveLine, type Line } from './shareText'
import './share.css'

interface ShareDialogProps {
  root: string
  path: string
  onClose: () => void
  onOpenSettings: () => void
}

type Busy = null | 'sharing' | 'unsharing' | 'permission'

interface Choice<V extends string> {
  value: V
  label: string
}

const MENU_WIDTH = 220

/**
 * A borderless text button with a chevron that opens the app's own popover under it, the current
 * option ticked (the sort menu's ✓). Enter / Space open it (it is a button), ↑ / ↓ move, Enter /
 * Space pick, Tab closes it. The dialog owns which picker is open, so its Esc closes the menu first.
 */
function Picker<V extends string>(props: { label: string; value: V; choices: readonly Choice<V>[]; open: boolean; onOpenChange: (open: boolean) => void; onPick: (v: V) => void; disabled: boolean; testId: string; align?: 'left' | 'right' }) {
  const { label, value, choices, open, onOpenChange, onPick, disabled, testId, align = 'left' } = props
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)
  const current = choices.find((c) => c.value === value) ?? choices[0]
  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])]

  // Opening focuses the ticked option; a close that left focus nowhere (Esc) hands it back to the button.
  useEffect(() => {
    if (open) items()[Math.max(0, choices.findIndex((c) => c.value === value))]?.focus()
    else if (wasOpen.current && document.activeElement === document.body) buttonRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const close = () => {
    onOpenChange(false)
    buttonRef.current?.focus()
  }
  const onMenuKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Tab') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const all = items()
      const i = all.indexOf(document.activeElement as HTMLButtonElement)
      all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length]?.focus()
    }
  }

  const r = open ? buttonRef.current?.getBoundingClientRect() : undefined
  return (
    <>
      <button ref={buttonRef} type="button" className={`share-picker share-picker--${align}`} aria-haspopup="menu" aria-expanded={open} aria-label={`${label}: ${current.label}`} aria-disabled={disabled} data-testid={testId} onClick={() => !disabled && onOpenChange(!open)}>
        <span>{current.label}</span>
        <TriangleIcon up={open} />
      </button>
      {r !== undefined && (
        <ContextMenuSurface x={align === 'right' ? r.right - MENU_WIDTH : r.left - 6} y={r.bottom + 4} width={MENU_WIDTH} className="share-menu" onClose={() => onOpenChange(false)}>
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

const ACCESS: readonly Choice<'none' | 'anyone'>[] = [
  { value: 'none', label: 'Not shared' },
  { value: 'anyone', label: 'Anyone with the link' },
]
const PERMISSION: readonly Choice<'download' | 'view'>[] = [
  { value: 'download', label: 'View and download' },
  { value: 'view', label: 'View only' },
]

export function ShareDialog({ root, path, onClose, onOpenSettings }: ShareDialogProps) {
  const [status, setStatus] = useState<ShareStatus | null>(null)
  const [entry, setEntry] = useState<ShareEntry | null | undefined>(undefined)
  const [pending, setPending] = useState(() => isPending(path))
  const [busy, setBusy] = useState<Busy>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [menu, setMenu] = useState<null | 'access' | 'permission'>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const name = stripExt(basename(path))
  const dialogRef = useRef<HTMLDivElement>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  // What the window listener and `share:changed` read without resubscribing.
  const live = useRef({ busy, menu, onClose })
  live.current = { busy, menu, onClose }

  // Focus comes in at once — a key pressed while the dialog loads must not land on the row or
  // canvas behind — and goes back to whatever had it on close.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.focus()
    return () => {
      clearTimeout(copyTimer.current)
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
      if (live.current.busy === null) void refresh()
    })
    const offLocal = onLiveShareChange(() => setPending(isPending(path)))
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      offMain()
      offLocal()
      clearInterval(tick)
    }
  }, [refresh, path])

  // Capture phase, before anything else hears the key. Esc closes an open menu first, then the
  // dialog; any key aimed OUTSIDE the dialog is swallowed and focus pulled back in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inside = e.target instanceof Node && dialogRef.current?.contains(e.target) === true
      if (inside && e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (e.key !== 'Escape') dialogRef.current?.focus()
      else if (live.current.menu !== null) setMenu(null)
      else if (live.current.busy === null) live.current.onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const run = async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setProblem(null)
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
    // Main checks the size (TOO_LARGE, in plain English) — the one place it is checked.
    run('sharing', async () => setEntry(await api.share.publish({ root, path, content: await buildShareContent(root, path) })))

  const unshare = () =>
    run('unsharing', async () => {
      await api.share.stop({ root, path })
      setEntry(null)
    })

  const setPermission = (allowDownload: boolean) => run('permission', async () => setEntry(await api.share.setPermission({ root, path, allowDownload })))

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 1500)
  }

  const loading = status === null || entry === undefined
  const shared = entry !== null && entry !== undefined
  const on = shared || busy === 'sharing'
  const line: Line | null =
    busy === 'sharing' ? { tone: 'busy', text: 'Uploading…' } : busy === 'unsharing' ? { tone: 'busy', text: 'Turning the link off…' } : problem !== null ? { tone: 'error', text: problem } : shared ? liveLine(entry, pending, now) : null
  const helper = !on ? 'Only you can open this board' : shared && !entry.allowDownload ? 'Anyone on the internet with this link can view' : 'Anyone on the internet with this link can view and download'

  // Once loaded, the access picker takes focus — unless the user has already moved it.
  useEffect(() => {
    const el = dialogRef.current
    if (!loading && document.activeElement === el) (el?.querySelector<HTMLElement>('.share-picker') ?? el?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus()
  }, [loading])

  /** Tab cycles inside the dialog; no key typed here travels on to the app behind. */
  const onDialogKey = (e: ReactKeyboardEvent) => {
    e.stopPropagation()
    if (e.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
    if (focusable.length === 0) return
    const i = focusable.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    focusable[e.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : (i + 1) % focusable.length].focus()
  }

  return (
    <div className="share-overlay" onMouseDown={() => busy === null && onClose()}>
      <div
        ref={dialogRef}
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${name}`}
        tabIndex={-1}
        onKeyDown={onDialogKey}
        onMouseDown={(e) => {
          e.stopPropagation()
          // A picker's own button toggles its menu; a press anywhere else in the dialog closes it.
          if (!(e.target as Element).closest('.share-picker')) setMenu(null)
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
        ) : status.state !== 'ready' ? (
          <>
            <p className="share-dialog__text">Sharing isn't set up on this computer yet. It uses your own free Cloudflare account; setting it up takes about two minutes and one pasted key.</p>
            <footer className="share-dialog__footer">
              <button
                type="button"
                className="share-btn share-btn--primary"
                onClick={() => {
                  onClose()
                  onOpenSettings()
                }}
                data-testid="share-setup"
              >
                Open Settings › Sharing
              </button>
            </footer>
          </>
        ) : (
          <>
            <h3 className="share-access__label">General access</h3>
            <div className="share-access">
              <span className={`share-access__icon${on ? ' share-access__icon--on' : ''}`} aria-hidden>
                {on ? <GlobeIcon /> : <LockIcon />}
              </span>
              <div className="share-access__text">
                <Picker label="General access" testId="share-access" value={on ? 'anyone' : 'none'} choices={ACCESS} open={menu === 'access'} onOpenChange={(o) => setMenu(o ? 'access' : null)} disabled={busy !== null} onPick={(v) => void (v === 'anyone' ? share() : unshare())} />
                <p className="share-access__helper" title={helper}>
                  {helper}
                </p>
              </div>
              {shared && (
                <Picker label="People with the link can" testId="share-permission" align="right" value={entry.allowDownload ? 'download' : 'view'} choices={PERMISSION} open={menu === 'permission'} onOpenChange={(o) => setMenu(o ? 'permission' : null)} disabled={busy !== null} onPick={(v) => void setPermission(v === 'download')} />
              )}
            </div>

            {line !== null && (
              <p className={`share-status share-status--${line.tone}`} role="status" data-testid="share-live">
                <span className="share-status__dot" aria-hidden />
                {line.text}
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
