import { readdir, readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { shell } from 'electron'
import { isRecord } from '@shared/guards'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import type { Secrets } from '../secrets'
import { CLOUDFLARE_API, CLOUDFLARE_TOKEN_PAGE, type AssetFile } from '../share/cloudflare'
import { shareFsHooks } from '../share/fsHooks'
import { createSharing } from '../share/sharing'
import workerSource from '../../../../share/worker.js?raw'
import viewerSource from '../../../../share/viewer/page.js?raw'
import { broadcastAll } from './broadcast'
import { handle, handleWithEvent } from './envelope'

/**
 * The `share.*` half of `window.yaseenDraw` (YAZ-1799). Every request is shape-checked
 * here; the token crosses the bridge exactly once (renderer → main, in `share:setup`) and is never
 * sent back. Progress goes to the window that asked; changes go to every window.
 *
 * DEMO SWITCHES (both absent in production):
 *  - `YASEEN_DRAW_CLOUDFLARE_API` — the Cloudflare API base (`tools/fakeCloudflare.mjs` in the demo).
 *  - `YASEEN_DRAW_SHARE_ORIGIN` — where Worker requests and links go instead of `*.workers.dev`.
 */
const req = (v: unknown): Record<string, unknown> => {
  if (!isRecord(v)) throw new BridgeFailure('BAD_REQUEST', 'missing request')
  return v
}
const str = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || v === '') throw new BridgeFailure('BAD_REQUEST', `'${name}' must be a non-empty string`)
  return v
}

/**
 * Where the viewer's built assets live (`tools/buildShareViewer.mjs` → `share/dist/assets/`, part of
 * `npm run build`): the packaged app carries them as the `share-viewer` extraResource; dev reads the
 * repo checkout beside `desktop/`.
 */
export function viewerAssetsDir({ isPackaged, resourcesPath, appPath }: { isPackaged: boolean; resourcesPath: string; appPath: string }): string {
  return isPackaged ? join(resourcesPath, 'share-viewer') : join(appPath, '..', 'share', 'dist', 'assets')
}

/** The viewer's built assets, served as `/assets/…`. */
async function readViewerAssets(dir: string): Promise<AssetFile[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => {
    throw new BridgeFailure('NOT_FOUND', 'The viewer page is not built on this computer (run: npm run build), so sharing cannot be set up yet.')
  })
  const files = entries.filter((e) => e.isFile())
  return Promise.all(
    files.map(async (e) => {
      const abs = join(e.parentPath, e.name)
      return { path: `/assets/${relative(dir, abs).split(sep).join('/')}`, bytes: new Uint8Array(await readFile(abs)) }
    }),
  )
}

export function registerShareIpc(userData: string, secrets: Secrets, viewerAssetsDir: string): void {
  const apiBase = process.env.YASEEN_DRAW_CLOUDFLARE_API?.trim() || CLOUDFLARE_API
  const originOverride = process.env.YASEEN_DRAW_SHARE_ORIGIN?.trim().replace(/\/+$/, '') || null
  const sharing = createSharing({
    secrets,
    configFile: join(userData, 'sharing.json'),
    apiBase,
    originOverride,
    // Uploaded verbatim: the same two files `tools/fakeCloudflare.mjs` imports and runs.
    modules: { 'worker.js': workerSource, 'viewer/page.js': viewerSource },
    readAssets: () => readViewerAssets(viewerAssetsDir),
    onChanged: () => broadcastAll(CH.shareChanged),
  })
  // Shares follow in-app renames, moves and deletes (the fs IPC calls these beside its favorites repair).
  shareFsHooks.renamed = (roots, oldPath, newPath) => sharing.relocate(roots, oldPath, newPath)
  shareFsHooks.deleted = (roots, path) => sharing.forget(roots, path)
  // The demo's token page lives on the fake server; production opens Cloudflare's own, pre-filled.
  const tokenPage = apiBase === CLOUDFLARE_API ? CLOUDFLARE_TOKEN_PAGE : `${new URL(apiBase).origin}/__fake/token-page`

  handle(CH.shareStatus, () => sharing.status())
  handle(CH.shareAccounts, async (body: unknown) => sharing.accounts(str(req(body).token, 'token')))
  handleWithEvent(CH.shareSetup, (e, body: unknown) => {
    const r = req(body)
    if (r.accountId !== undefined && typeof r.accountId !== 'string') throw new BridgeFailure('BAD_REQUEST', "'accountId' must be a string")
    return sharing.setup(str(r.token, 'token'), (p) => e.sender.isDestroyed() || e.sender.send(CH.shareSetupProgress, p), r.accountId)
  })
  handle(CH.shareOpenCloudflare, async () => void (await shell.openExternal(tokenPage)))
  handle(CH.shareOpenLink, async (body: unknown) => {
    const url = new URL(str(req(body).url, 'url'))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BridgeFailure('BAD_REQUEST', 'only web links open here')
    await shell.openExternal(url.href)
  })
  handle(CH.shareGet, async (body: unknown) => {
    const r = req(body)
    return sharing.get(str(r.root, 'root'), str(r.path, 'path'))
  })
  handle(CH.shareList, async (body: unknown) => sharing.list(str(req(body).root, 'root')))
  handle(CH.sharePublish, async (body: unknown) => {
    const r = req(body)
    if (r.id !== undefined && typeof r.id !== 'string') throw new BridgeFailure('BAD_REQUEST', "'id' must be a string")
    return sharing.publish(str(r.root, 'root'), str(r.path, 'path'), str(r.content, 'content'), r.id)
  })
  handle(CH.shareSetPermission, async (body: unknown) => {
    const r = req(body)
    if (typeof r.allowDownload !== 'boolean') throw new BridgeFailure('BAD_REQUEST', "'allowDownload' must be a boolean")
    return sharing.setPermission(str(r.root, 'root'), str(r.path, 'path'), r.allowDownload)
  })
  handle(CH.shareStop, async (body: unknown) => {
    const r = req(body)
    return sharing.stop(str(r.root, 'root'), str(r.path, 'path'))
  })
  handle(CH.shareSetDomain, async (body: unknown) => {
    const h = req(body).hostname
    if (h !== null && typeof h !== 'string') throw new BridgeFailure('BAD_REQUEST', "'hostname' must be a string or null")
    return sharing.setDomain(h === null || h.trim() === '' ? null : h)
  })
  handle(CH.shareDisconnect, async (body: unknown) => {
    const r = req(body)
    if (r.root !== null && typeof r.root !== 'string') throw new BridgeFailure('BAD_REQUEST', "'root' must be a string or null")
    return sharing.disconnect(r.root, r.deleteEverything === true)
  })
}
