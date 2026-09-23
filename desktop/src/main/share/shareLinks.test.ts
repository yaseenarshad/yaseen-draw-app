import { describe, expect, it } from 'vitest'
import { mergeSharesFile } from './shareLinks'

const rec = (id: string, updatedAt: number) => ({ id, allowDownload: true, sharedAt: 1, updatedAt })
const file = (shares: Record<string, unknown>) => `${JSON.stringify({ version: 1, shares }, null, 2)}\n`
const merged = (base: string | null, theirs: string, mine: string) => JSON.parse(mergeSharesFile(base, theirs, mine) ?? 'null').shares

describe('mergeSharesFile (YAZ-1897)', () => {
  it('keeps a board shared on either machine, and a removal made on one', () => {
    const base = file({ gone: rec('g', 1), kept: rec('k', 1) })
    expect(merged(base, file({ kept: rec('k', 1), sam: rec('s', 2) }), file({ gone: rec('g', 1), kept: rec('k', 1), me: rec('m', 3) }))).toEqual({ kept: rec('k', 1), sam: rec('s', 2), me: rec('m', 3) })
  })

  it('a record both changed keeps the newer upload; a record beats a removal', () => {
    const base = file({ a: rec('a', 1), b: rec('b', 1) })
    expect(merged(base, file({ a: rec('a', 5) }), file({ a: rec('a', 9), b: rec('b', 2) }))).toEqual({ a: rec('a', 9), b: rec('b', 2) })
  })

  it('merges two files both machines created, and refuses what is not JSON', () => {
    expect(merged(null, file({ t: rec('t', 1) }), file({ m: rec('m', 1) }))).toEqual({ t: rec('t', 1), m: rec('m', 1) })
    expect(mergeSharesFile(null, '{', file({}))).toBeNull()
  })
})
