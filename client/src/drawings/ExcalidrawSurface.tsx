/**
 * THE ENGINE SEAM (YAZ-879, fourth build unit of the Excalidraw embed YAZ-852).
 *
 * 🔒 ONE FILE OWNS THE CANVAS. This is the only component that mounts `<Excalidraw>`, the only
 * one that knows how a scene serializes, and the only one that knows what "changed" means to the
 * engine. `DrawingModal` — the overlay, the Save button, the dirty state, the error line — imports
 * nothing but this module's TYPES and this component, so swapping the engine (YAZ-868 puts
 * yaseendraw here) rewrites this file and touches no chrome. `DrawingModal.test.tsx` pins that
 * boundary rather than trusting it.
 *
 * LAZY: the engine arrives through `renderScene.ts`'s `loadExcalidraw()` — one dynamic import per
 * renderer, with the offline font pin and the export-source pin already applied — and the
 * stylesheet rides the same first open. Nothing here is static, so the entry chunk is unchanged
 * (YAZ-878's rule, verified the same way).
 *
 * SNAPSHOTS, not a controlled scene: the surface stays UNCONTROLLED (Excalidraw owns its own
 * undo, selection and tool state) and reports outward through `onSnapshot`. A snapshot is a cheap
 * change KEY (`getSceneVersion` — the engine's own sum of element versions, which is what it
 * offers for exactly this) plus a lazy `serialize()` that costs nothing until Save is pressed.
 * The FIRST snapshot is emitted at mount, from the loaded scene, BEFORE Excalidraw's own first
 * `onChange` — so the chrome always has a baseline to call "clean", even if the engine never
 * volunteered one. The baseline runs the disk elements through the engine's own
 * `restoreElements()` FIRST: restore is what the engine mounts (yaseendraw's bumps element
 * `version` and materializes rounding values — YAZ-929), so only a restore-then-compare
 * baseline agrees with the engine's first `onChange`, and an untouched drawing never reads
 * as dirty. Restore is deterministic, so the two independent runs always land on the same
 * version sum.
 *
 * SHAPE ON DISK: `serializeAsJSON(…, 'local')` is the library's OWN writer — the same one its
 * "Save to disk" uses — so element cleanup and the `files` filter (an image paste survives, a
 * deleted one does not) are its rules, not ours. Two things are ours: `source` stays
 * `yaseen-docs` (pinned as a global before the import, `renderScene.ts`) and a trailing newline,
 * so a file YAZ-877 created and this saved back differ only in what was drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import type { DrawingScene } from './drawingScene'
import { loadExcalidraw, type ExcalidrawModule } from './renderScene'

type ExcalidrawProps = ComponentProps<ExcalidrawModule['Excalidraw']>
type ChangeArgs = Parameters<NonNullable<ExcalidrawProps['onChange']>>

/** What the chrome learns about the canvas; deliberately engine-free (a number and a thunk). */
export interface DrawingSnapshot {
  /** Cheap identity of the drawn content: equal to the baseline's = nothing to save. */
  readonly version: number
  /** The exact bytes a save would write. Called once, on Save. */
  serialize(): string
}

export interface DrawingSurfaceProps {
  /** The scene as it came off disk; the canvas opens on it and never re-reads it. */
  scene: DrawingScene
  /** The app's resolved appearance, handed to the engine as-is. */
  theme: 'light' | 'dark'
  /** Mount, then every engine change. The first call is the chrome's clean baseline. */
  onSnapshot: (snapshot: DrawingSnapshot) => void
  /** The engine itself failed to load — the chrome shows it and offers nothing but close. */
  onFailed: (message: string) => void
}

/** The one failure this seam can raise on its own (the scene's own failures are the loader's). */
export const ENGINE_LOAD_FAILED = "Can't open the drawing editor."

/**
 * The file's own loose shape as the engine's arguments. `drawingScene.ts` validates only the
 * OUTLINE (an `elements` array) because the file is user data; the engine's `restore()` is what
 * decides whether these really are a scene — the same division `renderScene.ts` already makes.
 */
function engineScene(scene: DrawingScene): { elements: ChangeArgs[0]; appState: ChangeArgs[1]; files: ChangeArgs[2] } {
  return {
    elements: scene.elements as ChangeArgs[0],
    appState: scene.appState as unknown as ChangeArgs[1],
    files: (scene.files ?? {}) as ChangeArgs[2],
  }
}

/**
 * ⚡ EVERY PROP HANDED TO THE ENGINE IS STABLE. `<Excalidraw>` is memoized and calls `onChange`
 * whenever it renders, so a prop rebuilt per render is a feedback loop: change → the chrome
 * re-renders → new `initialData`/`onChange` identity → the memo misses → change… (React error
 * #185, caught in e2e on the first mount). Hence the memo, the ref-backed callbacks, and the
 * module-level `UI_OPTIONS`.
 */
const UI_OPTIONS = {
  // The file belongs to the note, not to the canvas: the engine's own open / save-to-disk
  // actions would be a second, competing door to it.
  canvasActions: { loadScene: false, saveToActiveFile: false, export: false },
} as const

export function ExcalidrawSurface({ scene, theme, onSnapshot, onFailed }: DrawingSurfaceProps) {
  const [engine, setEngine] = useState<ExcalidrawModule | null>(null)
  // Callbacks change identity on every chrome render; the load must run ONCE and `onChange` must
  // never change identity, so both go through refs.
  const engineRef = useRef<ExcalidrawModule | null>(null)
  const emitRef = useRef(onSnapshot)
  const failRef = useRef(onFailed)
  emitRef.current = onSnapshot
  failRef.current = onFailed

  useEffect(() => {
    let live = true
    // The stylesheet is the surface's, not the preview renderer's — a page that only PREVIEWS
    // drawings never pays for the editor's CSS.
    void import('@excalidraw/excalidraw/index.css')
    loadExcalidraw().then(
      (mod) => {
        if (!live) return
        engineRef.current = mod
        setEngine(mod)
        // The baseline, before the engine has said anything — through the engine's own
        // restore, because restored elements are what it mounts (see the module doc).
        const { elements, appState, files } = engineScene(scene)
        emitRef.current(snapshotOf(mod, mod.restoreElements(elements, null) as ChangeArgs[0], appState, files))
      },
      () => {
        if (live) failRef.current(ENGINE_LOAD_FAILED)
      },
    )
    return () => {
      live = false
    }
    // `scene` is the open drawing and never changes under one modal (the modal is keyed by target).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The saved scene may sit far from the origin; open on what it holds.
  const initialData = useMemo(() => ({ ...engineScene(scene), scrollToContent: true }), [scene])
  const onChange = useCallback((elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]) => {
    const mod = engineRef.current
    if (mod !== null) emitRef.current(snapshotOf(mod, elements, appState, files))
  }, [])

  if (engine === null) return <div className="drawing-modal__loading" />
  const { Excalidraw } = engine
  return <Excalidraw initialData={initialData} theme={theme} UIOptions={UI_OPTIONS} onChange={onChange} />
}

/** One snapshot from the engine's own two utilities; the only place either is called. */
function snapshotOf(engine: ExcalidrawModule, elements: ChangeArgs[0], appState: ChangeArgs[1], files: ChangeArgs[2]): DrawingSnapshot {
  return {
    version: engine.getSceneVersion(elements),
    // A text file in a git vault ends with a newline, exactly as `createDrawing` wrote it.
    serialize: () => `${engine.serializeAsJSON(elements, appState, files, 'local')}\n`,
  }
}
