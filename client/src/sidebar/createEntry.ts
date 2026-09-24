/**
 * Pure logic behind the sidebar's "New drawing" / "New folder" flow (GRO-2022): name validation,
 * target-directory resolution, and final path building. The UI (context menu + inline input)
 * lives in Sidebar/Tree; the main process enforces the same rules again (absolute path, vault
 * extension, no overwrite).
 */
import { fileKind } from '@shared/fileKind'
import { DIAGRAM_EXTENSIONS, DRAWING_VIEW_EXTENSIONS, type FileKind } from '@shared/types'

/** What the inline input creates: a drawing or a folder. */
export type EntryKind = 'file' | 'dir'

/** Human-readable reason the name is unusable, or null when fine. Callers trim first via entryPath. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/** The extension each kind of board is born with (🔒 YAZ-1802 D13). */
const BOARD_EXTENSION: Record<FileKind, string> = { drawing: DRAWING_VIEW_EXTENSIONS[0], diagram: DIAGRAM_EXTENSIONS[0] }

/**
 * Absolute path for the new entry; a `board` file (a drawing unless told otherwise) gains its
 * kind's extension unless the typed name already carries it.
 */
export function entryPath(parentDir: string, name: string, kind: EntryKind, board: FileKind = 'drawing'): string {
  let final = name.trim()
  if (kind === 'file' && fileKind(final) !== board) final += BOARD_EXTENSION[board]
  return `${parentDir}/${final}`
}

/** The name a new board is born with (🔒 YAZ-1775 R1), before the user renames it. */
export const UNTITLED_BOARD = 'Untitled'

/**
 * The next free "New drawing" / "New diagram" name in a folder (🔒 R1 on YAZ-1775, YAZ-1815):
 * `Untitled`, then `Untitled 2`, `Untitled 3`… — never a name the folder already holds, because
 * the birth must not overwrite anything (`fs:create-file` writes `wx` and would refuse anyway;
 * this is so the user sees a new board rather than an error). `taken` is the folder's existing entry names WITH their
 * extensions, compared case-insensitively: the Mac's own filesystem is, so `untitled.excalidraw`
 * and `Untitled.excalidraw` are the same file and the second one must not be offered.
 *
 * Only names of the same `board` kind count (🔒 YAZ-1802 D13): `Untitled.excalidraw` and
 * `Untitled.drawio` can sit side by side — they are different files.
 */
export function untitledBoardName(taken: readonly string[], board: FileKind = 'drawing'): string {
  const used = new Set(taken.map((n) => n.toLowerCase()))
  const free = (name: string): boolean => !used.has(`${name}${BOARD_EXTENSION[board]}`.toLowerCase())
  if (free(UNTITLED_BOARD)) return UNTITLED_BOARD
  // Terminates: `used` is finite, so one of the first `used.size + 1` numbered candidates is free.
  for (let n = 2; ; n++) {
    const candidate = `${UNTITLED_BOARD} ${n}`
    if (free(candidate)) return candidate
  }
}

/** Seed for "New dated folder" (YAZ-1604): `09_14- ` — today's MM_DD, then `- ` so the title lands one space after the dash. */
export function datedFolderSeed(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getMonth() + 1)}_${p(now.getDate())}- `
}

/**
 * The least a right-clicked row has to say for the menu to target it: its KIND and its path.
 * A `TreeNode` satisfies it structurally, which is why the rule below asks for this and not for
 * a whole tree node it would never read.
 */
export interface MenuRow {
  type: 'file' | 'dir'
  path: string
}

/** Where a right-click creates: a dir row → itself, a file row → its parent, blank space → the root. */
export function targetDirFor(node: MenuRow | null, root: string): string {
  if (node === null) return root
  if (node.type === 'dir') return node.path
  return node.path.slice(0, node.path.lastIndexOf('/'))
}

/** Rename-field prefill: a board (drawing or diagram) hides its suffix; every other file shows its full filename. */
export function renameInputName(fileName: string): string {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1)
  if (fileKind(name) === null) return name
  return name.slice(0, name.lastIndexOf('.'))
}

/** The suffix of a FILENAME, `.excalidraw` or otherwise; empty for a name with no dot (`README`). */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot) : ''
}

/**
 * Absolute path for the sidebar's inline rename (Links E1, GRO-2194; folders E1b, GRO-2241):
 * same parent directory. A board keeps only an explicit suffix of its OWN kind (`.excalidraw` for a
 * drawing, `.drawio` for a diagram — 🔒 YAZ-1802 D13, a rename never converts); any other visible
 * name inherits the old one. An unsupported file keeps its exact suffix, since nothing else
 * vouches for what its bytes are — and an extensionless one (`README`, `LICENSE`) has none to
 * inherit. Directories have no extension logic.
 */
export function renamedPath(oldPath: string, newName: string, kind: 'file' | 'dir' = 'file'): string {
  const dir = oldPath.slice(0, oldPath.lastIndexOf('/'))
  let final = newName.trim()
  if (kind === 'dir') return `${dir}/${final}`
  const oldName = oldPath.slice(oldPath.lastIndexOf('/') + 1)
  if (final === renameInputName(oldName)) return oldPath
  const oldKind = fileKind(oldName)
  const newKind = fileKind(final)
  if (oldKind !== null ? newKind !== oldKind : newKind === null) final += extensionOf(oldName)
  return `${dir}/${final}`
}
