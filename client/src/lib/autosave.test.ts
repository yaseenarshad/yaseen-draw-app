import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Autosave, SaveConflict, type SaveStatus } from './autosave'

function setup(saveImpl?: (content: string, expectedMtime: number) => Promise<{ mtime: number }>) {
  const statuses: SaveStatus[] = []
  const conflicts: number[] = []
  const save = vi.fn(saveImpl ?? (async () => ({ mtime: 200 })))
  const a = new Autosave({
    markdown: 'base\n',
    mtime: 100,
    save,
    onStatus: (s) => statuses.push(s),
    onConflict: (m) => conflicts.push(m),
    delayMs: 500,
  })
  return { a, save, statuses, conflicts }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Autosave', () => {
  it('does not save content equal to the baseline (normalised rewrite of an untouched file)', async () => {
    const { a, save, statuses } = setup()
    a.update('base\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(statuses).toEqual([])
    expect(a.dirty).toBe(false)
  })

  it('debounces: saves once, 500ms after the last update, with expectedMtime', async () => {
    const { a, save, statuses } = setup()
    a.update('a')
    await vi.advanceTimersByTimeAsync(300)
    a.update('ab')
    await vi.advanceTimersByTimeAsync(300)
    expect(save).not.toHaveBeenCalled()
    expect(a.dirty).toBe(true)
    await vi.advanceTimersByTimeAsync(200)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('ab', 100)
    expect(a.mtime).toBe(200)
    expect(a.dirty).toBe(false)
    expect(statuses).toEqual(['unsaved', 'saving', 'saved'])
  })

  it('reverting to the baseline cancels the pending save', async () => {
    const { a, save, statuses } = setup()
    a.update('a')
    a.update('base\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
    expect(statuses).toEqual(['unsaved', 'saved'])
  })

  it('flush saves immediately and subsequent mtime is used for the next save', async () => {
    let n = 0
    const { a, save } = setup(async () => ({ mtime: 200 + ++n }))
    a.update('a')
    await a.flush()
    expect(save).toHaveBeenCalledWith('a', 100)
    a.update('b')
    await a.flush()
    expect(save).toHaveBeenLastCalledWith('b', 201)
    expect(a.mtime).toBe(202)
  })

  it('an update during an in-flight save stays dirty and is saved afterwards', async () => {
    let resolve!: (v: { mtime: number }) => void
    const { a, save, statuses } = setup(() => new Promise((r) => (resolve = r)))
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(1)
    a.update('ab')
    resolve({ mtime: 200 })
    await vi.advanceTimersByTimeAsync(0)
    expect(a.dirty).toBe(true)
    expect(statuses).toEqual(['unsaved', 'saving', 'unsaved'])
  })

  it('settled() resolves after the in-flight save so its mtime can be used for echo suppression', async () => {
    let resolve!: (v: { mtime: number }) => void
    const { a } = setup(() => new Promise((r) => (resolve = r)))
    await a.settled() // nothing in flight: resolves immediately
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(a.dirty).toBe(true)
    let settledMtime: number | null = null
    const waiting = a.settled().then(() => (settledMtime = a.mtime))
    expect(settledMtime).toBeNull()
    resolve({ mtime: 200 })
    await waiting
    expect(settledMtime).toBe(200)
    expect(a.dirty).toBe(false)
  })

  it('CONFLICT reports a conflict, pauses saving, and adopt() overwrites with the disk mtime', async () => {
    const responses: Array<() => Promise<{ mtime: number }>> = [
      () => Promise.reject(new SaveConflict(150)),
      () => Promise.resolve({ mtime: 300 }),
    ]
    const { a, save, statuses, conflicts } = setup(() => responses.shift()!())
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(conflicts).toEqual([150])
    expect(statuses).toEqual(['unsaved', 'saving', 'unsaved'])
    expect(a.dirty).toBe(true)
    a.update('ab')
    await vi.advanceTimersByTimeAsync(2000)
    expect(save).toHaveBeenCalledTimes(1)
    await a.adopt(150)
    expect(save).toHaveBeenLastCalledWith('ab', 150)
    expect(a.mtime).toBe(300)
    expect(a.dirty).toBe(false)
  })

  it('reset() after a reload clears pending content and the conflict block', async () => {
    const { a, save } = setup(() => Promise.reject(new SaveConflict(150)))
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    a.reset('disk\n', 150)
    expect(a.dirty).toBe(false)
    a.update('disk\n')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a non-conflict failure keeps content pending and reports error; next update retries', async () => {
    const responses: Array<() => Promise<{ mtime: number }>> = [
      () => Promise.reject(new Error('boom')),
      () => Promise.resolve({ mtime: 300 }),
    ]
    const { a, save, statuses } = setup(() => responses.shift()!())
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(statuses).toEqual(['unsaved', 'saving', 'error'])
    expect(a.dirty).toBe(true)
    a.update('a')
    await vi.advanceTimersByTimeAsync(500)
    expect(save).toHaveBeenCalledTimes(2)
    expect(statuses.at(-1)).toBe('saved')
  })

  it('dispose() ignores further updates', async () => {
    const { a, save } = setup()
    a.dispose()
    a.update('a')
    await vi.advanceTimersByTimeAsync(1000)
    expect(save).not.toHaveBeenCalled()
  })
})
