import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileResponse, WatchEvent } from '@shared/types'
import { BridgeRequestError, api } from '../api'
import type { WatchListener, WatchSource } from '../hooks/useWatch'
import { TextViewer } from './TextViewer'
import viewerCss from './viewers.css?inline'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn() },
}))

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/data.JSON'
let root: Root | null = null
let container: HTMLElement | null = null
let listeners: WatchListener[] = []
const watch: WatchSource = {
  subscribe: (listener) => {
    listeners.push(listener)
    return () => {
      listeners = listeners.filter((candidate) => candidate !== listener)
    }
  },
}

const response = (content: string, mtime = 1): FileResponse => ({
  path: PATH,
  content,
  mtime,
  size: new TextEncoder().encode(content).byteLength,
})

function mount(): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<TextViewer path={PATH} watch={watch} />))
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

function emit(ev: WatchEvent): void {
  act(() => listeners.forEach((listener) => listener(ev)))
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  listeners = []
  vi.resetAllMocks()
})

describe('TextViewer (YAZ-1299)', () => {
  it('scopes exact text presentation and two-axis overflow to the viewer', () => {
    expect(viewerCss).toMatch(/\.text-viewer\s*\{[^}]*display:\s*flex[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s)
    expect(viewerCss).toMatch(/\.text-viewer__scroll\s*\{[^}]*min-width:\s*0[^}]*min-height:\s*0[^}]*overflow-x:\s*auto[^}]*overflow-y:\s*auto/s)
    expect(viewerCss).toMatch(/\.text-viewer__content\s*\{[^}]*width:\s*max-content[^}]*min-width:\s*100%[^}]*font-family:\s*ui-monospace[^}]*white-space:\s*pre[^}]*user-select:\s*text/s)
  })

  it('shows an immediate loading state, then exact selectable read-only text and concise chrome', async () => {
    const content = '  first  \r\n\tsecond\r\nconst long = "' + 'x'.repeat(200) + '";\r\n'
    let resolve!: (file: FileResponse) => void
    readFile.mockReturnValueOnce(new Promise<FileResponse>((done) => (resolve = done)))
    const el = mount()

    expect(el.querySelector('.editor-msg')?.textContent).toBe('Loading…')
    expect(el.querySelector('.text-viewer__content')).toBeNull()

    resolve(response(content))
    await flush()
    const pre = el.querySelector<HTMLElement>('.text-viewer__content')
    expect(pre?.textContent).toBe(content)
    expect(pre?.getAttribute('role')).toBe('textbox')
    expect(pre?.getAttribute('aria-readonly')).toBe('true')
    expect(pre?.getAttribute('aria-multiline')).toBe('true')
    expect(pre?.getAttribute('contenteditable')).toBeNull()
    expect(pre?.tabIndex).toBe(0)
    expect(el.querySelector('.text-viewer__badge')?.textContent).toBe('Read only')
    expect(el.querySelector('.text-viewer__name')?.textContent).toBe('data.JSON')
    expect(el.querySelector('textarea, input, button')).toBeNull()

    const selection = window.getSelection()
    selection?.selectAllChildren(pre!)
    expect(selection?.toString()).toBe(content)
    selection?.removeAllRanges()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('shows bridge failures passively without mounting a fake document', async () => {
    readFile.mockRejectedValueOnce(new BridgeRequestError('FORBIDDEN', 'permission denied'))
    const el = mount()
    await flush()

    const error = el.querySelector('.text-viewer__error')
    expect(error?.getAttribute('role')).toBe('status')
    expect(error?.textContent).toBe('FORBIDDEN: permission denied')
    expect(el.querySelector('.text-viewer__content')).toBeNull()
  })

  it('reloads only for a matching change and keeps the previous content visible while the read is pending', async () => {
    const first = response('old\r\ncontent\r\n', 1)
    let resolveReload!: (file: FileResponse) => void
    readFile.mockResolvedValueOnce(first).mockReturnValueOnce(new Promise<FileResponse>((done) => (resolveReload = done)))
    const el = mount()
    await flush()

    emit({ type: 'change', path: '/vault/other.json', mtime: 2 })
    emit({ type: 'add', path: PATH, mtime: 2 })
    expect(readFile).toHaveBeenCalledTimes(1)

    emit({ type: 'change', path: PATH, mtime: 2 })
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(el.querySelector('.text-viewer')?.getAttribute('aria-busy')).toBe('true')
    expect(el.querySelector('.text-viewer__content')?.textContent).toBe(first.content)

    const next = response('new\r\ncontent\r\n', 2)
    resolveReload(next)
    await flush()
    expect(el.querySelector('.text-viewer')?.getAttribute('aria-busy')).toBe('false')
    expect(el.querySelector('.text-viewer__content')?.textContent).toBe(next.content)
  })

  it('keeps the last readable content under a passive reload error', async () => {
    const first = response('keep me\r\n', 1)
    readFile.mockResolvedValueOnce(first).mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'file changed while being read; try again'))
    const el = mount()
    await flush()

    emit({ type: 'change', path: PATH, mtime: 2 })
    await flush()

    expect(el.querySelector('.text-viewer__content')?.textContent).toBe(first.content)
    expect(el.querySelector('.text-viewer__error')?.textContent).toBe('IO_ERROR: file changed while being read; try again')
  })
})
