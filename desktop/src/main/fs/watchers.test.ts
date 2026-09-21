import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { WatchEvent } from '@shared/types'
import { activeWatcherRoots, subscribe } from './watchers'
import { makeFixture, until } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

interface Sub {
  /** Next event (events arrive in order; `ready` is always first). */
  next: () => Promise<WatchEvent>
  close: () => void
}

const open: Sub[] = []
afterEach(async () => {
  open.splice(0).forEach((s) => s.close())
  await until(() => activeWatcherRoots().length === 0)
})

/** Subscribes to `r` and queues its events. */
function openWatch(r: string): Sub {
  const queue: WatchEvent[] = []
  const waiters: Array<(ev: WatchEvent) => void> = []
  const off = subscribe(r, (ev) => {
    const w = waiters.shift()
    if (w) w(ev)
    else queue.push(ev)
  })
  const next = () =>
    new Promise<WatchEvent>((resolve, reject) => {
      const q = queue.shift()
      if (q) return resolve(q)
      const t = setTimeout(() => reject(new Error('timed out waiting for event')), 3000)
      waiters.push((ev) => (clearTimeout(t), resolve(ev)))
    })
  const sub = { next, close: off }
  open.push(sub)
  return sub
}

describe('shared watchers', () => {
  it('emits `ready` first and shares one watcher per root; late joiners get `ready` at once', async () => {
    const a = openWatch(root)
    expect(await a.next()).toEqual({ type: 'ready', root })
    const b = openWatch(root)
    expect(await b.next()).toEqual({ type: 'ready', root })
    expect(activeWatcherRoots()).toEqual([root])
  })

  it('add / change / unlink for a markdown file, with mtime, to every subscriber', async () => {
    const a = openWatch(root)
    const b = openWatch(root)
    await a.next()
    await b.next()
    const file = path.join(root, 'alpha', 'watched.md')
    await writeFile(file, 'v1')
    const add = await a.next()
    expect(add).toMatchObject({ type: 'add', path: file })
    expect((add as { mtime: number }).mtime).toBeGreaterThan(0)
    expect(await b.next()).toEqual(add)

    await writeFile(file, 'v2 longer')
    const change = await a.next()
    expect(change).toMatchObject({ type: 'change', path: file })
    expect((change as { mtime: number }).mtime).toBeGreaterThanOrEqual((add as { mtime: number }).mtime)

    await rm(file)
    expect(await a.next()).toEqual({ type: 'unlink', path: file })
  })

  it.each([
    ['JSON', 'text'],
    ['PY', 'text'],
    ['pdf', 'pdf'],
    ['PNG', 'image'],
    ['WEBP', 'image'],
    ['epub', 'no viewer — YAZ-1577 D1'],
    ['svg', 'no viewer — YAZ-1577 D1'],
  ])('emits add / change / unlink for .%s files (%s)', async (extension) => {
    const a = openWatch(root)
    await a.next()
    const file = path.join(root, 'alpha', `watched.${extension}`)
    await writeFile(file, 'v1')
    expect(await a.next()).toMatchObject({ type: 'add', path: file })
    await writeFile(file, 'v2 longer')
    expect(await a.next()).toMatchObject({ type: 'change', path: file })
    await rm(file)
    expect(await a.next()).toEqual({ type: 'unlink', path: file })
  })

  it('reports files with no viewer (YAZ-1577 D1, D4) but ignores dot-entries; reports new directories', async () => {
    const a = openWatch(root)
    await a.next()
    const base = path.join(root, 'alpha', 'views.base')
    await writeFile(base, 'views: []\n')
    expect(await a.next()).toMatchObject({ type: 'add', path: base })
    await mkdir(path.join(root, '.cache'))
    await writeFile(path.join(root, '.cache', 'c.md'), 'x')
    await mkdir(path.join(root, 'newdir'))
    expect(await a.next()).toEqual({ type: 'addDir', path: path.join(root, 'newdir') })
  })

  it('a change inside .yaseendraw/ emits NOTHING on the shared watcher (GRO-2188)', async () => {
    const a = openWatch(root)
    await a.next()
    await writeFile(path.join(root, '.yaseendraw', 'types.json'), '{"b":2}')
    await writeFile(path.join(root, '.yaseendraw', 'note.md'), 'even markdown in there is invisible')
    // A control event proves the silence: the next thing the subscriber sees is the unrelated mkdir.
    await mkdir(path.join(root, 'control-dir'))
    expect(await a.next()).toEqual({ type: 'addDir', path: path.join(root, 'control-dir') })
  })

  it('closes the watcher only when the last subscriber leaves', async () => {
    const a = openWatch(root)
    const b = openWatch(root)
    await a.next()
    await b.next()
    a.close()
    await new Promise((r) => setTimeout(r, 100))
    expect(activeWatcherRoots()).toEqual([root])
    b.close()
    await until(() => activeWatcherRoots().length === 0)
  })
})
