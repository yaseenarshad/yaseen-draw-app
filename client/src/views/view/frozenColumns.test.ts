import { describe, expect, it } from 'vitest'
import { frozenColumnCount } from './frozenColumns'

describe('frozenColumnCount', () => {
  it.each([undefined, null, '2', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -2])('treats %s as no frozen columns', (value) => {
    expect(frozenColumnCount(value, 4)).toBe(0)
  })

  it('truncates fractions and clamps the result to the visible column count', () => {
    expect(frozenColumnCount(2.9, 4)).toBe(2)
    expect(frozenColumnCount(8, 4)).toBe(4)
    expect(frozenColumnCount(2, 0)).toBe(0)
  })
})
