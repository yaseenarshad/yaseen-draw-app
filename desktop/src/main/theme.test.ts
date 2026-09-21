import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, defaultAppState } from '@shared/types'
import { createStore } from './store'
import { WINDOW_BG, subscribeNativeTheme, windowBackgroundColor } from './theme'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'yd-theme-'))
  file = path.join(dir, 'yaseendraw.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('windowBackgroundColor (Desktop K, GRO-2218)', () => {
  it('explicit values win; system follows the OS appearance', () => {
    expect(windowBackgroundColor('light', true)).toBe('#ffffff')
    expect(windowBackgroundColor('dark', false)).toBe('#1e1e1e')
    expect(windowBackgroundColor('system', true)).toBe('#1e1e1e')
    expect(windowBackgroundColor('system', false)).toBe('#ffffff')
  })
})

describe('WINDOW_BG mirrors client/src/app.css --bg (the "change one, change both" rule)', () => {
  it('light and dark backing colours equal the palette the renderer paints', async () => {
    const css = await readFile(fileURLToPath(new URL('../../../client/src/app.css', import.meta.url)), 'utf8')
    const bgOf = (block: string): string => {
      const m = /--bg:\s*(#[0-9a-fA-F]{3,8})\s*;/.exec(block)
      if (m === null) throw new Error('no --bg token found in the CSS block')
      return m[1]
    }
    const darkStart = css.indexOf("[data-theme='dark']")
    expect(darkStart).toBeGreaterThan(-1) // the dark token block exists
    expect(WINDOW_BG.light).toBe(bgOf(css.slice(0, darkStart)))
    expect(WINDOW_BG.dark).toBe(bgOf(css.slice(darkStart)))
  })
})

describe('subscribeNativeTheme', () => {
  it('applies the LOADED theme at once — before any window exists', async () => {
    const seeded = defaultAppState()
    seeded.settings = { ...DEFAULT_SETTINGS, theme: 'dark' }
    await writeFile(file, JSON.stringify(seeded))
    const apply = vi.fn()
    subscribeNativeTheme(createStore(file), apply)
    expect(apply).toHaveBeenCalledExactlyOnceWith('dark')
  })

  it('re-applies only when the theme actually changed, not on other writes', () => {
    const store = createStore(file)
    const apply = vi.fn()
    subscribeNativeTheme(store, apply)
    expect(apply).toHaveBeenCalledExactlyOnceWith('system')

    store.setSidebarWidth(321) // unrelated write
    store.setSettings({ ...DEFAULT_SETTINGS, lineSpacing: 2 }) // settings write, same theme
    expect(apply).toHaveBeenCalledTimes(1)

    store.setSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
    expect(apply).toHaveBeenCalledTimes(2)
    expect(apply).toHaveBeenLastCalledWith('dark')

    store.setSettings({ ...DEFAULT_SETTINGS, theme: 'system' })
    expect(apply).toHaveBeenLastCalledWith('system')
  })

  it('the unsubscribe stops further applies', () => {
    const store = createStore(file)
    const apply = vi.fn()
    const off = subscribeNativeTheme(store, apply)
    off()
    store.setSettings({ ...DEFAULT_SETTINGS, theme: 'light' })
    expect(apply).toHaveBeenCalledTimes(1)
  })
})
