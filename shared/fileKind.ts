import { DIAGRAM_EXTENSIONS, DRAWING_VIEW_EXTENSIONS, type FileKind } from './types'

/**
 * Lower-cased extension of a file name or path, dot included; `null` when there is none. A leading
 * dot alone is not an extension (`.excalidraw` the file has none), matching Node's `path.extname`.
 */
function extensionOf(name: string): string | null {
  const basename = name.slice(name.lastIndexOf('/') + 1)
  const dot = basename.lastIndexOf('.')
  return dot <= 0 ? null : basename.slice(dot).toLowerCase()
}

/** Classifies a file name or path using the one approved, case-insensitive extension contract. */
export function fileKind(name: string): FileKind | null {
  const ext = extensionOf(name)
  if (ext === null) return null
  if ((DRAWING_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'drawing'
  if ((DIAGRAM_EXTENSIONS as readonly string[]).includes(ext)) return 'diagram'
  return null
}

/**
 * What the app calls each kind wherever a TYPE is meant (🔒 YAZ-1802 D13): the engine is named, so
 * "Excalidraw drawing" and "draw.io diagram" never blur into each other. Generic surfaces say "board".
 */
export const BOARD_TYPE_NAME: Record<FileKind, string> = { drawing: 'Excalidraw drawing', diagram: 'draw.io diagram' }

/**
 * An EXCALIDRAW scene, and only that (🔒 YAZ-1802 D2): every door that reads or writes scene JSON —
 * `drawing:load` / `drawing:save`, the create's JSON stamping, board merge, history, previews,
 * shrink, the orphan sweep, storage — keeps asking this, so a diagram never reaches them.
 */
export function isDrawing(name: string): boolean {
  return fileKind(name) === 'drawing'
}

/** A draw.io diagram (🔒 YAZ-1802 D2): its own doors, `diagram:load` / `diagram:save`. */
export function isDiagram(name: string): boolean {
  return fileKind(name) === 'diagram'
}

/**
 * Any document the app opens in-app — a drawing OR a diagram (🔒 YAZ-1802 D2). What the GENERIC
 * surfaces ask: the tree row, Info, search, the hover preview, the dates on the file head, the
 * files a launch was handed.
 */
export function isBoard(name: string): boolean {
  return fileKind(name) !== null
}

/**
 * Renames never transcode bytes: a file may move between the extensions of its own kind, and a
 * file with no supported kind keeps its exact extension, since nothing else vouches for what its
 * bytes are (YAZ-1577 D5).
 */
export function canRenameWithoutConversion(oldName: string, newName: string): boolean {
  const oldKind = fileKind(oldName)
  if (oldKind !== fileKind(newName)) return false
  if (oldKind !== null) return true
  return extensionOf(oldName) === extensionOf(newName)
}
