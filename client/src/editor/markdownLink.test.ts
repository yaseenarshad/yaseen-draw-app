/**
 * Standard Markdown link interactions (YAZ-1309) against a real Crepe editor. Opening is a
 * host-owned side effect; edit/remove use Crepe's own link-tooltip API so there is one link
 * editor and one serializer. Right-click menus belong to the exact retained editor instance.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import type { MarkdownLinkNav } from './markdownLink'

const mounted: Array<{ crepe: ReturnType<typeof createCrepe>; root: HTMLElement }> = []

async function mount(markdown = '[Example](https://example.com)\n', overrides: Partial<MarkdownLinkNav> = {}) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const nav: MarkdownLinkNav = {
    open: vi.fn().mockResolvedValue(undefined),
    copy: vi.fn().mockResolvedValue(undefined),
    onNotice: vi.fn(),
    ...overrides,
  }
  const crepe = createCrepe({ root, defaultValue: markdown, markdownLinkNav: nav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, nav, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await item.crepe.destroy()
    item.root.remove()
  }
})

const anchorOf = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('a')!
const popupOf = (view: EditorView) => view.dom.parentElement!.querySelector<HTMLElement>('.ctx-menu--editor')
const rowsOf = (view: EditorView) => Array.from(popupOf(view)!.querySelectorAll<HTMLButtonElement>('.ctx-menu__item'))

function mouse(target: Element, type: 'mousedown' | 'contextmenu', init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: 10, ...init })
  target.dispatchEvent(event)
  return event
}

describe('primary click', () => {
  it('opens the href immediately, prevents caret placement, and does not change Markdown', async () => {
    const { crepe, nav, root } = await mount()
    const event = mouse(anchorOf(root), 'mousedown', { button: 0 })

    expect(event.defaultPrevented).toBe(true)
    expect(nav.open).toHaveBeenCalledWith('https://example.com')
    expect(getMarkdownForSave(crepe)).toBe('[Example](https://example.com)\n')
  })

  it('opens the whole logical link from a formatted segment that ProseMirror renders separately', async () => {
    const { nav, root } = await mount('[**Bold** label](relative/file.pdf)\n')
    const formattedSegment = Array.from(root.querySelectorAll('a')).find((anchor) => anchor.textContent === 'Bold')
    expect(formattedSegment).toBeDefined()
    mouse(formattedSegment!, 'mousedown', { button: 0 })
    expect(nav.open).toHaveBeenCalledWith('relative/file.pdf')
  })

  it.each([
    ['fragment-only links', '[Section](#section)\n', { button: 0 }],
    ['middle clicks', '[Example](https://example.com)\n', { button: 1 }],
    ['modified clicks', '[Example](https://example.com)\n', { button: 0, shiftKey: true }],
  ])('leaves %s to the editor/browser', async (_name, markdown, init) => {
    const { nav, root } = await mount(markdown)
    const event = mouse(anchorOf(root), 'mousedown', init)
    expect(event.defaultPrevented).toBe(false)
    expect(nav.open).not.toHaveBeenCalled()
  })

  it('reports an open failure passively', async () => {
    const open = vi.fn().mockRejectedValue(new Error('no handler'))
    const onNotice = vi.fn()
    const { root } = await mount(undefined, { open, onNotice })
    mouse(anchorOf(root), 'mousedown', { button: 0 })
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not open link: no handler'))
  })

  it('reports a synchronous host failure passively too', async () => {
    const open = vi.fn(() => {
      throw new Error('bridge unavailable')
    })
    const onNotice = vi.fn()
    const { root } = await mount(undefined, { open, onNotice })
    expect(() => mouse(anchorOf(root), 'mousedown', { button: 0 })).not.toThrow()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not open link: bridge unavailable'))
  })
})

describe('right-click menu', () => {
  it('replaces the native menu with exactly Edit, Copy, and Remove', async () => {
    const { root, view } = await mount()
    const event = mouse(anchorOf(root), 'contextmenu', { button: 2 })

    expect(event.defaultPrevented).toBe(true)
    expect(rowsOf(view).map((row) => row.textContent)).toEqual(['Edit link', 'Copy link', 'Remove link'])
  })

  it('Edit link opens Crepe\'s existing editor with the current href', async () => {
    const { root, view } = await mount()
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowsOf(view)[0]!.click()
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('.milkdown-link-edit input')?.value).toBe('https://example.com'))
  })

  it('Copy link copies only the href and keeps Markdown byte-identical', async () => {
    const copy = vi.fn().mockResolvedValue(undefined)
    const { crepe, root, view } = await mount(undefined, { copy })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowsOf(view)[1]!.click()
    expect(copy).toHaveBeenCalledWith('https://example.com')
    expect(getMarkdownForSave(crepe)).toBe('[Example](https://example.com)\n')
  })

  it('reports a copy failure passively', async () => {
    const copy = vi.fn().mockRejectedValue(new Error('clipboard denied'))
    const onNotice = vi.fn()
    const { root, view } = await mount(undefined, { copy, onNotice })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowsOf(view)[1]!.click()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not copy link: clipboard denied'))
  })

  it('reports a synchronous clipboard failure passively too', async () => {
    const copy = vi.fn(() => {
      throw new Error('clipboard unavailable')
    })
    const onNotice = vi.fn()
    const { root, view } = await mount(undefined, { copy, onNotice })
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    expect(() => rowsOf(view)[1]!.click()).not.toThrow()
    await vi.waitFor(() => expect(onNotice).toHaveBeenCalledWith('Could not copy link: clipboard unavailable'))
  })

  it('Remove link removes only the mark and preserves formatted label content', async () => {
    const { crepe, root, view } = await mount('[**Bold** label](https://example.com)\n')
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    rowsOf(view)[2]!.click()
    expect(getMarkdownForSave(crepe)).toBe('**Bold** label\n')
  })

  it.each([
    ['outside mousedown', () => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))],
    ['Escape', () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['scroll', () => document.body.dispatchEvent(new Event('scroll', { bubbles: true }))],
    ['blur', () => window.dispatchEvent(new Event('blur'))],
  ])('closes on %s', async (_name, dismiss) => {
    const { root, view } = await mount()
    mouse(anchorOf(root), 'contextmenu', { button: 2 })
    dismiss()
    expect(popupOf(view)).toBeNull()
  })
})

describe('ownership and cleanup', () => {
  it('opens a menu only in the retained editor that owns the anchor', async () => {
    const first = await mount('[First](https://first.example)\n')
    const second = await mount('[Second](https://second.example)\n')
    mouse(anchorOf(second.root), 'contextmenu', { button: 2 })
    expect(popupOf(first.view)).toBeNull()
    expect(popupOf(second.view)).not.toBeNull()
  })

  it('removes its popup and listeners when the editor is destroyed', async () => {
    const { crepe, root, view } = await mount()
    const parent = view.dom.parentElement!
    const anchor = anchorOf(root)
    mouse(anchor, 'contextmenu', { button: 2 })
    await crepe.destroy()
    mounted.splice(0)
    expect(parent.querySelector('.ctx-menu--editor')).toBeNull()
    expect(mouse(anchor, 'contextmenu', { button: 2 }).defaultPrevented).toBe(false)
  })
})
