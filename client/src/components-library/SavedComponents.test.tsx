/**
 * The Components tab (YAZ-1819). The bridge is stubbed at the client `api` seam and the engine's
 * element package at `loadExcalidrawElement`, like every other tab test in this repo — so what is
 * pinned here is the TAB's behaviour: what it asks main for, when Save selection is offered, that
 * search is the ⌘K matcher, that the page is 24, and that a delete asks first only when the
 * setting says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, type ComponentItem } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { components: { list: vi.fn(), save: vi.fn(), read: vi.fn(), rename: vi.fn(), delete: vi.fn(), preview: vi.fn(), onChanged: vi.fn() } },
}))
vi.mock('../drawings/engine', () => ({ loadExcalidrawElement: vi.fn() }))
vi.mock('../lib/storage', () => ({ storage: { getSettings: vi.fn(), subscribe: vi.fn() } }))

import { api } from '../api'
import { loadExcalidrawElement } from '../drawings/engine'
import { storage } from '../lib/storage'
import { clearComponentPreviewMemo, EMPTY_LIBRARY, PAGE_SIZE, SavedComponents } from './SavedComponents'
import type { ComponentElementApi, ComponentEngine, ComponentTarget } from './componentData'
import type { PreviewEngine } from './componentPreview'

const components = vi.mocked(api.components)
const loadElement = vi.mocked(loadExcalidrawElement)
const store = vi.mocked(storage)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const item = (over: Partial<ComponentItem> = {}): ComponentItem => ({ slug: 'a-card', name: 'A card', elementCount: 2, createdAt: 1, updatedAt: 1, ...over })
const rect = (id: string) => ({ id, type: 'rectangle' })

const element = {
  getSelectedElements: vi.fn(() => [rect('a'), rect('b')]),
  deepCopyElement: vi.fn((el: unknown) => ({ ...(el as object) })),
} as unknown as ComponentElementApi

const engine = {
  restoreElements: vi.fn((elements: unknown) => elements),
  exportToBlob: vi.fn(async () => new Blob([new Uint8Array(8)], { type: 'image/png' })),
} as unknown as ComponentEngine & PreviewEngine

function fakeCanvas() {
  const addFiles = vi.fn()
  const insertElements = vi.fn()
  return {
    addFiles,
    insertElements,
    api: {
      getAppState: () => ({ selectedElementIds: { a: true }, theme: 'light' }),
      getSceneElements: () => [rect('a'), rect('b')],
      getFiles: () => ({}),
      addFiles,
      insertElements,
    } as unknown as ComponentTarget,
  }
}

let root: Root | null = null
let container: HTMLElement | null = null

beforeEach(() => {
  clearComponentPreviewMemo()
  components.list.mockReset().mockResolvedValue([])
  components.save.mockReset().mockResolvedValue(item())
  components.read.mockReset().mockResolvedValue({ fragmentJson: JSON.stringify({ elements: [rect('a')], files: {} }) })
  components.rename.mockReset().mockResolvedValue(item())
  components.delete.mockReset().mockResolvedValue(undefined)
  components.preview.mockReset().mockResolvedValue('data:image/png;base64,AA==')
  components.onChanged.mockReset().mockReturnValue(() => undefined)
  loadElement.mockReset().mockResolvedValue(element as never)
  store.getSettings.mockReset().mockReturnValue(DEFAULT_SETTINGS)
  store.subscribe.mockReset().mockReturnValue(() => undefined)
  vi.mocked(engine.restoreElements).mockClear()
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

async function mount(props: Partial<Parameters<typeof SavedComponents>[0]> = {}) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const canvas = props.excalidrawAPI === undefined ? fakeCanvas() : { api: props.excalidrawAPI, addFiles: vi.fn(), insertElements: vi.fn() }
  await act(async () => {
    root?.render(<SavedComponents engine={engine} excalidrawAPI={canvas.api} hasSelection {...props} />)
  })
  return { el: container as HTMLElement, canvas }
}

const text = (el: HTMLElement) => el.textContent ?? ''
const button = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
/** Exactly this label; `Save` must never match `Save selection`. */
const byText = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)
/** The menu items carry a visually-hidden name after their verb (`Rename A card`). */
const byPrefix = (el: HTMLElement, label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(label))
/** A click, then everything it started: a save goes through FileReader, which settles on a task. */
const click = async (node: Element | null | undefined) => {
  await act(async () => node?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SavedComponents — the library', () => {
  it('lists on mount and says so when there is nothing yet', async () => {
    const { el } = await mount()
    expect(components.list).toHaveBeenCalledTimes(1)
    expect(text(el)).toContain(EMPTY_LIBRARY)
    expect(text(el)).toContain('0 saved components')
  })

  it('re-lists on `components:changed` — the push that makes ONE library out of every vault (🔒 D5)', async () => {
    const { el } = await mount()
    const refresh = components.onChanged.mock.calls[0][0]
    components.list.mockResolvedValue([item()])
    await act(async () => refresh())
    expect(text(el)).toContain('A card')
    expect(text(el)).toContain('1 saved component')
  })

  it('draws each card’s picture from `components:preview`, and asks for it ONCE', async () => {
    components.list.mockResolvedValue([item()])
    const { el } = await mount()
    expect(components.preview).toHaveBeenCalledExactlyOnceWith({ slug: 'a-card' })
    expect(el.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==')
  })

  it('a picture that cannot be read is a placeholder, never an error — the component still inserts', async () => {
    components.list.mockResolvedValue([item()])
    components.preview.mockRejectedValue(new Error('gone'))
    const { el } = await mount()
    expect(el.querySelector('.saved-components__placeholder')).not.toBe(null)
    expect(el.querySelector('[role="alert"]')).toBe(null)
    expect(button(el, 'Insert A card')?.disabled).toBe(false)
  })
})

describe('SavedComponents — search and paging', () => {
  const many = Array.from({ length: PAGE_SIZE + 5 }, (_, n) => item({ slug: `c-${n + 1}`, name: `Card ${n + 1}` }))

  it('shows one page of 24 and grows by another on Show more', async () => {
    components.list.mockResolvedValue(many)
    const { el } = await mount()
    expect(el.querySelectorAll('.saved-components__card')).toHaveLength(PAGE_SIZE)
    await click(byText(el, 'Show more'))
    expect(el.querySelectorAll('.saved-components__card')).toHaveLength(many.length)
    expect(byText(el, 'Show more')).toBeUndefined()
  })

  it('searches by NAME through the app’s one matcher, exact before prefix before substring', async () => {
    components.list.mockResolvedValue([item({ slug: 'a', name: 'Pricing table' }), item({ slug: 'b', name: 'Table' }), item({ slug: 'c', name: 'Timetable' })])
    const { el } = await mount()
    await type(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'table')
    // exact, then prefix (none here), then substring in the library's own order
    expect([...el.querySelectorAll('.saved-components__insert > span:last-child')].map((s) => s.textContent)).toEqual(['Table', 'Pricing table', 'Timetable'])
  })

  it('a search that matches nothing says which query it was', async () => {
    components.list.mockResolvedValue([item()])
    const { el } = await mount()
    await type(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'zzz')
    expect(text(el)).toContain('No components match “zzz”')
  })

  it('a fresh search starts again at the first page', async () => {
    components.list.mockResolvedValue(many)
    const { el } = await mount()
    await click(byText(el, 'Show more'))
    await type(el.querySelector<HTMLInputElement>('input[type="search"]')!, 'card')
    expect(el.querySelectorAll('.saved-components__card')).toHaveLength(PAGE_SIZE)
  })
})

describe('SavedComponents — saving the selection', () => {
  it('Save selection is off with no selection, and on with one', async () => {
    const withoutSelection = await mount({ hasSelection: false })
    expect(byText(withoutSelection.el, 'Save selection')?.disabled).toBe(true)
    act(() => root?.unmount())
    container?.remove()
    const { el } = await mount({ hasSelection: true })
    expect(byText(el, 'Save selection')?.disabled).toBe(false)
  })

  it('captures, asks for a name, and saves the fragment plus a PNG preview', async () => {
    const { el } = await mount()
    await click(byText(el, 'Save selection'))
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Component name"]')!, 'A card')
    expect(text(el)).toContain('Save 2 elements')
    await click(byText(el, 'Save 2 elements'))
    expect(components.save).toHaveBeenCalledExactlyOnceWith({
      name: 'A card',
      fragmentJson: expect.stringContaining('"type": "excalidraw"'),
      previewPng: expect.stringMatching(/^data:image\/png;base64,/),
    })
    // The new component is at the head of the grid without waiting for the push.
    expect(text(el)).toContain('A card')
  })

  it('a selection that cannot be a component says why, and asks for no name', async () => {
    vi.mocked(element.getSelectedElements).mockReturnValueOnce([{ id: 'a', type: 'embeddable' }] as never)
    const { el } = await mount()
    await click(byText(el, 'Save selection'))
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('do not support embeddable')
    expect(el.querySelector('input[aria-label="Component name"]')).toBe(null)
  })

  it('a refused save keeps the form up with the reason on it', async () => {
    components.save.mockRejectedValue(new Error("'name' must be a non-empty string"))
    const { el } = await mount()
    await click(byText(el, 'Save selection'))
    await type(el.querySelector<HTMLInputElement>('input[aria-label="Component name"]')!, 'A card')
    await click(byText(el, 'Save 2 elements'))
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('non-empty string')
    expect(el.querySelector('input[aria-label="Component name"]')).not.toBe(null)
  })

  it('Cancel drops the capture', async () => {
    const { el } = await mount()
    await click(byText(el, 'Save selection'))
    await click(byText(el, 'Cancel'))
    expect(el.querySelector('input[aria-label="Component name"]')).toBe(null)
    expect(components.save).not.toHaveBeenCalled()
  })
})

describe('SavedComponents — insert, rename, delete', () => {
  beforeEach(() => components.list.mockResolvedValue([item()]))

  it('insert reads the fragment and hands it to the engine’s own insert door', async () => {
    const { el, canvas } = await mount()
    await click(button(el, 'Insert A card'))
    expect(components.read).toHaveBeenCalledExactlyOnceWith({ slug: 'a-card' })
    expect(canvas.insertElements).toHaveBeenCalledWith([rect('a')])
  })

  it('insert TWICE is two calls through the same door — two independent copies', async () => {
    const { el, canvas } = await mount()
    await click(button(el, 'Insert A card'))
    await click(button(el, 'Insert A card'))
    expect(canvas.insertElements).toHaveBeenCalledTimes(2)
  })

  it('an insert that failed says so rather than silently doing nothing', async () => {
    components.read.mockRejectedValue(new Error('no such component'))
    const { el } = await mount()
    await click(button(el, 'Insert A card'))
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('no such component')
  })

  it('rename is a field in the card, not a native prompt', async () => {
    const { el } = await mount()
    await click(button(el, 'Options for A card'))
    await click(byPrefix(el, 'Rename'))
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Rename A card"]')
    expect(field).not.toBe(null)
    await type(field!, 'Renamed card')
    await click(byText(el, 'Save'))
    expect(components.rename).toHaveBeenCalledExactlyOnceWith({ slug: 'a-card', name: 'Renamed card' })
    expect(text(el)).toContain('Renamed card')
  })

  it('a rename to the same name, or to nothing, is not a write', async () => {
    const { el } = await mount()
    await click(button(el, 'Options for A card'))
    await click(byPrefix(el, 'Rename'))
    await click(byText(el, 'Save'))
    expect(components.rename).not.toHaveBeenCalled()
  })

  it('delete ASKS first while 🔒 confirmDelete is on, and removes both files on yes', async () => {
    const { el } = await mount()
    await click(button(el, 'Options for A card'))
    await click(byPrefix(el, 'Delete'))
    expect(el.querySelector('[role="alertdialog"]')?.textContent).toContain('Delete “A card”?')
    expect(components.delete).not.toHaveBeenCalled()
    await click(byText(el, 'Delete'))
    expect(components.delete).toHaveBeenCalledExactlyOnceWith({ slug: 'a-card' })
    expect(text(el)).toContain(EMPTY_LIBRARY)
  })

  it('Cancel on the confirm deletes nothing', async () => {
    const { el } = await mount()
    await click(button(el, 'Options for A card'))
    await click(byPrefix(el, 'Delete'))
    await click(byText(el, 'Cancel'))
    expect(components.delete).not.toHaveBeenCalled()
    expect(el.querySelector('[role="alertdialog"]')).toBe(null)
  })

  it('🔒 confirmDelete OFF deletes straight away — no sheet at all, the Sidebar’s own rule', async () => {
    store.getSettings.mockReturnValue({ ...DEFAULT_SETTINGS, confirmDelete: false })
    const { el } = await mount()
    await click(button(el, 'Options for A card'))
    await click(byPrefix(el, 'Delete'))
    expect(el.querySelector('[role="alertdialog"]')).toBe(null)
    expect(components.delete).toHaveBeenCalledExactlyOnceWith({ slug: 'a-card' })
  })
})

describe('SavedComponents — the canvas is not there yet', () => {
  it('says so, and offers neither Save selection nor an insert', async () => {
    components.list.mockResolvedValue([item()])
    const { el } = await mount({ excalidrawAPI: null })
    expect(text(el)).toContain('The canvas is still loading.')
    expect(byText(el, 'Save selection')?.disabled).toBe(true)
    expect(button(el, 'Insert A card')?.disabled).toBe(true)
  })
})
