/**
 * The media cache on disk (🔒 D4, YAZ-1818). The properties that matter are the ones that keep it
 * a CACHE: a miss is never an error, a write that fails is never an error, and the folder cannot
 * grow past what the last 24 h of searching put in it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMediaCache, type MediaCache } from './cache'
import { CACHE_TTL_MS, cacheFileName } from './cachePolicy'

let dir: string
let folder: string
let cache: MediaCache
let clock = 1_700_000_000_000

beforeEach(async () => {
  clock = 1_700_000_000_000
  dir = await mkdtemp(path.join(tmpdir(), 'yd-media-cache-'))
  folder = path.join(dir, 'media-cache')
  await mkdir(folder, { recursive: true })
  cache = createMediaCache(folder, { now: () => clock })
})
afterEach(async () => {
  await chmod(folder, 0o755).catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

/** Backdate an entry by name, the way a day of real time would. */
async function age(key: string, ms: number) {
  const file = path.join(folder, cacheFileName(key))
  const when = new Date(clock - ms)
  await utimes(file, when, when)
}

describe('read and write', () => {
  it('answers with what was written', async () => {
    await cache.write('k', { items: [1, 2, 3] })
    await expect(cache.read('k')).resolves.toEqual({ items: [1, 2, 3] })
  })

  it('misses on a key that was never written', async () => {
    await expect(cache.read('nothing')).resolves.toBeNull()
  })

  it('misses on an entry older than 24 h without deleting it — the sweep owns that', async () => {
    await cache.write('k', 'value')
    await age('k', CACHE_TTL_MS + 1000)
    await expect(cache.read('k')).resolves.toBeNull()
    expect(await readdir(folder)).toHaveLength(1)
  })

  it('misses on a file that is no longer JSON rather than throwing at its caller', async () => {
    await cache.write('k', 'value')
    await writeFile(path.join(folder, cacheFileName('k')), '{ not json')
    await expect(cache.read('k')).resolves.toBeNull()
  })

  it('writes atomically — a reader never sees a half file, and no tmp is left behind', async () => {
    await cache.write('k', { a: 1 })
    expect(await readdir(folder)).toEqual([cacheFileName('k')])
  })

  it('swallows a write it cannot make: a cache that cannot store is still a working cache', async () => {
    await rm(folder, { recursive: true, force: true })
    await expect(cache.write('k', 'value')).resolves.toBeUndefined()
    await expect(cache.read('k')).resolves.toBeNull()
  })
})

describe('the startup sweep', () => {
  it('takes the expired entries and leaves the fresh ones', async () => {
    await cache.write('old', 1)
    await cache.write('new', 2)
    await age('old', CACHE_TTL_MS + 1000)
    await expect(cache.sweep()).resolves.toBe(1)
    expect(await readdir(folder)).toEqual([cacheFileName('new')])
  })

  it('leaves a file that is not ours alone', async () => {
    await writeFile(path.join(folder, 'README.txt'), 'not ours')
    const old = new Date(clock - CACHE_TTL_MS - 1000)
    await utimes(path.join(folder, 'README.txt'), old, old)
    await expect(cache.sweep()).resolves.toBe(0)
    expect(await readdir(folder)).toEqual(['README.txt'])
  })

  it('does nothing, loudly or otherwise, when the folder is not there', async () => {
    await rm(folder, { recursive: true, force: true })
    await expect(cache.sweep()).resolves.toBe(0)
  })
})
