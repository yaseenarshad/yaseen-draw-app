/**
 * VERSION HISTORY (🔒 YAZ-1897 D4): right-click a board › Version history, or "See changes" on a
 * merge notice. Every sync commit is a version; this lists them and shows any one AS A PICTURE —
 * never JSON:
 *
 *   Version history — “Roadmap”                                           ✕
 *   ┌──────────────────────────┐ ┌───────────────────────────────────────┐
 *   │ Sam · 2 minutes ago      │ │ [Changes since this version][As it was]│
 *   │   merged                 │ │                                       │
 *   │▌Your version before the  │ │          (the board, marked)          │
 *   │  merge · this computer   │ │                                       │
 *   │ You · yesterday          │ │ ● 2 added  ● 1 changed  ● 1 removed    │
 *   └──────────────────────────┘ └───────────────────────────────────────┘
 *                                     [Restore this version]   [Done]
 *
 * "Changes since this version" draws the board as it is NOW with what differs from the chosen
 * version marked (`compare.ts`): pick "your version before the merge" and the marks are what the
 * merge brought in. "As it was" draws the chosen version itself. Restore writes it over the board
 * as an ordinary edit (main); an open editor reloads through its watcher rule, a shared board's
 * link re-uploads (`noteBoardSaved`), and the version it replaced stays in history.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { BoardVersion, BoardVersionScene, DrawingFileEntry } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { loadExcalidraw, type ExcalidrawModule } from '../drawings/engine'
import { parseSceneText, type DrawingScene } from '../drawings/drawingScene'
import { basename, stripExt } from '../lib/paths'
import { relativeTime } from '../lib/relativeTime'
import { createScenePreviewPng, visibleElements, type PreviewBounds } from '../lib/scenePreview'
import { cycleTab, useModalKeys } from '../lib/modalKeys'
import { useAppliedTheme } from '../lib/theme'
import { noteBoardSaved } from '../share/liveShare'
import { changesScene, compareBoards, hasChanges, MARK, type BoardChanges } from './compare'
import './history.css'

interface VersionHistoryProps {
  root: string
  path: string
  /** Opened from a merge notice: start on "your version before the merge" when there is one. */
  fromMerge?: boolean
  onClose: () => void
  onNotice: (text: string) => void
}

type View = 'changes' | 'version'

interface Board {
  scene: DrawingScene
  files: Record<string, DrawingFileEntry>
}

interface Picture {
  key: string
  /** A PNG data URL; '' for a board with nothing visible; null when it could not be drawn. */
  png: string | null
  changes: BoardChanges | null
}

const PICTURE_BOUNDS: PreviewBounds = { maxWidth: 1100, maxHeight: 760, padding: 24 }

/** The image map the engine's export wants, from the bridge's `{ mimeType, dataURL }` entries. */
function engineFiles(...maps: Record<string, DrawingFileEntry>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const created = Date.now()
  for (const map of maps) for (const [id, f] of Object.entries(map)) out[id] = { id, mimeType: f.mimeType, dataURL: f.dataURL, created }
  return out
}

/** A failure in this dialog's own words: the bridge's message, or "not a board" for a file that will not parse. */
function problemText(err: unknown): string {
  if (err instanceof BridgeRequestError) return err.message
  return err instanceof SyntaxError ? "This board's file isn't valid JSON, so its history can't be compared." : err instanceof Error ? err.message : String(err)
}

export function versionLabel(v: BoardVersion): string {
  return v.localOnly ? 'Your version before the merge' : v.author
}

export function versionMeta(v: BoardVersion, now: number): string {
  return [relativeTime(v.at, now), v.merged ? 'merged' : null, v.localOnly ? 'only on this computer' : null].filter((x) => x !== null).join(' · ')
}

export function VersionHistory({ root, path, fromMerge = false, onClose, onNotice }: VersionHistoryProps) {
  const name = stripExt(basename(path))
  const theme = useAppliedTheme()
  const dialogRef = useRef<HTMLDivElement>(null)
  const [versions, setVersions] = useState<BoardVersion[] | null>(null)
  const [current, setCurrent] = useState<Board | null>(null)
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  const [selected, setSelected] = useState(0)
  const [view, setView] = useState<View>('changes')
  const [picture, setPicture] = useState<Picture | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const scenes = useRef(new Map<string, Promise<BoardVersionScene>>())
  const now = useRef(Date.now()).current

  useModalKeys(dialogRef, () => {
    if (confirming) setConfirming(false)
    else if (!busy) onClose()
  })

  useEffect(() => {
    let live = true
    Promise.all([api.github.history(root, path), api.drawing.load({ root, path }), loadExcalidraw()]).then(
      ([list, board, mod]) => {
        if (!live) return
        const before = fromMerge ? list.findIndex((v) => v.localOnly) : -1
        setVersions(list)
        setSelected(Math.max(0, before))
        setCurrent({ scene: parseSceneText(board.json), files: board.files })
        setEngine(mod)
      },
      (err: unknown) => live && setProblem(problemText(err)),
    )
    return () => {
      live = false
    }
  }, [root, path, fromMerge])

  const listRef = useRef<HTMLUListElement>(null)
  // Once the list is there, it takes focus, so ↑ / ↓ work straight away.
  useEffect(() => {
    if (versions !== null && versions.length > 0) listRef.current?.focus()
  }, [versions])

  const version = versions?.[selected]
  const key = version === undefined ? null : `${version.ref}\n${view}\n${theme}`

  // Draw the chosen version — the fetch is cached per ref, the drawing is redone per view and theme.
  useEffect(() => {
    if (version === undefined || current === null || engine === null || key === null) return
    let live = true
    let scene = scenes.current.get(version.ref)
    if (scene === undefined) {
      scene = api.github.version(root, path, version.ref)
      scenes.current.set(version.ref, scene)
    }
    void (async () => {
      try {
        const then = await scene
        const thenScene = parseSceneText(then.json)
        const changes = compareBoards(thenScene.elements, current.scene.elements)
        const elements = view === 'changes' ? changesScene(engine, current.scene.elements, changes) : thenScene.elements
        const files = view === 'changes' ? engineFiles(then.files, current.files) : engineFiles(then.files)
        const appState = { ...(view === 'changes' ? current.scene.appState : thenScene.appState), theme }
        const png = visibleElements(elements).length === 0 ? '' : await createScenePreviewPng(engine, { elements, appState, files }, PICTURE_BOUNDS)
        if (live) setPicture({ key, png, changes })
      } catch {
        if (live) setPicture({ key, png: null, changes: null })
      }
    })()
    return () => {
      live = false
    }
  }, [version, current, engine, key, view, theme, root, path])

  const shown = picture !== null && picture.key === key ? picture : null
  const unchanged = shown?.changes !== null && shown?.changes !== undefined && !hasChanges(shown.changes)

  const restore = async () => {
    if (version === undefined) return
    setBusy(true)
    setProblem(null)
    try {
      await api.github.restore(root, path, version.ref)
      noteBoardSaved(root, path)
      onNotice(`Restored “${name}” to the version from ${relativeTime(version.at, Date.now())}.`)
      onClose()
    } catch (err) {
      setProblem(problemText(err))
      setBusy(false)
      setConfirming(false)
    }
  }

  const onListKey = (e: ReactKeyboardEvent) => {
    if (versions === null || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    e.preventDefault()
    setConfirming(false)
    setSelected((i) => Math.min(versions.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1))))
  }

  const loading = versions === null && problem === null
  return (
    <div className="confirm-overlay history-overlay" onMouseDown={() => !busy && onClose()}>
      <div ref={dialogRef} className="confirm history-dialog" role="dialog" aria-modal="true" aria-label={`Version history of ${name}`} tabIndex={-1} onKeyDown={(e) => cycleTab(e, dialogRef.current)} onMouseDown={(e) => e.stopPropagation()} data-testid="version-history">
        <header className="history-dialog__head">
          <h2 className="history-dialog__title" title={name}>
            Version history — “{name}”
          </h2>
          <button type="button" className="history-dialog__close" aria-label="Close" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </header>

        {loading ? (
          <p className="history-dialog__muted">…</p>
        ) : versions === null || versions.length === 0 ? (
          <p className="history-dialog__muted" data-testid="history-empty">
            {problem ?? 'No versions yet. Versions are the commits GitHub sync makes — turn it on in Settings › Sync to start keeping them.'}
          </p>
        ) : (
          <div className="history-dialog__body">
            <ul ref={listRef} className="history-list" role="listbox" aria-label="Versions" tabIndex={0} aria-activedescendant={`history-v${selected}`} onKeyDown={onListKey}>
              {versions.map((v, i) => (
                <li
                  key={v.ref}
                  id={`history-v${i}`}
                  role="option"
                  aria-selected={i === selected}
                  className={`history-list__row${i === selected ? ' history-list__row--on' : ''}${v.localOnly ? ' history-list__row--local' : ''}`}
                  onClick={() => {
                    setSelected(i)
                    setConfirming(false)
                  }}
                >
                  <span className="history-list__who">{versionLabel(v)}</span>
                  <span className="history-list__meta">{versionMeta(v, now)}</span>
                </li>
              ))}
            </ul>

            <section className="history-view">
              <div className="history-view__tabs" role="tablist">
                {(['changes', 'version'] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} className={`history-view__tab${view === v ? ' history-view__tab--on' : ''}`} onClick={() => setView(v)}>
                    {v === 'changes' ? 'Changes since this version' : 'As it was'}
                  </button>
                ))}
              </div>
              <div className="history-view__picture" data-testid="history-picture">
                {shown === null ? (
                  <span className="history-dialog__muted">Drawing…</span>
                ) : shown.png === null ? (
                  <span className="history-dialog__muted">This version can't be drawn.</span>
                ) : shown.png === '' ? (
                  <span className="history-dialog__muted">Empty board</span>
                ) : (
                  <img src={shown.png} alt={view === 'changes' ? `${name} now, with the changes since this version marked` : `${name} as it was in this version`} />
                )}
              </div>
              <p className="history-view__legend" data-testid="history-legend">
                {shown === null || shown.changes === null ? ' ' : unchanged ? 'No changes since this version.' : view === 'changes' ? <Legend changes={shown.changes} /> : 'The board as it was in this version.'}
              </p>
            </section>
          </div>
        )}

        {problem !== null && versions !== null && versions.length > 0 && (
          <p className="history-dialog__problem" role="alert">
            {problem}
          </p>
        )}

        <footer className="history-dialog__footer">
          {confirming ? (
            <>
              <span className="history-dialog__ask">Replace the board with this version? The current one stays in history.</span>
              <button type="button" className="confirm__btn" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </button>
              <button type="button" className="confirm__btn btn--primary" onClick={() => void restore()} disabled={busy} data-testid="history-restore-confirm">
                {busy ? 'Restoring…' : 'Restore'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="confirm__btn" onClick={() => setConfirming(true)} disabled={version === undefined || unchanged || busy} data-testid="history-restore">
                Restore this version
              </button>
              <button type="button" className="confirm__btn btn--primary" onClick={onClose} disabled={busy}>
                Done
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  )
}

function Legend({ changes }: { changes: BoardChanges }) {
  const kinds = [
    ['added', changes.added.length],
    ['changed', changes.changed.length],
    ['removed', changes.removed.length],
  ] as const
  return (
    <>
      {kinds
        .filter(([, n]) => n > 0)
        .map(([kind, n]) => (
          <span key={kind} className={`history-legend history-legend--${kind}`}>
            <span className="history-legend__dot" style={{ color: MARK[kind] }} aria-hidden />
            {n} {kind}
          </span>
        ))}
    </>
  )
}
