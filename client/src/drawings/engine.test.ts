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

describe('YASEEN_FULL_TOOLBAR_MODE (⚡ R4/R5)', () => {
  it('is `full` — the fork`s ContextualPropertiesToolbar, NOT upstream`s compact strip', () => {
    // The names read backwards; rounds 3-4 had them inverted. This assertion is the correction.
    expect(YASEEN_FULL_TOOLBAR_MODE).toBe('full')
    expect(DESKTOP_UI_MODE_STORAGE_KEY).toBe('excalidraw.desktopUIMode')
  })
})

describe('applyToolbarMode', () => {
  it('writes the mode where the engine reads it', () => {
    const storage = fakeStorage()
    expect(applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE, storage)).toBe(true)
    expect(storage.read()).toBe('full')
  })

  it('OVERWRITES a stray stored value — the guard this call exists for', () => {
    const storage = fakeStorage('compact')
    applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE, storage)
    expect(storage.read()).toBe('full')
  })

  it('does not rewrite a value that is already right', () => {
    const storage = fakeStorage('full')
    expect(applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE, storage)).toBe(true)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('a storage that is absent or throws is not an error — the engine falls back on its own', () => {
    expect(applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE, null)).toBe(false)
    const throwing = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => undefined,
    }
    expect(applyToolbarMode(YASEEN_FULL_TOOLBAR_MODE, throwing)).toBe(false)
  })
})
