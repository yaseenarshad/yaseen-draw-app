import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BOARD_META_KEY } from '@shared/drawingAssets'
import { createDir, createFile } from './create'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (p: Promise<unknown>) => (await failure(p)).code

describe('createDir', () => {
  it('creates a directory and returns its path', async () => {
    const p = path.join(root, 'NewFolder')
    expect(await createDir(p)).toEqual({ path: p })
    expect((await stat(p)).isDirectory()).toBe(true)
  })

  it('ALREADY_EXISTS when the path exists (dir or file)', async () => {
    expect(await code(createDir(path.join(root, 'alpha')))).toBe('ALREADY_EXISTS')
    expect(await code(createDir(path.join(root, 'b.excalidraw')))).toBe('ALREADY_EXISTS')
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createDir(path.join(root, 'nope', 'child')))).toBe('NOT_FOUND')
    expect(await code(createDir('relative/dir'))).toBe('NOT_ABSOLUTE')
    expect(await code(createDir(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(createDir(42 as never))).toBe('NOT_ABSOLUTE')
  })
})

describe('createFile', () => {
  it('UNSUPPORTED_EXTENSION for other extensions', async () => {
    for (const name of ['note.md', 'note.txt', 'data.json', 'script.py', 'report.pdf', 'Plan.base']) {
      expect(await code(createFile({ path: path.join(root, name), content: '{"type":"excalidraw","elements":[]}' })), name).toBe('UNSUPPORTED_EXTENSION')
    }
  })

  it.each(['existing.json', 'existing.py', 'existing.pdf'])('refuses existing %s before mutation and preserves its bytes', async (name) => {
    const file = path.join(root, name)
    const original = Buffer.from(`original:${name}`)
    await writeFile(file, original)
    expect(await code(createFile({ path: file, content: '{"elements":[]}' }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file)).toEqual(original)
  })

  it('ALREADY_EXISTS and never overwrites', async () => {
    const existing = path.join(root, 'A.excalidraw')
    const before = (await stat(existing)).size
    expect(await code(createFile({ path: existing, content: '{"type":"excalidraw","elements":[]}' }))).toBe('ALREADY_EXISTS')
    expect((await stat(existing)).size).toBe(before)
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createFile({ path: path.join(root, 'nope', 'x.excalidraw'), content: '{"type":"excalidraw","elements":[]}' }))).toBe('NOT_FOUND')
    expect(await code(createFile({ path: 'rel.excalidraw', content: '{"type":"excalidraw","elements":[]}' }))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(createFile('/abs/bare-path.excalidraw' as never))).toBe('BAD_REQUEST')
  })
})

describe('createFile is born with its scene (Bible B, GRO-2202)', () => {
  it('creates a drawing file with the given content in the same atomic wx write', async () => {
    const p = path.join(root, 'NewFolder', 'KPI.excalidraw')
    const content = '{"type":"excalidraw","version":2,"elements":[]}\n'
    const before = Date.now()
    const body = await createFile({ path: p, content })
    const after = Date.now()
    expect(body.path).toBe(p)
    const written = await readFile(p, 'utf8')
    expect(body.size).toBe(Buffer.byteLength(written))
    // Born stamped (🔒 YAZ-1834 D3): the block first, both dates = now, the scene as given after it.
    const parsed = JSON.parse(written) as Record<string, unknown>
    expect(Object.keys(parsed)).toEqual([BOARD_META_KEY, 'type', 'version', 'elements'])
    const block = parsed[BOARD_META_KEY] as { createdAt: number; updatedAt: number }
    expect(block.createdAt).toBe(block.updatedAt)
    expect(block.createdAt).toBeGreaterThanOrEqual(before)
    expect(block.createdAt).toBeLessThanOrEqual(after)
    expect(parsed.elements).toEqual([])
  })

  it('refuses content that is not a scene object BEFORE touching the disk', async () => {
    const p = path.join(root, 'NewFolder', 'junk.excalidraw')
    for (const content of ['clobber', '[1]', 'null', '{ not json']) expect(await code(createFile({ path: p, content })), content).toBe('BAD_REQUEST')
    await expect(stat(p)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('ALREADY_EXISTS with content never overwrites', async () => {
    const existing = path.join(root, 'A.excalidraw')
    const before = await readFile(existing, 'utf8')
    expect(await code(createFile({ path: existing, content: '{"elements":[]}' }))).toBe('ALREADY_EXISTS')
    expect(await readFile(existing, 'utf8')).toBe(before)
  })

  it("BAD_REQUEST for a non-string content; path guards still apply to the object form", async () => {
    expect(await code(createFile({ path: path.join(root, 'x.excalidraw'), content: 42 as never }))).toBe('BAD_REQUEST')
    expect(await code(createFile({ path: path.join(root, 'x.excalidraw') } as never))).toBe('BAD_REQUEST')
    expect(await code(createFile({ content: 'x' } as never))).toBe('BAD_REQUEST')
    expect(await code(createFile({ path: 'rel.excalidraw', content: 'x' }))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile({ path: path.join(root, 'x.txt'), content: 'x' }))).toBe('UNSUPPORTED_EXTENSION')
  })
})
