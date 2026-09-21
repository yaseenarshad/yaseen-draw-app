/**
 * Image src → what the `<img>` actually loads (YAZ-1656), plus Obsidian's `alt|width` syntax.
 *
 * THE SRC IN THE MARKDOWN IS NEVER REWRITTEN. `![a](images/x.png)` stays those bytes on disk; only
 * the DOM's `src` attribute is the resolved URL. Resolution itself lives in MAIN behind the
 * `app://vault/...` protocol (note-relative first, then root-relative, then Obsidian's basename
 * search, 404 otherwise) — the renderer only names the two things main needs: which vault, and
 * which directory the note sits in. So an image that Obsidian would show, this shows, and the
 * one it would not is a broken chip, with no filesystem knowledge in the renderer at all.
 *
 * Pass-through: anything with a URL scheme (`https:`, `data:`, `blob:`, `app:`, `file:`) is left
 * alone — a foreign `app://fs/...` pasted from elsewhere simply 404s into the broken state, which
 * is honest. A leading `/` is Obsidian's "from the vault root", so it is stripped and treated as
 * root-relative rather than as an absolute OS path.
 *
 * WIDTH rides in the alt (`![alt|400](src)`): Obsidian's syntax, and the ONLY place a width can
 * live without a schema or serializer change — the commonmark image node has exactly `src`, `alt`,
 * `title`. `parseAlt` / `formatAlt` are the one pair that reads and writes it, so `'a|b'` (not a
 * width) and `'|400'` (no text) round-trip byte-identically through them.
 */

/** `scheme:` per RFC 3986 — the `//` is not required (`data:`, `mailto:`). */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

const TRAILING_WIDTH_RE = /^(.*?)\|(\d+)$/

/** True for a src the browser resolves itself; false for a vault-relative path. */
export function hasScheme(src: string): boolean {
  return SCHEME_RE.test(src)
}

/**
 * Root-relative directory of `notePath` under `root` ('' at the root, or when the note is not
 * under the root at all). Posix semantics only — the app ships mac-only.
 */
export function noteDirRel(root: string, notePath: string): string {
  const base = root.replace(/\/+$/, '')
  if (!notePath.startsWith(`${base}/`)) return ''
  const rel = notePath.slice(base.length + 1)
  const cut = rel.lastIndexOf('/')
  return cut === -1 ? '' : rel.slice(0, cut)
}

/**
 * A markdown src is ALREADY a URL-ish string: CommonMark (and Obsidian, which writes `%20`) percent-
 * encodes spaces and friends. Each segment is decoded ONCE, then encoded for the vault URL, so
 * `case%20a.png` and a raw `case a.png` both reach main as the file name `case a.png` — never as
 * `case%2520a.png`. A malformed escape (`100%.png`) is kept verbatim rather than thrown on.
 */
function encodeRef(ref: string): string {
  return ref.split('/').map((seg) => encodeURIComponent(decodeSegment(seg))).join('/')
}

function decodeSegment(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

/**
 * The URL the `<img>` loads for `src` as written in a note whose directory is `noteDirRel`
 * (see `noteDirRel()`); schemed srcs pass through untouched.
 */
export function imageSrc(root: string, noteDirRel: string, src: string): string {
  if (hasScheme(src)) return src
  const ref = src.replace(/^\/+/, '')
  return `app://vault/${encodeURIComponent(root)}/${encodeRef(ref)}?from=${encodeURIComponent(noteDirRel)}`
}

/** `'x|400'` → text `x`, width 400; `'|400'` → `''`, 400; `'x'` / `'a|b'` → no width. */
export function parseAlt(alt: string): { text: string; width: number | null } {
  const m = TRAILING_WIDTH_RE.exec(alt)
  if (m === null) return { text: alt, width: null }
  return { text: m[1], width: Number(m[2]) }
}

/** The inverse of `parseAlt`: a null width writes the text alone. */
export function formatAlt(text: string, width: number | null): string {
  return width === null ? text : `${text}|${width}`
}
