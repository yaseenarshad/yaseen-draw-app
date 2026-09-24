import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ipcMain } from 'electron'
import { CH, type Envelope } from '../../channels'
import { CLOUDFLARE_API, CLOUDFLARE_TOKEN_PAGE } from '../share/cloudflare'
import { createSecrets } from '../secrets'
import { readViewerAssets, registerShareIpc, shareEndpoints, viewerAssetsDir } from './share'

vi.mock('electron', () => ({ shell: { openExternal: vi.fn() }, BrowserWindow: { getAllWindows: () => [] }, ipcMain: { handle: vi.fn(), on: vi.fn() } }))

describe('viewerAssetsDir', () => {
  const where = { resourcesPath: '/Applications/Yaseen Draw.app/Contents/Resources', appPath: '/repo/desktop' }

  it('reads the extraResource inside a packaged app', () => {
    expect(viewerAssetsDir({ ...where, isPackaged: true })).toBe(path.join(where.resourcesPath, 'share-viewer'))
  })

  it('reads the repo checkout beside desktop/ in dev', () => {
    expect(viewerAssetsDir({ ...where, isPackaged: false })).toBe(path.join('/repo', 'share', 'dist', 'assets'))
  })
})

describe('readViewerAssets (🔒 YAZ-1802 D5 / D11)', () => {
  let root = ''
  beforeEach(async () => void (root = await mkdtemp(path.join(tmpdir(), 'yaz-1973-assets-'))))
  afterEach(async () => rm(root, { recursive: true, force: true }))
  const put = async (file: string, text: string) => {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text)
  }

  it("publishes the viewer build as /assets/…, and draw.io's viewer, stencils, licence, image and MathJax folders from the app's own webapp", async () => {
    const viewer = path.join(root, 'share-viewer')
    const drawio = path.join(root, 'drawio')
    await put(path.join(viewer, 'viewer.js'), 'viewer')
    await put(path.join(viewer, 'drawio', 'config.js'), 'config')
    for (const file of ['js/viewer-static.min.js', 'js/stencils.min.js', 'LICENSE-drawio.txt', 'js/app.min.js', 'img/lib/azure/VM.svg', 'math4/es5/startup.js']) await put(path.join(drawio, file), file)
    const assets = await readViewerAssets(viewer, drawio)
    expect(Object.fromEntries(assets.map((a) => [a.path, new TextDecoder().decode(a.bytes)]))).toEqual({
      '/assets/viewer.js': 'viewer',
      '/assets/drawio/config.js': 'config',
      '/assets/drawio/js/viewer-static.min.js': 'js/viewer-static.min.js',
      '/assets/drawio/js/stencils.min.js': 'js/stencils.min.js',
      '/assets/drawio/LICENSE-drawio.txt': 'LICENSE-drawio.txt',
      '/assets/drawio/img/lib/azure/VM.svg': 'img/lib/azure/VM.svg',
      '/assets/drawio/math4/es5/startup.js': 'math4/es5/startup.js',
    })
  })

  it('refuses to set up with no viewer build or no draw.io webapp, rather than upload a page that cannot draw', async () => {
    await put(path.join(root, 'share-viewer', 'viewer.js'), 'viewer')
    await expect(readViewerAssets(path.join(root, 'nothing'), root)).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('npm run build') })
    await expect(readViewerAssets(path.join(root, 'share-viewer'), path.join(root, 'no-drawio'))).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('npm run drawio:pack') })
  })
})

describe('shareEndpoints — the demo switches are dev-only', () => {
  const demo = { YASEEN_DRAW_CLOUDFLARE_API: 'http://127.0.0.1:8799/client/v4', YASEEN_DRAW_SHARE_ORIGIN: 'http://localhost:8799/' }

  it('a packaged app ignores both env vars: the real token only ever goes to the real Cloudflare', () => {
    expect(shareEndpoints(true, demo)).toEqual({ apiBase: CLOUDFLARE_API, demoOrigin: null, tokenPage: CLOUDFLARE_TOKEN_PAGE })
  })

  it('a dev build honours them, and the token page follows the fake API', () => {
    expect(shareEndpoints(false, demo)).toEqual({ apiBase: demo.YASEEN_DRAW_CLOUDFLARE_API, demoOrigin: 'http://localhost:8799', tokenPage: 'http://127.0.0.1:8799/__fake/token-page' })
  })

  it('a dev build with neither set is production', () => {
    expect(shareEndpoints(false, { YASEEN_DRAW_CLOUDFLARE_API: ' ', YASEEN_DRAW_SHARE_ORIGIN: '' })).toEqual({ apiBase: CLOUDFLARE_API, demoOrigin: null, tokenPage: CLOUDFLARE_TOKEN_PAGE })
  })
})

describe('registerShareIpc refuses malformed requests before sharing sees them', () => {
  type Handler = (event: unknown, ...args: unknown[]) => Promise<Envelope<unknown>>
  const registered = (channel: string): Handler => {
    const call = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === channel)
    if (call === undefined) throw new Error(`no handler registered for ${channel}`)
    return call[1] as unknown as Handler
  }
  const bad = expect.objectContaining({ ok: false, error: expect.objectContaining({ code: 'BAD_REQUEST' }) })
  const sender = { id: 1, isDestroyed: () => false, send: vi.fn() }
  let userData: string
  beforeEach(async () => {
    vi.mocked(ipcMain.handle).mockClear()
    userData = await mkdtemp(path.join(tmpdir(), 'yd-share-ipc-'))
    registerShareIpc(userData, createSecrets(path.join(userData, 'secrets.json')), { viewerAssetsDir: path.join(userData, 'none'), drawioDir: path.join(userData, 'none'), isPackaged: true })
  })
  afterEach(() => rm(userData, { recursive: true, force: true }))

  it('has no open-link channel (nothing called it)', () => {
    expect(vi.mocked(ipcMain.handle).mock.calls.map(([ch]) => ch)).not.toContain('share:open-link')
  })

  it.each([
    [CH.shareAccounts, [undefined, {}, { token: '' }, { token: 3 }]],
    [CH.shareSetup, [undefined, { token: '' }, { token: 't', accountId: 3 }]],
    [CH.shareGet, [{ root: '/v' }, { path: 'a.excalidraw' }, { root: '', path: 'a' }]],
    [CH.shareList, [{}, { root: 1 }, { root: '/v', check: 'no' }]],
    [CH.sharePublish, [{ root: '/v', path: 'a' }, { root: '/v', path: 'a', content: 'x', id: 7 }]],
    [CH.shareSetPermission, [{ root: '/v', path: 'a' }, { root: '/v', path: 'a', allowDownload: 'yes' }]],
    [CH.shareStop, [{ root: '/v' }, null]],
    [CH.shareSetDomain, [{}, { hostname: 5 }]],
    [CH.shareDisconnect, [{}, { root: 5, deleteEverything: true }]],
  ])('%s refuses %j with BAD_REQUEST', async (channel, requests) => {
    for (const r of requests) expect(await registered(channel)({ sender }, r)).toEqual(bad)
  })
})
