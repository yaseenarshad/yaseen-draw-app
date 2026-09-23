/**
 * THE SHARE WORKER (YAZ-1799, PROTOTYPE). The one piece of code that runs on the user's OWN
 * Cloudflare account: the app uploads this file (plus `viewer/page.js`) as a module Worker with
 * one R2 binding (`BUCKET`) and one secret (`UPLOAD_PASSWORD`, app-generated, never shown).
 *
 * Plain JavaScript on purpose: this exact file is what Cloudflare runs, what the app uploads
 * verbatim, and what `tools/fakeCloudflare.mjs` imports and runs under Node for the demo — no
 * build step between them. Only standard Request/Response and an R2-shaped `bucket`
 * (`put` / `get` / `head` / `delete` / `list`) are used.
 *
 * ONE LINK PER BOARD + A PERMISSION FLAG (the Google Docs model Yasin approved): the board is
 * stored once under one random id, with `allowDownload` in its R2 customMetadata. The viewer at
 * `/b/<id>` shows the download buttons only when it is on, and `/raw/<id>` — the download — answers
 * 403 when it is off, so the flag is enforced here, not just hidden. `/scene/<id>` is what the
 * viewer draws from; a determined viewer can still read the drawing through it (accepted).
 *
 * Routes:
 *   PUT    /api/boards/:id   bearer, header x-allow-download (1|0) — store (or replace) the board
 *   PATCH  /api/boards/:id   bearer, JSON { allowDownload } — flip the permission on the SAME link, no re-upload
 *   DELETE /api/boards/:id   bearer — stop sharing: the link dies at once
 *   POST   /api/wipe         bearer — "delete all shared links": every object in the bucket
 *   GET    /api/health       liveness for the app's setup test
 *   GET    /b/:id            the read-only viewer (download buttons only when allowed)
 *   GET    /scene/:id        the scene the viewer draws
 *   GET    /assets/*         the viewer's script, stylesheet and fonts (the Worker's static assets, `env.ASSETS`)
 *   GET    /raw/:id          the .excalidraw download — 403 when download is off (`?download=1` adds a Content-Disposition)
 *
 * 🔒 YAZ-1799 D2: no encryption — the id is the only secret, so it must be long and random (the
 * app makes 144-bit ids); the Worker only checks its shape.
 */
import { missingPage, viewerPage } from './viewer/page.js'

/** The Workers free-plan request body ceiling. The app pre-checks the same number. */
export const MAX_BODY_BYTES = 100 * 1000 * 1000
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/
const key = (id) => `boards/${id}.excalidraw`
/** customMetadata values are strings; anything but '0' counts as allowed (the new-share default). */
const allowsDownload = (object) => object?.customMetadata?.allowDownload !== '0'

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })

/** Constant-time string compare, so the password cannot be guessed a byte at a time. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function authorised(request, env) {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return typeof env.UPLOAD_PASSWORD === 'string' && env.UPLOAD_PASSWORD !== '' && sameSecret(token, env.UPLOAD_PASSWORD)
}

function decodeName(raw) {
  try {
    const name = decodeURIComponent(raw ?? '')
    return name.slice(0, 300) || 'Shared board'
  } catch {
    return 'Shared board'
  }
}

async function putBoard(request, env, id) {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json({ error: 'too_large', limit: MAX_BODY_BYTES }, 413)
  const body = await request.arrayBuffer()
  if (body.byteLength > MAX_BODY_BYTES) return json({ error: 'too_large', limit: MAX_BODY_BYTES }, 413)
  if (body.byteLength === 0) return json({ error: 'empty' }, 400)
  const allowDownload = request.headers.get('x-allow-download') === '0' ? '0' : '1'
  const name = decodeName(request.headers.get('x-board-name'))
  const updatedAt = Date.now()
  await env.BUCKET.put(key(id), body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { name, updatedAt: String(updatedAt), allowDownload },
  })
  return json({ id, size: body.byteLength, updatedAt, allowDownload: allowDownload === '1' })
}

/** R2 cannot edit metadata in place: the object is rewritten with its own bytes (server side, no re-upload from the app). */
async function patchBoard(request, env, id) {
  let wanted
  try {
    wanted = (await request.json()).allowDownload
  } catch {
    wanted = undefined
  }
  if (typeof wanted !== 'boolean') return json({ error: 'bad_request' }, 400)
  const object = await env.BUCKET.get(key(id))
  if (object === null) return json({ error: 'not_found' }, 404)
  const bytes = await new Response(object.body).arrayBuffer()
  await env.BUCKET.put(key(id), bytes, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { ...(object.customMetadata ?? {}), allowDownload: wanted ? '1' : '0' },
  })
  return json({ id, allowDownload: wanted })
}

async function wipe(env) {
  let deleted = 0
  let cursor
  do {
    const page = await env.BUCKET.list({ prefix: 'boards/', cursor })
    for (const object of page.objects) {
      await env.BUCKET.delete(object.key)
      deleted++
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined)
  return json({ deleted })
}

/** The scene for the viewer (`download` false) or the download itself (`download` true — refused when off). */
async function sceneOrRaw(request, env, id, url, download) {
  const object = request.method === 'HEAD' ? await env.BUCKET.head(key(id)) : await env.BUCKET.get(key(id))
  if (object === null) return json({ error: 'not_found' }, 404)
  if (download && !allowsDownload(object)) return json({ error: 'download_not_allowed' }, 403)
  const name = object.customMetadata?.name ?? 'Shared board'
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
  if (download && url.searchParams.has('download')) headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.excalidraw`)}`)
  headers.set('x-board-name', encodeURIComponent(name))
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

/** The whole Worker as one function: `handle(request, env)` is what the fake server calls too. */
export async function handle(request, env) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const method = request.method

  if (parts[0] === 'api') {
    if (parts[1] === 'health' && method === 'GET') return json({ ok: true, bucket: env.BUCKET !== undefined, password: typeof env.UPLOAD_PASSWORD === 'string' })
    if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401)
    if (parts[1] === 'wipe' && method === 'POST') return wipe(env)
    if (parts[1] === 'boards' && parts.length === 3 && ID_RE.test(parts[2])) {
      if (method === 'PUT') return putBoard(request, env, parts[2])
      if (method === 'PATCH') return patchBoard(request, env, parts[2])
      if (method === 'DELETE') {
        await env.BUCKET.delete(key(parts[2]))
        return new Response(null, { status: 204 })
      }
    }
    return json({ error: 'not_found' }, 404)
  }

  // Static assets are normally answered by Cloudflare before the Worker runs; this is the fallback path.
  if (parts[0] === 'assets' && env.ASSETS !== undefined && (method === 'GET' || method === 'HEAD')) return env.ASSETS.fetch(request)

  if ((parts[0] === 'raw' || parts[0] === 'scene') && parts.length === 2 && (method === 'GET' || method === 'HEAD')) {
    if (!ID_RE.test(parts[1])) return json({ error: 'not_found' }, 404)
    return sceneOrRaw(request, env, parts[1], url, parts[0] === 'raw')
  }

  if (parts[0] === 'b' && parts.length === 2 && method === 'GET') {
    const object = ID_RE.test(parts[1]) ? await env.BUCKET.head(key(parts[1])) : null
    if (object === null) return html(missingPage(), 404)
    return html(viewerPage({ id: parts[1], allowDownload: allowsDownload(object), name: object.customMetadata?.name ?? 'Shared board', updatedAt: Number(object.customMetadata?.updatedAt ?? 0) }))
  }

  if (parts.length === 0) return html(missingPage('Nothing is shared at this address.'), 404)
  return html(missingPage(), 404)
}

export default {
  fetch: (request, env) => handle(request, env),
}
