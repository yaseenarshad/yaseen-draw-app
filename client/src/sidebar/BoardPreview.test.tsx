/** Where the hover preview panel goes (YAZ-1800): a pure rule of the sidebar's right edge and the window. */
import { describe, expect, it } from 'vitest'
import { boardPreviewPlacement } from './BoardPreview'

describe('boardPreviewPlacement', () => {
  it('sits a gap right of the sidebar, a little over half the room wide, vertically centred', () => {
    // usable = 1440 - 260 - 16 = 1164 → width 669; height = min(630, max(220, 455)) = 455.
    expect(boardPreviewPlacement(260, 1440, 900)).toEqual({ left: 276, top: 223, width: 669, height: 455 })
  })

  it('never gets shorter than 220 px, nor taller than 70% of the window', () => {
    // usable = 600 - 260 - 16 = 324 → width 186; height = min(350, max(220, 126)) = 220.
    expect(boardPreviewPlacement(260, 600, 500)).toEqual({ left: 276, top: 140, width: 186, height: 220 })
    // A short window: height = min(round(300 * 0.7), …) = 210, top clamps to the gap.
    expect(boardPreviewPlacement(260, 1440, 300)).toMatchObject({ height: 210, top: 45 })
  })

  it('renders nothing when the window leaves no room beside the sidebar', () => {
    expect(boardPreviewPlacement(260, 280, 800)).toBeNull()
  })
})
