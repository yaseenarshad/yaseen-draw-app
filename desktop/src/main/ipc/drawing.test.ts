import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { createStore, type Store } from '../store'
import { blockOf, withoutBlock } from '../fs/testFixture'
import { _resetSweeps, registerDrawingIpc, sweepVaultOnce } from './drawing'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, shell: { trashItem: vi.fn(async () => undefined) } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const SCENE = `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`

let root: string
let store: Store
let userData: string

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  root = await mkdtemp(path.join(tmpdir(), 'draw-ipc-'))
  userData = path.join(root, 'userData')
  store = createStore(path.join(userData, 'yaseendraw.json'))
  _resetSweeps()
  registerDrawingIpc(store, userData)
})
afterEach(async () => {
  await store.flush()
  await rm(root, { recursive: true, force: true })
})

describe('drawing IPC', () => {
  it('registers the two document doors plus the library-folder read (🔒 YAZ-1775 D5)', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).toEqual([CH.drawingLoad, CH.drawingSave, CH.drawingLibraryFolder])
  })

  it('drawing:library-folder answers the default under userData, and the setting once it is set (🔒 YAZ-1775 D5)', async () => {
    const answer = async () => ((await registered(CH.drawingLibraryFolder)({})) as Envelope<string>)
    expect(await answer()).toEqual({ ok: true, value: path.join(userData, 'library') })
    const chosen = path.join(root, 'My Library')
    store.setSettings({ ...store.get().settings, libraryFolder: chosen })
    expect(await answer()).toEqual({ ok: true, value: chosen })
  })

  it('answers drawing:load in the standard envelope', async () => {
    const file = path.join(root, 'Board.excalidraw')
    await writeFile(file, SCENE)
    const res = (await registered(CH.drawingLoad)({}, { root, path: 'Board.excalidraw' })) as Envelope<{ json: string }>
    expect(res).toMatchObject({ ok: true, value: { json: SCENE } })
  })

  it('answers drawing:save in the standard envelope and writes the bytes', async () => {
    const file = path.join(root, 'Board.excalidraw')
    await writeFile(file, SCENE)
    // The pretty, `files: {}` form the renderer's serializer produces — written back verbatim below the block (🔒 YAZ-1834 D1).
    const next = `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'a' }], appState: {}, files: {} }, null, 2)}\n`
    const res = (await registered(CH.drawingSave)({}, { root, path: file, json: next, newFiles: [] })) as Envelope<unknown>
    expect(res.ok).toBe(true)
    const written = await readFile(file, 'utf8')
    expect(blockOf(written)).toMatchObject({ createdAt: expect.any(Number), updatedAt: expect.any(Number) })
    expect(withoutBlock(written)).toBe(next)
  })

  it('turns a failure into the envelope`s BridgeError rather than a rejection (Electron flattens throws)', async () => {
    const file = path.join(root, 'Board.excalidraw')
    await writeFile(file, SCENE)
    const st = await stat(file)
    const res = (await registered(CH.drawingSave)({}, { root, path: file, json: SCENE, expectedMtime: st.mtimeMs - 5, newFiles: [] })) as Envelope<unknown>
    expect(res).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'drawing changed on disk since last read', path: file, mtime: st.mtimeMs } })
  })
})

/**
 * The once-per-session sweep trigger (🔒 YAZ-1775 D3). The runner itself is `orphanSweep.test.ts`'s; what
 * is pinned here is WHEN it runs, HOW OFTEN, and what the window is told.
 */
describe('sweepVaultOnce', () => {
  /** A `WebContents` stand-in: only what the notice touches. */
  const fakeSender = () => ({ isDestroyed: () => false, send: vi.fn() })

  /** One old, unreferenced asset — the sweep's whole reason to do anything. */
  async function seedOrphan(name = 'orphan.png'): Promise<void> {
    const file = path.join(root, 'assets', name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, 'x')
    const when = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
    await utimes(file, when, when)
  }

  /** Lets the detached sweep settle — it is deliberately not awaited by its caller. */
  const settle = () => new Promise((r) => setTimeout(r, 50))

  it('sweeps a root ONCE per session, however many windows open it', async () => {
    await seedOrphan()
    const trash = vi.fn(async () => undefined)
    const sender = fakeSender()
    sweepVaultOnce(root, sender, { trash })
    sweepVaultOnce(root, sender, { trash })
    await settle()
    expect(trash).toHaveBeenCalledTimes(1)
  })

  it('tells the asking window what it did, in the singular and the plural', async () => {
    await seedOrphan('a.png')
    const sender = fakeSender()
    sweepVaultOnce(root, sender, { trash: async () => undefined })
    await settle()
    expect(sender.send).toHaveBeenCalledWith(CH.linkNotice, 'Cleaned 1 unused image')

    _resetSweeps()
    await seedOrphan('b.png')
    const second = fakeSender()
    sweepVaultOnce(root, second, { trash: async () => undefined })
    await settle()
    expect(second.send).toHaveBeenCalledWith(CH.linkNotice, 'Cleaned 2 unused images')
  })

  it('says NOTHING when it found nothing — silence is the right report for housekeeping', async () => {
    const sender = fakeSender()
    sweepVaultOnce(root, sender, { trash: async () => undefined })
    await settle()
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('does not send to a window that closed while the vault was being walked', async () => {
    await seedOrphan()
    const sender = { isDestroyed: () => true, send: vi.fn() }
    sweepVaultOnce(root, sender, { trash: async () => undefined })
    await settle()
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('never throws at its caller, whatever the vault does', async () => {
    const sender = fakeSender()
    expect(() => sweepVaultOnce(path.join(root, 'does-not-exist'), sender)).not.toThrow()
    await settle()
    expect(sender.send).not.toHaveBeenCalled()
  })
})
