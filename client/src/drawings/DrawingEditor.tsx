/**
 * THE DRAWING DOCUMENT (🔒 YAZ-1810): a `.excalidraw` opened full-pane in a tab. `Editor`
 * dispatches `kind === 'drawing'` here, and this is the shell's ordinary document host — save
 * chip, sync chip, conflict bar, debounced autosave, the quit handshake — with the canvas where
 * a text editor would be.
 *
 * 🔒 CHROME ONLY. The ENGINE lives behind `ExcalidrawSurface`; nothing in this file imports the
 * package, or anything that does. `DrawingEditor.test.tsx` mocks that one seam and pins the rest.
 *
 * AUTOSAVE ON THE VERSION, NOT THE BYTES. The engine reports a snapshot per pointer move. The
 * snapshot lives in a REF and `Autosave<number>` is fed only its cheap integer `version`, so a
 * drag costs one React render instead of hundreds — and serialising happens ONCE, inside
 * `save()`, when the 500 ms timer fires. The FIRST snapshot is the surface's restore-then-compare
 * baseline, so a drawing that is opened and not touched is clean and is never written back.
 *
 * EXTERNAL CHANGES. A watcher `change` on this path, once any in-flight save has settled, is our
 * own echo when its mtime matches what the save returned. Otherwise a CLEAN editor RELOADS from
 * disk and a DIRTY one raises the conflict bar (Reload / Keep mine). A `CONFLICT` from the save
 * door itself — a stale `expectedMtime`, i.e. the other window got there first — raises the same
 * bar, and `Autosave` blocks further writes until one of the two buttons answers it. Two windows
 * on one board is exactly this rule seen from both sides.
 *
 * RELOADING MUST NOT WRITE. The engine answers `updateScene` with its own `onChange`, so a naive
 * reload looks like an edit and saves the freshly-read bytes straight back. Two guards, both
 * cheap: `replaceScene` returns the version computed from the elements it handed the engine (not
 * read back from it, which races its commit), and the first snapshot after a reload is consumed
 * as the new BASELINE rather than as a change.
 *
 * ⚡ KEYS ARE THE HOST'S, NEVER `window`'s. ⌘S is caught on this element in the CAPTURE phase —
 * before the engine's own keymap sees it — and flushes now. A `window` listener would fire for
 * every mounted tab at once, and the shell keeps several mounted.
 *
 * THE CHIPS ARE THE ENGINE'S TOP-RIGHT ROW, not a strip above the canvas: the canvas starts
 * directly under the tab bar, and the chips sit where the web app's cloud status does.
 *
 * RENAME AND DELETE. The host registers the shell's rename-continuity handle for its path, so a
 * rename flushes these bytes before the file moves and a DELETE retires the controller — without
 * which closing the tab would flush on unmount and resurrect the file that was just trashed.
 * `capture()` answers null on purpose: a text buffer can travel to the new path as a string, a
 * live canvas cannot, and the pre-rename flush has already put it on disk.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DrawingLoadResponse, GithubSyncStatus } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import { registerRenameContinuity } from '../lib/renameContinuity'
import { useAppliedTheme } from '../lib/theme'
import { parseSceneText, type DrawingScene } from './drawingScene'
import { ExcalidrawSurface, type DrawingSnapshot, type DrawingSurfaceApi } from './ExcalidrawSurface'
import { SaveIndicator } from './SaveIndicator'
import { SyncIndicator } from './SyncIndicator'
import './drawingEditor.css'

/** What a document that will not open says — one message for its three causes (missing, corrupt, empty). */
export const BROKEN_DRAWING_DOCUMENT = "This drawing can't be opened: its file is missing or is not a scene."

export interface DrawingEditorProps {
  root: string
  path: string
  /** The window's one watcher subscription; the conflict rule listens on it. */
  watch: WatchSource
  /** The vault's sync status (YAZ-1081), App-owned; null while fetching, undefined = no chip. */
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
  /**
   * User-level canvas preferences as engine `appState` (🔒 D9, wired in YAZ-1813). Read once, at
   * load, to seed the scene; `{}` — the default — means the engine's own defaults.
   */
  canvasAppState?: Record<string, unknown>
}

/** A loaded document: the scene the canvas opens on, and the mtime the first save guards with. */
interface LoadedDocument {
  scene: DrawingScene
  mtime: number
}

/**
 * `drawing:load`'s answer as the engine wants it: the image map becomes `BinaryFileData`-shaped
 * entries keyed by id. Throws when the bytes are not a scene, which is the error pane.
 */
function toDocument(res: DrawingLoadResponse): LoadedDocument {
  const parsed = parseSceneText(res.json)
  const files: Record<string, unknown> = {}
  const created = Date.now()
  for (const [id, entry] of Object.entries(res.files)) files[id] = { id, mimeType: entry.mimeType, dataURL: entry.dataURL, created }
  return { scene: { ...parsed, files }, mtime: res.mtime }
}

export function DrawingEditor({ root, path, watch, sync, onSyncNow, canvasAppState }: DrawingEditorProps) {
  const [loaded, setLoaded] = useState<LoadedDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    api.drawing.load({ root, path }).then(
      (res) => {
        if (!live) return
        try {
          setLoaded(toDocument(res))
        } catch {
          setError(BROKEN_DRAWING_DOCUMENT)
        }
      },
      // Missing, unreadable, not a scene: ONE readable state, never a blank pane.
      () => {
        if (live) setError(BROKEN_DRAWING_DOCUMENT)
      },
    )
    return () => {
      live = false
    }
  }, [root, path])

  return (
    <section className="editor editor--drawing">
      {error !== null && (
        <p className="editor-msg editor-msg--error" role="alert">
          {error}
        </p>
      )}
      {error === null && loaded === null && <p className="editor-msg">Loading…</p>}
      {/* Keyed by path so a rename mounts a fresh host rather than re-pointing a live canvas. */}
      {error === null && loaded !== null && (
        <DrawingHost key={path} root={root} path={path} loaded={loaded} watch={watch} sync={sync} onSyncNow={onSyncNow} canvasAppState={canvasAppState} onFailed={setError} />
      )}
    </section>
  )
}

interface DrawingHostProps extends DrawingEditorProps {
  loaded: LoadedDocument
  onFailed: (message: string) => void
}

/** Mounts exactly one canvas for `loaded` and owns everything that writes. */
function DrawingHost({ root, path, loaded, watch, sync, onSyncNow, canvasAppState, onFailed }: DrawingHostProps) {
  const theme = useAppliedTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflictMtime, setConflictMtime] = useState<number | null>(null)
  /** The latest snapshot; read only when a save fires (see the module doc). */
  const snapshot = useRef<DrawingSnapshot | null>(null)
  const surface = useRef<DrawingSurfaceApi | null>(null)
  const autosave = useRef<Autosave<number> | null>(null)
  /** Set by a reload; the next snapshot is consumed as the new baseline, not as a change. */
  const reloadedTo = useRef<number | null>(null)
  /** A retired host never writes again (a delete, or a rename that moved this path away). */
  const retired = useRef(false)

  const save = useCallback(
    async (_version: number, expectedMtime: number): Promise<{ mtime: number }> => {
      const current = snapshot.current
      if (current === null) throw new Error('nothing to save')
      try {
        return await api.drawing.save({ root, path, json: current.serialize(), expectedMtime, newFiles: [] })
      } catch (err) {
        // A stale guard is the conflict bar's business, not an error chip.
        if (err instanceof BridgeRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
        throw err
      }
    },
    [root, path],
  )

  const onSnapshot = useCallback(
    (next: DrawingSnapshot) => {
      snapshot.current = next
      const a = autosave.current
      // The first snapshot IS the clean baseline (the surface restored the disk elements first).
      if (a === null) {
        autosave.current = new Autosave<number>({ content: next.version, mtime: loaded.mtime, delayMs: 500, save, onStatus: setStatus, onConflict: setConflictMtime })
        return
      }
      const mtime = reloadedTo.current
      if (mtime !== null) {
        reloadedTo.current = null
        // Whatever the engine settled on after `replaceScene` IS the baseline; treating it as a
        // change would write the bytes we have just read straight back to disk.
        a.reset(next.version, mtime)
        return
      }
      a.update(next.version)
    },
    [loaded.mtime, save],
  )

  /** Disk truth into the canvas, then a fresh baseline: the clean editor's answer to a change. */
  const reload = useCallback(async () => {
    const a = autosave.current
    const s = surface.current
    if (a === null || s === null || retired.current) return
    try {
      const doc = toDocument(await api.drawing.load({ root, path }))
      reloadedTo.current = doc.mtime
      a.reset(s.replaceScene(doc.scene), doc.mtime)
      setConflictMtime(null)
    } catch {
      // The file went, or stopped being a scene: keep what is on the canvas and let the next
      // save say so. A reload that cannot read must never blank the drawing in front of the user.
      reloadedTo.current = null
    }
  }, [root, path])

  // The watcher rule (see the module doc): settle the in-flight save, then echo / reload / conflict.
  useEffect(
    () =>
      watch.subscribe((ev) => {
        if (ev.type !== 'change' || ev.path !== path) return
        const a = autosave.current
        if (a === null || retired.current) return
        void a.settled().then(() => {
          if (ev.mtime === a.mtime) return // the echo of our own write
          if (a.dirty) setConflictMtime(ev.mtime)
          else void reload()
        })
      }),
    [watch, path, reload],
  )

  const keepMine = useCallback(() => {
    const a = autosave.current
    if (a === null || retired.current || conflictMtime === null) return
    setConflictMtime(null)
    void a.adopt(conflictMtime)
  }, [conflictMtime])

  // The close/quit handshake (main holds the window until this settles, 5 s cap) and the unmount
  // flush. A retired host does neither — that is what keeps a delete deleted.
  useEffect(() => {
    const offFlush = window.yaseenDraw.window.onFlush(async () => {
      if (!retired.current) await autosave.current?.flush()
    })
    return () => {
      offFlush()
      const a = autosave.current
      if (a !== null) {
        if (!retired.current) void a.flush()
        a.dispose()
      }
      autosave.current = null
    }
  }, [])

  // The shell's rename/delete continuity handle (see the module doc).
  useEffect(
    () =>
      registerRenameContinuity(path, {
        flush: async () => {
          if (!retired.current) await autosave.current?.flush()
        },
        capture: () => null,
        retire: () => {
          retired.current = true
          autosave.current?.dispose()
        },
      }),
    [path],
  )

  // A tab coming back from `visibility: hidden` may have been laid out at the wrong size.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) surface.current?.refresh()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // The chips, as the engine's top-right slot content: a new identity only when they would look
  // different (the surface hands this straight to a memoized `<Excalidraw>`).
  const renderTopRight = useCallback(
    () => (
      <div className="drawing-editor__chips">
        {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
        <SaveIndicator status={status} />
      </div>
    ),
    [status, sync, onSyncNow],
  )

  const onApi = useCallback((a: DrawingSurfaceApi) => {
    surface.current = a
  }, [])

  /** ⌘S flushes now — caught before the engine's own keymap, and never on `window`. */
  const onKeyDownCapture = (e: ReactKeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      e.stopPropagation()
      if (!retired.current) void autosave.current?.flush()
    }
  }

  return (
    <div className="drawing-editor" ref={hostRef} onKeyDownCapture={onKeyDownCapture}>
      {conflictMtime !== null && (
        <div className="conflict-bar" role="alert">
          <span>File changed on disk.</span>
          <button type="button" onClick={() => void reload()}>
            Reload
          </button>
          <button type="button" onClick={keepMine}>
            Keep mine
          </button>
        </div>
      )}
      <div className="drawing-editor__canvas">
        <ExcalidrawSurface scene={loaded.scene} theme={theme} canvasAppState={canvasAppState} onSnapshot={onSnapshot} onFailed={onFailed} onApi={onApi} renderTopRight={renderTopRight} />
      </div>
    </div>
  )
}
