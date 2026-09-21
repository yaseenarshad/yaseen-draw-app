import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YaseenDrawApi } from '@shared/types'
import { api, BridgeRequestError } from './api'

/** A minimal `window.yaseenDraw` stub: only the methods the client `api` delegates to. */
function installBridge(): { [K in keyof YaseenDrawApi]: ReturnType<typeof vi.fn> } {
  const bridge = {
    tree: vi.fn(),
    readFile: vi.fn(),
    readPdf: vi.fn(),
    readImage: vi.fn(),
    writeFile: vi.fn(),
    createDir: vi.fn(),
    createFile: vi.fn(),
    index: vi.fn(),
    coldDiff: vi.fn(),
    readAsset: vi.fn(),
    writeAsset: vi.fn(),
    pickFolder: vi.fn(),
    watch: vi.fn(),
    state: vi.fn(),
    window: vi.fn(),
    menu: vi.fn(),
    link: vi.fn(),
    file: vi.fn(),
    shell: vi.fn(),
    vaultConfig: vi.fn(),
    properties: vi.fn(),
    favorites: vi.fn(),
    github: vi.fn(),
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  return bridge
}

let bridge: ReturnType<typeof installBridge>
beforeEach(() => (bridge = installBridge()))
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDraw
})

describe('api', () => {
  it('delegates to window.yaseenDraw with the same arguments and resolves its value', async () => {
    bridge.tree.mockResolvedValue({ root: '/v', tree: [], generatedAt: 1 })
    bridge.writeFile.mockResolvedValue({ path: '/v/a.md', mtime: 2, size: 3 })
    bridge.pickFolder.mockResolvedValue({ cancelled: true })
    await expect(api.tree('/v')).resolves.toEqual({ root: '/v', tree: [], generatedAt: 1 })
    expect(bridge.tree).toHaveBeenCalledWith('/v')
    await expect(api.writeFile({ path: '/v/a.md', content: 'x', expectedMtime: 1 })).resolves.toEqual({ path: '/v/a.md', mtime: 2, size: 3 })
    expect(bridge.writeFile).toHaveBeenCalledWith({ path: '/v/a.md', content: 'x', expectedMtime: 1 })
    await expect(api.pickFolder()).resolves.toEqual({ cancelled: true })
    await api.readFile('/v/a.md')
    const pdfBytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46])
    bridge.readPdf.mockResolvedValue({ path: '/v/report.pdf', data: pdfBytes, mtime: 6, size: pdfBytes.byteLength })
    await expect(api.readPdf('/v/report.pdf')).resolves.toMatchObject({ path: '/v/report.pdf', data: pdfBytes })
    await api.createDir('/v/d')
    await api.createFile('/v/n.md')
    expect(bridge.readFile).toHaveBeenCalledWith('/v/a.md')
    expect(bridge.readPdf).toHaveBeenCalledWith('/v/report.pdf')
    const imageBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    bridge.readImage.mockResolvedValue({ path: '/v/pixel.png', data: imageBytes, mime: 'image/png', mtime: 7, size: imageBytes.byteLength })
    await expect(api.readImage('/v/pixel.png')).resolves.toMatchObject({ path: '/v/pixel.png', data: imageBytes, mime: 'image/png' })
    expect(bridge.readImage).toHaveBeenCalledWith('/v/pixel.png')
    expect(bridge.createDir).toHaveBeenCalledWith('/v/d')
    expect(bridge.createFile).toHaveBeenCalledWith('/v/n.md')
    bridge.index.mockResolvedValue({ root: '/v', records: [], generatedAt: 4 })
    await expect(api.index('/v')).resolves.toEqual({ root: '/v', records: [], generatedAt: 4 })
    expect(bridge.index).toHaveBeenCalledWith('/v')
    bridge.readAsset.mockResolvedValue({ path: '/v/pic.png', mime: 'image/png', data: 'aGk=', size: 2 })
    await expect(api.readAsset('/v', 'pic.png')).resolves.toEqual({ path: '/v/pic.png', mime: 'image/png', data: 'aGk=', size: 2 })
    expect(bridge.readAsset).toHaveBeenCalledWith('/v', 'pic.png')
    // The drawing write half (YAZ-876): the request goes through untouched, the receipt comes back.
    const draw = { root: '/v', path: 'assets/drawings/a.excalidraw', content: '{}' }
    bridge.writeAsset.mockResolvedValue({ path: '/v/assets/drawings/a.excalidraw', mtime: 7, size: 2 })
    await expect(api.writeAsset(draw)).resolves.toEqual({ path: '/v/assets/drawings/a.excalidraw', mtime: 7, size: 2 })
    expect(bridge.writeAsset).toHaveBeenCalledWith(draw)
  })

  it('rename delegates to file.rename and wraps ALREADY_EXISTS like every other code (Links E1, GRO-2194)', async () => {
    const file = { rename: vi.fn(), onRenamed: vi.fn() }
    Object.defineProperty(window.yaseenDraw, 'file', { value: file, configurable: true })
    file.rename.mockResolvedValue({ oldPath: '/v/a.md', newPath: '/v/b.md' })
    await expect(api.rename({ oldPath: '/v/a.md', newPath: '/v/b.md' })).resolves.toEqual({ oldPath: '/v/a.md', newPath: '/v/b.md' })
    expect(file.rename).toHaveBeenCalledWith({ oldPath: '/v/a.md', newPath: '/v/b.md' })
    file.rename.mockRejectedValue({ code: 'ALREADY_EXISTS', message: 'a file with this name already exists', path: '/v/b.md' })
    const err = (await api.rename({ oldPath: '/v/a.md', newPath: '/v/b.md' }).catch((e: unknown) => e)) as BridgeRequestError
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err.code).toBe('ALREADY_EXISTS')
    expect(err.path).toBe('/v/b.md')
  })

  it('repairRename delegates to file.repairRename and coldDiff to the top-level bridge method (Links E1c, GRO-2242)', async () => {
    const file = { rename: vi.fn(), repairRename: vi.fn(), onRenamed: vi.fn() }
    Object.defineProperty(window.yaseenDraw, 'file', { value: file, configurable: true })
    file.repairRename.mockResolvedValue({ oldPath: '/v/a.md', newPath: '/v/b.md', kind: 'file' })
    await expect(api.repairRename({ oldPath: '/v/a.md', newPath: '/v/b.md' })).resolves.toEqual({ oldPath: '/v/a.md', newPath: '/v/b.md', kind: 'file' })
    expect(file.repairRename).toHaveBeenCalledWith({ oldPath: '/v/a.md', newPath: '/v/b.md' })
    file.repairRename.mockRejectedValue({ code: 'BAD_REQUEST', message: 'the old path still exists on disk', path: '/v/a.md' })
    const err = (await api.repairRename({ oldPath: '/v/a.md', newPath: '/v/b.md' }).catch((e: unknown) => e)) as BridgeRequestError
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err.code).toBe('BAD_REQUEST')
    bridge.coldDiff.mockResolvedValue(null)
    await expect(api.coldDiff('/v')).resolves.toBeNull()
    expect(bridge.coldDiff).toHaveBeenCalledWith('/v')
  })

  it('a rejected plain BridgeError becomes a thrown BridgeRequestError with code / message / path / mtime', async () => {
    bridge.writeFile.mockRejectedValue({ code: 'CONFLICT', message: 'newer on disk', path: '/v/a.md', mtime: 42 })
    const err = await api.writeFile({ path: '/v/a.md', content: '' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BridgeRequestError)
    const e = err as BridgeRequestError
    expect(e.code).toBe('CONFLICT')
    expect(e.message).toBe('newer on disk')
    expect(e.path).toBe('/v/a.md')
    expect(e.mtime).toBe(42)
    expect(e.name).toBe('BridgeRequestError')
    expect('status' in e).toBe(false)
  })

  it('wraps readPdf bridge errors without losing the PDF path', async () => {
    bridge.readPdf.mockRejectedValue({ code: 'TOO_LARGE', message: 'PDF exceeds 52428800 bytes', path: '/v/large.pdf' })
    const err = await api.readPdf('/v/large.pdf').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err).toMatchObject({ code: 'TOO_LARGE', message: 'PDF exceeds 52428800 bytes', path: '/v/large.pdf' })
  })

  it('wraps readImage bridge errors without losing the image path', async () => {
    bridge.readImage.mockRejectedValue({ code: 'TOO_LARGE', message: 'image exceeds 52428800 bytes', path: '/v/large.png' })
    const err = await api.readImage('/v/large.png').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err).toMatchObject({ code: 'TOO_LARGE', message: 'image exceeds 52428800 bytes', path: '/v/large.png' })
  })

  it('properties calls delegate and wrap INVALID_CONFIG like every other code (YAZ-835)', async () => {
    const properties = { get: vi.fn(), setProperty: vi.fn(), removeProperty: vi.fn(), onChange: vi.fn() }
    Object.defineProperty(window.yaseenDraw, 'properties', { value: properties, configurable: true })
    properties.get.mockResolvedValue({ root: '/v', version: 1, properties: {} })
    await expect(api.properties.get('/v')).resolves.toEqual({ root: '/v', version: 1, properties: {} })
    expect(properties.get).toHaveBeenCalledWith('/v')
    await api.properties.setProperty('/v', 'unit', { kind: 'text' })
    expect(properties.setProperty).toHaveBeenCalledWith('/v', 'unit', { kind: 'text' })
    properties.setProperty.mockRejectedValue({ code: 'INVALID_CONFIG', message: 'properties.json is unreadable' })
    const err = (await api.properties.setProperty('/v', 'unit', { kind: 'text' }).catch((e: unknown) => e)) as BridgeRequestError
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err.code).toBe('INVALID_CONFIG')
  })

  it('github calls delegate and pass the status through, onStatus included (YAZ-1081)', async () => {
    const github = { status: vi.fn(), syncNow: vi.fn(), setEnabled: vi.fn(), onStatus: vi.fn() }
    Object.defineProperty(window.yaseenDraw, 'github', { value: github, configurable: true })
    github.status.mockResolvedValue({ root: '/v', state: 'off' })
    await expect(api.github.status('/v')).resolves.toEqual({ root: '/v', state: 'off' })
    expect(github.status).toHaveBeenCalledWith('/v')
    github.setEnabled.mockResolvedValue({ root: '/v', state: 'synced' })
    await expect(api.github.setEnabled('/v', true)).resolves.toEqual({ root: '/v', state: 'synced' })
    expect(github.setEnabled).toHaveBeenCalledWith('/v', true)
    await api.github.syncNow('/v')
    expect(github.syncNow).toHaveBeenCalledWith('/v')
    // onStatus is a pass-through, not a `call` wrapper: the unsubscribe must survive it.
    const off = () => {}
    github.onStatus.mockReturnValue(off)
    const listener = vi.fn()
    expect(api.github.onStatus(listener)).toBe(off)
    expect(github.onStatus).toHaveBeenCalledWith(listener)
  })

  it('a BridgeError without path / mtime leaves those fields undefined', async () => {
    bridge.readFile.mockRejectedValue({ code: 'NOT_FOUND', message: 'path does not exist' })
    const err = (await api.readFile('/v/missing.md').catch((e: unknown) => e)) as BridgeRequestError
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.mtime).toBeUndefined()
    expect(err.path).toBeUndefined()
  })

  it('anything that is not a BridgeError is wrapped as IO_ERROR with its message', async () => {
    bridge.tree.mockRejectedValue(new Error('ipc gone'))
    const err = (await api.tree('/v').catch((e: unknown) => e)) as BridgeRequestError
    expect(err).toBeInstanceOf(BridgeRequestError)
    expect(err.code).toBe('IO_ERROR')
    expect(err.message).toBe('ipc gone')
  })
})
