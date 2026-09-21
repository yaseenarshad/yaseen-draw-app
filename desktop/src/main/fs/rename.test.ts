import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { hasExactDirectoryEntry, renameFile, repairRename } from './rename'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('renameFile (Links E1, GRO-2194)', () => {
  it('renames a markdown file in place and returns both paths', async () => {
    const oldPath = path.join(root, 'Zeta', 'z.markdown')
    const newPath = path.join(root, 'Zeta', 'zed.markdown')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('z')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('allows md ↔ markdown — one kind, two spellings', async () => {
    const oldMd = path.join(root, 'alpha', 'a.md')
    const newMd = path.join(root, 'alpha', 'ay.markdown')
    expect(await renameFile({ oldPath: oldMd, newPath: newMd })).toEqual({ oldPath: oldMd, newPath: newMd, kind: 'file' })
  })

  it('ALREADY_EXISTS when the target exists — never overwrites', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'A.md')
    const err = await failure(renameFile({ oldPath, newPath }))
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.path).toBe(newPath)
    expect(await readFile(oldPath, 'utf8')).toBe('# b\n') // source untouched
    expect(await readFile(newPath, 'utf8')).toBe('# A\n') // target untouched
  })

  it('allows a case-only rename (the target stat hits the source itself on a case-insensitive fs)', async () => {
    const oldPath = path.join(root, 'CaseOnly.md')
    await writeFile(oldPath, 'case')
    const newPath = path.join(root, 'caseonly.md')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('case')
  })

  it('BAD_REQUEST when old and new path are the same', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.md') }))).toBe('BAD_REQUEST')
  })

  it('UNSUPPORTED_EXTENSION on a kind change, NOT_FOUND on a missing source, NOT_ABSOLUTE / BAD_REQUEST on bad input', async () => {
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.txt') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md'), newPath: path.join(root, 'b.base') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(renameFile({ oldPath: path.join(root, 'missing.md'), newPath: path.join(root, 'other.md') }))).toBe('NOT_FOUND')
    expect(await code(renameFile({ oldPath: 'relative.md', newPath: path.join(root, 'other.md') }))).toBe('NOT_ABSOLUTE')
    expect(await code(renameFile(undefined))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'b.md') }))).toBe('BAD_REQUEST')
  })

  it.each([
    ['text', 'source.json', 'target.pdf'],
    ['text to markdown', 'source.py', 'target.md'],
    ['pdf to text', 'source.pdf', 'target.json'],
    ['supported to unknown', 'source.json', 'target.bin'],
  ])('refuses cross-kind rename (%s) before mutation', async (_label, oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    const original = Buffer.from(`original:${oldName}`)
    await writeFile(oldPath, original)
    expect(await code(renameFile({ oldPath, newPath }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(oldPath)).toEqual(original)
    await expect(stat(newPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['same-kind.json', 'renamed.json'],
    ['same-kind.pdf', 'renamed.pdf'],
  ])('allows same-kind view-only rename %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    await writeFile(oldPath, `content:${oldName}`)
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe(`content:${oldName}`)
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

  it('allows a text file to change extension and move folders while remaining text', async () => {
    const oldPath = path.join(root, 'move-source.json')
    const newPath = path.join(root, 'Empty', 'move-target.py')
    await writeFile(oldPath, '{"move":true}')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('{"move":true}')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['image-source.png', 'image-renamed.PNG'],
    ['photo-source.jpg', 'photo-renamed.jpeg'],
  ])('allows an image rename when the encoded format is preserved: %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    const original = Buffer.from(`encoded:${oldName}`)
    await writeFile(oldPath, original)
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath)).toEqual(original)
  })

  it('refuses an image extension change that would claim an encoding conversion', async () => {
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
    ['Case-Only.PDF', 'case-only.pdf'],
  ])('allows a same-kind case-only view-only rename %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    await writeFile(oldPath, `content:${oldName}`)
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe(`content:${oldName}`)
  })
})

describe('renameFile (Links E1b, GRO-2241: cross-directory file move + folder rename)', () => {
  it('moves a file into another EXISTING folder (E1 same-parent guard lifted)', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'Empty', 'b.md')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('# b\n')
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('NOT_FOUND (attributed to the parent) when the target folder does not exist — never a mkdir', async () => {
    const oldPath = path.join(root, 'Empty', 'b.md') // moved there by the test above
    const err = await failure(renameFile({ oldPath, newPath: path.join(root, 'nope', 'b.md') }))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(path.join(root, 'nope'))
    expect(await readFile(oldPath, 'utf8')).toBe('# b\n') // source untouched
    await expect(stat(path.join(root, 'nope'))).rejects.toMatchObject({ code: 'ENOENT' }) // nothing was created
  })

  it('renames a folder (kind: dir); extension rules do not apply to directories', async () => {
    await mkdir(path.join(root, 'Movable'), { recursive: true })
    await writeFile(path.join(root, 'Movable', 'note.md'), 'inside')
    const oldPath = path.join(root, 'Movable')
    const newPath = path.join(root, 'Moved')
    expect(await renameFile({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'dir' })
    expect(await readFile(path.join(newPath, 'note.md'), 'utf8')).toBe('inside')
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
    expect(await code(renameFile({ oldPath: path.join(root, '.yaseendocs'), newPath: path.join(root, 'visible') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'moved'), newPath: path.join(root, '.hidden-dir') }))).toBe('BAD_REQUEST')
    expect(await code(renameFile({ oldPath: path.join(root, 'moved'), newPath: path.join(root, 'moved', 'inner') }))).toBe('BAD_REQUEST')
    await expect(stat(path.join(root, '.yaseendocs'))).resolves.toBeDefined() // nothing moved
  })
})

describe('repairRename (Links E1c, GRO-2242: validate a rename that ALREADY happened on disk)', () => {
  it('accepts the happy claim — new path exists, old path gone — and derives kind: file; the disk is untouched', async () => {
    const oldPath = path.join(root, 'ExtOld.md')
    const newPath = path.join(root, 'ExtNew.md')
    await writeFile(newPath, 'ext') // the external mover already moved it; only the NEW path exists
    expect(await repairRename({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
    expect(await readFile(newPath, 'utf8')).toBe('ext') // repair never touches the disk
  })

  it('derives kind: dir for an externally moved folder', async () => {
    const newPath = path.join(root, 'ExtDir')
    await mkdir(newPath, { recursive: true })
    expect(await repairRename({ oldPath: path.join(root, 'ExtDirOld'), newPath })).toEqual({ oldPath: path.join(root, 'ExtDirOld'), newPath, kind: 'dir' })
  })

  it('BAD_REQUEST when the OLD path still exists — a live old path means the hypothesis was wrong', async () => {
    const oldPath = path.join(root, 'StillHere.md')
    const newPath = path.join(root, 'StillHereNew.md')
    await writeFile(oldPath, 'old')
    await writeFile(newPath, 'new')
    const err = await failure(repairRename({ oldPath, newPath }))
    expect(err.code).toBe('BAD_REQUEST')
    expect(err.path).toBe(oldPath)
  })

  it('NOT_FOUND when nothing exists at the new path (the claim has no landing spot)', async () => {
    const err = await failure(repairRename({ oldPath: path.join(root, 'GoneOld.md'), newPath: path.join(root, 'GoneNew.md') }))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(path.join(root, 'GoneNew.md'))
  })

  it("mirrors renameFile's supported-kind rules; same-path and bad input are refused", async () => {
    await writeFile(path.join(root, 'Ext.base'), 'views: []\n')
    expect(await code(repairRename({ oldPath: path.join(root, 'Ext.md'), newPath: path.join(root, 'Ext.base') }))).toBe('UNSUPPORTED_EXTENSION')
    await writeFile(path.join(root, 'ext.bin'), 'binary')
    expect(await code(repairRename({ oldPath: path.join(root, 'old.mobi'), newPath: path.join(root, 'ext.bin') }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await repairRename({ oldPath: path.join(root, 'old.bin'), newPath: path.join(root, 'ext.bin') })).toEqual({ oldPath: path.join(root, 'old.bin'), newPath: path.join(root, 'ext.bin'), kind: 'file' }) // YAZ-1577 D5
    expect(await code(repairRename({ oldPath: path.join(root, 'ExtNew.md'), newPath: path.join(root, 'ExtNew.md') }))).toBe('BAD_REQUEST') // same path
    expect(await code(repairRename({ oldPath: 'relative.md', newPath: path.join(root, 'ExtNew.md') }))).toBe('NOT_ABSOLUTE')
    expect(await code(repairRename(undefined))).toBe('BAD_REQUEST')
    expect(await code(repairRename({ newPath: path.join(root, 'ExtNew.md') }))).toBe('BAD_REQUEST')
  })

  it.each([
    ['old.json', 'new.pdf'],
    ['old.py', 'new.md'],
    ['old.pdf', 'new.json'],
    ['old.json', 'new.bin'],
  ])('refuses cross-kind repair %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    const original = Buffer.from(`landed:${newName}`)
    await writeFile(newPath, original)
    expect(await code(repairRename({ oldPath, newPath }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(newPath)).toEqual(original)
    await expect(stat(oldPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['repair-old.json', 'repair-new.json'],
    ['repair-old.pdf', 'repair-new.pdf'],
  ])('allows same-kind view-only repair %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    await writeFile(newPath, `landed:${newName}`)
    expect(await repairRename({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
  })

  it('allows an external repair across two extensions of the same text kind', async () => {
    const oldPath = path.join(root, 'repair-moved.json')
    const newPath = path.join(root, 'Empty', 'repair-moved.py')
    await writeFile(newPath, 'print("moved")\n')
    expect(await repairRename({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
  })

  it.each([
    ['repair-image-old.webp', 'repair-image-new.WEBP'],
    ['repair-photo-old.jpeg', 'repair-photo-new.jpg'],
  ])('allows an image repair when the encoded format is preserved: %s → %s', async (oldName, newName) => {
    const oldPath = path.join(root, oldName)
    const newPath = path.join(root, newName)
    await writeFile(newPath, `landed:${newName}`)
    expect(await repairRename({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
  })

  it('refuses an image repair that would claim an encoding conversion', async () => {
    const oldPath = path.join(root, 'repair-not-converted.gif')
    const newPath = path.join(root, 'repair-not-converted.webp')
    const original = Buffer.from('gif bytes')
    await writeFile(newPath, original)
    expect(await code(repairRename({ oldPath, newPath }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(newPath)).toEqual(original)
  })

  it('distinguishes exact entry spelling deterministically when host stat would alias a case-only rename', async () => {
    const oldPath = path.join(root, 'Repair-Case-Only.JSON')
    const newPath = path.join(root, 'repair-case-only.json')
    const readNames = async () => ['repair-case-only.json']

    expect(await hasExactDirectoryEntry(oldPath, readNames)).toBe(false)
    expect(await hasExactDirectoryEntry(newPath, readNames)).toBe(true)
  })

  it("mirrors renameFile's dot-dir refusal for directories", async () => {
    expect(await code(repairRename({ oldPath: path.join(root, 'WasVisible'), newPath: path.join(root, '.yaseendocs') }))).toBe('BAD_REQUEST')
  })

  it('an md ↔ markdown repair stays within the markdown kind (parity with renameFile)', async () => {
    const oldPath = path.join(root, 'ExtKind.md')
    const newPath = path.join(root, 'ExtKind.markdown')
    await writeFile(newPath, 'k')
    expect(await repairRename({ oldPath, newPath })).toEqual({ oldPath, newPath, kind: 'file' })
  })
})
