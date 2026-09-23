import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetRenameContinuity, dirtyPaths, flushRenamedDir, flushRenamedPath, registerRenameContinuity, retireDir, retirePath, type RenameContinuityHandle } from './renameContinuity'

afterEach(() => _resetRenameContinuity())

const handle = (over: Partial<RenameContinuityHandle> = {}): RenameContinuityHandle => ({
  flush: vi.fn(async () => undefined),
  retire: vi.fn(),
  dirty: () => false,
  ...over,
})

describe('renameContinuity for one file (Links E1 GRO-2194, delete GRO-2272)', () => {
  it('flushRenamedPath flushes the registered handle and resolves without one', async () => {
    const h = handle()
    registerRenameContinuity('/v/a.excalidraw', h)
    await flushRenamedPath('/v/a.excalidraw')
    expect(h.flush).toHaveBeenCalledTimes(1)
    await expect(flushRenamedPath('/v/other.excalidraw')).resolves.toBeUndefined()
  })

  it('retirePath retires the editor at that path and never flushes it', () => {
    const h = handle()
    registerRenameContinuity('/v/old.excalidraw', h)
    retirePath('/v/old.excalidraw')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(h.flush).not.toHaveBeenCalled()
  })

  it('no editor at the path is a no-op; unregister removes only its own handle', () => {
    expect(() => retirePath('/v/never-open.excalidraw')).not.toThrow()
    const first = handle()
    const off = registerRenameContinuity('/v/a.excalidraw', first)
    const second = handle()
    registerRenameContinuity('/v/a.excalidraw', second) // remount replaced the handle
    off() // stale unregister must not drop the replacement
    retirePath('/v/a.excalidraw')
    expect(second.retire).toHaveBeenCalledTimes(1)
    expect(first.retire).not.toHaveBeenCalled()
  })
})

describe('renameContinuity for a FOLDER (Links E1b GRO-2241, delete GRO-2272)', () => {
  it('flushRenamedDir flushes every mounted editor UNDER the dir — and only those', async () => {
    const inside = handle()
    const deep = handle()
    const outside = handle()
    const prefixCousin = handle()
    registerRenameContinuity('/v/Old/a.excalidraw', inside)
    registerRenameContinuity('/v/Old/deep/b.excalidraw', deep)
    registerRenameContinuity('/v/x.excalidraw', outside)
    registerRenameContinuity('/v/Older/c.excalidraw', prefixCousin) // `/v/Older` is NOT under `/v/Old`
    await flushRenamedDir('/v/Old')
    expect(inside.flush).toHaveBeenCalledTimes(1)
    expect(deep.flush).toHaveBeenCalledTimes(1)
    expect(outside.flush).not.toHaveBeenCalled()
    expect(prefixCousin.flush).not.toHaveBeenCalled()
  })

  it('retireDir retires every editor under the prefix and leaves the rest alone', () => {
    const inside = handle()
    const deeper = handle()
    const sibling = handle()
    const lookalike = handle()
    registerRenameContinuity('/v/Docs/a.excalidraw', inside)
    registerRenameContinuity('/v/Docs/deep/b.excalidraw', deeper)
    registerRenameContinuity('/v/Other/c.excalidraw', sibling)
    registerRenameContinuity('/v/Docsy.excalidraw', lookalike) // NOT under /v/Docs
    retireDir('/v/Docs')
    expect(inside.retire).toHaveBeenCalledTimes(1)
    expect(deeper.retire).toHaveBeenCalledTimes(1)
    expect(sibling.retire).not.toHaveBeenCalled()
    expect(lookalike.retire).not.toHaveBeenCalled()
  })
})

describe('dirtyPaths (YAZ-1801 D5)', () => {
  it('lists the open paths whose editor holds unsaved edits, asking each at call time', () => {
    let edited = false
    registerRenameContinuity('/v/a.excalidraw', handle({ dirty: () => edited }))
    registerRenameContinuity('/v/b.excalidraw', handle({ dirty: () => true }))
    registerRenameContinuity('/v/c.excalidraw', handle())
    expect(dirtyPaths()).toEqual(['/v/b.excalidraw'])
    edited = true
    expect(dirtyPaths()).toEqual(['/v/a.excalidraw', '/v/b.excalidraw'])
  })
})
