/**
 * Open in default app (YAZ-1577) — the third read-only OS verb, `openInVsCode.test.ts`'s mirror.
 * One contract of its own: `shell.openPath` never throws, it RETURNS the OS' message, so an empty
 * string is the whole success signal and anything else must surface as `IO_ERROR`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { shell } from 'electron'

vi.mock('electron', () => ({ shell: { openPath: vi.fn().mockResolvedValue('') } }))

import { openInDefaultApp } from './openDefault'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const open = vi.mocked(shell.openPath)
beforeEach(() => {
  open.mockClear()
  open.mockResolvedValue('')
})

describe('openInDefaultApp (YAZ-1577 D2)', () => {
  it('hands a file with no in-app viewer to the OS at its exact path', async () => {
    const p = path.join(root, 'book.epub')
    expect(await openInDefaultApp({ path: p })).toEqual({ path: p })
    expect(open).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('has no extension gate: a drawing file, a folder and the vault root open the same way', async () => {
    for (const p of [path.join(root, 'b.excalidraw'), path.join(root, 'Zeta'), root]) {
      expect(await openInDefaultApp({ path: p })).toEqual({ path: p })
    }
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('a missing path is NOT_FOUND and openPath is never called (the stale-row case)', async () => {
    expect((await failure(openInDefaultApp({ path: path.join(root, 'nope.epub') }))).code).toBe('NOT_FOUND')
    expect(open).not.toHaveBeenCalled()
  })

  it("the OS' error message becomes IO_ERROR carrying that message", async () => {
    open.mockResolvedValueOnce('No application knows how to open this file.')
    const p = path.join(root, 'book.epub')
    const err = await failure(openInDefaultApp({ path: p }))
    expect(err.code).toBe('IO_ERROR')
    expect(err.message).toBe('No application knows how to open this file.')
    expect(err.path).toBe(p)
  })

  it('rejects a missing or relative path argument before touching the disk', async () => {
    expect((await failure(openInDefaultApp({}))).code).toBe('BAD_REQUEST')
    expect((await failure(openInDefaultApp({ path: 'relative/x.epub' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(openInDefaultApp(null))).code).toBe('BAD_REQUEST')
    expect(open).not.toHaveBeenCalled()
  })
})
