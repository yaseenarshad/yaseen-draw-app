/**
 * The rail (🔒 D10) and the tiny store behind it. The store is the interesting half: it exists so
 * `renderTopLeftUI` never changes identity (the #185 rule in `ExcalidrawSurface.tsx`), which means
 * a re-render here must never be a re-render of the engine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createLauncherStore, LauncherRail, type LauncherActions, type LauncherState } from './LauncherRail'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const actions = (): LauncherActions & { [K in keyof LauncherActions]: ReturnType<typeof vi.fn> } => ({
  togglePanel: vi.fn(),
  openTab: vi.fn(),
  toggleWriting: vi.fn(),
  toggleFrames: vi.fn(),
})

const initial: LauncherState = { ready: true, activeTab: null, writingMode: false, framesVisible: true }

describe('createLauncherStore', () => {
  it('notifies only when a value actually moved', () => {
    const store = createLauncherStore(actions(), initial)
    const listener = vi.fn()
    store.subscribe(listener)
    store.set({ writingMode: false }) // same value
    store.set({})
    expect(listener).not.toHaveBeenCalled()
    store.set({ writingMode: true })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getState().writingMode).toBe(true)
  })

  it('hands back a NEW state object so `useSyncExternalStore` sees the change', () => {
    const store = createLauncherStore(actions(), initial)
    const before = store.getState()
    store.set({ activeTab: 'components' })
    expect(store.getState()).not.toBe(before)
    expect(before.activeTab).toBeNull()
  })

  it('returns an unsubscribe', () => {
    const store = createLauncherStore(actions(), initial)
    const listener = vi.fn()
    store.subscribe(listener)()
    store.set({ ready: false })
    expect(listener).not.toHaveBeenCalled()
  })
})

let root: Root | null = null
let container: HTMLElement
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
})

function render(state: Partial<LauncherState> = {}) {
  const acts = actions()
  const store = createLauncherStore(acts, { ...initial, ...state })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => root?.render(<LauncherRail store={store} />))
  const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  return { acts, store, button }
}

describe('LauncherRail', () => {
  it('is the hamburger plus the two toggles, and NOTHING else (🔒 D10: the tabs are the panel`s own strip)', () => {
    const { container: _c, button } = { ...render(), container }
    expect(container.querySelectorAll('button')).toHaveLength(3)
    expect(button('Open workspace panel')).not.toBeNull()
    expect(button('Writing mode')).not.toBeNull()
    expect(button('Show frames')).not.toBeNull()
  })

  it('the hamburger says open or close depending on the panel, and toggles it', () => {
    const { acts, store, button } = render()
    expect(button('Open workspace panel')?.getAttribute('aria-pressed')).toBe('false')
    act(() => button('Open workspace panel')?.click())
    expect(acts.togglePanel).toHaveBeenCalledTimes(1)
    act(() => store.set({ activeTab: 'image-studio' }))
    // Still there while the panel is open: it is the other way to close it.
    expect(button('Close workspace panel')?.getAttribute('aria-pressed')).toBe('true')
  })

  it('the two toggles report their state and their tooltip says which way it is', () => {
    const { acts, store, button } = render({ writingMode: true, framesVisible: false })
    expect(button('Writing mode')?.getAttribute('aria-pressed')).toBe('true')
    expect(button('Writing mode')?.title).toBe('Writing: on')
    expect(button('Show frames')?.getAttribute('aria-pressed')).toBe('false')
    expect(button('Show frames')?.title).toBe('Frames: hidden')
    act(() => button('Writing mode')?.click())
    act(() => button('Show frames')?.click())
    expect(acts.toggleWriting).toHaveBeenCalledTimes(1)
    expect(acts.toggleFrames).toHaveBeenCalledTimes(1)
    // The value comes back down through the store, never from the click (🔒 D9's round trip).
    act(() => store.set({ writingMode: false }))
    expect(button('Writing mode')?.title).toBe('Writing: off')
  })

  it('everything is disabled until the engine has handed its API over', () => {
    const { button } = render({ ready: false })
    for (const label of ['Open workspace panel', 'Writing mode', 'Show frames']) expect(button(label)?.disabled, label).toBe(true)
  })
})
