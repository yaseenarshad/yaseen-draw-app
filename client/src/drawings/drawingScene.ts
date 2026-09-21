/**
 * Reading a drawing sidecar back off disk (YAZ-878).
 *
 * `api.readAsset` is the ONE door (YAZ-876): the embed's raw target goes through untouched —
 * path or bare basename — because readAsset already owns the resolution rule (root-relative when
 * it has a `/`, else Obsidian's shortest-path basename search). The renderer never joins paths.
 *
 * The bytes come back base64 (the asset pipe's shape for images and drawings alike), so a scene
 * is `atob` → UTF-8 → `JSON.parse`. Anything that is not a scene — a missing file, unreadable
 * bytes, invalid JSON, JSON without an `elements` ARRAY — throws, and every throw lands in the
 * preview's ONE broken state (never a crash, `editor/drawing/drawingPreview.ts`). No repair, no
 * partial render: a half-parsed scene would be a lie about what the file holds.
 */
import { api } from '../api'

/** The scene shape a preview needs; deliberately loose — the file is user data, not our type. */
export interface DrawingScene {
  /** Excalidraw elements exactly as the file holds them; validated only as "an array". */
  readonly elements: readonly unknown[]
  /** Optional in the file (YAZ-877 writes `{}`); missing = Excalidraw's own defaults. */
  readonly appState: Record<string, unknown>
  /** The binary-asset map; `null` when the file has none, which is what exportToSvg wants. */
  readonly files: Record<string, unknown> | null
}

/** Embed targets that get a preview — everything else renders exactly as it always has. */
export const DRAWING_EMBED_SUFFIX = '.excalidraw'

/** True for `Sketch.excalidraw` / `assets/drawings/Sketch.excalidraw` (case-insensitive, like readAsset). */
export function isDrawingTarget(target: string): boolean {
  return target.toLowerCase().endsWith(DRAWING_EMBED_SUFFIX)
}

/** base64 → the UTF-8 text it carries (scene JSON is text, and text can hold non-ASCII). */
function decodeBase64(data: string): string {
  const binary = atob(data)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Parses one `AssetResponse.data` payload into a scene; throws on anything that is not one. */
export function parseScene(base64: string): DrawingScene {
  const parsed: unknown = JSON.parse(decodeBase64(base64))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('not an Excalidraw scene')
  const scene = parsed as Record<string, unknown>
  if (!Array.isArray(scene.elements)) throw new Error('not an Excalidraw scene: no elements')
  const appState = typeof scene.appState === 'object' && scene.appState !== null ? (scene.appState as Record<string, unknown>) : {}
  const files = typeof scene.files === 'object' && scene.files !== null ? (scene.files as Record<string, unknown>) : null
  return { elements: scene.elements, appState, files }
}

/**
 * A drawing as the MODAL needs it (YAZ-879): the scene plus the two facts a save needs — the
 * ABSOLUTE path the fuzzy target resolved to (writes are never fuzzy, YAZ-876) and the mtime of
 * the read, which is the `expectedMtime` guard the write goes back with.
 */
export interface LoadedDrawing {
  readonly scene: DrawingScene
  readonly path: string
  readonly mtime: number
}

/** Reads `target` under `root` and parses it, keeping the identity a save needs. */
export async function openDrawing(root: string, target: string): Promise<LoadedDrawing> {
  const asset = await api.readAsset(root, target)
  return { scene: parseScene(asset.data), path: asset.path, mtime: asset.mtime }
}

/** Reads `target` under `root` and parses it; rejects for the preview's broken state. */
export async function loadDrawingScene(root: string, target: string): Promise<DrawingScene> {
  return (await openDrawing(root, target)).scene
}
