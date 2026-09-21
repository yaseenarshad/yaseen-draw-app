/**
 * List node helpers (YAZ-1709): an image bullet's label is its alt text — width stripped, src as
 * the fallback — so fold keys, zoom keys and breadcrumbs give it an identity of its own instead of
 * "Untitled item"; and `findOwnImages` yields item-relative offsets that resolve straight to the
 * image nodes (`doc.nodeAt(itemPos + 1 + offset)`), ignoring images inside nested lists — those
 * belong to the child items. Real parser through `createCrepe`, so the offsets are the schema's.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { Node as ProseNode } from '@milkdown/kit/prose/model'
import { createCrepe } from '../createCrepe'
import { findOwnImages, itemLabelText } from './listNodes'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function docOf(markdown: string): Promise<ProseNode> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx).state.doc)
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Every list_item with its document position, in document order. */
const items = (doc: ProseNode): { item: ProseNode; itemPos: number }[] => {
  const found: { item: ProseNode; itemPos: number }[] = []
  doc.descendants((node, pos) => {
    if (node.type.name === 'list_item') found.push({ item: node, itemPos: pos })
    return true
  })
  return found
}

const srcsOf = (doc: ProseNode, itemPos: number, own: { offset: number }[]) =>
  own.map(({ offset }) => doc.nodeAt(itemPos + 1 + offset)?.attrs.src as string)

describe('itemLabelText', () => {
  it('an image bullet is labelled by its alt text, width stripped', async () => {
    const doc = await docOf('* ![Shot|400](a.png)\n')
    expect(itemLabelText(items(doc)[0].item)).toBe('Shot')
  })

  it('an empty alt falls back to the src; text beside an image concatenates; a text bullet is unchanged', async () => {
    const doc = await docOf('* ![](a.png)\n* Before ![Shot](a.png) after\n* Plain\n')
    const [empty, mixed, plain] = items(doc)
    expect(itemLabelText(empty.item)).toBe('a.png')
    expect(itemLabelText(mixed.item)).toBe('Before Shot after')
    expect(itemLabelText(plain.item)).toBe('Plain')
  })
})

describe('findOwnImages', () => {
  it('each entry is the image node plus an offset that resolves back to it through itemPos + 1 + offset', async () => {
    const doc = await docOf('* One ![A](a.png) two ![B](b.png)\n')
    const { item, itemPos } = items(doc)[0]
    const own = findOwnImages(item)
    expect(own).toHaveLength(2)
    for (const { node, offset } of own) {
      expect(node.type.name).toBe('image')
      expect(doc.nodeAt(itemPos + 1 + offset)).toBe(node)
    }
    expect(srcsOf(doc, itemPos, own)).toEqual(['a.png', 'b.png'])
  })

  it("ignores images inside nested lists — those are the child items' own; a text leaf has none", async () => {
    const doc = await docOf('* ![P](p.png)\n  * ![N](n.png)\n* Text\n')
    const [parent, child, leaf] = items(doc)
    expect(srcsOf(doc, parent.itemPos, findOwnImages(parent.item))).toEqual(['p.png'])
    expect(srcsOf(doc, child.itemPos, findOwnImages(child.item))).toEqual(['n.png'])
    expect(findOwnImages(leaf.item)).toEqual([])
  })
})
