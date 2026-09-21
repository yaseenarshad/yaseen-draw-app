/**
 * THE ENGINE SEAM (YAZ-879, rebuilt for the drawing DOCUMENT in 🔒 YAZ-1810).
 *
 * 🔒 ONE FILE OWNS THE CANVAS. This is the only component that mounts `<Excalidraw>`, the only
 * one that knows how a scene serializes, and the only one that knows what "changed" means to the
 * engine. `DrawingEditor` — the autosave, the dirty state, the conflict bar, the chips — imports
 * this module's TYPES and this component and nothing else, so replacing the engine rewrites this
 * file and touches no chrome. `DrawingEditor.test.tsx` mocks this one module and pins that
 * boundary rather than trusting it.
 *
 * LAZY: the engine arrives through `engine.ts`'s `loadExcalidraw()` — one dynamic import per
 * renderer, with the offline font pin and the export-source pin already applied — and the
 * stylesheet rides the same first open, so the entry chunk stays free of both.
 *
 * SNAPSHOTS, NOT A CONTROLLED SCENE: the surface stays UNCONTROLLED (the engine owns its undo,
 * selection and tool state) and reports outward through `onSnapshot`. A snapshot is a cheap
 * change KEY — `getSceneVersion`, the engine's own sum of element versions, which is what it
 * offers for exactly this — plus a `serialize()` that costs nothing until a save fires. The
 * FIRST snapshot is emitted at mount, from the loaded scene, BEFORE the engine's own first
 * `onChange`, so the host always has a baseline to call "clean" even if the engine never
 * volunteers one. That baseline runs the disk elements through the engine's own
 * `restoreElements()` first: restore is what the engine actually mounts (it bumps element
 * `version` and materialises rounding values), so only a restore-then-compare baseline agrees
 * with the engine's first `onChange`, and an untouched drawing never reads as dirty. Restore is
 * deterministic, so the two independent runs always land on the same sum.
 *
 * ⚡ `getSceneVersion` IS A SUM, and a sum is not an identity: an undo that returns to the same
 * total reads CLEAN. Accepted on YAZ-1775 (demo round 1) — the alternative is hashing the
 * serialised scene on every pointer move, which is the cost the version exists to avoid, and the
 * failure mode is "a redundant save was skipped", not "an edit was lost".
 *
 * SHAPE ON DISK: `serializeAsJSON(…, 'local')` is the library's OWN writer — the same one its
 * "Save to disk" uses — so element cleanup is its rules, not ours. Two things are ours: the
 * `files` argument is deliberately EMPTY (🔒 D3: bytes live in `<vault>/assets/`, the scene
 * carries ids only) and a trailing newline, so a file this app creates and this app saves differ
 * only in what was drawn. A snapshot hands the host the engine's LIVE files and the ids the
 * scene still references alongside the lean JSON, so the host can work out what the store is
 * missing (`unpersistedFiles`) without ever seeing an engine type.
 *
 * ⚡ EVERY PROP HANDED TO THE ENGINE IS STABLE. `<Excalidraw>` is memoized and calls `onChange`
 * whenever it renders, so a prop rebuilt per render is a feedback loop: change → the host
 * re-renders → new `initialData` / `onChange` identity → the memo misses → change… (React error
 * #185, seen on the first mount of the original embed). Hence the module-level `UI_OPTIONS`, the
 * ref-backed callbacks, the memoized `initialData`, and the host memoizing what it passes in.
 *
 * WHAT IS DELIBERATELY NOT HERE YET. This is the document's ENGINE seam, not its chrome: the
 * rail (`renderTopLeftUI`), the docked canvas panel (the engine's children), the application
 * menu's Export Image… / Canvas Background and the full parity checklist are YAZ-1812 (2F), and
 * the user-level canvas preferences that seed and follow `appState` are YAZ-1813 (2G) — for
 * which `canvasAppState` below is the one seam already in place. Adding either means adding
 * props here, not reshaping what exists.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { referencedFileIds, type DrawingFileData } from '@shared/drawingAssets'
import type { DrawingScene } from './drawingScene'
import { loadExcalidraw, type ExcalidrawModule } from './engine'

type ExcalidrawProps = ComponentProps<ExcalidrawModule['Excalidraw']>
type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>
type ImperativeApi = NonNullable<Parameters<NonNullable<ExcalidrawProps['onExcalidrawAPI']>>[0]>

/** What the host learns about the canvas; deliberately engine-free (a number and a thunk). */
export interface DrawingSnapshot {
  /** Cheap identity of the drawn content: equal to the baseline's = nothing to save. */
  readonly version: number
  /**
   * Everything a save needs, computed once when the save timer fires: the scene in the 🔒 D3
   * form (`files: {}`), the engine's live image map, and the ids the scene still references.
   */
  serialize(): { json: string; files: Record<string, DrawingFileData>; referenced: Set<string> }
}

/** The engine-free handle the host gets; nothing in it names the package. */
export interface DrawingSurfaceApi {
  /** Re-measure the canvas — a tab hidden by `visibility` may have been laid out at the wrong size. */
  refresh(): void
  /**
   * Replace what the canvas shows (the file changed on disk under a clean editor). Returns the
   * version the engine will report for it — the host's new clean baseline. Computed from the
   * RESTORED elements we hand in, not read back from the engine afterwards: a read-back races
   * the engine's own commit, and a baseline one version stale makes the reload look like an
   * edit and writes it straight back to disk.
   */
  replaceScene(scene: DrawingScene): number
}

export interface DrawingSurfaceProps {
  /** The scene as it came off disk; the canvas opens on it and never re-reads it. */
  scene: DrawingScene
  /** The app's resolved appearance, handed to the engine as-is (a prop change re-themes live). */
  theme: 'light' | 'dark'
  /**
   * User-level canvas preferences to seed `initialData.appState` with (🔒 D9, wired in
   * YAZ-1813). Layered OVER the file's own appState because none of these keys are ones the
   * engine exports into a file, so nothing of the drawing is overridden. `{}` = the engine's
   * defaults, which is what 2D ships.
   */
  canvasAppState?: Record<string, unknown>
  /** Mount, then every engine change. The first call is the host's clean baseline. */
  onSnapshot: (snapshot: DrawingSnapshot) => void
  /** The engine itself failed to load — the host shows it and offers nothing but the message. */
  onFailed: (message: string) => void
  /** Called once the engine is mounted, with the handle above. */
  onApi?: (api: DrawingSurfaceApi) => void
  /** The status chips, in the engine's own top-right row; memoize it (see the prop-stability note). */
  renderTopRight?: () => ReactNode
}

/** The one failure this seam can raise on its own (the file's own failures are the host's). */
export const ENGINE_LOAD_FAILED = "Can't open the drawing editor."

/** The engine's defaults, when the host seeds nothing (🔒 D9 arrives in YAZ-1813). */
const NO_CANVAS_APP_STATE: Record<string, unknown> = {}

/**
 * The file IS the document: the app's autosave is the ONE door to its bytes, so the engine's own
 * open and save-to-file doors stay shut — a second writer would race the first. `clearCanvas` is
 * off for the web app's own reason (a destructive action with no undo affordance in this shell).
 * Image export is untouched: it writes somewhere else entirely.
 */
const UI_OPTIONS = {
  canvasActions: { loadScene: false, saveToActiveFile: false, clearCanvas: false },
} as const

/**
 * The file's own loose shape as the engine's arguments. `drawingScene.ts` validates only the
 * OUTLINE because the file is user data; the engine's `restore()` decides the rest.
 */
function engineScene(scene: DrawingScene, canvasAppState: Record<string, unknown>): { elements: ChangeArgs[0]; appState: ChangeArgs[1]; files: ChangeArgs[2] } {
  return {
    elements: scene.elements as ChangeArgs[0],
    appState: { ...scene.appState, ...canvasAppState } as unknown as ChangeArgs[1],
    files: scene.files as ChangeArgs[2],
  }
}

export function ExcalidrawSurface({ scene, theme, canvasAppState = NO_CANVAS_APP_STATE, onSnapshot, onFailed, onApi, renderTopRight }: DrawingSurfaceProps) {
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  // Callbacks change identity on every host render; the load must run ONCE and `onChange` must
  // never change identity, so all of them go through refs.
  const engineRef = useRef<ExcalidrawModule | null>(null)
  const emitRef = useRef(onSnapshot)
  const failRef = useRef(onFailed)
  const apiRef = useRef(onApi)
  emitRef.current = onSnapshot
  failRef.current = onFailed
  apiRef.current = onApi
  // The scene and the seeded appState are read once, at mount, by the effect below; a ref keeps
  // them out of its dependency list without lying to the linter about what it uses.
  const openedOn = useRef({ scene, canvasAppState })

  useEffect(() => {
    let live = true
    // The stylesheet is the canvas's, and arrives with it.
    void import('@excalidraw/excalidraw/index.css')
    loadExcalidraw().then(
      (mod) => {
        if (!live) return
        engineRef.current = mod
        setEngine(mod)
        // The baseline, before the engine has said anything — through the engine's own restore,
        // because restored elements are what it mounts (see the module doc).
        const { elements, appState, files } = engineScene(openedOn.current.scene, openedOn.current.canvasAppState)
        emitRef.current(snapshotOf(mod, mod.restoreElements(elements, null) as ChangeArgs[0], appState, files))
      },
      () => {
        if (live) failRef.current(ENGINE_LOAD_FAILED)
      },
    )
    return () => {
      live = false
    }
  }, [])

  // The saved scene may sit far from the origin; open on what it holds.
  const initialData = useMemo(() => ({ ...engineScene(scene, canvasAppState), scrollToContent: true }), [scene, canvasAppState])

  const onChange = useCallback((elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]) => {
    const mod = engineRef.current
    if (mod !== null) emitRef.current(snapshotOf(mod, elements, appState, files))
  }, [])

  /** The imperative handle, wrapped once into the engine-free API the host sees. */
  const onExcalidrawAPI = useCallback((api: ImperativeApi | null) => {
    const mod = engineRef.current
    // The engine hands null on unmount; the host's ref keeps the last live handle, which it
    // never calls after its own unmount.
    if (mod === null || api === null) return
    apiRef.current?.({
      refresh: () => api.refresh(),
      replaceScene: (next) => {
        const restored = mod.restoreElements(next.elements as ChangeArgs[0], null)
        api.updateScene({ elements: restored })
        const entries = Object.values(next.files) as Parameters<ImperativeApi['addFiles']>[0]
        if (entries.length > 0) api.addFiles(entries)
        return mod.getSceneVersion(restored)
      },
    })
  }, [])

  // The chips live in the engine's OWN top-right row (the slot the web app's cloud status sits
  // in) rather than a strip above the canvas, so the canvas starts directly under the tab bar
  // and the chips can never cover the toolbar island.
  const renderTopRightUI = useMemo(
    () => (renderTopRight === undefined ? undefined : () => <div className="excalidraw-ui-top-right drawing-editor__top-right">{renderTopRight()}</div>),
    [renderTopRight],
  )

  if (engine === null) return <div className="drawing-editor__loading" />
  const { Excalidraw } = engine
  return (
    <Excalidraw
      initialData={initialData}
      theme={theme}
      UIOptions={UI_OPTIONS}
      onChange={onChange}
      onExcalidrawAPI={onExcalidrawAPI}
      renderTopRightUI={renderTopRightUI}
      // The engine's own scroll listener is for a page that scrolls under it; this pane does not.
      detectScroll={false}
      // Safe on a background tab: hidden layers are `visibility: hidden` (tabs.css), and
      // Chromium will not move focus into a hidden subtree — so only a visible canvas takes it.
      autoFocus
    />
  )
}

/** One snapshot from the engine's own two utilities; the only place either is called. */
function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]): DrawingSnapshot {
  return {
    version: engine.getSceneVersion(elements),
    serialize: () => {
      // The engine's map, flattened to the two fields that cross the bridge: its `created` /
      // `lastRetrieved` bookkeeping is about this session, not about the file.
      const live: Record<string, DrawingFileData> = {}
      for (const [id, entry] of Object.entries(files ?? {})) {
        if (typeof entry?.dataURL === 'string' && typeof entry.mimeType === 'string') live[id] = { mimeType: entry.mimeType, dataURL: entry.dataURL }
      }
      return {
        // 🔒 D3: an EMPTY files map on purpose — the scene names its images and never carries
        // them. A text file in a git vault ends with a newline, as a new drawing is written.
        json: `${engine.serializeAsJSON(elements, appState, {}, 'local')}\n`,
        files: live,
        referenced: referencedFileIds(elements),
      }
    },
  }
}
