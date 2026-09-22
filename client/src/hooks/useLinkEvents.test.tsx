/**
 * useLinkEvents (E1, GRO-2171): the renderer's half of the yaseendraw:// deep-link pushes —
 * subscribed on mount, unsubscribed on unmount, latest callbacks win.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useLinkEvents } from './useLinkEvents'


function installBridge() {
  const openFileListeners = new Set<(path: string) => void>()
  const noticeListeners = new Set<(message: string) => void>()
  const bridge = {
    link: {
      onOpenFile: vi.fn((l: (path: string) => void) => {
        openFileListeners.add(l)
        return () => openFileListeners.delete(l)
      }),
      onNotice: vi.fn((l: (message: string) => void) => {
        noticeListeners.add(l)
        return () => noticeListeners.delete(l)
      }),
    },
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return {
    emitOpenFile: (path: string) => openFileListeners.forEach((l) => l(path)),
    emitNotice: (message: string) => noticeListeners.forEach((l) => l(message)),
    count: () => openFileListeners.size + noticeListeners.size,
  }
}

function Probe({ onOpenFile, onNotice }: { onOpenFile: (path: string) => void; onNotice: (message: string) => void }) {
  useLinkEvents({ onOpenFile, onNotice })
  return null
}

let root: Root | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  delete (window as unknown as Record<string, unknown>).yaseenDraw
})

describe('useLinkEvents', () => {
  it('routes link events to the callbacks and unsubscribes on unmount', () => {
    const b = installBridge()
    const onOpenFile = vi.fn()
    const onNotice = vi.fn()
    root = createRoot(document.createElement('div'))
    act(() => root?.render(<Probe onOpenFile={onOpenFile} onNotice={onNotice} />))

    act(() => b.emitOpenFile('/vaults/notes/a.md'))
    expect(onOpenFile).toHaveBeenCalledWith('/vaults/notes/a.md')
    act(() => b.emitNotice("Can't open link"))
    expect(onNotice).toHaveBeenCalledWith("Can't open link")

    act(() => root?.unmount())
    root = null
    expect(b.count()).toBe(0)
  })
})
