import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_IMAGE_BYTES } from '@shared/types'
import { failure, makeFixture } from './testFixture'
import { readImage } from './image'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (promise: Promise<unknown>) => (await failure(promise)).code

describe('readImage', () => {
  it('returns exact raster bytes, metadata, and MIME without base64 conversion', async () => {
    const file = path.join(root, 'pixel.png')
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00])
    await writeFile(file, bytes)

    const response = await readImage(file)

    expect(response).toMatchObject({ path: file, mime: 'image/png', size: bytes.byteLength })
    expect(response.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(response.data)).toBe(true)
    expect(response.data).toEqual(Buffer.from(bytes))
    expect(response.mtime).toBeGreaterThan(0)
    expect(response).not.toHaveProperty('content')
  })

  it.each([
    ['UPPER.PNG', 'image/png'],
    ['photo.JPG', 'image/jpeg'],
    ['photo.JPEG', 'image/jpeg'],
    ['still.GIF', 'image/gif'],
    ['modern.WEBP', 'image/webp'],
    ['modern.AVIF', 'image/avif'],
    ['legacy.BMP', 'image/bmp'],
  ] as const)('derives the approved MIME for %s', async (name, mime) => {
    const file = path.join(root, name)
    await writeFile(file, name)
    await expect(readImage(file)).resolves.toMatchObject({ path: file, mime, size: name.length })
  })

  it('uses the exact absolute path and never falls back to fuzzy asset resolution', async () => {
    await writeFile(path.join(root, 'assets-only', 'same-name.png'), 'elsewhere')
    expect(await code(readImage(path.join(root, 'same-name.png')))).toBe('NOT_FOUND')
  })

  it('refuses relative, unsupported, missing, and directory paths', async () => {
    expect(await code(readImage('relative.png'))).toBe('NOT_ABSOLUTE')
    expect(await code(readImage(path.join(root, 'vector.svg')))).toBe('UNSUPPORTED_EXTENSION')
    expect(await code(readImage(path.join(root, 'missing.png')))).toBe('NOT_FOUND')
    const directory = path.join(root, 'folder.png')
    await mkdir(directory)
    expect(await code(readImage(directory))).toBe('NOT_A_FILE')
  })

  it('accepts exactly 50 MiB and refuses one byte more without reading it', async () => {
    const atLimit = path.join(root, 'image-at-limit.png')
    const overLimit = path.join(root, 'image-over-limit.png')
    await Promise.all([writeFile(atLimit, ''), writeFile(overLimit, '')])
    await truncate(atLimit, MAX_IMAGE_BYTES)
    await truncate(overLimit, MAX_IMAGE_BYTES + 1)

    const response = await readImage(atLimit)
    expect(response.data.byteLength).toBe(MAX_IMAGE_BYTES)
    expect(response.size).toBe(MAX_IMAGE_BYTES)
    expect(await code(readImage(overLimit))).toBe('TOO_LARGE')
  })
})
