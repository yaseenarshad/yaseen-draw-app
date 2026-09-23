import { describe, expect, it } from 'vitest'
import { changesScene, compareBoards, hasChanges, MARK, type CompareEngine } from './compare'

const el = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, version: 1, isDeleted: false, ...over })

describe('compareBoards', () => {
  it('sorts every shape into added, changed or removed since the chosen version', () => {
    const then = [el('same'), el('moved'), el('gone'), el('tomb')]
    const now = [el('same'), el('moved', { x: 5, version: 2 }), el('tomb', { isDeleted: true }), el('new')]
    const c = compareBoards(then, now)
    expect(c.added.map((e) => e.id)).toEqual(['new'])
    expect(c.changed.map((e) => e.id)).toEqual(['moved'])
    expect(c.removed.map((e) => e.id).sort()).toEqual(['gone', 'tomb'])
  })

  it('a tombstone brought back is an addition; identical boards have no changes', () => {
    expect(compareBoards([el('a', { isDeleted: true })], [el('a')]).added).toHaveLength(1)
    const c = compareBoards([el('a')], [el('a')])
    expect(hasChanges(c)).toBe(false)
  })
})

describe('changesScene', () => {
  const engine: CompareEngine = {
    getCommonBounds: ((els: Array<{ x: number; y: number; width: number; height: number }>) => {
      const e = els[0]
      return [e.x, e.y, e.x + e.width, e.y + e.height]
    }) as never,
    restoreElements: ((els: unknown[]) => els) as never,
  }

  it('draws removed shapes faded underneath, the board now, and one coloured outline per mark on top', () => {
    const then = [el('gone', { x: 100 }), el('moved')]
    const now = [el('moved', { x: 5, version: 2 }), el('new', { x: 50 })]
    const scene = changesScene(engine, now, compareBoards(then, now)) as Array<Record<string, unknown>>
    expect(scene.map((e) => e.id)).toEqual(['gone', 'moved', 'new', 'yaz-mark-new', 'yaz-mark-moved', 'yaz-mark-gone'])
    expect(scene[0]).toMatchObject({ opacity: 30, strokeColor: MARK.removed })
    expect(scene.find((e) => e.id === 'yaz-mark-new')).toMatchObject({ strokeColor: MARK.added, x: 42, y: -8, width: 26, height: 26, strokeStyle: 'solid' })
    expect(scene.find((e) => e.id === 'yaz-mark-moved')).toMatchObject({ strokeColor: MARK.changed })
    expect(scene.find((e) => e.id === 'yaz-mark-gone')).toMatchObject({ strokeColor: MARK.removed, strokeStyle: 'dashed' })
  })

  it('text inside a marked box gets no outline of its own', () => {
    const now = [el('card'), el('label', { type: 'text', containerId: 'card' })]
    const scene = changesScene(engine, now, compareBoards([], now)) as Array<Record<string, unknown>>
    expect(scene.map((e) => e.id).filter((id) => String(id).startsWith('yaz-mark'))).toEqual(['yaz-mark-card'])
  })
})
