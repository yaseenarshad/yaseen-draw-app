/**
 * The sidebar menu's GATING rules (🔒 D8, YAZ-1674), tested pure: `buildMenuSections` takes the
 * pinned targets and the handlers and answers with six groups of items. Every rule that used to
 * be pinned against `ContextMenu`'s DOM lives here now — which item appears for which target,
 * what it is called, where it sits, what it hands its handler — while `ContextMenu.test.tsx`
 * keeps only the component's mechanics.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildMenuSections, type MenuAction, type MenuHandlers, type MenuParent, type MenuSection, type MenuSectionTargets } from './menuSections'

const targets = (over: Partial<MenuSectionTargets> = {}): MenuSectionTargets => ({
  x: 0,
  y: 0,
  targetDir: '/v',
  rowKind: null,
  copyPath: null,
  // The multi-select pair (🔒 D5, YAZ-1337): null is the ordinary menu — no selection to act on.
  copyPaths: null,
  openTabPaths: null,
  clipPaths: null,
  newWindowPath: null,
  agentPath: null,
  renamePath: null,
  deletePath: null,
  revealPath: null,
  openVsCodePath: null,
  openDefaultPath: null,
  folderPagePath: null,
  folderPageIsOn: false,
  topicsAnchor: null,
  focusPaths: null,
  favoritePaths: null,
  favoriteIsOn: false,
  clip: null,
  ...over,
})

const handlers = (over: Partial<MenuHandlers> = {}): MenuHandlers => ({
  onOpenInNewTabs: vi.fn(),
  onOpenNewWindow: vi.fn(),
  onOpenVsCode: vi.fn(),
  onOpenDefault: vi.fn(),
  onReveal: vi.fn(),
  focusLabel: 'Focus on folder',
  onFocus: vi.fn(),
  onCut: vi.fn(),
  onCopy: vi.fn(),
  onPaste: vi.fn(),
  onNotice: vi.fn(),
  onCopyForAgent: vi.fn(),
  onNewNote: vi.fn(),
  onNewFolderPage: vi.fn(),
  onNewFolder: vi.fn(),
  onNewDatedFolder: vi.fn(),
  onToggleFolderPage: vi.fn(),
  onToggleFavorite: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  ...over,
})

const build = (t: Partial<MenuSectionTargets> = {}, h: Partial<MenuHandlers> = {}) => buildMenuSections(targets(t), handlers(h))
const labelsOf = (sections: MenuSection[]) => sections.flat().map((i) => i.label)
const itemOf = (sections: MenuSection[], label: string) => sections.flat().find((i) => i.label === label)
/** Select a LEAF by label — a parent has no `onSelect`, and reaching for one is a test bug, so it throws. */
const select = (sections: MenuSection[], label: string) => {
  const found = itemOf(sections, label)
  if (found === undefined || found.onSelect === undefined) throw new Error(`no leaf "${label}"`)
  found.onSelect()
}
/** A LEAF by label (`disabled` lives on leaves only); undefined when absent or a parent. */
const leafOf = (sections: MenuSection[], label: string): MenuAction | undefined => {
  const found = itemOf(sections, label)
  return found !== undefined && found.onSelect !== undefined ? found : undefined
}
/** The "Open in ▸" parent's sections (D7 amended), or undefined when there is no parent. */
const openInOf = (sections: MenuSection[]): readonly MenuAction[][] | undefined => (itemOf(sections, 'Open in') as MenuParent | undefined)?.children
const openInLabels = (sections: MenuSection[]) => openInOf(sections)?.map((section) => section.map((i) => i.label))
/** A leaf inside the flyout, by label. */
const subItemOf = (sections: MenuSection[], label: string) => openInOf(sections)?.flat().find((i) => i.label === label)
/** The non-empty groups' labels — what the component draws, separators between. */
const groupsOf = (sections: MenuSection[]) => sections.filter((s) => s.length > 0).map((s) => s.map((i) => i.label))

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

/** A Markdown FILE row inside no selection — the fullest singular menu there is. */
const FILE_ROW: Partial<MenuSectionTargets> = {
  rowKind: 'file',
  copyPath: '/v/Note.md',
  clipPaths: ['/v/Note.md'],
  newWindowPath: '/v/Note.md',
  agentPath: '/v/Note.md',
  renamePath: '/v/Note.md',
  deletePath: '/v/Note.md',
  revealPath: '/v/Note.md',
  openVsCodePath: '/v/Note.md',
  openDefaultPath: '/v/Note.md',
  folderPagePath: '/v/Note.md',
}

/** Blank space: every row-only target null, the root fallbacks in place (GRO-2273, GRO-2274). */
const BLANK: Partial<MenuSectionTargets> = { copyPath: '/v', revealPath: '/v', openVsCodePath: '/v', openDefaultPath: '/v' }

describe('the six groups (🔒 D7, amended)', () => {
  it('always answers six sections in order — Open, clipboard, create, this row, Open in, Delete — empties included', () => {
    expect(build()).toHaveLength(6)
    expect(build(FILE_ROW)).toHaveLength(6)
  })

  it('a Markdown FILE row fills five of the six (the Open group is empty), in the pinned order', () => {
    // The Open group is EMPTY on one file row (no plural open, nothing to focus), so the clipboard
    // group leads; the OS verbs live in the "Open in ▸" flyout, a group of its own before Delete.
    expect(groupsOf(build(FILE_ROW))).toEqual([
      ['Cut', 'Copy', 'Paste', 'Copy path', 'Copy for Agent'],
      ['New note', 'New folder page', 'New folder', 'New dated folder'],
      ['Turn into folder page', 'Rename'],
      ['Open in'],
      ['Delete'],
    ])
  })

  it('BLANK SPACE has no row to rename or delete: the this-row and Delete groups are empty, so the menu ends on "Open in"', () => {
    expect(groupsOf(build(BLANK))).toEqual([
      ['Paste', 'Copy path'],
      ['New note', 'New folder page', 'New folder', 'New dated folder'],
      ['Open in'], // the root's own OS verbs — the one this-row item blank space has
    ])
  })

  it('a 2+ selection: "Open N in new tabs" LEADS the menu and "Copy N paths" leads the text clipboard, below the Open group', () => {
    const labels = labelsOf(build({ ...FILE_ROW, copyPaths: ['/v/a.md', '/v/b.md'], openTabPaths: ['/v/a.md', '/v/b.md'], clipPaths: ['/v/a.md', '/v/b.md'] }))
    expect(labels[0]).toBe('Open 2 in new tabs')
    // 🔒 D7 loosens YAZ-1337's "the plural pair leads": the plural copy now sits in its group.
    expect(labels.indexOf('Copy 2 paths')).toBeGreaterThan(labels.indexOf('Open 2 in new tabs'))
    expect(labels.indexOf('Copy 2 paths')).toBe(labels.indexOf('Copy path') - 1)
  })

  it('"Open N in new tabs" LEADS the group and hands the exact FILE list (🔒 D5, YAZ-1337); a folders-only selection has none (YAZ-1578 🔒 D3)', () => {
    const onOpenInNewTabs = vi.fn()
    expect(labelsOf(build({ copyPaths: ['/v/one', '/v/two'], openTabPaths: null })).some((l) => /in new tabs$/.test(l))).toBe(false)
    select(build({ openTabPaths: ['/v/a.md', '/v/b.md'] }, { onOpenInNewTabs }), 'Open 2 in new tabs')
    expect(onOpenInNewTabs).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/b.md'])
  })

  it('Delete is LAST wherever it appears, alone in its group, and flagged danger (GRO-2272 C1a)', () => {
    const sections = build(FILE_ROW)
    const labels = labelsOf(sections)
    expect(labels[labels.length - 1]).toBe('Delete')
    expect(sections[5]).toHaveLength(1)
    expect(itemOf(sections, 'Delete')?.danger).toBe(true)
    expect(sections.flat().filter((i) => i.danger === true).map((i) => i.label)).toEqual(['Delete'])
  })
})

/**
 * The create group (🔒 D4, YAZ-817): "New folder page" is the SECOND item, directly after
 * "New note" — a folder page is a note born with one flag (🔒 D1), so it belongs beside the
 * note it is a kind of, not beside the act-on-this-row toggle further down. Pinned here
 * because the position IS the ruling, not an accident of ordering.
 */
describe('create group (🔒 D4)', () => {
  it('offers New folder page directly after New note, ahead of New folder', () => {
    expect(build()[2].map((i) => i.label)).toEqual(['New note', 'New folder page', 'New folder', 'New dated folder'])
  })

  it('is offered on every row type — the group targets a DIRECTORY, never the clicked row', () => {
    expect(labelsOf(build(FILE_ROW))).toContain('New folder page')
    expect(labelsOf(build(BLANK))).toContain('New folder page')
  })

  it('the two disk-folder births share ONE gate (YAZ-948; YAZ-1604): a null handler hides both', () => {
    const labels = labelsOf(build(FILE_ROW, { onNewFolder: null, onNewDatedFolder: null }))
    expect(labels).not.toContain('New folder')
    expect(labels).not.toContain('New dated folder')
    expect(labels).toContain('New note')
    expect(labels).toContain('New folder page')
  })

  it('hands the click to the caller — the handler itself is the item (the New note idiom)', () => {
    const onNewFolderPage = vi.fn()
    select(build({}, { onNewFolderPage }), 'New folder page')
    expect(onNewFolderPage).toHaveBeenCalledTimes(1)
  })
})

/**
 * ONE state-aware item, both directions (🔒 D2, YAZ-817). The label is the flag's; the select
 * hands the handler BOTH the target and the direction, so the caller never has to re-derive
 * which way the toggle was pointing after the menu closed (GRO-2296).
 */
describe('folder-page toggle item (🔒 D2)', () => {
  it('reads "Turn into folder page" while the flag is off', () => {
    const labels = labelsOf(build({ folderPagePath: '/v/a.md', folderPageIsOn: false }))
    expect(labels).toContain('Turn into folder page')
    expect(labels).not.toContain('Turn back into normal page')
  })

  it('reads "Turn back into normal page" while the flag is on', () => {
    const labels = labelsOf(build({ folderPagePath: '/v/a.md', folderPageIsOn: true }))
    expect(labels).toContain('Turn back into normal page')
    expect(labels).not.toContain('Turn into folder page')
  })

  it('is absent entirely when there is no target', () => {
    expect(labelsOf(build({ folderPagePath: null, folderPageIsOn: false })).some((l) => l.startsWith('Turn'))).toBe(false)
  })

  it('hands the select its own target AND the direction', () => {
    const onToggleFolderPage = vi.fn()
    select(build({ folderPagePath: '/v/a.md', folderPageIsOn: true }, { onToggleFolderPage }), 'Turn back into normal page')
    expect(onToggleFolderPage).toHaveBeenCalledExactlyOnceWith('/v/a.md', true)
  })

  it('sits after the create group and directly above Rename — above the destructive pair, which keeps the bottom', () => {
    const sections = build(FILE_ROW)
    expect(sections[3].map((i) => i.label)).toEqual(['Turn into folder page', 'Rename'])
  })
})

/**
 * "Open in ▸" (D7 amended, YAZ-1674): the OS verbs (GRO-2168, GRO-2274,
 * YAZ-963, YAZ-1577) collapse into one parent. Every child keeps its own gate — a path or nothing,
 * the root on blank space, New window FILE rows only — and Reveal sits alone below a separator
 * (a second section). No child → no parent. The parent has no select of its own.
 */
describe('"Open in ▸" (D7 amended)', () => {
  it('a Markdown FILE row: the three open verbs, then Reveal in its own section', () => {
    expect(openInLabels(build(FILE_ROW))).toEqual([['New window', 'VS Code', 'Default app'], ['Reveal in Finder']])
  })

  it('the parent is a parent: no onSelect, and it stands ALONE in its own group between the this-row items and Delete', () => {
    const sections = build({ ...FILE_ROW, openTabPaths: ['/v/a.md', '/v/b.md'] })
    expect(itemOf(sections, 'Open in')?.onSelect).toBeUndefined()
    expect(sections[0].map((i) => i.label)).toEqual(['Open 2 in new tabs'])
    expect(sections[3].map((i) => i.label)).toEqual(['Turn into folder page', 'Rename'])
    expect(sections[4].map((i) => i.label)).toEqual(['Open in'])
  })

  it('no child at all → no parent', () => {
    expect(itemOf(build(), 'Open in')).toBeUndefined()
  })

  it('"New window" is FILE rows only (D2, GRO-2168): blank space gets VS Code / Default app / Reveal on the root', () => {
    const onOpenNewWindow = vi.fn()
    expect(openInLabels(build(BLANK))).toEqual([['VS Code', 'Default app'], ['Reveal in Finder']])
    expect(subItemOf(build(BLANK), 'New window')).toBeUndefined()
    subItemOf(build({ newWindowPath: '/v/a.md' }, { onOpenNewWindow }), 'New window')?.onSelect()
    expect(onOpenNewWindow).toHaveBeenCalledExactlyOnceWith('/v/a.md')
  })

  it('each of VS Code / Default app / Reveal is a path or nothing, Default app directly after VS Code, and hands the caller its OWN path', () => {
    const onOpenVsCode = vi.fn()
    const onOpenDefault = vi.fn()
    const onReveal = vi.fn()
    expect(openInLabels(build({ openVsCodePath: '/v/Zeta' }))).toEqual([['VS Code'], []])
    expect(openInLabels(build({ revealPath: '/v' }))).toEqual([[], ['Reveal in Finder']])
    const sections = build({ openVsCodePath: '/v/Zeta', openDefaultPath: '/v/book.epub', revealPath: '/v/sub' }, { onOpenVsCode, onOpenDefault, onReveal })
    const labels = openInOf(sections)?.flat().map((i) => i.label) ?? []
    expect(labels.indexOf('Default app')).toBe(labels.indexOf('VS Code') + 1)
    subItemOf(sections, 'VS Code')?.onSelect()
    subItemOf(sections, 'Default app')?.onSelect()
    subItemOf(sections, 'Reveal in Finder')?.onSelect()
    expect(onOpenVsCode).toHaveBeenCalledExactlyOnceWith('/v/Zeta')
    expect(onOpenDefault).toHaveBeenCalledExactlyOnceWith('/v/book.epub')
    expect(onReveal).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })
})

/**
 * "Focus on …" (YAZ-1605): a VIEW verb, so it CLOSES the Open group — after the plural open,
 * ahead of the clipboard group. An EMPTY list hides it too (the caller's "nothing here
 * can be focused" answer), and the caller spells the label: it knows the lens and the count.
 */
describe('Focus item (YAZ-1605)', () => {
  it.each<[string, Partial<MenuSectionTargets>]>([
    ['null', { focusPaths: null }],
    ['empty', { focusPaths: [] }],
  ])('is absent when focusPaths is %s', (_case, over) => {
    expect(labelsOf(build(over)).some((l) => l.startsWith('Focus'))).toBe(false)
  })

  it('renders the caller\'s own label and hands the select the exact array', () => {
    const onFocus = vi.fn()
    const sections = build({ focusPaths: ['/v/a', '/v/b'] }, { focusLabel: 'Focus on 2 folders', onFocus })
    expect(labelsOf(sections)).toContain('Focus on 2 folders')
    select(sections, 'Focus on 2 folders')
    expect(onFocus).toHaveBeenCalledExactlyOnceWith(['/v/a', '/v/b'])
  })

  it('closes the Open group — after the plural open, before the clipboard group', () => {
    const sections = build({ ...FILE_ROW, focusPaths: ['/v/a'], openTabPaths: ['/v/a.md', '/v/b.md'] })
    expect(sections[0].map((i) => i.label)).toEqual(['Open 2 in new tabs', 'Focus on folder'])
    expect(sections[1][0]?.label).toBe('Cut')
  })
})

/**
 * The file clipboard (🔒 D5, YAZ-1674): Cut / Copy on any ROW — file or dir, both lenses — never on
 * blank space; the label counts a 2+ selection. Paste is offered exactly where "New folder" is
 * (`onPaste` null withholds it) and is DISABLED, not hidden, while the clipboard is empty.
 */
describe('Cut / Copy / Paste (YAZ-1674)', () => {
  it('Cut and Copy are absent on blank space (nothing to clip) and present, bare, on a single row', () => {
    expect(labelsOf(build(BLANK))).not.toContain('Cut')
    expect(labelsOf(build(BLANK))).not.toContain('Copy')
    const sections = build({ clipPaths: ['/v/sub'] })
    expect(sections[1].map((i) => i.label)).toEqual(['Cut', 'Copy', 'Paste'])
  })

  it('a 2+ selection counts: "Cut 3 items" / "Copy 3 items", handing the ORDERED list as given', () => {
    const onCut = vi.fn()
    const onCopy = vi.fn()
    const sections = build({ clipPaths: ['/v/sub', '/v/a.md', '/v/b.md'] }, { onCut, onCopy })
    select(sections, 'Cut 3 items')
    select(sections, 'Copy 3 items')
    expect(onCut).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/b.md'])
    expect(onCopy).toHaveBeenCalledExactlyOnceWith(['/v/sub', '/v/a.md', '/v/b.md'])
  })

  it('carries the shortcut hints: ⌘X, ⌘C, ⌘V — and ⌘⇧C on Copy path', () => {
    const sections = build({ clipPaths: ['/v/a.md'], copyPath: '/v/a.md' })
    expect(sections[1].map((i) => [i.label, i.hint])).toEqual([['Cut', '⌘X'], ['Copy', '⌘C'], ['Paste', '⌘V'], ['Copy path', '⌘⇧C']])
  })

  it('Paste is DISABLED with an empty clipboard — rendered for discoverability, inert on select', () => {
    const onPaste = vi.fn()
    const paste = leafOf(build({ clip: null }, { onPaste }), 'Paste')
    expect(paste?.disabled).toBe(true)
    paste?.onSelect()
    expect(onPaste).not.toHaveBeenCalled()
  })

  it.each<[number, string]>([
    [1, 'Paste 1 item'],
    [2, 'Paste 2 items'],
    [7, 'Paste 7 items'],
  ])('with %i clipped it reads "%s", enabled, and selects the paste', (count, label) => {
    const onPaste = vi.fn()
    const sections = build({ clip: { count, op: 'copy' } }, { onPaste })
    expect(itemOf(sections, 'Paste')).toBeUndefined()
    const paste = leafOf(sections, label)
    expect(paste?.disabled).toBeUndefined()
    paste?.onSelect()
    expect(onPaste).toHaveBeenCalledTimes(1)
  })

  it('a null onPaste WITHHOLDS Paste entirely — the Topics PAGE row rule, the same gate as "New folder"', () => {
    const labels = labelsOf(build({ clipPaths: ['/v/Home.md'], clip: { count: 2, op: 'cut' } }, { onPaste: null, onNewFolder: null, onNewDatedFolder: null }))
    expect(labels.some((l) => l.startsWith('Paste'))).toBe(false)
    expect(labels).toContain('Cut')
    expect(labels).toContain('Copy')
  })
})

/**
 * The text clipboard: "Copy path" (GRO-2273, the root on blank space), "Copy N paths" (🔒 D5,
 * YAZ-1337 — the whole ordered selection, newline-joined), each confirming through the one notice
 * (YAZ-1341) and REPORTING a refused clipboard; "Copy for Agent" (YAZ-1617 🔒 D2) directly under.
 */
describe('Copy path / Copy N paths / Copy for Agent', () => {
  it('Copy path writes the exact path and confirms; absent without one', async () => {
    const writeText = installClipboard()
    const onNotice = vi.fn()
    expect(itemOf(build({ copyPath: null }), 'Copy path')).toBeUndefined()
    select(build({ copyPath: '/v' }, { onNotice }), 'Copy path')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v')
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied path')
  })

  it('Copy path reports a clipboard the OS refused', async () => {
    installClipboard(new Error('denied'))
    const onNotice = vi.fn()
    select(build({ copyPath: '/v/a.md' }, { onNotice }), 'Copy path')
    await Promise.resolve()
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy path: denied")
  })

  it('Copy N paths joins the ordered selection with newlines and confirms with the count; absent outside a 2+ selection', async () => {
    const writeText = installClipboard()
    const onNotice = vi.fn()
    expect(labelsOf(build()).some((l) => /^Copy \d+ paths$/.test(l))).toBe(false)
    select(build({ copyPaths: ['/v/sub', '/v/a.md'] }, { onNotice }), 'Copy 2 paths')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('/v/sub\n/v/a.md')
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('Copied 2 paths')
  })

  it('Copy N paths reports a refused clipboard too', async () => {
    installClipboard(new Error('denied'))
    const onNotice = vi.fn()
    select(build({ copyPaths: ['/v/a.md', '/v/b.md'] }, { onNotice }), 'Copy 2 paths')
    await Promise.resolve()
    await Promise.resolve()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith("Can't copy paths: denied")
  })

  it('Copy for Agent is absent when agentPath is null; present it sits directly after Copy path and hands the exact path', () => {
    const onCopyForAgent = vi.fn()
    expect(itemOf(build({ copyPath: '/v/folder' }), 'Copy for Agent')).toBeUndefined()
    const sections = build({ copyPath: '/v/Note.md', agentPath: '/v/Note.md' }, { onCopyForAgent })
    const labels = labelsOf(sections)
    expect(labels.indexOf('Copy for Agent')).toBe(labels.indexOf('Copy path') + 1)
    select(sections, 'Copy for Agent')
    expect(onCopyForAgent).toHaveBeenCalledExactlyOnceWith('/v/Note.md')
  })
})

/** Rename and Delete: a concrete row only, NEVER blank space (GRO-2241, GRO-2272); each hands its own path. */
describe('Rename / Delete', () => {
  it('both absent on blank space', () => {
    const labels = labelsOf(build(BLANK))
    expect(labels).not.toContain('Rename')
    expect(labels).not.toContain('Delete')
  })

  it('each hands the caller its own target', () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const sections = build({ renamePath: '/v/sub', deletePath: '/v/sub' }, { onRename, onDelete })
    select(sections, 'Rename')
    select(sections, 'Delete')
    expect(onRename).toHaveBeenCalledExactlyOnceWith('/v/sub')
    expect(onDelete).toHaveBeenCalledExactlyOnceWith('/v/sub')
  })
})

/**
 * The favorite toggle (YAZ-1766 D3): ONE state-aware item on every ROW — file or dir, whichever
 * lens — never on blank space; it counts a 2+ selection and reads Add unless EVERY path is already
 * pinned. It leads the "Open in ▸" group (Yasin, demo 2026-09-21), one hairline above Delete.
 */
describe('favorite toggle item (YAZ-1766 D3)', () => {
  it('reads "Add to favorites" on a row that is not pinned, "Remove from favorites" on one that is', () => {
    expect(labelsOf(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: false }))).toContain('Add to favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: false }))).not.toContain('Remove from favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/dir'], favoriteIsOn: true }))).toContain('Remove from favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/dir'], favoriteIsOn: true }))).not.toContain('Add to favorites')
  })

  it('is absent on blank space (a null target)', () => {
    expect(labelsOf(build(BLANK)).some((l) => l.includes('favorites'))).toBe(false)
  })

  it('counts a 2+ selection: "Add 2 to favorites" / "Remove 3 from favorites"', () => {
    expect(labelsOf(build({ favoritePaths: ['/v/a.md', '/v/b'], favoriteIsOn: false }))).toContain('Add 2 to favorites')
    expect(labelsOf(build({ favoritePaths: ['/v/a.md', '/v/b', '/v/c.md'], favoriteIsOn: true }))).toContain('Remove 3 from favorites')
  })

  it('a MIXED selection reads Add (isOn is false unless every path is pinned) and hands every path with the direction', () => {
    const onToggleFavorite = vi.fn()
    select(build({ favoritePaths: ['/v/a.md', '/v/b'], favoriteIsOn: false }, { onToggleFavorite }), 'Add 2 to favorites')
    expect(onToggleFavorite).toHaveBeenCalledExactlyOnceWith(['/v/a.md', '/v/b'], false)
    const onRemove = vi.fn()
    select(build({ favoritePaths: ['/v/a.md'], favoriteIsOn: true }, { onToggleFavorite: onRemove }), 'Remove from favorites')
    expect(onRemove).toHaveBeenCalledExactlyOnceWith(['/v/a.md'], true)
  })

  it('leads the "Open in ▸" group — the this-row group ends on Rename, and the toggle sits directly above the flyout', () => {
    const sections = build({ ...FILE_ROW, favoritePaths: ['/v/Note.md'], favoriteIsOn: false })
    expect(sections[3].map((i) => i.label)).toEqual(['Turn into folder page', 'Rename'])
    expect(sections[4].map((i) => i.label)).toEqual(['Add to favorites', 'Open in'])
  })
})
