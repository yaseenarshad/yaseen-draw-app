import { describe, expect, it } from 'vitest'
import { isPhoneSized, MQ_MAX_HEIGHT_LANDSCAPE, MQ_MAX_MOBILE, MQ_MAX_WIDTH_LANDSCAPE, yaseenFormFactor } from './formFactor'

describe('isPhoneSized (the engine`s own isMobileBreakpoint)', () => {
  it('is true at or below the mobile width, whatever the height', () => {
    expect(isPhoneSized(MQ_MAX_MOBILE, 900)).toBe(true)
    expect(isPhoneSized(MQ_MAX_MOBILE + 1, 900)).toBe(false)
  })

  it('is true for a landscape sliver: shorter than the landscape height AND narrower than its width', () => {
    expect(isPhoneSized(900, MQ_MAX_HEIGHT_LANDSCAPE - 1)).toBe(true)
    expect(isPhoneSized(900, MQ_MAX_HEIGHT_LANDSCAPE)).toBe(false)
    expect(isPhoneSized(MQ_MAX_WIDTH_LANDSCAPE, MQ_MAX_HEIGHT_LANDSCAPE - 1)).toBe(false)
  })
})

describe('yaseenFormFactor (⚡ YAZ-1775 R5)', () => {
  it('NEVER answers tablet — the whole reason this override exists', () => {
    // Every one of these sits inside the engine's ≤1180px tablet band, which is what a canvas
    // pane beside the open shell sidebar looks like.
    for (const [w, h] of [
      [1180, 800],
      [1000, 900],
      [900, 1100],
      [700, 1000],
      [1180, 1180],
    ]) {
      expect(yaseenFormFactor(w, h), `${w}x${h}`).toBe('desktop')
    }
  })

  it('answers desktop for a full window and for a sidebar-narrowed pane alike', () => {
    expect(yaseenFormFactor(1440, 900)).toBe('desktop')
    expect(yaseenFormFactor(1440 - 260, 900)).toBe('desktop')
  })

  it('still answers phone where the engine would — the one form factor we defer on', () => {
    expect(yaseenFormFactor(390, 844)).toBe('phone')
    expect(yaseenFormFactor(844, 390)).toBe('phone')
  })
})
