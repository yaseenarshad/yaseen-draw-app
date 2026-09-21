import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import type { IndexRecord, TreeNode } from '@shared/types'
import { buildViewOnlyCatalog } from '../links/viewOnlyCatalog'
import { createCrepe } from './createCrepe'
import { createViewOnlyLinkSource } from './wikilink/viewOnlyLinkSource'
import { createWikilinkResolveSource } from './wikilink/wikilinkPlugin'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const current = mounted.pop()
    if (current !== undefined) {
      await current.crepe.destroy()
      current.root.remove()
    }
  }
})

describe('createCrepe view-only source isolation (YAZ-1310)', () => {
  it('consults the separate source without replacing or extending semantic records/resolution', async () => {
    const record: IndexRecord = {
      path: '/vault/Home.md', name: 'Home.md', basename: 'Home', folder: '', ext: 'md',
      size: 1, ctime: 1, mtime: 1, properties: {}, aliases: [], tags: [], links: [], embeds: [],
    }
    const semantic = createWikilinkResolveSource()
    const resolve = (target: string) => target === 'Home' ? record.path : null
    semantic.update(resolve, [record])
    const recordsBefore = semantic.records
    const resolverBefore = semantic.resolve
    const viewOnly = createViewOnlyLinkSource()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const crepe = createCrepe({ root, defaultValue: '[[Home]] [[data.json]]\n', wikilinks: semantic, viewOnlyLinks: viewOnly })
    await crepe.create()
    mounted.push({ crepe, root })

    const node: TreeNode = { type: 'file', name: 'data.json', path: '/vault/data.json', kind: 'text', size: 1, mtime: 1 }
    viewOnly.update(buildViewOnlyCatalog('/vault', [node]))
    viewOnly.update(buildViewOnlyCatalog('/vault', []))

    expect(semantic.records).toBe(recordsBefore)
    expect(semantic.resolve).toBe(resolverBefore)
    expect(semantic.records).toEqual([record])
    expect(semantic.resolve?.('data.json')).toBeNull()
  })
})
