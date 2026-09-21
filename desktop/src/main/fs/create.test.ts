import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
  it('creates an empty drawing file and returns path, mtime, size', async () => {
    const p = path.join(root, 'NewFolder', 'note.excalidraw')
    const body = await createFile(p)
    expect(body.path).toBe(p)
    expect(body.size).toBe(0)
    expect(body.mtime).toBeGreaterThan(0)
    expect((await stat(p)).isFile()).toBe(true)
  })

  it('UNSUPPORTED_EXTENSION for other extensions', async () => {
    expect(await code(createFile(path.join(root, 'note.md')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'note.txt')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'data.json')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'script.py')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'report.pdf')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(createFile(path.join(root, 'Plan.base')))).toBe('UNSUPPORTED_EXTENSION')
  })

  it.each(['existing.json', 'existing.py', 'existing.pdf'])('refuses existing %s before mutation and preserves its bytes', async (name) => {
    const file = path.join(root, name)
    const original = Buffer.from(`original:${name}`)
    await writeFile(file, original)
    expect(await code(createFile({ path: file, content: 'clobber' }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await readFile(file)).toEqual(original)
  })

  it('ALREADY_EXISTS and never overwrites', async () => {
    const existing = path.join(root, 'A.excalidraw')
    const before = (await stat(existing)).size
    expect(await code(createFile(existing))).toBe('ALREADY_EXISTS')
    expect((await stat(existing)).size).toBe(before)
  })

  it('NOT_FOUND when the parent does not exist, BAD_REQUEST / NOT_ABSOLUTE on bad input', async () => {
    expect(await code(createFile(path.join(root, 'nope', 'x.excalidraw')))).toBe('NOT_FOUND')
    expect(await code(createFile('rel.excalidraw'))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile(undefined as never))).toBe('BAD_REQUEST')
  })
})

describe('createFile with content (Bible B, GRO-2202)', () => {
  it('creates a drawing file with the given content in the same atomic wx write', async () => {
    const p = path.join(root, 'NewFolder', 'KPI.excalidraw')
    const content = '{"type":"excalidraw","version":2,"elements":[]}\n'
    const body = await createFile({ path: p, content })
    expect(body.path).toBe(p)
    expect(body.size).toBe(Buffer.byteLength(content))
    expect(await readFile(p, 'utf8')).toBe(content)
  })

  it('the object form without content creates an empty drawing', async () => {
    const drawing = path.join(root, 'NewFolder', 'plain.excalidraw')
    expect((await createFile({ path: drawing })).size).toBe(0)
    expect(await readFile(drawing, 'utf8')).toBe('')
  })

  it('ALREADY_EXISTS with content never overwrites', async () => {
    const existing = path.join(root, 'A.excalidraw')
    const before = await readFile(existing, 'utf8')
    expect(await code(createFile({ path: existing, content: 'clobber' }))).toBe('ALREADY_EXISTS')
    expect(await readFile(existing, 'utf8')).toBe(before)
  })

  it("BAD_REQUEST for a non-string content; path guards still apply to the object form", async () => {
    expect(await code(createFile({ path: path.join(root, 'x.excalidraw'), content: 42 as never }))).toBe('BAD_REQUEST')
    expect(await code(createFile({ content: 'x' } as never))).toBe('BAD_REQUEST')
    expect(await code(createFile({ path: 'rel.excalidraw', content: 'x' }))).toBe('NOT_ABSOLUTE')
    expect(await code(createFile({ path: path.join(root, 'x.txt'), content: 'x' }))).toBe('UNSUPPORTED_EXTENSION')
  })
})
