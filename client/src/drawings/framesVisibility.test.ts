import { describe, expect, it, vi } from 'vitest'
import { applyFramesVisibility } from './framesVisibility'

describe('applyFramesVisibility (the web app`s rule)', () => {
  it('moves outline and name together and touches NOTHING else', () => {
    const api = { updateFrameRendering: vi.fn() }
    applyFramesVisibility(api, false)
    expect(api.updateFrameRendering).toHaveBeenCalledExactlyOnceWith({ outline: false, name: false })
    // `clip` and `enabled` are never sent: turning `enabled` off would stop frames clipping
    // their children, which changes the drawing rather than the editor.
    const [sent] = api.updateFrameRendering.mock.calls[0] as [Record<string, unknown>]
    expect(Object.keys(sent).sort()).toEqual(['name', 'outline'])
  })

  it('shows them again', () => {
    const api = { updateFrameRendering: vi.fn() }
    applyFramesVisibility(api, true)
    expect(api.updateFrameRendering).toHaveBeenCalledExactlyOnceWith({ outline: true, name: true })
  })
})
