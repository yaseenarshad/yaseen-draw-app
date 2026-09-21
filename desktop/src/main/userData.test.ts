import { describe, expect, it, vi } from 'vitest'
import { applyUserDataOverride } from './userData'

describe('applyUserDataOverride', () => {
  it('does nothing when the override is absent or blank', () => {
    const app = { setPath: vi.fn() }
    applyUserDataOverride(app, undefined)
    applyUserDataOverride(app, '   ')
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('sets only the userData path when an override is present', () => {
    const app = { setPath: vi.fn() }
    applyUserDataOverride(app, '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile')
    expect(app.setPath).toHaveBeenCalledExactlyOnceWith(
      'userData',
      '/Users/yasin/Desktop/YAZ-966-right-panel-demo-profile',
    )
  })
})
