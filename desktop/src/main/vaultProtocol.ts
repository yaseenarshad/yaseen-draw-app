import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { IMAGE_EXTENSIONS } from '@shared/types'
import { mimeFor, resolveAsset } from './fs/assets'

/**
 * `app://vault/…` — vault images served straight to `<img src>` (YAZ-1658, the first build unit
 * of images-as-first-class-citizens YAZ-1656, D1). WHY a URL and not `readAsset`: the base64 hop
 * exists for cards and drawing scenes, where the renderer needs the BYTES; an image tag needs
 * only a source, and a URL lets Chromium decode, cache and lazy-load it like any other image
 * with nothing crossing IPC. It rides the EXISTING `app://` scheme (registered privileged in
 * `index.ts`) under a second host, so no new scheme, no new CSP entry and no new privilege —
 * `yaseen` stays the renderer bundle, `vault` is this.
 *
 * The grammar the renderer builds (each `<seg>` `encodeURIComponent`-encoded, joined by `/`):
 *
 *     app://vault/<root>/<ref seg>[/<ref seg>…][?from=<note dir>]
 *
 * `<root>` is the ABSOLUTE vault root as ONE segment — its own slashes encoded, which the URL
 * parser never decodes, so it survives as one piece; `<ref>` is the image link as written in
 * the markdown, split on `/`; `from` is the linking note's ROOT-RELATIVE directory (`''` at
 * the root) so a note's own `./pic.png` beats a same-named file elsewhere. Resolution is
 * `resolveAsset`'s Obsidian order (note-relative → root-relative → shortest-path basename),
 * restricted to `IMAGE_EXTENSIONS`; a drawing, a text file, an escape or a miss is a plain 404
 * with no file read — the `<img>` shows nothing, exactly as for a dead `http` source.
 *
 * THE VAULT EDGE. The root is the renderer's claim, as it is for `readAsset(root, ref)` — the
 * "no jail" posture `docs/CONTRACTS.md` documents — so the guard is that a REF can never reach
 * outside the root it was given: `resolveAsset` refuses both path steps when they land outside
 * `root`, and its basename walk cannot leave the tree. A `..` inside the URL path (`../`, or the
 * `%2e%2e` / `.%2e` spellings, all of which the WHATWG parser collapses before `pathname` is
 * read) can only eat INTO the root segment — leaving either a relative first segment, which
 * fails the absolute-root check, or another absolute root the renderer could have named
 * outright. A `..` encoded INSIDE a ref segment (`..%2F..%2Fetc`) reaches `resolveAsset` as a
 * ref and meets the edge there.
 *
 * CASE. macOS's default APFS is case-insensitive, so a ref `x.png` for a file `X.PNG` lands on
 * the path step and the served path carries the ref's spelling; on a case-sensitive volume the
 * path step misses and the basename walk — always case-insensitive — answers with the on-disk
 * spelling. Same bytes, same `Content-Type` either way: the mime comes from the ref's
 * LOWERCASED extension, never from the file's.
 *
 * `Cache-Control: no-cache` so a file replaced on disk under the same name re-fetches on the
 * next paint rather than serving the stale cache entry — a pasted screenshot is never
 * overwritten (`create`), but a user swapping a file in Finder is.
 *
 * Pure Node: the file fetch and the Finder reveal are parameters, so this whole module tests
 * without Electron; `index.ts` passes `net.fetch` and `revealItem`.
 */

export interface VaultUrl {
  /** Absolute vault root, decoded. */
  root: string
  /** The image link as written, path segments decoded and re-joined with `/`. */
  ref: string
  /** Root-relative directory of the linking note, decoded; absent when the URL carries no `from`. */
  from?: string
}

/** The grammar above, or null for anything else: another scheme or host, a relative root, an empty ref. */
export function parseVaultUrl(url: string): VaultUrl | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'app:' || parsed.host !== 'vault') return null
  let segments: string[]
  try {
    segments = parsed.pathname.split('/').slice(1).map(decodeURIComponent)
  } catch {
    return null // a malformed escape (`%E0%A4%A`) throws; nothing to serve
  }
  const [root, ...refSegments] = segments
  if (root === undefined || !path.isAbsolute(root)) return null
  const ref = refSegments.join('/')
  if (ref === '') return null
  const from = parsed.searchParams.get('from')
  return from === null ? { root, ref } : { root, ref, from }
}

export interface VaultImage {
  /** Absolute path of the file that resolved, under the URL's root. */
  path: string
  /** From the ref's lowercased extension, via the asset pipe's one MIME table. */
  mime: string
}

/** A well-formed vault URL naming an existing image under its root; null for anything else. */
export async function resolveVaultUrl(url: string): Promise<VaultImage | null> {
  const target = parseVaultUrl(url)
  if (target === null) return null
  const ext = path.extname(target.ref).slice(1).toLowerCase()
  const mime = mimeFor(ext)
  if (mime === undefined || !(IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return null
  const file = await resolveAsset(target.root, target.ref, target.from)
  return file === null ? null : { path: file, mime }
}

/**
 * The `protocol.handle('app')` branch for host `vault`. `fetchFile` is `net.fetch` in the app;
 * its response is re-wrapped because a fetch `Response`'s headers are immutable and these must
 * be OURS — the asset pipe's mime and the `no-cache` the replaced-file case needs. A file that
 * vanishes between the resolve and the fetch rejects out of the handler, which Chromium reports
 * to the `<img>` as a failed load: the same broken image a 404 gives, for a race not worth a
 * second stat.
 */
export async function serveVaultImage(req: Request, fetchFile: (fileUrl: string) => Promise<Response>): Promise<Response> {
  const image = await resolveVaultUrl(req.url)
  if (image === null) return new Response(null, { status: 404 })
  const upstream = await fetchFile(pathToFileURL(image.path).toString())
  return new Response(upstream.body, { status: 200, headers: { 'Content-Type': image.mime, 'Cache-Control': 'no-cache' } })
}

/**
 * The context menu's Reveal in Finder for an image (YAZ-1666): the `<img src>` as loaded goes
 * through the SAME resolver the protocol serves from, so the file Finder shows is the file the
 * page drew. Only an `app://vault` source names a vault file; an `http`, `data:` or bundle URL
 * resolves to null and the click does nothing — there is no file to reveal. The row still shows
 * for those (a card cover from the web is an `<img>` too): Chromium's `mediaType` says what the
 * element is, not where its bytes came from, and a no-op is more honest than a notice.
 */
export async function revealVaultImage(srcURL: string, reveal: (file: string) => Promise<unknown>): Promise<void> {
  const image = await resolveVaultUrl(srcURL)
  if (image !== null) await reveal(image.path)
}
