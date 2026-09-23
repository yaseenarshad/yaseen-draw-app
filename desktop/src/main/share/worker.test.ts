import { beforeEach, describe, expect, it } from 'vitest'
// The REAL Worker (plain JS, the file Cloudflare runs), driven in-process against a Map bucket.
// @ts-expect-error — untyped JS module
import { handle, MAX_BODY_BYTES } from '../../../../share/worker.js'
import { memoryBucket, type MemoryBucket } from './memoryBucket'

const ORIGIN = 'https://share.test'
const PASSWORD = 'pw-0123456789'
const ID = 'AbCdEfGhIjKlMnOpQrStUvWx'
const board = `boards/${ID}.excalidraw`
const perm = `perm/${ID}`

let bucket: MemoryBucket
const env = () => ({ BUCKET: bucket, UPLOAD_PASSWORD: PASSWORD })

/** A request as it arrives off the wire: a body always carries its Content-Length. */
interface CallOptions {
  auth?: string | null
  body?: string
  headers?: Record<string, string>
}
function call(method: string, route: string, { auth = PASSWORD, body, headers = {} }: CallOptions = {}): Promise<Response> {
  const h: Record<string, string> = { ...headers }
  if (auth !== null) h.authorization = `Bearer ${auth}`
  if (typeof body === 'string' && h['content-length'] === undefined) h['content-length'] = String(Buffer.byteLength(body))
  return handle(new Request(`${ORIGIN}${route}`, { method, headers: h, body }), env())
}
const put = (body: string, allow?: '0' | '1') => call('PUT', `/api/boards/${ID}`, { body, headers: allow === undefined ? {} : { 'x-allow-download': allow } })
const text = (key: string) => new TextDecoder().decode(bucket.objects.get(key)?.bytes)

beforeEach(() => {
  bucket = memoryBucket()
})

describe('share Worker: auth', () => {
  it.each([
    ['PUT', `/api/boards/${ID}`],
    ['PATCH', `/api/boards/${ID}`],
    ['DELETE', `/api/boards/${ID}`],
    ['POST', '/api/wipe'],
  ])('%s %s answers 401 without the password, or with a wrong one, and touches nothing', async (method, route) => {
    for (const auth of [null, 'wrong-password']) {
      const res = await call(method, route, { auth, body: method === 'PUT' || method === 'PATCH' ? '{"allowDownload":false}' : undefined })
      expect(res.status).toBe(401)
    }
    expect(bucket.ops.count).toBe(0)
  })

  it('health needs no password; an unknown api route or a bad id is 404', async () => {
    expect(await (await call('GET', '/api/health', { auth: null })).json()).toMatchObject({ ok: true })
    expect((await call('PUT', '/api/boards/short', { body: '{}' })).status).toBe(404)
    expect((await call('GET', '/api/nothing')).status).toBe(404)
  })
})

describe('share Worker: PUT streams the board', () => {
  it('stores the body under boards/<id> and answers its size', async () => {
    const res = await put('{"v":1}')
    expect(await res.json()).toMatchObject({ id: ID, size: 7 })
    expect(text(board)).toBe('{"v":1}')
    expect(bucket.objects.get(board)?.customMetadata).toMatchObject({ name: 'Shared board' })
  })

  it('refuses a body with no Content-Length (411) and an empty one (400) before storing anything', async () => {
    const stream = new Blob(['{}']).stream()
    const res = await handle(new Request(`${ORIGIN}/api/boards/${ID}`, { method: 'PUT', headers: { authorization: `Bearer ${PASSWORD}` }, body: stream, duplex: 'half' } as RequestInit), env())
    expect(res.status).toBe(411)
    expect((await put('')).status).toBe(400)
    expect(bucket.objects.size).toBe(0)
  })

  it('refuses a declared size over 100 MB with 413 without reading a byte of the body', async () => {
    let pulled = false
    const body = new ReadableStream({ pull: () => void (pulled = true) }, { highWaterMark: 0 })
    const res = await handle(
      new Request(`${ORIGIN}/api/boards/${ID}`, { method: 'PUT', headers: { authorization: `Bearer ${PASSWORD}`, 'content-length': String(MAX_BODY_BYTES + 1) }, body, duplex: 'half' } as RequestInit),
      env(),
    )
    expect(res.status).toBe(413)
    expect(pulled).toBe(false)
    expect(bucket.ops.count).toBe(0)
  })

  it('never buffers: the bucket receives the request stream itself', async () => {
    let received: unknown
    const spy = { ...bucket, put: async (key: string, value: unknown) => void (received = value) }
    await handle(new Request(`${ORIGIN}/api/boards/${ID}`, { method: 'PUT', headers: { authorization: `Bearer ${PASSWORD}`, 'content-length': '2' }, body: '{}' }), { BUCKET: spy, UPLOAD_PASSWORD: PASSWORD })
    expect(received).toBeInstanceOf(ReadableStream)
  })
})

describe('share Worker: the download flag is its own object, perm/<id> (D15)', () => {
  it('a PUT with x-allow-download writes the flag; a PUT without it leaves the flag alone', async () => {
    await put('{"v":1}', '0')
    expect(text(perm)).toBe('0')
    await put('{"v":2}')
    expect(text(perm)).toBe('0') // a re-upload never resets view-only
    expect((await call('GET', `/raw/${ID}`, { auth: null })).status).toBe(403)
    await put('{"v":3}', '1')
    expect(text(perm)).toBe('1')
  })

  it('a missing flag means downloads are allowed', async () => {
    await put('{"v":1}')
    expect(bucket.objects.has(perm)).toBe(false)
    const raw = await call('GET', `/raw/${ID}?download=1`, { auth: null })
    expect(raw.status).toBe(200)
    expect(raw.headers.get('content-disposition')).toContain('Shared%20board.excalidraw')
    expect(await raw.text()).toBe('{"v":1}')
  })

  it('PATCH writes only the flag (the board is not rewritten) and 404s when the board is gone', async () => {
    await put('{"v":1}')
    const before = bucket.objects.get(board)
    const res = await call('PATCH', `/api/boards/${ID}`, { body: JSON.stringify({ allowDownload: false }) })
    expect(await res.json()).toEqual({ id: ID, allowDownload: false })
    expect(text(perm)).toBe('0')
    expect(bucket.objects.get(board)).toBe(before)
    expect((await call('PATCH', `/api/boards/${ID}`, { body: 'nope' })).status).toBe(400)
    bucket.objects.delete(board)
    expect((await call('PATCH', `/api/boards/${ID}`, { body: JSON.stringify({ allowDownload: true }) })).status).toBe(404)
    expect(text(perm)).toBe('0')
  })

  it('/raw is 403 when off; /scene still serves the viewer; /b hides the download buttons', async () => {
    await put('{"v":1}', '0')
    expect((await call('GET', `/raw/${ID}`, { auth: null })).status).toBe(403)
    expect((await call('HEAD', `/raw/${ID}`, { auth: null })).status).toBe(403)
    expect(await (await call('GET', `/scene/${ID}`, { auth: null })).text()).toBe('{"v":1}')
    const off = await (await call('GET', `/b/${ID}`, { auth: null })).text()
    expect(off).not.toContain('id="dl-excalidraw"')
    await call('PATCH', `/api/boards/${ID}`, { body: JSON.stringify({ allowDownload: true }) })
    const on = await (await call('GET', `/b/${ID}`, { auth: null })).text()
    expect(on).toContain('id="dl-excalidraw"')
  })

  it('a missing board is 404 on every public route, whatever its flag', async () => {
    bucket.objects.set(perm, { bytes: new TextEncoder().encode('0'), customMetadata: {} })
    for (const route of [`/raw/${ID}`, `/scene/${ID}`, `/b/${ID}`, '/b/bad!id']) expect((await call('GET', route, { auth: null })).status).toBe(404)
  })

  it('DELETE removes the board and its flag', async () => {
    await put('{"v":1}', '0')
    expect((await call('DELETE', `/api/boards/${ID}`)).status).toBe(204)
    expect(bucket.objects.size).toBe(0)
  })
})

describe('share Worker: wipe pages under the free-plan subrequest cap', () => {
  it('2,500 boards and their flags go in a few requests, each one list + one batched delete, answering done', async () => {
    for (let i = 0; i < 2500; i++) {
      const id = `board${String(i).padStart(12, '0')}`
      bucket.objects.set(`boards/${id}.excalidraw`, { bytes: new Uint8Array([123, 125]), customMetadata: {} })
      if (i % 2 === 0) bucket.objects.set(`perm/${id}`, { bytes: new TextEncoder().encode('0'), customMetadata: {} })
    }
    const answers: boolean[] = []
    for (let round = 0; round < 10; round++) {
      bucket.ops.count = 0
      const res = await call('POST', '/api/wipe')
      expect(res.status).toBe(200)
      expect(bucket.ops.count).toBeLessThanOrEqual(2)
      const { done } = (await res.json()) as { done: boolean }
      answers.push(done)
      if (done) break
    }
    expect(answers).toEqual([false, false, false, true])
    expect(bucket.objects.size).toBe(0)
  })

  it('an empty bucket is done at once', async () => {
    expect(await (await call('POST', '/api/wipe')).json()).toMatchObject({ done: true })
  })
})
