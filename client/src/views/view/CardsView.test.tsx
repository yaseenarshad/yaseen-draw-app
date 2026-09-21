/**
 * Cards view (4E, GRO-2139): ViewsPane mounted with react-dom in jsdom; `type: cards` renders a
 * responsive grid — an optional cover from the view's `image` property (colour block / external
 * URL / local vault asset through `api.readAsset` → `data:` URL, mocked here; missing or failing
 * → neutral placeholder), `file.name` as the title button, then the other `order` properties as
 * typed label/value rows. Card width follows `cardSize` (Obsidian's numeric px, or the legacy
 * small/medium/large compatibility values — one shared mapping); `imageFit` / `imageAspectRatio`
 * land as CSS custom properties. Grouped results render 4C sections with the same persisted collapse state
 * as the table/board; search narrows cards and drops empty groups.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { type ParsedViews, parseViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** YAZ-846: `folderPage` is required — the contents block is the only mount there is. */
const FOLDER_PAGE = testFolderPage()

/** In-memory stand-in for the main-owned store: collapse state must go through here, not the file. */
const { groupStore } = vi.hoisted(() => ({ groupStore: new Map<string, string[]>() }))
vi.mock('../../lib/storage', () => ({
  storage: {
    getViewGroups: vi.fn((root: string, key: string) => groupStore.get(`${root}|${key}`) ?? []),
    setViewGroups: vi.fn((root: string, key: string, collapsed: readonly string[]) => {
      if (collapsed.length === 0) groupStore.delete(`${root}|${key}`)
      else groupStore.set(`${root}|${key}`, [...collapsed])
    }),
  },
}))

/** The bridge asset call, mocked per-ref: known refs answer a tiny png, everything else rejects NOT_FOUND. */
const { assetRefs } = vi.hoisted(() => ({ assetRefs: new Set<string>(['levels.png']) }))
vi.mock('../../api', () => ({
  api: {
    readAsset: vi.fn(async (_root: string, ref: string) => {
      if (!assetRefs.has(ref)) throw Object.assign(new Error('no asset with this name under the root'), { code: 'NOT_FOUND' })
      return { path: `/vault/${ref}`, mime: 'image/png', data: 'UE5H', size: 3 }
    }),
  },
}))

const CARDS_BASE = `views:
  - type: cards
    name: C
    order:
      - file.name
      - note.priority
      - note.tags
`

const GROUPED_BASE = `views:
  - type: cards
    name: C
    order:
      - file.name
      - note.priority
    groupBy:
      property: note.status
    summaries:
      note.priority: Sum
`

/** Five one-note records exercising every cover shape; based on the fixture's first record. */
const cover = (name: string, properties: Record<string, unknown>): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  folder: '',
  properties,
})
const COVER_RECORDS: IndexRecord[] = [
  cover('colour', { cover: '#ff0000' }),
  cover('remote', { cover: 'https://pics.test/cover.png' }),
  cover('local', { cover: '[[levels.png]]' }),
  cover('bare', {}),
  cover('broken', { cover: '[[missing.png]]' }),
]

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  const onOpenFile = vi.fn()
  const onChange = vi.fn((next: ParsedViews) => {
    parsed = next
  })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  draw = () =>
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parsed}
          onChange={onChange}
          root="/vault"
          thisFile="/vault/pillars.md"
          records={TEST_RECORDS}
          folderPage={FOLDER_PAGE}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el, onChange, onOpenFile }
}

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

afterEach(async () => {
  unmount()
  groupStore.clear()
  vi.clearAllMocks()
  const { _resetAssetCache } = await import('./CardsView')
  _resetAssetCache()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => (el as HTMLElement).click())
  draw()
}

/** Native prototype setter + bubbling event, so React's value tracker sees the change. */
function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

/** Flushes the async cover loads (readAsset microtasks) into the DOM. */
const settle = () => act(async () => {})

const cards = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-card')]
const cardOf = (el: ParentNode, title: string): HTMLElement => {
  const hit = cards(el).find((c) => c.querySelector('.view-card__title')?.textContent === title)
  if (hit === undefined) throw new Error(`no card titled ${title}`)
  return hit
}
const titles = (el: ParentNode): string[] => [...el.querySelectorAll('.view-card__title')].map((b) => b.textContent ?? '')
const sections = (el: ParentNode): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.view-cards__group')]
const headerTexts = (el: ParentNode): string[] => sections(el).map((s) => q(s, '.view-group__value').textContent ?? '')
const gridVar = (el: ParentNode, name: string): string => q<HTMLElement>(el, '.view-cards').style.getPropertyValue(name)
const toggleOf = (el: ParentNode, label: string): HTMLElement => byLabel(el, `Toggle group ${label}`)

// ---------- tests ----------

describe('grid', () => {
  it('renders one flat grid of cards — file name title over typed label/value rows; the title opens the note', () => {
    const { el, onOpenFile } = mount(CARDS_BASE)
    expect(el.querySelector('.view-cards__grid')).not.toBeNull()
    expect(el.querySelector('.view-cards__group')).toBeNull()
    expect(cards(el)).toHaveLength(8)
    const card = cardOf(el, 'Agentic Agency')
    expect([...card.querySelectorAll('.view-card__prop-name')].map((n) => n.textContent)).toEqual(['Priority', 'Tags'])
    expect([...card.querySelectorAll('.view-card__prop-value')][0].textContent).toBe('2')
    // list values render as chips, like table cells and board cards
    expect([...card.querySelectorAll('.view-table__chip')].map((c) => c.textContent)).toEqual(['agentic', 'pillar'])
    // a missing property keeps the label with an empty value
    const bare = cardOf(el, 'Attribution')
    expect([...bare.querySelectorAll('.view-card__prop-value')][0].textContent).toBe('Empty')
    click(q(card, '.view-card__title'))
    expect(onOpenFile).toHaveBeenCalledExactlyOnceWith('/vault/Content Pillars/1. Agentic Agency/Agentic Agency.md')
  })
})

describe('cardSize', () => {
  it('numeric px is honored; legacy values map through the shared widths; absent defaults to 280', () => {
    const { el } = mount(CARDS_BASE)
    expect(gridVar(el, '--view-card-w')).toBe('280px')
    unmount()
    const numeric = mount(CARDS_BASE.replace('name: C', 'name: C\n    cardSize: 200'))
    expect(gridVar(numeric.el, '--view-card-w')).toBe('200px')
    unmount()
    const belowBoardMinimum = mount(CARDS_BASE.replace('name: C', 'name: C\n    cardSize: 100'))
    expect(gridVar(belowBoardMinimum.el, '--view-card-w')).toBe('100px')
    unmount()
    const small = mount(CARDS_BASE.replace('name: C', 'name: C\n    cardSize: small'))
    expect(gridVar(small.el, '--view-card-w')).toBe('220px')
    unmount()
    const large = mount(CARDS_BASE.replace('name: C', 'name: C\n    cardSize: large'))
    expect(gridVar(large.el, '--view-card-w')).toBe('340px')
  })
})

describe('covers', () => {
  const WITH_IMAGE = CARDS_BASE.replace('name: C', 'name: C\n    image: cover')

  it('no image key on the view → no cover element at all', () => {
    const { el } = mount(CARDS_BASE, { records: COVER_RECORDS })
    expect(el.querySelector('.view-card__cover')).toBeNull()
  })

  it('a #rrggbb value renders a colour block, an http(s) URL goes straight into src', async () => {
    const { el } = mount(WITH_IMAGE, { records: COVER_RECORDS })
    await settle()
    const colour = q<HTMLElement>(cardOf(el, 'colour'), '.view-card__cover')
    expect(colour.tagName).toBe('DIV')
    expect(colour.style.background).toMatch(/#ff0000|rgb\(255,\s*0,\s*0\)/i)
    const remote = q<HTMLImageElement>(cardOf(el, 'remote'), 'img.view-card__cover')
    expect(remote.src).toBe('https://pics.test/cover.png')
  })

  it('a wikilink resolves through api.readAsset into a data: URL; a placeholder shows until it lands', async () => {
    const { api } = await import('../../api')
    const { el } = mount(WITH_IMAGE, { records: COVER_RECORDS })
    // synchronous first paint: the asset is still loading → placeholder, never a broken img
    expect(cardOf(el, 'local').querySelector('img')).toBeNull()
    expect(cardOf(el, 'local').querySelector('.view-card__cover--empty')).not.toBeNull()
    await settle()
    const img = q<HTMLImageElement>(cardOf(el, 'local'), 'img.view-card__cover')
    expect(img.src).toBe('data:image/png;base64,UE5H')
    expect(api.readAsset).toHaveBeenCalledWith('/vault', 'levels.png')
  })

  it('no value and a failed resolution both render the neutral placeholder', async () => {
    const { el } = mount(WITH_IMAGE, { records: COVER_RECORDS })
    await settle()
    expect(cardOf(el, 'bare').querySelector('.view-card__cover--empty')).not.toBeNull()
    expect(cardOf(el, 'broken').querySelector('.view-card__cover--empty')).not.toBeNull()
    expect(cardOf(el, 'broken').querySelector('img')).toBeNull()
  })

  it('one bridge call per unique ref: a grid of repeated covers is served from the cache', async () => {
    const { api } = await import('../../api')
    const twice = [cover('one', { cover: '[[levels.png]]' }), cover('two', { cover: '[[levels.png]]' })]
    const { el } = mount(WITH_IMAGE, { records: twice })
    await settle()
    expect(api.readAsset).toHaveBeenCalledTimes(1)
    expect([...el.querySelectorAll('img.view-card__cover')]).toHaveLength(2)
  })

  it('imageFit and imageAspectRatio land as CSS custom properties; the defaults are cover and 1', async () => {
    const { el } = mount(WITH_IMAGE, { records: COVER_RECORDS })
    await settle()
    expect(gridVar(el, '--view-card-fit')).toBe('cover')
    expect(gridVar(el, '--view-card-ratio')).toBe('1')
    unmount()
    const tuned = mount(WITH_IMAGE.replace('image: cover', 'image: cover\n    imageFit: contain\n    imageAspectRatio: 1.5'), { records: COVER_RECORDS })
    await settle()
    expect(gridVar(tuned.el, '--view-card-fit')).toBe('contain')
    expect(gridVar(tuned.el, '--view-card-ratio')).toBe('1.5')
  })
})

describe('grouped sections', () => {
  it('groupBy renders 4C sections — shared header with value, count, summaries — No value last', () => {
    const { el } = mount(GROUPED_BASE)
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value'])
    expect(sections(el).map((s) => q(s, '.view-group__count').textContent)).toEqual(['1', '2', '2', '3'])
    expect(sections(el).map((s) => s.querySelector('.view-group__summary')?.textContent)).toEqual(['Sum1', 'Sum2', 'Sum3', 'Sum'])
    expect(sections(el).map((s) => cards(s).length)).toEqual([1, 2, 2, 3])
  })

  it('the chevron hides a section, persists through storage and never writes the file', async () => {
    const { storage } = await import('../../lib/storage')
    const { el, onChange } = mount(GROUPED_BASE)
    click(toggleOf(el, 'idea'))
    expect(titles(el)).not.toContain('Agentic Agency')
    expect(headerTexts(el)).toEqual(['drafting', 'idea', 'published', 'No value']) // header stays
    expect(toggleOf(el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(onChange).not.toHaveBeenCalled() // NOT in the page's own card, no autosave
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::C', ['v:idea'])

    // a fresh mount of the same base + view starts collapsed from the store
    unmount()
    const again = mount(GROUPED_BASE)
    expect(toggleOf(again.el, 'idea').getAttribute('aria-expanded')).toBe('false')
    expect(titles(again.el)).not.toContain('Agentic Agency')

    // expanding removes the entry
    click(toggleOf(again.el, 'idea'))
    expect(titles(again.el)).toContain('Agentic Agency')
    expect(storage.setViewGroups).toHaveBeenLastCalledWith('/vault', '/vault/pillars.md::C', [])
  })

  it('search narrows cards, drops empty sections and recomputes counts and summaries', () => {
    const { el } = mount(GROUPED_BASE)
    click(byLabel(el, 'Search'))
    setValue(byLabel(el, 'Search rows'), 'agency')
    expect(headerTexts(el)).toEqual(['drafting', 'idea'])
    expect(titles(el)).toEqual(['The Levels of an Agency', 'Agentic Agency'])
    expect(sections(el).map((s) => q(s, '.view-group__count').textContent)).toEqual(['1', '1'])
    expect(sections(el)[1].querySelector('.view-group__summary')?.textContent).toBe('Sum2')
    expect(q(el, '.view-toolbar__count').textContent).toBe('2 / 8 items')
  })
})
