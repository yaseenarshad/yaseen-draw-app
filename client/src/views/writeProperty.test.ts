/**
 * `writeProperty` (GRO-2141): read → rewrite one key → write with `expectedMtime`,
 * with a single re-read-and-retry on CONFLICT. `api` is mocked so every call is observable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FrontmatterWriteError } from '@shared/frontmatter'
import { transformFile, writeProperties, writeProperty, writePropertyIfMissing } from './writeProperty'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)

const PATH = '/vault/Deep Work.md'

const file = (content: string, mtime: number) => ({ path: PATH, content, mtime, size: content.length })
const conflict = (mtime: number) => new BridgeRequestError('CONFLICT', 'file changed on disk', mtime)

beforeEach(() => {
  readFile.mockReset()
  writeFile.mockReset()
})

describe('writeProperty', () => {
  it('reads, rewrites one key and writes with the read mtime', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 26 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toMatchObject({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith({
      path: PATH,
      content: '---\nstatus: done\n---\nBody\n',
      expectedMtime: 100,
    })
  })

  it('skips the write when the value is already what is on disk', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))

    await expect(writeProperty(PATH, 'status', 'draft')).resolves.toMatchObject({ mtime: 100 })

    expect(writeFile).not.toHaveBeenCalled()
  })

  it('re-reads and retries once on CONFLICT, keeping the concurrent edit', async () => {
    readFile
      .mockResolvedValueOnce(file('---\nstatus: draft\n---\nBody\n', 100))
      .mockResolvedValueOnce(file('---\nstatus: draft\ntags: [new]\n---\nBody\n', 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 40 })

    await expect(writeProperty(PATH, 'status', 'done')).resolves.toMatchObject({ mtime: 300 })

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: '---\nstatus: done\ntags: [new]\n---\nBody\n',
      expectedMtime: 150,
    })
  })

  it('rethrows a second CONFLICT', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockRejectedValue(conflict(150))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(BridgeRequestError)

    expect(writeFile).toHaveBeenCalledTimes(2)
  })

  it('rethrows a non-CONFLICT api error without retrying', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockRejectedValue(new BridgeRequestError('IO_ERROR', 'disk on fire'))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(BridgeRequestError)

    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(readFile).toHaveBeenCalledTimes(1)
  })

  it('propagates FrontmatterWriteError and never writes', async () => {
    readFile.mockResolvedValue(file('---\ntags: [a, b\nstatus: : :\n---\nBody\n', 100))

    await expect(writeProperty(PATH, 'status', 'done')).rejects.toBeInstanceOf(FrontmatterWriteError)

    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('writeProperties', () => {
  it('commits several keys in one guarded whole-file write', async () => {
    readFile.mockResolvedValue(file('---\nproc: Intake\ndept: Finance\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 38 })

    await expect(
      writeProperties(PATH, [
        { key: 'proc', value: 'Review' },
        { key: 'dept', value: 'Ops' },
      ]),
    ).resolves.toMatchObject({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      content: '---\nproc: Review\ndept: Ops\n---\nBody\n',
      expectedMtime: 100,
    })
  })
})

describe('writePropertyIfMissing (YAZ-999)', () => {
  it('writes the requested empty value when the key is absent', async () => {
    readFile.mockResolvedValue(file('---\nstatus: draft\n---\nBody\n', 100))
    writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 38 })

    await expect(writePropertyIfMissing(PATH, 'score', null)).resolves.toMatchObject({ mtime: 200 })

    expect(writeFile).toHaveBeenCalledExactlyOnceWith({
      path: PATH,
      content: '---\nstatus: draft\nscore: null\n---\nBody\n',
      expectedMtime: 100,
    })
  })

  it.each([
    ['null', 'score: null'],
    ['false', 'score: false'],
    ['zero', 'score: 0'],
    ['empty string', 'score: ""'],
    ['empty list', 'score: []'],
    ['a value of the wrong local type', 'score: text'],
  ])('preserves a present %s value instead of replacing it', async (_label, yaml) => {
    readFile.mockResolvedValue(file(`---\n${yaml}\n---\nBody\n`, 100))

    await expect(writePropertyIfMissing(PATH, 'score', 42)).resolves.toMatchObject({ mtime: 100 })

    expect(writeFile).not.toHaveBeenCalled()
  })

  it('rechecks after a conflict and preserves a value another writer added', async () => {
    readFile
      .mockResolvedValueOnce(file('---\nstatus: draft\n---\nBody\n', 100))
      .mockResolvedValueOnce(file('---\nstatus: draft\nscore: 9\n---\nBody\n', 150))
    writeFile.mockRejectedValueOnce(conflict(150))

    await expect(writePropertyIfMissing(PATH, 'score', null)).resolves.toMatchObject({ mtime: 150 })

    expect(readFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenCalledTimes(1)
  })

  it('keeps broken frontmatter read-only', async () => {
    readFile.mockResolvedValue(file('---\ntags: [a, b\n---\nBody\n', 100))

    await expect(writePropertyIfMissing(PATH, 'score', null)).rejects.toBeInstanceOf(FrontmatterWriteError)

    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('transformFile', () => {
  it('recomputes the whole transformation over fresh bytes after one conflict', async () => {
    readFile
      .mockResolvedValueOnce(file('first', 100))
      .mockResolvedValueOnce(file('concurrent', 150))
    writeFile.mockRejectedValueOnce(conflict(150)).mockResolvedValueOnce({ path: PATH, mtime: 300, size: 22 })

    await expect(transformFile(PATH, (content) => `${content}-transformed`)).resolves.toEqual({ mtime: 300, content: 'concurrent-transformed' })

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(writeFile).toHaveBeenLastCalledWith({
      path: PATH,
      content: 'concurrent-transformed',
      expectedMtime: 150,
    })
  })

  it('skips the retry write when the concurrent bytes already satisfy the transform', async () => {
    readFile
      .mockResolvedValueOnce(file('before', 100))
      .mockResolvedValueOnce(file('after', 150))
    writeFile.mockRejectedValueOnce(conflict(150))

    await expect(transformFile(PATH, (content) => (content === 'before' ? 'after' : content))).resolves.toEqual({ mtime: 150, content: 'after' })

    expect(writeFile).toHaveBeenCalledTimes(1)
  })
})
