import { describe, expect, it } from 'vitest'
import type { TreeNode } from './types'
import { dateOf, sortTree } from './treeSort'

const file = (name: string, over: Partial<Extract<TreeNode, { type: 'file' }>> = {}): TreeNode => ({ type: 'file', name, path: `/v/${name}`, size: 1, mtime: 10, kind: 'drawing', ...over })
const dir = (name: string, children: TreeNode[] = []): TreeNode => ({ type: 'dir', name, path: `/v/${name}`, children })
const names = (nodes: TreeNode[]) => nodes.map((n) => n.name)

// Three boards whose three orders all disagree, plus a legacy one with no block.
const apple = file('Apple.excalidraw', { meta: { createdAt: 400, updatedAt: 900 } })
const banana = file('Banana.excalidraw', { meta: { createdAt: 990, updatedAt: 991 } })
const cherry = file('Cherry.excalidraw', { meta: { createdAt: 300, updatedAt: 950 } })
const legacy = file('Legacy.excalidraw', { mtime: 960 })

describe('sortTree (🔒 YAZ-1835 D1/D2)', () => {
  it('name: case-insensitive, accents in place, folders first', () => {
    const out = sortTree([file('zebra.excalidraw'), file('Éclair.excalidraw'), dir('Zed'), file('big.excalidraw'), dir('alpha'), file('BIG 2.excalidraw')], 'name')
    // `localeCompare` puts the space before the dot: "BIG 2" before "big."; case is ignored, É sits with E.
    expect(names(out)).toEqual(['alpha', 'Zed', 'BIG 2.excalidraw', 'big.excalidraw', 'Éclair.excalidraw', 'zebra.excalidraw'])
  })

  it('the three orders disagree, and a legacy board sorts by its mtime among the stamped ones', () => {
    const nodes = [apple, banana, cherry, legacy]
    expect(names(sortTree(nodes, 'name'))).toEqual(['Apple.excalidraw', 'Banana.excalidraw', 'Cherry.excalidraw', 'Legacy.excalidraw'])
    expect(names(sortTree(nodes, 'updated'))).toEqual(['Banana.excalidraw', 'Legacy.excalidraw', 'Cherry.excalidraw', 'Apple.excalidraw'])
    expect(names(sortTree(nodes, 'created'))).toEqual(['Banana.excalidraw', 'Legacy.excalidraw', 'Apple.excalidraw', 'Cherry.excalidraw'])
  })

  it('folders always lead and are always by name, whatever the order; their children follow the order', () => {
    const nodes = [file('z.excalidraw', { meta: { createdAt: 1, updatedAt: 1 } }), dir('Zed', [apple, banana]), dir('alpha', [cherry, legacy])]
    const out = sortTree(nodes, 'updated')
    expect(names(out)).toEqual(['alpha', 'Zed', 'z.excalidraw'])
    expect(names((out[0] as { children: TreeNode[] }).children)).toEqual(['Legacy.excalidraw', 'Cherry.excalidraw'])
    expect(names((out[1] as { children: TreeNode[] }).children)).toEqual(['Banana.excalidraw', 'Apple.excalidraw'])
  })

  it('the block beats the mtime; a tie on the date falls back to the name', () => {
    const cloned = file('Cloned.excalidraw', { mtime: 5000, meta: { createdAt: 100, updatedAt: 200 } })
    expect(names(sortTree([cloned, apple], 'updated'))).toEqual(['Apple.excalidraw', 'Cloned.excalidraw'])
    const t1 = file('Tie 1.excalidraw', { meta: { createdAt: 1, updatedAt: 500 } })
    const t2 = file('Tie 2.excalidraw', { meta: { createdAt: 2, updatedAt: 500 } })
    expect(names(sortTree([t2, t1], 'updated'))).toEqual(['Tie 1.excalidraw', 'Tie 2.excalidraw'])
  })

  it('never mutates the tree it was given', () => {
    const inner = [banana, apple]
    const nodes = [file('b.excalidraw'), dir('d', inner), file('a.excalidraw')]
    const before = JSON.stringify(nodes)
    sortTree(nodes, 'updated')
    sortTree(nodes, 'name')
    expect(JSON.stringify(nodes)).toBe(before)
    expect(inner[0]).toBe(banana)
  })

  it('dateOf: the block when it is there, the mtime when it is not', () => {
    expect(dateOf(apple as never, 'updated')).toBe(900)
    expect(dateOf(apple as never, 'created')).toBe(400)
    expect(dateOf(legacy as never, 'updated')).toBe(960)
    expect(dateOf(legacy as never, 'created')).toBe(960)
  })
})
