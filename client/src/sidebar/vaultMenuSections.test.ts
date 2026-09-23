/**
 * The vault right-click menu's items (YAZ-1798 D7), tested pure: which items a vault gets, in
 * which groups, and what each hands its handler. `ContextMenu.test.tsx` owns the drawing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MenuAction, MenuSection } from './menuSections'
import { buildVaultMenuSections, type VaultMenuHandlers } from './vaultMenuSections'

const OTHER = '/v/Émojis 🚀 & spaces'

function handlers(): VaultMenuHandlers {
  return { onOpenHere: vi.fn(), onReveal: vi.fn(), onOpenVsCode: vi.fn(), onRemove: vi.fn(), onNotice: vi.fn() }
}

/** The non-empty groups' labels — what `ContextMenu` draws, a hairline between each. */
const groupsOf = (sections: MenuSection[]) => sections.filter((s) => s.length > 0).map((s) => s.map((i) => i.label))
const item = (sections: MenuSection[], id: string) => sections.flat().find((i) => i.id === id) as MenuAction

function installClipboard(fail?: Error) {
  const writeText = vi.fn(async () => {
    if (fail !== undefined) throw fail
  })
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  return writeText
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildVaultMenuSections (YAZ-1798 D7)', () => {
  it('another vault: Open in this window · the two copies · Reveal and VS Code · Remove — four groups in that order', () => {
    expect(groupsOf(buildVaultMenuSections({ path: OTHER, isCurrent: false }, handlers()))).toEqual([
      ['Open in this window'],
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
      ['Remove from recent vaults'],
    ])
  })

  it('the current vault: no Open in this window (you are there) and no Remove (it would come straight back, D3)', () => {
    expect(groupsOf(buildVaultMenuSections({ path: OTHER, isCurrent: true }, handlers()))).toEqual([
      ['Copy vault name', 'Copy path'],
      ['Reveal in Finder', 'Open in VS Code'],
    ])
  })

  it('nothing is danger-styled and nothing is disabled — Remove only forgets an MRU entry', () => {
    const all = buildVaultMenuSections({ path: OTHER, isCurrent: false }, handlers()).flat()
    expect(all.some((i) => i.danger === true || (i as MenuAction).disabled === true)).toBe(false)
  })

  it('each verb hands its handler the vault path', () => {
    const h = handlers()
    const sections = buildVaultMenuSections({ path: OTHER, isCurrent: false }, h)
    for (const [id, fn] of [
      ['open-here', h.onOpenHere],
      ['reveal', h.onReveal],
      ['open-vscode', h.onOpenVsCode],
      ['remove', h.onRemove],
    ] as const) {
      item(sections, id).onSelect()
      expect(fn).toHaveBeenCalledWith(OTHER)
    }
  })

  it('Copy vault name writes the basename verbatim and confirms', async () => {
    const writeText = installClipboard()
    const h = handlers()
    item(buildVaultMenuSections({ path: `${OTHER}/`, isCurrent: false }, h), 'copy-name').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith('Copied vault name'))
    expect(writeText).toHaveBeenCalledWith('Émojis 🚀 & spaces')
  })

  it('Copy path writes the absolute path and confirms', async () => {
    const writeText = installClipboard()
    const h = handlers()
    item(buildVaultMenuSections({ path: OTHER, isCurrent: true }, h), 'copy-path').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith('Copied path'))
    expect(writeText).toHaveBeenCalledWith(OTHER)
  })

  it('a clipboard the OS refused is reported, never silent', async () => {
    installClipboard(new Error('denied'))
    const h = handlers()
    item(buildVaultMenuSections({ path: OTHER, isCurrent: false }, h), 'copy-path').onSelect()
    await vi.waitFor(() => expect(h.onNotice).toHaveBeenCalledWith("Can't copy path: denied"))
  })
})
