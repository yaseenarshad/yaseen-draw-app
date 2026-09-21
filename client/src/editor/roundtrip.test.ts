/**
 * Crepe round-trip (GRO-1961): a synthetic fixture plus, when present on this
 * machine, a few real vault files (read-only) go through createCrepe() +
 * getMarkdownForSave(). Formatting normalisation is accepted (CONTRACTS.md
 * "Editor rules" 5); the assertions are on stable invariants: headings and words.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { basename } from 'node:path'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { splitFrontmatter } from '@shared/frontmatter'

const VAULT =
  '/Users/yasin/yaseen-os/yaseen-machine-content/Content Pillars/1. Agentic Agency'
const FILES = [
  `${VAULT}/How to Build Agents (for non-technical business owners)/Part 1/Storyboard-v1.md`,
  `${VAULT}/Services - Agentic Agency vs Traditional Agency.md`,
  `${VAULT}/How to Build Agents (for non-technical business owners)/Yaseen Dump.md`,
  `${VAULT}/How to Sell Agents (for non-technical business owners)/sources/Sequoia Article.md`,
]
const SYNTHETIC = `---
title: Synthetic fixture
tags: [a, b]
---

# Heading 1

Setext heading
==============

Some *emphasis*, __strong__, ==highlight==, \`code\`, a [link](https://x.y/z "t"), and a [[Wiki Link]] plus ![[embed.png]] and #tag.
A hard break follows (two spaces)  
next line. Backslash break\\
next line. Escapes: 1\\. not a list, \\_under\\_, \\[bracket\\], a_b_c, 2 * 3 * 4.

- dash item
- dash item two
    - nested four spaces
	- nested tab

* star item
+ plus item

1) paren ordered
2) paren ordered

1. dot ordered
1. dot ordered (all ones)

- [ ] todo
- [x] done

> quote line one
continued lazily

| Col A | Col B |
|-------|:-----:|
| 1     | 2     |

\`\`\`ts
const x = 1
\`\`\`

    indented code block

***

___

<div align="center">raw html</div>

Line with trailing spaces   
Final line without trailing newline`

async function roundTrip(markdown: string): Promise<string> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  const out = getMarkdownForSave(crepe)
  await crepe.destroy()
  root.remove()
  return out
}

async function documentJson(markdown: string): Promise<Record<string, unknown>> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  const json = crepe.editor.ctx.get(editorViewCtx).state.doc.toJSON() as Record<string, unknown>
  await crepe.destroy()
  root.remove()
  return json
}

function headings(md: string): string[] {
  const out: string[] = []
  const lines = md.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^[\s>*+-]*(?:\d+[.)]\s+)?/, "")
    if (/^#{1,6}\s/.test(l)) {
      out.push(l.replace(/^#{1,6}\s+/, "").trim())
    } else if (l.trim() && i + 1 < lines.length && /^(=+|-+)\s*$/.test(lines[i + 1]) && !/^\s*[-*+]\s/.test(lines[i])) {
      // setext heading (Crepe re-serialises these as ATX)
      out.push(l.trim())
      i++
    }
  }
  return out
}

/** Words after stripping markdown punctuation, html tags and escapes — content invariant. */
function words(md: string): string[] {
  return md
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, " ") // list markers
    .replace(/<(?![a-z]+:\/\/)(?![^>\s]*@)[^>\n]+>/g, " ") // html tags, keep autolinks
    .replace(/\\/g, "")
    .replace(/[#*_`|\[\]()!+\-~=&<>.,:;"]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

describe('Crepe markdown round-trip', () => {
  const cases: Array<[string, string]> = [['synthetic.md', SYNTHETIC]]
  for (const f of FILES) {
    if (existsSync(f)) cases.push([basename(f), readFileSync(f, 'utf8')])
  }

  it.each(cases)('%s: headings + words preserved', async (_name, original) => {
    const { body } = splitFrontmatter(original)
    const out = await roundTrip(body)
    expect(headings(out)).toEqual(headings(body))
    expect(words(out).join(' ')).toEqual(words(body).join(' '))
  })

  it('synthetic: frontmatter-stripped body round-trips without the --- fence mangling', async () => {
    const { frontmatter, body } = splitFrontmatter(SYNTHETIC)
    expect(frontmatter.startsWith('---\n')).toBe(true)
    expect((await roundTrip(body)).startsWith('---')).toBe(false)
    // Fed WITH frontmatter, Crepe turns the YAML block into a thematic break + paragraph.
    expect((await roundTrip(SYNTHETIC)).startsWith('---\ntitle:')).toBe(false)
  })

  it('round-trip is idempotent (second pass === first pass)', async () => {
    const { body } = splitFrontmatter(SYNTHETIC)
    const once = await roundTrip(body)
    const twice = await roundTrip(once)
    expect(twice).toBe(once)
  })
})

describe('locked editor rules (createCrepe)', () => {
  it('keeps image alt text (ImageBlock feature off)', async () => {
    expect(await roundTrip('![alt text](https://x/y.png "t")\n')).toBe('![alt text](https://x/y.png "t")\n')
  })
  it('keeps task list checkboxes', async () => {
    expect(await roundTrip('- [ ] todo\n- [x] done\n')).toBe('* [ ] todo\n* [x] done\n')
  })
  it('does not inject <br /> before headings / nested lists inside list items', async () => {
    const out = await roundTrip('* # Part 1\n\t- **Idea:** foo\n\t* ### S1\n\t\t- bar\n')
    expect(out).not.toContain('<br />')
    expect(out).toContain('* # Part 1')
  })
  it('writes empty bullets as bare markers and keeps their children (GRO-2012)', async () => {
    expect(await roundTrip('* a\n* \n* b\n')).toBe('* a\n*\n* b\n')
    expect(await roundTrip('* a\n* \n  * c\n* b\n')).toBe('* a\n*\n  * c\n* b\n')
    expect(await roundTrip('1. a\n2. \n   1. c\n')).toBe('1. a\n2.\n   1. c\n')
    // legacy encoding from earlier builds: `<br />` must not swallow the children as an HTML block
    expect(await roundTrip('* a\n* <br />\n  * c\n* b\n')).toBe('* a\n*\n  * c\n* b\n')
    // empty task items: `<br />` (Milkdown's encoding, also what earlier builds wrote) never reaches
    // the disk, and Obsidian's bare `* [ ] ` / `* [ ]` stays a task instead of becoming text `\[ ]`
    expect(await roundTrip('* [ ] a\n* [x] <br />\n  * c\n')).toBe('* [ ] a\n* [x]\n  * c\n')
    expect(await roundTrip('* [ ] \n')).toBe('* [ ]\n')
    expect(await roundTrip('- [x]\n  - child\n- [ ] a\n')).toBe('* [x]\n  * child\n* [ ] a\n')
    expect(await roundTrip('1. [ ]\n2. [ ] b\n')).toBe('1. [ ]\n2. [ ] b\n')
    // a task whose text happens to start with a bracket is not an empty task
    expect(await roundTrip('* [ ] [x] literal\n')).toBe('* [ ] \\[x] literal\n')
    // A number immediately after a bullet is literal text, never a nested ordered list.
    expect(await roundTrip('* 1) one\n* 2. two\n')).toBe('* 1) one\n* 2. two\n')
    expect(await roundTrip('- 6. Paid\n- 7. Lead\n')).toBe('* 6. Paid\n* 7. Lead\n')
    // Real ordered Markdown remains supported: it is also what Number children writes.
    expect(await roundTrip('1. one\n2. two\n')).toBe('1. one\n2. two\n')
    // empty paragraphs outside list items are unchanged
    expect(await roundTrip('x\n\n<br />\n\ny\n')).toBe('x\n\n<br />\n\ny\n')
  })
  it('an empty bullet nested DIRECTLY under text loads as a nested item, spelled with a blank line (YAZ-1357)', async () => {
    // CommonMark: an empty list item cannot interrupt a paragraph, so `* a` + `  *` used to read as
    // the text `a *` (and the `-` spelling as a setext heading). The blank line is the one spelling
    // every parser reads as a nested empty item, and the one Milkdown writes back — so it is stable.
    expect(await roundTrip('* a\n  *\n')).toBe('* a\n\n  *\n')
    expect(await roundTrip('- a\n    -\n')).toBe('* a\n\n  *\n')
    expect(await roundTrip('* [[Alex Hormozi]]\n  *\n')).toBe('* [[Alex Hormozi]]\n\n  *\n')
    expect(await roundTrip('* a\n  *\n  * d\n')).toBe('* a\n\n  *\n  * d\n')
    expect(await roundTrip('* a\n  *\n    * e\n* f\n')).toBe('* a\n\n  *\n    * e\n* f\n')
    expect(await roundTrip('1. a\n   1.\n')).toBe('1. a\n\n   1.\n')
    expect(await roundTrip('* a\n\t*\n')).toBe('* a\n\n  *\n')
    // already spelled with the blank line: byte-stable
    expect(await roundTrip('* a\n\n  *\n')).toBe('* a\n\n  *\n')
    // a SIBLING empty bullet is not nested and keeps GRO-2012's bare-marker spelling
    expect(await roundTrip('* a\n*\n* b\n')).toBe('* a\n*\n* b\n')
  })
  it('parses a reported same-line number as the parent bullet text, with one direct child list', async () => {
    const json = await documentJson('* 5) Competitor Ad Intelligence Engine\n  * Automation Tools\n')
    expect(json).toMatchObject({
      content: [
        {
          type: 'bullet_list',
          content: [
            {
              type: 'list_item',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: '5) Competitor Ad Intelligence Engine' }] },
                { type: 'bullet_list' },
              ],
            },
          ],
        },
      ],
    })
    expect(JSON.stringify(json)).not.toContain('ordered_list')
  })
  it('ends with exactly one newline even when the trailing plugin appends an empty paragraph', async () => {
    expect(await roundTrip('# H\n\n* a\n')).toBe('# H\n\n* a\n')
    expect(await roundTrip('# H\n\n* a\n\n\n')).toBe('# H\n\n* a\n')
  })
  it('un-escapes wikilinks and embeds on save', async () => {
    const out = await roundTrip('See [[Wiki Link]] and ![[embed.png]].\n')
    expect(out).toBe('See [[Wiki Link]] and ![[embed.png]].\n')
  })
  it('wikilink variants round-trip byte-identically (decoration-only rendering, GRO-2190)', async () => {
    const cases = [
      'See [[a|b]] with an alias.\n',
      'See [[a#h]] with a heading.\n',
      'See [[a#^block]] with a block ref.\n',
      'Adjacent [[a]][[b]] links.\n',
      '**see [[a]]**\n',
      'Unicode [[Café Notes/Über plan]] with spaces.\n',
      'An unclosed [[ stays literal.\n',
    ]
    for (const md of cases) expect(await roundTrip(md)).toBe(md)
  })
})
