import { basename, stripExt } from './paths'

export const APP_NAME = 'Yaseen Docs'

/**
 * Obsidian-style window title (C3, GRO-2165): `<file> — <folder>` (vault extension stripped),
 * the folder name alone with no file open, the app name on the Welcome screen (no folder).
 */
export function windowTitle(root: string | null, file: string | null): string {
  if (root === null) return APP_NAME
  if (file === null) return basename(root)
  return `${stripExt(basename(file))} — ${basename(root)}`
}
