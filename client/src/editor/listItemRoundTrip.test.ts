/**
 * Mixed-marker siblings (GRO-2112): `-`, `*` and `+` are the same bullet. `unifySiblingMarkers`
 * runs on load (inside `normalizeEmptyItems`) so CommonMark's "marker change = new list" never
 * splits an indent level into sibling lists. Pure-function tests; the editor-level proof lives
 * in guideLines.test.ts ('mixed markers').
 */
import { describe, expect, it } from 'vitest'
import {
  escapeSameLineOrderedMarkers,
  normalizeEmptyItems,
  restoreSameLineOrderedMarkers,
  separateEmptyNestedItems,
  unifySiblingMarkers,
} from './listItemRoundTrip'

describe('same-line numeric bullet text (YAZ-1329)', () => {
  it('armors immediate `6)` / `6.` text after a bullet marker, at every indent', () => {
    expect(escapeSameLineOrderedMarkers('- 6) Paid\n  * 7. Lead\n\t+ 8) Deep\n')).toBe(
      '- 6\\) Paid\n  * 7\\. Lead\n\t+ 8\\) Deep\n',
    )
  })

  it('restores the source spelling on save and is idempotent in both directions', () => {
    const source = '* 1) one\n* 2. two\n'
    const armored = '* 1\\) one\n* 2\\. two\n'
    expect(escapeSameLineOrderedMarkers(source)).toBe(armored)
    expect(escapeSameLineOrderedMarkers(armored)).toBe(armored)
    expect(restoreSameLineOrderedMarkers(armored)).toBe(source)
    expect(restoreSameLineOrderedMarkers(source)).toBe(source)
  })

  it('handles a delimiter-only item and preserves CRLF line endings', () => {
    expect(escapeSameLineOrderedMarkers('- 1)\r\n* 2.\r\n')).toBe('- 1\\)\r\n* 2\\.\r\n')
  })

  it('does not reinterpret real ordered lists, decimals, prose, or fenced examples', () => {
    const markdown = [
      '1. real ordered item',
      '- 6.5 hours',
      'Paragraph 7) stays prose',
      '```md',
      '- 8) example in a fence',
      '```',
      '',
    ].join('\n')
    expect(escapeSameLineOrderedMarkers(markdown)).toBe(markdown)
  })

  it('keeps nested, tilde, and longer fenced examples byte-identical', () => {
    const markdown = '* Parent\n  ~~~~md\n  - 8) tilde example\n  ~~~~\n    `````\n    * 9. deep example\n    `````\n'
    expect(escapeSameLineOrderedMarkers(markdown)).toBe(markdown)
    expect(restoreSameLineOrderedMarkers(markdown)).toBe(markdown)
  })
})

describe('unifySiblingMarkers (GRO-2112)', () => {
  it('gives a sibling the marker of the previous bullet at its indent', () => {
    expect(unifySiblingMarkers('* a\n- b\n+ c\n')).toBe('* a\n* b\n* c\n')
    expect(unifySiblingMarkers('- a\n* b\n')).toBe('- a\n- b\n')
  })

  it('works per indent level, tabs counting as 4 spaces', () => {
    expect(unifySiblingMarkers('* p\n\t- c1\n\t* c2\n\t\t* g1\n\t\t- g2\n')).toBe('* p\n\t- c1\n\t- c2\n\t\t* g1\n\t\t* g2\n')
    expect(unifySiblingMarkers('* p\n    - c1\n\t* c2\n')).toBe('* p\n    - c1\n\t- c2\n')
  })

  it('forgets deeper indents after a shallower bullet and resets on a blank line', () => {
    // `- y` is the first bullet of q's NEW nested list: it keeps its own marker.
    expect(unifySiblingMarkers('* p\n  * x\n* q\n  - y\n')).toBe('* p\n  * x\n* q\n  - y\n')
    expect(unifySiblingMarkers('* a\n\n- b\n')).toBe('* a\n\n- b\n')
    // Lazy continuation: no blank line → `lazy` belongs to `a`, so `b` is still a's sibling.
    expect(unifySiblingMarkers('* a\nlazy text\n- b\n')).toBe('* a\nlazy text\n* b\n')
  })

  it('treats bare empty markers as bullets and never touches thematic breaks', () => {
    expect(unifySiblingMarkers('*\n- b\n')).toBe('*\n* b\n')
    expect(unifySiblingMarkers('- <br />\n* b\n')).toBe('- <br />\n- b\n')
    expect(unifySiblingMarkers('* a\n- - -\n* b\n')).toBe('* a\n- - -\n* b\n')
    expect(unifySiblingMarkers('* a\n  - - -\n  * b\n')).toBe('* a\n  - - -\n  * b\n')
    // The break itself is untouched; `b` inheriting `*` is harmless — remark ends the list at `***` anyway.
    expect(unifySiblingMarkers('* a\n***\n- b\n')).toBe('* a\n***\n* b\n')
  })

  it('leaves ordered lists, fenced code and non-list text alone', () => {
    // Ordered lines are not bullets: they neither take nor give a marker; `- y` / `- b` still
    // follow the bullets at their indent (CommonMark splits the lists around `1.` regardless).
    expect(unifySiblingMarkers('* a\n  1. x\n  - y\n- b\n')).toBe('* a\n  1. x\n  - y\n* b\n')
    const fenced = '* a\n```md\n- not a bullet\n* nor this\n```\n- b\n'
    expect(unifySiblingMarkers(fenced)).toBe('* a\n```md\n- not a bullet\n* nor this\n```\n* b\n')
    expect(unifySiblingMarkers('*emphasis* not a bullet\n-- dashes\n')).toBe('*emphasis* not a bullet\n-- dashes\n')
  })

  it('is idempotent and composed into normalizeEmptyItems', () => {
    const once = unifySiblingMarkers('* a\n- b\n')
    expect(unifySiblingMarkers(once)).toBe(once)
    expect(normalizeEmptyItems('* a\n- b\n- [ ]\n')).toBe('* a\n* b\n* [ ] <br />\n')
  })
})

describe('separateEmptyNestedItems (YAZ-1357)', () => {
  it('is idempotent and leaves fenced code alone', () => {
    const once = separateEmptyNestedItems('* a\n  *\n  * d\n')
    expect(once).toBe('* a\n\n  *\n  * d\n')
    expect(separateEmptyNestedItems(once)).toBe(once)
    const fenced = '```\n* a\n  *\n```\n* b\n  *\n'
    expect(separateEmptyNestedItems(fenced)).toBe('```\n* a\n  *\n```\n* b\n\n  *\n')
  })
  it('only fires for a DEEPER bare marker on the very next line', () => {
    expect(separateEmptyNestedItems('* a\n*\n')).toBe('* a\n*\n')
    expect(separateEmptyNestedItems('  * a\n*\n')).toBe('  * a\n*\n')
    expect(separateEmptyNestedItems('* a\n  * b\n')).toBe('* a\n  * b\n')
    expect(separateEmptyNestedItems('*\n  *\n')).toBe('*\n  *\n')
  })
})

describe('normalizeEmptyItems runs the blank-line pass LAST (YAZ-1357)', () => {
  it('mixed markers are unified before the blank line resets their memory', () => {
    expect(normalizeEmptyItems('- a\n  *\n* b\n')).toBe('- a\n\n  *\n- b\n')
  })
})
