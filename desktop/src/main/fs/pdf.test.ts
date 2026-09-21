import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, truncate, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { MAX_PDF_BYTES } from '@shared/types'
import { failure, makeFixture } from './testFixture'
import { readPdf } from './pdf'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const code = async (promise: Promise<unknown>) => (await failure(promise)).code

describe('readPdf', () => {
  it('returns PDF bytes as Uint8Array without base64 conversion', async () => {
    const file = path.join(root, 'report.pdf')
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00])
    await writeFile(file, bytes)

    const response = await readPdf(file)

    expect(response.path).toBe(file)
    expect(response.data).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer(response.data)).toBe(true)
    expect(response.data).toEqual(Buffer.from(bytes))
    expect(response.size).toBe(bytes.byteLength)
    expect(response.mtime).toBeGreaterThan(0)
    expect(response).not.toHaveProperty('mime')
    expect(response).not.toHaveProperty('content')
  })

  it('accepts a mixed-case PDF extension', async () => {
    const file = path.join(root, 'UPPER.PDF')
    await writeFile(file, '%PDF-1.7\n')
    await expect(readPdf(file)).resolves.toMatchObject({ path: file, size: 9 })
  })

  it('refuses missing, relative, wrong-extension, and directory paths', async () => {
    expect(await code(readPdf(path.join(root, 'missing.pdf')))).toBe('NOT_FOUND')
    expect(await code(readPdf('relative.pdf'))).toBe('NOT_ABSOLUTE')
    expect(await code(readPdf(path.join(root, 'notes.txt')))).toBe('UNSUPPORTED_EXTENSION')
    const directory = path.join(root, 'folder.pdf')
    await mkdir(directory)
    expect(await code(readPdf(directory))).toBe('NOT_A_FILE')
  })

  it('accepts exactly 50 MiB and refuses one byte more without reading it', async () => {
    const atLimit = path.join(root, 'at-limit.pdf')
    const overLimit = path.join(root, 'over-limit.pdf')
    await Promise.all([writeFile(atLimit, ''), writeFile(overLimit, '')])
    await truncate(atLimit, MAX_PDF_BYTES)
    await truncate(overLimit, MAX_PDF_BYTES + 1)

    const response = await readPdf(atLimit)
    expect(response.data).toBeInstanceOf(Uint8Array)
    expect(response.data.byteLength).toBe(MAX_PDF_BYTES)
    expect(response.size).toBe(MAX_PDF_BYTES)
    expect(await code(readPdf(overLimit))).toBe('TOO_LARGE')
  })
})
