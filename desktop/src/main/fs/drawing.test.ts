import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MAX_DRAWING_BYTES } from '@shared/types'
import { loadDrawing, saveDrawing } from './drawing'
import { failure } from './testFixture'

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
  it('answers the bytes, the mtime a save guards on, and empty image fields (YAZ-1811 fills them)', async () => {
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
