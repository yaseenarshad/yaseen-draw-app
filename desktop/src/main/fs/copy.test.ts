/**
 * Copy + paste at the disk layer (YAZ-1674, D2–D4). `copyEntry` and `freeName` run against a
 * real temp vault; `pasteEntries` is exercised both with the REAL verbs (copyEntry, renameFile —
 * so a cut clash really is rename's ALREADY_EXISTS) and with fakes where the filesystem cannot
 * be made to misbehave on demand (EXDEV, ordering, failure isolation).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, readFile, readdir, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BridgeFailure } from './fsUtils'
import { copyEntry, freeName, pasteEntries, type PasteOps } from './copy'
import { renameFile } from './rename'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code
const exists = async (p: string) => stat(p).then(() => true, () => false)

describe('freeName (YAZ-1674, D3 — Finder\'s rule)', () => {
  it('returns the name itself when nothing sits there', async () => {
    expect(await freeName(root, 'fresh.excalidraw', 'file')).toBe('fresh.excalidraw')
    expect(await freeName(root, 'Fresh', 'dir')).toBe('Fresh')
  })

  it('a file keeps its extension: Note.excalidraw → Note copy.excalidraw → Note copy 2.excalidraw → Note copy 3.excalidraw', async () => {
    const dir = path.join(root, 'clash')
    await mkdir(dir)
    await writeFile(path.join(dir, 'Note.excalidraw'), '1')
    expect(await freeName(dir, 'Note.excalidraw', 'file')).toBe('Note copy.excalidraw')
    await writeFile(path.join(dir, 'Note copy.excalidraw'), '2')
    expect(await freeName(dir, 'Note.excalidraw', 'file')).toBe('Note copy 2.excalidraw')
    await writeFile(path.join(dir, 'Note copy 2.excalidraw'), '3')
    expect(await freeName(dir, 'Note.excalidraw', 'file')).toBe('Note copy 3.excalidraw')
  })

  it('a folder keeps the WHOLE name — a dot in it is not an extension', async () => {
    const dir = path.join(root, 'clash-dir')
    await mkdir(path.join(dir, 'v1.2'), { recursive: true })
    expect(await freeName(dir, 'v1.2', 'dir')).toBe('v1.2 copy')
    await mkdir(path.join(dir, 'v1.2 copy'))
    expect(await freeName(dir, 'v1.2', 'dir')).toBe('v1.2 copy 2')
  })

  it('splits at the LAST extension and counts on from an existing " copy N" suffix (Finder)', async () => {
    const dir = path.join(root, 'clash-ext')
    await mkdir(dir)
    await writeFile(path.join(dir, 'archive.tar.gz'), 'a')
    expect(await freeName(dir, 'archive.tar.gz', 'file')).toBe('archive.tar copy.gz')
    await writeFile(path.join(dir, 'Note copy.excalidraw'), 'c')
    expect(await freeName(dir, 'Note copy.excalidraw', 'file')).toBe('Note copy 2.excalidraw')
    await writeFile(path.join(dir, 'Note copy 2.excalidraw'), 'c2')
    expect(await freeName(dir, 'Note copy 2.excalidraw', 'file')).toBe('Note copy 3.excalidraw')
  })
})

describe('copyEntry (YAZ-1674, D4)', () => {
  it('copies a file into a folder, bytes and mtime faithful, and reports from/to/kind', async () => {
    const from = path.join(root, 'A.excalidraw')
    const then = new Date('2020-01-02T03:04:05Z')
    await utimes(from, then, then)
    const res = await copyEntry(from, path.join(root, 'Empty'))
    const to = path.join(root, 'Empty', 'A.excalidraw')
    expect(res).toEqual({ from, to, kind: 'file' })
    expect(await readFile(to, 'utf8')).toBe('{"A":1}\n')
    expect(await readFile(from, 'utf8')).toBe('{"A":1}\n') // source untouched
    expect(Math.floor((await stat(to)).mtimeMs / 1000)).toBe(Math.floor(then.getTime() / 1000))
  })

  it('copies a NESTED folder whole — descendants included — and reports kind dir', async () => {
    const from = path.join(root, 'Zeta')
    const res = await copyEntry(from, path.join(root, 'alpha'))
    const to = path.join(root, 'alpha', 'Zeta')
    expect(res).toEqual({ from, to, kind: 'dir' })
    expect(await readFile(path.join(to, 'inner', 'deep.excalidraw'), 'utf8')).toBe('deep')
    expect(await readFile(path.join(to, 'z.excalidraw'), 'utf8')).toBe('z')
    expect(await exists(path.join(from, 'inner', 'deep.excalidraw'))).toBe(true)
  })

  it('carries hidden entries INSIDE a copied folder (Finder does), while a hidden SOURCE is refused', async () => {
    const from = path.join(root, 'WithDot')
    await mkdir(path.join(from, '.obsidian'), { recursive: true })
    await writeFile(path.join(from, '.obsidian', 'app.json'), '{}')
    await writeFile(path.join(from, 'n.excalidraw'), 'n')
    const { to } = await copyEntry(from, path.join(root, 'Empty'))
    expect(await readFile(path.join(to, '.obsidian', 'app.json'), 'utf8')).toBe('{}')
    for (const p of [path.join(root, '.obsidian'), path.join(root, '.hidden.excalidraw'), path.join(root, 'node_modules')]) {
      const err = await failure(copyEntry(p, path.join(root, 'Empty')))
      expect(err.code).toBe('BAD_REQUEST')
      expect(err.path).toBe(p)
    }
    expect(await readdir(path.join(root, 'Empty'))).not.toContain('.obsidian')
  })

  it('copying into its OWN folder is Duplicate for free: the copy takes the next free name', async () => {
    const from = path.join(root, 'b.excalidraw')
    const first = await copyEntry(from, root)
    expect(first.to).toBe(path.join(root, 'b copy.excalidraw'))
    const second = await copyEntry(from, root)
    expect(second.to).toBe(path.join(root, 'b copy 2.excalidraw'))
    expect(await readFile(second.to, 'utf8')).toBe('{"b":1}\n')
  })

  it('refuses a folder into itself or a descendant (BAD_REQUEST, attributed to the target)', async () => {
    const from = path.join(root, 'Zeta')
    const self = await failure(copyEntry(from, from))
    expect(self.code).toBe('BAD_REQUEST')
    expect(self.path).toBe(from)
    const inner = await failure(copyEntry(from, path.join(from, 'inner')))
    expect(inner.code).toBe('BAD_REQUEST')
    expect(inner.path).toBe(path.join(from, 'inner'))
    expect(await readdir(path.join(from, 'inner'))).toEqual(['deep.excalidraw'])
  })

  it('NOT_FOUND for a missing source, NOT_ABSOLUTE / BAD_REQUEST for bad arguments', async () => {
    const missing = path.join(root, 'missing.excalidraw')
    const err = await failure(copyEntry(missing, root))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(missing)
    expect(await code(copyEntry('relative.excalidraw', root))).toBe('NOT_ABSOLUTE')
    expect(await code(copyEntry(path.join(root, 'A.excalidraw'), 'relative'))).toBe('NOT_ABSOLUTE')
    expect(await code(copyEntry(undefined, root))).toBe('BAD_REQUEST')
  })

  it('copies a non-vault file too — no extension gate, the copy keeps its name and kind', async () => {
    const from = path.join(root, 'book.epub')
    const res = await copyEntry(from, path.join(root, 'Empty'))
    expect(res).toEqual({ from, to: path.join(root, 'Empty', 'book.epub'), kind: 'file' })
  })
})

describe('pasteEntries (YAZ-1674, D2/D3)', () => {
  const real: PasteOps = { copy: copyEntry, move: (from, to) => renameFile({ oldPath: from, newPath: to }) }

  it('copy: every entry in clipboard ORDER, each under its free name, source untouched', async () => {
    const dir = path.join(root, 'paste-copy')
    await mkdir(dir)
    const paths = [path.join(root, 'notes.txt'), path.join(root, 'A.excalidraw'), path.join(root, 'Zeta')]
    const res = await pasteEntries({ op: 'copy', paths }, { targetDir: dir }, real)
    expect(res.failed).toEqual([])
    expect(res.pasted).toEqual([
      { from: paths[0], to: path.join(dir, 'notes.txt'), kind: 'file' },
      { from: paths[1], to: path.join(dir, 'A.excalidraw'), kind: 'file' },
      { from: paths[2], to: path.join(dir, 'Zeta'), kind: 'dir' },
    ])
    for (const p of paths) expect(await exists(p)).toBe(true)
    // Pasting the same copy again lands beside the first under Finder's names.
    const again = await pasteEntries({ op: 'copy', paths: paths.slice(0, 1) }, { targetDir: dir }, real)
    expect(again.pasted[0].to).toBe(path.join(dir, 'notes copy.txt'))
  })

  it('one bad entry never stops the rest: a missing source fails NOT_FOUND, the others land', async () => {
    const dir = path.join(root, 'paste-isolate')
    await mkdir(dir)
    const missing = path.join(root, 'gone.excalidraw')
    const paths = [path.join(root, 'A.excalidraw'), missing, path.join(root, 'b.excalidraw')]
    const res = await pasteEntries({ op: 'copy', paths }, { targetDir: dir }, real)
    expect(res.pasted.map((e) => e.to)).toEqual([path.join(dir, 'A.excalidraw'), path.join(dir, 'b.excalidraw')])
    expect(res.failed).toEqual([{ from: missing, code: 'NOT_FOUND', message: 'path does not exist' }])
  })

  it('cut: moves each entry through the rename verb into the target under its own name', async () => {
    const dir = path.join(root, 'paste-cut')
    await mkdir(dir)
    const src = path.join(root, 'cut-me.excalidraw')
    await writeFile(src, 'cut')
    const res = await pasteEntries({ op: 'cut', paths: [src] }, { targetDir: dir }, real)
    expect(res).toEqual({ pasted: [{ from: src, to: path.join(dir, 'cut-me.excalidraw'), kind: 'file' }], failed: [] })
    expect(await exists(src)).toBe(false)
    expect(await readFile(path.join(dir, 'cut-me.excalidraw'), 'utf8')).toBe('cut')
  })

  it('cut into the folder an entry is ALREADY in is skipped silently — neither pasted nor failed', async () => {
    const dir = path.join(root, 'paste-cut-same')
    await mkdir(dir)
    const here = path.join(dir, 'here.excalidraw')
    await writeFile(here, 'here')
    const elsewhere = path.join(root, 'elsewhere.excalidraw')
    await writeFile(elsewhere, 'else')
    const move = vi.fn(real.move)
    const res = await pasteEntries({ op: 'cut', paths: [here, elsewhere] }, { targetDir: dir }, { ...real, move })
    expect(res).toEqual({ pasted: [{ from: elsewhere, to: path.join(dir, 'elsewhere.excalidraw'), kind: 'file' }], failed: [] })
    expect(move).toHaveBeenCalledExactlyOnceWith(elsewhere, path.join(dir, 'elsewhere.excalidraw'))
    expect(await readFile(here, 'utf8')).toBe('here')
  })

  it('cut onto an existing name fails that entry ALREADY_EXISTS and never overwrites', async () => {
    const dir = path.join(root, 'paste-cut-clash')
    await mkdir(dir)
    await writeFile(path.join(dir, 'taken.excalidraw'), 'original')
    const src = path.join(root, 'taken.excalidraw')
    await writeFile(src, 'incoming')
    const res = await pasteEntries({ op: 'cut', paths: [src] }, { targetDir: dir }, real)
    expect(res.pasted).toEqual([])
    expect(res.failed).toEqual([{ from: src, code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }])
    expect(await readFile(path.join(dir, 'taken.excalidraw'), 'utf8')).toBe('original')
    expect(await readFile(src, 'utf8')).toBe('incoming')
  })

  it('cut across volumes (EXDEV, raw or already fsCall-mapped) fails IO_ERROR "cannot move across disks; copy it instead"', async () => {
    const dir = path.join(root, 'Empty')
    const raw: PasteOps = {
      ...real,
      move: async () => {
        throw Object.assign(new Error("EXDEV: cross-device link not permitted, rename '/a' -> '/b'"), { code: 'EXDEV' })
      },
    }
    const a = path.join(root, 'A.excalidraw')
    expect(await pasteEntries({ op: 'cut', paths: [a] }, { targetDir: dir }, raw)).toEqual({
      pasted: [],
      failed: [{ from: a, code: 'IO_ERROR', message: 'cannot move across disks; copy it instead' }],
    })
    const mapped: PasteOps = {
      ...real,
      move: async () => {
        throw new BridgeFailure('IO_ERROR', "EXDEV: cross-device link not permitted, rename '/a' -> '/b'", { path: a })
      },
    }
    expect((await pasteEntries({ op: 'cut', paths: [a] }, { targetDir: dir }, mapped)).failed[0].message).toBe('cannot move across disks; copy it instead')
    expect(await exists(a)).toBe(true)
  })

  it('an unexpected error from a verb is IO_ERROR with its message, and the following entries still run', async () => {
    const dir = path.join(root, 'Empty')
    const a = path.join(root, 'A.excalidraw')
    const b = path.join(root, 'b.excalidraw')
    const copy = vi.fn(async (from: string, toDir: string) => {
      if (from === a) throw new Error('disk on fire')
      return copyEntry(from, toDir)
    })
    const res = await pasteEntries({ op: 'copy', paths: [a, b] }, { targetDir: dir }, { ...real, copy })
    expect(res.failed).toEqual([{ from: a, code: 'IO_ERROR', message: 'disk on fire' }])
    expect(res.pasted).toHaveLength(1)
    expect(res.pasted[0].from).toBe(b)
  })

  it('the target folder is the only whole-call failure: missing → NOT_FOUND, a file → NOT_A_DIRECTORY, bad input → BAD_REQUEST / NOT_ABSOLUTE', async () => {
    const clip = { op: 'copy' as const, paths: [path.join(root, 'A.excalidraw')] }
    const missing = path.join(root, 'nowhere')
    const err = await failure(pasteEntries(clip, { targetDir: missing }, real))
    expect(err.code).toBe('NOT_FOUND')
    expect(err.path).toBe(missing)
    expect(await code(pasteEntries(clip, { targetDir: path.join(root, 'notes.txt') }, real))).toBe('NOT_A_DIRECTORY')
    expect(await code(pasteEntries(clip, { targetDir: 'relative' }, real))).toBe('NOT_ABSOLUTE')
    expect(await code(pasteEntries(clip, {}, real))).toBe('BAD_REQUEST')
    expect(await code(pasteEntries(clip, null, real))).toBe('BAD_REQUEST')
  })
})
