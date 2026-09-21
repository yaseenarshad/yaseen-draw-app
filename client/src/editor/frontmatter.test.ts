import { describe, it, expect } from 'vitest'
import { splitFrontmatter } from '@shared/frontmatter'

describe('frontmatter split/join', () => {
  it('returns body unchanged when no frontmatter', () => {
    const md = '# Hi\n\n---\n\nnot frontmatter\n'
    const r = splitFrontmatter(md)
    expect(r.frontmatter).toBe('')
    expect(r.body).toBe(md)
  })

  it('splits a YAML block and re-joins byte-identically', () => {
    const fm = '---\ntitle: X\ntags: [a, b]\n---\n'
    const body = '# Hi\n\ntext\n'
    const r = splitFrontmatter(fm + body)
    expect(r.frontmatter).toBe(fm)
    expect(r.body).toBe(body)
    expect(r.frontmatter + r.body).toBe(fm + body)
  })

  it('handles CRLF and `...` terminator', () => {
    const fm = '---\r\na: 1\r\n...\r\n'
    const r = splitFrontmatter(fm + 'body')
    expect(r.frontmatter).toBe(fm)
    expect(r.body).toBe('body')
  })

  it('does not treat an unterminated block as frontmatter', () => {
    const md = '---\na: 1\nno end'
    expect(splitFrontmatter(md).frontmatter).toBe('')
  })

  it('recognises an empty block (GRO-2216)', () => {
    const r = splitFrontmatter('---\n---\nbody')
    expect(r.frontmatter).toBe('---\n---\n')
    expect(r.body).toBe('body')
  })

  it('recognises an empty CRLF block (GRO-2216)', () => {
    const r = splitFrontmatter('---\r\n---\r\nbody')
    expect(r.frontmatter).toBe('---\r\n---\r\n')
    expect(r.body).toBe('body')
  })

  it('recognises an empty block with no body (GRO-2216)', () => {
    const r = splitFrontmatter('---\n---\n')
    expect(r.frontmatter).toBe('---\n---\n')
    expect(r.body).toBe('')
  })
})
