import { describe, expect, it } from 'vitest'
import { matchCandidates } from './matchCandidates'

/** The one matcher behind ⌘K, the vault switcher, settings search and the Components tab. */
const rows = (...names: string[]) => names.map((name) => ({ name }))
const names = (matched: { name: string }[]) => matched.map((m) => m.name)

describe('matchCandidates', () => {
  it('ranks exact, then prefix, then substring — and keeps input order inside each band', () => {
    const got = matchCandidates(rows('Roadmap notes', 'Plan', 'Planning', 'A plan of sorts', 'plan'), 'plan', 10)
    expect(names(got)).toEqual(['Plan', 'plan', 'Planning', 'A plan of sorts'])
  })

  it('is case-insensitive on both sides and ignores surrounding whitespace in the query', () => {
    expect(names(matchCandidates(rows('README'), '  readme  ', 10))).toEqual(['README'])
    expect(names(matchCandidates(rows('readme'), 'README', 10))).toEqual(['readme'])
  })

  it('drops everything the query does not appear in', () => {
    expect(matchCandidates(rows('alpha', 'beta'), 'zzz', 10)).toEqual([])
  })

  it('an empty query matches everything, in input order', () => {
    expect(names(matchCandidates(rows('b', 'a'), '', 10))).toEqual(['b', 'a'])
  })

  it('caps AFTER ranking, so a better match is never lost to a worse one', () => {
    const got = matchCandidates(rows('xxplan', 'Plan'), 'plan', 1)
    expect(names(got)).toEqual(['Plan'])
  })

  it('a cap of 0 or less returns nothing', () => {
    expect(matchCandidates(rows('Plan'), 'plan', 0)).toEqual([])
  })

  it('prefers the precomputed `lower` when a row carries one', () => {
    const got = matchCandidates([{ name: 'Whatever', lower: 'plan' }], 'plan', 10)
    expect(names(got)).toEqual(['Whatever'])
  })
})
