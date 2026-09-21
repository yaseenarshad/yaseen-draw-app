/**
 * Reveal in Finder (GRO-2274 `A1-`). The load-bearing case is the missing path: without the
 * stat, `showItemInFolder` silently does nothing and the menu item looks broken.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { shell } from 'electron'

vi.mock('electron', () => ({ shell: { showItemInFolder: vi.fn() } }))

import { revealItem } from './reveal'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const reveal = vi.mocked(shell.showItemInFolder)
beforeEach(() => {
  reveal.mockReset()
})

describe('revealItem (GRO-2274 A1)', () => {
  it('reveals a file at its exact path', async () => {
    const p = path.join(root, 'b.md')
    expect(await revealItem({ path: p })).toEqual({ path: p })
    expect(reveal).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('reveals a FOLDER the same way — no branching on kind (reveal-in-parent, LOCKED)', async () => {
    const p = path.join(root, 'Zeta')
    expect(await revealItem({ path: p })).toEqual({ path: p })
    expect(reveal).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('reveals the vault ROOT itself — the blank-space target', async () => {
    expect(await revealItem({ path: root })).toEqual({ path: root })
    expect(reveal).toHaveBeenCalledExactlyOnceWith(root)
  })

  it('a missing path is NOT_FOUND and showItemInFolder is never called (the stale-row case)', async () => {
    expect((await failure(revealItem({ path: path.join(root, 'nope.md') }))).code).toBe('NOT_FOUND')
    expect(reveal).not.toHaveBeenCalled()
  })

  it('reveals a non-vault file: revealing is read-only, so there is no extension gate', async () => {
    const p = path.join(root, 'notes.txt')
    expect(await revealItem({ path: p })).toEqual({ path: p })
  })

  it('reveals a dot-entry: read-only, so no dot guard either (unlike delete and rename)', async () => {
    const p = path.join(root, '.obsidian')
    expect(await revealItem({ path: p })).toEqual({ path: p })
  })

  it('rejects a missing or relative path argument before touching the disk', async () => {
    expect((await failure(revealItem({}))).code).toBe('BAD_REQUEST')
    expect((await failure(revealItem({ path: 'relative/x.md' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(revealItem(null))).code).toBe('BAD_REQUEST')
    expect(reveal).not.toHaveBeenCalled()
  })
})
