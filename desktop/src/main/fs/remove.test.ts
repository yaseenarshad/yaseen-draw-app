/**
 * In-app delete (GRO-2272 `A1-`, GRO-2277). The load-bearing test in this file is
 * "a trashItem failure leaves the file ON DISK": the LOCKED ruling is `shell.trashItem`
 * only, never `fs.rm`, and no permanent-delete fallback — a failed trash must refuse
 * loudly rather than destroy the file the user asked to be able to recover.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }))

import { removeEntry } from './remove'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => ({ root, cleanup } = await makeFixture()))
afterAll(() => cleanup())

const trashItem = vi.mocked(shell.trashItem)
/** The real thing moves the entry away; the mock must too, or "is it gone?" proves nothing. */
const trashResolves = () => trashItem.mockImplementation(async () => undefined)

// Block body, NOT `() => trashItem.mockReset()`: mockReset returns the mock itself, and
// vitest treats a value returned from a hook as a TEARDOWN callback — so the concise form
// calls the (throwing) mock after every test and fails it with a rejection the test body
// already handled correctly.
beforeEach(() => {
  trashItem.mockReset()
})

const exists = async (p: string) => stat(p).then(() => true, () => false)

describe('removeEntry (GRO-2272 A1)', () => {
  it('moves a markdown file to the Trash and reports kind file', async () => {
    trashResolves()
    const p = path.join(root, 'b.md')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file' })
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('moves a non-vault file to the Trash — no extension gate beyond what the tree shows', async () => {
    trashResolves()
    const p = path.join(root, 'notes.txt')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file' })
  })

  it('moves a FOLDER to the Trash and reports kind dir', async () => {
    trashResolves()
    const p = path.join(root, 'Zeta')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'dir' })
    expect(trashItem).toHaveBeenCalledExactlyOnceWith(p)
  })

  it('a trashItem failure is IO_ERROR and LEAVES THE FILE ON DISK (no fs.rm fallback, ever)', async () => {
    // Lazy throw, not mockRejectedValue: the latter builds the rejected promise at SETUP
    // time, which vitest reports as an unhandled rejection before the call ever happens.
    trashItem.mockImplementation(async () => {
      throw new Error('no Trash on this volume')
    })
    const p = path.join(root, 'A.md')
    const err = await failure(removeEntry({ path: p }))
    expect(err.code).toBe('IO_ERROR')
    expect(err.path).toBe(p)
    // The whole point: a failed trash must never escalate to destroying the file.
    expect(await exists(p)).toBe(true)
  })

  it('NOT_FOUND for a missing path, and nothing is trashed', async () => {
    trashResolves()
    expect((await failure(removeEntry({ path: path.join(root, 'nope.md') }))).code).toBe('NOT_FOUND')
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('refuses everything the tree hides — dot-entries AND node_modules — never deletable from a UI that never showed them', async () => {
    trashResolves()
    for (const p of [path.join(root, '.obsidian'), path.join(root, '.yaseendraw'), path.join(root, '.hidden.md'), path.join(root, 'node_modules')]) {
      const err = await failure(removeEntry({ path: p }))
      expect(err.code).toBe('BAD_REQUEST')
      expect(await exists(p)).toBe(true)
    }
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('deletes a folder whose contents are not vault files — the tree shows every folder, so every folder is deletable', async () => {
    trashResolves()
    const p = path.join(root, 'assets-only')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'dir' })
  })

  it('rejects a missing or relative path argument before touching the disk', async () => {
    trashResolves()
    expect((await failure(removeEntry({}))).code).toBe('BAD_REQUEST')
    expect((await failure(removeEntry({ path: 'relative/x.md' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(removeEntry(null))).code).toBe('BAD_REQUEST')
    expect(trashItem).not.toHaveBeenCalled()
  })

  it('surfaces a permission error as FORBIDDEN through the shared fsCall mapping', async () => {
    trashItem.mockImplementation(async () => {
      throw Object.assign(new Error('denied'), { code: 'EACCES' })
    })
    const p = path.join(root, 'Empty')
    expect((await failure(removeEntry({ path: p }))).code).toBe('FORBIDDEN')
  })

  it('deletes a nested file inside a folder without touching the folder', async () => {
    trashResolves()
    await mkdir(path.join(root, 'Nest'), { recursive: true })
    await writeFile(path.join(root, 'Nest', 'n.md'), 'n')
    const p = path.join(root, 'Nest', 'n.md')
    expect(await removeEntry({ path: p })).toEqual({ path: p, kind: 'file' })
    expect(await exists(path.join(root, 'Nest'))).toBe(true)
  })
})
