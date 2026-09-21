import { afterEach, describe, expect, it } from 'vitest'
import frameDark from '@milkdown/crepe/theme/frame-dark.css?inline'
import frameLight from '@milkdown/crepe/theme/frame.css?inline'
import { CREPE_THEME_STYLE_ID, applyCrepeTheme } from './crepeTheme'

const styleEl = () => document.getElementById(CREPE_THEME_STYLE_ID)

afterEach(() => styleEl()?.remove())

describe('applyCrepeTheme (Desktop K, GRO-2218)', () => {
  it('creates one managed <style> in head and fills it with the light frame theme', () => {
    applyCrepeTheme('light')
    const el = styleEl()
    expect(el?.parentElement).toBe(document.head)
    expect(el?.textContent).toBe(frameLight)
  })

  it('swaps to the dark frame vars in place — same element, no second style tag', () => {
    applyCrepeTheme('light')
    const el = styleEl()
    applyCrepeTheme('dark')
    expect(styleEl()).toBe(el)
    expect(el?.textContent).toBe(frameDark)
    expect(document.querySelectorAll(`#${CREPE_THEME_STYLE_ID}`)).toHaveLength(1)
  })

  it('the bundled themes are the real Crepe var blocks, and they differ', () => {
    // `?inline` must deliver the actual CSS (not an empty stub) for the swap to restyle anything.
    expect(frameLight).toContain('--crepe-color-background')
    expect(frameDark).toContain('--crepe-color-background')
    expect(frameLight).not.toBe(frameDark)
  })
})
