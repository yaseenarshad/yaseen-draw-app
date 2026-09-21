/**
 * File path in the URL hash (GRO-2069 Q5): the open file shows as `#/abs/path.md` so the
 * URL is readable/copyable and a pasted URL reopens that exact file. Written with
 * `history.replaceState` (no back-button spam); on boot the hash wins over the stored
 * last-file (App.tsx). `encodeURI` keeps `/` readable and encodes spaces.
 */

/** Absolute file path carried by `hash` (location.hash form), or null when it carries none. */
export function hashFilePath(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  try {
    return decodeURI(hash.slice(1))
  } catch {
    return null
  }
}

/** Hash for the open file; empty string when no file is open (replaceState with '' clears it). */
export function fileHash(path: string | null): string {
  return path === null ? '' : `#${encodeURI(path)}`
}
