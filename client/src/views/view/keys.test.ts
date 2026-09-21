import { describe, expect, it } from 'vitest'
import { canonicalKey } from './keys'

/**
 * The one key-canonicalisation rule (GRO-2135). What used to stand here — the whole Filter
 * builder's rule ↔ expression round trip — went with the Filter menu in YAZ-846; see the
 * tombstone at the top of `keys.ts`.
 */
describe('canonicalKey', () => {
  it('prefixes bare keys only', () => {
    expect(canonicalKey('x')).toBe('note.x')
    expect(canonicalKey('note.x')).toBe('note.x')
    expect(canonicalKey('file.name')).toBe('file.name')
    expect(canonicalKey('formula.f')).toBe('formula.f')
  })
})
