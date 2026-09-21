/**
 * Guard for the Crepe feature allowlist (GRO-2014): every `CrepeFeature` is classified exactly
 * once, and the editor `createCrepe()` actually builds loads exactly `ENABLED_FEATURES` —
 * flipping a feature anywhere else (e.g. in createCrepe.ts) turns this red.
 */
import { describe, expect, it, vi } from 'vitest'
import { CrepeFeature, useCrepeFeatures } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, type CreateCrepeOptions } from './createCrepe'
import { DISABLED_FEATURES, ENABLED_FEATURES, features } from './featureConfig'

const sorted = (xs: readonly string[]) => [...xs].sort()
const ALL_FEATURES = Object.values(CrepeFeature)

/**
 * A live editor plus the labels its BlockEdit slash menu offers. The menu mounts its Vue app
 * up front but only attaches on the first view update, so one empty transaction brings it into
 * the DOM — nothing about the document changes.
 */
async function mountedMenuItems(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ features: string[]; items: string[]; teardown: () => Promise<void> }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: '# x\n', ...opts })
  await crepe.create()
  const loaded = crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr)
    return useCrepeFeatures(ctx).get()
  })
  // The provider's first update is debounced (Crepe passes 20ms) — wait for the attach.
  const menu = await vi.waitFor(() => {
    const el = root.querySelector('.milkdown-slash-menu')
    if (el === null) throw new Error('slash menu never attached')
    return el
  })
  const items = [...menu.querySelectorAll('.menu-group li span')].map((el) => el.textContent ?? '')
  return {
    features: loaded,
    items,
    teardown: async () => {
      await crepe.destroy()
      root.remove()
    },
  }
}

describe('Crepe feature allowlist', () => {
  it('classifies every CrepeFeature exactly once', () => {
    expect(sorted([...ENABLED_FEATURES, ...DISABLED_FEATURES])).toEqual(sorted(ALL_FEATURES))
    expect(new Set([...ENABLED_FEATURES, ...DISABLED_FEATURES]).size).toBe(ALL_FEATURES.length)
  })

  it('keeps the explicit surface (ImageBlock, TopBar, AI off — and Latex, since YAZ-977: dollars are dollars)', () => {
    expect(ENABLED_FEATURES).toEqual([
      CrepeFeature.BlockEdit,
      CrepeFeature.CodeMirror,
      CrepeFeature.Cursor,
      CrepeFeature.LinkTooltip,
      CrepeFeature.ListItem,
      CrepeFeature.Placeholder,
      CrepeFeature.Table,
      CrepeFeature.Toolbar,
    ])
    expect(DISABLED_FEATURES).toEqual([CrepeFeature.ImageBlock, CrepeFeature.Latex, CrepeFeature.TopBar, CrepeFeature.AI])
    for (const f of ALL_FEATURES) expect(features[f]).toBe((ENABLED_FEATURES as readonly string[]).includes(f))
  })

  it('createCrepe() loads exactly the allowlisted features, with or without a Drawing menu extension', async () => {
    const plain = await mountedMenuItems({})
    expect(sorted(plain.features)).toEqual(sorted(ENABLED_FEATURES))
    await plain.teardown()
    // The Drawing config customises a feature, never the feature SET (YAZ-877).
    const withDrawing = await mountedMenuItems({ drawing: { create: vi.fn() } })
    expect(sorted(withDrawing.features)).toEqual(sorted(ENABLED_FEATURES))
    await withDrawing.teardown()
  })

  it('the Drawing row exists only when the host supplies a creator (YAZ-877)', async () => {
    const plain = await mountedMenuItems({})
    // Sanity: the stock menu is really being read (Image is off with ImageBlock, Table is on).
    expect(plain.items).toContain('Table')
    expect(plain.items).not.toContain('Drawing')
    expect(plain.items).not.toContain('Ordered List')
    await plain.teardown()

    const withDrawing = await mountedMenuItems({ drawing: { create: vi.fn() } })
    expect(withDrawing.items).toContain('Drawing')
    expect(withDrawing.items).not.toContain('Ordered List')
    // Appended to Crepe's own advanced group — the stock rows keep their order ahead of it.
    expect(withDrawing.items.indexOf('Drawing')).toBe(withDrawing.items.length - 1)
    expect(withDrawing.items.filter((l) => l === 'Drawing')).toHaveLength(1)
    await withDrawing.teardown()
  })
})
