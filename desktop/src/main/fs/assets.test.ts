import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_FILE_BYTES } from '@shared/types'
import { readAsset, resolveAsset, writeAsset } from './assets'
import { failure } from './testFixture'

/**
 * `readAsset(root, ref)` (4E, GRO-2139 amended by Desktop D10): resolves a bare name or
 * path to a local image under `root` — root-relative when the ref has a `/`, else Obsidian's
 * shortest-path rule (case-insensitive basename, first match in a breadth-first walk with each
 * directory's entries sorted, dot-dirs and node_modules skipped) — and answers base64 + mime.
 * IMAGES ONLY since 🔒 YAZ-1810: a `.excalidraw` is the document, and `drawing:load` /
 * `drawing:save` are its one door per direction.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'mdapp-assets-'))
  cleanup = () => rm(root, { recursive: true, force: true })
  await Promise.all([
    mkdir(path.join(root, 'Content Pillars'), { recursive: true }),
    mkdir(path.join(root, 'aa', 'deeper'), { recursive: true }),
    mkdir(path.join(root, 'bb'), { recursive: true }),
    mkdir(path.join(root, '.obsidian'), { recursive: true }), // a foreign app's dotfolder: invisible to the walk
  ])
  await Promise.all([
    writeFile(path.join(root, 'Content Pillars', 'levels.png'), PNG),
    writeFile(path.join(root, 'Content Pillars', 'Reading list.txt'), 'an existing file with no asset extension'),
    writeFile(path.join(root, 'aa', 'dup.png'), PNG),
    writeFile(path.join(root, 'bb', 'dup.png'), PNG),
    writeFile(path.join(root, 'aa', 'deeper', 'shallow.png'), PNG),
    writeFile(path.join(root, 'bb', 'shallow.png'), PNG),
    writeFile(path.join(root, 'bb', 'photo.jpg'), PNG),
    writeFile(path.join(root, '.obsidian', 'hidden.webp'), PNG),
    writeFile(path.join(root, 'big.png'), Buffer.alloc(MAX_FILE_BYTES + 1)),
    writeFile(path.join(root, 'aa', 'sketch.excalidraw'), '{"elements":[]}'),
  ])
})
afterAll(() => cleanup())

describe('readAsset resolution', () => {
  it('a ref with a slash resolves root-relative first', async () => {
    const res = await readAsset(root, 'Content Pillars/levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(res.mime).toBe('image/png')
    expect(res.size).toBe(PNG.length)
    expect(Buffer.from(res.data, 'base64')).toEqual(PNG)
  })

  it('a bare basename resolves by the shortest-path rule anywhere under root', async () => {
    const res = await readAsset(root, 'levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('a ref with a slash that misses root-relative falls back to the basename walk', async () => {
    const res = await readAsset(root, 'no-such-dir/levels.png')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('strips |alias and #heading from the ref like the index link extraction', async () => {
    expect((await readAsset(root, 'levels.png|Alt text')).path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect((await readAsset(root, 'levels.png#section')).path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
  })

  it('matches the basename case-insensitively', async () => {
    const res = await readAsset(root, 'LEVELS.PNG')
    expect(res.path).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(res.mime).toBe('image/png')
  })

  it('several basename matches: the first in the deterministic sorted walk wins', async () => {
    expect((await readAsset(root, 'dup.png')).path).toBe(path.join(root, 'aa', 'dup.png'))
  })

  it('a shallower match beats a deeper one whatever the directory names (breadth-first)', async () => {
    expect((await readAsset(root, 'shallow.png')).path).toBe(path.join(root, 'bb', 'shallow.png'))
  })

  it('never looks inside dot-directories', async () => {
    expect((await failure(readAsset(root, 'hidden.webp'))).code).toBe('NOT_FOUND')
  })

  it('mime comes from the extension', async () => {
    expect((await readAsset(root, 'photo.jpg')).mime).toBe('image/jpeg')
  })
})

/**
 * `resolveAsset(root, target, from?)` (YAZ-1658, YAZ-1656 D1): the resolution order `readAsset` and the
 * `app://vault` image protocol share — note-relative (`from`) → root-relative → shortest-path
 * basename. Pure "where does this name land": no extension policy, null for a miss, and the
 * vault edge on the two path steps so an escape can only fall through to the walk.
 */
describe('resolveAsset', () => {
  it('a note-relative hit wins over a root-relative one and over the basename walk', async () => {
    // `dup.png` sits in both aa/ and bb/; the walk would pick aa/ (sorted first), root-relative misses.
    expect(await resolveAsset(root, 'dup.png', 'bb')).toBe(path.join(root, 'bb', 'dup.png'))
    expect(await resolveAsset(root, './dup.png', 'bb')).toBe(path.join(root, 'bb', 'dup.png'))
    // `../` from the note's own folder is still note-relative, and still inside the vault.
    expect(await resolveAsset(root, '../bb/dup.png', 'aa')).toBe(path.join(root, 'bb', 'dup.png'))
  })

  it('a root-relative hit wins over the basename walk', async () => {
    expect(await resolveAsset(root, 'bb/dup.png')).toBe(path.join(root, 'bb', 'dup.png'))
    // `from` given but missing there: root-relative is next, before the walk.
    expect(await resolveAsset(root, 'aa/dup.png', 'bb')).toBe(path.join(root, 'aa', 'dup.png'))
    // An empty `from` (a note at the root) is the root-relative step itself.
    expect(await resolveAsset(root, 'bb/dup.png', '')).toBe(path.join(root, 'bb', 'dup.png'))
  })

  it('falls back to the shortest-path walk when neither path step lands', async () => {
    expect(await resolveAsset(root, 'levels.png', 'bb')).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(await resolveAsset(root, 'no-such-dir/levels.png')).toBe(path.join(root, 'Content Pillars', 'levels.png'))
    expect(await resolveAsset(root, 'dup.png')).toBe(path.join(root, 'aa', 'dup.png'))
  })

  it('null for a miss, an empty target, or a directory of that name', async () => {
    expect(await resolveAsset(root, 'missing.png')).toBeNull()
    expect(await resolveAsset(root, 'missing.png', 'aa')).toBeNull()
    expect(await resolveAsset(root, '')).toBeNull()
    expect(await resolveAsset(root, 'aa')).toBeNull()
  })

  it('the vault edge holds on both path steps: an escape never reaches a file outside root', async () => {
    const outside = path.join(root, '..', 'escaped-asset-yaz1656.png')
    await writeFile(outside, PNG)
    try {
      expect(await resolveAsset(root, '../escaped-asset-yaz1656.png')).toBeNull()
      expect(await resolveAsset(root, 'escaped-asset-yaz1656.png', '..')).toBeNull()
      expect(await resolveAsset(root, '../../escaped-asset-yaz1656.png', 'aa')).toBeNull()
      expect(await resolveAsset(root, outside)).toBeNull()
    } finally {
      await rm(outside, { force: true })
    }
  })
})

describe('readAsset failures', () => {
  it('NOT_FOUND when no file under root has the basename', async () => {
    expect((await failure(readAsset(root, 'missing.png'))).code).toBe('NOT_FOUND')
  })

  it('the vault edge holds on reads: an escaping ref never reaches a file outside root (⚡ YAZ-876)', async () => {
    // A real file OUTSIDE the vault, with a name nothing inside shares — before the seal,
    // `../<name>` read it straight through (the pre-existing GRO-2139 gap this pins shut).
    const outside = path.join(root, '..', 'escaped-asset-yaz876.png')
    await writeFile(outside, PNG)
    try {
      expect((await failure(readAsset(root, '../escaped-asset-yaz876.png'))).code).toBe('NOT_FOUND')
      expect((await failure(readAsset(root, 'aa/../../escaped-asset-yaz876.png'))).code).toBe('NOT_FOUND')
      expect((await failure(readAsset(root, outside))).code).toBe('NOT_FOUND')
    } finally {
      await rm(outside, { force: true })
    }
  })

  it('UNSUPPORTED_EXTENSION for a ref that is not an image, even an existing file — a DRAWING included (🔒 YAZ-1810)', async () => {
    expect((await failure(readAsset(root, 'Content Pillars/Reading list.txt'))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(readAsset(root, 'levels'))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(readAsset(root, 'sketch.excalidraw'))).code).toBe('UNSUPPORTED_EXTENSION')
    expect((await failure(readAsset(root, 'sketch.excalidraw.bak'))).code).toBe('UNSUPPORTED_EXTENSION')
  })

  it('TOO_LARGE above MAX_FILE_BYTES', async () => {
    expect((await failure(readAsset(root, 'big.png'))).code).toBe('TOO_LARGE')
  })

  it('BAD_REQUEST on an empty ref, NOT_ABSOLUTE on a relative root, NOT_FOUND on a missing root', async () => {
    expect((await failure(readAsset(root, ''))).code).toBe('BAD_REQUEST')
    expect((await failure(readAsset(root, '  |alias'))).code).toBe('BAD_REQUEST')
    expect((await failure(readAsset('vault', 'levels.png'))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(readAsset(path.join(root, 'gone'), 'levels.png'))).code).toBe('NOT_FOUND')
  })
})

/**
 * `writeAsset(req)` (YAZ-876, images YAZ-1661 / YAZ-1656 D5; narrowed to images only by 🔒
 * YAZ-1810): BYTES onto an `IMAGE_EXTENSIONS` path, verbatim on disk, at an EXPLICIT
 * vault-relative path (writes are never fuzzy — no basename search), parent folders made on the
 * way, and `file.ts`'s write semantics: atomic tmp+rename, `expectedMtime` → `CONFLICT`, and a
 * create mode that never overwrites.
 */
describe('writeAsset', () => {
  let vault: string
  beforeAll(async () => (vault = await mkdtemp(path.join(tmpdir(), 'mdapp-img-'))))
  afterAll(() => rm(vault, { recursive: true, force: true }))

  const code = async (p: Promise<unknown>) => (await failure(p)).code
  const rel = (name: string) => path.posix.join('assets', name)

  it('a Uint8Array lands byte-for-byte on a .png path, parents made on the way, and reads back through readAsset', async () => {
    const res = await writeAsset({ root: vault, path: rel('pasted.png'), content: new Uint8Array(PNG) })
    const file = path.join(vault, 'assets', 'pasted.png')
    expect(res).toEqual({ path: file, mtime: (await stat(file)).mtimeMs, size: PNG.length })
    expect(await readFile(file)).toEqual(PNG)
    const read = await readAsset(vault, 'pasted.png')
    expect(read.mime).toBe('image/png')
    expect(Buffer.from(read.data, 'base64')).toEqual(PNG)
  })

  it('a Buffer is bytes too: any ArrayBuffer view, not `Uint8Array` by name', async () => {
    await writeAsset({ root: vault, path: rel('buffer.jpg'), content: Buffer.from(PNG) })
    expect(await readFile(path.join(vault, 'assets', 'buffer.jpg'))).toEqual(PNG)
  })

  it('a subarray writes exactly its own byte range, never its backing buffer', async () => {
    const backing = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])
    await writeAsset({ root: vault, path: rel('slice.gif'), content: backing.subarray(2, 6) })
    expect([...(await readFile(path.join(vault, 'assets', 'slice.gif')))]).toEqual([3, 4, 5, 6])
  })

  it('an absolute path under the root is accepted, and an absent expectedMtime just overwrites', async () => {
    const file = path.join(vault, 'assets', 'pasted.png')
    expect((await writeAsset({ root: vault, path: file, content: new Uint8Array(PNG) })).path).toBe(file)
    expect(await readFile(file)).toEqual(PNG)
  })

  it('only IMAGE paths take bytes — a DRAWING is the document`s own door now (🔒 YAZ-1810)', async () => {
    expect(await code(writeAsset({ root: vault, path: rel('scene.excalidraw'), content: new Uint8Array(PNG) }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(writeAsset({ root: vault, path: rel('note.txt'), content: new Uint8Array(PNG) }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(writeAsset({ root: vault, path: rel('pic'), content: new Uint8Array(PNG) }))).toBe('UNSUPPORTED_EXTENSION')
    expect(await stat(path.join(vault, 'assets', 'scene.excalidraw')).catch(() => null)).toBeNull()
  })

  it('a body that is not bytes — a string included — is BAD_REQUEST', async () => {
    expect(await code(writeAsset({ root: vault, path: rel('x.png'), content: 'raw text' as never }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: rel('x.png'), content: 42 as never }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: rel('x.png'), content: { length: 1 } as never }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: rel('x.png'), content: [1, 2] as never }))).toBe('BAD_REQUEST')
  })

  it('a path escaping the root is refused, whatever shape the escape takes', async () => {
    const bytes = new Uint8Array(PNG)
    expect(await code(writeAsset({ root: vault, path: '../outside.png', content: bytes }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: 'assets/../../outside.png', content: bytes }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: path.join(path.dirname(vault), 'outside.png'), content: bytes }))).toBe('BAD_REQUEST')
    expect(await stat(path.join(path.dirname(vault), 'outside.png')).catch(() => null)).toBeNull()
  })

  it('BAD_REQUEST / NOT_ABSOLUTE / NOT_FOUND on a malformed request or a missing root', async () => {
    const bytes = new Uint8Array(PNG)
    expect(await code(writeAsset(undefined as never))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: '', content: bytes }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: vault, path: rel('x.png'), content: bytes, expectedMtime: 'soon' as never }))).toBe('BAD_REQUEST')
    expect(await code(writeAsset({ root: 'vault', path: rel('x.png'), content: bytes }))).toBe('NOT_ABSOLUTE')
    expect(await code(writeAsset({ root: path.join(vault, 'gone'), path: rel('x.png'), content: bytes }))).toBe('NOT_FOUND')
  })

  it('CONFLICT carries the disk mtime so the renderer can show it', async () => {
    const file = path.join(vault, 'assets', 'pasted.png')
    const err = await failure(writeAsset({ root: vault, path: rel('pasted.png'), content: Uint8Array.from([0]), expectedMtime: 1 }))
    expect(err.mtime).toBe((await stat(file)).mtimeMs)
  })

  it('TOO_LARGE above MAX_FILE_BYTES of bytes, and nothing lands on disk', async () => {
    expect(await code(writeAsset({ root: vault, path: rel('huge.png'), content: new Uint8Array(MAX_FILE_BYTES + 1) }))).toBe('TOO_LARGE')
    expect(await stat(path.join(vault, 'assets', 'huge.png')).catch(() => null)).toBeNull()
  })

  it('create mode never overwrites an image either: ALREADY_EXISTS and the bytes stand', async () => {
    const file = path.join(vault, 'assets', 'once.webp')
    expect((await writeAsset({ root: vault, path: rel('once.webp'), content: new Uint8Array(PNG), create: true })).path).toBe(file)
    expect(await code(writeAsset({ root: vault, path: rel('once.webp'), content: Uint8Array.from([0]), create: true }))).toBe('ALREADY_EXISTS')
    expect(await readFile(file)).toEqual(PNG)
  })

  it('expectedMtime guards the write: stale → CONFLICT with nothing written', async () => {
    const file = path.join(vault, 'assets', 'pasted.png')
    const before = (await stat(file)).mtimeMs
    expect(await code(writeAsset({ root: vault, path: rel('pasted.png'), content: Uint8Array.from([0]), expectedMtime: before - 1000 }))).toBe('CONFLICT')
    expect(await readFile(file)).toEqual(PNG)
  })

  it('leaves no .tmp- debris behind', async () => {
    expect((await readdir(path.join(vault, 'assets'))).filter((n) => n.includes('.tmp-'))).toEqual([])
  })
})
