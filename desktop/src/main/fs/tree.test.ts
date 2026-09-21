import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { TreeNode } from '@shared/types'
import { tree } from './tree'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)
const flatten = (nodes: TreeNode[]): string[] =>
  nodes.flatMap((n) => (n.type === 'dir' ? [n.path, ...flatten(n.children)] : [n.path]))

describe('tree', () => {
  it('returns dirs first then every regular file, case-insensitive, with all dirs shown', async () => {
    const body = await tree(root)
    expect(body.root).toBe(root)
    expect(typeof body.generatedAt).toBe('number')
    // Every dir shows, drawing files or not (GRO-2022 D1): Empty and assets-only included.
    // Every regular file shows too, viewer or not (YAZ-1577 D1): book.epub is listed with `kind: null`.
    expect(names(body.tree)).toEqual(['alpha', 'assets-only', 'Empty', 'Zeta', 'A.excalidraw', 'b.excalidraw', 'book.epub', 'notes.txt'])
    expect(body.tree.find((n) => n.name === 'book.epub')).toMatchObject({ type: 'file', kind: null })
    const zeta = body.tree[3]
    if (zeta.type !== 'dir') throw new Error('expected dir')
    expect(names(zeta.children)).toEqual(['inner', 'z.excalidraw'])
    const alpha = body.tree[0]
    if (alpha.type !== 'dir') throw new Error('expected dir')
    expect(names(alpha.children)).toEqual(['a.excalidraw'])
    const assetsOnly = body.tree[1]
    if (assetsOnly.type !== 'dir') throw new Error('expected dir')
    expect(assetsOnly.children).toEqual([
      expect.objectContaining({ type: 'file', name: 'img.png', kind: null }),
    ])
    const all = flatten(body.tree)
    expect(all).toContain(path.join(root, 'notes.txt'))
    expect(all.some((p) => p.includes('.obsidian') || p.includes('.git') || p.includes('node_modules'))).toBe(false)
    expect(all).not.toContain(path.join(root, '.hidden.excalidraw'))
    // `.yaseendraw/` (vault-local config, GRO-2188) never reaches the tree — the sidebar renders the tree as-is.
    expect(all.some((p) => p.includes('.yaseendraw'))).toBe(false)
  })

  it('classifies a drawing by kind whatever the case, and lists every other file with kind null (YAZ-1577 D1)', async () => {
    const candidates = [
      [path.join(root, 'scene.EXCALIDRAW'), '{}', 'drawing'],
      [path.join(root, 'data.JSON'), '{}', null],
      [path.join(root, 'tool.py'), 'print("ok")\n', null],
      [path.join(root, 'report.PDF'), '%PDF-1.7', null],
      [path.join(root, 'photo.png'), 'png', null],
      [path.join(root, 'cover.WEBP'), 'webp', null],
      [path.join(root, 'vector.svg'), '<svg/>', null],
      [path.join(root, 'archive.zip'), 'binary', null],
    ] as const
    try {
      await Promise.all(candidates.map(([file, content]) => writeFile(file, content)))
      const all = files(await tree(root))
      for (const [file, , kind] of candidates) {
        expect(all.find((node) => node.name === path.basename(file))?.kind).toBe(kind)
      }
    } finally {
      await Promise.all(candidates.map(([file]) => rm(file, { force: true })))
    }
  })

  it('file nodes carry size, mtime and kind', async () => {
    const body = await tree(root)
    const a = body.tree.find((n) => n.name === 'A.excalidraw')
    if (a?.type !== 'file') throw new Error('expected file')
    expect(a.size).toBe(8)
    expect(a.mtime).toBeGreaterThan(0)
    expect(a.kind).toBe('drawing')
    const z = (body.tree[3] as { children: TreeNode[] }).children.find((n) => n.name === 'z.excalidraw')
    if (z?.type !== 'file') throw new Error('expected file')
    expect(z.kind).toBe('drawing')
  })

  it('BAD_REQUEST missing root, NOT_ABSOLUTE relative, NOT_FOUND missing dir, NOT_A_DIRECTORY when root is a file', async () => {
    expect((await failure(tree(undefined as never))).code).toBe('BAD_REQUEST')
    expect((await failure(tree('rel'))).code).toBe('NOT_ABSOLUTE')
    const missing = await failure(tree(path.join(root, 'nope')))
    expect(missing.code).toBe('NOT_FOUND')
    expect(missing.path).toBe(path.join(root, 'nope'))
    expect((await failure(tree(path.join(root, 'b.excalidraw')))).code).toBe('NOT_A_DIRECTORY')
  })
})

type FileNode = Extract<TreeNode, { type: 'file' }>
const files = (body: Awaited<ReturnType<typeof tree>>): FileNode[] => {
  const collect = (nodes: TreeNode[]): FileNode[] => nodes.flatMap((node) => (node.type === 'dir' ? collect(node.children) : [node]))
  return collect(body.tree)
}
