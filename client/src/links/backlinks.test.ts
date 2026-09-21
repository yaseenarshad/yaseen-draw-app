/**
 * Backlinks (Links D, GRO-2193): the pure half — the referencing set over an index snapshot
 * and the on-demand context-snippet extraction. Resolution runs through THE shared resolver
 * (`resolverFor`, wrapped exactly as `WikilinkIndexBridge` wraps it), so alias-form links are
 * mentions for free and nothing here re-implements link matching.
 */
import { describe, expect, it } from 'vitest'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../views/engine'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'
import { MAX_SNIPPETS, SNIPPET_MAX_CHARS, backlinksFor, mentionSnippets, type MentionSnippet } from './backlinks'

interface RecInit {
  links?: string[]
  embeds?: string[]
  aliases?: string[]
}

const rec = (path: string, { links = [], embeds = [], aliases = [] }: RecInit = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases,
    tags: [],
    links,
    embeds,
  }
}

/** The resolve function the app feeds the section — `resolverFor` unwrapped to a path (bridge idiom). */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const resolve = resolverFor(records, '/vault')
  return (target) => resolve(target)?.record.path ?? null
}

const B = '/vault/B.md'

describe('backlinksFor (Links D, GRO-2193)', () => {
  it('collects the notes whose links resolve to the open note, and only those', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, {}), rec('/vault/C.md', { links: ['Elsewhere'] })]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('counts a mention in ANY link form: bare, root-relative, pathed and case-insensitive', () => {
    const records = [
      rec('/vault/A.md', { links: ['b'] }),
      rec('/vault/Sub/Deep.md', { links: ['B.md'] }),
      rec(B, {}),
      rec('/vault/C.md', { links: ['/vault/B.md'] }),
    ]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual([
      '/vault/A.md',
      '/vault/C.md',
      '/vault/Sub/Deep.md',
    ])
  })

  it('an ALIAS-form link is a linked mention too (E2 aliases ride the shared resolver)', () => {
    const records = [rec('/vault/A.md', { links: ['CAC'] }), rec(B, { aliases: ['CAC'] })]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('an `![[embed]]` is a mention as well (embeds count, locked)', () => {
    const records = [rec('/vault/A.md', { embeds: ['B'] }), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('never lists the open note itself, even when it links to itself', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, { links: ['B'] })]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual(['/vault/A.md'])
  })

  it('one entry per referencing note, whatever the number of mentions it holds', () => {
    const records = [rec('/vault/A.md', { links: ['B', 'b', 'B.md'], embeds: ['B'] }), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records))).toHaveLength(1)
  })

  it('orders entries by path whatever the input order', () => {
    const records = [
      rec('/vault/Zeta.md', { links: ['B'] }),
      rec('/vault/Alpha.md', { links: ['B'] }),
      rec(B, {}),
      rec('/vault/Sub/Mid.md', { links: ['B'] }),
    ]
    expect(backlinksFor(B, records, resolverOver(records)).map((r) => r.path)).toEqual([
      '/vault/Alpha.md',
      '/vault/Sub/Mid.md',
      '/vault/Zeta.md',
    ])
  })

  it('no mentions → an empty list (the section renders nothing on this)', () => {
    const records = [rec('/vault/A.md'), rec(B, {})]
    expect(backlinksFor(B, records, resolverOver(records))).toEqual([])
  })

  it('memoizes per (records identity, path): the same snapshot answers the same array', () => {
    const records = [rec('/vault/A.md', { links: ['B'] }), rec(B, {})]
    const resolve = resolverOver(records)
    expect(backlinksFor(B, records, resolve)).toBe(backlinksFor(B, records, resolve))
    // A refetched snapshot is a NEW array and recomputes (live updates).
    const next = [rec(B, {})]
    expect(backlinksFor(B, next, resolverOver(next))).toEqual([])
  })
})

describe('mentionSnippets (Links D, GRO-2193; display text + line grouping FN9/FN10, GRO-2197)', () => {
  const records = [rec('/vault/A.md'), rec(B, { aliases: ['CAC'] })]
  const resolve = resolverOver(records)

  /** The highlighted runs of one snippet, in order. */
  const marked = (s: MentionSnippet): string[] => s.ranges.map((r) => s.text.slice(r.from, r.to))

  it('returns the mention line as the EDITOR shows it, with the display text highlighted', () => {
    const [snippet] = mentionSnippets('# A\n\nSee [[B]] for more.\n', B, resolve)
    expect(snippet.text).toBe('See B for more.')
    expect(marked(snippet)).toEqual(['B'])
  })

  it('one snippet per LINE, in document order; other links are never highlighted', () => {
    const snippets = mentionSnippets('[[Elsewhere]] then [[B]]\n\nand [[B|the other]] again\n', B, resolve)
    expect(snippets.map((s) => s.text)).toEqual(['Elsewhere then B', 'and the other again'])
    expect(snippets.map(marked)).toEqual([['B'], ['the other']])
  })

  it('a piped mention shows its ALIAS — exactly the editor display, never the raw brackets (FN9)', () => {
    const [snippet] = mentionSnippets('see [[B|Bee alias]] here\n', B, resolve)
    expect(snippet.text).toBe('see Bee alias here')
    expect(marked(snippet)).toEqual(['Bee alias'])
  })

  it('a heading-form mention shows the ` > `-joined display, like the decorations', () => {
    const [snippet] = mentionSnippets('deep [[B#Intro]] link\n', B, resolve)
    expect(snippet.text).toBe('deep B > Intro link')
    expect(marked(snippet)).toEqual(['B > Intro'])
  })

  it('an UNRELATED link on the same line shows display text too, unhighlighted (FN9)', () => {
    const [snippet] = mentionSnippets('[[Other|o]] with [[B]] here\n', B, resolve)
    expect(snippet.text).toBe('o with B here')
    expect(marked(snippet)).toEqual(['B'])
  })

  it('TWO mentions on one line make ONE snippet with TWO highlights (FN10)', () => {
    const snippets = mentionSnippets('See [[B]] and [[B|again]] here\n', B, resolve)
    expect(snippets).toHaveLength(1)
    expect(snippets[0].text).toBe('See B and again here')
    expect(marked(snippets[0])).toEqual(['B', 'again'])
  })

  it('highlights alias-form mentions by display text and embed mentions raw (embeds are undecorated)', () => {
    expect(mentionSnippets('via [[CAC]]\n', B, resolve).map(marked)).toEqual([['CAC']])
    expect(mentionSnippets('shown ![[B]]\n', B, resolve).map(marked)).toEqual([['![[B]]']])
  })

  it('skips fenced blocks and inline code — exactly what the index skips', () => {
    const content = '```\n[[B]]\n```\n\nand `[[B]]` inline\n\nreal [[B]]\n'
    expect(mentionSnippets(content, B, resolve).map((s) => s.text)).toEqual(['real B'])
  })

  it('trims the line and windows a long one around the first mention, ellipsised on both sides', () => {
    const pad = 'x'.repeat(400)
    const [snippet] = mentionSnippets(`   ${pad} [[B]] ${pad}   \n`, B, resolve)
    expect(snippet.text.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS + 2)
    expect(snippet.text.startsWith('…')).toBe(true)
    expect(snippet.text.endsWith('…')).toBe(true)
    expect(marked(snippet)).toEqual(['B']) // the window always contains the first mention whole
  })

  it('a second mention outside the window is dropped; the first (centred) one never is', () => {
    const pad = 'x'.repeat(400)
    const [snippet] = mentionSnippets(`[[B]] ${pad} [[B]]\n`, B, resolve)
    expect(marked(snippet)).toEqual(['B'])
    expect(snippet.ranges).toHaveLength(1)
  })

  it('a short line keeps its whole text and gets no ellipsis', () => {
    const [snippet] = mentionSnippets('   * [[B]] note   \n', B, resolve)
    expect(snippet.text).toBe('* B note')
  })

  it('mentions of another note, same-file `[[#heading]]` links and plain text yield nothing', () => {
    expect(mentionSnippets('[[Elsewhere]] and [[#top]] and words\n', B, resolve)).toEqual([])
  })

  it('caps the snippet LINES per note (the section stays quiet on link-heavy notes)', () => {
    const content = Array.from({ length: MAX_SNIPPETS + 3 }, (_, i) => `line ${i} [[B]]`).join('\n')
    expect(mentionSnippets(content, B, resolve)).toHaveLength(MAX_SNIPPETS)
  })

  it('reads mentions out of the frontmatter block too (the index counts them as links)', () => {
    const [snippet] = mentionSnippets('---\nparent: "[[B]]"\n---\n\nbody\n', B, resolve)
    expect(snippet.text).toBe('parent: "B"')
  })
})
