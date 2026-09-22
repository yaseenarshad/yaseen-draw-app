/**
 * A component's picture (🔒 YAZ-1775 D5, YAZ-1819): the bounded size the web app used, and the PNG dataURL
 * `components:save` takes. `exportToBlob` is stubbed — this pins what it is ASKED for, which is
 * the whole of the port.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  PREVIEW_MAX_HEIGHT,
  PREVIEW_MAX_WIDTH,
  PREVIEW_PADDING,
  blobToDataUrl,
  componentPreviewDimensions,
  createComponentPreviewPng,
  type PreviewEngine,
} from './componentPreview'

const png = (size = 8) => new Blob([new Uint8Array(size)], { type: 'image/png' })
const engineWith = (blob: Blob) => ({ exportToBlob: vi.fn(async () => blob) }) as unknown as PreviewEngine & { exportToBlob: ReturnType<typeof vi.fn> }

describe('componentPreviewDimensions — the web app’s bound, unchanged', () => {
  it('leaves something already small alone', () => {
    expect(componentPreviewDimensions(200, 100)).toEqual({ width: 200, height: 100, scale: 1 })
  })

  it('scales a wide component down to the width bound, keeping its ratio', () => {
    expect(componentPreviewDimensions(PREVIEW_MAX_WIDTH * 2, 200)).toEqual({ width: PREVIEW_MAX_WIDTH, height: 100, scale: 0.5 })
  })

  it('scales a tall component down to the height bound', () => {
    expect(componentPreviewDimensions(100, PREVIEW_MAX_HEIGHT * 4)).toEqual({ width: 25, height: PREVIEW_MAX_HEIGHT, scale: 0.25 })
  })

  it('never answers zero — a one-pixel component still has a picture', () => {
    expect(componentPreviewDimensions(0, 0)).toEqual({ width: 1, height: 1, scale: 1 })
  })
})

describe('createComponentPreviewPng', () => {
  it('asks for a PNG at the bounded size, with the board’s background and 12 px of padding', async () => {
    const engine = engineWith(png())
    await createComponentPreviewPng(engine, { elements: [{ id: 'a' }], appState: { theme: 'light', viewBackgroundColor: '#fff' }, files: {} })
    expect(engine.exportToBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: 'image/png',
        exportPadding: PREVIEW_PADDING,
        getDimensions: componentPreviewDimensions,
        appState: expect.objectContaining({ viewBackgroundColor: '#fff', exportBackground: true, exportWithDarkMode: false }),
      }),
    )
  })

  it('follows the board into dark mode, the way the web app did', async () => {
    const engine = engineWith(png())
    await createComponentPreviewPng(engine, { elements: [{ id: 'a' }], appState: { theme: 'dark' }, files: {} })
    expect(engine.exportToBlob.mock.calls[0][0].appState).toMatchObject({ exportWithDarkMode: true })
  })

  it('answers a `data:image/png;base64,…` dataURL — the only way bytes cross the bridge', async () => {
    const dataURL = await createComponentPreviewPng(engineWith(png()), { elements: [{ id: 'a' }], appState: {}, files: {} })
    expect(dataURL.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('never draws a soft-deleted element, and refuses when that leaves nothing', async () => {
    const engine = engineWith(png())
    await createComponentPreviewPng(engine, { elements: [{ id: 'a' }, { id: 'b', isDeleted: true }], appState: {}, files: {} })
    expect(engine.exportToBlob.mock.calls[0][0].elements).toEqual([{ id: 'a' }])
    await expect(createComponentPreviewPng(engine, { elements: [{ id: 'b', isDeleted: true }], appState: {}, files: {} })).rejects.toThrow(/requires visible elements/)
  })

  it('an empty blob is a failure, not a picture', async () => {
    await expect(createComponentPreviewPng(engineWith(png(0)), { elements: [{ id: 'a' }], appState: {}, files: {} })).rejects.toThrow(/could not be drawn/)
  })
})

describe('blobToDataUrl', () => {
  it('round-trips the bytes with their own mime type', async () => {
    await expect(blobToDataUrl(new Blob(['hi'], { type: 'text/plain' }))).resolves.toBe(`data:text/plain;base64,${btoa('hi')}`)
  })
})
