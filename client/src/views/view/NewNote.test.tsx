/**
 * "New" button (5D, GRO-2144): ViewsPane mounted with react-dom in jsdom over `TEST_RECORDS`,
 * with the folder page's own `create` spied (the seed DERIVATION runs for real). Every New goes
 * through it since YAZ-846 amputated the plain `createFromSeed` path — a folder page births its
 * members from its DECLARATION and parks them per its settings (🔒 Q5/Q6), so what this file
 * pins is the SEED that rides along and what happens to the note the create resolves. The
 * per-group "+" seeds the group's value on top (acceptance: filter `status == "idea"` grouped by
 * `pillar`, create in "Agentic Agency" → BOTH keys, and the note lands in that group once the
 * index delivers it). A failed create shows an inline error and opens nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord, PropertiesResponse } from '@shared/types'
import { parseViews, type ParsedViews } from '../viewSchema'
import { ViewsPane, type ViewsPaneProps } from '../ViewsPane'
import type { NewNoteSeed } from '../newNote'
import { testFolderPage } from '../testFolderPage'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

/** The folder page's own birth (🔒 Q5): the ONE create path, spied for the seed it is handed. */
const create = vi.fn<(seed: NewNoteSeed, name?: string) => Promise<string>>()
/** The seed of the nth create — `properties` is what every assertion here is about. */
const seed = (n = 0): Record<string, unknown> => create.mock.calls[n][0].properties

const IDEA_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
    filters:
      and:
        - status == "idea"
`

const ACCEPTANCE_TABLE = `${IDEA_TABLE}    groupBy:
      property: note.pillar
`

const FOLDER_TABLE = `views:
  - type: table
    name: T
    order:
      - file.name
    filters:
      and:
        - file.inFolder("Content Pillars/1. Agentic Agency")
`

const PRIORITY_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.priority
`

const FOLDER_PAGE_PATH = '/vault/Bases/Content.md'
/** Where the folder page's settings park a new member — this test's stand-in for `createMember`. */
const PARKED = '/vault/Bases/Untitled.md'

/** The created note as the next index refetch would deliver it. */
const created = (path: string, properties: Record<string, unknown>): IndexRecord => ({
  path,
  name: path.split('/').pop()!,
  basename: path.split('/').pop()!.replace(/\.md$/, ''),
  folder: path.slice('/vault/'.length, path.lastIndexOf('/')),
  ext: 'md',
  size: 0,
  ctime: 0,
  mtime: 0,
  properties,
  aliases: [],
  tags: [],
  links: [],
  embeds: [],
})

let root: Root | null = null
let container: HTMLElement | null = null
let draw: () => void = () => {}

function mount(text: string, props: Partial<ViewsPaneProps> = {}) {
  let parsed = parseViews(text)
  let records: IndexRecord[] = TEST_RECORDS
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
          thisFile={FOLDER_PAGE_PATH}
          records={records}
          folderPage={testFolderPage({ create })}
          onOpenFile={onOpenFile}
          {...props}
        />,
      ),
    )
  draw()
  const el = container
  return {
    el,
    onOpenFile,
    /** Simulates the watcher-driven index refetch: a fresh records array re-rendered in. */
    setRecords: (next: IndexRecord[]) => {
      records = next
      draw()
    },
  }
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue(PARKED)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)

function click(el: Element): void {
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  draw()
}

/** Settle the create promise so open/error state lands. */
async function flush(): Promise<void> {
  await act(async () => {})
  draw()
}

/** Grouped table as `{ 'group label': [row names] }`, in document order. */
function tableSections(el: ParentNode): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let current = ''
  for (const tr of el.querySelectorAll('tbody tr')) {
    if (tr.classList.contains('view-table__group')) {
      current = q(tr, '.view-group__value').textContent ?? ''
      out[current] = []
    } else if (!tr.classList.contains('view-table__spacer')) {
      out[current]?.push(q(tr, '.view-table__link').textContent ?? '')
    }
  }
  return out
}

// ---------- tests ----------

describe('toolbar New', () => {
  it('hands the filter-derived seed to the folder page\'s own create, then opens what it returns', async () => {
    const { el, onOpenFile } = mount(IDEA_TABLE)

    click(byLabel(el, 'New note'))
    await flush()

    expect(create).toHaveBeenCalledTimes(1)
    expect(seed()).toEqual({ status: 'idea' })
    expect(onOpenFile).toHaveBeenCalledWith(PARKED)
  })

  // The `inFolder` seed still DERIVES (`newNote.test.ts` pins it) — it just no longer places the
  // note: inside a folder page the settings' `folder` decides, and the toolbar's New passes no
  // name, so `createMember` keeps the `Untitled` scheme (`FolderPageContents.test.tsx`).
  it('a single file.inFolder filter rides along in the seed but never places the note', async () => {
    const { el } = mount(FOLDER_TABLE)

    click(byLabel(el, 'New note'))

    expect(create.mock.calls[0][0].folder).toBe('Content Pillars/1. Agentic Agency')
    expect(create.mock.calls[0][1]).toBeUndefined()
  })

  it('a failed create shows an inline error and opens nothing', async () => {
    create.mockRejectedValue(new Error('disk full'))
    const { el, onOpenFile } = mount(IDEA_TABLE)

    click(byLabel(el, 'New note'))
    await flush()

    expect(q(el, '[role="alert"]').textContent).toContain('disk full')
    expect(onOpenFile).not.toHaveBeenCalled()
  })
})

describe('no typed creation any more (YAZ-836)', () => {
  // `page_type` survives here as ORDINARY filter data: the engine and `deriveSeed` never knew it
  // was special, and after the type system's deletion nothing else does either.
  const KPI_TABLE = `filters:
  and:
    - page_type == "kpi"
views:
  - type: table
    name: T
    order:
      - file.name
`

  const DECLS: PropertiesResponse = {
    root: '/vault',
    version: 1,
    properties: { unit: { kind: 'text' } },
  }

  it('a page_type filter no longer scaffolds or redirects: the plain filter-derived seed, in the view folder', async () => {
    // No bridge is installed at all: a surviving scaffold path would read a template (or create
    // the type folder) through `window.yaseenDraw` and blow up instead of creating the note.
    const { el, onOpenFile } = mount(KPI_TABLE, { properties: DECLS })

    click(byLabel(el, 'New note'))
    await flush()

    expect(seed()).toEqual({ page_type: 'kpi' })
    expect(onOpenFile).toHaveBeenCalledWith(PARKED)
    expect(el.querySelector('[role="alert"]')).toBeNull()
  })
})

describe('New inside a group', () => {
  it('acceptance: status == "idea" grouped by pillar, create in "Agentic Agency" → both keys, lands in the group', async () => {
    const { el, onOpenFile, setRecords } = mount(ACCEPTANCE_TABLE)

    click(byLabel(el, 'New note in group Agentic Agency'))
    await flush()

    expect(seed()).toEqual({ status: 'idea', pillar: 'Agentic Agency' })
    expect(onOpenFile).toHaveBeenCalledWith(PARKED)

    setRecords([...TEST_RECORDS, created(PARKED, { status: 'idea', pillar: 'Agentic Agency' })])
    expect(tableSections(el)['Agentic Agency']).toContain('Untitled')
  })

  it('a board column seeds the group value with its YAML type preserved', () => {
    const { el } = mount(PRIORITY_BOARD)

    click(byLabel(el, 'New note in group 2'))

    expect(seed()).toEqual({ priority: 2 })
  })

  it('the "No value" group seeds nothing for the groupBy key', () => {
    const { el } = mount(PRIORITY_BOARD)

    click(byLabel(el, 'New note in group No value'))

    expect(seed()).toEqual({})
  })
})

// ---------- Fan-out: the group "+" seeds its own element (YAZ-671 D4) ----------

const STATUS_BOARD = `views:
  - type: board
    name: B
    order:
      - file.name
    groupBy:
      property: note.status
`

/** A record whose grouping property is a LIST, so the engine fans it out across groups. */
const listRec = (name: string, status: unknown): IndexRecord => ({
  ...TEST_RECORDS[0],
  path: `/vault/${name}.md`,
  name: `${name}.md`,
  basename: name,
  properties: { status },
})

describe('the group "+" under fan-out (YAZ-671 D4)', () => {
  it('seeds ONLY that group\'s element, never the neighbour\'s whole list', () => {
    const records = [listRec('both', ['a', 'b']), listRec('onlyA', ['a'])]
    const { el } = mount(STATUS_BOARD, { records })

    // 'both' carries ['a','b'] and is the first row of group a — the old code seeded that list
    click(byLabel(el, 'New note in group a'))
    expect(seed()).toEqual({ status: ['a'] })
  })

  it('seeds a link element in the `[[…]]` form the picker writes', () => {
    const records = [listRec('spans', ['[[Lead Gen]]', '[[Sales]]'])]
    const { el } = mount(STATUS_BOARD, { records })

    click(byLabel(el, 'New note in group [[Lead Gen]]'))
    expect(seed()).toEqual({ status: ['[[Lead Gen]]'] })
  })

  it('the "No value" group still seeds nothing when the grouping is fanned out', () => {
    const records = [listRec('both', ['a', 'b']), listRec('none', [])]
    const { el } = mount(STATUS_BOARD, { records })

    click(byLabel(el, 'New note in group No value'))
    expect(seed()).toEqual({})
  })
})
