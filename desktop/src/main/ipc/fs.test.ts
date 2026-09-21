import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { IndexResponse } from '@shared/types'
import { CH, type Envelope } from '../../channels'
import { makeFixture } from '../fs/testFixture'
import { createStore, type Store } from '../store'
import { _evictAll } from '../vaultIndex'
import { fileClip } from '../fileClip'
import * as favorites from '../favorites'
import { registerFsIpc } from './fs'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  // fs:delete goes to the SYSTEM Trash; these tests must not move real files into it, so the
  // trash call is stubbed and the assertions are about the store repair and the broadcast.
  // `remove.test.ts` owns the disk-level behaviour.
  shell: { trashItem: vi.fn(async () => undefined) },
}))
// The favorites.json repair (YAZ-1766 6A, D13) rides the rename/delete handlers; `favorites.test.ts`
// owns its disk behaviour, so here it is a mock whose failure must never fail the file op.
vi.mock('../favorites', () => ({ renamePath: vi.fn(async () => undefined), removePath: vi.fn(async () => undefined) }))

type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>

function registered(channel: string): Handler {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
  if (call === undefined) throw new Error(`no handler registered for ${channel}`)
  return call[1] as unknown as Handler
}

/** A `BrowserWindow` stand-in: only what the broadcaster touches. */
function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  }
}

let root: string
let cleanup: () => Promise<void>
let storeDir: string
let store: Store
beforeAll(async () => {
  ;({ root, cleanup } = await makeFixture())
  storeDir = await mkdtemp(path.join(tmpdir(), 'yd-fs-ipc-'))
  store = createStore(path.join(storeDir, 'yaseendraw.json'))
})
afterAll(async () => {
  _evictAll()
  await store.flush()
  await cleanup()
  await rm(storeDir, { recursive: true, force: true })
})

/** Sender → window id lookup fake (E1b root guard); tests point `senderWinId` at a store entry. */
let senderWinId: string | undefined
const windows = { idFor: () => senderWinId }

describe('registerFsIpc', () => {
  it('registers every fs channel the preload invokes (and nothing else)', () => {
    registerFsIpc(store, windows)
    const channels = vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch).sort()
    expect(channels).toEqual([CH.fsCreateDir, CH.fsCreateFile, CH.fsColdDiff, CH.fsDelete, CH.fsClip, CH.fsPaste, CH.fsClipState, CH.fsIndex, CH.fsRead, CH.fsReadPdf, CH.fsReadImage, CH.fsReadAsset, CH.fsWriteAsset, CH.fsRename, CH.fileRepairRename, CH.fsTree, CH.fsWrite, CH.shellReveal, CH.shellOpenVsCode, CH.shellOpenDefault, CH.shellOpenLink].sort())
  })

  it('answers with an envelope: a tree on success, a BridgeError on failure', async () => {
    const ok = await registered(CH.fsTree)({ sender: {} }, root)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect((ok.value as { root: string }).root).toBe(root)
    const missing = path.join(root, 'missing.md')
    expect(await registered(CH.fsRead)({ sender: {} }, missing)).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'path does not exist', path: missing },
    })
  })

  it('fs:read-asset answers a local image as base64 + mime, errors as a BridgeError envelope (GRO-2139)', async () => {
    const ok = await registered(CH.fsReadAsset)({ sender: {} }, root, 'img.png')
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const value = ok.value as { path: string; mime: string; data: string; size: number }
    expect(value.path).toBe(path.join(root, 'assets-only', 'img.png'))
    expect(value.mime).toBe('image/png')
    expect(Buffer.from(value.data, 'base64').toString('utf8')).toBe('png')
    const missing = await registered(CH.fsReadAsset)({ sender: {} }, root, 'missing.png')
    expect(missing).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: 'no asset with this name under the root', path: 'missing.png' } })
  })

  it('fs:read-pdf answers with PDF bytes as Uint8Array and envelopes binary-boundary failures', async () => {
    const file = path.join(root, 'ipc-report.pdf')
    const bytes = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff])
    await writeFile(file, bytes)

    const ok = await registered(CH.fsReadPdf)({ sender: {} }, file)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect((ok.value as { data: Uint8Array }).data).toBeInstanceOf(Uint8Array)
    expect(Buffer.isBuffer((ok.value as { data: Uint8Array }).data)).toBe(true)
    expect((ok.value as { data: Uint8Array }).data).toEqual(Buffer.from(bytes))
    expect(await registered(CH.fsReadPdf)({ sender: {} }, path.join(root, 'A.md'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'only PDF files can be read as PDF', path: path.join(root, 'A.md') },
    })
  })

  it('fs:read-image answers exact image bytes + MIME and envelopes unsupported paths', async () => {
    const file = path.join(root, 'ipc-image.WEBP')
    const bytes = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xff])
    await writeFile(file, bytes)

    const ok = await registered(CH.fsReadImage)({ sender: {} }, file)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    expect(ok.value).toMatchObject({ path: file, mime: 'image/webp', size: bytes.byteLength })
    expect((ok.value as { data: Uint8Array }).data).toEqual(Buffer.from(bytes))
    expect(await registered(CH.fsReadImage)({ sender: {} }, path.join(root, 'A.md'))).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'only supported raster images can be read as images', path: path.join(root, 'A.md') },
    })
  })

  it('fs:write-asset writes a drawing sidecar and envelopes its failures (YAZ-876)', async () => {
    const req = { root, path: 'assets/drawings/scene.excalidraw', content: '{"type":"excalidraw"}' }
    const ok = await registered(CH.fsWriteAsset)({ sender: {} }, req)
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const file = path.join(root, 'assets', 'drawings', 'scene.excalidraw')
    expect((ok.value as { path: string }).path).toBe(file)
    expect(await readFile(file, 'utf8')).toBe(req.content)
    const bad = await registered(CH.fsWriteAsset)({ sender: {} }, { ...req, path: 'assets/drawings/scene.png' })
    expect(bad).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_EXTENSION', message: 'a text body writes drawing files only', path: path.join(root, 'assets', 'drawings', 'scene.png') },
    })
  })

  it('fs:write-asset takes image BYTES on an image path and passes them through untouched (YAZ-1661)', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    const ok = await registered(CH.fsWriteAsset)({ sender: {} }, { root, path: 'assets/pasted.png', content: bytes })
    expect(ok.ok).toBe(true)
    if (!ok.ok) throw new Error('expected ok')
    const file = path.join(root, 'assets', 'pasted.png')
    expect(ok.value).toMatchObject({ path: file, size: bytes.byteLength })
    expect(await readFile(file)).toEqual(Buffer.from(bytes))
  })

  it('fs:index answers the vault index for the root: markdown records only (GRO-2129)', async () => {
    const res = await registered(CH.fsIndex)({ sender: {} }, root)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    const value = res.value as IndexResponse
    expect(value.root).toBe(root)
    expect(value.records.length).toBeGreaterThan(0)
    expect(value.records.every((r) => r.ext === 'md' || r.ext === 'markdown')).toBe(true)
  })

  it('fs:cold-diff answers null for an unbuilt root and the reconcile diff after fs:index built one (Links E1c, GRO-2242)', async () => {
    expect(await registered(CH.fsColdDiff)({ sender: {} }, path.join(root, 'never-indexed'))).toEqual({ ok: true, value: null })
    expect(await registered(CH.fsColdDiff)({ sender: {} }, 42)).toEqual({ ok: true, value: null }) // non-string root: null, never a throw
    const res = await registered(CH.fsColdDiff)({ sender: {} }, root) // built by the fs:index test above
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    const value = res.value as { root: string; cacheStatus: string; added: unknown[]; removed: unknown[]; changed: unknown[] }
    expect(value.root).toBe(root)
    // No persistent cache in this env → an honest non-hit with EMPTY lists (never "everything added").
    expect(value.cacheStatus).toBe('miss')
    expect(value).toMatchObject({ added: [], removed: [], changed: [] })
  })

  it('file:repair-rename validates the already-moved claim, repairs the store and broadcasts file:renamed (Links E1c, GRO-2242)', async () => {
    const oldPath = path.join(root, 'ext.md')
    const newPath = path.join(root, 'ext2.md')
    await writeFile(oldPath, '# ext\n')
    await rename(oldPath, newPath) // the EXTERNAL mover already moved it — no fs work left
    store.upsertWindow({ id: 'w-ext', root, file: oldPath, tabs: [oldPath], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const res = await registered(CH.fileRepairRename)({ sender: {} }, { oldPath, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
    expect(await readFile(newPath, 'utf8')).toBe('# ext\n') // repair never touches the disk
    // The SAME store repair and push as fs:rename — the E1 downstream is reused whole.
    expect(store.get().windows.find((win) => win.id === 'w-ext')).toMatchObject({ file: newPath, tabs: [newPath] })
    expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath, newPath, kind: 'file' })
  })

  it('file:repair-rename with a live old path answers a BridgeError envelope, repairs nothing and broadcasts nothing', async () => {
    const oldPath = path.join(root, 'A.md') // still on disk — the hypothesis is wrong
    const newPath = path.join(root, 'ext2.md') // exists from the test above
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const before = store.get()
    expect(await registered(CH.fileRepairRename)({ sender: {} }, { oldPath, newPath })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'the old path still exists on disk', path: oldPath },
    })
    expect(store.get()).toBe(before)
    expect(w.webContents.send).not.toHaveBeenCalled()
  })

  it('fs:rename renames on disk, repairs the store and broadcasts file:renamed to every window (Links E1, GRO-2194)', async () => {
    const oldPath = path.join(root, 'b.md')
    const newPath = path.join(root, 'bee.md')
    store.upsertWindow({ id: 'w1', root, file: oldPath, tabs: [oldPath], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    store.setFolder(root, { lastFile: oldPath })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const res = await registered(CH.fsRename)({ sender: {} }, { oldPath, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
    expect(await readFile(newPath, 'utf8')).toBe('# b\n')
    // Store repaired in the SAME handler: window file/tabs and the folder's lastFile follow.
    expect(store.get().windows.find((win) => win.id === 'w1')).toMatchObject({ file: newPath, tabs: [newPath] })
    expect(store.get().folders[root].lastFile).toBe(newPath)
    // Every live window got the push (kind included — a `dir` push remaps by prefix, E1b).
    expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath, newPath, kind: 'file' })
  })

  it('fs:rename refuses the calling window\'s own vault root (E1b, GRO-2241) but allows another window\'s subfolder root', async () => {
    const sub = path.join(root, 'Zeta')
    store.upsertWindow({ id: 'w-sub', root: sub, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    // The caller's OWN root: refused, nothing moves, nothing broadcast.
    senderWinId = 'w-sub'
    expect(await registered(CH.fsRename)({ sender: {} }, { oldPath: sub, newPath: path.join(root, 'Zeta2') })).toEqual({
      ok: false,
      error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be renamed', path: sub },
    })
    expect(w.webContents.send).not.toHaveBeenCalled()
    // The same dir renamed from a window rooted ABOVE it: allowed, and the sub-rooted
    // window's `WindowEntry.root` is repaired by the same handler.
    senderWinId = 'w1'
    const newPath = path.join(root, 'Zeta2')
    const res = await registered(CH.fsRename)({ sender: {} }, { oldPath: sub, newPath })
    expect(res).toEqual({ ok: true, value: { oldPath: sub, newPath, kind: 'dir' } })
    expect(store.get().windows.find((win) => win.id === 'w-sub')?.root).toBe(newPath)
    expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath: sub, newPath, kind: 'dir' })
  })

  it('fs:rename failure answers a BridgeError envelope, repairs nothing and broadcasts nothing', async () => {
    const oldPath = path.join(root, 'A.md')
    const newPath = path.join(root, 'bee.md') // created by the test above
    const w = fakeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
    const before = store.get()
    expect(await registered(CH.fsRename)({ sender: {} }, { oldPath, newPath })).toEqual({
      ok: false,
      error: { code: 'ALREADY_EXISTS', message: 'a file with this name already exists', path: newPath },
    })
    expect(store.get()).toBe(before)
    expect(w.webContents.send).not.toHaveBeenCalled()
  })

  describe('fs:delete (GRO-2272)', () => {
    it('trashes the file, repairs the store and pushes file:deleted to every window', async () => {
      const target = path.join(root, 'delete-me.md')
      await writeFile(target, '# gone\n')
      store.upsertWindow({ id: 'wd', root, file: target, tabs: [target, path.join(root, 'A.md')], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      senderWinId = undefined
      const res = await registered(CH.fsDelete)({ sender: {} }, { path: target })
      expect(res).toEqual({ ok: true, value: { path: target, kind: 'file' } })
      // Store repaired in the SAME handler: the active file went, so the heir took over and
      // the SURVIVING tab is still there (the invariant removePath protects).
      expect(store.get().windows.find((win) => win.id === 'wd')).toMatchObject({ file: path.join(root, 'A.md'), tabs: [path.join(root, 'A.md')] })
      expect(w.webContents.send).toHaveBeenCalledWith(CH.fileDeleted, { path: target, kind: 'file' })
    })

    it("refuses the calling window's own vault root: nothing trashed, nothing broadcast", async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      store.upsertWindow({ id: 'w-own', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      senderWinId = 'w-own'
      expect(await registered(CH.fsDelete)({ sender: {} }, { path: root })).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'the vault root itself cannot be deleted', path: root },
      })
      expect(w.webContents.send).not.toHaveBeenCalled()
      await expect(readFile(path.join(root, 'A.md'), 'utf8')).resolves.toBe('# A\n') // vault intact
      senderWinId = undefined
    })

    it("allows deleting a folder that is ANOTHER window's root — onRootMissing owns that repair, so the stored root is untouched", async () => {
      const sub = path.join(root, 'DeleteMeDir')
      await mkdir(sub, { recursive: true })
      await writeFile(path.join(sub, 'inner.md'), 'inner')
      store.upsertWindow({ id: 'w-other', root: sub, file: path.join(sub, 'inner.md'), tabs: [path.join(sub, 'inner.md')], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      senderWinId = undefined
      expect(await registered(CH.fsDelete)({ sender: {} }, { path: sub })).toEqual({ ok: true, value: { path: sub, kind: 'dir' } })
      const other = store.get().windows.find((win) => win.id === 'w-other')
      expect(other?.root).toBe(sub) // deliberately NOT nulled here
      expect(other?.file).toBeNull() // the file under it went
      expect(w.webContents.send).toHaveBeenCalledWith(CH.fileDeleted, { path: sub, kind: 'dir' })
    })

    it('a refused delete (dot-folder) answers a BridgeError envelope and broadcasts nothing', async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const dot = path.join(root, '.obsidian')
      const res = await registered(CH.fsDelete)({ sender: {} }, { path: dot })
      expect(res).toEqual({ ok: false, error: { code: 'BAD_REQUEST', message: 'hidden entries cannot be deleted', path: dot } })
      expect(w.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('favorites.json repair (YAZ-1766 6A, D13)', () => {
    it('fs:rename and file:repair-rename hand the open roots + paths to favorites.renamePath; a repair failure is warned and the op still answers and broadcasts', async () => {
      const oldPath = path.join(root, 'fav-a.md')
      const newPath = path.join(root, 'fav-b.md')
      await writeFile(oldPath, '# fav\n')
      store.upsertWindow({ id: 'w-fav', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(favorites.renamePath).mockRejectedValueOnce(new Error('favorites.json is read-only'))
      senderWinId = undefined
      expect(await registered(CH.fsRename)({ sender: {} }, { oldPath, newPath })).toEqual({ ok: true, value: { oldPath, newPath, kind: 'file' } })
      expect(vi.mocked(favorites.renamePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), oldPath, newPath)
      expect(w.webContents.send).toHaveBeenCalledWith(CH.fileRenamed, { oldPath, newPath, kind: 'file' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('favorites.json is read-only'))
      // The already-moved repair path takes the same road.
      await rename(newPath, oldPath)
      vi.mocked(favorites.renamePath).mockClear()
      expect(await registered(CH.fileRepairRename)({ sender: {} }, { oldPath: newPath, newPath: oldPath })).toEqual({ ok: true, value: { oldPath: newPath, newPath: oldPath, kind: 'file' } })
      expect(vi.mocked(favorites.renamePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), newPath, oldPath)
      store.removeWindow('w-fav')
    })

    it('fs:delete hands the open roots + path to favorites.removePath; a repair failure is warned and the delete still answers and broadcasts', async () => {
      const target = path.join(root, 'fav-gone.md')
      await writeFile(target, '# gone\n')
      store.upsertWindow({ id: 'w-fav', root, file: null, tabs: [], sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      vi.mocked(favorites.removePath).mockRejectedValueOnce(new Error('boom'))
      senderWinId = undefined
      expect(await registered(CH.fsDelete)({ sender: {} }, { path: target })).toEqual({ ok: true, value: { path: target, kind: 'file' } })
      expect(vi.mocked(favorites.removePath)).toHaveBeenCalledWith(expect.arrayContaining([root]), target)
      expect(w.webContents.send).toHaveBeenCalledWith(CH.fileDeleted, { path: target, kind: 'file' })
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'))
      store.removeWindow('w-fav')
    })
  })

  describe('fs:clip / fs:paste (YAZ-1674)', () => {
    const win = (id: string, file: string | null) =>
      store.upsertWindow({ id, root, file, tabs: file === null ? [] : [file], sidebarCollapsed: false, sidebarLens: 'files', focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 0, y: 0, width: 800, height: 600 } })

    it('fs:clip stores the ordered selection and pushes clip:changed (count + op) to EVERY window (D1)', async () => {
      fileClip.clear()
      const a = fakeWindow()
      const b = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([a as never, b as never])
      const paths = [path.join(root, 'b.md'), path.join(root, 'Zeta')]
      expect(await registered(CH.fsClip)({ sender: {} }, { op: 'copy', paths })).toEqual({ ok: true, value: undefined })
      expect(fileClip.get()).toEqual({ op: 'copy', paths })
      for (const w of [a, b]) expect(w.webContents.send).toHaveBeenCalledExactlyOnceWith(CH.clipChanged, { count: 2, op: 'copy' })
    })

    it('fs:clip with bad input answers a BridgeError envelope, keeps the clipboard and pushes nothing', async () => {
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const before = fileClip.get()
      expect(await registered(CH.fsClip)({ sender: {} }, { op: 'cut', paths: ['relative.md'] })).toEqual({
        ok: false,
        error: { code: 'NOT_ABSOLUTE', message: "'paths' must be an absolute path", path: 'relative.md' },
      })
      expect(await registered(CH.fsClip)({ sender: {} }, { op: 'cut', paths: [] })).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
      expect(fileClip.get()).toBe(before)
      expect(w.webContents.send).not.toHaveBeenCalled()
    })

    it('fs:clip-state answers null when empty and { count, op } after a set — the catch-up read for a window that mounts after a clip', async () => {
      fileClip.clear()
      expect(await registered(CH.fsClipState)({ sender: {} })).toEqual({ ok: true, value: null })
      fileClip.set({ op: 'cut', paths: [path.join(root, 'A.md'), path.join(root, 'b.md')] })
      expect(await registered(CH.fsClipState)({ sender: {} })).toEqual({ ok: true, value: { count: 2, op: 'cut' } })
      fileClip.clear()
    })

    it('fs:paste with an empty clipboard is BAD_REQUEST "nothing to paste"', async () => {
      fileClip.clear()
      expect(await registered(CH.fsPaste)({ sender: {} }, { targetDir: root })).toEqual({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'nothing to paste' },
      })
    })

    it('paste of a COPY copies under a free name, repairs NOTHING, pushes NO file event, and KEEPS the clipboard (D2/D4)', async () => {
      const src = path.join(root, 'copy-src.md')
      await writeFile(src, 'copy me')
      win('w-copy', src)
      fileClip.set({ op: 'copy', paths: [src] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const before = store.get()
      // Into its own folder: Duplicate for free.
      const res = await registered(CH.fsPaste)({ sender: {} }, { targetDir: root })
      expect(res).toEqual({ ok: true, value: { pasted: [{ from: src, to: path.join(root, 'copy-src copy.md'), kind: 'file' }], failed: [] } })
      expect(await readFile(path.join(root, 'copy-src copy.md'), 'utf8')).toBe('copy me')
      expect(await readFile(src, 'utf8')).toBe('copy me')
      expect(store.get()).toBe(before) // nothing moved: no repair
      expect(w.webContents.send).not.toHaveBeenCalled() // no file:renamed, no clip:changed
      expect(fileClip.get()).toEqual({ op: 'copy', paths: [src] }) // a copy pastes again and again
      const again = await registered(CH.fsPaste)({ sender: {} }, { targetDir: root })
      expect(again).toMatchObject({ ok: true, value: { pasted: [{ to: path.join(root, 'copy-src copy 2.md') }] } })
    })

    it('paste of a CUT moves through the rename pipeline — store repaired, file:renamed per entry — then CLEARS the clipboard (D2)', async () => {
      const dir = path.join(root, 'cut-target')
      await mkdir(dir)
      const a = path.join(root, 'cut-a.md')
      const b = path.join(root, 'cut-b.md')
      await writeFile(a, 'a')
      await writeFile(b, 'b')
      win('w-cut', a)
      store.setFolder(root, { lastFile: b })
      fileClip.set({ op: 'cut', paths: [a, b] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const res = await registered(CH.fsPaste)({ sender: {} }, { targetDir: dir })
      const toA = path.join(dir, 'cut-a.md')
      const toB = path.join(dir, 'cut-b.md')
      expect(res).toEqual({ ok: true, value: { pasted: [{ from: a, to: toA, kind: 'file' }, { from: b, to: toB, kind: 'file' }], failed: [] } })
      expect(await readFile(toA, 'utf8')).toBe('a')
      // The SAME downstream as fs:rename, once per entry: window file/tabs and lastFile follow…
      expect(store.get().windows.find((x) => x.id === 'w-cut')).toMatchObject({ file: toA, tabs: [toA] })
      expect(store.get().folders[root].lastFile).toBe(toB)
      // …and every window got file:renamed per entry, then clip:changed null (the cut pasted once).
      expect(w.webContents.send).toHaveBeenNthCalledWith(1, CH.fileRenamed, { oldPath: a, newPath: toA, kind: 'file' })
      expect(w.webContents.send).toHaveBeenNthCalledWith(2, CH.fileRenamed, { oldPath: b, newPath: toB, kind: 'file' })
      expect(w.webContents.send).toHaveBeenNthCalledWith(3, CH.clipChanged, null)
      expect(fileClip.get()).toBeNull()
    })

    it('a CUT whose every entry failed keeps the clipboard (the user fixes the cause and pastes again); the failures ride in the envelope', async () => {
      const dir = path.join(root, 'cut-clash')
      await mkdir(dir)
      await writeFile(path.join(dir, 'same.md'), 'keep')
      const src = path.join(root, 'same.md')
      await writeFile(src, 'incoming')
      fileClip.set({ op: 'cut', paths: [src] })
      const w = fakeWindow()
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([w as never])
      const res = await registered(CH.fsPaste)({ sender: {} }, { targetDir: dir })
      expect(res).toEqual({ ok: true, value: { pasted: [], failed: [{ from: src, code: 'ALREADY_EXISTS', message: 'a file with this name already exists' }] } })
      expect(await readFile(path.join(dir, 'same.md'), 'utf8')).toBe('keep')
      expect(fileClip.get()).toEqual({ op: 'cut', paths: [src] })
      expect(w.webContents.send).not.toHaveBeenCalled()
    })

    it('a missing target folder is a whole-call BridgeError envelope: nothing pasted, clipboard kept', async () => {
      fileClip.set({ op: 'copy', paths: [path.join(root, 'A.md')] })
      const missing = path.join(root, 'no-such-dir')
      expect(await registered(CH.fsPaste)({ sender: {} }, { targetDir: missing })).toEqual({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'path does not exist', path: missing },
      })
      expect(fileClip.get()).not.toBeNull()
      fileClip.clear()
    })
  })
})
