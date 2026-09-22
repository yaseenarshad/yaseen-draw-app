/**
 * Pure helpers for `tools/seedDemoVault.mjs`. Separated so the naming and content-id rules that
 * the app itself depends on (a vault asset is named for the SHA-1 of its bytes) are unit-tested
 * without writing a 130 MB vault to disk.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Mime → the extension `assets/<fileId>.<ext>` uses (🔒 YAZ-1775 D3). */
export const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
}

/**
 * A drawing's `fileId`: the lowercase SHA-1 hex of the bytes. This is Excalidraw's own
 * `generateIdFromFile`, and 🔒 YAZ-1775 D3 makes it the asset's filename too, which is what dedupes the
 * same image pasted into two boards down to one file.
 */
export const fileIdFor = (bytes) => createHash('sha1').update(bytes).digest('hex')

/** `<sha1>.<ext>` — the name the seeded bytes must land under for a board to resolve them. */
export function assetFileName(fileId, mime) {
  const ext = EXT[mime]
  if (!ext) throw new Error(`unsupported asset mime: ${mime}`)
  return `${fileId}.${ext}`
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
/**
 * An Excalidraw fractional index. Elements sort by `index` as a STRING, so the generator cannot
 * just count: `a10` sorts before `a2`. Two-char keys cover the first 62 elements, three-char keys
 * the rest, and every key of a longer form sorts after every key of a shorter one.
 */
export const fracIndex = (i) =>
  i < 62 ? `a${BASE62[i]}` : `b${BASE62[Math.floor((i - 62) / 62)]}${BASE62[(i - 62) % 62]}`

/**
 * `--vault <dir>` is REQUIRED and has no default: this script wipes what it is pointed at, and a
 * default would one day be pointed at somebody's real vault. `--origin` defaults to
 * `<vault> (origin).git` beside it, `--force` is what allows an existing directory to be wiped,
 * and unknown flags or missing values throw rather than silently seeding somewhere else.
 */
export function parseArgs(argv) {
  const out = { vault: null, origin: null, force: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg === '--force') {
      out.force = true
      continue
    }
    if (arg !== '--vault' && arg !== '--origin') throw new Error(`unknown argument: ${arg}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a directory`)
    if (arg === '--vault') out.vault = path.resolve(value)
    else out.origin = path.resolve(value)
  }
  if (out.help) return out
  if (out.vault === null) throw new Error('--vault <dir> is required')
  out.origin ??= `${out.vault} (origin).git`
  return out
}
