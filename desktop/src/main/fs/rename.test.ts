import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hasExactDirectoryEntry, renameFile } from './rename'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('renameFile (Links E1, GRO-2194)', () => {
  it('renames a drawing file in place and returns both paths', async () => {
    const oldPath = path.join(root, 'Zeta', 'z.excalidraw')
    const newPath = path.join(root, 'Zeta', 'zed.excalidraw')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('z')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ALREADY_EXISTS when the target exists — never overwrites', async () => {
    const oldPath = path.join(root, 'b.excalidraw')
    const newPath = path.join(root, 'A.excalidraw')
    const err = await failure(renameFile({ oldPath, newPath }))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.path).toBe(newPath)
    expect(await readFile(oldPath, 'utf8')).toBe('{"b":1}\n') // source untouched
    expect(await readFile(newPath, 'utf8')).toBe('{"A":1}\n') // target untouched
  })

  it('allows a case-only rename (the target stat hits the source itself on a case-insensitive fs)', async () => {
    const oldPath = path.join(root, 'CaseOnly.excalidraw')
    await writeFile(oldPath, 'case')
    const newPath = path.join(root, 'caseonly.excalidraw')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('case')
  })

  it('BAD_REQUEST when old and new path are the same', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'b.excalidraw'), newPath: path.join(root, 'b.excalidraw') }))).toBe('BAD_REQUEST')
  })

  it('UNSUPPORTED_EXTENSION on a kind change, NOT_FOUND on a missing source, NOT_ABSOLUTE / BAD_REQUEST on bad input', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'b.excalidraw'), newPath: path.join(root, 'b.txt') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.excalidraw'), newPath: path.join(root, 'b.md') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'missing.excalidraw'), newPath: path.join(root, 'other.excalidraw') }))).toBe('NOT_FOUND')
    expect(await code(renameFile({ oldPath: 'relative.excalidraw', newPath: path.join(root, 'other.excalidraw') }))).toBe('NOT_ABSOLUTE')
    expect(await code(renameFile(undefined))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.excalidraw') }))).toBe('BAD_REQUEST')
  })

  it.each([
    ['drawing to text', 'source.excalidraw', 'target.txt'],
    ['text to drawing', 'source.py', 'target.excalidraw'],
    ['drawing to no extension', 'bare.excalidraw', 'bare'],
    ['unknown to unknown', 'source.json', 'target.bin'],
  ])('refuses cross-kind rename (%s) before mutation', async (_label, oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    const original = Buffer.from(`original:${oldName}`)
    await writeFile(oldPath, original)
    expect(await code(renameFile({ oldPath, newPath }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(oldPath)).toEqual(original)
    await expect(stat(newPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('renames and moves a file with no viewer when the extension is unchanged, refuses any extension change (YAZ-1577 D5)', async () => {
    const oldPath = path.join(root, 'book.epub')
    await writeFile(oldPath, 'no viewer')
    expect(await code(renameFile({ oldPath, newPath: path.join(root, 'book.mobi') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath, newPath: path.join(root, 'book') }))).toBe('UNSUPPORTED_EXTENSION')
    const moved = path.join(root, 'Zeta', 'novel.epub')
    expect(await renameFile({ oldPath, newPath: moved })).toEqual({ oldPath, newPath: moved, kind: 'file' })
    await rm(moved)
  })

  it('refuses an extension change that would claim a format conversion', async () => {
    const oldPath = path.join(root, 'not-converted.png')
    const newPath = path.join(root, 'not-converted.jpg')
    const original = Buffer.from('png bytes')
    await writeFile(oldPath, original)
    expect(await code(renameFile({ oldPath, newPath }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(oldPath)).toEqual(original)
    await expect(stat(newPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['Case-Only.JSON', 'case-only.json'],
    ['image-source.PNG', 'image-renamed.png'],
  ])('allows a case-only extension change on a file with no viewer: %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    await writeFile(oldPath, `content:${oldName}`)
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe(`content:${oldName}`)
  })

  it('distinguishes exact entry spelling deterministically when host stat would alias a case-only rename', async () => {
    const oldPath = path.join(root, 'Exact-Case-Only.JSON')
    const newPath = path.join(root, 'exact-case-only.json')
    const readNames = async () => ['exact-case-only.json']

    expect(await hasExactDirectoryEntry(oldPath, readNames)).toBe(false)
    expect(await hasExactDirectoryEntry(newPath, readNames)).toBe(true)
  })
})

describe('renameFile (Links E1b, GRO-2241: cross-directory file move + folder rename)', () => {
  it('moves a file into another EXISTING folder (E1 same-parent guard lifted)', async () => {
    const oldPath = path.join(root, 'b.excalidraw')
    const newPath = path.join(root, 'Empty', 'b.excalidraw')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('{"b":1}\n')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('NOT_FOUND (attributed to the parent) when the target folder does not exist — never a mkdir', async () => {
    const oldPath = path.join(root, 'Empty', 'b.excalidraw') // moved there by the test above
    const err = await failure(renameFile({ oldPath, newPath: path.join(root, 'nope', 'b.excalidraw') }))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(path.join(root, 'nope'))
    expect(await readFile(oldPath, 'utf8')).toBe('{"b":1}\n') // source untouched
    await expect(stat(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' }) // nothing was created
  })

  it('renames a folder (kind: dir); extension rules do not apply to directories', async () => {
    await mkdir(path.join(root, 'Movable'), { recursive: true })
    await writeFile(path.join(root, 'Movable', 'note.excalidraw'), 'inside')
    const oldPath = path.join(root, 'Movable')
    const newPath = path.join(root, 'Moved')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'dir' })
    expect(await readFile(path.join(newPath, 'note.excalidraw'), 'utf8')).toBe('inside')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('never overwrites an existing folder (ALREADY_EXISTS), but allows a case-only dir rename (same inode)', async () => {
    const err = await failure(renameFile({ oldPath: path.join(root, 'Moved'), newPath: path.join(root, 'Empty') }))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.path).toBe(path.join(root, 'Empty'))
    const oldPath = path.join(root, 'Moved')
    const newPath = path.join(root, 'moved')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'dir' })
  })

  it('BAD_REQUEST for dot-directories (source or target — invisible infrastructure) and for moving a folder inside itself', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, '.yaseendraw'), newPath: path.join(root, 'visible') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'moved'), newPath: path.join(root, '.hidden-dir') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'moved'), newPath: path.join(root, 'moved', 'inner') }))).toBe('BAD_REQUEST')
    await expect(stat(path.join(root, '.yaseendraw'))).resolves.toBeDefined() // nothing moved
  })
})
