/** Last path segment (trailing slashes ignored); the input itself for `/`. */
export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || p
}

/** File name without its vault extension (`.excalidraw`); every other name is returned whole. */
export const stripExt = (name: string) => name.replace(/\.excalidraw$/i, '')

/** The folder a board sits in, relative to the vault — `/` at the root (Info 🔒 YAZ-1835 D7, the hover preview 🔒 YAZ-1800 D4). */
export function boardFolder(root: string, path: string): string {
  const rel = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  return rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '/'
}
