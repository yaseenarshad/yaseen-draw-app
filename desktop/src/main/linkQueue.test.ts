import { describe, expect, it, vi } from 'vitest'
import { fileLink, parseFileLink } from '@shared/links'
import { createLinkQueue } from './linkQueue'

// E1 (GRO-2171): macOS delivers cold-start `open-url` before `ready`; URLs queue until
// `flush()` runs after `restoreAll()`, then flow straight through.

describe('createLinkQueue', () => {
  it('queues pushes before flush, then replays them in order', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.push('yaseendocs:///v/a.md')
    q.push('yaseendocs:///v/b.md')
    expect(handle).not.toHaveBeenCalled()
    q.flush()
    expect(handle.mock.calls).toEqual([['yaseendocs:///v/a.md'], ['yaseendocs:///v/b.md']])
  })

  it('handles pushes directly once flushed', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.flush()
    q.push('yaseendocs:///v/a.md')
    expect(handle).toHaveBeenCalledWith('yaseendocs:///v/a.md')
    expect(handle).toHaveBeenCalledTimes(1)
  })

  it('a second flush replays nothing twice', () => {
    const handle = vi.fn()
    const q = createLinkQueue(handle)
    q.push('yaseendocs:///v/a.md')
    q.flush()
    q.flush()
    expect(handle).toHaveBeenCalledTimes(1)
  })
})

// E2 (GRO-2172): Finder "Open With" hands main a plain absolute path via `open-file` (also before
// `ready` on cold start). index.ts pushes `fileLink(path)` into the SAME queue, so the E1 parse +
// route pipeline handles it — these pin that composition, with the paths Finder actually produces.
describe('open-file paths through the link queue', () => {
  /** index.ts's handleLink shape: parse the queued link back to a path, route it. */
  const routedQueue = () => {
    const routed: string[] = []
    const q = createLinkQueue((url) => {
      const parsed = parseFileLink(url)
      if (parsed !== null) routed.push(parsed.path)
    })
    return { q, routed }
  }

  it('a path queued before flush (cold start) routes after flush, bytes intact', () => {
    const { q, routed } = routedQueue()
    q.push(fileLink('/v/My note #1?.md'))
    expect(routed).toEqual([])
    q.flush()
    expect(routed).toEqual(['/v/My note #1?.md'])
  })

  it('a path pushed after flush (hot) routes immediately', () => {
    const { q, routed } = routedQueue()
    q.flush()
    q.push(fileLink('/v/ünïcode näme.md'))
    expect(routed).toEqual(['/v/ünïcode näme.md'])
  })
})
