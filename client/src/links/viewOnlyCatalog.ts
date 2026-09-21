import type { FileKind, TreeNode } from '@shared/types'
import { nameCandidate, type LinkCandidate } from './completion'

export interface ViewOnlyEntry {
  path: string
  name: string
  kind: Exclude<FileKind, 'markdown'>
}

export interface ViewOnlyCatalog {
  readonly root: string
  readonly entries: readonly ViewOnlyEntry[]
  readonly candidates: readonly LinkCandidate[]
  resolve(target: string): string | null
}

const pathOrder = (a: ViewOnlyEntry, b: ViewOnlyEntry): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

function flatten(nodes: readonly TreeNode[], out: ViewOnlyEntry[]): void {
  for (const node of nodes) {
    if (node.type === 'dir') flatten(node.children, out)
    else if (node.kind !== 'markdown' && node.kind !== null) out.push({ path: node.path, name: node.name, kind: node.kind })
  }
}

export function buildViewOnlyCatalog(root: string, tree: readonly TreeNode[]): ViewOnlyCatalog {
  const entries: ViewOnlyEntry[] = []
  flatten(tree, entries)
  return buildViewOnlyCatalogFromEntries(root, entries)
}

/** Rebuild lookup/spelling after a rename without re-reading or fabricating a filesystem tree. */
export function buildViewOnlyCatalogFromEntries(root: string, source: readonly ViewOnlyEntry[]): ViewOnlyCatalog {
  const entries = source.map((entry) => ({ ...entry }))
  entries.sort(pathOrder)
  const prefix = `${root.replace(/\/+$/, '')}/`
  const relative = (entry: ViewOnlyEntry): string => entry.path.startsWith(prefix) ? entry.path.slice(prefix.length) : entry.name
  const depth = (entry: ViewOnlyEntry): number => relative(entry).split('/').length - 1
  const exact = new Map(entries.map((entry) => [relative(entry), entry.path]))
  const winner = new Map<string, ViewOnlyEntry>()
  for (const entry of entries) {
    const key = entry.name.toLowerCase()
    const previous = winner.get(key)
    if (previous === undefined || depth(entry) < depth(previous)) winner.set(key, entry)
  }
  const names = new Map(entries.map((entry) => [entry.path, winner.get(entry.name.toLowerCase()) === entry ? entry.name : relative(entry)]))
  const resolve = (target: string): string | null => {
    const clean = target.trim()
    return clean.includes('/') ? exact.get(clean) ?? null : winner.get(clean.toLowerCase())?.path ?? null
  }
  const candidates = entries.map((entry) => ({ ...nameCandidate(names.get(entry.path) as string), path: entry.path }))
  return { root, entries, candidates, resolve }
}
