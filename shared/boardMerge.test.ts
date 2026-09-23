import { describe, expect, it } from 'vitest'
import { mergeBoards } from './boardMerge'

type El = Record<string, unknown> & { id: string }

/** A shape as the app saves one — only the fields the merge reads, plus a position to tell edits apart. */
const shape = (id: string, over: Partial<El> = {}): El => ({ id, type: 'rectangle', x: 0, index: `a${id}`, version: 1, versionNonce: 1, updated: 1000, isDeleted: false, boundElements: null, ...over })

/** An edit the way the engine makes one: moved, version bumped, `updated` stamped. */
const edit = (e: El, x: number, updated = num(e.updated) + 10): El => ({ ...e, x, version: num(e.version) + 1, updated })
const del = (e: El, updated = num(e.updated) + 10): El => ({ ...e, isDeleted: true, version: num(e.version) + 1, updated })
const num = (v: unknown): number => v as number

const board = (elements: El[], appState: Record<string, unknown> = { gridSize: 20 }): string =>
  `${JSON.stringify({ type: 'excalidraw', version: 2, source: 'yaseen-draw', elements, appState, files: {} }, null, 2)}\n`

function merge(base: El[], theirs: El[], mine: El[]) {
  const out = mergeBoards(board(base), board(theirs), board(mine))
  if (out === null) throw new Error('expected a merge')
  const doc = JSON.parse(out.json) as { elements: El[]; appState: Record<string, unknown> }
  return { ...out, doc, els: doc.elements, get: (id: string) => doc.elements.find((e) => e.id === id) }
}

const [r1, r2, r3] = [shape('1'), shape('2'), shape('3')]

describe('mergeBoards — per shape', () => {
  it('S1: different shapes edited on each side are both kept', () => {
    const m = merge([r1, r2], [edit(r1, 7), r2], [r1, edit(r2, 13)])
    expect(m.get('1')?.x).toBe(7)
    expect(m.get('2')?.x).toBe(13)
    expect(m.clashes).toBe(0)
  })

  it('S2: shapes added on both sides are both kept', () => {
    const m = merge([r1], [r1, shape('t')], [r1, shape('m')])
    expect(m.els.map((e) => e.id).sort()).toEqual(['1', 'm', 't'])
    expect(m.clashes).toBe(0)
  })

  it('S3: the same shape edited on both sides keeps the newest edit and counts a clash', () => {
    const m = merge([r1], [edit(r1, 7, 2000)], [edit(r1, 13, 1500)])
    expect(m.get('1')?.x).toBe(7)
    expect(m.clashes).toBe(1)
    expect(merge([r1], [edit(r1, 7, 1500)], [edit(r1, 13, 2000)]).get('1')?.x).toBe(13)
  })

  it('S3 tie-break: same `updated` → higher version, then lower versionNonce', () => {
    const t = { ...edit(r1, 7, 2000), version: 5 }
    const m = { ...edit(r1, 13, 2000), version: 3 }
    expect(merge([r1], [t], [m]).get('1')?.x).toBe(7)
    const t2 = { ...edit(r1, 7, 2000), versionNonce: 9 }
    const m2 = { ...edit(r1, 13, 2000), versionNonce: 4 }
    expect(merge([r1], [t2], [m2]).get('1')?.x).toBe(13)
  })

  it('S4: deleted on one side and edited on the other keeps the edit, whichever is newer', () => {
    expect(merge([r1], [del(r1, 9000)], [edit(r1, 13, 2000)]).get('1')).toMatchObject({ x: 13, isDeleted: false })
    expect(merge([r1], [edit(r1, 7, 2000)], [del(r1, 9000)]).get('1')).toMatchObject({ x: 7, isDeleted: false })
    // a shape REMOVED from a side (not a tombstone) is a delete too
    expect(merge([r1], [], [edit(r1, 13)]).get('1')?.x).toBe(13)
  })

  it('S5: deleted on one side and untouched on the other stays deleted', () => {
    expect(merge([r1, r2], [del(r1), r2], [r1, r2]).get('1')?.isDeleted).toBe(true)
    expect(merge([r1, r2], [r1, r2], [r1]).get('2')).toBeUndefined()
  })

  it('S6: deleted on both sides stays deleted and is not a clash', () => {
    const m = merge([r1], [del(r1, 2000)], [del(r1, 3000)])
    expect(m.get('1')?.isDeleted).toBe(true)
    expect(m.clashes).toBe(0)
    expect(merge([r1], [], [del(r1)]).get('1')?.isDeleted).toBe(true)
  })

  it('identical edits on both sides are one edit, not a clash', () => {
    const e = edit(r1, 7)
    const m = merge([r1], [e], [e])
    expect(m.get('1')?.x).toBe(7)
    expect(m.clashes).toBe(0)
  })

  it('S8: a clashing shape keeps both sides\' bindings, minus bound elements that are gone', () => {
    const arrowT = shape('at')
    const arrowM = shape('am')
    const gone = shape('g')
    const base = [r1, gone]
    const theirs = [{ ...edit(r1, 7, 3000), boundElements: [{ id: 'at', type: 'arrow' }, { id: 'g', type: 'arrow' }] }, arrowT, del(gone)]
    const mine = [{ ...edit(r1, 13, 2000), boundElements: [{ id: 'am', type: 'arrow' }] }, arrowM, gone]
    const m = merge(base, theirs, mine)
    expect(m.get('1')?.x).toBe(7)
    expect(m.get('1')?.boundElements).toEqual([
      { id: 'at', type: 'arrow' },
      { id: 'am', type: 'arrow' },
    ])
  })
})

describe('mergeBoards — the board around the shapes', () => {
  it('orders by fractional index, ties by id, so both machines write the same bytes', () => {
    const a = shape('b', { index: 'a5' })
    const c = shape('a', { index: 'a5' })
    const first = shape('z', { index: 'a0' })
    const m = merge([first], [first, a], [first, c])
    expect(m.els.map((e) => e.id)).toEqual(['z', 'a', 'b'])
    expect(mergeBoards(board([first]), board([first, c]), board([first, a]))?.json).toBe(m.json)
  })

  it('keeps the remote order for a board written before indices existed', () => {
    const [x, y] = [shape('x', { index: undefined }), shape('y', { index: undefined })]
    expect(merge([], [y], [x]).els.map((e) => e.id)).toEqual(['y', 'x'])
  })

  it('S7: board settings merge per key; ours wins a key both changed', () => {
    const out = mergeBoards(board([], { gridSize: 20, bg: '#fff', zoom: 1 }), board([], { gridSize: 40, bg: '#000', zoom: 1 }), board([], { gridSize: 20, bg: '#eee', zoom: 2 }))
    expect(JSON.parse(out?.json ?? '{}').appState).toEqual({ gridSize: 40, bg: '#eee', zoom: 2 })
  })

  it('writes the app\'s format: our top-level fields, 2-space JSON, trailing newline', () => {
    const out = mergeBoards(board([r1]), board([r1, r2]), board([r1, r3]))
    expect(out?.json.endsWith('}\n')).toBe(true)
    expect(Object.keys(JSON.parse(out?.json ?? '{}'))).toEqual(['type', 'version', 'source', 'elements', 'appState', 'files'])
    expect(out?.json).toBe(`${JSON.stringify(JSON.parse(out?.json ?? '{}'), null, 2)}\n`)
  })

  it('S15: refuses to merge anything that is not a scene', () => {
    expect(mergeBoards('not json', board([]), board([]))).toBeNull()
    expect(mergeBoards(board([]), '{"elements": 3}', board([]))).toBeNull()
    expect(mergeBoards(board([]), board([]), '{"elements": [{"noId": true}]}')).toBeNull()
  })
})
