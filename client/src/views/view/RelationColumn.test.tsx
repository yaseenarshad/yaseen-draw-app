/**
 * Relation definitions now save to the current folder page with the shared Save/Cancel editor.
 * Legacy vault declarations remain read fallbacks. Link values still write through the normal
 * cell editors; their pickers constrain suggestions to the declared target folder page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, PropertiesResponse, PropertyDecl } from '@shared/types'
import { defaultLabel } from '../engine'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import { propertiesStub, resetPropertiesStub } from '../propertiesStub'
import { testFolderPage } from '../testFolderPage'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, properties: Record<string, unknown>): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: path.slice(7, path.lastIndexOf('/')),
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 0,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const REVENUE = '/vault/KPIs/Revenue.md'
const CHURN = '/vault/KPIs/Churn.md'

/**
 * Two folder pages (`People`, `Funnels`) with members naming them, plus the two KPI rows the
 * table shows. `page_type` rides along as ORDINARY frontmatter — it is what `KPI_BASE` filters
 * on, and nothing in the client reads it as an identity any more (YAZ-836).
 */
const RECORDS: IndexRecord[] = [
  rec(REVENUE, { page_type: 'kpi', owner: '[[Alice]]' }),
  rec(CHURN, { page_type: 'kpi' }),
  rec('/vault/People.md', { folder_page: true }),
  rec('/vault/Funnels.md', { folder_page: true }),
  rec('/vault/Funnels/Signup.md', { folder_pages: ['[[Funnels]]'] }),
  rec('/vault/Funnels/Retention.md', { folder_pages: ['[[Funnels]]'] }),
  rec('/vault/People/Alice.md', { folder_pages: ['[[People]]'] }),
  rec('/vault/People/Bob.md', { folder_pages: ['[[People]]'] }),
]

/** Every basename, in record order — what an unnarrowed picker offers. */
const ALL_NAMES = ['Revenue', 'Churn', 'People', 'Funnels', 'Signup', 'Retention', 'Alice', 'Bob']

/**
 * YAZ-846: `folderPage` is required. The whole `RECORDS` list is the VAULT here — the picker's
 * narrowing resolves its `target` over it, exactly as 🔒 D2 says, even when a filter has cut the
 * rows down to the two KPIs.
 */
const FOLDER_PAGE = testFolderPage({ vaultRecords: RECORDS })

const ORDER = '    order:\n      - file.name\n      - note.owner\n      - note.funnels\n'
const KPI_BASE = `filters: page_type == "kpi"\nviews:\n  - type: table\n    name: T\n${ORDER}`
const UNFILTERED_BASE = `views:\n  - type: table\n    name: T\n${ORDER}`

const EMPTY_DECLS: PropertiesResponse = { root: '/vault', version: 0, properties: {} }

/** Legacy vault declarations remain readable until a folder overrides them. */
const DECLS: PropertiesResponse = {
  root: '/vault',
  version: 1,
  properties: {
    owner: { kind: 'link', target: 'People' },
    funnels: { kind: 'multi-link', target: 'Funnels' },
  },
}

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
          thisFile={null}
          records={RECORDS}
          folderPage={FOLDER_PAGE}
          properties={EMPTY_DECLS}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return { el }
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 1 })
  // `useProperties` reads the real bridge; the stub plays it in tests.
  Object.defineProperty(window, 'yaseenDocs', { value: { properties: propertiesStub }, configurable: true, writable: true })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  resetPropertiesStub()
  delete (window as unknown as Record<string, unknown>).yaseenDocs
})

// ---------- DOM helpers (EditableCell.test.tsx style) ----------

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

function doubleClick(el: Element): void {
  act(() => {
    const target = el as HTMLElement
    target.click()
    target.click()
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
  draw()
}

function setValue(el: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  draw()
}

function press(el: Element, key: string): void {
  act(() => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
  draw()
}

/** A host that keeps its declarations AHEAD (YAZ-1549), like `FolderPageContents`: each write lands in `settings.columns` at once. */
function aheadHost() {
  const settings = { columns: {} as Record<string, PropertyDecl>, views: [], problems: [] }
  const setColumn = vi.fn(async (key: string, next: PropertyDecl) => {
    settings.columns[key] = next
  })
  return { setColumn, folderPage: testFolderPage({ vaultRecords: RECORDS, settings, setColumn }) }
}

/** Pick a `<select>` value the way a user does: the native setter, then a bubbling change event React sees. */
function selectValue(el: HTMLSelectElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
  act(() => {
    set?.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/** Let an immediate declaration write resolve, so the panel's `base` moves forward (3D). */
async function settle(): Promise<void> {
  await act(async () => {})
}

const cell = (el: ParentNode, r: number, c: number) => q<HTMLElement>(el, `[data-cell="${r}:${c}"]`)
/** Open a table relation editor through its public double-click activation boundary. */
const open = (el: ParentNode, r: number, c: number) => doubleClick(cell(el, r, c))
const options = (el: ParentNode) => [...el.querySelectorAll('[role="option"]')].map((o) => o.textContent)

/** Open the Properties popover and the relation editor for `key` — the button wears the column's LABEL (YAZ-1513). */
function openRelation(el: ParentNode, key: string) {
  click(byLabel(el, 'Properties'))
  click(byLabel(el, `Open ${defaultLabel(key)}`)) // the column's detail (YAZ-1513)
  click(byLabel(el, `Relation for ${defaultLabel(key)}`))
}

// ---------- tests ----------

describe('column menu relation flow', () => {
  it('a filtered view saves a local relation definition without changing the vault registry', async () => {
    const { setColumn, folderPage } = aheadHost()
    const { el } = mount(KPI_BASE, { folderPage })
    openRelation(el, 'owner') // "Make relation": the declaration is born as a link, immediately
    expect(setColumn).toHaveBeenNthCalledWith(1, 'owner', { kind: 'link' }, undefined)
    await settle()
    setValue(byLabel<HTMLInputElement>(el, 'Link target'), 'People')
    press(byLabel(el, 'Link target'), 'Enter')
    expect(setColumn).toHaveBeenNthCalledWith(2, 'owner', { kind: 'link', target: 'People' }, { kind: 'link' })
    expect((await propertiesStub.get('/vault')).properties).toEqual({})
  })

  it('Multi-link: the Type select, then the target — each an immediate folder-local write against what just landed', async () => {
    const { setColumn, folderPage } = aheadHost()
    const { el } = mount(UNFILTERED_BASE, { folderPage })
    openRelation(el, 'funnels')
    expect(setColumn).toHaveBeenNthCalledWith(1, 'funnels', { kind: 'link' }, undefined)
    await settle()
    selectValue(byLabel<HTMLSelectElement>(el, 'Edit property Funnels'), 'multi-link')
    expect(setColumn).toHaveBeenNthCalledWith(2, 'funnels', { kind: 'multi-link' }, { kind: 'link' })
    await settle()
    setValue(byLabel<HTMLInputElement>(el, 'Link target'), 'Funnels')
    press(byLabel(el, 'Link target'), 'Enter')
    expect(setColumn).toHaveBeenNthCalledWith(3, 'funnels', { kind: 'multi-link', target: 'Funnels' }, { kind: 'multi-link' })
    expect((await propertiesStub.get('/vault')).properties).toEqual({})
  })

  it('the target is free text with no obsolete type-name suggestion list', async () => {
    const { el } = mount(KPI_BASE, { properties: DECLS, folderPage: aheadHost().folderPage })
    openRelation(el, 'owner')
    await settle()
    expect(el.querySelector('datalist')).toBeNull()
    expect(byLabel<HTMLInputElement>(el, 'Link target').getAttribute('list')).toBeNull()
  })

  it('an existing legacy declaration is the seed: nothing is written before the click, and Make relation writes exactly it', async () => {
    const { setColumn, folderPage } = aheadHost()
    const { el } = mount(KPI_BASE, { properties: DECLS, folderPage })
    click(byLabel(el, 'Properties'))
    click(byLabel(el, 'Open Funnels'))
    expect(setColumn).not.toHaveBeenCalled()
    click(byLabel(el, 'Relation for Funnels'))
    expect(setColumn).toHaveBeenCalledExactlyOnceWith('funnels', { kind: 'multi-link', target: 'Funnels' }, undefined)
    await settle()
    expect(byLabel<HTMLSelectElement>(el, 'Edit property Funnels').value).toBe('multi-link')
    expect(byLabel<HTMLInputElement>(el, 'Link target').value).toBe('Funnels')
  })

  it('without a known root there is no relation editor to offer', () => {
    const { el } = mount(KPI_BASE, { root: null })
    click(byLabel(el, 'Properties'))
    click(byLabel(el, 'Open Owner'))
    expect(el.querySelector('[aria-label="Relation for Owner"]')).toBeNull()
  })

  it('file.* rows never offer a relation; note.* rows do', () => {
    const { el } = mount(KPI_BASE)
    click(byLabel(el, 'Properties'))
    click(byLabel(el, 'Open Name'))
    expect(el.querySelector('[aria-label="Relation for Name"]')).toBeNull() // file.name's detail
    click(byLabel(el, 'Back to columns'))
    click(byLabel(el, 'Open Owner'))
    expect(el.querySelector('[aria-label="Relation for Owner"]')).not.toBeNull()
  })
})

describe('constrained picker', () => {
  it('the link editor offers the target folder page\'s pages and commits the wiki-link through writeProperty', () => {
    const { el } = mount(KPI_BASE, { properties: DECLS })
    open(el, 1, 1) // Churn's empty owner cell — typed link by the declaration alone
    const input = byLabel<HTMLInputElement>(el, 'Edit owner')
    setValue(input, '[[')
    expect(options(el)).toEqual(['Alice', 'Bob']) // the pages inside [[People]]
    click(q(el, '[role="option"]'))
    press(byLabel(el, 'Edit owner'), 'Enter')
    expect(write).toHaveBeenCalledExactlyOnceWith(CHURN, 'owner', '[[Alice]]')
  })

  it('a target naming no folder page falls back to ALL basenames — never an error', () => {
    // This is also the mid-wave degradation: targets still spelled as old TYPE names name no
    // folder page, so their columns widen to every page until 5.1 re-points them.
    const ghost: PropertiesResponse = { ...DECLS, properties: { owner: { kind: 'link', target: 'person' } } }
    const { el } = mount(KPI_BASE, { properties: ghost })
    open(el, 1, 1)
    setValue(byLabel<HTMLInputElement>(el, 'Edit owner'), '[[')
    expect(options(el)).toEqual(ALL_NAMES)
  })
})

describe('multi-link cells', () => {
  it('the chips editor completes constrained suggestions and commits a LIST of [[…]] strings', () => {
    const { el } = mount(KPI_BASE, { properties: DECLS })
    open(el, 0, 2) // Revenue's empty funnels cell — multi-link vault-wide
    const input = byLabel<HTMLInputElement>(el, 'Edit funnels')
    setValue(input, '[[')
    expect(options(el)).toEqual(['Retention', 'Signup']) // the pages inside [[Funnels]], path-sorted
    setValue(byLabel<HTMLInputElement>(el, 'Edit funnels'), '[[Sig')
    press(byLabel(el, 'Edit funnels'), 'Enter') // completes to [[Signup]]
    expect(byLabel<HTMLInputElement>(el, 'Edit funnels').value).toBe('[[Signup]]')
    press(byLabel(el, 'Edit funnels'), 'Enter') // adds the chip
    press(byLabel(el, 'Edit funnels'), 'Enter') // empty input commits the list
    expect(write).toHaveBeenCalledExactlyOnceWith(REVENUE, 'funnels', ['[[Signup]]'])
  })

  it('Esc cancels without a write', () => {
    const { el } = mount(KPI_BASE, { properties: DECLS })
    open(el, 0, 2)
    press(byLabel(el, 'Edit funnels'), 'Escape')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('round trip and degradation', () => {
  it('a relation value renders as a link chip, like any wiki-link property today', () => {
    const { el } = mount(KPI_BASE, { properties: DECLS })
    const chip = q<HTMLElement>(cell(el, 0, 1), '.view-table__chip--link')
    expect(chip.textContent).toBe('Alice')
  })

  it('an error string surfaces as an alert while typing degrades to inference', () => {
    const broken: PropertiesResponse = { root: '/vault', version: 0, properties: {}, error: 'properties.json: bad JSON' }
    const { el } = mount(KPI_BASE, { properties: broken })
    expect([...el.querySelectorAll('[role="alert"]')].some((n) => n.textContent?.includes('properties.json: bad JSON'))).toBe(true)
    open(el, 0, 1) // owner: [[Alice]] — value inference still gives the link editor
    expect(byLabel<HTMLInputElement>(el, 'Edit owner').value).toBe('[[Alice]]')
  })
})
