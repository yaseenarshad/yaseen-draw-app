import { basename } from '../lib/paths'
import { errorText, type MenuAction, type MenuSection } from './menuSections'

/**
 * The vault right-click menu AS DATA (YAZ-1941, a port of Docs YAZ-1798 — D2/D7 are 1798's): GitHub Desktop's repository menu, kept to
 * what means something for a vault. Drawn by the sidebar's own `ContextMenu`, which skips empty
 * groups — so the CURRENT vault simply returns two of the four. Four groups, in this order:
 *
 *   Open in this window · Copy vault name, Copy path · Reveal in Finder, Open in VS Code · Remove from recent vaults
 *
 * The current vault (the header's name, or its own row) gets neither "Open in this window" (you
 * are there) nor "Remove" (it is recents[0] and would come straight back, D3). Nothing is `danger`:
 * Remove only forgets an MRU entry, the folder is untouched.
 */
export interface VaultMenuTarget {
  path: string
  isCurrent: boolean
}

export interface VaultMenuHandlers {
  /** Switch THIS window to the vault in place (D8, D11) — the one deliberate overwrite; every plain gesture opens beside. */
  onOpenHere: (path: string) => void
  onReveal: (path: string) => void
  onOpenVsCode: (path: string) => void
  /** Forget the MRU entry (D3): no confirm, the folder on disk is untouched. */
  onRemove: (path: string) => void
  /** The sidebar's passive notice — every copy confirms or reports, the `menuSections` idiom (D9). */
  onNotice: (message: string) => void
}

/** A clipboard copy that says what it did — or why it could not. */
const copyItem = (id: string, what: string, text: string, h: VaultMenuHandlers): MenuAction => ({
  id,
  label: `Copy ${what}`,
  onSelect: () => {
    void navigator.clipboard.writeText(text).then(
      () => h.onNotice(`Copied ${what}`),
      (error: unknown) => h.onNotice(`Can't copy ${what}: ${errorText(error)}`),
    )
  },
})

export function buildVaultMenuSections({ path, isCurrent }: VaultMenuTarget, h: VaultMenuHandlers): MenuSection[] {
  return [
    isCurrent ? [] : [{ id: 'open-here', label: 'Open in this window', onSelect: () => h.onOpenHere(path) }],
    [copyItem('copy-name', 'vault name', basename(path), h), copyItem('copy-path', 'path', path, h)],
    [
      { id: 'reveal', label: 'Reveal in Finder', onSelect: () => h.onReveal(path) },
      { id: 'open-vscode', label: 'Open in VS Code', onSelect: () => h.onOpenVsCode(path) },
    ],
    isCurrent ? [] : [{ id: 'remove', label: 'Remove from recent vaults', onSelect: () => h.onRemove(path) }],
  ]
}
