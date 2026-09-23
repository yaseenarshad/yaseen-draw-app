/**
 * What setup and the board operations share (YAZ-1799): `<userData>/sharing.json`, where links
 * point, the upload password, and one request to the user's own Worker. See `sharing.ts` for the
 * whole picture.
 */
import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { CLOUDFLARE_TOKEN_SECRET, SHARE_UPLOAD_PASSWORD_SECRET, type ShareStatus } from '@shared/types'
import { isRecord } from '@shared/guards'
import { atomicWrite, BridgeFailure } from '../fs/fsUtils'
import type { Secrets } from '../secrets'
import { createCloudflareClient, offline, type AssetFile, type CloudflareClient } from './cloudflare'

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
  demoOrigin: string | null
  /** The Worker's module files, uploaded verbatim (`worker.js` is the main module). */
  modules: Record<string, string>
  /** The viewer's static assets (`share/dist/assets/**` as `/assets/…`), read when setup needs them. */
  readAssets: () => Promise<AssetFile[]>
  fetchImpl?: typeof fetch
  /** Told after any change to status or to a vault's shares.json. */
  onChanged?: () => void
  now?: () => number
  /** Waits between the test upload's tries (tests make it instant). */
  sleep?: (ms: number) => Promise<void>
}

/** 144 random bits, URL-safe: the link's only secret (🔒 YAZ-1799 D2 — no encryption). */
export const newShareId = (): string => randomBytes(18).toString('base64url')

/** The Worker answered 401 to the password this app holds. */
export const PASSWORD_REFUSED = "Your share Worker didn't accept this app's upload password."

export interface ShareContext {
  deps: SharingDeps
  doFetch: typeof fetch
  now: () => number
  sleep: (ms: number) => Promise<void>
  changed: () => void
  readConfig(): Promise<SharingConfig | null>
  writeConfig(config: SharingConfig): Promise<void>
  /** Where links point: the demo origin, else the custom domain, else workers.dev. Null before setup. */
  linkOrigin(config: SharingConfig | null): string | null
  /** Everything a Worker call needs, or NOT_SET_UP. */
  ready(): Promise<{ config: SharingConfig; password: string; origin: string }>
  /** A Cloudflare API client on the stored key, or NOT_SET_UP. */
  client(): Promise<CloudflareClient>
  /** One request to the user's own Worker; a network failure is OFFLINE. */
  worker(origin: string, method: string, route: string, password: string | null, body?: string, extraHeaders?: Record<string, string>, timeoutMs?: number): Promise<Response>
  status(): Promise<ShareStatus>
}

export function createContext(deps: SharingDeps): ShareContext {
  const doFetch = deps.fetchImpl ?? fetch
  const password = () => deps.secrets.read(SHARE_UPLOAD_PASSWORD_SECRET)

  async function readConfig(): Promise<SharingConfig | null> {
    try {
      const raw: unknown = JSON.parse(await readFile(deps.configFile, 'utf8'))
      return isRecord(raw) && raw.version === 1 && typeof raw.accountId === 'string' && typeof raw.workersDevUrl === 'string' ? (raw as unknown as SharingConfig) : null
    } catch {
      return null
    }
  }
  const linkOrigin = (config: SharingConfig | null): string | null => deps.demoOrigin ?? (config === null ? null : config.customDomain !== null ? `https://${config.customDomain.hostname}` : config.workersDevUrl)

  return {
    deps,
    doFetch,
    now: deps.now ?? Date.now,
    sleep: deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    changed: () => deps.onChanged?.(),
    readConfig,
    writeConfig: async (config) => void (await atomicWrite(deps.configFile, `${JSON.stringify(config, null, 2)}\n`)),
    linkOrigin,
    async ready() {
      const config = await readConfig()
      const pw = await password()
      const origin = linkOrigin(config)
      if (config === null || pw === null || origin === null) throw new BridgeFailure('NOT_SET_UP', 'Sharing is not set up on this computer yet. Open Settings › Sharing to set it up.')
      return { config, password: pw, origin }
    },
    async client() {
      const token = await deps.secrets.read(CLOUDFLARE_TOKEN_SECRET)
      if (token === null) throw new BridgeFailure('NOT_SET_UP', 'No Cloudflare key is stored. Open Settings › Sharing to set sharing up again.')
      return createCloudflareClient(token, deps.apiBase, doFetch)
    },
    async worker(origin, method, route, pw, body, extraHeaders = {}, timeoutMs = 30_000) {
      const headers: Record<string, string> = { ...extraHeaders }
      if (pw !== null) headers.authorization = `Bearer ${pw}`
      try {
        return await doFetch(`${origin}${route}`, { method, headers, body, signal: AbortSignal.timeout(Math.round(timeoutMs)) })
      } catch (err) {
        console.warn(`[share] ${method} ${route} failed:`, err)
        throw offline('your share Worker', err)
      }
    },
    async status() {
      const config = await readConfig()
      const isReady = config !== null && (await password()) !== null
      return {
        state: isReady ? 'ready' : 'off',
        url: isReady ? linkOrigin(config) : null,
        workersDevUrl: config?.workersDevUrl ?? null,
        customDomain: config?.customDomain?.hostname ?? null,
        accountName: config?.accountName ?? null,
        workerName: config?.workerName ?? null,
        bucketName: config?.bucketName ?? null,
        readyAt: config?.readyAt ?? null,
        demo: deps.demoOrigin !== null,
      }
    },
  }
}
