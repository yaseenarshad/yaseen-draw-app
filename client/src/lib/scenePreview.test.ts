/**
 * A scene's picture (🔒 YAZ-1775 D5, YAZ-1819; boards since 🔒 YAZ-1800 D1): the component tile's bound the
 * web app used, any other bounds a caller gives, and the PNG dataURL `components:save` takes. `exportToBlob` is stubbed — this pins what it is ASKED for, which is
 * the whole of the port.
 */
import { describe, expect, it, vi } from 'vitest'
import { COMPONENT_PREVIEW_BOUNDS, blobToDataUrl, createScenePreviewPng, previewDimensions, visibleElements, type PreviewEngine } from './scenePreview'

const { maxWidth: PREVIEW_MAX_WIDTH, maxHeight: PREVIEW_MAX_HEIGHT, padding: PREVIEW_PADDING } = COMPONENT_PREVIEW_BOUNDS

const png = (size = 8) => new Blob([new Uint8Array(size)], { type: 'image/png' })
const engineWith = (blob: Blob) => ({ exportToBlob: vi.fn(async () => blob) }) as unknown as PreviewEngine & { exportToBlob: ReturnType<typeof vi.fn> }

describe('previewDimensions — the web app’s bound, unchanged', () => {
  it('leaves something already small alone', () => {
    expect(previewDimensions(200, 100)).toEqual({ width: 200, height: 100, scale: 1 })
  })

  it('scales a wide component down to the width bound, keeping its ratio', () => {
    expect(previewDimensions(PREVIEW_MAX_WIDTH * 2, 200)).toEqual({ width: PREVIEW_MAX_WIDTH, height: 100, scale: 0.5 })
  })

  it('scales a tall component down to the height bound', () => {
    expect(previewDimensions(100, PREVIEW_MAX_HEIGHT * 4)).toEqual({ width: 25, height: PREVIEW_MAX_HEIGHT, scale: 0.25 })
  })

  it('scales to other bounds when given them', () => {
    expect(previewDimensions(2400, 400, { maxWidth: 1200, maxHeight: 800, padding: 16 })).toEqual({ width: 1200, height: 200, scale: 0.5 })
  })

  it('never answers zero — a one-pixel component still has a picture', () => {
    expect(previewDimensions(0, 0)).toEqual({ width: 1, height: 1, scale: 1 })
  })
})

describe('createScenePreviewPng', () => {
  it('asks for a PNG at the bounded size, with the board’s background and 12 px of padding', async () => {
    const engine = engineWith(png())
    await createScenePreviewPng(engine, { elements: [{ id: 'a' }], appState: { theme: 'light', viewBackgroundColor: '#fff' }, files: {} })
    expect(engine.exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        exportPadding: PREVIEW_PADDING,
        getDimensions: expect.any(Function),
        appState: expect.objectContaining({ viewBackgroundColor: '#fff', exportBackground: true, exportWithDarkMode: false }),
      }),
    )
  })

  it('follows the board into dark mode, the way the web app did', async () => {
    const engine = engineWith(png())
    await createScenePreviewPng(engine, { elements: [{ id: 'a' }], appState: { theme: 'dark' }, files: {} })
    expect(engine.exportToBlob.mock.calls[0][0].appState).toMatchObject({ exportWithDarkMode: true })
  })

  it('answers a `data:image/png;base64,…` dataURL — the only way bytes cross the bridge', async () => {
    const dataURL = await createScenePreviewPng(engineWith(png()), { elements: [{ id: 'a' }], appState: {}, files: {} })
    expect(dataURL.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('never draws a soft-deleted element, and refuses when that leaves nothing', async () => {
    const engine = engineWith(png())
    await createScenePreviewPng(engine, { elements: [{ id: 'a' }, { id: 'b', isDeleted: true }], appState: {}, files: {} })
    expect(engine.exportToBlob.mock.calls[0][0].elements).toEqual([{ id: 'a' }])
    await expect(createScenePreviewPng(engine, { elements: [{ id: 'b', isDeleted: true }], appState: {}, files: {} })).rejects.toThrow(/requires visible elements/)
  })

  it('draws inside the bounds it is given (YAZ-1800)', async () => {
    const engine = engineWith(png())
    const bounds = { maxWidth: 1200, maxHeight: 800, padding: 16 }
    await createScenePreviewPng(engine, { elements: [{ id: 'a' }], appState: {}, files: {} }, bounds)
    const call = engine.exportToBlob.mock.calls[0][0]
    expect(call.exportPadding).toBe(16)
    expect(call.getDimensions(2400, 400)).toEqual({ width: 1200, height: 200, scale: 0.5 })
  })

  it('an empty blob is a failure, not a picture', async () => {
    await expect(createScenePreviewPng(engineWith(png(0)), { elements: [{ id: 'a' }], appState: {}, files: {} })).rejects.toThrow(/could not be drawn/)
  })
})

describe('visibleElements', () => {
  it('keeps everything not soft-deleted, in order, whatever else an element carries', () => {
    expect(visibleElements([{ id: 'a' }, { id: 'b', isDeleted: true }, { id: 'c', isDeleted: false }])).toEqual([{ id: 'a' }, { id: 'c', isDeleted: false }])
    expect(visibleElements([{ id: 'gone', isDeleted: true }])).toEqual([])
  })
})

describe('blobToDataUrl', () => {
  it('round-trips the bytes with their own mime type', async () => {
    await expect(blobToDataUrl(new Blob(['hi'], { type: 'text/plain' }))).resolves.toBe(`data:text/plain;base64,${btoa('hi')}`)
  })
})
