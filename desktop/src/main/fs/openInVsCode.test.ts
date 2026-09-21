/**
 * Open in VS Code (YAZ-963) — `reveal.test.ts`'s mirror, same load-bearing case: without the
 * stat, a stale row's `openExternal` would fire a dead `vscode://` URL and the menu item would
 * look broken. The URL is the OS deep-link (`vscode://file/<path>`), every segment encoded so a
 * space in a note name survives the trip.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { shell } from 'electron'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn().mockResolvedValue(undefined) } }))

import { openInVsCode } from './openInVsCode'
import { failure, makeFixture } from './testFixture'

let root: string
let cleanup: () => Promise<void>
beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  await writeFile(path.join(root, 'My Note.excalidraw'), 'has a space')
})
afterAll(() => cleanup())

const open = vi.mocked(shell.openExternal)
beforeEach(() => {
  open.mockClear()
})

describe('openInVsCode (YAZ-963)', () => {
  it('opens a file through the vscode:// deep link at its exact path', async () => {
    const p = path.join(root, 'b.excalidraw')
    expect(await openInVsCode({ path: p })).toEqual({ path: p })
    expect(open).toHaveBeenCalledExactlyOnceWith(`vscode://file${p}`)
  })

  it('a space in the name is percent-encoded — the URL survives, the file opens', async () => {
    const p = path.join(root, 'My Note.excalidraw')
    expect(await openInVsCode({ path: p })).toEqual({ path: p })
    expect(open).toHaveBeenCalledExactlyOnceWith(`vscode://file${path.join(root, 'My%20Note.excalidraw')}`)
  })

  it('opens a FOLDER the same way — VS Code decides what a folder means, not this menu', async () => {
    const p = path.join(root, 'Zeta')
    expect(await openInVsCode({ path: p })).toEqual({ path: p })
    expect(open).toHaveBeenCalledExactlyOnceWith(`vscode://file${p}`)
  })

  it('opens the vault ROOT itself — the blank-space target, reveal parity', async () => {
    expect(await openInVsCode({ path: root })).toEqual({ path: root })
    expect(open).toHaveBeenCalledExactlyOnceWith(`vscode://file${root}`)
  })

  it('a missing path is NOT_FOUND and openExternal is never called (the stale-row case)', async () => {
    expect((await failure(openInVsCode({ path: path.join(root, 'nope.excalidraw') }))).code).toBe('NOT_FOUND')
    expect(open).not.toHaveBeenCalled()
  })

  it('opens a non-vault file and a dot-entry: read-only posture, no gates (reveal parity)', async () => {
    const txt = path.join(root, 'notes.txt')
    expect(await openInVsCode({ path: txt })).toEqual({ path: txt })
    const dot = path.join(root, '.obsidian')
    expect(await openInVsCode({ path: dot })).toEqual({ path: dot })
  })

  it('rejects a missing or relative path argument before touching the disk', async () => {
    expect((await failure(openInVsCode({}))).code).toBe('BAD_REQUEST')
    expect((await failure(openInVsCode({ path: 'relative/x.excalidraw' }))).code).toBe('NOT_ABSOLUTE')
    expect((await failure(openInVsCode(null))).code).toBe('BAD_REQUEST')
    expect(open).not.toHaveBeenCalled()
  })
})
