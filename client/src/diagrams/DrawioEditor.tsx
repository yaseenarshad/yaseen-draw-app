/**
 * THE DIAGRAM DOCUMENT (YAZ-1802): a `.drawio` opened full-pane in a tab. `Editor` dispatches
 * `kind === 'diagram'` here; it is `DrawingEditor`'s twin — save chip, sync chip, conflict bar,
 * debounced autosave, the quit handshake, rename continuity — with draw.io where the canvas is.
 *
 * 🔒 YAZ-1802 D4 — AN IFRAME ON ITS OWN ORIGIN, TALKED TO BY POSTMESSAGE ONLY. draw.io is
 * jgraph's own webapp, served by main at `app://drawio` under a no-network CSP. Being another
 * origin is the sandbox: the iframe cannot reach `window.yaseenDraw`, the renderer cannot reach
 * into draw.io, and the two exchange only the JSON strings `drawioProtocol.ts` names. A message
 * counts only from THIS iframe's window AND the drawio origin.
 *
 * LOAD FIRST, THEN MOUNT. The XML is read through `diagram:load` BEFORE draw.io exists; a file
 * main refuses (empty, corrupt, not draw.io, cut short) is the error pane, and draw.io is never
 * mounted on it — so an editor that failed to load can never autosave over the file.
 *
 * AUTOSAVE ON A COUNTER, like the drawing's version. draw.io posts the whole XML on every change
 * (`autosave: 1`); the latest XML sits in a ref and `Autosave<number>` sees only a counter, so the
 * 500 ms debounce, the dirty rule, the mtime guard and the conflict block are `lib/autosave.ts`'s,
 * unchanged. The baseline is draw.io's own `load` answer: opening a diagram and not touching it
 * writes nothing (a compressed file stays compressed until the first edit, D3).
 *
 * EXTERNAL CHANGES are `DrawingEditor`'s rule exactly: once any in-flight save has settled, a
 * watcher `change` whose mtime is our own save's is the echo; otherwise a CLEAN tab reloads (the
 * `load` action again — undo history starts over, as it does for a drawing) and a DIRTY one gets
 * the Reload / Keep mine bar. A `CONFLICT` from the save door raises the same bar.
 *
 * ⌘S is draw.io's own: its `save` event carries the XML and the host flushes at once. Keys never
 * reach this document while the iframe has focus, which is why there is no capture handler here.
 *
 * 🔒 YAZ-1802 D12 — THE THEME FOLLOWS THE APP, LIVE: the first theme rides the URL (`dark=`), and
 * a flip afterwards is draw.io's own `darkMode` / `lightMode` action, invoked by message — no
 * reload, no lost undo.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GithubSyncStatus } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import { basename, stripExt } from '../lib/paths'
import { registerRenameContinuity } from '../lib/renameContinuity'
import { useAppliedTheme } from '../lib/theme'
import { ConflictBar } from '../drawings/ConflictBar'
import { mayTakeFocus } from '../drawings/focusHandoff'
import { SaveIndicator } from '../drawings/SaveIndicator'
import { SyncIndicator } from '../drawings/SyncIndicator'
import { DRAWIO_ORIGIN, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'
import '../drawings/statusChips.css'
import './drawioEditor.css'

/** What a diagram that will not open says; main's reason follows it when there is one. */
export const BROKEN_DIAGRAM_DOCUMENT = "This diagram can't be opened"

/**
 * How long the host waits for our PostConfig.js to say it is ready before configuring draw.io
 * anyway — a missing overlay must cost the keymap, never the document.
 */
const READY_FALLBACK_MS = 3000

export interface DrawioEditorProps {
  root: string
  path: string
  /** The window's one watcher subscription; the conflict rule listens on it. */
  watch: WatchSource
  /** The vault's sync status (YAZ-1081), App-owned; null while fetching, undefined = no chip. */
  sync?: GithubSyncStatus | null
  onSyncNow?: () => void
}

interface LoadedDiagram {
  xml: string
  mtime: number
}

export function DrawioEditor({ root, path, watch, sync, onSyncNow }: DrawioEditorProps) {
  const [loaded, setLoaded] = useState<LoadedDiagram | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setLoaded(null)
    setError(null)
    api.diagram.load({ root, path }).then(
      (res) => {
        if (live) setLoaded({ xml: res.xml, mtime: res.mtime })
      },
      // Missing, unreadable, not draw.io: ONE readable state naming why, never a blank pane.
      (err: unknown) => {
        if (!live) return
        const why = err instanceof BridgeRequestError && err.code === 'IO_ERROR' ? err.message : err instanceof BridgeRequestError && err.code === 'NOT_FOUND' ? 'the file is missing' : null
        setError(why === null ? `${BROKEN_DIAGRAM_DOCUMENT}.` : `${BROKEN_DIAGRAM_DOCUMENT}: ${why}.`)
      },
    )
    return () => {
      live = false
    }
  }, [root, path])

  return (
    <section className="editor editor--diagram">
      {error !== null && (
        <p className="editor-msg editor-msg--error" role="alert">
          {error}
        </p>
      )}
      {error === null && loaded === null && <p className="editor-msg">Loading…</p>}
      {/* Keyed by path so a rename mounts a fresh host rather than re-pointing a live iframe. */}
      {error === null && loaded !== null && <DiagramHost key={path} root={root} path={path} loaded={loaded} watch={watch} sync={sync} onSyncNow={onSyncNow} />}
    </section>
  )
}

interface DiagramHostProps extends DrawioEditorProps {
  loaded: LoadedDiagram
}

/** Mounts exactly one draw.io iframe for `loaded` and owns everything that writes. */
function DiagramHost({ root, path, loaded, watch, sync, onSyncNow }: DiagramHostProps) {
  const theme = useAppliedTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  /** The URL is fixed at mount: a theme flip is a message, never a reload of the editor. */
  const [src] = useState(() => drawioFrameUrl(theme))
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflictMtime, setConflictMtime] = useState<number | null>(null)
  const autosave = useRef<Autosave<number> | null>(null)
  /** The XML draw.io last posted — what the next save writes. */
  const latestXml = useRef(loaded.xml)
  /** Bumped on every draw.io change; `Autosave` compares these, never the XML. */
  const version = useRef(0)
  /** The mtime of the document a `load` action carried, until draw.io answers `load`. */
  const pendingLoad = useRef<number | null>(null)
  /** The handshake (drawioProtocol.ts): our PostConfig is in, and draw.io asked to be configured. */
  const handshake = useRef({ overlayReady: false, configureAsked: false, configured: false })
  /** The theme draw.io is showing, so a flip is sent once and the first render sends nothing. */
  const shownTheme = useRef(theme)
  /** A retired host never writes again (a delete, or a rename that moved this path away). */
  const retired = useRef(false)

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), DRAWIO_ORIGIN)
  }, [])

  const save = useCallback(
    async (_version: number, expectedMtime: number): Promise<{ mtime: number }> => {
      try {
        return await api.diagram.save({ root, path, xml: latestXml.current, expectedMtime })
      } catch (err) {
        // A stale guard is the conflict bar's business, not an error chip.
        if (err instanceof BridgeRequestError && err.mtime !== undefined) throw new SaveConflict(err.mtime)
        throw err
      }
    },
    [root, path],
  )

  /** Send a document into draw.io; its `load` answer becomes the new clean baseline at `mtime`. */
  const sendLoad = useCallback(
    (xml: string, mtime: number) => {
      pendingLoad.current = mtime
      latestXml.current = xml
      post({ action: 'load', xml, autosave: 1, title: stripExt(basename(path)) })
    },
    [post, path],
  )

  const configure = useCallback(() => {
    const h = handshake.current
    if (h.configured || !h.configureAsked) return
    h.configured = true
    post({ action: 'configure', config: drawioConfig() })
  }, [post])

  // The one message listener: the protocol, in the order drawioProtocol.ts documents.
  useEffect(() => {
    let fallback: ReturnType<typeof setTimeout> | undefined
    const onMessage = (ev: MessageEvent): void => {
      const msg = readDrawioMessage(ev, frameRef.current?.contentWindow)
      if (msg === null) return
      const h = handshake.current
      switch (msg.event) {
        case 'yaseenReady':
          h.overlayReady = true
          configure()
          return
        case 'configure':
          h.configureAsked = true
          if (h.overlayReady) configure()
          else fallback = setTimeout(configure, READY_FALLBACK_MS)
          return
        case 'init':
          sendLoad(latestXml.current, autosave.current?.mtime ?? loaded.mtime)
          return
        case 'load': {
          const mtime = pendingLoad.current ?? autosave.current?.mtime ?? loaded.mtime
          pendingLoad.current = null
          const a = autosave.current
          // draw.io's own answer IS the baseline: nothing it shows after a load is an edit.
          if (a === null) autosave.current = new Autosave<number>({ content: version.current, mtime, delayMs: 500, save, onStatus: setStatus, onConflict: setConflictMtime })
          else a.reset(version.current, mtime)
          return
        }
        case 'autosave':
        case 'save': {
          const a = autosave.current
          // A change before the first `load` answer has no baseline to be measured against.
          if (a === null || retired.current || pendingLoad.current !== null) return
          latestXml.current = msg.xml
          a.update(++version.current)
          if (msg.event === 'save') void a.flush()
          return
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (fallback !== undefined) clearTimeout(fallback)
    }
  }, [configure, sendLoad, save, loaded.mtime])

  /** Disk truth into draw.io, then a fresh baseline: the clean editor's answer to a change. */
  const reload = useCallback(async () => {
    const a = autosave.current
    if (a === null || retired.current) return
    try {
      const res = await api.diagram.load({ root, path })
      a.reset(version.current, res.mtime)
      sendLoad(res.xml, res.mtime)
      setConflictMtime(null)
    } catch {
      // The file went, or stopped being a diagram: keep what is on screen and let the next save
      // say so. A reload that cannot read must never blank the diagram in front of the user.
    }
  }, [root, path, sendLoad])

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

  // 🔒 YAZ-1802 D12: the app's theme, live, through draw.io's own actions.
  useEffect(() => {
    if (shownTheme.current === theme) return
    shownTheme.current = theme
    post({ action: 'invokeAction', actionName: theme === 'dark' ? 'darkMode' : 'lightMode' })
  }, [theme, post])

  // The close/quit handshake and the unmount flush — `DrawingEditor`'s, unchanged. A retired host
  // does neither: that is what keeps a delete deleted.
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

  // The shell's rename/delete continuity handle (lib/renameContinuity.ts).
  useEffect(
    () =>
      registerRenameContinuity(path, {
        flush: async () => {
          if (!retired.current) await autosave.current?.flush()
        },
        retire: () => {
          retired.current = true
          autosave.current?.dispose()
        },
        dirty: () => autosave.current?.dirty === true,
      }),
    [path],
  )

  // A tab coming back into view hands draw.io the keyboard (the YAZ-1812 focus handoff), gated
  // by `mayTakeFocus` so it never steals it from the ⌘K bar, the vault switcher or a dialog.
  useEffect(() => {
    const host = hostRef.current
    if (host === null || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      if (mayTakeFocus(document.activeElement, host.closest('.tabstack'))) frameRef.current?.focus()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="drawio-editor" ref={hostRef}>
      {conflictMtime !== null && <ConflictBar onReload={() => void reload()} onKeepMine={keepMine} />}
      <div className="drawio-editor__chips">
        {sync != null && onSyncNow !== undefined && <SyncIndicator status={sync} onSyncNow={onSyncNow} />}
        <SaveIndicator status={status} />
      </div>
      <iframe ref={frameRef} className="drawio-editor__frame" src={src} title={`${stripExt(basename(path))} — draw.io`} />
    </div>
  )
}
