import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { BridgeFailure } from './fsUtils'
import { readBoundedHandle, type ReadableFileHandle } from './boundedRead'

type Snapshot = Pick<Stats, 'size' | 'mtimeMs' | 'isFile'>

function snapshot(size: number, mtimeMs = 1, regular = true): Snapshot {
  return { size, mtimeMs, isFile: () => regular }
}

function fakeHandle(content: Uint8Array, snapshots: [Snapshot, Snapshot], chunkSize = Number.POSITIVE_INFINITY) {
  let statIndex = 0
  let largestReadBuffer: Buffer | undefined
  const handle: ReadableFileHandle = {
    stat: async () => snapshots[Math.min(statIndex++, snapshots.length - 1)],
    read: async (buffer, offset, length, position) => {
      largestReadBuffer = buffer
      const available = Math.max(0, content.byteLength - position)
      const bytesRead = Math.min(length, available, chunkSize)
      buffer.set(content.subarray(position, position + bytesRead), offset)
      return { bytesRead }
    },
  }
  return { handle, statsRead: () => statIndex, largestReadBuffer: () => largestReadBuffer }
}

async function failure(promise: Promise<unknown>): Promise<BridgeFailure> {
  try {
    await promise
  } catch (error) {
    if (error instanceof BridgeFailure) return error
    throw error
  }
  throw new Error('expected failure')
}

describe('readBoundedHandle', () => {
  it('reads partial chunks in a loop and returns a zero-copy Buffer view', async () => {
    const bytes = Buffer.from('abcd')
    const fake = fakeHandle(bytes, [snapshot(4), snapshot(4)], 2)

    const result = await readBoundedHandle(fake.handle, '/v/data.txt', 8, 'file exceeds 8 bytes')

    expect(result.data).toEqual(bytes)
    expect(Buffer.isBuffer(result.data)).toBe(true)
    expect(result.data.buffer).toBe(fake.largestReadBuffer()?.buffer)
    expect(result.data.byteOffset).toBe(fake.largestReadBuffer()?.byteOffset)
    expect(fake.statsRead()).toBe(2)
  })

  it('reads only cap + 1 bytes when a file grows and refuses the result', async () => {
    const fake = fakeHandle(Buffer.from('abcde-more-data-is-never-read'), [snapshot(4, 1), snapshot(5, 2)])

    const error = await failure(readBoundedHandle(fake.handle, '/v/data.txt', 4, 'file exceeds 4 bytes'))

    expect(error).toMatchObject({ code: 'TOO_LARGE', message: 'file exceeds 4 bytes', path: '/v/data.txt' })
    expect(fake.largestReadBuffer()?.byteLength).toBe(5)
    expect(fake.statsRead()).toBe(2)
  })

  it('fails safely when size or mtime drifts across the read snapshot', async () => {
    const sameSizeNewMtime = fakeHandle(Buffer.from('same'), [snapshot(4, 1), snapshot(4, 2)])
    const shrank = fakeHandle(Buffer.from('abc'), [snapshot(4, 1), snapshot(3, 2)])

    for (const fake of [sameSizeNewMtime, shrank]) {
      const error = await failure(readBoundedHandle(fake.handle, '/v/data.txt', 8, 'file exceeds 8 bytes'))
      expect(error).toMatchObject({ code: 'IO_ERROR', path: '/v/data.txt' })
      expect(error.message).toMatch(/changed while being read/)
      expect(fake.statsRead()).toBe(2)
    }
  })

  it('rejects a non-file and an oversized pre-stat before any read allocation', async () => {
    for (const [pre, code] of [[snapshot(0, 1, false), 'NOT_A_FILE'], [snapshot(9), 'TOO_LARGE']] as const) {
      const fake = fakeHandle(new Uint8Array(), [pre, pre])
      expect((await failure(readBoundedHandle(fake.handle, '/v/data.txt', 8, 'file exceeds 8 bytes'))).code).toBe(code)
      expect(fake.largestReadBuffer()).toBeUndefined()
      expect(fake.statsRead()).toBe(1)
    }
  })
})
