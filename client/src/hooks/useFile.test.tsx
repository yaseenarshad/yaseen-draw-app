import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse } from '@shared/types'
import { useFile, type FileState } from './useFile'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

import { api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null
let state: FileState = { status: 'idle' }

function Probe({ path, revision = 0 }: { path: string | null; revision?: number }) {
  state = useFile(path, revision)
  return null
}

function render(path: string | null, revision = 0): void {
  if (root === null) {
    container = document.createElement('div')
    root = createRoot(container)
  }
  act(() => root?.render(<Probe path={path} revision={revision} />))
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

const response = (path: string, content: string, mtime = 1): FileResponse => ({ path, content, mtime, size: new TextEncoder().encode(content).byteLength })

beforeEach(() => {
  writeFile.mockResolvedValue({ path: '/vault/note.excalidraw', mtime: 2, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container = null
  state = { status: 'idle' }
  vi.restoreAllMocks()
})

describe('useFile reloadable read state (YAZ-1299)', () => {
  it('does no work for a null path', async () => {
    render(null)
    await flush()
    expect(state).toEqual({ status: 'idle' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('hands the bytes through byte-for-byte, transforming nothing and writing nothing on a read', async () => {
    const path = '/vault/Scene.excalidraw'
    const file = response(path, '{\r\n  "type": "excalidraw",\r\n  "elements": []\r\n}\r\n')
    readFile.mockResolvedValueOnce(file)

    render(path)
    await flush()

    expect(state).toEqual({ status: 'ready', path, file })
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a revision reload keeps the current file as prev until the replacement resolves', async () => {
    const path = '/vault/Scene.excalidraw'
    const first = response(path, 'old\r\ncontent\r\n', 1)
    let resolveReload!: (file: FileResponse) => void
    readFile.mockResolvedValueOnce(first).mockReturnValueOnce(new Promise<FileResponse>((resolve) => (resolveReload = resolve)))
    render(path)
    await flush()

    render(path, 1)
    expect(state).toEqual({ status: 'loading', path, prev: first })
    expect(readFile).toHaveBeenCalledTimes(2)

    const next = response(path, 'new\r\ncontent\r\n', 2)
    resolveReload(next)
    await flush()
    expect(state).toEqual({ status: 'ready', path, file: next })
  })

  it('a failed same-path reload reports the error while retaining the last readable snapshot', async () => {
    const path = '/vault/Scene.excalidraw'
    const first = response(path, 'still visible', 1)
    readFile.mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('gone'))
    render(path)
    await flush()

    render(path, 1)
    await flush()

    expect(state).toEqual({ status: 'error', path, message: 'Failed to load file', prev: first })
  })

  it('a retry after a reload error still retains the last readable snapshot', async () => {
    const path = '/vault/Scene.excalidraw'
    const first = response(path, 'still visible', 1)
    let resolveRetry!: (file: FileResponse) => void
    readFile
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error('gone'))
      .mockReturnValueOnce(new Promise<FileResponse>((resolve) => (resolveRetry = resolve)))
    render(path)
    await flush()
    render(path, 1)
    await flush()

    render(path, 2)
    expect(state).toEqual({ status: 'loading', path, prev: first })

    const recovered = response(path, 'back', 3)
    resolveRetry(recovered)
    await flush()
    expect(state).toEqual({ status: 'ready', path, file: recovered })
  })
})
