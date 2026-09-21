/**
 * Create-on-click for unresolved wiki links (Links C, GRO-2192): `planLinkCreation`'s pure
 * path rules (base folder for BARE targets from the "default location for new notes"
 * setting — C2-, GRO-2240 — pathed targets always root-relative, `.md` appended like the
 * sidebar's `entryPath`, per-segment name validation), `newNoteBase`'s setting → base
 * mapping, and `createFromLink`'s bridge flow (parent dirs level by level, benign
 * ALREADY_EXISTS races, failures as messages for the passive notice — never a dialog).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/types'
import { api, BridgeRequestError } from '../../api'
import { createFromLink, newNoteBase, planLinkCreation } from './createFromLink'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: {
    createDir: vi.fn(async (path: string) => ({ path })),
    createFile: vi.fn(async (path: string) => ({ path, mtime: 1, size: 0 })),
  },
}))

const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)

beforeEach(() => {
  vi.clearAllMocks()
  createDir.mockImplementation(async (path: string) => ({ path }))
  createFile.mockImplementation(async (req) => ({ path: req as string, mtime: 1, size: 0 }))
})

describe('planLinkCreation (pure path rules)', () => {
  it('a bare target creates at the VAULT ROOT with .md appended (the locked default)', () => {
    expect(planLinkCreation('/vault', 'New page')).toEqual({ folder: '', path: '/vault/New page.md' })
  })

  it('an already-markdown name keeps its extension (mirror of entryPath)', () => {
    expect(planLinkCreation('/vault', 'note.md')).toEqual({ folder: '', path: '/vault/note.md' })
    expect(planLinkCreation('/vault', 'note.MARKDOWN')).toEqual({ folder: '', path: '/vault/note.MARKDOWN' })
    // Any other dot-suffix is part of the name, exactly like the sidebar's create flow.
    expect(planLinkCreation('/vault', 'v1.2')).toEqual({ folder: '', path: '/vault/v1.2.md' })
  })

  it('a pathed target is root-relative: folder split off, segments trimmed', () => {
    expect(planLinkCreation('/vault', 'Sub/Page')).toEqual({ folder: 'Sub', path: '/vault/Sub/Page.md' })
    expect(planLinkCreation('/vault', 'a/b/c')).toEqual({ folder: 'a/b', path: '/vault/a/b/c.md' })
    expect(planLinkCreation('/vault', ' Sub / Page ')).toEqual({ folder: 'Sub', path: '/vault/Sub/Page.md' })
  })

  it('a leading slash is tolerated (the resolver accepts it too): still root-relative', () => {
    expect(planLinkCreation('/vault', '/Sub/Page')).toEqual({ folder: 'Sub', path: '/vault/Sub/Page.md' })
  })

  it('empty segments (trailing slash, //) are unusable', () => {
    expect(planLinkCreation('/vault', 'Sub/')).toEqual({ error: 'Can\'t create "Sub/": empty name' })
    expect(planLinkCreation('/vault', 'a//b')).toEqual({ error: 'Can\'t create "a//b": empty name' })
  })

  it('every segment passes the sidebar name rules: dot-names and NUL are rejected with the human reason', () => {
    expect(planLinkCreation('/vault', '.hidden')).toEqual({ error: 'Can\'t create ".hidden": Names starting with "." are hidden' })
    expect(planLinkCreation('/vault', 'a/.git/b')).toEqual({ error: 'Can\'t create "a/.git/b": Names starting with "." are hidden' })
    expect(planLinkCreation('/vault', 'bad\0name')).toEqual({ error: 'Can\'t create "bad\0name": Name contains an invalid character' })
  })

  it('a BARE target lands under the base folder from the location setting (C2-, GRO-2240)', () => {
    expect(planLinkCreation('/vault', 'Page', 'Notes')).toEqual({ folder: 'Notes', path: '/vault/Notes/Page.md' })
    expect(planLinkCreation('/vault', 'Page', 'Notes/Inbox')).toEqual({ folder: 'Notes/Inbox', path: '/vault/Notes/Inbox/Page.md' })
    expect(planLinkCreation('/vault', 'Page', '')).toEqual({ folder: '', path: '/vault/Page.md' })
  })

  it('a PATHED target ignores the base: an explicit path is an explicit aim, root-relative (Obsidian)', () => {
    expect(planLinkCreation('/vault', 'Sub/Page', 'Notes')).toEqual({ folder: 'Sub', path: '/vault/Sub/Page.md' })
    // A leading slash is the explicit vault-root form — pathed, so the base never applies.
    expect(planLinkCreation('/vault', '/Page', 'Notes')).toEqual({ folder: '', path: '/vault/Page.md' })
  })

  it('base segments pass the same name rules; the error names the full effective path', () => {
    expect(planLinkCreation('/vault', 'Page', '.drafts')).toEqual({ error: 'Can\'t create ".drafts/Page": Names starting with "." are hidden' })
  })
})

describe('newNoteBase (setting → base folder for bare targets, C2- GRO-2240)', () => {
  const at = (newNoteLocation: 'root' | 'current' | 'folder', newNoteFolder = '') => ({ ...DEFAULT_SETTINGS, newNoteLocation, newNoteFolder })

  it("'root' is the vault root, whatever the source page", () => {
    expect(newNoteBase(at('root'), '/vault', '/vault/Sub/Note.md')).toBe('')
  })

  it("'current' (the default, YAZ-1643) is the SOURCE page's folder, root-relative; a top-level page means the root", () => {
    expect(newNoteBase(at('current'), '/vault', '/vault/Sub/Deep/Note.md')).toBe('Sub/Deep')
    expect(newNoteBase(at('current'), '/vault', '/vault/Note.md')).toBe('')
  })

  it("'current' falls back to the root for a source page outside the vault", () => {
    expect(newNoteBase(at('current'), '/vault', '/elsewhere/Note.md')).toBe('')
  })

  it("'folder' is the configured root-relative folder ('' = the root); the source page is irrelevant", () => {
    expect(newNoteBase(at('folder', 'Notes/Inbox'), '/vault', '/vault/Sub/Note.md')).toBe('Notes/Inbox')
    expect(newNoteBase(at('folder'), '/vault', '/vault/Sub/Note.md')).toBe('')
  })
})

describe('createFromLink (bridge flow)', () => {
  it('strips |alias and #heading/#^block from the raw inner text before creating', async () => {
    await expect(createFromLink('/vault', 'Page#Heading|shown')).resolves.toEqual({ status: 'created', path: '/vault/Page.md' })
    expect(createFile).toHaveBeenCalledWith('/vault/Page.md')
    expect(createDir).not.toHaveBeenCalled()
  })

  it('an empty page name ([[#h]] — the same-file form) is a no-op: nothing created', async () => {
    await expect(createFromLink('/vault', '#heading')).resolves.toEqual({ status: 'noop' })
    await expect(createFromLink('/vault', '#h|alias')).resolves.toEqual({ status: 'noop' })
    expect(createFile).not.toHaveBeenCalled()
  })

  it('a pathed target creates missing parents level by level, then the file', async () => {
    await expect(createFromLink('/vault', 'a/b/Page')).resolves.toEqual({ status: 'created', path: '/vault/a/b/Page.md' })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/vault/a', '/vault/a/b'])
    expect(createFile).toHaveBeenCalledWith('/vault/a/b/Page.md')
  })

  it('existing parent folders are tolerated (ALREADY_EXISTS from createDir)', async () => {
    createDir.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
    await expect(createFromLink('/vault', 'Sub/Page')).resolves.toEqual({ status: 'created', path: '/vault/Sub/Page.md' })
  })

  it('ALREADY_EXISTS on the file is a benign race: resolves `exists`, caller just opens it', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('ALREADY_EXISTS', 'exists'))
    await expect(createFromLink('/vault', 'Page')).resolves.toEqual({ status: 'exists', path: '/vault/Page.md' })
  })

  it('an invalid name is an error message for the passive notice — no bridge call at all', async () => {
    await expect(createFromLink('/vault', '.hidden')).resolves.toEqual({
      status: 'error',
      message: 'Can\'t create ".hidden": Names starting with "." are hidden',
    })
    expect(createFile).not.toHaveBeenCalled()
    expect(createDir).not.toHaveBeenCalled()
  })

  it('any other bridge failure becomes an error message (never a dialog, never a throw)', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    await expect(createFromLink('/vault', 'Page')).resolves.toEqual({
      status: 'error',
      message: 'Can\'t create "Page": disk on fire',
    })
  })

  it('a bare target with a base creates the base folders level by level, then the file (C2-, GRO-2240)', async () => {
    await expect(createFromLink('/vault', 'Page', 'Notes/Inbox')).resolves.toEqual({ status: 'created', path: '/vault/Notes/Inbox/Page.md' })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/vault/Notes', '/vault/Notes/Inbox'])
    expect(createFile).toHaveBeenCalledWith('/vault/Notes/Inbox/Page.md')
  })

  it('a pathed target keeps root-relative creation even with a base (explicit aim wins)', async () => {
    await expect(createFromLink('/vault', 'Sub/Page', 'Notes')).resolves.toEqual({ status: 'created', path: '/vault/Sub/Page.md' })
    expect(createDir.mock.calls.map((c) => c[0])).toEqual(['/vault/Sub'])
  })
})
