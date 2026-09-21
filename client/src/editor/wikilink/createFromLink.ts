/**
 * Create-on-click for unresolved wiki links (Links C, GRO-2192): clicking an unresolved
 * `[[link]]` CREATES its page, then opens it — never a dialog. The page name is the raw
 * inner text with `|alias` / `#heading` / `#^block` stripped (`linkPageName` — resolution
 * strips inside the resolver, creation must strip here); an empty result (`[[#h]]`, the
 * same-file form) is a no-op.
 *
 * Location ruling (LOCKED, C2- GRO-2240): a BARE target creates under `base` — the
 * root-relative folder App computes from the "default location for new notes" setting via
 * `newNoteBase` ('' = the vault root, which is also Obsidian's and the setting's default).
 * A pathed target (`[[Sub/Page]]`, `[[/Page]]`) is an explicit aim and stays root-relative
 * whatever the setting (Obsidian's behavior); missing parent folders — the base included —
 * are created level by level (`ensureFolder` — the bridge's `createDir` does not recurse).
 * `.md` is appended unless the name is already markdown (mirrors the sidebar's `entryPath`).
 * Races are benign: `ALREADY_EXISTS` means someone created the page first — just open it.
 * Invalid names and create failures come back as `error` for the caller's passive notice
 * (App's link-notice).
 */
import type { SettingsState } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { ensureFolder } from '../../views/scaffold'
import { validateEntryName } from '../../sidebar/createEntry'
import { linkPageName } from './wikilinkPlugin'

export type CreateFromLinkResult =
  /** The page exists now — open `path` (`exists` = lost the creation race, equally fine). */
  | { status: 'created' | 'exists'; path: string }
  /** Same-file link (`[[#h]]`): nothing to create, nothing to open. */
  | { status: 'noop' }
  /** Unusable name or bridge failure: show `message` as a passive notice, never a dialog. */
  | { status: 'error'; message: string }

/**
 * The root-relative base folder where a BARE unresolved `[[link]]` creates its page
 * (C2-, GRO-2240) — pure, computed by App from the Files & Links setting + the SOURCE page
 * (the page the link was clicked or typed in, YAZ-1643): `'root'` → '' (the vault root);
 * `'current'` (the default) → the source page's folder, falling back to the root for a
 * source outside the vault; `'folder'` → `newNoteFolder` (validated at the settings
 * boundary; junk still fails safe in `planLinkCreation`).
 */
export function newNoteBase(settings: Pick<SettingsState, 'newNoteLocation' | 'newNoteFolder'>, root: string, sourcePath: string): string {
  if (settings.newNoteLocation === 'folder') return settings.newNoteFolder
  if (settings.newNoteLocation === 'current' && sourcePath.startsWith(`${root}/`)) {
    const rel = sourcePath.slice(root.length + 1)
    const cut = rel.lastIndexOf('/')
    return cut === -1 ? '' : rel.slice(0, cut)
  }
  return ''
}

/**
 * Pure path planning for `target` (already stripped): root-relative folder ('' = the vault
 * root) + the absolute `.md` path, or a human-readable error. A BARE target lands under
 * `base` (see `newNoteBase`); a PATHED one ignores it — an explicit path is an explicit
 * aim (module doc). Each `/`-segment — base segments included — passes the sidebar's
 * `validateEntryName` rules; errors name the full effective path.
 */
export function planLinkCreation(root: string, target: string, base = ''): { folder: string; path: string } | { error: string } {
  const effective = base !== '' && !target.includes('/') ? `${base}/${target}` : target
  const segments = effective.replace(/^\/+/, '').split('/').map((s) => s.trim())
  for (const segment of segments) {
    if (segment === '') return { error: `Can't create "${effective}": empty name` }
    const reason = validateEntryName(segment)
    if (reason !== null) return { error: `Can't create "${effective}": ${reason}` }
  }
  const last = segments[segments.length - 1]
  const name = /\.(md|markdown)$/i.test(last) ? last : `${last}.md`
  const folder = segments.slice(0, -1).join('/')
  return { folder, path: `${root}/${folder === '' ? '' : `${folder}/`}${name}` }
}

/** Create the page behind raw `[[inner]]` under `root` — bare targets under `base` — and resolve where to open (see module doc). */
export async function createFromLink(root: string, inner: string, base = ''): Promise<CreateFromLinkResult> {
  const target = linkPageName(inner)
  if (target === '') return { status: 'noop' }
  const planned = planLinkCreation(root, target, base)
  if ('error' in planned) return { status: 'error', message: planned.error }
  try {
    if (planned.folder !== '') await ensureFolder(root, planned.folder)
    await api.createFile(planned.path)
    return { status: 'created', path: planned.path }
  } catch (err) {
    if (err instanceof BridgeRequestError && err.code === 'ALREADY_EXISTS') return { status: 'exists', path: planned.path }
    return { status: 'error', message: `Can't create "${target}": ${err instanceof Error ? err.message : String(err)}` }
  }
}
