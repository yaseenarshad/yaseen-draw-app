/**
 * THE SHARE WORKER (YAZ-1799). The one piece of code that runs on the user's OWN Cloudflare
 * account: the app uploads this file (plus `viewer/page.js`) as a module Worker with one R2
 * binding (`BUCKET`) and one secret binding (`UPLOAD_PASSWORD`, app-generated, never shown).
 *
 * Plain JavaScript on purpose: this exact file is what Cloudflare runs, what the app uploads
 * verbatim, and what `tools/fakeCloudflare.mjs` imports and runs under Node for the demo — no
 * build step between them. Only standard Request/Response and an R2-shaped `bucket`
 * (`put` / `get` / `head` / `delete` / `list`) are used.
 *
 * ONE LINK PER BOARD + A PERMISSION FLAG (the Google Docs model Yasin approved): the board is
 * stored once under one random id (`boards/<id>.excalidraw`), and its download flag is its OWN
 * tiny object, `perm/<id>` ("0" | "1"; missing = allowed — YAZ-1799 D15), so a re-upload of the
 * board can never reset it and flipping it never rewrites the board. The viewer at `/b/<id>` shows
 * the download buttons only when it is on, and `/raw/<id>` — the download — answers 403 when it is
 * off, so the flag is enforced here, not just hidden. `/scene/<id>` is what the viewer draws from;
 * a determined viewer can still read the drawing through it (accepted).
 *
 * Routes:
 *   PUT    /api/boards/:id   bearer, Content-Length required — store (or replace) the board, streamed
 *                            straight into R2; header x-allow-download (1|0) also writes the flag, its absence leaves it
 *   PATCH  /api/boards/:id   bearer, JSON { allowDownload } — write only the flag on the SAME link, no re-upload
 *   DELETE /api/boards/:id   bearer — stop sharing: the link dies at once
 *   POST   /api/wipe         bearer — "delete all shared links": one page (≤1,000 objects) per call, answers { done }
 *   GET    /b/:id            the read-only viewer (download buttons only when allowed), under a strict CSP
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
const permKey = (id) => `perm/${id}`
/** Anything but a stored '0' counts as allowed (the new-share default). */
async function allowsDownload(env, id) {
  const flag = await env.BUCKET.get(permKey(id))
  return flag === null || (await flag.text()) !== '0'
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
/**
 * Every page is locked down: scripts only from this origin (the page has no inline script — the
 * board's details ride a JSON data block, which never executes), fetches only back to this origin,
 * never framed, never sniffed, and no Referer leaks the link to anything the drawing points at.
 */
export const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'content-security-policy': "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
}
const html = (body, status = 200) => new Response(body, { status, headers: PAGE_HEADERS })

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
  const length = request.headers.get('content-length')
  if (length === null || !/^\d+$/.test(length)) return json({ error: 'length_required' }, 411)
  const size = Number(length)
  // Checked on the declared size, before a byte is read: the body is never buffered here.
  if (size > MAX_BODY_BYTES) return json({ error: 'too_large', limit: MAX_BODY_BYTES }, 413)
  if (size === 0 || request.body === null) return json({ error: 'empty' }, 400)
  const name = decodeName(request.headers.get('x-board-name'))
  const updatedAt = Date.now()
  await env.BUCKET.put(key(id), request.body, {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: { name, updatedAt: String(updatedAt) },
  })
  const allow = request.headers.get('x-allow-download')
  if (allow !== null) await env.BUCKET.put(permKey(id), allow === '0' ? '0' : '1')
  return json({ id, size, updatedAt })
}

async function patchBoard(request, env, id) {
  let wanted
  try {
    wanted = (await request.json()).allowDownload
  } catch {
    wanted = undefined
  }
  if (typeof wanted !== 'boolean') return json({ error: 'bad_request' }, 400)
  if ((await env.BUCKET.head(key(id))) === null) return json({ error: 'not_found' }, 404)
  await env.BUCKET.put(permKey(id), wanted ? '1' : '0')
  return json({ id, allowDownload: wanted })
}

/**
 * One page per request — one list, one batched delete of up to 1,000 keys — so a call stays far
 * under the free plan's 50 subrequests however big the bucket is; the app calls again until
 * `done`. The whole bucket goes (boards/ and perm/): "Delete everything" deletes the bucket next,
 * and Cloudflare refuses to delete one that is not empty.
 */
async function wipe(env) {
  const page = await env.BUCKET.list({ limit: 1000 })
  const keys = page.objects.map((o) => o.key)
  if (keys.length > 0) await env.BUCKET.delete(keys)
  return json({ deleted: keys.length, done: !page.truncated })
}

/** A `filename*` value: `encodeURIComponent` leaves `'()*` bare, which RFC 5987 does not allow (an apostrophe ends the charset part). */
const rfc5987 = (s) => encodeURIComponent(s).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** The scene for the viewer (`download` false) or the download itself (`download` true — refused when off). */
async function sceneOrRaw(request, env, id, url, download) {
  const object = request.method === 'HEAD' ? await env.BUCKET.head(key(id)) : await env.BUCKET.get(key(id))
  if (object === null) return json({ error: 'not_found' }, 404)
  if (download && !(await allowsDownload(env, id))) return json({ error: 'download_not_allowed' }, 403)
  const name = object.customMetadata?.name ?? 'Shared board'
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  if (download && url.searchParams.has('download')) headers.set('content-disposition', `attachment; filename*=UTF-8''${rfc5987(`${name}.excalidraw`)}`)
  headers.set('x-board-name', encodeURIComponent(name))
  return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers })
}

/** The whole Worker as one function: `handle(request, env)` is what the fake server calls too. */
export async function handle(request, env) {
  const url = new URL(request.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const method = request.method

  if (parts[0] === 'api') {
    if (!authorised(request, env)) return json({ error: 'unauthorised' }, 401)
    if (parts[1] === 'wipe' && method === 'POST') return wipe(env)
    if (parts[1] === 'boards' && parts.length === 3 && ID_RE.test(parts[2])) {
      if (method === 'PUT') return putBoard(request, env, parts[2])
      if (method === 'PATCH') return patchBoard(request, env, parts[2])
      if (method === 'DELETE') {
        await env.BUCKET.delete([key(parts[2]), permKey(parts[2])])
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
    return html(viewerPage({ id: parts[1], allowDownload: await allowsDownload(env, parts[1]), name: object.customMetadata?.name ?? 'Shared board', updatedAt: Number(object.customMetadata?.updatedAt ?? 0) }))
  }

  if (parts.length === 0) return html(missingPage('Nothing is shared at this address.'), 404)
  return html(missingPage(), 404)
}

export default {
  fetch: (request, env) => handle(request, env),
}
