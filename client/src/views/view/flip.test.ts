/**
 * FLIP core (YAZ-944): the measured half of the board's motion. `flipPlan` is pure — given the
 * card rectangles before and after a reflow it answers which cards MOVED (and by how much, for
 * the inverted transform) and which are NEW (they get the entrance animation instead). The DOM
 * choreography around it stays thin and is proven visually in the e2e evidence; the math is
 * what can quietly go wrong, so the math is what is pinned.
 */
import { describe, expect, it } from 'vitest'
import { flipPlan, flipRect, type FlipRect } from './flip'

const at = (x: number, y: number): FlipRect => ({ x, y })
const rects = (entries: Record<string, FlipRect>): Map<string, FlipRect> => new Map(Object.entries(entries))

describe('flipPlan', () => {
  it('a moved card gets the INVERTED delta (previous minus next) — the play-from position', () => {
    const plan = flipPlan(rects({ a: at(0, 0), b: at(0, 100) }), rects({ a: at(0, 100), b: at(0, 0) }))
    expect(plan.moves.get('a')).toEqual({ dx: 0, dy: -100 })
    expect(plan.moves.get('b')).toEqual({ dx: 0, dy: 100 })
    expect(plan.entered).toEqual([])
  })

  it('cross-column moves carry both axes', () => {
    const plan = flipPlan(rects({ a: at(0, 40) }), rects({ a: at(300, 80) }))
    expect(plan.moves.get('a')).toEqual({ dx: -300, dy: -40 })
  })

  it('sub-pixel jitter is NOT a move — nothing below one pixel animates', () => {
    const plan = flipPlan(rects({ a: at(0, 0) }), rects({ a: at(0.4, 0.4) }))
    expect(plan.moves.size).toBe(0)
  })

  it('a card only in the NEXT frame is entered, never moved; a card only in the PREVIOUS frame is neither', () => {
    const plan = flipPlan(rects({ gone: at(0, 0) }), rects({ fresh: at(0, 0) }))
    expect(plan.entered).toEqual(['fresh'])
    expect(plan.moves.size).toBe(0)
  })

  it('an unchanged board plans nothing at all', () => {
    const plan = flipPlan(rects({ a: at(10, 20) }), rects({ a: at(10, 20) }))
    expect(plan.moves.size).toBe(0)
    expect(plan.entered).toEqual([])
  })
})

/**
 * YAZ-1555: a scrolled board is NOT a moved board. Cards are measured in the FLIP root's content
 * space — the viewport rect minus the root's rect, plus the root's own scroll — so a scroll on the
 * root (sideways) or on an ancestor (the note, vertically) leaves every card's measurement
 * unchanged, and only a real reflow plans a move.
 */
describe('flipRect', () => {
  const origin = at(0, 0)

  it('the board scrolling sideways moves nothing — the root scroll cancels the viewport shift', () => {
    const before = flipRect(at(100, 50), origin, 0, 0)
    const after = flipRect(at(-200, 50), origin, 300, 0)
    expect(flipPlan(rects({ a: before }), rects({ a: after })).moves.size).toBe(0)
  })

  it('the note scrolling vertically moves nothing — the root itself moved with the card', () => {
    const before = flipRect(at(100, 50), origin, 0, 0)
    const after = flipRect(at(100, -350), at(0, -400), 0, 0)
    expect(flipPlan(rects({ a: before }), rects({ a: after })).moves.size).toBe(0)
  })

  it('a real cross-column move after a scroll still plans exactly that move', () => {
    const before = flipRect(at(100, 50), origin, 0, 0)
    const after = flipRect(at(100 - 300 + 260, 50 + 40), origin, 300, 0)
    expect(flipPlan(rects({ a: before }), rects({ a: after })).moves.get('a')).toEqual({ dx: -260, dy: -40 })
  })
})
