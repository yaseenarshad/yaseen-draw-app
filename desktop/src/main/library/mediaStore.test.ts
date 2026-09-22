import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MEDIA_LIBRARY_FILE, type MediaItem } from '@shared/types'
import { createMediaStore, type MediaStore } from './mediaStore'

const item = (over: Partial<MediaItem> = {}): MediaItem => ({ itemKey: 'pixabay:1', provider: 'pixabay', providerId: '1', kind: 'photo', title: 'A tree', ...over })

const until = async (pred: () => boolean, ms = 3000) => {
  const t0 = Date.now()
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('condition not met')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 300))

let dir: string
let library: string
let store: MediaStore
let now = 1000
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-media-store-'))
  library = path.join(dir, 'library')
  await mkdir(library)
  now = 1000
  store = createMediaStore(library, { now: () => now++ })
})
afterEach(async () => {
  await store.close()
  await rm(dir, { recursive: true, force: true })
})

const file = () => path.join(library, MEDIA_LIBRARY_FILE)
const onDisk = async () => JSON.parse(await readFile(file(), 'utf8')) as unknown

describe('createMediaStore — reading (🔒 YAZ-1775 D5)', () => {
  it('a missing file reads as two empty lists and is NOT created by the read', async () => {
    expect(await store.favorites({ op: 'list' })).toEqual([])
    expect(await store.recent({ op: 'list' })).toEqual([])
    expect(await readdir(library)).toEqual([])
  })

  it('a well-formed file reads back row by row', async () => {
    const fav = { ...item(), updatedAt: 5 }
    await writeFile(file(), JSON.stringify({ version: 1, favorites: [fav], recent: [] }))
    expect(await store.favorites({ op: 'list' })).toEqual([fav])
  })

  it('a corrupt file is moved aside as media.json.corrupt-<epoch> and reads as empty', async () => {
    await writeFile(file(), '{ not json')
    expect(await store.favorites({ op: 'list' })).toEqual([])
    const names = await readdir(library)
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^media\.json\.corrupt-\d+$/)
    expect(await readFile(path.join(library, names[0]), 'utf8')).toBe('{ not json')
  })

  it('a wrong-versioned file is corrupt too; a bad ROW in a good file is just dropped', async () => {
    await writeFile(file(), JSON.stringify({ version: 2, favorites: [], recent: [] }))
    expect(await store.recent({ op: 'list' })).toEqual([])
    expect((await readdir(library)).some((n) => n.startsWith('media.json.corrupt-'))).toBe(true)
    await writeFile(file(), JSON.stringify({ version: 1, favorites: [{ ...item(), updatedAt: 1 }, { itemKey: 'junk' }], recent: [] }))
    expect(await store.favorites({ op: 'list' })).toEqual([{ ...item(), updatedAt: 1 }])
  })
})

describe('createMediaStore — writing', () => {
  it('add writes the file atomically and answers the new list; the write creates the folder if it went missing', async () => {
    await rm(library, { recursive: true })
    expect(await store.favorites({ op: 'add', item: item() })).toEqual([{ ...item(), updatedAt: 1000 }])
    expect(await onDisk()).toEqual({ version: 1, favorites: [{ ...item(), updatedAt: 1000 }], recent: [] })
    expect((await readdir(library)).filter((n) => n.includes('.tmp-'))).toEqual([]) // tmp + rename left no residue
  })

  it('remove and record each answer their own list and leave the other alone', async () => {
    await store.favorites({ op: 'add', item: item({ itemKey: 'a', providerId: 'a' }) })
    await store.favorites({ op: 'add', item: item({ itemKey: 'b', providerId: 'b' }) })
    expect((await store.recent({ op: 'record', item: item({ itemKey: 'a', providerId: 'a' }) })).map((r) => r.itemKey)).toEqual(['a'])
    expect((await store.favorites({ op: 'remove', itemKey: 'a' })).map((f) => f.itemKey)).toEqual(['b'])
    expect((await store.recent({ op: 'list' })).map((r) => r.itemKey)).toEqual(['a'])
  })

  it('a no-op mutation (adding a favorite twice, removing a stranger) does not touch the disk', async () => {
    await store.favorites({ op: 'add', item: item() })
    const before = (await stat(file())).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    await store.favorites({ op: 'add', item: item({ title: 'renamed' }) })
    await store.favorites({ op: 'remove', itemKey: 'nope' })
    expect((await stat(file())).mtimeMs).toBe(before)
  })

  it('concurrent mutations serialise — every one lands, none overwrites another', async () => {
    await Promise.all(['a', 'b', 'c', 'd'].map((k) => store.favorites({ op: 'add', item: item({ itemKey: k, providerId: k }) })))
    expect((await store.favorites({ op: 'list' })).map((f) => f.itemKey).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('a corrupt file is moved aside by a write too, and the write then starts fresh', async () => {
    await writeFile(file(), 'nope')
    expect(await store.favorites({ op: 'add', item: item() })).toHaveLength(1)
    expect((await readdir(library)).sort()).toEqual([MEDIA_LIBRARY_FILE, expect.stringMatching(/^media\.json\.corrupt-\d+$/)])
  })
})

describe('createMediaStore — watching', () => {
  it('an own write notifies listeners ONCE (synchronously), and the watcher echo of it is dropped', async () => {
    let n = 0
    store.onChanged(() => n++)
    await settle() // let the poller anchor before the write
    await store.favorites({ op: 'add', item: item() })
    expect(n).toBe(1)
    await settle()
    await settle()
    expect(n).toBe(1)
  })

  it('an external write notifies; an external delete notifies and the store reads empty again', async () => {
    let n = 0
    store.onChanged(() => n++)
    await settle()
    await writeFile(file(), JSON.stringify({ version: 1, favorites: [{ ...item(), updatedAt: 3 }], recent: [] }))
    await until(() => n === 1)
    expect(await store.favorites({ op: 'list' })).toEqual([{ ...item(), updatedAt: 3 }])
    await rm(file())
    await until(() => n === 2)
    expect(await store.favorites({ op: 'list' })).toEqual([])
  })

  it('other files in the folder — a tmp file, a component — are not the library and do not notify', async () => {
    let n = 0
    store.onChanged(() => n++)
    await settle()
    await writeFile(path.join(library, 'media.json.tmp-abc'), 'x')
    await mkdir(path.join(library, 'components'))
    await writeFile(path.join(library, 'components', 'Card.excalidraw'), '{}')
    await settle()
    await settle()
    expect(n).toBe(0)
  })

  it('setFolder re-points: the old folder goes quiet, the new one is read and watched', async () => {
    let n = 0
    store.onChanged(() => n++)
    await store.favorites({ op: 'add', item: item({ itemKey: 'old', providerId: 'old' }) })
    const other = path.join(dir, 'elsewhere')
    await mkdir(other)
    await writeFile(path.join(other, MEDIA_LIBRARY_FILE), JSON.stringify({ version: 1, favorites: [], recent: [{ ...item({ itemKey: 'new', providerId: 'new' }), updatedAt: 9 }] }))
    store.setFolder(other)
    expect((await store.recent({ op: 'list' })).map((r) => r.itemKey)).toEqual(['new'])
    expect(await store.favorites({ op: 'list' })).toEqual([])
    n = 0
    await settle()
    await writeFile(file(), JSON.stringify({ version: 1, favorites: [], recent: [] })) // the OLD folder
    await settle()
    await settle()
    expect(n).toBe(0)
    await writeFile(path.join(other, MEDIA_LIBRARY_FILE), JSON.stringify({ version: 1, favorites: [], recent: [] }))
    await until(() => n === 1)
  })

  it('unsubscribe stops the notifications', async () => {
    let n = 0
    const off = store.onChanged(() => n++)
    off()
    await store.favorites({ op: 'add', item: item() })
    expect(n).toBe(0)
  })
})
