import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseFrontmatter } from '@shared/frontmatter'
import { MAX_FILE_BYTES } from '@shared/types'
import { makeViewsFixture } from '../fs/viewsFixture'
import { extractAliases, extractEmbeds, extractLinks, extractTags, scanFile } from './index'

describe('parseFrontmatter', () => {
  it('parses a YAML map; core schema keeps dates as strings', () => {
    expect(parseFrontmatter('---\ntitle: X\ndate: 2026-08-01\nn: 2\nok: true\nnil: null\n---\n')).toEqual({
      properties: { title: 'X', date: '2026-08-01', n: 2, ok: true, nil: null },
    })
  })

  it('empty block → {}', () => {
    expect(parseFrontmatter('')).toEqual({ properties: {} })
    expect(parseFrontmatter('---\n\n---\n')).toEqual({ properties: {} })
  })

  it('scalar or list → not a map', () => {
    expect(parseFrontmatter('---\njust text\n---\n')).toEqual({ properties: {}, error: 'frontmatter is not a map' })
    expect(parseFrontmatter('---\n- a\n---\n')).toEqual({ properties: {}, error: 'frontmatter is not a map' })
  })

  it('YAML error → message', () => {
    const r = parseFrontmatter('---\nstatus: [unclosed\n---\n')
    expect(r.properties).toEqual({})
    expect(r.error).toMatch(/\S/)
  })

  it('handles CRLF and the `...` terminator', () => {
    expect(parseFrontmatter('---\r\na: 1\r\n...\r\n')).toEqual({ properties: { a: 1 } })
  })
})

describe('extractTags', () => {
  it('frontmatter list / string / `tag` key; leading # stripped; non-strings ignored', () => {
    expect(extractTags({ tags: ['a', '#b', 3, null] }, '')).toEqual(['a', 'b'])
    expect(extractTags({ tags: 'x, y  z' }, '')).toEqual(['x', 'y', 'z'])
    expect(extractTags({ tag: 'solo' }, '')).toEqual(['solo'])
    expect(extractTags({ tags: 42 }, '')).toEqual([])
  })

  it('inline tags: prefix rules, nested kept, digits-only ignored, case preserved', () => {
    expect(extractTags({}, 'a #One (#two) [#three] x,#four;#five\n#six')).toEqual([
      'One',
      'two',
      'three',
      'four',
      'five',
      'six',
    ])
    expect(extractTags({}, '#first on the first char')).toEqual(['first'])
    expect(extractTags({}, 'see #a/b and #123 and #1a')).toEqual(['a/b', '1a'])
    expect(extractTags({}, 'not#tag and # heading')).toEqual([])
  })

  it('skips fenced code, inline code and URLs', () => {
    expect(extractTags({}, '```\n#fenced\n```\n~~~\n#tilde\n~~~\n#kept')).toEqual(['kept'])
    expect(extractTags({}, '```js\n#fenced\n```')).toEqual([])
    expect(extractTags({}, 'x `#inline` y ``#double`` #kept')).toEqual(['kept'])
    expect(extractTags({}, 'https://x.com/#frag http://y.com/a#b #kept')).toEqual(['kept'])
  })

  it('de-duplicates: frontmatter first, then first appearance', () => {
    expect(extractTags({ tags: ['b'] }, '#a #b #a')).toEqual(['b', 'a'])
  })
})

describe('extractAliases (GRO-2214)', () => {
  it('list items are trimmed; empties and non-strings dropped; de-duplicated', () => {
    expect(extractAliases({ aliases: [' CAC ', '', 'Acquisition Cost', 7, null, 'CAC'] })).toEqual(['CAC', 'Acquisition Cost'])
  })

  it('a scalar string is ONE alias — never comma-split, unlike `tags`', () => {
    expect(extractAliases({ aliases: 'Customer Acquisition Cost, CAC' })).toEqual(['Customer Acquisition Cost, CAC'])
    expect(extractAliases({ aliases: '  CAC  ' })).toEqual(['CAC'])
  })

  it('absent, empty or non-string `aliases` → []; only that key is read', () => {
    expect(extractAliases({})).toEqual([])
    expect(extractAliases({ aliases: [] })).toEqual([])
    expect(extractAliases({ aliases: 42 })).toEqual([])
    expect(extractAliases({ alias: 'CAC' })).toEqual([]) // `alias` singular is not the key (Obsidian's is `aliases`)
  })
})

describe('extractLinks / extractEmbeds', () => {
  it('strips alias, heading and block refs; trims', () => {
    expect(extractLinks({}, '[[A|alias]] [[B#Heading]] [[C#^blk]] [[ D ]]')).toEqual(['A', 'B', 'C', 'D'])
  })

  it('embeds are not links and vice versa', () => {
    const body = '![[img.png]] [[Note]] ![[Other#sec|x]]'
    expect(extractLinks({}, body)).toEqual(['Note'])
    expect(extractEmbeds(body)).toEqual(['img.png', 'Other'])
  })

  it('frontmatter string values (top-level and in lists) matching exactly [[…]] count as links', () => {
    expect(extractLinks({ related: '[[X]]', list: ['[[Y|y]]', 'plain', 7], note: 'see [[Z]]' }, '')).toEqual(['X', 'Y'])
  })

  it('`aliases` values are NEVER links, whatever they look like (GRO-2214)', () => {
    // A `[[X]]`-shaped alias stays an alias literally named `[[X]]` (extractAliases strips
    // nothing) — it just never becomes an outgoing link of this note.
    expect(extractLinks({ aliases: ['[[X]]', 'CAC'], related: '[[Y]]' }, '')).toEqual(['Y'])
    expect(extractLinks({ aliases: '[[X]]' }, '')).toEqual([])
    expect(extractAliases({ aliases: ['[[X]]'] })).toEqual(['[[X]]'])
  })

  it('de-duplicates: frontmatter first, then first appearance', () => {
    expect(extractLinks({ a: '[[B]]' }, '[[A]] [[B]] [[A]]')).toEqual(['B', 'A'])
    expect(extractEmbeds('![[a]] ![[b]] ![[a]]')).toEqual(['a', 'b'])
  })

  it('skips fenced code blocks and inline code spans, like tags; the line after a fence still counts', () => {
    const body = '```\n[[Hidden]] ![[x.png]]\n```\n[[After]]\n~~~\n[[Tilde]]\n~~~\nsee `[[Inline]]` and ![[real.png]]'
    expect(extractLinks({}, body)).toEqual(['After'])
    expect(extractEmbeds(body)).toEqual(['real.png'])
  })
})

describe('scanFile', () => {
  let root: string
  let cleanup: () => Promise<void>
  beforeAll(async () => ({ root, cleanup } = await makeViewsFixture()))
  afterAll(() => cleanup())
  const note = (...p: string[]) => path.join(root, 'Content Pillars', ...p)

  it('identity + stat fields', async () => {
    const r = await scanFile(root, note('1. Agentic Agency', 'Agentic Agency.md'))
    expect(r).toMatchObject({
      path: note('1. Agentic Agency', 'Agentic Agency.md'),
      name: 'Agentic Agency.md',
      basename: 'Agentic Agency',
      folder: 'Content Pillars/1. Agentic Agency',
      ext: 'md',
      properties: { pillar: 'Agentic Agency', status: 'idea', priority: 2, tags: ['agentic', 'pillar'], published: false, date: '2026-08-01' },
      tags: ['agentic', 'pillar'],
      links: [],
      embeds: [],
    })
    expect(r.size).toBeGreaterThan(0)
    expect(r.ctime).toBeGreaterThan(0)
    expect(r.mtime).toBeGreaterThan(0)
    expect(r.frontmatterError).toBeUndefined()
  })

  it('a note at the root has folder ""; `pillar: null` is present', async () => {
    const r = await scanFile(root, path.join(root, 'VSL-v1.md'))
    expect(r.folder).toBe('')
    expect(r.basename).toBe('VSL-v1')
    expect('pillar' in r.properties).toBe(true)
    expect(r.properties.pillar).toBeNull()
  })

  it('invalid frontmatter → frontmatterError set and properties {}', async () => {
    const r = await scanFile(root, note('4. Tech & Silicon Valley', 'Tech & Silicon Valley.md'))
    expect(r.properties).toEqual({})
    expect(r.frontmatterError).toMatch(/\S/)
  })

  it('frontmatter wikilinks count as links; nested tag kept', async () => {
    const r = await scanFile(root, note('1. Agentic Agency', 'The Levels of an Agency.md'))
    expect(r.tags).toEqual(['agentic/levels'])
    expect(r.links).toEqual(['levels.png', 'Agentic Agency'])
    expect(r.embeds).toEqual([])
  })

  it('no frontmatter: tag inside the fenced block ignored, embed collected', async () => {
    const r = await scanFile(root, note('3. Trust Economy & Paid Ads', 'Attribution.md'))
    expect(r.properties).toEqual({})
    expect(r.frontmatterError).toBeUndefined()
    expect(r.tags).toEqual(['attribution'])
    expect(r.links).toEqual([])
    expect(r.embeds).toEqual(['chart.png'])
  })

  it('string `tags:` is split', async () => {
    const r = await scanFile(root, note('2. Creator Economy', 'The Gold In Your Archive.md'))
    expect(r.tags).toEqual(['creator'])
  })

  it('frontmatter `aliases` land on the record and stay out of its links (GRO-2214)', async () => {
    const aliased = path.join(root, 'aliased.md')
    await writeFile(aliased, '---\naliases: [CAC, "Cost of Acquisition"]\nrelated: "[[Attribution]]"\n---\nBody [[Ideas]].\n')
    const r = await scanFile(root, aliased)
    expect(r.aliases).toEqual(['CAC', 'Cost of Acquisition'])
    expect(r.links).toEqual(['Attribution', 'Ideas'])
  })

  it('frontmatter `comments` are the note\'s own, never a property; the other keys stay (YAZ-1472)', async () => {
    const commented = path.join(root, 'commented.md')
    await writeFile(
      commented,
      '---\nstatus: draft\ncomments:\n  - id: 3f9a1c2e\n    at: 2026-09-11T18:22:31Z\n    body: "[[Not A Link]] in a comment"\ntags: [x]\n---\nBody.\n',
    )
    const r = await scanFile(root, commented)
    expect(r.properties).toEqual({ status: 'draft', tags: ['x'] })
    expect(r.frontmatterError).toBeUndefined()
    expect(r.links).toEqual([])
  })

  it('files over MAX_FILE_BYTES → metadata only', async () => {
    const big = path.join(root, 'big.md')
    await writeFile(big, '---\na: 1\n---\n#tag [[x]]\n' + 'x'.repeat(MAX_FILE_BYTES))
    const r = await scanFile(root, big)
    expect(r.size).toBeGreaterThan(MAX_FILE_BYTES)
    expect(r).toMatchObject({ name: 'big.md', properties: {}, aliases: [], tags: [], links: [], embeds: [] })
  })

  it('missing file → BridgeFailure NOT_FOUND', async () => {
    await expect(scanFile(root, path.join(root, 'nope.md'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
