import type { SortOrder, TreeNode } from './types'

/**
 * THE FILES LENS'S ORDER AS A PURE RULE (🔒 YAZ-1835 D1/D2): a NEW tree in the chosen order —
 * folders first, always by name, then the files by name or by date, every folder's children the
 * same way. Nothing is mutated, so ⌘K and the Favorites lens never see the sort. A date reads the
 * board's block first and its mtime when it has none (🔒 YAZ-1834 D6); newest first; a tie falls
 * back to the name so the order is stable across refreshes.
 */

export type FileNode = Extract<TreeNode, { type: 'file' }>
type DirNode = Extract<TreeNode, { type: 'dir' }>
type DateOrder = Exclude<SortOrder, 'name'>

/** The ONE name order (case-insensitive, the locale's): `fs:tree` hands the tree over in it, and `sortTree` keeps it for folders. */
export const byName = <T extends { name: string }>(a: T, b: T): number => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

const dateOf = (node: FileNode, order: DateOrder): number => (order === 'updated' ? node.meta?.updatedAt : node.meta?.createdAt) ?? node.mtime

const byDateDesc =
  (order: DateOrder) =>
  (a: FileNode, b: FileNode): number =>
    dateOf(b, order) - dateOf(a, order) || byName(a, b)

export function sortTree(nodes: readonly TreeNode[], order: SortOrder): TreeNode[] {
  const dirs: DirNode[] = []
  const files: FileNode[] = []
  for (const n of nodes) {
    if (n.type === 'dir') dirs.push(n)
    else files.push(n)
  }
  return [
    ...dirs.sort(byName).map((d) => ({ ...d, children: sortTree(d.children, order) })),
    ...files.sort(order === 'name' ? byName : byDateDesc(order)),
  ]
}
