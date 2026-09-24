/**
 * A `.drawio` open in a tab (YAZ-1802): `DrawingEditor`'s twin — save and sync chips, conflict bar,
 * debounced autosave, quit flush, rename continuity — with draw.io where the canvas is.
 *
 * 🔒 D4: draw.io runs in an iframe on its own origin and is talked to by postMessage only
 * (`drawioProtocol.ts`). The XML is loaded BEFORE the iframe mounts, so a file main refuses is the
 * error pane and draw.io can never autosave over it. Autosave counts draw.io's changes and leaves
 * the rules to `lib/autosave.ts`; outside changes follow `DrawingEditor`'s rule. Theme (D12) and
 * the dark-mode colour setting (D16) apply live by message. Keys, export and share: docs/CONTRACTS.md
 * › draw.io diagrams.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { DRAWIO_ORIGIN } from '@shared/drawio'
import type { DiagramDarkColors, GithubSyncStatus } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import type { WatchSource } from '../hooks/useWatch'
import { Autosave, SaveConflict, type SaveStatus } from '../lib/autosave'
import type { NoticeKind } from '../lib/notice'
import { basename, stripExt } from '../lib/paths'
import { registerRenameContinuity } from '../lib/renameContinuity'
import { useAppliedTheme } from '../lib/theme'
import { noteBoardSaved } from '../share/liveShare'
import { ConflictBar } from '../drawings/ConflictBar'
import { BOARD_COMMAND_EVENT, type BoardCommand } from '../drawings/boardCommand'
import { mayTakeFocus } from '../drawings/focusHandoff'
import { SaveIndicator } from '../drawings/SaveIndicator'
import { SyncIndicator } from '../drawings/SyncIndicator'
import { drawioAdaptiveColors, drawioConfig, drawioFrameUrl, readDrawioMessage } from './drawioProtocol'
import { renderDiagramImage } from './renderDiagram'
import '../drawings/statusChips.css'
import './drawioEditor.css'

/** What a diagram that will not open says; main's reason follows it when there is one. */
export const BROKEN_DIAGRAM_DOCUMENT = "This draw.io diagram can't be opened"

const EXPORT_FAILED = "The draw.io diagram couldn't be exported."
const EXPORT_EMPTY = 'This draw.io diagram is empty, so there is no image to export.'

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
  /** 🔒 YAZ-1802 D16: the app's dark-mode colour setting, applied live (see the module doc). */
  darkColors: DiagramDarkColors
  /** The window's ONE passive notice: where an exported image landed, or why it did not. */
  onNotice?: (text: string, icon?: NoticeKind) => void
  /** App's sidebar toggle: ⌘B pressed inside draw.io with nothing selected, sent up by our PostConfig.js as a `shortcut` event. */
  onToggleSidebar?: () => void
}

interface LoadedDiagram {
  xml: string
  mtime: number
}

export function DrawioEditor({ root, path, watch, sync, onSyncNow, darkColors, onNotice, onToggleSidebar }: DrawioEditorProps) {
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
      {error === null && loaded !== null && (
        <DiagramHost key={path} root={root} path={path} loaded={loaded} watch={watch} sync={sync} onSyncNow={onSyncNow} darkColors={darkColors} onNotice={onNotice} onToggleSidebar={onToggleSidebar} />
      )}
    </section>
  )
}

interface DiagramHostProps extends DrawioEditorProps {
  loaded: LoadedDiagram
}

/** Mounts exactly one draw.io iframe for `loaded` and owns everything that writes. */
function DiagramHost({ root, path, loaded, watch, sync, onSyncNow, darkColors, onNotice, onToggleSidebar }: DiagramHostProps) {
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
  /** The handshake (drawioProtocol.ts): our PostConfig is in, draw.io asked to be configured, draw.io listens. */
  const handshake = useRef({ overlayReady: false, configureAsked: false, configured: false, initialised: false })
  /** The theme draw.io is showing (the URL's, then each flip sent), and the one the app wants now. */
  const shownTheme = useRef(theme)
  const wantedTheme = useRef(theme)
  /** The same pair for the dark-mode colour setting: what the configure reply (then each change) sent, and what the app wants now. */
  const shownColors = useRef(darkColors)
  const wantedColors = useRef(darkColors)
  /** A retired host never writes again (a delete, or a rename that moved this path away). */
  const retired = useRef(false)

  const post = useCallback((msg: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), DRAWIO_ORIGIN)
  }, [])

  const save = useCallback(
    async (_version: number, expectedMtime: number): Promise<{ mtime: number }> => {
      try {
        const res = await api.diagram.save({ root, path, xml: latestXml.current, expectedMtime })
        noteBoardSaved(root, path)
        return res
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
    shownColors.current = wantedColors.current
    post({ action: 'configure', config: drawioConfig(wantedColors.current) })
  }, [post])

  /** Show the app's theme, once draw.io listens: its own `darkMode` / `lightMode` action. */
  const syncTheme = useCallback(() => {
    if (!handshake.current.initialised || shownTheme.current === wantedTheme.current) return
    shownTheme.current = wantedTheme.current
    post({ action: 'invokeAction', actionName: wantedTheme.current === 'dark' ? 'darkMode' : 'lightMode' })
  }, [post])

  /** A change of the dark-mode colour setting since the configure reply, once draw.io listens: our PostConfig's message. */
  const syncColors = useCallback(() => {
    if (!handshake.current.initialised || shownColors.current === wantedColors.current) return
    shownColors.current = wantedColors.current
    post({ action: 'yaseenAdaptiveColors', value: drawioAdaptiveColors(wantedColors.current) })
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
          h.initialised = true
          syncTheme()
          syncColors()
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
        case 'shortcut':
          onToggleSidebar?.()
          return
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
      if (fallback !== undefined) clearTimeout(fallback)
    }
  }, [configure, syncTheme, syncColors, sendLoad, save, loaded.mtime, onToggleSidebar])

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

  // `DrawingEditor`'s watcher rule: settle the in-flight save, then echo / reload / conflict.
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

  // 🔒 YAZ-1802 D12: the app's theme, live.
  useEffect(() => {
    wantedTheme.current = theme
    syncTheme()
  }, [theme, syncTheme])

  // 🔒 YAZ-1802 D16: the dark-mode colour setting, live.
  useEffect(() => {
    wantedColors.current = darkColors
    syncColors()
  }, [darkColors, syncColors])

  /** File › Export Image… (🔒 D9): the XML draw.io last posted, unsaved edits included, drawn before the sheet opens because the pick decides the format. */
  const exportImage = useCallback(async () => {
    try {
      const xml = latestXml.current
      const [png, svg] = await Promise.all([renderDiagramImage(xml, 'png'), renderDiagramImage(xml, 'svg')])
      if (png === '') {
        onNotice?.(EXPORT_EMPTY)
        return
      }
      const answer = await api.dialog.saveImage({ defaultName: `${stripExt(basename(path))}.png`, png, svg })
      if ('cancelled' in answer) return
      onNotice?.(`Exported to ${basename(answer.path)}`)
    } catch (err) {
      onNotice?.(err instanceof BridgeRequestError && err.message !== '' ? err.message : EXPORT_FAILED, 'error')
    }
  }, [onNotice, path])
  const exportImageRef = useRef(exportImage)
  exportImageRef.current = exportImage

  // The menu's command, claimed on THIS tab's section so only the diagram in front answers
  // (`boardCommand.ts`). Export Image… is the one board command a diagram answers.
  useEffect(() => {
    const section = hostRef.current?.closest('.editor--diagram') ?? null
    if (section === null) return
    const onCommand = (event: Event): void => {
      if ((event as CustomEvent<BoardCommand>).detail.kind === 'export-image') void exportImageRef.current()
    }
    section.addEventListener(BOARD_COMMAND_EVENT, onCommand)
    return () => section.removeEventListener(BOARD_COMMAND_EVENT, onCommand)
  }, [])

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
