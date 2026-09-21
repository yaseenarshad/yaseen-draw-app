/**
 * `comments/markdown.ts` (YAZ-1472): a comment body is GitHub-flavoured Markdown rendered
 * read-only — `marked` with `breaks` on, then DOMPurify's html profile with every form control
 * forbidden on top (a task box is drawn as a glyph). These pin what the pair ACTUALLY emits and
 * what the folded row's one-line summary strips.
 */
import { describe, expect, it } from 'vitest'
import { commentHtml, commentInlineHtml, commentSplit, commentSummary } from './markdown'

describe('commentHtml — GitHub-flavoured Markdown', () => {
  it('headings', () => {
    expect(commentHtml('# Title\n\n## Sub')).toBe('<h1>Title</h1>\n<h2>Sub</h2>\n')
  })

  it('emphasis and strikethrough', () => {
    expect(commentHtml('*em* **strong** ~~gone~~')).toBe('<p><em>em</em> <strong>strong</strong> <del>gone</del></p>\n')
  })

  it('a list', () => {
    expect(commentHtml('- a\n- b')).toBe('<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n')
  })

  it('a task list draws its boxes as glyphs — no <input> ever reaches the page', () => {
    expect(commentHtml('- [x] done\n- [ ] todo')).toBe('<ul>\n<li>☑ done</li>\n<li>☐ todo</li>\n</ul>\n')
  })

  it('no form control survives: input, select, textarea and button are all stripped, their text kept', () => {
    for (const [body, tag] of [
      ['<input type="text" value="x">text', '<input'],
      ['<select><option>a</option></select>text', '<select'],
      ['<textarea>t</textarea>text', '<textarea'],
      ['<button>b</button>text', '<button'],
    ]) {
      const html = commentHtml(body)
      expect(html).not.toContain(tag)
      expect(html).toContain('text')
    }
  })

  it('a GFM table', () => {
    expect(commentHtml('| a | b |\n|---|---|\n| 1 | 2 |')).toBe(
      '<table>\n<thead>\n<tr>\n<th>a</th>\n<th>b</th>\n</tr>\n</thead>\n<tbody><tr>\n<td>1</td>\n<td>2</td>\n</tr>\n</tbody></table>\n',
    )
  })

  it('a fenced code block keeps its language class', () => {
    expect(commentHtml('```js\nlet x = 1\n```')).toBe('<pre><code class="language-js">let x = 1\n</code></pre>\n')
  })

  it('a blockquote', () => {
    expect(commentHtml('> quote')).toBe('<blockquote>\n<p>quote</p>\n</blockquote>\n')
  })

  it('a link', () => {
    expect(commentHtml('[site](https://example.com)')).toBe('<p><a href="https://example.com">site</a></p>\n')
  })
})

describe('commentHtml — line breaks', () => {
  it('a single newline is a <br>, the way a typed comment reads', () => {
    expect(commentHtml('one\ntwo')).toBe('<p>one<br>two</p>\n')
  })

  it('a blank line starts a new paragraph', () => {
    expect(commentHtml('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>\n')
  })
})

describe('commentHtml — sanitised', () => {
  it.each([
    ['<script>', 'hi <script>alert(1)</script> there', '<script', '<p>hi  there</p>\n'],
    ['an onerror= handler', '<img src=x onerror=alert(1)>', 'onerror', '<img src="x">'],
    ['a javascript: href', '[x](javascript:alert(1))', 'javascript:', '<p><a>x</a></p>\n'],
    ['<style>', '<style>p{}</style>text', '<style', 'text'],
    ['<form> (its content stays)', '<form>x</form>text', '<form', 'xtext'],
    ['<iframe>', '<iframe src="https://x"></iframe>text', '<iframe', 'text'],
  ])('strips %s', (_label, body, forbidden, expected) => {
    const html = commentHtml(body)
    expect(html).not.toContain(forbidden)
    expect(html).toBe(expected)
  })

  it('keeps a raw <a href="https://…">', () => {
    expect(commentHtml('<a href="https://example.com">site</a>')).toBe('<p><a href="https://example.com">site</a></p>\n')
  })
})

describe('commentSplit — the header line and what sits below it (🔒 D16)', () => {
  it('a one-liner is all header: an empty rest, with or without a trailing newline', () => {
    expect(commentSplit('plain text')).toEqual({ summary: 'plain text', rest: '' })
    expect(commentSplit('plain text\n')).toEqual({ summary: 'plain text', rest: '' })
  })

  it('multi-line: the first line minus its marker is the summary, the rest follows verbatim', () => {
    expect(commentSplit('- first\nsecond\nthird')).toEqual({ summary: 'first', rest: 'second\nthird' })
  })

  it('leading blank lines are skipped ahead of the summary and dropped from the rest', () => {
    expect(commentSplit('\n\n  \nfirst\n\n\nsecond')).toEqual({ summary: 'first', rest: 'second' })
  })

  it('a heading first line: the heading text is the summary, the body sits below it', () => {
    expect(commentSplit('# Heading\nBody')).toEqual({ summary: 'Heading', rest: 'Body' })
  })

  it('nothing but blanks → empty on both sides', () => {
    expect(commentSplit('')).toEqual({ summary: '', rest: '' })
    expect(commentSplit(' \n ')).toEqual({ summary: '', rest: '' })
  })

  it('commentSummary is the split’s summary', () => {
    expect(commentSummary('# Heading\nBody')).toBe(commentSplit('# Heading\nBody').summary)
  })
})

describe('commentSummary — the folded row', () => {
  it.each([
    ['# Heading', 'Heading'],
    ['- [ ] task', 'task'],
    ['1) item', 'item'],
    ['> quote', 'quote'],
    ['\n\n  \nplain after blanks\nsecond line', 'plain after blanks'],
    ['plain text', 'plain text'],
  ])('%j → %j', (body, summary) => {
    expect(commentSummary(body)).toBe(summary)
  })
})

describe('commentInlineHtml — the header row of a title-less comment', () => {
  it('renders inline Markdown without a paragraph around it, sanitised the same way', () => {
    expect(commentInlineHtml('**bold** and `code` and [site](https://example.com)')).toBe('<strong>bold</strong> and <code>code</code> and <a href="https://example.com">site</a>')
    expect(commentInlineHtml('plain <script>alert(1)</script> text')).toBe('plain  text')
  })
})
