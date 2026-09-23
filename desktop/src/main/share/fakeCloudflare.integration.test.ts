/**
 * THE SHARE SCENARIOS AGAINST THE FAKE CLOUDFLARE (YAZ-1892 5A). Real boundaries only: the real
 * `tools/fakeCloudflare.mjs` as its own process (its magic tokens, its disk bucket, the real
 * `share/worker.js` behind real HTTP), the real `sharing.ts` with real `fetch`, real `secrets.json`,
 * `sharing.json` and `<vault>/.yaseendraw/shares.json` on a temp dir. The same wiring as the demo
 * (`YASEEN_DRAW_CLOUDFLARE_API` + `YASEEN_DRAW_SHARE_ORIGIN`), minus Electron.
 *
 * Numbers in test names are the approved scenarios on YAZ-1799.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLOUDFLARE_TOKEN_SECRET, SHARE_UPLOAD_PASSWORD_SECRET, type ShareSetupProgress } from '@shared/types'
import { createSecrets } from '../secrets'
import { createSharing, type Sharing } from './sharing'

const REPO = fileURLToPath(new URL('../../../../', import.meta.url))
const FAKE = path.join(REPO, 'tools', 'fakeCloudflare.mjs')

let dir: string
let vault: string
let origin: string
let server: ChildProcess | null
let sharing: Sharing
/** Every request `sharing.ts` sent to the share Worker (not Cloudflare's API). */
let workerRequests: string[]

async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const { port } = probe.address() as { port: number }
  await new Promise((resolve) => probe.close(resolve))
  return port
}

/** Starts the fake on a free port, or (scenario 8's reconnect) back on `port` with the same account. */
async function startFake(port?: number): Promise<void> {
  port ??= await freePort()
  origin = `http://127.0.0.1:${port}`
  const child = spawn(process.execPath, [FAKE, '--data', path.join(dir, 'fake'), '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  server = child
  await new Promise<void>((resolve, reject) => {
    let out = ''
    child.stdout!.on('data', (d: Buffer) => {
      out += d.toString()
      if (out.includes(`http://127.0.0.1:${port}`)) resolve()
    })
    child.once('exit', (code) => reject(new Error(`fakeCloudflare exited ${code}: ${out}`)))
  })
}
async function stopFake(): Promise<void> {
  const child = server
  server = null
  if (child === null || child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once('exit', resolve)
    child.kill()
  })
}

const makeSharing = async () =>
  createSharing({
    secrets: createSecrets(path.join(dir, 'userData', 'secrets.json')),
    configFile: path.join(dir, 'userData', 'sharing.json'),
    apiBase: `${origin}/client/v4`,
    demoOrigin: origin,
    modules: { 'worker.js': await readFile(path.join(REPO, 'share', 'worker.js'), 'utf8') },
    readAssets: async () => [{ path: '/assets/viewer.js', bytes: new TextEncoder().encode('// viewer') }],
    fetchImpl: (input, init) => {
      const url = String(input)
      if (!url.includes('/client/v4/')) workerRequests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
      return fetch(input, init)
    },
    sleep: async () => {},
  })

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'share-fake-'))
  vault = path.join(dir, 'vault')
  await mkdir(path.join(dir, 'userData'), { recursive: true })
  await mkdir(path.join(vault, 'Clients', 'Acme Corp', '2026', 'Q3 workshop'), { recursive: true })
  for (const b of boards()) await writeFile(b, scene(path.basename(b)))
  workerRequests = []
  await startFake()
  sharing = await makeSharing()
})
afterEach(async () => {
  await stopFake()
  await rm(dir, { recursive: true, force: true })
})

const scene = (label: string) => `${JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'r', type: 'rectangle', label }], appState: {}, files: {} })}\n`
const simple = () => path.join(vault, '01 Simple.excalidraw')
const unicode = () => path.join(vault, "08 Tom's “café” board 🎨 — ünïcödé.excalidraw")
const deep = () => path.join(vault, 'Clients', 'Acme Corp', '2026', 'Q3 workshop', '09 Deep nested.excalidraw')
const boards = () => [simple(), unicode(), deep()]
const get = (route: string) => fetch(`${origin}${route}`)
const setUp = (token = 'demo-good', accountId?: string) => sharing.setup(token, () => {}, accountId)
const publish = async (board: string, id?: string) => sharing.publish(vault, board, await readFile(board, 'utf8'), id)
const sharesJson = async () => JSON.parse(await readFile(path.join(vault, '.yaseendraw', 'shares.json'), 'utf8')).shares as Record<string, { id: string; allowDownload: boolean }>
const fakeState = async () => (await (await get('/__fake/state')).json()) as { buckets: string[]; scripts: Record<string, unknown>; domains: { hostname: string }[]; objects: { key: string }[] }

describe('setup against the fake Cloudflare (scenarios 1–3, D17, D18)', () => {
  it('1: before setup a share says NOT_SET_UP, pointing at Settings › Sharing', async () => {
    expect((await sharing.status()).state).toBe('off')
    await expect(publish(simple())).rejects.toMatchObject({ code: 'NOT_SET_UP', message: expect.stringMatching(/Settings › Sharing/) })
    expect(workerRequests).toEqual([])
  })

  it.each([
    ['demo-invalid', 'verify', /didn't accept this key/],
    ['not-a-real-token', 'verify', /didn't accept this key/],
    ['demo-bad-perms', 'bucket', /missing the “Workers R2 Storage: Edit” permission/],
    ['demo-no-card', 'bucket', /isn't switched on for this account yet.*payment card on file.*free tier/],
  ])('2: %s fails at the %s step, in plain English', async (token, step, message) => {
    const steps: ShareSetupProgress[] = []
    const err = await sharing.setup(token, (p) => steps.push(p)).catch((e: Error) => e)
    expect(String(err)).toMatch(message)
    expect(String(err)).not.toMatch(/Invalid API Token|Authentication error|enable R2 through/) // never Cloudflare's own wording
    expect(steps.at(-1)).toMatchObject({ step, state: 'failed' })
    expect((await sharing.status()).state).toBe('off')
  })

  it('2: offline — setup fails at once with a clear message, never hangs, and stores nothing', async () => {
    await stopFake()
    const started = Date.now()
    const steps: ShareSetupProgress[] = []
    await expect(sharing.setup('demo-good', (p) => steps.push(p))).rejects.toMatchObject({ code: 'OFFLINE', message: expect.stringMatching(/Can't reach Cloudflare\. Check your internet connection/) })
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(steps.at(-1)).toMatchObject({ step: 'verify', state: 'failed' })
    await expect(readFile(path.join(dir, 'userData', 'secrets.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('3: one account needs no picker; two accounts list both, setup refuses to guess, then uses the picked one', async () => {
    expect(await sharing.accounts('demo-good')).toHaveLength(1)
    const two = await sharing.accounts('demo-two-accounts')
    expect(two.map((a) => a.name)).toEqual(["Yasin's Account (demo)", 'GrowProfit (demo)'])
    await expect(setUp('demo-two-accounts')).rejects.toThrow(/more than one Cloudflare account/)
    expect(await setUp('demo-two-accounts', two[1].id)).toMatchObject({ state: 'ready', accountName: 'GrowProfit (demo)' })
  })

  it('D18: an account-owned cfat_ key sets up', async () => {
    expect(await setUp('cfat_demo-good')).toMatchObject({ state: 'ready', workersDevUrl: 'https://yaseen-draw-share.yasin-demo.workers.dev' })
  })

  it.each(['demo-no-subdomain', 'demo-subdomain-taken'])('D17: %s claims <account>-xxxx and is ready', async (token) => {
    const status = await setUp(token)
    expect(status.state).toBe('ready')
    expect(status.workersDevUrl).toMatch(/^https:\/\/yaseen-draw-share\.yasin-s-account-demo-[a-z0-9]{4}\.workers\.dev$/)
  })
})

describe('a shared link against the fake Cloudflare (scenarios 4–6, 9, 10)', () => {
  it('4–6: share → both downloads; view only → buttons gone and /raw 403, kept by an auto-upload; back; Not shared → stopped', async () => {
    await setUp()
    const first = await publish(simple())
    expect(first.url).toBe(`${origin}/b/${first.id}`)
    let page = await (await get(`/b/${first.id}`)).text()
    expect(page).toContain('id="dl-excalidraw"')
    expect(page).toContain('id="dl-png"')
    const raw = await get(`/raw/${first.id}?download=1`)
    expect(await raw.text()).toBe(await readFile(simple(), 'utf8'))
    expect(raw.headers.get('content-disposition')).toContain("filename*=UTF-8''01%20Simple.excalidraw")

    await sharing.setPermission(vault, simple(), false)
    page = await (await get(`/b/${first.id}`)).text()
    expect(page).not.toContain('id="dl-excalidraw"')
    expect(page).not.toContain('id="dl-png"')
    expect((await get(`/raw/${first.id}`)).status).toBe(403)
    expect((await get(`/scene/${first.id}`)).status).toBe(200)
    await writeFile(simple(), scene('edited'))
    await publish(simple(), first.id) // what liveShare sends after a save
    expect((await get(`/raw/${first.id}`)).status).toBe(403)
    expect(await (await get(`/scene/${first.id}`)).text()).toContain('edited')

    await sharing.setPermission(vault, simple(), true)
    expect((await get(`/raw/${first.id}`)).status).toBe(200)
    expect((await sharing.get(vault, simple()))?.url).toBe(first.url) // the same link throughout

    await sharing.stop(vault, simple())
    const gone = await get(`/b/${first.id}`)
    expect(gone.status).toBe(404)
    expect(await gone.text()).toContain('This link was stopped or never existed.')
    expect((await get(`/raw/${first.id}`)).status).toBe(404)
  })

  it('9: unicode, emoji and apostrophe names and deep folders keep their keys and their names', async () => {
    await setUp()
    const u = await publish(unicode())
    const d = await publish(deep())
    const shares = await sharesJson()
    expect(shares["08 Tom's “café” board 🎨 — ünïcödé.excalidraw"].id).toBe(u.id)
    expect(shares['Clients/Acme Corp/2026/Q3 workshop/09 Deep nested.excalidraw'].id).toBe(d.id)
    const page = await (await get(`/b/${u.id}`)).text()
    expect(page).toContain('<title>08 Tom&#39;s “café” board 🎨 — ünïcödé — shared drawing</title>')
    const disposition = (await get(`/raw/${u.id}?download=1`)).headers.get('content-disposition') ?? ''
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe("08 Tom's “café” board 🎨 — ünïcödé.excalidraw")
    expect(await (await get(`/raw/${d.id}`)).text()).toBe(await readFile(deep(), 'utf8'))
  })

  it('10: a ~45 MB board uploads over HTTP and reads back whole; 115 MB is refused before any request', async () => {
    await setUp()
    const big = `{"type":"excalidraw","pad":"${'x'.repeat(45_000_000)}"}`
    const shared = await sharing.publish(vault, simple(), big)
    expect((await (await get(`/raw/${shared.id}`)).text()).length).toBe(big.length)
    workerRequests = []
    await expect(sharing.publish(vault, deep(), 'x'.repeat(115_000_000))).rejects.toMatchObject({ code: 'TOO_LARGE', message: expect.stringMatching(/115\.0 MB .* at most 100\.0 MB/) })
    expect(workerRequests).toEqual([])
    expect(await sharing.get(vault, deep())).toBeNull()
  }, 60_000)
})

describe('keeping links right (scenarios 8, 11, 12)', () => {
  it('8: offline → the entry says Couldn\'t update; the next save after reconnecting recovers the same link', async () => {
    await setUp()
    const first = await publish(simple())
    await stopFake()
    await expect(publish(simple(), first.id)).rejects.toMatchObject({ code: 'OFFLINE' })
    expect((await sharing.get(vault, simple()))?.sync).toMatchObject({ state: 'failed', message: expect.stringMatching(/Can't reach your share Worker/) })
    await startFake(Number(new URL(origin).port))
    await writeFile(simple(), scene('after reconnect'))
    expect((await publish(simple(), first.id)).id).toBe(first.id)
    expect((await sharing.get(vault, simple()))?.sync).toEqual({ state: 'ok' })
    expect(await (await get(`/scene/${first.id}`)).text()).toContain('after reconnect')
  })

  it('11: stale (gone from Cloudflare) is flagged; one save restores the SAME id with its permission; a Finder rename reads "no board at this path"', async () => {
    await setUp()
    const s = await publish(simple())
    await sharing.setPermission(vault, simple(), false)
    const d = await publish(deep())
    for (const f of await readdir(path.join(dir, 'fake', 'bucket'))) if (f.includes(s.id)) await rm(path.join(dir, 'fake', 'bucket', f))
    await rename(deep(), path.join(vault, 'Renamed in Finder.excalidraw'))
    const rows = await sharing.list(vault)
    expect(rows.find((r) => r.id === s.id)).toMatchObject({ live: 'missing', stale: true, fileExists: true })
    expect(rows.find((r) => r.id === d.id)).toMatchObject({ live: 'live', stale: false, fileExists: false })
    expect((await publish(simple(), s.id)).id).toBe(s.id)
    expect((await sharing.list(vault)).find((r) => r.id === s.id)).toMatchObject({ live: 'live', stale: false, allowDownload: false })
    expect((await get(`/raw/${s.id}`)).status).toBe(403) // the view-only flag came back with it
  })

  it('12: an in-app rename or move keeps the link and permission; deleting the board kills the link', async () => {
    await setUp()
    const s = await publish(simple())
    await sharing.setPermission(vault, simple(), false)
    const moved = path.join(vault, 'Clients', 'Renamed.excalidraw')
    await rename(simple(), moved)
    await sharing.relocate([vault], simple(), moved)
    expect(await sharing.get(vault, moved)).toMatchObject({ id: s.id, url: s.url, allowDownload: false })
    expect(Object.keys(await sharesJson())).toEqual(['Clients/Renamed.excalidraw'])
    await rm(moved)
    await sharing.forget([vault], moved)
    expect((await get(`/b/${s.id}`)).status).toBe(404)
    expect(await sharesJson()).toEqual({})
  })
})

describe('the account (scenarios 13–15)', () => {
  it('13: a domain on the account attaches (the longest zone, .co.uk too); others get their own plain message', async () => {
    await setUp()
    expect((await sharing.setDomain('share.example.co.uk')).customDomain).toBe('share.example.co.uk')
    expect((await sharing.status()).workersDevUrl).toBe('https://yaseen-draw-share.yasin-demo.workers.dev')
    await expect(sharing.setDomain('share.missingzone.com')).rejects.toThrow(/isn't under any domain on your Cloudflare account/)
    await expect(sharing.setDomain('share.pending-zone.dev')).rejects.toThrow(/pending-zone\.dev is on your Cloudflare account but isn't active yet/)
    await expect(sharing.setDomain('cname.yasin.dev')).rejects.toThrow(/already has a DNS record/)
    expect((await sharing.status()).customDomain).toBe('share.example.co.uk') // a refusal leaves the working one
    expect((await fakeState()).domains.map((d) => d.hostname)).toEqual(['share.example.co.uk'])
  })

  it('14: Forget key → set up again → the bucket and Worker are reused, the domain is back, old links are manageable', async () => {
    await setUp()
    await sharing.setDomain('share.yasin.dev')
    const s = await publish(simple())
    await sharing.disconnect(vault, false)
    expect((await sharing.status()).state).toBe('off')
    expect((await get(`/b/${s.id}`)).status).toBe(200) // nothing on Cloudflare was touched
    const steps: ShareSetupProgress[] = []
    const again = await sharing.setup('demo-good', (p) => steps.push(p))
    expect(steps.filter((p) => p.state === 'done' && /existing/.test(p.message ?? '')).map((p) => p.step)).toEqual(['bucket', 'worker'])
    expect(again.customDomain).toBe('share.yasin.dev')
    await sharing.setPermission(vault, simple(), false)
    expect((await get(`/raw/${s.id}`)).status).toBe(403)
    await sharing.stop(vault, simple())
    expect((await get(`/b/${s.id}`)).status).toBe(404)
  })

  it('15: Delete all shared links → every link 404s, the Worker, bucket and domain are gone, the key is forgotten', async () => {
    await setUp()
    await sharing.setDomain('share.yasin.dev')
    const ids = [(await publish(simple())).id, (await publish(unicode())).id, (await publish(deep())).id]
    expect(await sharing.disconnect(vault, true)).toMatchObject({ state: 'off' })
    for (const id of ids) {
      expect((await get(`/b/${id}`)).status).toBe(404)
      expect((await get(`/raw/${id}`)).status).toBe(404)
    }
    expect(await sharesJson()).toEqual({})
    expect(await fakeState()).toMatchObject({ buckets: [], scripts: {}, domains: [], objects: [] })
    const secrets = JSON.parse(await readFile(path.join(dir, 'userData', 'secrets.json'), 'utf8')).values ?? {}
    expect([secrets[CLOUDFLARE_TOKEN_SECRET], secrets[SHARE_UPLOAD_PASSWORD_SECRET]]).toEqual([undefined, undefined])
  })
})

