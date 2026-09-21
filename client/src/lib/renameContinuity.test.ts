import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetRenameContinuity, carryEditorAcrossPane, carryEditorAcrossRename, carryEditorsAcrossDirRename, flushRenamedDir, flushRenamedPath, registerRenameContinuity, retireDeletedDir, retireDeletedPath, takeRenameBuffer, type RenameContinuityHandle } from './renameContinuity'

afterEach(() => _resetRenameContinuity())

const handle = (over: Partial<RenameContinuityHandle> = {}): RenameContinuityHandle => ({
  flush: vi.fn(async () => undefined),
  capture: vi.fn(() => null),
  retire: vi.fn(),
  ...over,
})

describe('renameContinuity (Links E1, GRO-2194)', () => {
  it('pane transfer captures, retires, and exposes a dirty buffer at the same path', () => {
    const h = handle({ capture: vi.fn(() => ({ frontmatter: '---\n---\n', body: 'newest keystrokes' })) })
    registerRenameContinuity('/v/a.md', h)
    carryEditorAcrossPane('/v/a.md')
    expect(h.capture).toHaveBeenCalledTimes(1)
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(takeRenameBuffer('/v/a.md')).toEqual({ frontmatter: '---\n---\n', body: 'newest keystrokes' })
  })

  it('flushRenamedPath flushes the registered handle and resolves without one', async () => {
    const h = handle()
    registerRenameContinuity('/v/a.md', h)
    await flushRenamedPath('/v/a.md')
    expect(h.flush).toHaveBeenCalledTimes(1)
    await expect(flushRenamedPath('/v/other.md')).resolves.toBeUndefined()
  })

  it('carryEditorAcrossRename stashes a DIRTY buffer under the NEW path and retires the old handle', () => {
    const h = handle({ capture: vi.fn(() => ({ frontmatter: '---\nk: 1\n---\n', body: 'dirty body' })) })
    registerRenameContinuity('/v/old.md', h)
    carryEditorAcrossRename('/v/old.md', '/v/new.md')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(takeRenameBuffer('/v/new.md')).toEqual({ frontmatter: '---\nk: 1\n---\n', body: 'dirty body' })
    expect(takeRenameBuffer('/v/new.md')).toBeNull() // consumed exactly once
  })

  it('a CLEAN editor is retired without stashing anything (nothing to carry, nothing to resurrect)', () => {
    const h = handle()
    registerRenameContinuity('/v/old.md', h)
    carryEditorAcrossRename('/v/old.md', '/v/new.md')
    expect(h.retire).toHaveBeenCalledTimes(1)
    expect(takeRenameBuffer('/v/new.md')).toBeNull()
  })

  it('no editor at the old path is a no-op; unregister removes only its own handle', () => {
    carryEditorAcrossRename('/v/old.md', '/v/new.md') // must not throw
    const first = handle()
    const off = registerRenameContinuity('/v/a.md', first)
    const second = handle()
    registerRenameContinuity('/v/a.md', second) // remount replaced the handle
    off() // stale unregister must not drop the replacement
    carryEditorAcrossRename('/v/a.md', '/v/b.md')
    expect(second.retire).toHaveBeenCalledTimes(1)
    expect(first.retire).not.toHaveBeenCalled()
  })
})

describe('renameContinuity for a FOLDER rename (Links E1b, GRO-2241)', () => {
  it('flushRenamedDir flushes every mounted editor UNDER the dir — and only those', async () => {
    const inside = handle()
    const deep = handle()
    const outside = handle()
    const prefixCousin = handle()
    registerRenameContinuity('/v/Old/a.md', inside)
    registerRenameContinuity('/v/Old/deep/b.md', deep)
    registerRenameContinuity('/v/x.md', outside)
    registerRenameContinuity('/v/Older/c.md', prefixCousin) // `/v/Older` is NOT under `/v/Old`
    await flushRenamedDir('/v/Old')
    expect(inside.flush).toHaveBeenCalledTimes(1)
    expect(deep.flush).toHaveBeenCalledTimes(1)
    expect(outside.flush).not.toHaveBeenCalled()
    expect(prefixCousin.flush).not.toHaveBeenCalled()
  })

  it('carryEditorsAcrossDirRename carries each editor under the dir to ITS new path (dirty stashed, all retired)', () => {
    const dirty = handle({ capture: vi.fn(() => ({ frontmatter: '', body: 'dirty' })) })
    const clean = handle()
    const outside = handle()
    registerRenameContinuity('/v/Old/a.md', dirty)
    registerRenameContinuity('/v/Old/deep/b.md', clean)
    registerRenameContinuity('/v/x.md', outside)
    carryEditorsAcrossDirRename('/v/Old', '/v/New')
    expect(dirty.retire).toHaveBeenCalledTimes(1)
    expect(clean.retire).toHaveBeenCalledTimes(1)
    expect(outside.retire).not.toHaveBeenCalled()
    expect(takeRenameBuffer('/v/New/a.md')).toEqual({ frontmatter: '', body: 'dirty' })
    expect(takeRenameBuffer('/v/New/deep/b.md')).toBeNull() // clean: nothing stashed
  })
})

/**
 * Delete (GRO-2272 `B1-`): retire ONLY. The rename twins a few lines above capture, retire and
 * stash a dirty buffer because a rename has somewhere for it to go; a delete does not, and a
 * stashed buffer would be a live resurrection vector for whatever mounts at that path next.
 */
describe('retireDeletedPath / retireDeletedDir (GRO-2272)', () => {
  /** A handle that records what the flow did to it and whether anything tried to write. */
  function handle() {
    const calls = { flush: 0, capture: 0, retire: 0 }
    return {
      calls,
      h: {
        flush: async () => void calls.flush++,
        capture: () => {
          calls.capture++
          return { frontmatter: '', body: 'dirty' }
        },
        retire: () => void calls.retire++,
      },
    }
  }

  it('retires the editor at the path and never captures a buffer', () => {
    const a = handle()
    registerRenameContinuity('/v/a.md', a.h)
    retireDeletedPath('/v/a.md')
    expect(a.calls.retire).toBe(1)
    expect(a.calls.capture).toBe(0) // the whole difference from carryEditorAcrossRename
    expect(a.calls.flush).toBe(0)
  })

  it('drops a buffer already stashed for that path, so a later mount cannot apply it', () => {
    const a = handle()
    registerRenameContinuity('/v/a.md', a.h)
    // A rename landed moments before the delete and left a buffer at this path.
    carryEditorAcrossRename('/v/old.md', '/v/a.md')
    expect(takeRenameBuffer('/v/a.md')).toBeNull() // consumed by this probe...
    carryEditorAcrossRename('/v/old2.md', '/v/a.md')
    retireDeletedPath('/v/a.md')
    expect(takeRenameBuffer('/v/a.md')).toBeNull() // ...and gone after the delete either way
  })

  it('is a silent no-op when no editor is open at the path', () => {
    expect(() => retireDeletedPath('/v/never-open.md')).not.toThrow()
  })

  it('retireDeletedDir retires every editor under the prefix and leaves the rest alone', () => {
    const inside = handle()
    const deeper = handle()
    const sibling = handle()
    const lookalike = handle()
    registerRenameContinuity('/v/Docs/a.md', inside.h)
    registerRenameContinuity('/v/Docs/deep/b.md', deeper.h)
    registerRenameContinuity('/v/Other/c.md', sibling.h)
    registerRenameContinuity('/v/Docsy.md', lookalike.h) // NOT under /v/Docs
    retireDeletedDir('/v/Docs')
    expect(inside.calls.retire).toBe(1)
    expect(deeper.calls.retire).toBe(1)
    expect(sibling.calls.retire).toBe(0)
    expect(lookalike.calls.retire).toBe(0)
    expect(inside.calls.capture + deeper.calls.capture).toBe(0)
  })

  it('retireDeletedDir drops stashed buffers under the prefix only', () => {
    registerRenameContinuity('/v/Docs/a.md', handle().h)
    carryEditorAcrossRename('/v/Docs/a.md', '/v/Docs/moved.md')
    registerRenameContinuity('/v/Keep/k.md', handle().h)
    carryEditorAcrossRename('/v/Keep/k.md', '/v/Keep/moved.md')
    retireDeletedDir('/v/Docs')
    expect(takeRenameBuffer('/v/Docs/moved.md')).toBeNull()
    expect(takeRenameBuffer('/v/Keep/moved.md')).not.toBeNull()
  })
})
