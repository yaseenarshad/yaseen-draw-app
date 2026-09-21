/**
 * The ONE app-wide file clipboard (YAZ-1674, D1). Pure node — no Electron — because the
 * module has no Electron import by design; `ipc/fs.test.ts` covers the `clip:changed` push.
 */
import { describe, expect, it, vi } from 'vitest'
import { createFileClip, fileClip } from './fileClip'
import { failure } from './fs/testFixture'

const code = async (fn: () => void) => (await failure(Promise.resolve().then(fn))).code

describe('createFileClip (YAZ-1674, D1)', () => {
  it('starts empty: get() null, state() null', () => {
    const clip = createFileClip()
    expect(clip.get()).toBeNull()
    expect(clip.state()).toBeNull()
  })

  it('set() stores the ordered paths and the op; state() is count + op, never the paths', () => {
    const clip = createFileClip()
    clip.set({ op: 'cut', paths: ['/v/b.md', '/v/a.md', '/v/Zeta'] })
    expect(clip.get()).toEqual({ op: 'cut', paths: ['/v/b.md', '/v/a.md', '/v/Zeta'] })
    expect(clip.state()).toEqual({ count: 3, op: 'cut' })
  })

  it('de-duplicates to the first position and resolves each path', () => {
    const clip = createFileClip()
    clip.set({ op: 'copy', paths: ['/v/a.md', '/v/sub/../a.md', '/v/b.md/', '/v/a.md'] })
    expect(clip.get()?.paths).toEqual(['/v/a.md', '/v/b.md'])
    expect(clip.state()).toEqual({ count: 2, op: 'copy' })
  })

  it('a later set() REPLACES the clipboard (a cut after a copy is just a cut)', () => {
    const clip = createFileClip()
    clip.set({ op: 'copy', paths: ['/v/a.md', '/v/b.md'] })
    clip.set({ op: 'cut', paths: ['/v/c.md'] })
    expect(clip.get()).toEqual({ op: 'cut', paths: ['/v/c.md'] })
  })

  it('rejects a non-object, an unknown op, an empty or missing paths array — and leaves the clipboard as it was', async () => {
    const clip = createFileClip()
    clip.set({ op: 'copy', paths: ['/v/a.md'] })
    expect(await code(() => clip.set(undefined))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set(null))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ op: 'move', paths: ['/v/a.md'] }))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ paths: ['/v/a.md'] }))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ op: 'cut', paths: [] }))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ op: 'cut', paths: 'not-an-array' }))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ op: 'cut' }))).toBe('BAD_REQUEST')
    expect(clip.get()).toEqual({ op: 'copy', paths: ['/v/a.md'] })
  })

  it('rejects a relative or empty entry (NOT_ABSOLUTE / BAD_REQUEST) before storing ANY of them', async () => {
    const clip = createFileClip()
    expect(await code(() => clip.set({ op: 'cut', paths: ['/v/a.md', 'relative.md'] }))).toBe('NOT_ABSOLUTE')
    expect(await code(() => clip.set({ op: 'cut', paths: ['/v/a.md', ''] }))).toBe('BAD_REQUEST')
    expect(await code(() => clip.set({ op: 'cut', paths: ['/v/a.md', 42] }))).toBe('NOT_ABSOLUTE')
    expect(clip.get()).toBeNull()
  })

  it('clear() empties it, and clearing an empty clipboard is a silent no-op (idempotent)', () => {
    const clip = createFileClip()
    const seen = vi.fn()
    clip.onChange(seen)
    clip.clear()
    expect(seen).not.toHaveBeenCalled()
    clip.set({ op: 'cut', paths: ['/v/a.md'] })
    clip.clear()
    expect(clip.get()).toBeNull()
    expect(seen).toHaveBeenCalledTimes(2)
    expect(seen).toHaveBeenLastCalledWith(null)
    clip.clear()
    expect(seen).toHaveBeenCalledTimes(2)
  })

  it('onChange fires with the new state after every change and the returned unsubscribe stops it', () => {
    const clip = createFileClip()
    const a = vi.fn()
    const b = vi.fn()
    const offA = clip.onChange(a)
    clip.onChange(b)
    clip.set({ op: 'copy', paths: ['/v/a.md', '/v/b.md'] })
    expect(a).toHaveBeenCalledExactlyOnceWith({ count: 2, op: 'copy' })
    expect(b).toHaveBeenCalledExactlyOnceWith({ count: 2, op: 'copy' })
    offA()
    clip.set({ op: 'cut', paths: ['/v/c.md'] })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenLastCalledWith({ count: 1, op: 'cut' })
  })

  it('a rejected set() notifies nobody', () => {
    const clip = createFileClip()
    const seen = vi.fn()
    clip.onChange(seen)
    expect(() => clip.set({ op: 'cut', paths: [] })).toThrow()
    expect(seen).not.toHaveBeenCalled()
  })

  it('exports the one app-wide instance with the same surface', () => {
    expect(fileClip.get()).toBeNull()
    expect(typeof fileClip.set).toBe('function')
    expect(typeof fileClip.onChange).toBe('function')
  })
})
