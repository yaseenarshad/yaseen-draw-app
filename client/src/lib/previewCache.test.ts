/**
 * The shared preview cache (YAZ-1818, YAZ-1819, YAZ-1800): one request per key, a failure is null,
 * and a bounded cache forgets the least recently seen picture first.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPreviewCache } from './previewCache'

describe('createPreviewCache', () => {
  it('asks once per key, however many callers wait on it', async () => {
    const fetch = vi.fn(async (key: string) => `data:${key}`)
    const cache = createPreviewCache(fetch)
    const [a, b] = await Promise.all([cache.load('x'), cache.load('x')])
    expect(a).toBe('data:x')
    expect(b).toBe('data:x')
    await cache.load('x')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('answers null when the picture cannot be had, and asks again next time', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('offline')
    })
    const cache = createPreviewCache(fetch)
    await expect(cache.load('x')).resolves.toBeNull()
    await expect(cache.load('x')).resolves.toBeNull()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('keeps an empty string as a settled answer (an empty board is not a failure)', async () => {
    const fetch = vi.fn(async () => '')
    const cache = createPreviewCache(fetch)
    await expect(cache.load('x')).resolves.toBe('')
    await expect(cache.load('x')).resolves.toBe('')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('with a limit, evicts the least recently seen key first', async () => {
    const fetch = vi.fn(async (key: string) => `data:${key}`)
    const cache = createPreviewCache(fetch, { limit: 2 })
    await cache.load('a')
    await cache.load('b')
    await cache.load('a') // a is now the most recently seen
    await cache.load('c') // evicts b
    expect(fetch).toHaveBeenCalledTimes(3)
    await cache.load('a')
    expect(fetch).toHaveBeenCalledTimes(3)
    await cache.load('b')
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(fetch.mock.calls.map(([key]) => key)).toEqual(['a', 'b', 'c', 'b'])
  })
})
