import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLOUDFLARE_TOKEN_SECRET, SHARE_UPLOAD_PASSWORD_SECRET, type ShareSetupProgress } from '@shared/types'
// The REAL Worker (plain JS, the file Cloudflare runs), driven in-process against a Map bucket.
// @ts-expect-error — untyped JS module
import { handle as workerHandle } from '../../../../share/worker.js'
import { createSecrets } from '../secrets'
import { createSharing, type Sharing } from './sharing'

const API = 'https://api.test/client/v4'
const ORIGIN = 'https://share.test'

/** A Map-backed R2 bucket: exactly the five calls the Worker makes. */
function memoryBucket() {
  const objects = new Map<string, { bytes: Uint8Array<ArrayBuffer>; customMetadata: Record<string, string> }>()
  return {
    objects,
    async put(key: string, body: ArrayBuffer | string, opts: { customMetadata?: Record<string, string> }) {
      objects.set(key, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), customMetadata: opts.customMetadata ?? {} })
    },
    async head(key: string) {
      const o = objects.get(key)
      return o === undefined ? null : { key, size: o.bytes.length, customMetadata: o.customMetadata }
    },
    async get(key: string) {
      const o = objects.get(key)
      return o === undefined ? null : { key, size: o.bytes.length, customMetadata: o.customMetadata, body: new Blob([o.bytes]).stream() }
    },
    async delete(key: string) {
      objects.delete(key)
    },
    async list({ prefix = '' } = {}) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }
    },
  }
}

let dir: string
let vault: string
let bucket: ReturnType<typeof memoryBucket>
let workerSecret: string | undefined
let online: boolean
let sharing: Sharing

const ok = (result: unknown) => Response.json({ success: true, errors: [], result })
const notFound = () => Response.json({ success: false, errors: [{ code: 10006, message: 'not found' }], result: null }, { status: 404 })
/** The fake account: what exists on it survives a "Forget key" + re-setup (reconnect). */
let account: { accounts: { id: string; name: string }[]; buckets: Set<string>; scripts: Set<string>; domains: { id: string; hostname: string; service: string }[]; zones: string[]; assetUploads: number; attached: string[] }
const fakeFetch: typeof fetch = async (input, init) => {
  if (!online) throw new TypeError('fetch failed')
  const url = new URL(String(input))
  if (url.href.startsWith(API)) {
    const route = url.pathname.replace('/client/v4', '')
    const method = init?.method ?? 'GET'
    if (route === '/user/tokens/verify') return ok({ status: 'active' })
    if (route === '/accounts') return ok(account.accounts)
    if (route === '/zones') return ok(account.zones.map((name) => ({ id: `z-${name}`, name })))
    if (/\/r2\/buckets\/[^/]+$/.test(route) && method === 'GET') return account.buckets.has(route.split('/').pop() as string) ? ok({}) : notFound()
    if (route.endsWith('/r2/buckets') && method === 'POST') {
      account.buckets.add(JSON.parse(String(init?.body)).name)
      return ok({})
    }
    if (route.endsWith('/workers/scripts') && method === 'GET') return ok([...account.scripts].map((id) => ({ id })))
    if (route.endsWith('/assets-upload-session')) return ok({ jwt: 'session', buckets: [['h1']] })
    if (route.endsWith('/workers/assets/upload')) {
      account.assetUploads++
      return ok({ jwt: 'done' })
    }
    if (/\/workers\/scripts\/[^/]+$/.test(route) && method === 'PUT') {
      account.scripts.add(route.split('/').pop() as string)
      return ok({})
    }
    if (route.endsWith('/workers/domains') && method === 'GET') return ok(account.domains)
    if (route.endsWith('/workers/domains') && method === 'PUT') {
      const body = JSON.parse(String(init?.body))
      account.attached.push(`${body.hostname}@${body.zone_id}`)
      account.domains.push({ id: `d-${body.hostname}`, hostname: body.hostname, service: body.service })
      return ok({ id: `d-${body.hostname}` })
    }
    if (route.endsWith('/secrets')) {
      workerSecret = JSON.parse(String(init?.body)).text
      return ok({})
    }
    if (route.endsWith('/workers/subdomain')) return ok({ subdomain: 'me' })
    return ok({})
  }
  return workerHandle(new Request(url, init as RequestInit), { BUCKET: bucket, UPLOAD_PASSWORD: workerSecret })
}

const makeSharing = () =>
  createSharing({
    secrets: createSecrets(path.join(dir, 'secrets.json')),
    configFile: path.join(dir, 'sharing.json'),
    apiBase: API,
    originOverride: ORIGIN,
    modules: { 'worker.js': '// test' },
    readAssets: async () => [{ path: '/assets/viewer.js', bytes: new TextEncoder().encode('// viewer') }],
    fetchImpl: fakeFetch,
  })

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'share-'))
  vault = path.join(dir, 'vault')
  await import('node:fs/promises').then((fs) => fs.mkdir(path.join(vault, 'Sub'), { recursive: true }))
  await writeFile(path.join(vault, 'Sub', 'Board.excalidraw'), '{}')
  bucket = memoryBucket()
  workerSecret = undefined
  online = true
  account = { accounts: [{ id: 'acc1', name: 'Test account' }], buckets: new Set(), scripts: new Set(), domains: [], zones: ['example.co.uk', 'co.uk', 'yasin.dev'], assetUploads: 0, attached: [] }
  sharing = makeSharing()
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const board = () => path.join(vault, 'Sub', 'Board.excalidraw')

describe('sharing (YAZ-1799 prototype) against the real Worker', () => {
  it('setup runs every step, keeps both secrets in main, and answers a status with neither', async () => {
    const steps: ShareSetupProgress[] = []
    const status = await sharing.setup('tok', (p) => steps.push(p))
    expect(steps.filter((s) => s.state === 'done').map((s) => s.step)).toEqual(['verify', 'account', 'bucket', 'viewer', 'worker', 'secret', 'subdomain', 'test'])
    expect(status).toMatchObject({ state: 'ready', url: ORIGIN, workersDevUrl: 'https://yaseen-draw-share.me.workers.dev' })
    expect(JSON.stringify(status)).not.toContain(workerSecret)
    const secrets = JSON.parse(await readFile(path.join(dir, 'secrets.json'), 'utf8')).values
    expect(secrets[CLOUDFLARE_TOKEN_SECRET]).toBe('tok')
    expect(secrets[SHARE_UPLOAD_PASSWORD_SECRET]).toBe(workerSecret)
    expect(bucket.objects.size).toBe(0) // the test upload cleaned up after itself
  })

  it('one link; re-upload keeps the id and the permission; view only is enforced by the Worker; stop kills the link', async () => {
    await sharing.setup('tok', () => {})
    const first = await sharing.publish(vault, board(), '{"v":1}')
    expect(first.id).toMatch(/^[A-Za-z0-9_-]{24}$/)
    expect(first.url).toBe(`${ORIGIN}/b/${first.id}`)
    expect(first.allowDownload).toBe(true) // a new share: view and download
    let page = await (await fakeFetch(first.url)).text()
    expect(page).toContain('id="dl-excalidraw"')
    expect(page).toContain('id="dl-png"')
    expect((await fakeFetch(`${ORIGIN}/raw/${first.id}`)).status).toBe(200)

    // view only: same link, no re-upload, buttons gone, /raw refused, the viewer can still draw
    const viewOnly = await sharing.setPermission(vault, board(), false)
    expect([viewOnly.id, viewOnly.url, viewOnly.allowDownload]).toEqual([first.id, first.url, false])
    page = await (await fakeFetch(first.url)).text()
    expect(page).not.toContain('id="dl-png"')
    expect(page).not.toContain('id="dl-excalidraw"')
    expect((await fakeFetch(`${ORIGIN}/raw/${first.id}`)).status).toBe(403)
    expect(await (await fakeFetch(`${ORIGIN}/scene/${first.id}`)).text()).toBe('{"v":1}')

    // an auto-upload after a save keeps the id AND the view-only flag
    const second = await sharing.publish(vault, board(), '{"v":2}')
    expect([second.id, second.sharedAt, second.allowDownload]).toEqual([first.id, first.sharedAt, false])
    expect((await fakeFetch(`${ORIGIN}/raw/${first.id}`)).status).toBe(403)
    expect(await (await fakeFetch(`${ORIGIN}/scene/${first.id}`)).text()).toBe('{"v":2}')

    // back to view and download
    await sharing.setPermission(vault, board(), true)
    expect(await (await fakeFetch(`${ORIGIN}/raw/${first.id}`)).text()).toBe('{"v":2}')
    const onDisk = JSON.parse(await readFile(path.join(vault, '.yaseendraw', 'shares.json'), 'utf8'))
    expect(onDisk.shares['Sub/Board.excalidraw']).toMatchObject({ id: first.id, allowDownload: true })
    expect([...bucket.objects.keys()]).toEqual([`boards/${first.id}.excalidraw`])

    await sharing.stop(vault, board())
    expect((await fakeFetch(first.url)).status).toBe(404)
    expect(bucket.objects.size).toBe(0)
    expect(await sharing.get(vault, board())).toBeNull()
  })

  it('refuses a board over 100 MB before any upload', async () => {
    await sharing.setup('tok', () => {})
    await expect(sharing.publish(vault, board(), 'x'.repeat(100_000_001))).rejects.toMatchObject({ code: 'TOO_LARGE' })
    expect(bucket.objects.size).toBe(0)
  })

  it('a failed re-upload keeps the record and is reported on the entry; the next one clears it', async () => {
    await sharing.setup('tok', () => {})
    await sharing.publish(vault, board(), '{"v":1}')
    online = false
    await expect(sharing.publish(vault, board(), '{"v":2}')).rejects.toMatchObject({ code: 'OFFLINE' })
    const failed = await sharing.get(vault, board())
    expect(failed?.sync).toMatchObject({ state: 'failed' })
    expect(failed?.sync.message).toMatch(/Can't reach/)
    online = true
    await sharing.publish(vault, board(), '{"v":3}')
    expect((await sharing.get(vault, board()))?.sync).toEqual({ state: 'ok' })
  })

  it('reconnect: after "Forget key" a new setup REUSES the Worker, bucket and domain, and old links stay manageable', async () => {
    await sharing.setup('tok', () => {})
    await sharing.setDomain('share.yasin.dev')
    const first = await sharing.publish(vault, board(), '{"v":1}')
    const oldPassword = workerSecret
    await sharing.disconnect(vault, false) // "Forget key on this Mac": nothing on Cloudflare is touched
    expect((await sharing.status()).state).toBe('off')
    expect(bucket.objects.size).toBe(1)

    const steps: ShareSetupProgress[] = []
    const again = await sharing.setup('tok', (p) => steps.push(p))
    expect(steps.find((p) => p.step === 'bucket' && p.state === 'done')?.message).toMatch(/existing .* reusing it/)
    expect(steps.find((p) => p.step === 'worker' && p.state === 'done')?.message).toMatch(/existing .* kept its links/)
    expect(again.customDomain).toBe('share.yasin.dev')
    expect(workerSecret).not.toBe(oldPassword) // a NEW upload password
    // The old link is still there and manageable with the new password.
    expect((await fakeFetch(first.url)).status).toBe(200)
    await sharing.setPermission(vault, board(), false)
    expect((await fakeFetch(`${ORIGIN}/raw/${first.id}`)).status).toBe(403)
    await sharing.stop(vault, board())
    expect((await fakeFetch(first.url)).status).toBe(404)
  })

  it('several accounts: listed for a picker; setup refuses to guess and uses the picked one', async () => {
    account.accounts = [{ id: 'acc1', name: 'Personal' }, { id: 'acc2', name: 'Work' }]
    expect(await sharing.accounts('tok')).toHaveLength(2)
    await expect(sharing.setup('tok', () => {})).rejects.toThrow(/more than one Cloudflare account/)
    const status = await sharing.setup('tok', () => {}, 'acc2')
    expect(status.accountName).toBe('Work')
  })

  it('custom domain: the longest matching zone on the account wins (share.example.co.uk → example.co.uk, not co.uk)', async () => {
    await sharing.setup('tok', () => {})
    await sharing.setDomain('share.example.co.uk')
    expect(account.attached).toEqual(['share.example.co.uk@z-example.co.uk'])
    await expect(sharing.setDomain('share.missingzone.com')).rejects.toThrow(/isn't under any domain on your Cloudflare account/)
  })

  it('an in-app rename or move carries the share (same id, same permission); a delete stops it', async () => {
    await sharing.setup('tok', () => {})
    const first = await sharing.publish(vault, board(), '{"v":1}')
    await sharing.setPermission(vault, board(), false)
    const moved = path.join(vault, 'Elsewhere', 'Renamed.excalidraw')
    await sharing.relocate([vault], board(), moved)
    expect(await sharing.get(vault, board())).toBeNull()
    expect(await sharing.get(vault, moved)).toMatchObject({ id: first.id, allowDownload: false })
    // A folder rename moves every share inside it.
    const movedDir = path.join(vault, 'Renamed folder')
    await sharing.relocate([vault], path.join(vault, 'Elsewhere'), movedDir)
    const inDir = path.join(movedDir, 'Renamed.excalidraw')
    expect((await sharing.get(vault, inDir))?.id).toBe(first.id)
    // Deleting the folder stops the share: the link dies and the record goes.
    await sharing.forget([vault], movedDir)
    expect((await fakeFetch(first.url)).status).toBe(404)
    expect(await sharing.get(vault, inDir)).toBeNull()
  })

  it('a delete while offline keeps the record (Settings lists it to stop later)', async () => {
    await sharing.setup('tok', () => {})
    await sharing.publish(vault, board(), '{"v":1}')
    online = false
    await sharing.forget([vault], board())
    online = true
    expect(await sharing.get(vault, board())).not.toBeNull()
  })

  it('without setup, share and stop say NOT_SET_UP', async () => {
    await expect(sharing.publish(vault, board(), '{}')).rejects.toMatchObject({ code: 'NOT_SET_UP' })
  })
})
