import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { registerDrawingIpc } from './drawing'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

const SCENE = `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} }, null, 2)}\n`

let root: string

beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  root = await mkdtemp(path.join(tmpdir(), 'draw-ipc-'))
  registerDrawingIpc()
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('drawing IPC', () => {
  it('registers exactly the two document doors', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).toEqual([CH.drawingLoad, CH.drawingSave])
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
    const next = `${JSON.stringify({ elements: [{ id: 'a' }] })}\n`
    const res = (await registered(CH.drawingSave)({}, { root, path: file, json: next, newFiles: [] })) as Envelope<unknown>
    expect(res.ok).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(next)
  })

  it('turns a failure into the envelope`s BridgeError rather than a rejection (Electron flattens throws)', async () => {
    const file = path.join(root, 'Board.excalidraw')
    await writeFile(file, SCENE)
    const st = await stat(file)
    const res = (await registered(CH.drawingSave)({}, { root, path: file, json: SCENE, expectedMtime: st.mtimeMs - 5, newFiles: [] })) as Envelope<unknown>
    expect(res).toEqual({ ok: false, error: { code: 'CONFLICT', message: 'drawing changed on disk since last read', path: file, mtime: st.mtimeMs } })
  })
})
