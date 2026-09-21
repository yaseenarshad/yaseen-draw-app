/** Last path segment (trailing slashes ignored); the input itself for `/`. */
export function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1) || p
}

/** File name without its vault extension (`.md` / `.markdown`). */
export const stripExt = (name: string) => name.replace(/\.(md|markdown)$/i, '')
