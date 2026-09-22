import { describe, expect, it, vi } from 'vitest'
import { applyToolbarMode, DESKTOP_UI_MODE_STORAGE_KEY, YASEEN_FULL_TOOLBAR_MODE } from './engine'

/** A stand-in for the engine's localStorage; the real one is jsdom's and shared between tests. */
function fakeStorage(initial: string | null = null) {
  const store = new Map<string, string>()
  if (initial !== null) store.set(DESKTOP_UI_MODE_STORAGE_KEY, initial)
  return {
    getItem: vi.fn((k: string) => store.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void store.set(k, v)),
    read: () => store.get(DESKTOP_UI_MODE_STORAGE_KEY) ?? null,
  }
}

describe('applyToolbarMode (⚡ YAZ-1775 R4/R5)', () => {
  it("writes `full` — the fork's ContextualPropertiesToolbar, NOT upstream's compact strip", () => {
    // The names read backwards; demo rounds 3-4 had them inverted. This is the correction.
    const storage = fakeStorage()
    applyToolbarMode(storage)
    expect(storage.read()).toBe(YASEEN_FULL_TOOLBAR_MODE)
    expect(storage.setItem).toHaveBeenCalledWith('excalidraw.desktopUIMode', 'full')
  })

  it('OVERWRITES a stray stored value — the guard this call exists for', () => {
    const storage = fakeStorage('compact')
    applyToolbarMode(storage)
    expect(storage.read()).toBe('full')
  })

  it('does not rewrite a value that is already right', () => {
    const storage = fakeStorage('full')
    applyToolbarMode(storage)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('a storage that is absent or throws is not an error — the engine falls back on its own', () => {
    expect(() => applyToolbarMode(null)).not.toThrow()
    expect(() =>
      applyToolbarMode({
        getItem: () => {
          throw new Error('denied')
        },
        setItem: () => undefined,
      }),
    ).not.toThrow()
  })
})
