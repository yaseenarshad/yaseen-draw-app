import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { parseFrontmatter, splitFrontmatter } from '@shared/frontmatter'
import type { TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from './viewOnlyCatalog'
import {
  countLinkReferences,
  maskCode,
  renamedTarget,
  renameNotice,
  rewriteBodyLinks,
  rewriteInner,
  rewriteNoteLinks,
  updateLinksAfterRename,
} from './renameLinks'

const resolvesB = (t: string) => t.replace(/\.(md|markdown)$/i, '').replace(/^.*\//, '').toLowerCase() === 'b'
const toC = (t: string) => renamedTarget(t, { newName: 'C.md', newRel: 'Sub/C.md' })

describe('maskCode (the index stripCode discipline, length-preserving)', () => {
  it('blanks fenced blocks (fence lines included) and inline code spans, keeping every offset', () => {
    const body = 'a [[B]]\n```\n[[B]] in code\n```\nand `[[B]]` span\n'
    const masked = maskCode(body)
    expect(masked.length).toBe(body.length)
    expect(masked.indexOf('[[B]]')).toBe(body.indexOf('[[B]]')) // the real link survives at its offset
    expect(masked.match(/\[\[B\]\]/g)).toHaveLength(1) // the fenced and span copies are blanked
  })
})

describe('rewriteInner / renamedTarget (form + suffix + alias preservation)', () => {
  it('preserves |alias and #suffix and drops padding inside the target', () => {
    expect(rewriteInner('B', resolvesB, toC)).toBe('C')
    expect(rewriteInner('B|Bee', resolvesB, toC)).toBe('C|Bee')
    expect(rewriteInner('B#Heading', resolvesB, toC)).toBe('C#Heading')
    expect(rewriteInner('B#^block|Bee', resolvesB, toC)).toBe('C#^block|Bee')
    expect(rewriteInner(' B ', resolvesB, toC)).toBe('C')
    expect(rewriteInner('Other', resolvesB, toC)).toBeNull()
    expect(rewriteInner('#same-file', resolvesB, toC)).toBeNull()
  })

  it('a match whose target text would not change is left untouched — byte-identical, padding included (E1b pin)', () => {
    expect(rewriteInner('B', () => true, (t) => t)).toBeNull()
    expect(rewriteInner(' B |Bee', () => true, (t) => t)).toBeNull() // padding survives because the match is never spliced
  })

  it('bare stays bare, pathed stays root-relative, an explicit extension stays explicit', () => {
    expect(toC('B')).toBe('C')
    expect(toC('B.md')).toBe('C.md')
    expect(toC('Sub/B')).toBe('Sub/C')
    expect(toC('Sub/B.md')).toBe('Sub/C.md')
    expect(toC('/Sub/B')).toBe('Sub/C')
  })
})

describe('rewriteBodyLinks', () => {
  it('rewrites bare, aliased, heading and embed forms; leaves code and other targets alone', () => {
    const body = 'See [[B]] and [[B|Bee]] and [[B#H|x]] and ![[B]] but not [[A]] nor `[[B]]`.\n```\n[[B]]\n```\n'
    expect(rewriteBodyLinks(body, resolvesB, toC)).toBe('See [[C]] and [[C|Bee]] and [[C#H|x]] and ![[C]] but not [[A]] nor `[[B]]`.\n```\n[[B]]\n```\n')
  })

  it('returns the body unchanged when nothing matches', () => {
    expect(rewriteBodyLinks('no links here', resolvesB, toC)).toBe('no links here')
  })
})

describe('rewriteNoteLinks', () => {
  it('rewrites whole-value frontmatter links (top-level and inside lists) plus the body; everything else survives', () => {
    const content = '---\npillar: "[[B]]"\nrelated:\n  - "[[B|Bee]]"\n  - "[[A]]"\nnote: see [[B]] inline\n---\n\nBody [[B]].\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBe(
      '---\npillar: "[[C]]"\nrelated:\n  - "[[C|Bee]]"\n  - "[[A]]"\nnote: see [[B]] inline\n---\n\nBody [[C]].\n',
    )
  })

  it('null when nothing references the renamed file (the caller never writes)', () => {
    expect(rewriteNoteLinks('---\nk: 1\n---\n\n[[A]]\n', resolvesB, toC)).toBeNull()
  })
})

// ---------- YAZ-864: the ONE reserved key is walked INTO ----------

describe('rewriteNoteLinks inside folder_page_settings (YAZ-864)', () => {
  it('rewrites an outline `order` entry, keeping every other key and the body byte-for-byte', () => {
    const content =
      '---\nfolder_page: true\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      order:\n        - "[[A]]"\n        - "[[B]]"\n    - type: table\n      name: Table\n---\n\n# Home\n'
    const out = rewriteNoteLinks(content, resolvesB, toC)
    expect(out).toContain('- "[[C]]"')
    expect(out).toContain('- "[[A]]"') // the sibling entry is untouched
    expect(out).toContain('folder_page: true')
    expect(out).toContain('name: Table') // the second view rides along
    expect(out).toContain('\n# Home\n')
  })

  it('rewrites a column `target`, leaving the column\u2019s other keys and the sibling columns alone', () => {
    const content =
      '---\nfolder_page_settings:\n  columns:\n    sold_to:\n      kind: multi-link\n      target: "[[B]]"\n      required: true\n    owner:\n      kind: link\n      target: "[[A]]"\n    note:\n      kind: text\n  folder: roles\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC)
    expect(out).toContain('target: "[[C]]"')
    expect(out).toContain('kind: multi-link')
    expect(out).toContain('required: true')
    expect(out).toContain('target: "[[A]]"')
    expect(out).toContain('kind: text')
    expect(out).toContain('folder: roles')
  })

  it('the spelling rules are the top level\u2019s, not a second set: alias, heading and pathed forms all follow', () => {
    const content =
      '---\nfolder_page_settings:\n  columns:\n    a:\n      kind: link\n      target: "[[Sub/B|Bee]]"\n  views:\n    - type: outline\n      order:\n        - "[[ B #H]]"\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('target: "[[Sub/C|Bee]]"') // pathed stays pathed
    expect(out).toContain('"[[C#H]]"') // heading rides along, padding normalised as everywhere else
  })

  it('a STALE entry that never resolved to the renamed page stays exactly as written', () => {
    const content =
      '---\nfolder_page_settings:\n  views:\n    - type: outline\n      order:\n        - "[[Gone]]"\n        - not a link at all\n        - 7\n      order_note: "[[B]] in an unknown key"\n---\n\nbody [[B]]\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('- "[[Gone]]"')
    expect(out).toContain('- not a link at all')
    expect(out).toContain('- 7')
    expect(out).toContain('order_note: "[[B]] in an unknown key"') // not a leaf, and not whole-value
    expect(out).toContain('body [[C]]\n') // the body still rewrote, so the file WAS written
  })

  it('a page with settings but no reference to the renamed file is null — never written, byte-for-byte safe', () => {
    const content =
      '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    owner:\n      kind: link\n      target: "[[A]]"\n  views:\n    - type: outline\n      order: ["[[A]]"]\n---\n\n# Not about B\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBeNull()
  })

  it('rewrites a wikilink LINE inside a view’s outline; prose lines, markers and indentation survive (YAZ-900)', () => {
    const content =
      '---\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[A]]\n            * [[B]]\n        - see [[B]] inline\n        - [[B]] and [[B]]\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    const views = (parseFrontmatter(splitFrontmatter(out).frontmatter).properties.folder_page_settings as { views: { outline: string }[] }).views
    expect(views[0].outline).toBe('- [[A]]\n    * [[C]]\n- see [[B]] inline\n- [[B]] and [[B]]')
  })

  it('an outline that only MENTIONS the renamed page mid-line is null — never written', () => {
    const content =
      '---\nfolder_page_settings:\n  views:\n    - type: outline\n      outline: "- see [[B]] inline"\n      outline_note: "[[B]] in an unknown key"\n---\n\nbody\n'
    expect(rewriteNoteLinks(content, resolvesB, toC)).toBeNull()
  })

  it('a non-string outline rides along untouched — the raw value is never normalised', () => {
    const content = '---\nfolder_page_settings:\n  views:\n    - type: outline\n      outline: 7\n      order: ["[[B]]"]\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('outline: 7')
    expect(out).toContain('"[[C]]"')
  })

  it('an unusable settings shape is not normalised away — the raw value rides along, only the leaf moves', () => {
    const content =
      '---\nfolder_page_settings:\n  columns:\n    broken:\n      kind: not-a-kind\n      target: "[[B]]"\n    alsoBroken: 7\n  views: {}\n  stray: keep me\n---\n\nbody\n'
    const out = rewriteNoteLinks(content, resolvesB, toC) ?? ''
    expect(out).toContain('kind: not-a-kind') // the tolerant READ would drop this column entirely
    expect(out).toContain('target: "[[C]]"')
    expect(out).toContain('alsoBroken: 7')
    expect(out).toContain('views: {}')
    expect(out).toContain('stray: keep me')
  })
})

describe('renameNotice', () => {
  it('one summary line, pluralised, with the skipped tail only when needed', () => {
    expect(renameNotice({ updated: 1, skipped: 0 })).toBe('Updated links in 1 note')
    expect(renameNotice({ updated: 3, skipped: 2 })).toBe('Updated links in 3 notes; 2 skipped (unsaved changes)')
  })
})

// ---------- the effectful runner over a fake bridge ----------

function rec(path: string, over: Partial<IndexRecord> = {}): IndexRecord {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const basename = name.replace(/\.(md|markdown)$/i, '')
  const folder = path.slice('/v/'.length, path.lastIndexOf('/')).replace(/\/$/, '')
  return { path, name, basename, folder: folder === name ? '' : folder, ext: 'md', size: 0, ctime: 0, mtime: 0, properties: {}, aliases: [], tags: [], links: [], embeds: [], ...over }
}

function installBridge(files: Record<string, { content: string; mtime: number }>) {
  const readFile = vi.fn(async (path: string) => {
    const f = files[path]
    if (f === undefined) return Promise.reject({ code: 'NOT_FOUND', message: 'path does not exist', path })
    return { path, content: f.content, mtime: f.mtime, size: f.content.length }
  })
  const writeFile = vi.fn(async ({ path, content, expectedMtime }: { path: string; content: string; expectedMtime?: number }) => {
    const f = files[path]
    if (f !== undefined && expectedMtime !== undefined && f.mtime !== expectedMtime) {
      return Promise.reject({ code: 'CONFLICT', message: 'file changed on disk since last read', path, mtime: f.mtime })
    }
    files[path] = { content, mtime: (f?.mtime ?? 0) + 1 }
    return { path, mtime: files[path].mtime, size: content.length }
  })
  Object.defineProperty(window, 'yaseenDocs', { value: { readFile, writeFile }, configurable: true, writable: true })
  return { readFile, writeFile }
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

describe('updateLinksAfterRename', () => {
  const root = '/v'
  const oldPath = '/v/B.md'
  const newPath = '/v/C.md'

  it('rewrites exactly the referencing notes (links AND embeds, via the shared resolver) and counts them', async () => {
    const files = {
      '/v/A.md': { content: 'See [[B]] and [[B|Bee]].\n', mtime: 10 },
      '/v/E.md': { content: '![[B]]\n', mtime: 20 },
      '/v/N.md': { content: 'nothing\n', mtime: 30 },
    }
    const bridge = installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/B.md'),
      rec('/v/E.md', { embeds: ['B'] }),
      rec('/v/N.md'),
    ]
    const summary = await updateLinksAfterRename({ root, oldPath, newPath, records })
    expect(summary).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[C]] and [[C|Bee]].\n')
    expect(files['/v/E.md'].content).toBe('![[C]]\n')
    expect(files['/v/N.md'].content).toBe('nothing\n')
    expect(bridge.writeFile).toHaveBeenCalledTimes(2)
  })

  it('a CONFLICT re-reads once and retries; a second conflict skips the file', async () => {
    const files = { '/v/A.md': { content: '[[B]]\n', mtime: 10 } }
    const bridge = installBridge(files)
    // First write attempt conflicts (mtime moved between read and write); the retry lands.
    bridge.writeFile.mockRejectedValueOnce({ code: 'CONFLICT', message: 'file changed on disk since last read', path: '/v/A.md', mtime: 11 })
    const records = [rec('/v/A.md', { links: ['B'] }), rec('/v/B.md')]
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[C]]\n')
    // Now every write conflicts: the file is skipped, its content untouched.
    const files2 = { '/v/A.md': { content: '[[B]]\n', mtime: 10 } }
    const bridge2 = installBridge(files2)
    bridge2.writeFile.mockRejectedValue({ code: 'CONFLICT', message: 'file changed on disk since last read', path: '/v/A.md', mtime: 11 })
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 0, skipped: 1 })
    expect(files2['/v/A.md'].content).toBe('[[B]]\n')
  })

  it('a SELF-link follows the file: the renamed note is read and rewritten at its NEW path', async () => {
    const files = { '/v/C.md': { content: 'I link [[B|myself]].\n', mtime: 5 } }
    installBridge(files)
    const records = [rec('/v/B.md', { links: ['B'] })]
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/C.md'].content).toBe('I link [[C|myself]].\n')
  })

  it('a bare link whose name belongs to a DIFFERENT (shallower) file is left alone — resolution decides, not text', async () => {
    const files = { '/v/A.md': { content: '[[B]] and [[Sub/B]]\n', mtime: 1 } }
    installBridge(files)
    // Two files named B: the bare name resolves to the SHALLOWER /v/B.md; we rename the deeper one.
    const records = [
      rec('/v/A.md', { links: ['B', 'Sub/B'] }),
      rec('/v/B.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    const summary = await updateLinksAfterRename({ root, oldPath: '/v/Sub/B.md', newPath: '/v/Sub/C.md', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[B]] and [[Sub/C]]\n')
  })

  it('an ALIAS-form link to the renamed file stays BYTE-IDENTICAL; its name forms still rewrite (E2, GRO-2214)', async () => {
    const files = { '/v/A.md': { content: 'See [[CAC]] and [[ CAC |shown]] and [[B]].\n', mtime: 1 } }
    installBridge(files)
    // B.md answers to `CAC` through frontmatter aliases: `[[CAC]]` keeps pointing at it after
    // the rename (the alias moves with the file), so only the NAME form is rewritten.
    const records = [rec('/v/A.md', { links: ['CAC', 'B'] }), rec('/v/B.md', { aliases: ['CAC'] })]
    expect(countLinkReferences({ root, oldPath, records })).toBe(1)
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[CAC]] and [[ CAC |shown]] and [[C]].\n')
  })

  it('a note referencing the renamed file ONLY by alias is not in the referencing set at all (no read, no write)', async () => {
    const files = { '/v/A.md': { content: 'Only [[CAC]].\n', mtime: 1 } }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md', { links: ['CAC'] }), rec('/v/B.md', { aliases: ['CAC'] })]
    expect(countLinkReferences({ root, oldPath, records })).toBe(0) // the banner's N and the rewrite agree
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 0, skipped: 0 })
    expect(bridge.readFile).not.toHaveBeenCalled()
    expect(files['/v/A.md'].content).toBe('Only [[CAC]].\n')
  })

  it('a same-directory rename whose NEW name is shadowed by another file escalates the bare link to the pathed form', async () => {
    const files = { '/v/A.md': { content: '[[B]]\n', mtime: 1 } }
    installBridge(files)
    // Rename Sub/B → Sub/C while a root-level C exists: a bare [[C]] would resolve to /v/C.md,
    // so the rewrite goes pathed — resolution decides the FORM too, not just the target.
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/C.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    expect(await updateLinksAfterRename({ root, oldPath: '/v/Sub/B.md', newPath: '/v/Sub/C.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Sub/C]]\n')
  })
})

describe('updateLinksAfterRename reaches notes referenced ONLY inside folder_page_settings (YAZ-864)', () => {
  const root = '/v'
  const oldPath = '/v/B.md'
  const newPath = '/v/C.md'
  /** Home names B in its outline `order`; Cols names it as a column target. Neither has a `links` entry. */
  const HOME = '---\nfolder_page: true\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      order:\n        - "[[A]]"\n        - "[[B]]"\n---\n\n# Home\n'
  const COLS = '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    sold_to:\n      kind: multi-link\n      target: "[[B]]"\n---\n\n# Cols\n'
  const settingsOf = (raw: string) => parseFrontmatter(splitFrontmatter(raw).frontmatter).properties.folder_page_settings

  it('counts them in the banner N and rewrites both leaves on disk; a settings page naming nobody is never read', async () => {
    const OTHER = '---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    owner:\n      kind: link\n      target: "[[A]]"\n---\n\n# Other\n'
    const files = {
      '/v/Home.md': { content: HOME, mtime: 1 },
      '/v/Cols.md': { content: COLS, mtime: 1 },
      '/v/Other.md': { content: OTHER, mtime: 1 },
    }
    const bridge = installBridge(files)
    const records = [
      rec('/v/Home.md', { properties: { folder_page: true, folder_page_settings: settingsOf(HOME) } }),
      rec('/v/Cols.md', { properties: { folder_page: true, folder_page_settings: settingsOf(COLS) } }),
      rec('/v/Other.md', { properties: { folder_page: true, folder_page_settings: settingsOf(OTHER) } }),
      rec('/v/A.md'),
      rec('/v/B.md'),
    ]
    // The banner's N and the rewrite agree — the probe walks the same leaves the rewrite does.
    expect(countLinkReferences({ root, oldPath, records })).toBe(2)
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 2, skipped: 0 })
    expect(files['/v/Home.md'].content).toContain('- "[[C]]"')
    expect(files['/v/Home.md'].content).toContain('- "[[A]]"')
    expect(files['/v/Cols.md'].content).toContain('target: "[[C]]"')
    expect(files['/v/Other.md'].content).toBe(OTHER) // byte-for-byte: settings, but no reference
    expect(bridge.readFile).not.toHaveBeenCalledWith('/v/Other.md')
  })

  it('a page referenced ONLY by an outline LINE is counted and rewritten too (YAZ-900)', async () => {
    const OUT = '---\nfolder_page: true\nfolder_page_settings:\n  views:\n    - type: outline\n      name: Outline\n      outline: |-\n        - [[B]]\n        - prose about [[A]]\n---\n\n# Out\n'
    const files = { '/v/Out.md': { content: OUT, mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/Out.md', { properties: { folder_page: true, folder_page_settings: settingsOf(OUT) } }),
      rec('/v/B.md'),
    ]
    expect(countLinkReferences({ root, oldPath, records })).toBe(1)
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/Out.md'].content).toContain('- [[C]]')
    expect(files['/v/Out.md'].content).toContain('- prose about [[A]]')
  })

  it('a FOLDER rename leaves a bare settings leaf byte-identical, exactly like a bare body link (LOCKED)', async () => {
    const files = { '/v/Home.md': { content: HOME, mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/Home.md', { properties: { folder_page: true, folder_page_settings: settingsOf(HOME) } }),
      rec('/v/Old/B.md', { folder: 'Old' }),
    ]
    expect(await updateLinksAfterRename({ root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })).toEqual({ updated: 0, skipped: 0 })
    expect(files['/v/Home.md'].content).toBe(HOME)
  })
})

// ---------- E1b (GRO-2241): folder rename + cross-directory move ----------

describe('updateLinksAfterRename with kind: dir (folder rename, E1b)', () => {
  const root = '/v'

  it('rewrites PATHED links/embeds into the folder; bare links stay BYTE-IDENTICAL (LOCKED — padding and all)', async () => {
    const files = { '/v/A.md': { content: 'See [[Old/B]] and [[ B ]] and [[B|Bee]] and ![[Old/B]].\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['Old/B', 'B'], embeds: ['Old/B'] }),
      rec('/v/Old/B.md', { folder: 'Old' }),
    ]
    const summary = await updateLinksAfterRename({ root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[New/B]] and [[ B ]] and [[B|Bee]] and ![[New/B]].\n')
  })

  it('records under the folder RELOCATE: a referencing note inside the renamed folder is read/written at its NEW path', async () => {
    const files = { '/v/New/inner.md': { content: 'link [[Old/B]]\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/Old/inner.md', { folder: 'Old', links: ['Old/B'] }),
      rec('/v/Old/B.md', { folder: 'Old' }),
    ]
    expect(await updateLinksAfterRename({ root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/New/inner.md'].content).toBe('link [[New/B]]\n')
  })

  it('a pathed link to a file OUTSIDE the folder (and a prefix-cousin folder) is untouched', async () => {
    const files = { '/v/A.md': { content: '[[Sub/x]] and [[Older/y]]\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['Sub/x', 'Older/y'] }),
      rec('/v/Sub/x.md', { folder: 'Sub' }),
      rec('/v/Older/y.md', { folder: 'Older' }), // `/v/Older` is NOT under `/v/Old`
    ]
    expect(await updateLinksAfterRename({ root, oldPath: '/v/Old', newPath: '/v/New', kind: 'dir', records })).toEqual({ updated: 0, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Sub/x]] and [[Older/y]]\n')
  })
})

describe('updateLinksAfterRename across a cross-directory file MOVE (E1b)', () => {
  const root = '/v'

  it('a bare link stays BYTE-IDENTICAL when the bare name still resolves to the moved file (pin)', async () => {
    const files = { '/v/A.md': { content: 'See [[ B ]] and [[Old/B]].\n', mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['B', 'Old/B'] }), rec('/v/Old/B.md', { folder: 'Old' })]
    const summary = await updateLinksAfterRename({ root, oldPath: '/v/Old/B.md', newPath: '/v/New/B.md', records })
    expect(summary).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('See [[ B ]] and [[New/B]].\n') // padding intact — never spliced
  })

  it('a bare link ESCALATES to the pathed form when the move hands the bare name to another file (pin)', async () => {
    // B moves deeper than the duplicate Sub/B: the shallowest rule now picks Sub/B for [[B]].
    const files = { '/v/A.md': { content: '[[B]] here\n', mtime: 1 } }
    installBridge(files)
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/B.md'),
      rec('/v/Sub/B.md', { folder: 'Sub' }),
    ]
    expect(await updateLinksAfterRename({ root, oldPath: '/v/B.md', newPath: '/v/Deep/er/B.md', records })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[Deep/er/B]] here\n')
  })
})

describe('view-only rename references stay outside the semantic index (YAZ-1310)', () => {
  const root = '/v'
  const viewFile = (path: string, kind: 'text' | 'pdf' = 'text'): TreeNode => ({
    type: 'file', name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: 1, mtime: 1,
  })

  it('counts and rewrites explicit-extension body/frontmatter links while preserving suffixes, aliases and code masks', async () => {
    const content = '---\nsource: "[[data.json#meta|JSON source]]"\n---\n\n[[ data.json ]] [[data.json#row|shown]] `[[data.json]]`\n```\n[[data.json]]\n```\n'
    const files = { '/v/A.md': { content, mtime: 1 } }
    const bridge = installBridge(files)
    const records = [rec('/v/A.md', { links: ['data.json'] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [viewFile('/v/data.json')])

    expect(records.some((record) => record.path === '/v/data.json')).toBe(false)
    expect(countLinkReferences({ root, oldPath: '/v/data.json', records, viewOnlyCatalog })).toBe(1)
    expect(await updateLinksAfterRename({ root, oldPath: '/v/data.json', newPath: '/v/data-v2.JSON', records, viewOnlyCatalog })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toContain('source: "[[data-v2.JSON#meta|JSON source]]"')
    expect(files['/v/A.md'].content).toContain('[[data-v2.JSON]] [[data-v2.JSON#row|shown]] `[[data.json]]`')
    expect(files['/v/A.md'].content).toContain('```\n[[data.json]]\n```')
    expect(bridge.readFile).toHaveBeenCalledExactlyOnceWith('/v/A.md')
    expect(bridge.writeFile).toHaveBeenCalledTimes(1)
    expect(bridge.writeFile.mock.calls[0]?.[0].path).toBe('/v/A.md')
  })

  it.each([
    ['/v/tool.py', '/v/tool-v2.PY', 'text'],
    ['/v/report.pdf', '/v/report-v2.PDF', 'pdf'],
  ] as const)('rewrites a supported %s link without a target IndexRecord', async (oldPath, newPath, kind) => {
    const oldName = oldPath.slice(oldPath.lastIndexOf('/') + 1)
    const newName = newPath.slice(newPath.lastIndexOf('/') + 1)
    const files = { '/v/A.md': { content: `[[${oldName}]]\n`, mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: [oldName] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [viewFile(oldPath, kind)])
    expect(await updateLinksAfterRename({ root, oldPath, newPath, records, viewOnlyCatalog })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe(`[[${newName}]]\n`)
  })

  it('uses the post-move catalog to escalate a basename that a shallower duplicate wins', async () => {
    const files = { '/v/A.md': { content: '[[data.json]]\n', mtime: 1 } }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['data.json'] })]
    const viewOnlyCatalog = buildViewOnlyCatalog(root, [
      viewFile('/v/data.json'),
      { type: 'dir', name: 'other', path: '/v/other', children: [viewFile('/v/other/data.JSON')] },
    ])
    expect(await updateLinksAfterRename({
      root,
      oldPath: '/v/data.json',
      newPath: '/v/z/deep/data.json',
      records,
      viewOnlyCatalog,
    })).toEqual({ updated: 1, skipped: 0 })
    expect(files['/v/A.md'].content).toBe('[[z/deep/data.json]]\n')
  })
})

// ---------- the E1c dry-run count (GRO-2242) ----------

describe('countLinkReferences (the banner N — the exact referencing-set filter, no reads, no writes)', () => {
  const root = '/v'

  it('counts records whose links OR embeds resolve to the moved path — bare, pathed and embed forms', () => {
    const records = [
      rec('/v/A.md', { links: ['B'] }),
      rec('/v/Hub.md', { embeds: ['B'] }),
      rec('/v/Pathed.md', { links: ['Sub/B'] }),
      rec('/v/Other.md', { links: ['C'] }),
      rec('/v/Sub/B.md'),
      rec('/v/C.md'),
    ]
    // Bare [[B]] resolves to the shallowest B — none at the root, so /v/Sub/B.md wins.
    expect(countLinkReferences({ root, oldPath: '/v/Sub/B.md', records })).toBe(3)
  })

  it('0 when nothing references the moved path (→ no banner at all, the locked N === 0 rule)', () => {
    const records = [rec('/v/A.md', { links: ['C'] }), rec('/v/B.md'), rec('/v/C.md')]
    expect(countLinkReferences({ root, oldPath: '/v/B.md', records })).toBe(0)
  })

  it('agrees with what updateLinksAfterRename then touches (one construction, never two truths)', async () => {
    const files = {
      '/v/A.md': { content: 'See [[B]].\n', mtime: 1 },
      '/v/H.md': { content: '![[B]]\n', mtime: 1 },
    }
    installBridge(files)
    const records = [rec('/v/A.md', { links: ['B'] }), rec('/v/H.md', { embeds: ['B'] }), rec('/v/B.md')]
    const n = countLinkReferences({ root, oldPath: '/v/B.md', records })
    const summary = await updateLinksAfterRename({ root, oldPath: '/v/B.md', newPath: '/v/B2.md', records })
    expect(n).toBe(2)
    expect(summary).toEqual({ updated: n, skipped: 0 })
  })
})
