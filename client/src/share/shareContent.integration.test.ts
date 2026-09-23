/**
 * SCENARIO 9 THROUGH THE REAL CODE PATH (YAZ-1892 5A): boards seeded on disk the way the share demo
 * vault seeds them → main's REAL `loadDrawing` (the `drawing:load` handler) → the REAL
 * `buildShareContent` with the REAL engine's `serializeAsJSON` — the exact bytes a share uploads.
 *
 * Main's loader and Node's fs are reached through non-literal dynamic imports on purpose: the
 * renderer's tsconfig must not type-check main-process code, but at test time vitest runs both.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DrawingLoadRequest, DrawingLoadResponse } from '@shared/types'
import { buildShareContent } from './shareContent'

interface NodeFs {
  mkdtemp(prefix: string): Promise<string>
  mkdir(p: string, o: { recursive: true }): Promise<unknown>
  writeFile(p: string, data: string | Uint8Array): Promise<void>
  rm(p: string, o: { recursive: true; force: true }): Promise<void>
}
const nodeImport = <T>(specifier: string): Promise<T> => import(/* @vite-ignore */ specifier) as Promise<T>
const MAIN_DRAWING = '../../../desktop/src/main/fs/drawing'

vi.mock('../api', () => ({
  api: {
    drawing: {
      load: async (req: DrawingLoadRequest): Promise<DrawingLoadResponse> => (await nodeImport<{ loadDrawing: (r: DrawingLoadRequest) => Promise<DrawingLoadResponse> }>(MAIN_DRAWING)).loadDrawing(req),
    },
  },
}))

// Distinct canonical base64 payloads stand in for the PNG bytes (the loader never decodes them).
const B64 = { lean1: 'AAAA', lean2: 'AQID', legacyA: 'BAUG', legacyB: 'BwgJ', keepA: 'CgsM', keepB: 'DQ4P', goneA: 'EBES', goneB: 'ExQV' } as const
type Img = keyof typeof B64
const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
const dataURL = (img: Img) => `data:image/png;base64,${B64[img]}`
let n = 0
const image = (fileId: string, extra: Record<string, unknown> = {}) => ({ id: `el${n++}`, type: 'image', x: n * 10, y: 0, width: 100, height: 100, fileId, status: 'saved', scale: [1, 1], ...extra })
const rect = () => ({ id: `el${n++}`, type: 'rectangle', x: 0, y: 0, width: 100, height: 50 })
const scene = (elements: unknown[], files: Record<string, unknown> = {}) => JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaz-1892', elements, appState: { viewBackgroundColor: '#ffffff' }, files })
const entry = (img: Img) => ({ mimeType: 'image/png', id: img, dataURL: dataURL(img), created: 1 })

let fs: NodeFs
let root: string
const at = (rel: string) => `${root}/${rel}`
async function write(rel: string, data: string | Uint8Array) {
  await fs.mkdir(at(rel).slice(0, at(rel).lastIndexOf('/')), { recursive: true })
  await fs.writeFile(at(rel), data)
}
async function shared(rel: string) {
  const built = await buildShareContent(root, at(rel), { flush: false })
  return { ...built, scene: JSON.parse(built.content) as { elements: { id: string; isDeleted?: boolean }[]; files: Record<string, { dataURL: string }> } }
}

beforeAll(async () => {
  fs = await nodeImport<NodeFs>('node:fs/promises')
  const tmp = (await nodeImport<{ tmpdir(): string }>('node:os')).tmpdir()
  root = await fs.mkdtemp(`${tmp}/share-content-`)
  // 02 lean: the bytes live only in assets/.
  for (const img of ['lean1', 'lean2', 'keepA', 'keepB', 'goneA'] as const) await write(`assets/${img}.png`, bytes(B64[img]))
  await write('02 Lean.excalidraw', scene([image('lean1'), image('lean2')]))
  // 03 legacy: the bytes are embedded in the file itself, nothing in assets/.
  await write('03 Legacy.excalidraw', scene([image('legacyA'), image('legacyB')], { legacyA: entry('legacyA'), legacyB: entry('legacyB') }))
  // 07 deleted: two live images, two deleted ones — one of them still in assets/, one still embedded.
  await write('07 Deleted.excalidraw', scene([image('keepA'), image('keepB'), image('goneA', { isDeleted: true }), image('goneB', { isDeleted: true })], { goneB: entry('goneB') }))
  await write('06 Empty.excalidraw', scene([]))
  await write("08 Tom's “café” board 🎨 — ünïcödé.excalidraw", scene([rect()]))
  await write('Clients/Acme Corp/2026/Q3 workshop/09 Deep.excalidraw', scene([image('lean1')]))
})
afterAll(() => fs.rm(root, { recursive: true, force: true }))

describe('the bytes a share uploads, from seeded boards (YAZ-1892 scenario 9)', () => {
  it('a lean board (images in assets/) arrives with every image embedded', async () => {
    const { scene: s } = await shared('02 Lean.excalidraw')
    expect(Object.keys(s.files).sort()).toEqual(['lean1', 'lean2'])
    expect(s.files.lean1.dataURL).toBe(dataURL('lean1'))
    expect(s.files.lean2.dataURL).toBe(dataURL('lean2'))
  })

  it('a legacy board (base64 inside the file) keeps its images', async () => {
    const { scene: s } = await shared('03 Legacy.excalidraw')
    expect(Object.keys(s.files).sort()).toEqual(['legacyA', 'legacyB'])
    expect(s.files.legacyB.dataURL).toBe(dataURL('legacyB'))
  })

  it("a deleted element's image is not shipped, whether it sat in assets/ or in the file", async () => {
    const { content, scene: s } = await shared('07 Deleted.excalidraw')
    expect(Object.keys(s.files).sort()).toEqual(['keepA', 'keepB'])
    expect(content).not.toContain(B64.goneA)
    expect(content).not.toContain(B64.goneB)
  })

  it('an empty board shares as a valid empty scene', async () => {
    const built = await shared('06 Empty.excalidraw')
    expect(built.scene).toMatchObject({ type: 'excalidraw', elements: [], files: {} })
    expect(built.tooLarge).toBe(false)
  })

  it('unicode, emoji and apostrophe names and a board four folders down load and build', async () => {
    expect((await shared("08 Tom's “café” board 🎨 — ünïcödé.excalidraw")).scene.elements).toHaveLength(1)
    expect(Object.keys((await shared('Clients/Acme Corp/2026/Q3 workshop/09 Deep.excalidraw')).scene.files)).toEqual(['lean1'])
  })
})
