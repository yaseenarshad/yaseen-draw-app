import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BridgeFailure, buildTree, isSkipped, requireAbsPath, requireDrawingFile, toBridgeFailure } from './fsUtils'

/** The rules every fs handler is built on; until now each was covered only incidentally. */

describe('requireAbsPath', () => {
  it('normalises an absolute path', () => {
    expect(requireAbsPath('/v/sub/../a.excalidraw', 'path')).toBe('/v/a.excalidraw')
  })

  it.each([
    [undefined, 'BAD_REQUEST'],
    ['', 'BAD_REQUEST'],
    ['relative.excalidraw', 'NOT_ABSOLUTE'],
    [42, 'NOT_ABSOLUTE'],
    ['/v/with\0nul', 'NOT_ABSOLUTE'],
  ])('refuses %s', (value, code) => {
    expect(() => requireAbsPath(value, 'path')).toThrowError(expect.objectContaining({ code }))
  })
})

describe('requireDrawingFile', () => {
  it('accepts a drawing, whatever the case of its extension', () => {
    expect(() => requireDrawingFile('/v/a.excalidraw')).not.toThrow()
    expect(() => requireDrawingFile('/v/a.EXCALIDRAW')).not.toThrow()
  })

  it('refuses anything else', () => {
    expect(() => requireDrawingFile('/v/a.md')).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_EXTENSION' }))
    expect(() => requireDrawingFile('/v/a')).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_EXTENSION' }))
  })
})

describe('isSkipped — the one definition of "invisible"', () => {
  it('hides dot-entries and node_modules, and nothing else', () => {
    expect(isSkipped('.yaseendraw')).toBe(true)
    expect(isSkipped('.DS_Store')).toBe(true)
    expect(isSkipped('node_modules')).toBe(true)
    expect(isSkipped('Notes')).toBe(false)
    expect(isSkipped('a.excalidraw')).toBe(false)
  })
})

describe('toBridgeFailure — the errno table the whole fs layer answers through', () => {
  it.each([
    ['ENOENT', 'NOT_FOUND'],
    ['EACCES', 'FORBIDDEN'],
    ['EPERM', 'FORBIDDEN'],
    ['ENOTDIR', 'NOT_A_DIRECTORY'],
    ['EEXIST', 'ALREADY_EXISTS'],
    ['EISDIR', 'NOT_A_FILE'],
    ['EMFILE', 'IO_ERROR'],
  ])('%s becomes %s, attributed to the path', (errno, code) => {
    const failure = toBridgeFailure(Object.assign(new Error('boom'), { code: errno }), '/v/a.excalidraw')
    expect(failure.code).toBe(code)
    expect(failure.path).toBe('/v/a.excalidraw')
  })

  it('passes an existing BridgeFailure through untouched — the first attribution wins', () => {
    const original = new BridgeFailure('CONFLICT', 'newer on disk', { path: '/v/a.excalidraw', mtime: 42 })
    expect(toBridgeFailure(original, '/somewhere/else')).toBe(original)
  })

  it('a non-error is still an IO_ERROR carrying its own text', () => {
    expect(toBridgeFailure('just a string', '/v/a')).toMatchObject({ code: 'IO_ERROR', message: 'just a string' })
  })
})

describe('buildTree', () => {
  it('lists dirs before files, each case-insensitively sorted, keeping empty dirs and skipping the invisible', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yaseendraw-tree-'))
    try {
      await mkdir(path.join(root, 'Zeta'))
      await mkdir(path.join(root, 'alpha'))
      await mkdir(path.join(root, 'node_modules'))
      await mkdir(path.join(root, '.yaseendraw'))
      await writeFile(path.join(root, 'b.excalidraw'), '{}')
      await writeFile(path.join(root, 'A.txt'), 'x')
      await writeFile(path.join(root, '.DS_Store'), 'x')

      const tree = await buildTree(root)

      expect(tree.map((n) => n.name)).toEqual(['alpha', 'Zeta', 'A.txt', 'b.excalidraw'])
      expect(tree.filter((n) => n.type === 'dir').map((n) => (n.type === 'dir' ? n.children : []))).toEqual([[], []])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('carries each file\'s kind: a drawing is `drawing`, anything else is null (YAZ-1577 D1)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yaseendraw-tree-'))
    try {
      await writeFile(path.join(root, 'a.excalidraw'), '{}')
      await writeFile(path.join(root, 'b.pdf'), 'x')
      const byName = new Map((await buildTree(root)).map((n) => [n.name, n]))
      expect(byName.get('a.excalidraw')).toMatchObject({ type: 'file', kind: 'drawing' })
      expect(byName.get('b.pdf')).toMatchObject({ type: 'file', kind: null })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('lists neither a symlink nor a device — only regular files and real directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'yaseendraw-tree-'))
    try {
      await writeFile(path.join(root, 'real.excalidraw'), '{}')
      await symlink(path.join(root, 'real.excalidraw'), path.join(root, 'link.excalidraw'))
      expect((await buildTree(root)).map((n) => n.name)).toEqual(['real.excalidraw'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
