/**
 * The Drawing slash-menu item (YAZ-877): where it lands on Crepe's own menu, and what its
 * `onRun` does — clear the typed `/query` the way every stock item does, then insert the
 * embed as PLAIN TEXT once the sidecar exists. The builder is stubbed (Crepe exports neither
 * `GroupBuilder` nor its config types); `featureConfig.test.ts` pins the real wiring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ctx } from '@milkdown/kit/ctx'
import { commandsCtx, editorViewCtx } from '@milkdown/kit/core'
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark'
import { drawingEmbed, drawingMenu, type SlashMenuBuilder } from './drawingMenu'

type Item = { label: string; icon: string; onRun?: (ctx: Ctx) => void }

/** Records what `buildMenu` appends, and to which of Crepe's stock groups. */
function stubBuilder() {
  const added: { group: string; key: string; item: Item }[] = []
  const builder: SlashMenuBuilder = {
    getGroup: (group) => ({ addItem: (key, item) => added.push({ group, key, item: item as Item }) }),
  }
  return { builder, added }
}

/** A ctx serving just the two slices `onRun` reads, over a fake view whose dispatches are recorded. */
function stubCtx() {
  const call = vi.fn()
  const dispatch = vi.fn()
  const tr = { insertText: vi.fn((text: string) => ({ inserted: text })) }
  const view = { state: { tr }, dispatch }
  const ctx = {
    get: (slice: unknown) => {
      if (slice === commandsCtx) return { call }
      if (slice === editorViewCtx) return view
      throw new Error('unexpected slice')
    },
  } as unknown as Ctx
  return { ctx, call, dispatch, tr }
}

beforeEach(() => vi.clearAllMocks())

describe('drawingMenu', () => {
  it('appends one "Drawing" row to Crepe\'s stock advanced group', () => {
    const { builder, added } = stubBuilder()
    drawingMenu({ create: vi.fn() })(builder)
    expect(added).toHaveLength(1)
    expect(added[0].group).toBe('advanced')
    expect(added[0].key).toBe('drawing')
    expect(added[0].item.label).toBe('Drawing')
    expect(added[0].item.icon).toContain('<svg')
  })

  it('clears the typed /query first (the stock items\' own opening move), then inserts the embed as plain text', async () => {
    const { builder, added } = stubBuilder()
    const create = vi.fn().mockResolvedValue('Drawing 2026-08-25 20.31.02.excalidraw')
    drawingMenu({ create })(builder)
    const { ctx, call, dispatch, tr } = stubCtx()

    added[0].item.onRun?.(ctx)
    // Synchronous half: the query text goes before anything is written.
    expect(call).toHaveBeenCalledWith(clearTextInCurrentBlockCommand.key)
    expect(dispatch).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledTimes(1)
    expect(tr.insertText).toHaveBeenCalledWith('![[Drawing 2026-08-25 20.31.02.excalidraw]]')
    expect(drawingEmbed('x.excalidraw')).toBe('![[x.excalidraw]]')
  })

  it('a failed create inserts nothing and goes to the notice path, never a throw', async () => {
    const { builder, added } = stubBuilder()
    const onNotice = vi.fn()
    drawingMenu({ create: vi.fn().mockRejectedValue(new Error('read-only volume')), onNotice })(builder)
    const { ctx, dispatch } = stubCtx()

    added[0].item.onRun?.(ctx)
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith("Can't create a drawing: read-only volume"))
    expect(dispatch).not.toHaveBeenCalled()
  })
})
