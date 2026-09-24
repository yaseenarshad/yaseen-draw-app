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

  it('an unknown api route (there is no health route) or a bad id is 404', async () => {
    expect((await call('GET', '/api/health')).status).toBe(404)
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

describe('share Worker: a big board (YAZ-1892 scenario 10)', () => {
  it('a ~45 MB body streams through in 1 MB chunks and reads back byte for byte', async () => {
    const MB = 1_000_000
    const chunks = 45
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === chunks) return controller.close()
        controller.enqueue(new Uint8Array(MB).fill(pulled++ % 251))
      },
    })
    let received: unknown
    const spy = { ...bucket, put: (key: string, value: ReadableStream, opts: object) => ((received = value), bucket.put(key, value, opts)) }
    const res = await handle(
      new Request(`${ORIGIN}/api/boards/${ID}`, { method: 'PUT', headers: { authorization: `Bearer ${PASSWORD}`, 'content-length': String(chunks * MB) }, body, duplex: 'half' } as RequestInit),
      { BUCKET: spy, UPLOAD_PASSWORD: PASSWORD },
    )
    expect(await res.json()).toMatchObject({ id: ID, size: chunks * MB })
    expect(received).toBeInstanceOf(ReadableStream)
    const back = new Uint8Array(await (await call('GET', `/raw/${ID}`, { auth: null })).arrayBuffer())
    expect(back.length).toBe(chunks * MB)
    expect([back[0], back[MB], back[chunks * MB - 1]]).toEqual([0, 1, 44])
  })
})

describe('share Worker: the download file name', () => {
  it('encodes every character RFC 5987 does not allow bare — apostrophes, brackets and stars included', async () => {
    const name = "Tom's “café” (v2)* 🎨"
    await call('PUT', `/api/boards/${ID}`, { body: '{}', headers: { 'x-board-name': encodeURIComponent(name) } })
    const header = (await call('GET', `/raw/${ID}?download=1`, { auth: null })).headers.get('content-disposition') ?? ''
    const value = header.split("filename*=UTF-8''")[1]
    expect(value).toMatch(/^[A-Za-z0-9!#$&+\-.^_`|~%]+$/)
    expect(decodeURIComponent(value)).toBe(`${name}.excalidraw`)
  })
})

describe('share Worker: two kinds of board (🔒 YAZ-1802 D11)', () => {
  const XML = '<mxfile><diagram id="p" name="Page-1"><mxGraphModel><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>'
  const putDiagram = () => call('PUT', `/api/boards/${ID}`, { body: XML, headers: { 'x-board-kind': 'diagram', 'x-board-name': 'Flow' } })
  const page = async () => (await call('GET', `/b/${ID}`, { auth: null })).text()
  const scripts = (html: string) => [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1])

  it('a diagram is stored as XML under the SAME key, tagged with its kind, and the PUT echoes the kind', async () => {
    const res = await putDiagram()
    expect(res.headers.get('x-board-kind')).toBe('diagram')
    expect(text(board)).toBe(XML)
    expect(bucket.objects.get(board)?.customMetadata).toMatchObject({ name: 'Flow', kind: 'diagram' })
  })

  it('a PUT with no kind (or one the Worker does not know) is a drawing, and says so', async () => {
    expect((await put('{"v":1}')).headers.get('x-board-kind')).toBe('drawing')
    expect((await call('PUT', `/api/boards/${ID}`, { body: '{}', headers: { 'x-board-kind': 'mermaid' } })).headers.get('x-board-kind')).toBe('drawing')
    expect(bucket.objects.get(board)?.customMetadata).toMatchObject({ kind: 'drawing' })
  })

  it('/scene and /raw answer a diagram as XML with its kind; the download is <name>.drawio', async () => {
    await putDiagram()
    for (const route of [`/scene/${ID}`, `/raw/${ID}`]) {
      const res = await call('GET', route, { auth: null })
      expect([res.headers.get('content-type'), res.headers.get('x-board-kind'), await res.text()]).toEqual(['application/xml; charset=utf-8', 'diagram', XML])
    }
    const header = (await call('GET', `/raw/${ID}?download=1`, { auth: null })).headers.get('content-disposition')
    expect(header).toBe("attachment; filename*=UTF-8''Flow.drawio")
  })

  it('a board stored before kinds (no kind in its metadata) is a drawing: old links keep working', async () => {
    bucket.objects.set(board, { bytes: new TextEncoder().encode('{"v":0}'), customMetadata: { name: 'Old', updatedAt: '1' } })
    const raw = await call('GET', `/raw/${ID}?download=1`, { auth: null })
    expect(raw.headers.get('x-board-kind')).toBe('drawing')
    expect(raw.headers.get('content-disposition')).toContain('Old.excalidraw')
    expect(scripts(await page())).toEqual(['/assets/viewer.js'])
  })

  it("/b picks the viewer by kind: a diagram runs draw.io's viewer after its config, with Download .drawio and no PNG", async () => {
    await putDiagram()
    const html = await page()
    expect(scripts(html)).toEqual(['/assets/drawio/config.js', '/assets/drawio/js/viewer-static.min.js', '/assets/diagram.js'])
    expect(html.match(/<script\b/g)).toHaveLength(4) // those three and the JSON block: still no inline script
    expect(html).toContain('<link rel="stylesheet" href="/assets/drawio/fonts.css">')
    expect(html).toContain('<title>Flow — shared diagram</title>')
    expect(html).toContain('id="dl-drawio"')
    expect(html).not.toContain('id="dl-excalidraw"')
    expect(html).not.toContain('id="dl-png"')
    await call('PATCH', `/api/boards/${ID}`, { body: JSON.stringify({ allowDownload: false }) })
    expect(await page()).not.toContain('id="dl-drawio"')
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

  it('every page carries the CSP (same-origin scripts and fetches, never framed) and has no inline script', async () => {
    await put('{"v":1}')
    for (const route of [`/b/${ID}`, '/b/AbCdEfGhIjKlMnOpQrStUvWz', '/']) {
      const res = await call('GET', route, { auth: null })
      const csp = res.headers.get('content-security-policy') ?? ''
      for (const rule of ["script-src 'self'", "connect-src 'self'", "frame-ancestors 'none'"]) expect(csp).toContain(rule)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      const scripts = [...(await res.text()).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      for (const [, attrs, body] of scripts) expect(/type="application\/json"/.test(attrs) || (/src="\/assets\//.test(attrs) && body === '')).toBe(true)
    }
    const scene = await call('GET', `/scene/${ID}`, { auth: null })
    expect(scene.headers.get('access-control-allow-origin')).toBeNull()
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
