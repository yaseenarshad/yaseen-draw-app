/** Last path segment (trailing slashes ignored); the input itself for `/`. */
export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || p
}

/** File name without its board extension (`.excalidraw`, or `.drawio` — 🔒 YAZ-1802 D13); every other name is returned whole. */
export const stripExt = (name: string) => name.replace(/\.(excalidraw|drawio)$/i, '')

/** The folder a board sits in, relative to the vault — `/` at the root (Info 🔒 YAZ-1835 D7, the hover preview 🔒 YAZ-1800 D4). */
export function boardFolder(root: string, path: string): string {
  const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '/'
}

/**
 * A vault-relative POSIX path (git's, e.g. sync's `tooLarge`) as the absolute path the tree uses,
 * in the ROOT's own separator: `C:\Notes` + `a/b.mov` → `C:\Notes\a\b.mov` on Windows, where
 * main's tree paths come from `path.join`. A root with any `/` is treated as POSIX.
 */
export function vaultPath(root: string, rel: string): string {
  const sep = root.includes('/') || !root.includes('\\') ? '/' : '\\'
  const base = root.endsWith(sep) ? root.slice(0, -1) : root
  return `${base}${sep}${sep === '/' ? rel : rel.split('/').join(sep)}`
}
