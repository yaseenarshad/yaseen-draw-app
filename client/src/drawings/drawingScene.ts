/**
 * WHAT A SCENE IS, on disk and in hand (YAZ-878, rewritten for the document in 🔒 YAZ-1810).
 *
 * Pure: no engine import, no bridge call. The document's bytes arrive as text from
 * `drawing:load`, and leave as text through `drawing:save`; this module is the only place that
 * says what those bytes have to look like, and the one template a new drawing is born from.
 *
 * VALIDATION IS THE OUTLINE ONLY — an object carrying an `elements` ARRAY. The file is user
 * data, not our type: deciding whether those elements really are a scene is the engine's
 * `restore()`, which runs over them a moment later. Anything that fails the outline (empty file,
 * truncated JSON, a bare array, JSON with no elements) throws, and every throw lands in the
 * editor's ONE readable error pane — never a repair, never a half-parsed render, which would be
 * a lie about what the file holds.
 */
import { isRecord } from '@shared/guards'

/** The scene shape the canvas opens on; deliberately loose, for the reason above. */
export interface DrawingScene {
  /** Excalidraw elements exactly as the file holds them; validated only as "an array". */
  readonly elements: readonly unknown[]
  /** Missing in the file = the engine's own defaults; 🔒 YAZ-1775 D9 prefs are layered over this at mount. */
  readonly appState: Record<string, unknown>
  /** The image map, keyed by `fileId`. Empty for every file this app writes (🔒 YAZ-1775 D3). */
  readonly files: Record<string, unknown>
}

/** `source` on every scene this app writes — and the `EXCALIDRAW_EXPORT_SOURCE` pin (`engine.ts`). */
export const DRAWING_SOURCE = 'yaseen-draw'

/**
 * A valid EMPTY scene. `type`/`version`/`source`/`elements`/`appState`/`files` are the shape
 * every Excalidraw export carries, and `restore()` reads all of them. `appState: {}` on purpose:
 * the engine fills its own defaults, so a new file states nothing about theme or background it
 * does not mean.
 */
export const EMPTY_SCENE = {
  type: 'excalidraw',
  version: 2,
  source: DRAWING_SOURCE,
  elements: [],
  appState: {},
  files: {},
} as const

/**
 * The bytes a NEW drawing is created with (`createFile`'s content-at-create). Not an empty file:
 * "New drawing" must open on an empty canvas, and a zero-byte `.excalidraw` is exactly the
 * corrupt case the error pane exists for.
 */
export const EMPTY_SCENE_JSON = `${JSON.stringify(EMPTY_SCENE, null, 2)}\n`

/** Scene JSON → the canvas's opening scene; throws on anything that is not one (see the module doc). */
export function parseSceneText(text: string): DrawingScene {
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error('not an Excalidraw scene')
  const scene = parsed
  if (!Array.isArray(scene.elements)) throw new Error('not an Excalidraw scene: no elements')
  // The same `isRecord` the whole scene got: a file whose `appState` is an ARRAY carries no
  // prefs, not a list.
  const appState = isRecord(scene.appState) ? scene.appState : {}
  const files = isRecord(scene.files) ? scene.files : {}
  return { elements: scene.elements, appState, files }
}

/**
 * The view a board OPENS on (🔒 YAZ-1855 D1): the engine's `initialState.viewport`, fitting every
 * live element and never zooming past 100% (`scale-down`; the engine floors it at 10%). An empty
 * board has nothing to fit, so `undefined` leaves the engine at its own 100%.
 */
export function openViewport(scene: DrawingScene): { viewport: { target: readonly unknown[]; fit: 'scale-down' } } | undefined {
  const target = scene.elements.filter((e) => isRecord(e) && e.isDeleted !== true)
  return target.length > 0 ? { viewport: { target, fit: 'scale-down' } } : undefined
}
