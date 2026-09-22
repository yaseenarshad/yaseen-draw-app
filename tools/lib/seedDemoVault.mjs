/**
 * Pure helpers for `tools/seedDemoVault.mjs`. Separated so the naming and content-id rules that
 * the app itself depends on (a vault asset is named for the SHA-1 of its bytes) are unit-tested
 * without writing a 130 MB vault to disk.
 */
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'

/** The vault the YAZ-1775 demo used and phase 4 reuses. `$HOME` is resolved, never hardcoded. */
export const defaultVault = () => path.join(homedir(), 'Desktop', 'Port to Electron App - Local Version')
/** The bare repo the vault's GitHub sync pushes to, beside it on the Desktop. */
export const defaultOrigin = () => path.join(homedir(), 'Desktop', 'Port to Electron App - Local Version (origin).git')

/** Mime → the extension `assets/<fileId>.<ext>` uses (🔒 D3). */
export const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
}

/**
 * A drawing's `fileId`: the lowercase SHA-1 hex of the bytes. This is Excalidraw's own
 * `generateIdFromFile`, and 🔒 D3 makes it the asset's filename too, which is what dedupes the
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
 * `--vault <dir>` and `--origin <bare-dir>`, both optional, both defaulting to the Desktop names
 * above. Unknown flags and missing values throw rather than silently seeding somewhere else — the
 * script wipes what it is pointed at.
 */
export function parseArgs(argv, { vault = defaultVault(), origin = defaultOrigin() } = {}) {
  const out = { vault, origin, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      out.help = true
      continue
    }
    if (arg !== '--vault' && arg !== '--origin') throw new Error(`unknown argument: ${arg}`)
    const value = argv[++i]
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a directory`)
    if (arg === '--vault') out.vault = path.resolve(value)
    else out.origin = path.resolve(value)
  }
  return out
}
