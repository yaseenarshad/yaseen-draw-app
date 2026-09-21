/**
 * `setFrontmatterProperty` (GRO-2141): one key changes, everything else — comments,
 * key order, quoting, fence style, line endings and the whole body — survives verbatim.
 * Lives under client/src so vitest collects it; the module itself is in shared/.
 */
import { describe, expect, it } from 'vitest'
import { buildFrontmatter, FrontmatterWriteError, parseFrontmatter, replaceFrontmatter, setFrontmatterProperty, splitFrontmatter } from '@shared/frontmatter'

const NOTE = `---
# how this note is filed
title: "Deep Work"
status: draft
rating: 5
tags: [focus, books]
---

# Deep Work

Some body text.

---

A horizontal rule above, and a stray \`---\` line inside the body.
`

describe('setFrontmatterProperty', () => {
  it('keeps an existing comment', () => {
    expect(setFrontmatterProperty(NOTE, 'status', 'done')).toContain('# how this note is filed')
  })

  it('preserves key order when changing a middle key', () => {
    const out = splitFrontmatter(setFrontmatterProperty(NOTE, 'status', 'done')).frontmatter
    expect(out).toBe(`---
# how this note is filed
title: "Deep Work"
status: done
rating: 5
tags: [focus, books]
---
`)
  })

  it('appends a new key inside the block', () => {
    const out = splitFrontmatter(setFrontmatterProperty(NOTE, 'author', 'Cal Newport')).frontmatter
    expect(out).toBe(`---
# how this note is filed
title: "Deep Work"
status: draft
rating: 5
tags: [focus, books]
author: Cal Newport
---
`)
  })

  it('preserves the quoting style of untouched values', () => {
    expect(setFrontmatterProperty(NOTE, 'rating', 4)).toContain('title: "Deep Work"')
  })

  it('writes a list value', () => {
    const out = splitFrontmatter(setFrontmatterProperty(NOTE, 'tags', ['focus', 'books', 'habits'])).frontmatter
    expect(out).toContain('tags:\n  - focus\n  - books\n  - habits\n')
  })

  it('distinguishes numbers from strings', () => {
    expect(setFrontmatterProperty(NOTE, 'rating', 4)).toContain('rating: 4\n')
    expect(setFrontmatterProperty(NOTE, 'rating', '4')).toContain('rating: "4"\n')
    expect(setFrontmatterProperty(NOTE, 'rating', true)).toContain('rating: true\n')
    expect(setFrontmatterProperty(NOTE, 'rating', null)).toContain('rating: null\n')
  })

  it('deletes a key', () => {
    const out = splitFrontmatter(setFrontmatterProperty(NOTE, 'status', undefined)).frontmatter
    expect(out).toBe(`---
# how this note is filed
title: "Deep Work"
rating: 5
tags: [focus, books]
---
`)
  })

  it('leaves an empty block when the last key is deleted', () => {
    // Deliberate: the fences stay, so the note still reads as "has frontmatter" in Obsidian.
    expect(setFrontmatterProperty('---\nstatus: draft\n---\nBody\n', 'status', undefined)).toBe('---\n---\nBody\n')
  })

  it('writes into an empty block left behind by an earlier delete', () => {
    expect(setFrontmatterProperty('---\n---\nBody\n', 'status', 'draft')).toBe('---\nstatus: draft\n---\nBody\n')
  })

  it('the empty block left by a delete splits as frontmatter, body clean (GRO-2216)', () => {
    const out = setFrontmatterProperty('---\nstatus: draft\n---\nBody\n', 'status', undefined)
    expect(splitFrontmatter(out)).toEqual({ frontmatter: '---\n---\n', body: 'Body\n' })
  })

  it('creates a block when the file has no frontmatter', () => {
    expect(setFrontmatterProperty('# Title\n\nBody\n', 'status', 'draft')).toBe('---\nstatus: draft\n---\n# Title\n\nBody\n')
  })

  it('creates a block for an empty file', () => {
    expect(setFrontmatterProperty('', 'status', 'draft')).toBe('---\nstatus: draft\n---\n')
  })

  it('leaves a file without frontmatter unchanged when deleting', () => {
    const md = '# Title\n\nBody\n'
    expect(setFrontmatterProperty(md, 'status', undefined)).toBe(md)
  })

  it('leaves the file unchanged when deleting a key that is not there', () => {
    expect(setFrontmatterProperty(NOTE, 'missing', undefined)).toBe(NOTE)
  })

  it('keeps a CRLF file on CRLF', () => {
    const crlf = '---\r\ntitle: A\r\nstatus: draft\r\n---\r\nBody\r\n'
    expect(setFrontmatterProperty(crlf, 'status', 'done')).toBe('---\r\ntitle: A\r\nstatus: done\r\n---\r\nBody\r\n')
  })

  it('preserves a `...` terminator', () => {
    const dots = '---\nstatus: draft\n...\nBody\n'
    expect(setFrontmatterProperty(dots, 'status', 'done')).toBe('---\nstatus: done\n...\nBody\n')
  })

  it('preserves a block with no trailing newline', () => {
    expect(setFrontmatterProperty('---\nstatus: draft\n---', 'status', 'done')).toBe('---\nstatus: done\n---')
  })

  it('leaves the body byte-identical, `---` rule included', () => {
    const body = splitFrontmatter(NOTE).body
    expect(splitFrontmatter(setFrontmatterProperty(NOTE, 'status', 'done')).body).toBe(body)
    expect(splitFrontmatter(setFrontmatterProperty(NOTE, 'author', 'Cal')).body).toBe(body)
    expect(splitFrontmatter(setFrontmatterProperty(NOTE, 'title', undefined)).body).toBe(body)
  })

  it('throws FrontmatterWriteError on invalid YAML and touches nothing', () => {
    const broken = '---\ntags: [a, b\nstatus: : :\n---\nBody\n'
    expect(() => setFrontmatterProperty(broken, 'status', 'done')).toThrow(FrontmatterWriteError)
  })

  it('throws FrontmatterWriteError when the frontmatter is not a map', () => {
    expect(() => setFrontmatterProperty('---\n- a\n- b\n---\nBody\n', 'status', 'done')).toThrow(FrontmatterWriteError)
  })
})

describe('buildFrontmatter (Bible B, GRO-2202)', () => {
  it('builds one fenced block with native YAML types, {} → empty string', () => {
    expect(buildFrontmatter({})).toBe('')
    expect(buildFrontmatter({ status: 'idea', priority: 2, published: false })).toBe('---\nstatus: idea\npriority: 2\npublished: false\n---\n')
    expect(buildFrontmatter({ tags: ['agentic'] })).toBe('---\ntags:\n  - agentic\n---\n')
  })

  it('null prints Obsidian-style empty (`key:`), an empty list as `key: []`', () => {
    expect(buildFrontmatter({ sku_tag: 'operational', funnel_stages: [], kpi_category: null, unit: null })).toBe(
      '---\nsku_tag: operational\nfunnel_stages: []\nkpi_category:\nunit:\n---\n',
    )
  })

  it('round-trips through parseFrontmatter (nulls stay null)', () => {
    const block = buildFrontmatter({ channel: 'Outbound', parent: null, kpis_impacted: [] })
    expect(parseFrontmatter(splitFrontmatter(`${block}Body\n`).frontmatter).properties).toEqual({ channel: 'Outbound', parent: null, kpis_impacted: [] })
  })
})

/**
 * `replaceFrontmatter` (⚡ YAZ-883): the raw panel's whole-block write. The user's literal text
 * goes back verbatim — never a parse→reformat — while the FRAME (fences, terminator style, the
 * file's own line endings around them) and the body stay byte-identical.
 */
describe('replaceFrontmatter (⚡ YAZ-883): the raw panel writes the user\'s literal text, never a reformat', () => {
  it('replaces the interior verbatim — fences, terminator style and the body stay byte-identical', () => {
    const content = '---\n# kept comment\ntitle: "quoted"\n---\nbody line\n'
    expect(replaceFrontmatter(content, 'status: draft\n')).toBe('---\nstatus: draft\n---\nbody line\n')
    const dots = '---\na: 1\n...\nbody\n'
    expect(replaceFrontmatter(dots, 'a: 2\n')).toBe('---\na: 2\n...\nbody\n')
  })

  it("the user's text needs no trailing newline — one is supplied, never two", () => {
    expect(replaceFrontmatter('---\na: 1\n---\nb\n', 'a: 2')).toBe('---\na: 2\n---\nb\n')
    expect(replaceFrontmatter('---\na: 1\n---\nb\n', 'a: 2\n')).toBe('---\na: 2\n---\nb\n')
  })

  it('a page with no frontmatter grows a block at the top, body untouched', () => {
    expect(replaceFrontmatter('just body\n', 'a: 1\n')).toBe('---\na: 1\n---\njust body\n')
  })

  it('empty text removes the whole block; empty on empty stays empty', () => {
    expect(replaceFrontmatter('---\na: 1\n---\nbody\n', '')).toBe('body\n')
    expect(replaceFrontmatter('body\n', '')).toBe('body\n')
  })

  it('an unchanged interior is the identity — the caller can skip the write', () => {
    const content = '---\na: 1\n---\nbody\n'
    expect(replaceFrontmatter(content, 'a: 1\n')).toBe(content)
  })

  it("CRLF fences survive: the interior is the user's, the frame is the file's", () => {
    const crlf = '---\r\na: 1\r\n---\r\nbody\r\n'
    expect(replaceFrontmatter(crlf, 'a: 2\r\n')).toBe('---\r\na: 2\r\n---\r\nbody\r\n')
  })
})
