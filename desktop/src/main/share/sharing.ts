/**
 * SHARING, MAIN'S HALF (YAZ-1799). Owns everything a renderer must never hold:
 * the Cloudflare API token, the Worker's upload password, and every HTTP call. Electron-free —
 * `fetch`, `secrets.ts`, `vaultConfig.ts` and a JSON file in userData — so it tests against a stub.
 *
 *  - `<userData>/sharing.json`: which account, bucket and Worker were provisioned, the
 *    workers.dev address and the custom domain. Not a secret, app-wide (the Cloudflare account
 *    is the user's, not a vault's), never broadcast in app state.
 *  - `secrets.json` (the secrets door): `cloudflareApiToken` + `shareUploadPassword`. The upload
 *    password is generated here and set as the Worker's secret; the user never sees it.
 *  - `<vault>/.yaseendraw/shares.json`: which boards are shared (`shareLinks.ts`).
 *
 * The app talks to Cloudflare's API only to set things up, attach a domain or delete everything;
 * sharing, updating and stopping talk to the user's own Worker with the upload password.
 */
import { randomBytes } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import {
  CLOUDFLARE_TOKEN_SECRET,
  MAX_SHARE_BYTES,
  SHARE_UPLOAD_PASSWORD_SECRET,
  type ShareEntry,
  type ShareListEntry,
  type ShareSetupProgress,
  type ShareSetupStep,
  type ShareStatus,
  type ShareSync,
} from '@shared/types'
import { isRecord } from '@shared/guards'
import { atomicWrite, BridgeFailure, requireAbsPath } from '../fs/fsUtils'
import type { Secrets } from '../secrets'
import { CloudflareError, createCloudflareClient, offline, STEP_PERMISSION, type AssetFile, type CloudflareClient } from './cloudflare'
import { absFromKey, readShares, relKey, updateShares, writeShares, type ShareRecord } from './shareLinks'

export const WORKER_NAME = 'yaseen-draw-share'
export const BUCKET_NAME = 'yaseen-draw-shares'
const MAIN_MODULE = 'worker.js'
const LIVE_CHECK_MS = 5_000

export interface SharingConfig {
  version: 1
  accountId: string
  accountName: string
  bucketName: string
  workerName: string
  workersDevUrl: string
  customDomain: { hostname: string; id: string } | null
  readyAt: number
}

export interface SharingDeps {
  secrets: Secrets
  /** `<userData>/sharing.json`. */
  configFile: string
  /** Cloudflare API base (production: api.cloudflare.com). */
  apiBase: string
  /**
   * DEMO ONLY: the origin every Worker request and every link uses instead of the provisioned
   * address (the fake server can't be reached as `*.workers.dev`). Null in production.
   */
  originOverride: string | null
  /** The Worker's module files, uploaded verbatim (`worker.js` is the main module). */
  modules: Record<string, string>
  /** The viewer's static assets (`share/dist/assets/**` as `/assets/…`), read when setup needs them. */
  readAssets: () => Promise<AssetFile[]>
  fetchImpl?: typeof fetch
  /** Told after any change to status or to a vault's shares.json. */
  onChanged?: () => void
  now?: () => number
}

export interface Sharing {
  status(): Promise<ShareStatus>
  /** Check a key and list the accounts it can see (the picker shows when there is more than one). */
  accounts(token: string): Promise<{ id: string; name: string }[]>
  setup(token: string, progress: (p: ShareSetupProgress) => void, accountId?: string): Promise<ShareStatus>
  get(root: string, path: string): Promise<ShareEntry | null>
  list(root: string): Promise<ShareListEntry[]>
  /** A first share, or (with the `id` the board is shared under) a re-upload after a save. */
  publish(root: string, path: string, content: string, id?: string): Promise<ShareEntry>
  setPermission(root: string, path: string, allowDownload: boolean): Promise<ShareEntry>
  stop(root: string, path: string): Promise<void>
  /** A board (or folder) was renamed or moved inside the app: its shares follow. */
  relocate(roots: readonly string[], oldPath: string, newPath: string): Promise<void>
  /** A board (or folder) was deleted inside the app: its shares are stopped. */
  forget(roots: readonly string[], path: string): Promise<void>
  setDomain(hostname: string | null): Promise<ShareStatus>
  disconnect(root: string | null, deleteEverything: boolean): Promise<ShareStatus>
}

/** 144 random bits, URL-safe: the link's only secret (🔒 YAZ-1799 D2 — no encryption). */
export const newShareId = (): string => randomBytes(18).toString('base64url')

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`
const stripName = (p: string): string => p.split('/').pop()!.replace(/\.excalidraw$/i, '')

/** Plain English for a failed setup step. Written for someone who has never heard of R2. */
export function explainSetupFailure(step: ShareSetupStep, err: unknown): string {
  if (!(err instanceof CloudflareError)) return err instanceof Error ? err.message : String(err)
  if (err.code === 'OFFLINE') return err.message
  if (step === 'verify' && (err.status === 401 || err.status === 403 || err.cfCode === 1000))
    return "Cloudflare didn't accept this key. Check you copied all of it — or press Open Cloudflare and make a new one."
  if (err.cfCode === 10042)
    return "R2 (Cloudflare's file storage) isn't switched on for this account yet. Cloudflare asks for a payment card on file before it turns R2 on — sharing still stays inside the free tier ($0). In the Cloudflare dashboard open R2, add a card when asked, then press Set up again."
  if (err.status === 403) {
    const perm = step === 'bucket' ? STEP_PERMISSION.bucket : step === 'account' ? STEP_PERMISSION.account : STEP_PERMISSION.worker
    return `This key is missing the “${perm}” permission. Press Open Cloudflare to make a new key (the page pre-fills every permission sharing needs) and paste that one.`
  }
  return err.message
}

export function createSharing(deps: SharingDeps): Sharing {
  const doFetch = deps.fetchImpl ?? fetch
  const now = deps.now ?? Date.now
  /**
   * Each shared board's live-link state, keyed by share id — the id survives a rename, a path does
   * not (ALWAYS-LIVE, D3). Memory only: an upload in flight or a failure is a fact about THIS run;
   * the next save re-tells it.
   */
  const syncs = new Map<string, ShareSync>()
  const syncOf = (id: string): ShareSync => syncs.get(id) ?? { state: 'ok' }
  const setSync = (id: string, sync: ShareSync | null) => {
    if (sync === null) syncs.delete(id)
    else syncs.set(id, sync)
    deps.onChanged?.()
  }
  /**
   * Ids the Worker last answered 404 for (the Settings check, or a permission change): the record
   * is here but its copy is gone. The next save re-creates it on the same id — and because that
   * PUT is a create on the Worker, it is the one re-upload that carries the permission.
   */
  const stale = new Set<string>()

  async function readConfig(): Promise<SharingConfig | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(deps.configFile, 'utf8'))
      return isRecord(raw) && raw.version === 1 && typeof raw.accountId === 'string' && typeof raw.workersDevUrl === 'string' ? (raw as unknown as SharingConfig) : null
    } catch {
      return null
    }
  }
  const writeConfig = (config: SharingConfig) => atomicWrite(deps.configFile, `${JSON.stringify(config, null, 2)}\n`)

  /** Where links point: the demo override, else the custom domain, else workers.dev. Null before setup. */
  const linkOrigin = (config: SharingConfig | null): string | null => deps.originOverride ?? (config === null ? null : config.customDomain !== null ? `https://${config.customDomain.hostname}` : config.workersDevUrl)
  const linkFor = (origin: string | null, id: string): string => (origin === null ? '' : `${origin}/b/${id}`)
  const links = (origin: string | null, rec: ShareRecord) => ({ id: rec.id, url: linkFor(origin, rec.id), allowDownload: rec.allowDownload })

  async function ready(): Promise<{ config: SharingConfig; password: string; origin: string }> {
    const config = await readConfig()
    const password = await deps.secrets.read(SHARE_UPLOAD_PASSWORD_SECRET)
    const origin = linkOrigin(config)
    if (config === null || password === null || origin === null) throw new BridgeFailure('NOT_SET_UP', 'Sharing is not set up on this computer yet. Open Settings › Sharing to set it up.')
    return { config, password, origin }
  }
  async function client(): Promise<CloudflareClient> {
    const token = await deps.secrets.read(CLOUDFLARE_TOKEN_SECRET)
    if (token === null) throw new BridgeFailure('NOT_SET_UP', 'No Cloudflare key is stored. Open Settings › Sharing to set sharing up again.')
    return createCloudflareClient(token, deps.apiBase, doFetch)
  }

  /** One request to the user's own Worker. */
  async function worker(origin: string, method: string, route: string, password: string | null, body?: string, extraHeaders: Record<string, string> = {}, timeoutMs = 30_000): Promise<Response> {
    const headers: Record<string, string> = { ...extraHeaders }
    if (password !== null) headers.authorization = `Bearer ${password}`
    try {
      return await doFetch(`${origin}${route}`, { method, headers, body, signal: AbortSignal.timeout(Math.round(timeoutMs)) })
    } catch (err) {
      console.warn(`[share] ${method} ${route} failed:`, err)
      throw offline('your share Worker', err)
    }
  }

  async function status(): Promise<ShareStatus> {
    const config = await readConfig()
    const hasPassword = (await deps.secrets.read(SHARE_UPLOAD_PASSWORD_SECRET)) !== null
    const isReady = config !== null && hasPassword
    return {
      state: isReady ? 'ready' : 'off',
      url: isReady ? linkOrigin(config) : null,
      workersDevUrl: config?.workersDevUrl ?? null,
      customDomain: config?.customDomain?.hostname ?? null,
      accountName: config?.accountName ?? null,
      workerName: config?.workerName ?? null,
      bucketName: config?.bucketName ?? null,
      readyAt: config?.readyAt ?? null,
      demo: deps.originOverride !== null,
    }
  }

  async function accounts(token: string): Promise<{ id: string; name: string }[]> {
    const cf = createCloudflareClient(token.trim(), deps.apiBase, doFetch)
    try {
      await cf.verifyToken()
      return await cf.listAccounts()
    } catch (err) {
      const message = explainSetupFailure('verify', err)
      throw new BridgeFailure(err instanceof BridgeFailure ? err.code : 'PROVIDER_FAILED', message)
    }
  }

  async function setup(token: string, progress: (p: ShareSetupProgress) => void, accountId?: string): Promise<ShareStatus> {
    const trimmed = token.trim()
    if (trimmed === '') throw new BridgeFailure('BAD_REQUEST', 'Paste your Cloudflare API key first.')
    const cf = createCloudflareClient(trimmed, deps.apiBase, doFetch)
    let step: ShareSetupStep = 'verify'
    const run = async <T>(s: ShareSetupStep, fn: () => Promise<T>, done?: (v: T) => string | undefined): Promise<T> => {
      step = s
      progress({ step: s, state: 'running' })
      const value = await fn()
      progress({ step: s, state: 'done', message: done?.(value) })
      return value
    }
    try {
      await run('verify', () => cf.verifyToken(), () => 'Key accepted')
      const account = await run(
        'account',
        async () => {
          const list = await cf.listAccounts()
          if (list.length === 0) throw new BridgeFailure('PROVIDER_FAILED', 'This key cannot see any Cloudflare account. Make the key under the account you want to use.')
          if (accountId !== undefined) {
            const picked = list.find((a) => a.id === accountId)
            if (picked === undefined) throw new BridgeFailure('BAD_REQUEST', 'That account is not visible to this key any more. Pick again.')
            return { first: picked, count: list.length }
          }
          // More than one account and none picked: the Settings page shows a picker first.
          if (list.length > 1) throw new BridgeFailure('BAD_REQUEST', 'This key can see more than one Cloudflare account. Pick which one to use.')
          return { first: list[0], count: 1 }
        },
        ({ first }) => first.name,
      )
      const chosen = account.first.id
      // RECONNECT: an existing bucket and Worker are REUSED, never recreated or emptied — after
      // "Forget key on this Mac" and a new setup, every old link is still there and manageable.
      const hadBucket = await cf.hasBucket(chosen, BUCKET_NAME)
      await run('bucket', () => (hadBucket ? Promise.resolve() : cf.createBucket(chosen, BUCKET_NAME)), () => (hadBucket ? `Found your existing ${BUCKET_NAME} — reusing it (nothing deleted)` : BUCKET_NAME))
      const hadWorker = await cf.hasWorker(chosen, WORKER_NAME)
      const assetsJwt = await run(
        'viewer',
        async () => {
          const files = await deps.readAssets()
          return { jwt: await cf.uploadAssets(chosen, WORKER_NAME, files), count: files.length }
        },
        ({ count }) => `${count} files (the drawing viewer and its fonts)`,
      )
      // The code is re-uploaded either way so the Worker matches this app; the stored boards are untouched.
      await run('worker', () => cf.uploadWorker(chosen, WORKER_NAME, deps.modules, MAIN_MODULE, BUCKET_NAME, assetsJwt.jwt), () => (hadWorker ? `Found your existing ${WORKER_NAME} — updated its code, kept its links` : WORKER_NAME))
      // The token is kept from here on: every later step (and Stop / Delete everything) needs it.
      await deps.secrets.set(CLOUDFLARE_TOKEN_SECRET, trimmed)
      const password = randomBytes(32).toString('base64url')
      await run('secret', async () => {
        // Always a NEW password — on reconnect too: the old one was forgotten with the key.
        await cf.putSecret(chosen, WORKER_NAME, 'UPLOAD_PASSWORD', password)
        await deps.secrets.set(SHARE_UPLOAD_PASSWORD_SECRET, password)
      }, () => 'Stored on this computer only — you never need it')
      const workersDevUrl = await run(
        'subdomain',
        async () => {
          const sub = await cf.getSubdomain(chosen)
          await cf.enableWorkersDev(chosen, WORKER_NAME)
          return `https://${WORKER_NAME}.${sub}.workers.dev`
        },
        (url) => url,
      )
      const previous = await readConfig()
      // A custom domain already attached to the Worker comes back with it (reconnect).
      const attachedDomains = hadWorker ? await cf.listDomains(chosen, WORKER_NAME).catch(() => []) : []
      const customDomain = previous?.accountId === chosen && previous.customDomain !== null ? previous.customDomain : attachedDomains[0] !== undefined ? { hostname: attachedDomains[0].hostname, id: attachedDomains[0].id } : null
      const config: SharingConfig = { version: 1, accountId: chosen, accountName: account.first.name, bucketName: BUCKET_NAME, workerName: WORKER_NAME, workersDevUrl, customDomain, readyAt: now() }
      const origin = linkOrigin(config) as string
      await run('test', () => testRoundTrip(origin, password), () => 'Uploaded, read back and deleted a test file')
      await writeConfig(config)
      deps.onChanged?.()
      return status()
    } catch (err) {
      const message = explainSetupFailure(step, err)
      progress({ step, state: 'failed', message })
      if (err instanceof BridgeFailure) throw new BridgeFailure(err.code, message)
      throw new BridgeFailure('PROVIDER_FAILED', message)
    }
  }

  /** A real upload, read-back and delete. A fresh workers.dev address can take a few seconds to answer, so it retries briefly. */
  async function testRoundTrip(origin: string, password: string): Promise<void> {
    const id = `setup-test-${newShareId()}`
    const body = JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw-setup-test', elements: [], appState: {}, files: {} })
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const put = await worker(origin, 'PUT', `/api/boards/${id}`, password, body, { 'content-type': 'application/json', 'x-board-name': 'setup-test' })
        if (put.status === 401) throw new BridgeFailure('PROVIDER_FAILED', 'The Worker did not accept the upload password it was just given. Press Set up again.')
        if (!put.ok) throw new BridgeFailure('PROVIDER_FAILED', `The test upload failed (HTTP ${put.status}).`)
        const back = await worker(origin, 'GET', `/raw/${id}`, null)
        if (!back.ok || (await back.text()) !== body) throw new BridgeFailure('PROVIDER_FAILED', 'The test file did not read back the same.')
        await worker(origin, 'DELETE', `/api/boards/${id}`, password)
        return
      } catch (err) {
        lastError = err
        if (err instanceof BridgeFailure && err.code === 'PROVIDER_FAILED') throw err
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    throw lastError
  }

  async function entryFor(root: string, key: string, rec: ShareRecord): Promise<ShareEntry> {
    const origin = linkOrigin(await readConfig())
    const abs = absFromKey(root, key)
    return { path: abs, ...links(origin, rec), sharedAt: rec.sharedAt, updatedAt: rec.updatedAt, sync: syncOf(rec.id), stale: stale.has(rec.id) }
  }

  async function get(root: string, path: string): Promise<ShareEntry | null> {
    const r = requireAbsPath(root, 'root')
    const key = relKey(r, requireAbsPath(path, 'path'))
    const rec = (await readShares(r))[key]
    return rec === undefined ? null : entryFor(r, key, rec)
  }

  async function list(root: string): Promise<ShareListEntry[]> {
    const r = requireAbsPath(root, 'root')
    const shares = await readShares(r)
    const origin = linkOrigin(await readConfig())
    return Promise.all(
      Object.entries(shares).map(async ([key, rec]): Promise<ShareListEntry> => {
        const abs = absFromKey(r, key)
        const fileExists = await stat(abs).then((s) => s.isFile(), () => false)
        let live: ShareListEntry['live'] = 'unknown'
        if (origin !== null) {
          try {
            // `/scene`, not `/raw`: a view-only board answers 403 on `/raw` and would read as broken.
            const res = await doFetch(`${origin}/scene/${rec.id}`, { method: 'HEAD', signal: AbortSignal.timeout(LIVE_CHECK_MS) })
            live = res.status === 200 ? 'live' : res.status === 404 ? 'missing' : 'unknown'
            if (live === 'missing') stale.add(rec.id)
            else if (live === 'live') stale.delete(rec.id)
          } catch {
            live = 'unknown'
          }
        }
        return { path: abs, ...links(origin, rec), sharedAt: rec.sharedAt, updatedAt: rec.updatedAt, sync: syncOf(rec.id), stale: stale.has(rec.id), fileExists, live }
      }),
    ).then((rows) => rows.sort((a, b) => b.updatedAt - a.updatedAt))
  }

  /**
   * First share, or an automatic re-upload after a save. Every outcome of a board that is ALREADY
   * shared is recorded in `syncs` (uploading → ok | failed + reason) so the Share dialog and the
   * Settings list can say "Up to date", "Uploading…" or "Couldn't update: …". The record in
   * shares.json is kept on failure — the next save retries.
   *
   * A re-upload names the link (`id`) it is for, and lands on that record wherever an in-app
   * rename has moved it since the save; if the board was stopped meanwhile it is refused, never
   * quietly shared again under a new link.
   */
  async function publish(root: string, path: string, content: string, id?: string): Promise<ShareEntry> {
    const r = requireAbsPath(root, 'root')
    const key = relKey(r, requireAbsPath(path, 'path'))
    const shares = await readShares(r)
    const found = id === undefined ? (shares[key] === undefined ? undefined : ([key, shares[key]] as const)) : Object.entries(shares).find(([, rec]) => rec.id === id)
    if (id !== undefined && found === undefined) throw new BridgeFailure('NOT_FOUND', 'This board is not shared any more.')
    const existing = found?.[1]
    if (existing !== undefined) setSync(existing.id, { state: 'uploading' })
    try {
      const entry = await upload(r, found?.[0] ?? key, existing, content)
      if (existing !== undefined) setSync(existing.id, null)
      return { ...entry, sync: { state: 'ok' } }
    } catch (err) {
      if (existing !== undefined) setSync(existing.id, { state: 'failed', message: err instanceof Error ? err.message : String(err), failedAt: now() })
      throw err
    }
  }

  async function upload(r: string, key: string, existing: ShareRecord | undefined, content: string): Promise<ShareEntry> {
    if (typeof content !== 'string' || content === '') throw new BridgeFailure('BAD_REQUEST', "'content' must be the board's text")
    const size = Buffer.byteLength(content)
    if (size > MAX_SHARE_BYTES)
      throw new BridgeFailure('TOO_LARGE', `This board is ${mb(size)} once its images are packed in, and Cloudflare's free plan accepts at most ${mb(MAX_SHARE_BYTES)} per upload. Use fewer or smaller images, or split the board.`)
    const { password, origin } = await ready()
    const id = existing?.id ?? newShareId()
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-board-name': encodeURIComponent(stripName(key)) }
    // The permission travels only when the PUT creates the object: a new share ("can view and
    // download") or a stale one coming back. A plain re-upload never carries it, so it can never
    // undo a permission change — that is PATCH's alone.
    if (existing === undefined || stale.has(id)) headers['x-allow-download'] = (existing?.allowDownload ?? true) ? '1' : '0'
    // Big boards get more time: a minute plus ~2 s per MB (a slow uplink moves ~0.5 MB/s).
    const res = await worker(origin, 'PUT', `/api/boards/${id}`, password, content, headers, Math.round(60_000 + (size / 1_000_000) * 2_000))
    if (res.status === 401) throw new BridgeFailure('PROVIDER_FAILED', "Your share Worker didn't accept this app's upload password. Open Settings › Sharing and run Set up sharing again.")
    if (res.status === 413) throw new BridgeFailure('TOO_LARGE', `Cloudflare refused the upload as too large (${mb(size)}; the limit is ${mb(MAX_SHARE_BYTES)}).`)
    if (!res.ok) throw new BridgeFailure('PROVIDER_FAILED', `The upload failed (HTTP ${res.status}). Try again in a moment.`)
    stale.delete(id)
    const t = now()
    let saved: [string, ShareRecord] | undefined
    await updateShares(r, (shares) => {
      // Found by id: a rename may have moved the record while the upload ran.
      const at = existing === undefined ? key : Object.keys(shares).find((k) => shares[k].id === id)
      if (at === undefined) return false
      shares[at] = { id, allowDownload: shares[at]?.allowDownload ?? true, sharedAt: shares[at]?.sharedAt ?? t, updatedAt: t }
      saved = [at, shares[at]]
      return true
    })
    if (saved === undefined) {
      // Stopped while this upload ran: the stop's DELETE may have landed first, so this PUT put the
      // board back. Take it down again — a stopped link stays dead.
      await worker(origin, 'DELETE', `/api/boards/${id}`, password).catch(() => undefined)
      throw new BridgeFailure('NOT_FOUND', 'This board is not shared any more.')
    }
    deps.onChanged?.()
    return entryFor(r, saved[0], saved[1])
  }

  /** "can view and download" ⇄ "can view only" on the SAME link: one PATCH, no re-upload. */
  async function setPermission(root: string, path: string, allowDownload: boolean): Promise<ShareEntry> {
    const r = requireAbsPath(root, 'root')
    const key = relKey(r, requireAbsPath(path, 'path'))
    const rec = (await readShares(r))[key]
    if (rec === undefined) throw new BridgeFailure('NOT_FOUND', 'This board is not shared.')
    const { password, origin } = await ready()
    const res = await worker(origin, 'PATCH', `/api/boards/${rec.id}`, password, JSON.stringify({ allowDownload }), { 'content-type': 'application/json' })
    if (res.status === 401) throw new BridgeFailure('PROVIDER_FAILED', "Your share Worker didn't accept this app's upload password. Open Settings › Sharing and run Set up sharing again.")
    if (res.status === 404) {
      stale.add(rec.id)
      throw new BridgeFailure('PROVIDER_FAILED', 'The shared copy is gone from Cloudflare, so there is nothing to change. Save the board once to put it back, then try again.')
    }
    if (!res.ok) throw new BridgeFailure('PROVIDER_FAILED', `Changing access failed (HTTP ${res.status}). Try again.`)
    let saved: [string, ShareRecord] = [key, { ...rec, allowDownload }]
    await updateShares(r, (shares) => {
      const at = Object.keys(shares).find((k) => shares[k].id === rec.id)
      if (at === undefined) return false
      shares[at] = { ...shares[at], allowDownload }
      saved = [at, shares[at]]
      return true
    })
    deps.onChanged?.()
    return entryFor(r, saved[0], saved[1])
  }

  async function stop(root: string, path: string): Promise<void> {
    const r = requireAbsPath(root, 'root')
    const key = relKey(r, requireAbsPath(path, 'path'))
    const rec = (await readShares(r))[key]
    if (rec === undefined) return
    const { password, origin } = await ready()
    const res = await worker(origin, 'DELETE', `/api/boards/${rec.id}`, password)
    if (res.status === 401) throw new BridgeFailure('PROVIDER_FAILED', "Your share Worker didn't accept this app's upload password, so the link is still live. Run Set up sharing again, then Stop.")
    if (!res.ok && res.status !== 404) throw new BridgeFailure('PROVIDER_FAILED', `Stopping failed (HTTP ${res.status}); the link may still work. Try again.`)
    await updateShares(r, (shares) => {
      const at = Object.keys(shares).find((k) => shares[k].id === rec.id)
      if (at !== undefined) delete shares[at]
      return at !== undefined
    })
    stale.delete(rec.id)
    setSync(rec.id, null)
  }

  async function setDomain(hostname: string | null): Promise<ShareStatus> {
    const config = await readConfig()
    if (config === null) throw new BridgeFailure('NOT_SET_UP', 'Set up sharing first, then attach a domain.')
    const cf = await client()
    if (hostname === null) {
      if (config.customDomain !== null) await cf.detachDomain(config.accountId, config.customDomain.id)
      await writeConfig({ ...config, customDomain: null })
      deps.onChanged?.()
      return status()
    }
    const host = hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!HOSTNAME_RE.test(host)) throw new BridgeFailure('BAD_REQUEST', `“${hostname}” doesn't look like a domain. Type something like share.yourdomain.com.`)
    // The zone is the account's zone with the LONGEST name that the host ends with — so
    // share.example.co.uk finds example.co.uk, never co.uk, and a sub-zone beats its parent.
    const zones = await cf.listZones(config.accountId)
    const zone = zones.filter((z) => host === z.name || host.endsWith(`.${z.name}`)).sort((a, b) => b.name.length - a.name.length)[0]
    if (zone === undefined) throw new BridgeFailure('PROVIDER_FAILED', `${host} isn't under any domain on your Cloudflare account yet. Add the domain to Cloudflare first (the steps are below), wait until Cloudflare says it is Active, then try again.`)
    if (config.customDomain !== null && config.customDomain.hostname !== host) await cf.detachDomain(config.accountId, config.customDomain.id)
    const attached = await cf.attachDomain(config.accountId, host, config.workerName, zone.id)
    await writeConfig({ ...config, customDomain: { hostname: host, id: attached.id } })
    deps.onChanged?.()
    return status()
  }

  async function disconnect(root: string | null, deleteEverything: boolean): Promise<ShareStatus> {
    const config = await readConfig()
    if (deleteEverything && config !== null) {
      const password = await deps.secrets.read(SHARE_UPLOAD_PASSWORD_SECRET)
      const origin = linkOrigin(config)
      // The Worker deletes one page (≤1,000 objects) per request, so one request stays under the free
      // plan's subrequest cap; it answers `done` once the bucket is empty. (A Worker from before paging
      // answers no `done` — it deleted everything in one go.)
      for (let done = password === null || origin === null; !done; ) {
        const res = await worker(origin!, 'POST', '/api/wipe', password)
        if (!res.ok) throw new BridgeFailure('PROVIDER_FAILED', `Could not delete the shared boards (HTTP ${res.status}); nothing was disconnected. Try again.`)
        done = ((await res.json().catch(() => ({}))) as { done?: unknown }).done !== false
      }
      const cf = await client()
      if (config.customDomain !== null) await cf.detachDomain(config.accountId, config.customDomain.id)
      await cf.deleteWorker(config.accountId, config.workerName)
      await cf.deleteBucket(config.accountId, config.bucketName)
      if (root !== null) await writeShares(requireAbsPath(root, 'root'), {})
    }
    await deps.secrets.set(CLOUDFLARE_TOKEN_SECRET, null)
    await deps.secrets.set(SHARE_UPLOAD_PASSWORD_SECRET, null)
    await rm(deps.configFile, { force: true })
    deps.onChanged?.()
    return status()
  }

  /** `abs` is `base` or inside it. */
  const within = (abs: string, base: string) => abs === base || abs.startsWith(`${base}/`)
  /** The open vault holding `abs` — the deepest one, if vaults nest. */
  const rootOf = (roots: readonly string[], abs: string) => [...roots].filter((r) => within(abs, r) && abs !== r).sort((a, b) => b.length - a.length)[0] ?? null

  async function relocate(roots: readonly string[], oldPath: string, newPath: string): Promise<void> {
    for (const root of new Set(roots)) {
      // Records leaving this vault for another open one: [that vault, new path, record].
      const leaving: [string, string, ShareRecord][] = []
      await updateShares(root, (shares) => {
        let changed = false
        for (const [key, rec] of Object.entries(shares)) {
          const fromAbs = absFromKey(root, key)
          if (!within(fromAbs, oldPath)) continue
          const toAbs = newPath + fromAbs.slice(oldPath.length)
          const target = rootOf(roots, toAbs)
          delete shares[key]
          changed = true
          // Out of every open vault: dropped here, and the link keeps its last upload (nothing can update it).
          if (target === root) shares[relKey(root, toAbs)] = rec
          else if (target !== null) leaving.push([target, toAbs, rec])
        }
        return changed
      })
      // Moved into ANOTHER open vault (a cross-vault cut-paste): the record goes with it.
      for (const [target, toAbs, rec] of leaving) {
        await updateShares(target, (shares) => {
          shares[relKey(target, toAbs)] = rec
          return true
        })
      }
    }
    deps.onChanged?.()
  }

  async function forget(roots: readonly string[], path: string): Promise<void> {
    for (const root of new Set(roots)) {
      const shares = await readShares(root)
      for (const key of Object.keys(shares)) {
        const abs = absFromKey(root, key)
        if (!within(abs, path)) continue
        try {
          await stop(root, abs)
        } catch (err) {
          // Offline or not set up: keep the record so Settings lists it ("no board at this path") and it can be stopped later.
          console.warn(`[share] could not stop the share of deleted ${abs}: ${String(err)}`)
        }
      }
    }
  }

  return { status, accounts, setup, get, list, publish, setPermission, stop, relocate, forget, setDomain, disconnect }
}
