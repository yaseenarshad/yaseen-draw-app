/**
 * The component store on a real temp library folder (🔒 D5, YAZ-1819), with `shell.trashItem`
 * injected — no Electron import, no mocks beyond the trash spy. What is pinned here is the layout
 * the contract names, the folder-is-the-truth rule, and that a delete never reaches `fs.rm`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { COMPONENTS_INDEX_FILE, LIBRARY_COMPONENTS_DIR, type ComponentsIndexFile } from '@shared/types'
import { createComponentStore, type ComponentStore } from './componentStore'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

const fragment = (elements: unknown[] = [{ id: 'e1', type: 'rectangle' }], files: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements, appState: {}, files }, null, 2)

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
let store: ComponentStore
let trash: ReturnType<typeof vi.fn>
let now = 1000
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-components-'))
  library = path.join(dir, 'library')
  await mkdir(library)
  now = 1000
  trash = vi.fn(async (p: string) => {
    await rm(p, { force: true })
  })
  store = createComponentStore(library, { now: () => now++, trash })
})
afterEach(async () => {
  await store.close()
  await rm(dir, { recursive: true, force: true })
})

const componentsDir = () => path.join(library, LIBRARY_COMPONENTS_DIR)
const indexFile = () => path.join(library, COMPONENTS_INDEX_FILE)
const onDisk = async () => JSON.parse(await readFile(indexFile(), 'utf8')) as ComponentsIndexFile

describe('createComponentStore — the layout (🔒 D5)', () => {
  it('a missing library reads as an empty list and is NOT created by the read', async () => {
    expect(await store.list()).toEqual([])
    expect(await readdir(library)).toEqual([])
  })

  it('a save writes `components/<slug>.excalidraw` + `<slug>.png` and the index beside them', async () => {
    const item = await store.save({ name: 'A Card', fragmentJson: fragment(), previewPng: PNG })
    expect(item).toEqual({ slug: 'a-card', name: 'A Card', elementCount: 1, createdAt: 1000, updatedAt: 1000 })
    expect((await readdir(componentsDir())).sort()).toEqual(['a-card.excalidraw', 'a-card.png'])
    expect(await readdir(library)).toContain(COMPONENTS_INDEX_FILE)
    expect(await onDisk()).toEqual({ version: 1, items: [item] })
  })

  it('the fragment lands VERBATIM — a component is an Excalidraw document, and re-spelling it would make the two disagree', async () => {
    const json = fragment()
    await store.save({ name: 'A card', fragmentJson: json, previewPng: PNG })
    expect(await store.read({ slug: 'a-card' })).toBe(`${json}\n`)
  })

  it('the preview is the PNG bytes, and comes back as the same dataURL', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    expect(await store.preview({ slug: 'a-card' })).toBe(PNG)
    expect((await stat(path.join(componentsDir(), 'a-card.png'))).size).toBe(Buffer.from(PNG.split(',')[1], 'base64').byteLength)
  })

  it('the image bytes a component names travel INSIDE the fragment (🔒 D5: self-contained)', async () => {
    const files = { abc: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==' } }
    await store.save({ name: 'Photo card', fragmentJson: fragment([{ id: 'e1', type: 'image', fileId: 'abc' }], files), previewPng: PNG })
    const written = JSON.parse(await store.read({ slug: 'photo-card' })) as { files: Record<string, unknown> }
    expect(written.files).toEqual(files)
  })

  it('a second component with the same name takes `-2`, and a third `-3`', async () => {
    expect((await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })).slug).toBe('a-card')
    expect((await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })).slug).toBe('a-card-2')
    expect((await store.save({ name: 'a CARD', fragmentJson: fragment(), previewPng: PNG })).slug).toBe('a-card-3')
    expect((await readdir(componentsDir())).filter((n) => n.endsWith('.excalidraw')).sort()).toEqual(['a-card-2.excalidraw', 'a-card-3.excalidraw', 'a-card.excalidraw'])
  })

  it('the newest save is at the head of the list', async () => {
    await store.save({ name: 'First', fragmentJson: fragment(), previewPng: PNG })
    await store.save({ name: 'Second', fragmentJson: fragment(), previewPng: PNG })
    expect((await store.list()).map((i) => i.name)).toEqual(['Second', 'First'])
  })
})

describe('createComponentStore — refusals', () => {
  it('a name that is nothing but whitespace is BAD_REQUEST, and nothing is written', async () => {
    await expect(store.save({ name: '   ', fragmentJson: fragment(), previewPng: PNG })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readdir(library)).toEqual([])
  })

  it('a fragment that is not a component is BAD_REQUEST, and nothing is written', async () => {
    await expect(store.save({ name: 'A card', fragmentJson: 'not json', previewPng: PNG })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(store.save({ name: 'A card', fragmentJson: fragment([]), previewPng: PNG })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(await readdir(library)).toEqual([])
  })

  it('an image element whose bytes are NOT embedded is refused — a component must insert anywhere', async () => {
    await expect(store.save({ name: 'A card', fragmentJson: fragment([{ id: 'e1', type: 'image', fileId: 'abc' }]), previewPng: PNG })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('a preview that is not a base64 image/png dataURL is refused', async () => {
    for (const preview of ['', 'data:image/webp;base64,AA==', 'https://example.com/a.png']) {
      await expect(store.save({ name: 'A card', fragmentJson: fragment(), previewPng: preview })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
  })

  it('a slug that is not a slug never reaches the filesystem', async () => {
    for (const slug of ['../escape', 'a/b', '.', 'A-Card', 'a.b']) {
      await expect(store.read({ slug }), slug).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(store.preview({ slug }), slug).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(store.delete({ slug }), slug).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
    expect(trash).not.toHaveBeenCalled()
  })

  it('reading, renaming or deleting a component that is not there is NOT_FOUND', async () => {
    await expect(store.read({ slug: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.preview({ slug: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.rename({ slug: 'gone', name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(store.delete({ slug: 'gone' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('createComponentStore — rename and delete', () => {
  it('a rename changes the label and the stamp; both files keep their names', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    const renamed = await store.rename({ slug: 'a-card', name: 'Renamed card' })
    expect(renamed).toMatchObject({ slug: 'a-card', name: 'Renamed card', createdAt: 1000 })
    expect(renamed.updatedAt).toBeGreaterThan(1000)
    expect((await readdir(componentsDir())).sort()).toEqual(['a-card.excalidraw', 'a-card.png'])
  })

  it('a delete TRASHES both files — never `fs.rm` — and drops the row', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    await store.delete({ slug: 'a-card' })
    expect(trash.mock.calls.map(([p]) => path.basename(p as string)).sort()).toEqual(['a-card.excalidraw', 'a-card.png'])
    expect(await readdir(componentsDir())).toEqual([])
    expect(await store.list()).toEqual([])
  })

  it('a delete whose PREVIEW has already gone still removes the component', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    await rm(path.join(componentsDir(), 'a-card.png'))
    await store.delete({ slug: 'a-card' })
    expect(await store.list()).toEqual([])
  })

  it('a trash that FAILS on the fragment leaves the component alone — the index is not rewritten behind a file that is still there', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    trash.mockRejectedValueOnce(new Error('trash is full'))
    await expect(store.delete({ slug: 'a-card' })).rejects.toBeTruthy()
    expect((await store.list()).map((i) => i.slug)).toEqual(['a-card'])
    expect(await readdir(componentsDir())).toContain('a-card.excalidraw')
  })
})

describe('createComponentStore — the folder is the truth, the index is a cache (🔒 D5)', () => {
  it('a MISSING index is rebuilt from the folder, each row named after its own slug', async () => {
    await mkdir(componentsDir(), { recursive: true })
    await writeFile(path.join(componentsDir(), 'from-elsewhere.excalidraw'), fragment([{ id: 'a', type: 'rectangle' }, { id: 'b', type: 'ellipse' }]))
    expect(await store.list()).toEqual([expect.objectContaining({ slug: 'from-elsewhere', name: 'from-elsewhere', elementCount: 2 })])
    // A read never writes: the rebuilt index is in memory until something actually changes.
    expect(await readdir(library)).toEqual([LIBRARY_COMPONENTS_DIR])
  })

  it('a CORRUPT index is moved aside as `components.json.corrupt-<epoch>` and rebuilt', async () => {
    await mkdir(componentsDir(), { recursive: true })
    await writeFile(path.join(componentsDir(), 'kept.excalidraw'), fragment())
    await writeFile(indexFile(), '{ not json at all')
    expect((await store.list()).map((i) => i.slug)).toEqual(['kept'])
    const left = await readdir(library)
    expect(left.some((n) => n.startsWith(`${COMPONENTS_INDEX_FILE}.corrupt-`))).toBe(true)
    expect(left).not.toContain(COMPONENTS_INDEX_FILE)
  })

  it('a row whose FILE was deleted in Finder stops being offered', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    await rm(path.join(componentsDir(), 'a-card.excalidraw'))
    expect(await store.list()).toEqual([])
  })

  it('a known row keeps the NAME the folder cannot tell us', async () => {
    await store.save({ name: 'A pretty card', fragmentJson: fragment(), previewPng: PNG })
    await store.close()
    store = createComponentStore(library, { now: () => now++, trash })
    expect((await store.list())[0]).toMatchObject({ slug: 'a-pretty-card', name: 'A pretty card' })
  })

  it('a fragment that is not a component at all is SKIPPED rather than listed as a tile that cannot insert', async () => {
    await mkdir(componentsDir(), { recursive: true })
    await writeFile(path.join(componentsDir(), 'broken.excalidraw'), 'truncated{')
    await writeFile(path.join(componentsDir(), 'good.excalidraw'), fragment())
    expect((await store.list()).map((i) => i.slug)).toEqual(['good'])
  })

  it('a stray file that is not a `<slug>.excalidraw` is not a component', async () => {
    await mkdir(componentsDir(), { recursive: true })
    await writeFile(path.join(componentsDir(), 'A Card.excalidraw'), fragment())
    await writeFile(path.join(componentsDir(), 'notes.txt'), 'hello')
    await writeFile(path.join(componentsDir(), 'orphan.png'), 'x')
    expect(await store.list()).toEqual([])
  })

  it('a save after a rebuild does not collide with a slug only the FOLDER knew', async () => {
    await mkdir(componentsDir(), { recursive: true })
    await writeFile(path.join(componentsDir(), 'a-card.excalidraw'), fragment())
    expect((await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })).slug).toBe('a-card-2')
  })
})

describe('createComponentStore — watching (🔒 D5: one library, every window)', () => {
  it('an EXTERNAL write into the folder notifies — that is how a synced component appears', async () => {
    const seen = vi.fn()
    store.onChanged(seen)
    await mkdir(componentsDir(), { recursive: true })
    await settle()
    await writeFile(path.join(componentsDir(), 'synced.excalidraw'), fragment())
    await until(() => seen.mock.calls.length > 0)
    expect((await store.list()).map((i) => i.slug)).toEqual(['synced'])
  })

  it('an OWN save notifies exactly once — the watcher echo of its three writes is dropped', async () => {
    const seen = vi.fn()
    store.onChanged(seen)
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    expect(seen).toHaveBeenCalledTimes(1)
    await settle()
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('`setFolder` re-points the watcher; the old folder goes quiet and the new one is listed', async () => {
    await store.save({ name: 'A card', fragmentJson: fragment(), previewPng: PNG })
    const other = path.join(dir, 'other-library')
    await mkdir(path.join(other, LIBRARY_COMPONENTS_DIR), { recursive: true })
    store.setFolder(other)
    expect(await store.list()).toEqual([])
    const seen = vi.fn()
    store.onChanged(seen)
    await writeFile(path.join(componentsDir(), 'ignored.excalidraw'), fragment())
    await settle()
    expect(seen).not.toHaveBeenCalled()
  })
})
