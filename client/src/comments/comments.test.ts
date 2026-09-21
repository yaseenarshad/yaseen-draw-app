/**
 * `shared/comments.ts` (YAZ-1472): a note's comment stream lives under the reserved frontmatter
 * key `comments` as a FLAT list of maps — a reply carries `reply_to`, one level deep. Every
 * mutation goes through `setFrontmatterProperty`, so the rest of the block and the body survive
 * byte-for-byte; unknown keys on an entry and unknown entries in the list are carried over, never
 * rebuilt from a typed subset. Lives under client/src so vitest collects it; the module is shared.
 */
import { describe, expect, it } from 'vitest'
import {
  COMMENTS_KEY,
  CommentsShapeError,
  addComment,
  commentsShape,
  deleteComment,
  editComment,
  newCommentId,
  nowIso,
  readComments,
  threadsOf,
  type PageComment,
} from '@shared/comments'

/** The schema from the brief, verbatim — the round-trip target. */
const NOTE = `---
title: Funnel
comments:
  - id: 3f9a1c2e
    at: 2026-09-11T18:22:31Z
    body: Reworked the funnel numbers, need to re-check churn.
  - id: 8b02d7e4
    at: 2026-09-11T19:05:10Z
    reply_to: 3f9a1c2e
    edited: 2026-09-11T19:40:02Z
    body: |-
      Checked. Churn was a double count.
      Fixed in the table.
---

# Funnel

Some body text with a stray \`---\` below.

---
`

const BODY = NOTE.slice(NOTE.indexOf('\n---\n\n') + 5)

const at = (n: number): string => `2026-09-11T2${n}:00:00Z`

describe('readComments', () => {
  it('round-trips the schema, sorted by `at`', () => {
    expect(readComments(NOTE)).toEqual([
      { id: '3f9a1c2e', at: '2026-09-11T18:22:31Z', body: 'Reworked the funnel numbers, need to re-check churn.' },
      {
        id: '8b02d7e4',
        at: '2026-09-11T19:05:10Z',
        reply_to: '3f9a1c2e',
        edited: '2026-09-11T19:40:02Z',
        body: 'Checked. Churn was a double count.\nFixed in the table.',
      },
    ])
  })

  it('sorts by `at` ascending, stable for equal stamps', () => {
    const content = `---\ncomments:\n  - {id: b, at: "${at(2)}", body: B}\n  - {id: c, at: "${at(1)}", body: C}\n  - {id: a, at: "${at(1)}", body: A}\n---\n`
    expect(readComments(content).map((c) => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('keeps unknown keys on an entry', () => {
    const content = `---\ncomments:\n  - {id: a, at: "${at(1)}", body: A, mood: happy, pinned: true}\n---\n`
    expect(readComments(content)).toEqual([{ id: 'a', at: at(1), body: 'A', mood: 'happy', pinned: true }])
  })

  it('skips entries that are not maps or lack string id/at/body; an EMPTY body still counts', () => {
    const content = `---\ncomments:\n  - plain string\n  - 42\n  - {id: 1, at: "${at(1)}", body: A}\n  - {id: a, at: "${at(1)}"}\n  - {id: e, at: "${at(2)}", body: ""}\n  - {id: r, at: "${at(3)}", body: R, reply_to: 7}\n---\n`
    expect(readComments(content)).toEqual([{ id: 'e', at: at(2), body: '' }])
  })

  it('no key, null, a non-list value or a broken block → []', () => {
    expect(readComments('---\ntitle: x\n---\nbody\n')).toEqual([])
    expect(readComments('---\ncomments:\n---\n')).toEqual([])
    expect(readComments('---\ncomments: "my note"\n---\n')).toEqual([])
    expect(readComments('---\ncomments: [unclosed\n---\n')).toEqual([])
    expect(readComments('no frontmatter at all\n')).toEqual([])
  })
})

describe('commentsShape', () => {
  it('names the four shapes', () => {
    expect(commentsShape('body only\n')).toBe('absent')
    expect(commentsShape('---\ntitle: x\n---\n')).toBe('absent')
    expect(commentsShape('---\ncomments:\n---\n')).toBe('absent')
    expect(commentsShape('---\ncomments: []\n---\n')).toBe('list')
    expect(commentsShape(NOTE)).toBe('list')
    expect(commentsShape('---\ncomments: "my note"\n---\n')).toBe('foreign')
    expect(commentsShape('---\ncomments: {a: 1}\n---\n')).toBe('foreign')
    expect(commentsShape('---\ncomments: [unclosed\n---\n')).toBe('invalid')
    expect(commentsShape('---\n- not a map\n---\n')).toBe('invalid')
  })
})

describe('addComment', () => {
  it('grows a note with no frontmatter into the schema, body untouched', () => {
    const out = addComment('# Funnel\n\nText.\n', 'First!  \n\n', { id: '3f9a1c2e', at: '2026-09-11T18:22:31Z' })
    expect(out).toBe('---\ncomments:\n  - id: 3f9a1c2e\n    n: 1\n    at: 2026-09-11T18:22:31Z\n    body: First!\n---\n# Funnel\n\nText.\n')
  })

  it('appends; a multi-line body serialises as a block scalar; other keys and the body are byte-identical', () => {
    const out = addComment(NOTE, 'Line one\nLine two', { id: 'c0ffee00', at: '2026-09-11T20:00:00Z' })
    expect(out).toBe(
      NOTE.replace(
        '      Fixed in the table.\n---\n',
        '      Fixed in the table.\n  - id: c0ffee00\n    n: 1\n    at: 2026-09-11T20:00:00Z\n    body: |-\n      Line one\n      Line two\n---\n',
      ),
    )
    expect(out.endsWith(BODY)).toBe(true)
    expect(out).toContain('title: Funnel\n')
  })

  it('a reply carries `reply_to`; a reply to a REPLY is filed under the top-level parent', () => {
    const direct = addComment(NOTE, 'Direct', { id: 'd1', at: at(1), replyTo: '3f9a1c2e' })
    expect(readComments(direct).at(-1)).toEqual({ id: 'd1', n: 1, at: at(1), reply_to: '3f9a1c2e', body: 'Direct' })
    const nested = addComment(NOTE, 'Nested', { id: 'n1', at: at(1), replyTo: '8b02d7e4' })
    expect(readComments(nested).at(-1)).toEqual({ id: 'n1', n: 1, at: at(1), reply_to: '3f9a1c2e', body: 'Nested' })
    // The key order on disk is the schema's: id, n, at, reply_to, body.
    expect(nested).toContain('  - id: n1\n    n: 1\n    at: 2026-09-11T21:00:00Z\n    reply_to: 3f9a1c2e\n    body: Nested\n')
  })

  it('keeps unknown entries and unknown keys', () => {
    const content = `---\ncomments:\n  - just a string\n  - id: a\n    at: ${at(1)}\n    body: A\n    mood: happy\n    pinned: true\n---\n`
    const out = addComment(content, 'B', { id: 'b', at: at(2) })
    expect(out).toBe(`---\ncomments:\n  - just a string\n  - id: a\n    at: ${at(1)}\n    body: A\n    mood: happy\n    pinned: true\n  - id: b\n    n: 1\n    at: ${at(2)}\n    body: B\n---\n`)
  })

  it('refuses to touch a foreign value or a block that does not parse', () => {
    expect(() => addComment('---\ncomments: "my note"\n---\n', 'B', { id: 'b', at: at(1) })).toThrow(CommentsShapeError)
    expect(() => addComment('---\ncomments: "my note"\n---\n', 'B', { id: 'b', at: at(1) })).toThrow(/foreign/)
    expect(() => addComment('---\ncomments: [unclosed\n---\n', 'B', { id: 'b', at: at(1) })).toThrow(/invalid/)
  })
})

describe('editComment', () => {
  it('replaces the body and stamps `edited` BEFORE the body; unknown keys stay', () => {
    const content = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    body: A\n    mood: happy\n---\n`
    expect(editComment(content, 'a', 'A2\n', at(2), '')).toBe(
      `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    mood: happy\n    edited: ${at(2)}\n    body: A2\n---\n`,
    )
  })

  it('re-stamps an existing `edited` in place', () => {
    const out = editComment(NOTE, '8b02d7e4', 'Again', at(3), '')
    expect(out).toContain(`    reply_to: 3f9a1c2e\n    edited: ${at(3)}\n    body: Again\n---\n`)
  })

  it('an unknown id leaves the content unchanged', () => {
    expect(editComment(NOTE, 'nope', 'X', at(1), '')).toBe(NOTE)
  })

  it('refuses foreign and invalid shapes', () => {
    expect(() => editComment('---\ncomments: 1\n---\n', 'a', 'X', at(1), '')).toThrow(CommentsShapeError)
    expect(() => editComment('---\ncomments: [unclosed\n---\n', 'a', 'X', at(1), '')).toThrow(CommentsShapeError)
  })
})

describe('deleteComment', () => {
  it('removes the entry and every reply to it', () => {
    const withReply = addComment(NOTE, 'Third', { id: 't3', at: at(1) })
    const out = deleteComment(withReply, '3f9a1c2e')
    expect(readComments(out).map((c) => c.id)).toEqual(['t3'])
    expect(out).toBe(`---\ntitle: Funnel\ncomments:\n  - id: t3\n    n: 1\n    at: ${at(1)}\n    body: Third\n---\n${BODY}`)
  })

  it('deleting the last comment deletes the KEY, never leaving `comments: []`', () => {
    const out = deleteComment(deleteComment(NOTE, '8b02d7e4'), '3f9a1c2e')
    expect(out).toBe(`---\ntitle: Funnel\n---\n${BODY}`)
    expect(out).not.toContain(COMMENTS_KEY)
  })

  it('unknown entries are not "last": they keep the key alive', () => {
    const content = `---\ncomments:\n  - just a string\n  - {id: a, at: "${at(1)}", body: A}\n---\n`
    expect(deleteComment(content, 'a')).toBe('---\ncomments:\n  - just a string\n---\n')
  })

  it('an unknown id leaves the content unchanged; foreign and invalid shapes throw', () => {
    expect(deleteComment(NOTE, 'nope')).toBe(NOTE)
    expect(() => deleteComment('---\ncomments: "my note"\n---\n', 'a')).toThrow(CommentsShapeError)
    expect(() => deleteComment('---\ncomments: [unclosed\n---\n', 'a')).toThrow(CommentsShapeError)
  })
})

describe('threadsOf', () => {
  const c = (id: string, n: number, reply_to?: string): PageComment => (reply_to === undefined ? { id, at: at(n), body: id } : { id, at: at(n), body: id, reply_to })

  it('groups replies under their top-level parent, in time order', () => {
    const threads = threadsOf([c('a', 1), c('r1', 2, 'a'), c('b', 3), c('r2', 4, 'a')])
    expect(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([
      ['a', ['r1', 'r2']],
      ['b', []],
    ])
  })

  it('an orphan reply (parent missing) surfaces at top level, in time order', () => {
    const threads = threadsOf([c('a', 1), c('orphan', 2, 'gone'), c('b', 3)])
    expect(threads.map((t) => t.comment.id)).toEqual(['a', 'orphan', 'b'])
  })

  it('a reply to a reply (hand-edited) lands under the root; a `reply_to` cycle never loops', () => {
    const deep = threadsOf([c('a', 1), c('r', 2, 'a'), c('rr', 3, 'r')])
    expect(deep.map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([['a', ['r', 'rr']]])
    const cycle = threadsOf([c('x', 1, 'y'), c('y', 2, 'x'), c('z', 3)])
    expect(cycle.map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([
      ['x', ['y']],
      ['z', []],
    ])
  })
})

describe('ids and stamps', () => {
  it('newCommentId is 8 hex chars, fresh each time', () => {
    const a = newCommentId()
    expect(a).toMatch(/^[0-9a-f]{8}$/)
    expect(newCommentId()).not.toBe(a)
  })

  it('nowIso is ISO UTC at seconds precision', () => {
    expect(nowIso(Date.UTC(2026, 8, 11, 18, 22, 31, 987))).toBe('2026-09-11T18:22:31Z')
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('title and by (🔒 D3, D7, D11)', () => {
  it('a title lands between `at` and `body`; blank means no key at all', () => {
    const titled = addComment(NOTE, 'Body', { id: 't1', at: at(1), title: '  Funnel  ' })
    expect(titled).toContain(`  - id: t1\n    n: 1\n    at: ${at(1)}\n    title: Funnel\n    body: Body\n---\n`)
    expect(readComments(titled).at(-1)).toEqual({ id: 't1', n: 1, at: at(1), title: 'Funnel', body: 'Body' })
    const blank = addComment(NOTE, 'Body', { id: 't2', at: at(1), title: '   ' })
    expect(blank).toContain(`  - id: t2\n    n: 1\n    at: ${at(1)}\n    body: Body\n---\n`)
  })

  it('a titled reply keeps the order id, n, at, reply_to, title, body', () => {
    const out = addComment(NOTE, 'R', { id: 'r1', at: at(1), replyTo: '3f9a1c2e', title: 'Re' })
    expect(out).toContain(`  - id: r1\n    n: 1\n    at: ${at(1)}\n    reply_to: 3f9a1c2e\n    title: Re\n    body: R\n---\n`)
  })

  it('edit sets, replaces or (blank) removes the title, always ahead of `edited` and `body`', () => {
    const plain = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    body: A\n---\n`
    expect(editComment(plain, 'a', 'A', at(2), 'T')).toBe(`---\ncomments:\n  - id: a\n    at: ${at(1)}\n    title: T\n    edited: ${at(2)}\n    body: A\n---\n`)
    const titled = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    title: Old\n    body: A\n---\n`
    expect(editComment(titled, 'a', 'A', at(2), 'New')).toContain(`    title: New\n    edited: ${at(2)}\n    body: A\n`)
    expect(editComment(titled, 'a', 'A', at(2), '')).toBe(`---\ncomments:\n  - id: a\n    at: ${at(1)}\n    edited: ${at(2)}\n    body: A\n---\n`)
      })

  it('`by` is the writer\'s own key: it rides through edit and delete untouched, in its place', () => {
    const content = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    by: agent\n    body: A\n  - id: b\n    at: ${at(2)}\n    body: B\n---\n`
    expect(editComment(content, 'a', 'A2', at(3), 'T')).toContain(`  - id: a\n    at: ${at(1)}\n    by: agent\n    title: T\n    edited: ${at(3)}\n    body: A2\n`)
    expect(deleteComment(content, 'b')).toBe(`---\ncomments:\n  - id: a\n    at: ${at(1)}\n    by: agent\n    body: A\n---\n`)
    expect(readComments(content)[0]).toEqual({ id: 'a', at: at(1), by: 'agent', body: 'A' })
  })

  it('addComment writes `by` only when given — after `reply_to`, before `title` (YAZ-1617 D5)', () => {
    const base = `---\ncomments:\n  - id: p\n    n: 1\n    at: ${at(1)}\n    body: P\n---\n`
    expect(addComment(base, 'A', { id: 'a', at: at(2), by: 'agent', title: 'T' })).toBe(`${base.slice(0, -4)}  - id: a\n    n: 2\n    at: ${at(2)}\n    by: agent\n    title: T\n    body: A\n---\n`)
    expect(addComment(base, 'R', { id: 'r', at: at(2), replyTo: 'p', by: 'codex' })).toBe(`${base.slice(0, -4)}  - id: r\n    n: 1\n    at: ${at(2)}\n    reply_to: p\n    by: codex\n    body: R\n---\n`)
    expect(addComment(base, 'B', { id: 'b', at: at(2) })).not.toContain('by:')
  })

  it('the full schema keeps its key order through an edit: id, at, reply_to, by, title, edited, body', () => {
    const full = `---\ncomments:\n  - id: p\n    at: ${at(1)}\n    body: P\n  - id: r\n    at: ${at(2)}\n    reply_to: p\n    by: agent\n    title: T\n    edited: ${at(3)}\n    body: R\n---\n`
    expect(editComment(full, 'r', 'R2', at(4), 'T2')).toContain(
      `  - id: r\n    at: ${at(2)}\n    reply_to: p\n    by: agent\n    title: T2\n    edited: ${at(4)}\n    body: R2\n---\n`,
    )
  })
})

describe('bare optionals (a hand-written `title:` or `reply_to:` with nothing after it)', () => {
  it('a YAML null on an optional key reads as absent; the comment still counts and threads normally', () => {
    const content = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    title:\n    by:\n    body: A\n  - id: b\n    at: ${at(2)}\n    reply_to:\n    body: B\n---\n`
    expect(readComments(content)).toEqual([
      { id: 'a', at: at(1), body: 'A' },
      { id: 'b', at: at(2), body: 'B' },
    ])
    expect(threadsOf(readComments(content)).map((t) => t.comment.id)).toEqual(['a', 'b'])
    // The write path still carries the bare keys: they are the user's bytes.
    expect(deleteComment(content, 'b')).toContain('    title:')
  })
})

describe('numbers (🔒 D15): `n` is one past the highest in its run, never reassigned', () => {
  /** Stamps for a sequence longer than `at` can count: hour `i` on the 12th. */
  const stamp = (i: number): string => `2026-09-12T${String(i).padStart(2, '0')}:00:00Z`
  const numbered = (content: string): [string, number | undefined, string | null][] => readComments(content).map((c) => [c.id, c.n, c.reply_to ?? null])

  it('a top-level run counts 1, 2, 3; a delete leaves its gap and the next is one past the HIGHEST, not the count', () => {
    let c = addComment('# Note\n', 'A', { id: 'a', at: stamp(1) })
    c = addComment(c, 'B', { id: 'b', at: stamp(2) })
    c = addComment(c, 'C', { id: 'c', at: stamp(3) })
    expect(numbered(c)).toEqual([
      ['a', 1, null],
      ['b', 2, null],
      ['c', 3, null],
    ])
    c = deleteComment(c, 'b')
    expect(numbered(c)).toEqual([
      ['a', 1, null],
      ['c', 3, null],
    ])
    // Two comments remain, so "the count plus one" would hand out 3 again; the run says 4.
    c = addComment(c, 'D', { id: 'd', at: stamp(4) })
    expect(numbered(c)).toEqual([
      ['a', 1, null],
      ['c', 3, null],
      ['d', 4, null],
    ])
  })

  it('a reply run is per parent (`#3.1`, `#3.2` as n: 1, n: 2 with reply_to), independent of the top-level run and of other parents', () => {
    let c = addComment('# Note\n', 'P', { id: 'p', at: stamp(1) })
    c = addComment(c, 'Q', { id: 'q', at: stamp(2) })
    c = addComment(c, 'R1', { id: 'r1', at: stamp(3), replyTo: 'p' })
    // A reply to a reply files under the parent AND numbers in the parent's run.
    c = addComment(c, 'R2', { id: 'r2', at: stamp(4), replyTo: 'r1' })
    c = addComment(c, 'S1', { id: 's1', at: stamp(5), replyTo: 'q' })
    // The replies' numbers never bump the top-level run: T is 3, not 6.
    c = addComment(c, 'T', { id: 't', at: stamp(6) })
    expect(numbered(c)).toEqual([
      ['p', 1, null],
      ['q', 2, null],
      ['r1', 1, 'p'],
      ['r2', 2, 'p'],
      ['s1', 1, 'q'],
      ['t', 3, null],
    ])
    expect(c).toContain(`  - id: r2\n    n: 2\n    at: ${stamp(4)}\n    reply_to: p\n    body: R2\n`)
  })

  it('nextNumber ignores unnumbered comments and unknown entries: the run is the highest number anyone declared', () => {
    const content = `---\ncomments:\n  - just a string\n  - id: a\n    at: ${at(0)}\n    body: A\n  - id: b\n    n: 5\n    at: ${at(1)}\n    body: B\n  - id: r\n    n: 9\n    at: ${at(2)}\n    reply_to: b\n    body: R\n---\n`
    expect(readComments(addComment(content, 'C', { id: 'c', at: at(3) })).at(-1)).toMatchObject({ id: 'c', n: 6 })
    // An unnumbered parent still has a reply run of its own, from 1; a numbered one continues its run.
    expect(readComments(addComment(content, 'R', { id: 'ra', at: at(3), replyTo: 'a' })).at(-1)).toMatchObject({ id: 'ra', n: 1, reply_to: 'a' })
    expect(readComments(addComment(content, 'R', { id: 'rb', at: at(3), replyTo: 'b' })).at(-1)).toMatchObject({ id: 'rb', n: 10, reply_to: 'b' })
    // Nothing numbered at all → 1.
    const bare = `---\ncomments:\n  - id: a\n    at: ${at(1)}\n    body: A\n---\n`
    expect(readComments(addComment(bare, 'B', { id: 'b', at: at(2) })).at(-1)).toMatchObject({ id: 'b', n: 1 })
  })

  it('`n` rides through edit and delete untouched, in its place right after `id`', () => {
    const content = `---\ncomments:\n  - id: a\n    n: 1\n    at: ${at(1)}\n    body: A\n  - id: b\n    n: 2\n    at: ${at(2)}\n    body: B\n---\n`
    expect(editComment(content, 'a', 'A2', at(3), 'T')).toContain(`  - id: a\n    n: 1\n    at: ${at(1)}\n    title: T\n    edited: ${at(3)}\n    body: A2\n`)
    expect(deleteComment(content, 'a')).toBe(`---\ncomments:\n  - id: b\n    n: 2\n    at: ${at(2)}\n    body: B\n---\n`)
    expect(readComments(content).map((c) => c.n)).toEqual([1, 2])
  })

  it('a bare `n:` reads as absent and counts for nothing in the run; the bytes still ride along; a non-number `n` is not a comment', () => {
    const content = `---\ncomments:\n  - id: a\n    n:\n    at: ${at(1)}\n    body: A\n  - id: b\n    n: "3"\n    at: ${at(2)}\n    body: B\n---\n`
    expect(readComments(content)).toEqual([{ id: 'a', at: at(1), body: 'A' }])
    const out = addComment(content, 'C', { id: 'c', at: at(3) })
    expect(readComments(out).at(-1)).toMatchObject({ id: 'c', n: 1 })
    expect(out).toMatch(/^ {4}n:( null)?$/m)
    expect(out).toMatch(/^ {4}n: ["']3["']$/m)
  })

  it('a bare `reply_to:` reads as top level (the bare-optionals rule), so its number is in the top-level run', () => {
    const content = `---\ncomments:\n  - id: a\n    n: 3\n    at: ${at(1)}\n    reply_to:\n    body: A\n---\n`
    expect(readComments(addComment(content, 'B', { id: 'b', at: at(2) })).at(-1)).toMatchObject({ id: 'b', n: 4 })
  })
})
