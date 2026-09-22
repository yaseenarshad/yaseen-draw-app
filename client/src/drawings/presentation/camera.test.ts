import { describe, expect, it } from 'vitest'
import { getPresentationViewportOffsets, PRESENTATION_CAMERA_RESERVE } from './camera'

describe('getPresentationViewportOffsets', () => {
  it('reserves the web app\'s fraction of the CANVAS PANE on the right, rounded to a pixel', () => {
    expect(getPresentationViewportOffsets(1000)).toEqual({ ui: true, right: 320 })
    expect(getPresentationViewportOffsets(999)).toEqual({ ui: true, right: Math.round(999 * PRESENTATION_CAMERA_RESERVE) })
  })

  it('keeps the measured UI insets on the other three sides', () => {
    expect(getPresentationViewportOffsets(800).ui).toBe(true)
  })

  it('never reserves a negative strip — a pane measured before layout reports 0 or less', () => {
    expect(getPresentationViewportOffsets(0).right).toBe(0)
    expect(getPresentationViewportOffsets(-50).right).toBe(0)
  })
})
