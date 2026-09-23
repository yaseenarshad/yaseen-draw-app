import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const publish = vi.fn()
const get = vi.fn()
vi.mock('../api', () => ({ api: { share: { publish: (...a: unknown[]) => publish(...a), get: (...a: unknown[]) => get(...a) } } }))
const build = vi.fn()
vi.mock('./shareContent', () => ({ buildShareContent: (...a: unknown[]) => build(...a) }))

const { noteBoardSaved, noteBoardRenamed, isPending, resetLiveShareForTests, SETTLE_MS } = await import('./liveShare')

const ROOT = '/v'
const P = '/v/Board.excalidraw'
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('always-live share links (YAZ-1799 D3, YAZ-1886)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    publish.mockReset().mockResolvedValue({})
    get.mockReset().mockResolvedValue({ id: 'abc' })
    build.mockReset().mockImplementation(async () => `v${build.mock.calls.length}`)
  })
  afterEach(() => {
    resetLiveShareForTests()
    vi.useRealTimers()
  })

  it('waits for the saves to settle: three quick saves are ONE upload, 10 s after the last', async () => {
    for (let i = 0; i < 3; i++) {
      noteBoardSaved(ROOT, P)
      await vi.advanceTimersByTimeAsync(2_000)
    }
    expect(publish).not.toHaveBeenCalled()
    expect(isPending(P)).toBe(true)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(build).toHaveBeenCalledWith(ROOT, P, { flush: false })
    // The upload names the link it is for, so main never mistakes it for a new share.
    expect(publish).toHaveBeenCalledWith({ root: ROOT, path: P, content: 'v1', id: 'abc' })
    expect(isPending(P)).toBe(false)
  })

  it('never uploads a board that is not shared', async () => {
    get.mockResolvedValueOnce(null)
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(build).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('while sharing is not set up, main refuses (and records NOT_SET_UP); nothing retries until the next save', async () => {
    publish.mockRejectedValueOnce(Object.assign(new Error('Sharing is not set up on this computer yet.'), { code: 'NOT_SET_UP' }))
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS * 3)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(isPending(P)).toBe(false)
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

  it('an edit saved just before an in-app rename still uploads, under the new path', async () => {
    const Q = '/v/Renamed.excalidraw'
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(3_000)
    noteBoardRenamed(P, Q)
    expect([isPending(P), isPending(Q)]).toEqual([false, true])
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(get).toHaveBeenCalledWith({ root: ROOT, path: Q })
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({ path: Q })
  })

  it('a folder rename carries every pending board under it; an in-flight upload\'s queued re-run follows too', async () => {
    let finish!: () => void
    publish.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)))
    const inDir = '/v/Dir/Board.excalidraw'
    noteBoardSaved(ROOT, inDir)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    expect(publish).toHaveBeenCalledTimes(1) // in flight under the old path
    noteBoardSaved(ROOT, inDir)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    noteBoardRenamed('/v/Dir', '/v/Moved')
    finish()
    await flush()
    await flush()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish.mock.calls[1][0]).toMatchObject({ path: '/v/Moved/Board.excalidraw' })
    expect(isPending(inDir)).toBe(false)
  })

  it('an upload that failed because the board was renamed under it runs again under the new path', async () => {
    const Q = '/v/Renamed.excalidraw'
    build.mockImplementationOnce(async () => {
      noteBoardRenamed(P, Q) // the rename lands while the board is being read
      throw new Error('NOT_FOUND')
    })
    noteBoardSaved(ROOT, P)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    await flush()
    await flush()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish.mock.calls[0][0]).toMatchObject({ path: Q })
  })
})
