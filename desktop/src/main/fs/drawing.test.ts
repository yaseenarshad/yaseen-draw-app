import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_DRAWING_BYTES } from '@shared/types'
import { ORPHAN_MAX_AGE_MS } from '@shared/drawingAssets'
import { sweepOrphanAssets } from '../drawings/orphanSweep'
import { loadDrawing, saveDrawing } from './drawing'
import { failure } from './testFixture'

const PNG_B64 = 'aGVsbG8='
const dataUrl = (b64 = PNG_B64) => `data:image/png;base64,${b64}`
const imageEl = (fileId: string, over: Record<string, unknown> = {}) => ({ id: `el-${fileId}`, type: 'image', fileId, ...over })

/** Puts `<root>/assets/<name>` on disk, optionally aged into the past. */
async function seedAsset(name: string, body = 'hello', ageMs = 0): Promise<string> {
  const file = path.join(root, 'assets', name)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs)
    await utimes(file, when, when)
  }
  return file
}

let root: string

/** The smallest thing that is a scene: an object with an `elements` array. */
function scene(elements: unknown[] = [], extra: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements, appState: {}, files: {}, ...extra }, null, 2)}\n`
}

async function seed(rel: string, body: string): Promise<string> {
  const file = path.join(root, rel)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, body)
  return file
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'draw-doc-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('drawing:load', () => {
  it('answers the bytes, the mtime a save guards on, and no images for a scene that names none', async () => {
    const body = scene([{ id: 'a', type: 'rectangle' }])
    const file = await seed('Board.excalidraw', body)
    const st = await stat(file)
    await expect(loadDrawing({ root, path: 'Board.excalidraw' })).resolves.toEqual({
      path: file,
      json: body,
      mtime: st.mtimeMs,
      size: st.size,
      files: {},
      stored: [],
    })
  })

  it('takes an absolute path under the root as readily as a relative one', async () => {
    const file = await seed('Nested/Deep.excalidraw', scene())
    await expect(loadDrawing({ root, path: file })).resolves.toMatchObject({ path: file })
  })

  it('refuses a path that escapes the vault, a non-drawing extension, and a missing `path`', async () => {
    expect((await failure(loadDrawing({ root, path: '../outside.excalidraw' }))).code).toBe('BAD_REQUEST')
    expect((await failure(loadDrawing({ root, path: 'notes.txt' }))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(loadDrawing({ root, path: '  ' } as never))).code).toBe('BAD_REQUEST')
    expect((await failure(loadDrawing({ root: 'relative', path: 'a.excalidraw' }))).code).toBe('NOT_ABSOLUTE')
  })

  it('reports a missing file as NOT_FOUND', async () => {
    expect((await failure(loadDrawing({ root, path: 'gone.excalidraw' }))).code).toBe('NOT_FOUND')
  })

  it('reports an EMPTY and a CORRUPT file as one readable IO_ERROR naming the path (2D acceptance)', async () => {
    const empty = await seed('Empty.excalidraw', '')
    const corrupt = await seed('Corrupt.excalidraw', '{ not json')
    const noElements = await seed('NoElements.excalidraw', '{"type":"excalidraw"}')
    const array = await seed('Array.excalidraw', '[1,2,3]')
    for (const file of [empty, corrupt, noElements, array]) {
      const err = await failure(loadDrawing({ root, path: file }))
      expect(err.code, file).toBe('IO_ERROR')
      expect(err.message).toBe('file is not an Excalidraw scene')
      expect(err.path).toBe(file)
    }
  })

  it('reads a legacy embedded scene well past MAX_FILE_BYTES (the 200 MiB ceiling is for exactly this)', async () => {
    // 12 MiB of base64 payload — over the 10 MiB text cap, nowhere near the drawing cap.
    const dataURL = `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}`
    const file = await seed('Legacy.excalidraw', scene([{ type: 'image', fileId: 'abc' }], { files: { abc: { mimeType: 'image/png', dataURL } } }))
    const res = await loadDrawing({ root, path: file })
    expect(res.size).toBeGreaterThan(10 * 1024 * 1024)
    expect(res.size).toBeLessThan(MAX_DRAWING_BYTES)
  })
})

describe('drawing:save', () => {
  it('writes the scene atomically and answers the new mtime and size', async () => {
    const file = await seed('Board.excalidraw', scene())
    const before = await stat(file)
    const body = scene([{ id: 'a', type: 'ellipse' }])
    const res = await saveDrawing({ root, path: 'Board.excalidraw', json: body, newFiles: [] })
    expect(res.path).toBe(file)
    expect(res.persisted).toEqual([])
    expect(await readFile(file, 'utf8')).toBe(body)
    expect(res.mtime).not.toBe(before.mtimeMs)
    expect(res.size).toBe(Buffer.byteLength(body, 'utf8'))
    // No stray tmp file survives the rename.
    await expect(loadDrawing({ root, path: 'Board.excalidraw' })).resolves.toMatchObject({ json: body })
  })

  it('creates a document that is not there yet (a rename raced the save; the canvas is the only copy)', async () => {
    const body = scene()
    const res = await saveDrawing({ root, path: 'Fresh.excalidraw', json: body, expectedMtime: 123, newFiles: [] })
    expect(await readFile(res.path, 'utf8')).toBe(body)
  })

  it('rejects a stale expectedMtime as CONFLICT carrying the disk mtime, and writes NOTHING', async () => {
    const original = scene()
    const file = await seed('Board.excalidraw', original)
    const st = await stat(file)
    const err = await failure(saveDrawing({ root, path: file, json: scene([{ id: 'b' }]), expectedMtime: st.mtimeMs - 1000, newFiles: [] }))
    expect(err.code).toBe('CONFLICT')
    expect(err.mtime).toBe(st.mtimeMs)
    expect(err.path).toBe(file)
    expect(await readFile(file, 'utf8')).toBe(original)
  })

  it('accepts a matching expectedMtime', async () => {
    const file = await seed('Board.excalidraw', scene())
    const st = await stat(file)
    await expect(saveDrawing({ root, path: file, json: scene([{ id: 'c' }]), expectedMtime: st.mtimeMs, newFiles: [] })).resolves.toMatchObject({ path: file })
  })

  it('refuses a malformed request before touching the file', async () => {
    const original = scene()
    const file = await seed('Board.excalidraw', original)
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ root, path: file, json: 42, newFiles: [] }, 'BAD_REQUEST'],
      [{ root, path: file, json: scene(), newFiles: 'nope' }, 'BAD_REQUEST'],
      [{ root, path: file, json: scene(), expectedMtime: 'soon', newFiles: [] }, 'BAD_REQUEST'],
      [{ root, path: file, json: '{ not json', newFiles: [] }, 'BAD_REQUEST'],
      [{ root, path: '../escape.excalidraw', json: scene(), newFiles: [] }, 'BAD_REQUEST'],
      [{ root, path: 'notes.txt', json: scene(), newFiles: [] }, 'UNSUPPORTED_EXTENSION'],
    ]
    for (const [req, code] of bad) {
      expect((await failure(saveDrawing(req as never))).code, JSON.stringify(req.path)).toBe(code)
    }
    expect(await readFile(file, 'utf8')).toBe(original)
  })

  it('round-trips: load, edit, save, load again', async () => {
    await seed('Board.excalidraw', scene())
    const first = await loadDrawing({ root, path: 'Board.excalidraw' })
    const edited = scene([{ id: 'x', type: 'rectangle' }])
    const saved = await saveDrawing({ root, path: 'Board.excalidraw', json: edited, expectedMtime: first.mtime, newFiles: [] })
    const second = await loadDrawing({ root, path: 'Board.excalidraw' })
    expect(second.json).toBe(edited)
    expect(second.mtime).toBe(saved.mtime)
  })
})


describe('🔒 YAZ-1775 D3 — the image store on load', () => {
  it('hydrates a referenced id from assets/ and reports it as STORED', async () => {
    await seedAsset('abc.png')
    await seed('Board.excalidraw', scene([imageEl('abc')]))
    const res = await loadDrawing({ root, path: 'Board.excalidraw' })
    expect(res.files).toEqual({ abc: { mimeType: 'image/png', dataURL: dataUrl() } })
    expect(res.stored).toEqual(['abc'])
  })

  it('leaves a MISSING asset out entirely — the placeholder, never a failed open', async () => {
    await seed('Board.excalidraw', scene([imageEl('gone')]))
    const res = await loadDrawing({ root, path: 'Board.excalidraw' })
    expect(res.files).toEqual({})
    expect(res.stored).toEqual([])
    expect(res.json).toContain('gone') // the scene is untouched; only the bytes are absent
  })

  it('falls back to a LEGACY scene`s own embedded bytes, and does NOT call them stored', async () => {
    await seed('Legacy.excalidraw', scene([imageEl('emb')], { files: { emb: { mimeType: 'image/png', dataURL: dataUrl() } } }))
    const res = await loadDrawing({ root, path: 'Legacy.excalidraw' })
    expect(res.files.emb).toEqual({ mimeType: 'image/png', dataURL: dataUrl() })
    expect(res.stored).toEqual([])
  })

  it('prefers the store over an embedded copy of the same id', async () => {
    await seedAsset('dup.png', 'from-the-store')
    await seed('Board.excalidraw', scene([imageEl('dup')], { files: { dup: { mimeType: 'image/png', dataURL: dataUrl('ZW1iZWRkZWQ=') } } }))
    const res = await loadDrawing({ root, path: 'Board.excalidraw' })
    expect(Buffer.from(res.files.dup.dataURL.split(',')[1], 'base64').toString()).toBe('from-the-store')
    expect(res.stored).toEqual(['dup'])
  })

  it('hydrates nothing for a DELETED image element — an undo brings the id back, the sweep`s age guard keeps the bytes', async () => {
    await seedAsset('ghost.png')
    await seed('Board.excalidraw', scene([imageEl('ghost', { isDeleted: true })]))
    expect((await loadDrawing({ root, path: 'Board.excalidraw' })).files).toEqual({})
  })

  it('ignores a foreign file in assets/ and reads `jpeg` as well as `jpg`', async () => {
    await seedAsset('notes.txt', 'nope')
    await seedAsset('photo.jpeg', 'jj')
    await seed('Board.excalidraw', scene([imageEl('photo'), imageEl('notes')]))
    const res = await loadDrawing({ root, path: 'Board.excalidraw' })
    expect(res.stored).toEqual(['photo'])
    expect(res.files.photo.mimeType).toBe('image/jpeg')
  })
})

describe('🔒 YAZ-1775 D3 — the image store on save', () => {
  it('writes the assets BEFORE the scene, names them `<id>.<ext>`, and reports them persisted', async () => {
    await seed('Board.excalidraw', scene())
    const res = await saveDrawing({
      root,
      path: 'Board.excalidraw',
      json: scene([imageEl('newid')]),
      newFiles: [{ fileId: 'newid', mimeType: 'image/png', dataURL: dataUrl() }],
    })
    expect(res.persisted).toEqual(['newid'])
    expect(await readFile(path.join(root, 'assets', 'newid.png'), 'utf8')).toBe('hello')
    // The scene on disk names the id and carries no bytes.
    const saved = JSON.parse(await readFile(res.path, 'utf8')) as { files: unknown }
    expect(saved.files).toEqual({})
  })

  it('never rewrites an asset that is already there — content-addressed means it IS those bytes', async () => {
    const asset = await seedAsset('same.png', 'original')
    const before = (await stat(asset)).mtimeMs
    await seed('Board.excalidraw', scene())
    const res = await saveDrawing({ root, path: 'Board.excalidraw', json: scene([imageEl('same')]), newFiles: [{ fileId: 'same', mimeType: 'image/png', dataURL: dataUrl('ZGlmZmVyZW50') }] })
    expect(res.persisted).toEqual(['same'])
    expect(await readFile(asset, 'utf8')).toBe('original')
    expect((await stat(asset)).mtimeMs).toBe(before)
  })

  it('EXTRACTS a legacy embedded scene on its first save: bytes into assets/, JSON shrunk', async () => {
    const legacy = scene([imageEl('emb')], { files: { emb: { mimeType: 'image/png', dataURL: dataUrl() } } })
    await seed('Legacy.excalidraw', legacy)
    const before = (await stat(path.join(root, 'Legacy.excalidraw'))).size
    const res = await saveDrawing({ root, path: 'Legacy.excalidraw', json: legacy, newFiles: [] })
    expect(res.persisted).toEqual(['emb'])
    expect(await readFile(path.join(root, 'assets', 'emb.png'), 'utf8')).toBe('hello')
    expect(res.size).toBeLessThan(before)
    expect((JSON.parse(await readFile(res.path, 'utf8')) as { files: unknown }).files).toEqual({})
    // …and the document still opens with its picture, now from the store.
    expect((await loadDrawing({ root, path: 'Legacy.excalidraw' })).stored).toEqual(['emb'])
  })

  it('does not extract an embedded entry the scene no longer references', async () => {
    const legacy = scene([], { files: { orphan: { mimeType: 'image/png', dataURL: dataUrl() } } })
    await seed('Legacy.excalidraw', legacy)
    const res = await saveDrawing({ root, path: 'Legacy.excalidraw', json: legacy, newFiles: [] })
    expect(res.persisted).toEqual([])
    expect(await readdir(path.join(root, 'assets')).catch(() => null)).toBeNull()
  })

  it('leaves an already-lean scene BYTE-IDENTICAL, so an untouched save does not churn git', async () => {
    const lean = scene([{ id: 'a' }])
    await seed('Board.excalidraw', lean)
    await saveDrawing({ root, path: 'Board.excalidraw', json: lean, newFiles: [] })
    expect(await readFile(path.join(root, 'Board.excalidraw'), 'utf8')).toBe(lean)
  })

  it('refuses a malformed newFiles entry and writes NOTHING — not the assets, not the scene', async () => {
    const original = scene()
    await seed('Board.excalidraw', original)
    const bad: unknown[] = [
      { fileId: '../escape', mimeType: 'image/png', dataURL: dataUrl() },
      { fileId: 'a/b', mimeType: 'image/png', dataURL: dataUrl() },
      { fileId: 'ok', mimeType: 'image/bmp', dataURL: 'data:image/bmp;base64,aGk=' },
      { fileId: 'ok', mimeType: 'image/png', dataURL: 'https://example.com/a.png' },
      { fileId: 'ok', mimeType: 'image/png' },
      'not an object',
    ]
    for (const entry of bad) {
      const err = await failure(saveDrawing({ root, path: 'Board.excalidraw', json: scene(), newFiles: [entry] as never }))
      expect(err.code, JSON.stringify(entry)).toBe('BAD_REQUEST')
    }
    expect(await readFile(path.join(root, 'Board.excalidraw'), 'utf8')).toBe(original)
    expect(await readdir(path.join(root, 'assets')).catch(() => null)).toBeNull()
  })

  it('a CONFLICT writes no assets either: a refused save leaves the vault exactly as it was', async () => {
    const file = await seed('Board.excalidraw', scene())
    const st = await stat(file)
    await failure(saveDrawing({ root, path: file, json: scene([imageEl('x')]), expectedMtime: st.mtimeMs - 1000, newFiles: [{ fileId: 'x', mimeType: 'image/png', dataURL: dataUrl() }] }))
    expect(await readdir(path.join(root, 'assets')).catch(() => null)).toBeNull()
  })

  it('two boards sharing one image keep ONE file', async () => {
    await seed('A.excalidraw', scene())
    await seed('B.excalidraw', scene())
    const entry = { fileId: 'shared', mimeType: 'image/png', dataURL: dataUrl() }
    await saveDrawing({ root, path: 'A.excalidraw', json: scene([imageEl('shared')]), newFiles: [entry] })
    await saveDrawing({ root, path: 'B.excalidraw', json: scene([imageEl('shared')]), newFiles: [entry] })
    expect(await readdir(path.join(root, 'assets'))).toEqual(['shared.png'])
  })
})

/**
 * The simulated end-to-end (🔒 YAZ-1811 acceptance): a real temp vault, the real doors, no
 * Electron and no React. `shell.trashItem` is the one thing injected — a test must not move
 * files into the developer's own Trash.
 */
describe('end to end on a temp vault', () => {
  it('legacy board → load → save → assets extracted, JSON shrunk, and it reopens with its picture', async () => {
    const legacy = scene([imageEl('sha1id')], { files: { sha1id: { mimeType: 'image/png', dataURL: dataUrl() } } })
    await seed('Boards/Legacy.excalidraw', legacy)

    const opened = await loadDrawing({ root, path: 'Boards/Legacy.excalidraw' })
    expect(opened.stored).toEqual([]) // nothing in the store yet; the bytes came from the file
    expect(opened.files.sha1id.dataURL).toBe(dataUrl())

    // The renderer would send the file it holds and no longer has on disk.
    const saved = await saveDrawing({ root, path: 'Boards/Legacy.excalidraw', json: opened.json, expectedMtime: opened.mtime, newFiles: [] })
    expect(saved.persisted).toEqual(['sha1id'])
    expect(saved.size).toBeLessThan(opened.size)
    expect(await readdir(path.join(root, 'assets'))).toEqual(['sha1id.png'])

    const reopened = await loadDrawing({ root, path: 'Boards/Legacy.excalidraw' })
    expect(reopened.stored).toEqual(['sha1id'])
    expect(reopened.files.sha1id.dataURL).toBe(dataUrl())
  })

  it('the conflict path: a second writer wins, the first is refused, nothing of its save lands', async () => {
    const file = await seed('Board.excalidraw', scene())
    const first = await loadDrawing({ root, path: file })
    // Somebody else (another window, or git) writes the file.
    await new Promise((r) => setTimeout(r, 10))
    await writeFile(file, scene([{ id: 'theirs' }]))
    const err = await failure(saveDrawing({ root, path: file, json: scene([imageEl('mine')]), expectedMtime: first.mtime, newFiles: [{ fileId: 'mine', mimeType: 'image/png', dataURL: dataUrl() }] }))
    expect(err.code).toBe('CONFLICT')
    expect(JSON.parse(await readFile(file, 'utf8')).elements).toEqual([{ id: 'theirs' }])
    expect(await readdir(path.join(root, 'assets')).catch(() => null)).toBeNull()
    // Keep mine: the guard the CONFLICT reported lets the write through.
    await saveDrawing({ root, path: file, json: scene([imageEl('mine')]), expectedMtime: err.mtime, newFiles: [{ fileId: 'mine', mimeType: 'image/png', dataURL: dataUrl() }] })
    expect(await readdir(path.join(root, 'assets'))).toEqual(['mine.png'])
  })

  it('the sweep trashes a 3-day-old orphan, keeps a fresh one, and keeps one a NESTED board still uses', async () => {
    await seedAsset('orphan.png', 'old', 3 * 24 * 60 * 60 * 1000)
    await seedAsset('fresh.png', 'new')
    await seedAsset('nested.png', 'held', 3 * 24 * 60 * 60 * 1000)
    await seedAsset('deleted.png', 'held-by-age', 3 * 24 * 60 * 60 * 1000)
    await seed('Deep/Folders/Board.excalidraw', scene([imageEl('nested')]))
    await seed('Deep/Folders/Undo.excalidraw', scene([imageEl('deleted', { isDeleted: true })]))

    const trashed: string[] = []
    const swept = await sweepOrphanAssets(root, { now: Date.now, trash: async (p) => void trashed.push(path.basename(p)) })
    // `deleted.png` is unreferenced but its element is only soft-deleted — it goes too, once old.
    expect(trashed.sort()).toEqual(['deleted.png', 'orphan.png'])
    expect(swept).toBe(2)
    expect((await readdir(path.join(root, 'assets'))).sort()).toEqual(['deleted.png', 'fresh.png', 'nested.png', 'orphan.png'])
  })

  it('the sweep never eats the picture behind an UNSAVED paste', async () => {
    // The paste landed in the store a minute ago; the board naming it has not been saved.
    await seedAsset('justpasted.png', 'bytes', 60_000)
    await seed('Board.excalidraw', scene())
    const trashed: string[] = []
    expect(await sweepOrphanAssets(root, { now: Date.now, trash: async (p) => void trashed.push(p) })).toBe(0)
    expect(trashed).toEqual([])
  })

  it('a CORRUPT board is skipped, not fatal — and its age-guarded images survive until it is fixed', async () => {
    await seedAsset('used.png', 'x', ORPHAN_MAX_AGE_MS + 1000)
    await seed('Broken.excalidraw', '{ not json')
    await seed('Empty.excalidraw', '')
    await seed('Good.excalidraw', scene([imageEl('used')]))
    const trashed: string[] = []
    expect(await sweepOrphanAssets(root, { now: Date.now, trash: async (p) => void trashed.push(p) })).toBe(0)
    expect(trashed).toEqual([])
  })
})
