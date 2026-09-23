import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const publish = vi.fn()
const get = vi.fn()
const status = vi.fn()
vi.mock('../api', () => ({ api: { share: { publish: (...a: unknown[]) => publish(...a), get: (...a: unknown[]) => get(...a), status: (...a: unknown[]) => status(...a) } } }))
const build = vi.fn()
vi.mock('./shareContent', () => ({ buildShareContent: (...a: unknown[]) => build(...a) }))

const { noteBoardSaved, isPending, resetLiveShareForTests, SETTLE_MS } = await import('./liveShare')

const ROOT = '/v'
const P = '/v/Board.excalidraw'
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('always-live share links (YAZ-1799 amendment)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    publish.mockReset().mockResolvedValue({})
    get.mockReset().mockResolvedValue({ id: 'abc' })
    status.mockReset().mockResolvedValue({ state: 'ready' })
    build.mockReset().mockImplementation(async () => ({ content: `v${build.mock.calls.length}`, bytes: 2, tooLarge: false }))
  })
  afterEach(() => {
    resetLiveShareForTests()
    vi.useRealTimers()
  })

  it('waits for the saves to settle: five quick saves are ONE upload, 10 s after the last', async () => {
    for (let i = 0; i < 5; i++) {
      noteBoardSaved(ROOT, P)
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(publish).not.toHaveBeenCalled()
    expect(isPending(P)).toBe(true)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith(ROOT, P, { flush: false })
    expect(isPending(P)).toBe(false)
  })

  it('never uploads a board that is not shared, or while sharing is not set up', async () => {
    get.mockResolvedValueOnce(null)
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    status.mockResolvedValueOnce({ state: 'off' })
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).not.toHaveBeenCalled()
  })

  it('one upload in flight; a save that lands mid-upload runs exactly one more after it (latest wins)', async () => {
    let finish!: () => void
    publish.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)))
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    noteBoardSaved(ROOT, P)
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1) // still in flight: queued, not doubled
    finish()
    await flush()
    await flush()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toMatchObject({ content: 'v2' })
  })

  it('a failed upload is swallowed here (main records it) and the next save tries again', async () => {
    publish.mockRejectedValueOnce(new Error('offline'))
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(2)
  })
})
