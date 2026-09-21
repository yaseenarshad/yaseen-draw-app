import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIDEBAR_REVEAL_MS, flashTreeRows } from './revealRow'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView
})

const row = (path: string) => {
  const button = document.createElement('button')
  button.className = 'tree__row'
  button.dataset.path = path
  return button
}

describe('flashTreeRows (YAZ-1065)', () => {
  it('marks every exact-path occurrence, scrolls only the first, keeps focus, and clears at 3000 ms', () => {
    vi.useFakeTimers()
    const scroll = vi.fn()
    ;(HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView = scroll
    const focused = document.createElement('button')
    const host = document.createElement('div')
    const first = row('/v/Note.md')
    const other = row('/v/Other.md')
    const second = row('/v/Note.md')
    host.append(first, other, second)
    document.body.append(focused, host)
    focused.focus()

    const cleanup = flashTreeRows(host, '/v/Note.md')
    expect(cleanup).not.toBeNull()
    expect([first, other, second].map((item) => item.classList.contains('tree__row--revealed'))).toEqual([true, false, true])
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    expect(scroll.mock.contexts[0]).toBe(first)
    expect(document.activeElement).toBe(focused)

    vi.advanceTimersByTime(SIDEBAR_REVEAL_MS - 1)
    expect(first.classList.contains('tree__row--revealed')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(first.classList.contains('tree__row--revealed')).toBe(false)
    expect(second.classList.contains('tree__row--revealed')).toBe(false)
  })

  it('cleanup removes the class/timer, and a repeat starts a fresh full interval', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    const target = row('/v/Note.md')
    target.classList.add('tree__row--active')
    host.append(target)
    document.body.append(host)

    const firstCleanup = flashTreeRows(host, '/v/Note.md')
    vi.advanceTimersByTime(2000)
    firstCleanup?.()
    expect(target.classList.contains('tree__row--revealed')).toBe(false)

    const secondCleanup = flashTreeRows(host, '/v/Note.md')
    vi.advanceTimersByTime(SIDEBAR_REVEAL_MS - 1)
    expect(target.classList.contains('tree__row--revealed')).toBe(true)
    vi.advanceTimersByTime(1)
    expect(target.classList.contains('tree__row--revealed')).toBe(false)
    expect(target.classList.contains('tree__row--active')).toBe(true)
    secondCleanup?.()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns null and schedules nothing when the exact row is absent', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')
    host.append(row('/v/Other.md'))
    expect(flashTreeRows(host, '/v/Note.md')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
