/**
 * Pure logic behind the sidebar's "New note" / "New folder page" / "New folder" flow (GRO-2022):
 * name validation, target-directory resolution, and final path building.
 * The UI (context menu + inline input) lives in Sidebar/Tree; the main process
 * enforces the same rules again (absolute path, vault extension, no overwrite).
 */
import { fileKind } from '@shared/fileKind'

/**
 * What the inline input creates: a markdown note, a folder, or a FOLDER PAGE (🔒 D4, YAZ-841)
 * — a note like any other, born carrying `folder_page: true` and nothing else (🔒 D1). It is a
 * third KIND rather than a flag beside `file` so the one difference — the seed — stays at the
 * end of the flow while every shared rule above it (validation, target dir, the `.md`
 * extension) is literally the same code.
 */
export type EntryKind = 'file' | 'dir' | 'folderPage'

/** Human-readable reason the name is unusable, or null when fine. Callers trim first via entryPath. */
export function validateEntryName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.includes('/')) return 'Name cannot contain "/"'
  if (trimmed.includes('\0')) return 'Name contains an invalid character'
  if (trimmed.startsWith('.')) return 'Names starting with "." are hidden'
  return null
}

/** Absolute path for the new entry; notes (folder pages included) get `.md` unless already markdown. */
export function entryPath(parentDir: string, name: string, kind: EntryKind): string {
  let final = name.trim()
  if ((kind === 'file' || kind === 'folderPage') && !/\.(md|markdown)$/i.test(final)) final += '.md'
  return `${parentDir}/${final}`
}

/** Seed for "New dated folder" (YAZ-1604): `09_14- ` — today's MM_DD, then `- ` so the title lands one space after the dash. */
export function datedFolderSeed(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getMonth() + 1)}_${p(now.getDate())}- `
}

/**
 * The least a right-clicked row has to say for the menu to target it: its KIND and its path.
 * A `TreeNode` satisfies it structurally, and so does a Topics row built from an index record
 * (YAZ-865 — the ⚡ amendment on YAZ-821 gives those rows the file tree's own menu), which is
 * why the rule below asks for this and not for a whole tree node it would never read.
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

/** Rename-field prefill: Markdown hides its suffix; view-only files show their full filename. */
export function renameInputName(fileName: string): string {
  const name = fileName.slice(fileName.lastIndexOf('/') + 1)
  if (fileKind(name) !== 'markdown') return name
  return name.slice(0, name.lastIndexOf('.'))
}

/**
 * Absolute path for the sidebar's inline rename (Links E1, GRO-2194; folders E1b, GRO-2241):
 * same parent directory. Markdown keeps only an explicit Markdown suffix; any other visible name
 * inherits the old Markdown suffix. View-only files keep any explicit supported suffix and append
 * the old exact suffix only when none is recognized. Directories have no extension logic.
 */
export function renamedPath(oldPath: string, newName: string, kind: 'file' | 'dir' = 'file'): string {
  const dir = oldPath.slice(0, oldPath.lastIndexOf('/'))
  let final = newName.trim()
  if (kind === 'dir') return `${dir}/${final}`
  const oldName = oldPath.slice(oldPath.lastIndexOf('/') + 1)
  if (final === renameInputName(oldName)) return oldPath
  const oldKind = fileKind(oldPath)
  const newKind = fileKind(final)
  if (oldKind === 'markdown' ? newKind !== 'markdown' : newKind === null) final += oldPath.slice(oldPath.lastIndexOf('.'))
  return `${dir}/${final}`
}
