import { describe, expect, it } from 'vitest'
import type { TreeNode } from '@shared/types'
import { allDirs, ancestorDirs, favoriteRoots, findDirNode, findNode, focusRoots, treeHasFile, treeHasPath, treeReducer } from './treeState'

describe('treeReducer', () => {
  it('toggle adds then removes a dir', () => {
    const a = treeReducer([], { type: 'toggle', dir: '/r/a' })
    expect(a).toEqual(['/r/a'])
    expect(treeReducer(a, { type: 'toggle', dir: '/r/a' })).toEqual([])
  })

  it('setAll replaces the whole set verbatim — expand-all and collapse-all are the same action', () => {
    expect(treeReducer(['/r/a'], { type: 'setAll', dirs: ['/r/a', '/r/b', '/r/b/c'] })).toEqual(['/r/a', '/r/b', '/r/b/c'])
    expect(treeReducer(['/r/a', '/r/b'], { type: 'setAll', dirs: [] })).toEqual([])
  })

  it('expandTo opens every ancestor of the file under root and keeps existing state', () => {
    const next = treeReducer(['/r/other'], { type: 'expandTo', root: '/r', file: '/r/a/b/c.md' })
    expect(next).toEqual(['/r/other', '/r/a', '/r/a/b'])
    expect(treeReducer(next, { type: 'expandTo', root: '/r', file: '/r/a/b/c.md' })).toBe(next)
  })
})

describe('ancestorDirs', () => {
  it('returns nothing for a file directly under root or outside it', () => {
    expect(ancestorDirs('/r', '/r/x.md')).toEqual([])
    expect(ancestorDirs('/r', '/other/x.md')).toEqual([])
    expect(ancestorDirs('/r/', '/r/a/x.md')).toEqual(['/r/a'])
  })
})

describe('treeHasFile', () => {
  const tree: TreeNode[] = [
    {
      type: 'dir',
      name: 'a',
      path: '/r/a',
      children: [{ type: 'file', name: 'x.md', path: '/r/a/x.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    { type: 'file', name: 'y.md', path: '/r/y.md', size: 1, mtime: 1, kind: 'markdown' },
  ]
  it('finds nested and top-level files only', () => {
    expect(treeHasFile(tree, '/r/a/x.md')).toBe(true)
    expect(treeHasFile(tree, '/r/y.md')).toBe(true)
    expect(treeHasFile(tree, '/r/a')).toBe(false)
    expect(treeHasFile(tree, '/r/z.md')).toBe(false)
  })

  it('treeHasPath finds files AND folders — the selection may hold either (YAZ-1578)', () => {
    expect(treeHasPath(tree, '/r/a')).toBe(true)
    expect(treeHasPath(tree, '/r/a/x.md')).toBe(true)
    expect(treeHasPath(tree, '/r/y.md')).toBe(true)
    expect(treeHasPath(tree, '/r/b')).toBe(false)
    expect(treeHasPath(tree, '/r/z.md')).toBe(false)
  })
})

describe('allDirs', () => {
  it('lists every directory at every depth, outer before inner, and no files', () => {
    const tree: TreeNode[] = [
      {
        type: 'dir',
        name: 'a',
        path: '/r/a',
        children: [
          { type: 'dir', name: 'b', path: '/r/a/b', children: [] },
          { type: 'file', name: 'x.md', path: '/r/a/x.md', size: 1, mtime: 1, kind: 'markdown' },
        ],
      },
      { type: 'file', name: 'y.md', path: '/r/y.md', size: 1, mtime: 1, kind: 'markdown' },
      { type: 'dir', name: 'c', path: '/r/c', children: [] },
    ]
    expect(allDirs(tree)).toEqual(['/r/a', '/r/a/b', '/r/c'])
    expect(allDirs([])).toEqual([])
  })
})

/**
 * Focus Mode's two lookups (YAZ-1605). `PROJECTS` sits AFTER its prefix-sharing sibling on
 * purpose: the descent test is `startsWith(`${path}/`)`, so `/v/Projects-Archive` must never
 * swallow a search for `/v/Projects`.
 */
describe('findDirNode (YAZ-1605)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Projects-Archive', path: '/v/Projects-Archive', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [
        { type: 'dir', name: 'Alpha', path: '/v/Projects/Alpha', children: [] },
        { type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' },
      ],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('finds a dir nested two deep and hands back the node itself', () => {
    expect(findDirNode(tree, '/v/Projects/Alpha')?.name).toBe('Alpha')
  })

  it('is null for a file path, for an unknown path, and for the root itself', () => {
    expect(findDirNode(tree, '/v/Projects/p.md')).toBeNull()
    expect(findDirNode(tree, '/v/Nope')).toBeNull()
    expect(findDirNode([], '/v/Projects')).toBeNull()
  })

  it('a prefix-sharing sibling never answers for the shorter name', () => {
    expect(findDirNode(tree, '/v/Projects')?.path).toBe('/v/Projects')
    expect(findDirNode(tree, '/v/Projects-Archive/Alpha')).toBeNull()
  })
})

describe('focusRoots (YAZ-1605)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Notes', path: '/v/Notes', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [{ type: 'dir', name: 'Alpha', path: '/v/Projects/Alpha', children: [] }],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('returns the focused dirs in TREE order, whatever order they were focused in', () => {
    expect(focusRoots(tree, ['/v/Projects', '/v/Notes']).map((n) => n.path)).toEqual(['/v/Notes', '/v/Projects'])
  })

  it('stops at the OUTERMOST match — a focused dir inside a focused dir is drawn once, under its parent', () => {
    expect(focusRoots(tree, ['/v/Projects', '/v/Projects/Alpha']).map((n) => n.path)).toEqual(['/v/Projects'])
  })

  it('a path the tree no longer holds yields no row, and no focus yields nothing', () => {
    expect(focusRoots(tree, ['/v/Gone']).map((n) => n.path)).toEqual([])
    expect(focusRoots(tree, ['/v/Gone', '/v/Notes']).map((n) => n.path)).toEqual(['/v/Notes'])
    expect(focusRoots(tree, [])).toEqual([])
  })
})

/**
 * The Favorites tab's two lookups (YAZ-1766 D4). `findNode` is `findDirNode`'s kind-agnostic twin;
 * `favoriteRoots` keeps the STORED order and every nesting — it is deliberately not `focusRoots`.
 */
describe('findNode (YAZ-1766)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Projects-Archive', path: '/v/Projects-Archive', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [
        { type: 'dir', name: 'Alpha', path: '/v/Projects/Alpha', children: [] },
        { type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' },
      ],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('finds a file and a dir, at the root and nested', () => {
    expect(findNode(tree, '/v/top.md')?.name).toBe('top.md')
    expect(findNode(tree, '/v/Projects/p.md')?.name).toBe('p.md')
    expect(findNode(tree, '/v/Projects/Alpha')?.type).toBe('dir')
  })

  it('is null for an unknown path, and a prefix-sharing sibling never answers for the shorter name', () => {
    expect(findNode(tree, '/v/Nope.md')).toBeNull()
    expect(findNode(tree, '/v/Projects-Archive/p.md')).toBeNull()
    expect(findNode([], '/v/top.md')).toBeNull()
  })
})

describe('favoriteRoots (YAZ-1766 D4)', () => {
  const tree: TreeNode[] = [
    { type: 'dir', name: 'Notes', path: '/v/Notes', children: [] },
    {
      type: 'dir',
      name: 'Projects',
      path: '/v/Projects',
      children: [{ type: 'file', name: 'p.md', path: '/v/Projects/p.md', size: 1, mtime: 1, kind: 'markdown' }],
    },
    { type: 'file', name: 'top.md', path: '/v/top.md', size: 1, mtime: 1, kind: 'markdown' },
  ]

  it('returns the favorites in STORED order, files and dirs alike — never tree order', () => {
    expect(favoriteRoots(tree, ['/v/top.md', '/v/Projects', '/v/Notes']).map((n) => n.path)).toEqual(['/v/top.md', '/v/Projects', '/v/Notes'])
  })

  it('keeps a favorite INSIDE a favorited folder as its own root row too (redundancy, not focusRoots)', () => {
    expect(favoriteRoots(tree, ['/v/Projects/p.md', '/v/Projects']).map((n) => n.path)).toEqual(['/v/Projects/p.md', '/v/Projects'])
  })

  it('a path the tree no longer holds yields no row, and no favorites yields nothing', () => {
    expect(favoriteRoots(tree, ['/v/Gone.md', '/v/Notes']).map((n) => n.path)).toEqual(['/v/Notes'])
    expect(favoriteRoots(tree, [])).toEqual([])
  })
})
