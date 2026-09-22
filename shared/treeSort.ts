import type { SortOrder, TreeNode } from './types'

/**
 * THE FILES LENS'S ORDER AS A PURE RULE (🔒 YAZ-1835 D1/D2). The tree `fs:tree` hands over is in
 * name order and stays that way; this returns a NEW tree in the chosen order — folders first, always
 * by name (a folder has no dates), then the files by name or by date, every folder's children the
 * same way. Nothing is mutated, so ⌘K (which reads the same tree) and the Favorites lens (hand
 * order) never see the sort. A date reads the board's own block first and its mtime when it has no
 * block (🔒 YAZ-1834 D6); newest first, and a tie falls back to the name so the order is stable
 * across refreshes. Lives in `shared/` like every other pure rule over the bridge's types.
 */

export type FileNode = Extract<TreeNode, { type: 'file' }>
type DirNode = Extract<TreeNode, { type: 'dir' }>

const byName = <T extends { name: string }>(a: T, b: T): number => a.name.toLowerCase().localeCompare(b.name.toLowerCase())

/** A board's date for the order: its own block first, its mtime when it has none (🔒 YAZ-1834 D6). */
export function dateOf(node: FileNode, order: 'updated' | 'created'): number {
  return (order === 'updated' ? node.meta?.updatedAt : node.meta?.createdAt) ?? node.mtime
}

const byDateDesc =
  (order: 'updated' | 'created') =>
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
