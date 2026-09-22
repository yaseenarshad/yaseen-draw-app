/**
 * A board's hover picture (YAZ-1800): the key, and the draw behind it — the engine and the bridge
 * stubbed, so this pins what they are ASKED for and what an empty board answers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@shared/treeSort'

const engine = vi.hoisted(() => ({
  restoreElements: vi.fn((elements: unknown) => elements),
  exportToBlob: vi.fn(async () => new Blob([new Uint8Array(8)], { type: 'image/png' })),
}))
vi.mock('../drawings/engine', () => ({ loadExcalidraw: async () => engine }))

const { BOARD_PREVIEW_BOUNDS, boardPreviewKey, boardPreviews } = await import('./boardPreviewCache')

const board = (over: Partial<FileNode> = {}): FileNode => ({ type: 'file', name: 'a.excalidraw', path: '/v/a:b.excalidraw', size: 1, mtime: 5, kind: 'drawing', ...over })

function installLoad(json: string, files: Record<string, { mimeType: string; dataURL: string }> = {}) {
  const load = vi.fn(async (req: { root: string; path: string }) => ({ path: req.path, json, mtime: 1, size: 1, files, stored: [] }))
  Object.defineProperty(window, 'yaseenDraw', { value: { drawing: { load } }, configurable: true, writable: true })
  return load
}

afterEach(() => {
  boardPreviews.clear()
  engine.exportToBlob.mockClear()
})

describe('boardPreviewKey', () => {
  it('is root, path, mtime and theme — newline-joined, so a `:` in the path is fine', () => {
    expect(boardPreviewKey('/v', board(), 'dark')).toBe('/v\n/v/a:b.excalidraw\n5\ndark')
  })

  it('moves with the mtime, not the block: a write that leaves updatedAt alone is still a new picture (🔒 D1 amendment)', () => {
    const meta = { createdAt: 1, updatedAt: 9 }
    expect(boardPreviewKey('/v', board({ meta, mtime: 5 }), 'light')).not.toBe(boardPreviewKey('/v', board({ meta, mtime: 6 }), 'light'))
  })
})

describe('boardPreviews', () => {
  it('reads the board, draws it in the key`s theme and the board bounds, with its images', async () => {
    const load = installLoad(JSON.stringify({ elements: [{ id: 'r' }], appState: { viewBackgroundColor: '#fafafa' } }), { img: { mimeType: 'image/png', dataURL: 'data:image/png;base64,AA' } })
    const dataURL = await boardPreviews.load(boardPreviewKey('/v', board(), 'dark'))
    expect(dataURL?.startsWith('data:image/png;base64,')).toBe(true)
    expect(load).toHaveBeenCalledWith({ root: '/v', path: '/v/a:b.excalidraw' })
    const call = (engine.exportToBlob.mock.calls[0] as unknown as [Record<string, never>])[0] as Record<string, unknown>
    expect(call.exportPadding).toBe(BOARD_PREVIEW_BOUNDS.padding)
    expect(call.appState).toMatchObject({ viewBackgroundColor: '#fafafa', theme: 'dark', exportWithDarkMode: true })
    expect(call.files).toMatchObject({ img: { id: 'img', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA' } })
  })

  it('an empty board is the empty string, not a failure — and nothing is drawn', async () => {
    installLoad(JSON.stringify({ elements: [{ id: 'gone', isDeleted: true }] }))
    await expect(boardPreviews.load(boardPreviewKey('/v', board(), 'light'))).resolves.toBe('')
    expect(engine.exportToBlob).not.toHaveBeenCalled()
  })

  it('a board that is not a scene is null', async () => {
    installLoad('not json')
    await expect(boardPreviews.load(boardPreviewKey('/v', board(), 'light'))).resolves.toBeNull()
  })
})
