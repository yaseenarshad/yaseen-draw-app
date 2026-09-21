/**
 * Pasted image bytes (YAZ-1656 / YAZ-1662, D6): `imageFile` picks the image out of a DataTransfer,
 * the file is written under `assets/images` through `writeAsset` (never overwriting —
 * `ALREADY_EXISTS` retries `-2`, `-3`), and the image node lands at the live selection — AFTER a
 * selected image, never in its place. `api` mocked like createDrawing.test.ts; the editor is a
 * real `createCrepe` so the insert is the real transaction. The paste/drop events that reach
 * this are pinned in `clipboardPaste.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { extFor, imageFile, imageName, IMAGES_DIR, insertPastedImage, PASTED_IMAGE_WIDTH } from './insertImage'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { writeAsset: vi.fn() },
}))

import { api, BridgeRequestError } from '../../api'

const writeAsset = vi.mocked(api.writeAsset)
const receipt = (path: string) => ({ path, mtime: 1, size: 3 })
const alreadyExists = () => new BridgeRequestError('ALREADY_EXISTS', 'path already exists')

/** A fixed clock so the name is asserted literally, not re-derived from the code under test. */
const AT = new Date(2026, 8, 18, 14, 30, 5)
const OPTS = { root: '/v', notePath: '/v/notes/My Note.md' }
const PNG = new File([new Uint8Array([1, 2, 3])], 'clip.png', { type: 'image/png' })

/** jsdom has no DataTransfer constructor; the two lists are all the code reads. */
function dt(files: File[], items: Array<{ kind: string; type: string; file: File | null }> = []): DataTransfer {
  return {
    files: files as unknown as FileList,
    items: items.map((i) => ({ kind: i.kind, type: i.type, getAsFile: () => i.file })) as unknown as DataTransferItemList,
  } as unknown as DataTransfer
}

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, image: OPTS })
  await crepe.create()
  mounted.push({ crepe, root })
  const view: EditorView = crepe.editor.action((ctx) => ctx.get(editorViewCtx))
  return { crepe, view }
}

beforeEach(() => vi.clearAllMocks())

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('imageFile', () => {
  it('is null with no DataTransfer or no image in it', () => {
    expect(imageFile(null)).toBeNull()
    expect(imageFile(dt([]))).toBeNull()
    expect(imageFile(dt([new File(['x'], 'a.txt', { type: 'text/plain' })]))).toBeNull()
  })
  it('picks the first image among `files`, skipping non-images', () => {
    const txt = new File(['x'], 'a.txt', { type: 'text/plain' })
    const jpg = new File(['x'], 'b.jpg', { type: 'image/jpeg' })
    expect(imageFile(dt([txt, jpg, PNG]))).toBe(jpg)
  })
  it('falls back to `items` of kind file with an image type', () => {
    const file = imageFile(dt([], [{ kind: 'string', type: 'text/html', file: null }, { kind: 'file', type: 'image/png', file: PNG }]))
    expect(file).toBe(PNG)
  })
})

describe('naming', () => {
  it('maps MIME to an extension, unknown → png', () => {
    expect(extFor('image/png')).toBe('png')
    expect(extFor('image/jpeg')).toBe('jpg')
    expect(extFor('image/gif')).toBe('gif')
    expect(extFor('image/webp')).toBe('webp')
    expect(extFor('image/svg+xml')).toBe('svg')
    expect(extFor('image/bmp')).toBe('bmp')
    expect(extFor('image/avif')).toBe('avif')
    expect(extFor('image/tiff')).toBe('png')
    expect(extFor('')).toBe('png')
  })
  it('names by note basename + local clock, second-granular, with a -N suffix on retry; spaces become -', () => {
    expect(imageName('My Note', AT, 'png')).toBe('My-Note-20260918-143005.png')
    expect(imageName('My Note', AT, 'jpg', 1)).toBe('My-Note-20260918-143005-2.jpg')
    expect(imageName('n', new Date(2026, 0, 2, 3, 4, 5), 'png')).toBe('n-20260102-030405.png')
    expect(imageName('  a  b ', AT, 'png')).toBe('a-b-20260918-143005.png')
    expect(imageName('', AT, 'png')).toBe('image-20260918-143005.png')
  })
})

describe('insertPastedImage', () => {
  it('writes the bytes under assets/images with create:true and inserts the node at the selection', async () => {
    writeAsset.mockResolvedValue(receipt('/v/assets/images/My-Note-20260918-143005.png'))
    const { crepe, view } = await mount('before after\n')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8))) // after "before "
    await insertPastedImage(OPTS, view, PNG, AT)
    expect(writeAsset).toHaveBeenCalledTimes(1)
    const [req] = writeAsset.mock.calls[0]
    expect(req).toMatchObject({ root: '/v', path: `${IMAGES_DIR}/My-Note-20260918-143005.png`, create: true })
    expect(req.content).toBeInstanceOf(Uint8Array)
    expect(Array.from(req.content as Uint8Array)).toEqual([1, 2, 3])
    expect(getMarkdownForSave(crepe)).toBe('before ![My-Note-20260918-143005](assets/images/My-Note-20260918-143005.png)after\n')
  })

  it('a wide image starts at PASTED_IMAGE_WIDTH via `|W`; a narrow one keeps its natural size; the bytes are untouched', async () => {
    const bitmap = vi.fn()
    vi.stubGlobal('createImageBitmap', bitmap)
    try {
      bitmap.mockResolvedValueOnce({ width: 1600, close: () => undefined })
      writeAsset.mockResolvedValue(receipt('/v/assets/images/My-Note-20260918-143005.png'))
      const wide = await mount('')
      await insertPastedImage(OPTS, wide.view, PNG, AT)
      expect(getMarkdownForSave(wide.crepe)).toContain(`![My-Note-20260918-143005|${PASTED_IMAGE_WIDTH}](assets/images/My-Note-20260918-143005.png)`)
      expect(Array.from(writeAsset.mock.calls[0][0].content as Uint8Array)).toEqual([1, 2, 3]) // full-res bytes, no re-encode

      bitmap.mockResolvedValueOnce({ width: 200, close: () => undefined })
      const narrow = await mount('')
      await insertPastedImage(OPTS, narrow.view, PNG, AT)
      expect(getMarkdownForSave(narrow.crepe)).toContain('![My-Note-20260918-143005](assets/images/My-Note-20260918-143005.png)')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('NEVER overwrites: ALREADY_EXISTS retries with -2, -3', async () => {
    writeAsset.mockRejectedValueOnce(alreadyExists())
    writeAsset.mockRejectedValueOnce(alreadyExists())
    writeAsset.mockResolvedValue(receipt('/v/assets/images/My-Note-20260918-143005-3.png'))
    const { crepe, view } = await mount('')
    await insertPastedImage(OPTS, view, PNG, AT)
    expect(writeAsset.mock.calls.map((c) => c[0].path)).toEqual([
      `${IMAGES_DIR}/My-Note-20260918-143005.png`,
      `${IMAGES_DIR}/My-Note-20260918-143005-2.png`,
      `${IMAGES_DIR}/My-Note-20260918-143005-3.png`,
    ])
    expect(getMarkdownForSave(crepe)).toContain('![My-Note-20260918-143005-3](assets/images/My-Note-20260918-143005-3.png)')
  })

  it('a paste while an image is SELECTED inserts after it — the selected image is never replaced', async () => {
    writeAsset.mockResolvedValue(receipt('/v/assets/images/My-Note-20260918-143005.png'))
    const { crepe, view } = await mount('![first](images/first.png)\n')
    let pos = -1
    view.state.doc.descendants((node, p) => {
      if (pos === -1 && node.type.name === 'image') pos = p
      return pos === -1
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)))
    await insertPastedImage(OPTS, view, PNG, AT)
    expect(getMarkdownForSave(crepe)).toBe('![first](images/first.png)![My-Note-20260918-143005](assets/images/My-Note-20260918-143005.png)\n')
    // The caret sits after the new image, ready for the next paste.
    expect(view.state.selection).toBeInstanceOf(TextSelection)
    expect(view.state.selection.from).toBe(pos + 2)
  })

  it('any other failure inserts nothing and goes to the notice', async () => {
    writeAsset.mockRejectedValue(new BridgeRequestError('TOO_LARGE', 'file too large'))
    const onNotice = vi.fn()
    const { crepe, view } = await mount('text\n')
    await insertPastedImage({ ...OPTS, onNotice }, view, PNG, AT)
    expect(onNotice).toHaveBeenCalledWith("Can't paste image: file too large")
    expect(getMarkdownForSave(crepe)).toBe('text\n')
  })
})
