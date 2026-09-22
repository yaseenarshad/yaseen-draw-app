/**
 * The deck's rules (YAZ-1820). Pure: the element package's `newElementWith` is a stub, so what is
 * pinned here is the ORDERING — which frames are slides, how a file's claims are honoured, and
 * what a reorder writes back into `customData`.
 */
import { describe, expect, it, vi } from 'vitest'
import { findSlideIndexAtPoint, getOrderedPresentationFrames, getPresentationOrder, getTopLevelFrames, renamePresentationFrame, reorderPresentationFrames, type SlideElementApi } from './slides'

const frame = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'frame', frameId: null, name: null, x: 0, y: 0, width: 100, height: 100, ...over })
const ordered = (id: string, order: number, over: Record<string, unknown> = {}) => frame(id, { customData: { presentationOrder: order }, ...over })

/** The element package's own "copy with these fields"; here a spread, which is all these rules need. */
const element = { newElementWith: vi.fn((el: object, updates: object) => ({ ...el, ...updates })) } as unknown as SlideElementApi

const ids = (elements: readonly unknown[]) => getOrderedPresentationFrames(elements).map(({ frame: f, order }) => `${f.id}:${order}`)

describe('what counts as a slide', () => {
  it('is every LIVE, TOP-LEVEL frame, and nothing else', () => {
    const elements = [
      frame('a'),
      { id: 'r', type: 'rectangle' },
      frame('deleted', { isDeleted: true }),
      // A frame inside another frame is a shape in a slide, not a slide.
      frame('nested', { frameId: 'a' }),
      frame('b'),
    ]
    expect(getTopLevelFrames(elements).map(({ frame: f }) => f.id)).toEqual(['a', 'b'])
    expect(ids(elements)).toEqual(['a:1', 'b:2'])
  })

  it('a board with no frames is an empty deck', () => {
    expect(getOrderedPresentationFrames([{ id: 'r', type: 'rectangle' }])).toEqual([])
    expect(getOrderedPresentationFrames([])).toEqual([])
  })

  it('narrows the frame to what the panel and the camera use, whatever the file holds', () => {
    const [slide] = getOrderedPresentationFrames([frame('a', { name: 'Intro', x: 5, y: 6, width: 7, height: 8, extra: 'ignored' })])
    expect(slide).toEqual({ frame: { id: 'a', name: 'Intro', x: 5, y: 6, width: 7, height: 8 }, order: 1, sceneIndex: 0 })
  })
})

describe('getPresentationOrder — the two keys, root first', () => {
  it('reads customData.presentationOrder', () => {
    expect(getPresentationOrder(ordered('a', 3))).toBe(3)
  })

  it('falls back to the generated deck’s namespace (`customData.yaseenPresentation`)', () => {
    expect(getPresentationOrder(frame('a', { customData: { yaseenPresentation: { presentationOrder: 2 } } }))).toBe(2)
    // Root wins when both are there.
    expect(getPresentationOrder(frame('a', { customData: { presentationOrder: 1, yaseenPresentation: { presentationOrder: 9 } } }))).toBe(1)
  })

  it('is null for anything that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, '2', null, undefined, NaN]) expect(getPresentationOrder(frame('a', { customData: { presentationOrder: bad } }))).toBe(null)
    expect(getPresentationOrder(frame('a'))).toBe(null)
    expect(getPresentationOrder('not an element')).toBe(null)
  })
})

describe('the order is a REQUEST, not a guarantee', () => {
  it('honours every unambiguous claim', () => {
    expect(ids([ordered('a', 3), ordered('b', 1), ordered('c', 2)])).toEqual(['b:1', 'c:2', 'a:3'])
  })

  it('a slot two frames both claim is a claim neither can have — they fill the gaps in scene order', () => {
    expect(ids([ordered('a', 2), ordered('b', 2), ordered('c', 1)])).toEqual(['c:1', 'a:2', 'b:3'])
  })

  it('a claim out of range is no claim at all', () => {
    expect(ids([ordered('a', 9), ordered('b', 1)])).toEqual(['b:1', 'a:2'])
  })

  it('frames with no claim keep scene order, after the ones that have one', () => {
    expect(ids([frame('a'), ordered('b', 1), frame('c')])).toEqual(['b:1', 'a:2', 'c:3'])
  })

  it('always answers exactly the frames, numbered 1..n with no holes', () => {
    const elements = [ordered('a', 3), frame('b'), ordered('c', 3), ordered('d', 1)]
    expect(getOrderedPresentationFrames(elements).map(({ order }) => order)).toEqual([1, 2, 3, 4])
  })
})

describe('reorderPresentationFrames — the order goes back into the FILE', () => {
  it('writes presentationOrder into every top-level frame’s customData, and touches nothing else', () => {
    const rectangle = { id: 'r', type: 'rectangle' }
    const next = reorderPresentationFrames(element, [frame('a'), rectangle, frame('b')], ['b', 'a'])
    expect(next.map((el) => (el as { id: string }).id)).toEqual(['a', 'r', 'b'])
    expect((next[0] as { customData: unknown }).customData).toEqual({ presentationOrder: 2 })
    expect((next[2] as { customData: unknown }).customData).toEqual({ presentationOrder: 1 })
    // A non-frame is handed back by identity: a reorder is not a scene rewrite.
    expect(next[1]).toBe(rectangle)
    expect(ids(next)).toEqual(['b:1', 'a:2'])
  })

  it('keeps the rest of customData — a generated deck’s metadata survives a drag', () => {
    const next = reorderPresentationFrames(element, [frame('a', { customData: { yaseenPresentation: { slideId: 's1' }, mine: true } })], ['a'])
    expect((next[0] as { customData: unknown }).customData).toEqual({ yaseenPresentation: { slideId: 's1' }, mine: true, presentationOrder: 1 })
  })

  it('completes the request rather than trusting it: unknown ids dropped, duplicates taken once, forgotten frames kept at the end', () => {
    const next = reorderPresentationFrames(element, [frame('a'), frame('b'), frame('c')], ['c', 'c', 'ghost'])
    expect(ids(next)).toEqual(['c:1', 'a:2', 'b:3'])
  })

  it('a reorder of an empty list is a no-op ordering, not a crash', () => {
    expect(reorderPresentationFrames(element, [], ['a'])).toEqual([])
  })
})

describe('renamePresentationFrame', () => {
  it('renames exactly one frame and hands back the rest by identity', () => {
    const other = frame('b')
    const next = renamePresentationFrame(element, [frame('a'), other], 'a', 'Intro')
    expect((next[0] as { name: string }).name).toBe('Intro')
    expect(next[1]).toBe(other)
  })

  it('a rectangle that happens to share the id is not a slide', () => {
    const rectangle = { id: 'a', type: 'rectangle' }
    expect(renamePresentationFrame(element, [rectangle], 'a', 'Intro')[0]).toBe(rectangle)
  })
})

describe('findSlideIndexAtPoint — the double-click target', () => {
  const slides = getOrderedPresentationFrames([
    ordered('outer', 1, { x: 0, y: 0, width: 400, height: 400 }),
    ordered('inner', 2, { x: 10, y: 10, width: 50, height: 50 }),
  ])

  it('answers the INNERMOST slide under the point — a deck-overview frame is a real pattern', () => {
    expect(findSlideIndexAtPoint({ x: 20, y: 20 }, slides)).toBe(1)
    expect(findSlideIndexAtPoint({ x: 300, y: 300 }, slides)).toBe(0)
  })

  it('is null for a miss, and includes the bounds themselves', () => {
    expect(findSlideIndexAtPoint({ x: 500, y: 500 }, slides)).toBe(null)
    expect(findSlideIndexAtPoint({ x: 0, y: 0 }, slides)).toBe(0)
    expect(findSlideIndexAtPoint({ x: 400, y: 400 }, slides)).toBe(0)
    expect(findSlideIndexAtPoint({ x: 10, y: 10 }, slides)).toBe(1)
  })
})
