import { DRAWING_VIEW_EXTENSIONS, type FileKind } from './types'

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
  return null
}

export function isDrawing(name: string): boolean {
  return fileKind(name) === 'drawing'
}

export function isSupportedFile(name: string): boolean {
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
