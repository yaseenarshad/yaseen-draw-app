import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PageContextMenu } from './PageContextMenu'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

it('exports reusable page actions through PageContextMenu', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onOpenRight = vi.fn()
  const onOpenBackground = vi.fn()
  const onClose = vi.fn()

  act(() => {
    root.render(
      <PageContextMenu
        x={12}
        y={34}
        path="/vault/note.md"
        onOpenRight={onOpenRight}
        onOpenBackground={onOpenBackground}
        onClose={onClose}
      />,
    )
  })

  // The right panel is the odd one out, so it goes LAST (YAZ-1556).
  expect([...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
    'Open in new tab',
    'Copy path',
    'Reveal in Finder',
    'Open in right panel',
  ])
  act(() => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Open in right panel')?.click())
  expect(onOpenRight).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onOpenBackground).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledOnce()

  act(() => {
    root.render(
      <PageContextMenu x={12} y={34} path="/vault/note.md" onOpenBackground={onOpenBackground} onClose={onClose} />,
    )
  })
  expect([...host.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
    'Open in new tab',
    'Copy path',
    'Reveal in Finder',
  ])
  act(() => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click())
  expect(onOpenBackground).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
  expect(onClose).toHaveBeenCalledTimes(2)

  act(() => root.unmount())
  host.remove()
})

it('reports a clipboard rejection passively without leaving an unhandled promise', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  const writeText = vi.fn().mockRejectedValue(new Error('clipboard permission denied'))
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const onNotice = vi.fn()
  const onClose = vi.fn()

  try {
    act(() => {
      root.render(<PageContextMenu x={12} y={34} path="/vault/note.md" onNotice={onNotice} onClose={onClose} />)
    })
    const copy = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((item) => item.textContent === 'Copy path')
    act(() => copy?.click())
    await act(async () => Promise.resolve())

    expect(writeText).toHaveBeenCalledExactlyOnceWith('/vault/note.md')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy path: clipboard permission denied")
  } finally {
    act(() => root.unmount())
    host.remove()
    if (descriptor === undefined) delete (navigator as unknown as Record<string, unknown>).clipboard
    else Object.defineProperty(navigator, 'clipboard', descriptor)
  }
})
