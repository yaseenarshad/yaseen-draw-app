import { IMAGE_VIEW_EXTENSIONS, MARKDOWN_EXTENSIONS, PDF_EXTENSIONS, TEXT_VIEW_EXTENSIONS, type FileKind } from './types'

/**
 * Lower-cased extension of a file name or path, dot included; `null` when there is none. A leading
 * dot alone is not an extension (`.md` the file has none), matching Node's `path.extname`.
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
  if ((MARKDOWN_EXTENSIONS as readonly string[]).includes(ext)) return 'markdown'
  if ((TEXT_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'text'
  if ((PDF_EXTENSIONS as readonly string[]).includes(ext)) return 'pdf'
  if ((IMAGE_VIEW_EXTENSIONS as readonly string[]).includes(ext)) return 'image'
  return null
}

export function isMarkdown(name: string): boolean {
  return fileKind(name) === 'markdown'
}

export function isViewOnly(name: string): boolean {
  const kind = fileKind(name)
  return kind !== null && kind !== 'markdown'
}

export function isSupportedFile(name: string): boolean {
  return fileKind(name) !== null
}

/**
 * Renames never transcode bytes. Text and Markdown may move between extensions in their kind;
 * raster images must keep their real encoding (`.jpg` and `.jpeg` are the one equivalent spelling
 * pair); a file with no viewer keeps its exact extension, since nothing else vouches for what its
 * bytes are (YAZ-1577 D5).
 */
export function canRenameWithoutConversion(oldName: string, newName: string): boolean {
  const oldKind = fileKind(oldName)
  if (oldKind !== fileKind(newName)) return false
  if (oldKind !== 'image' && oldKind !== null) return true

  const oldExtension = extensionOf(oldName)
  const newExtension = extensionOf(newName)
  if (oldExtension === null || newExtension === null) return false
  if (oldExtension === newExtension) return true
  return ['.jpg', '.jpeg'].includes(oldExtension) && ['.jpg', '.jpeg'].includes(newExtension)
}
