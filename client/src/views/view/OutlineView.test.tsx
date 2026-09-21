/**
 * The folder page's OUTLINE view (YAZ-903 — 🔒 D4 of YAZ-818 as YAZ-867 amended it). Mounted
 * through the REAL host (`FolderPageContents` → `ViewsPane`), the same harness 5.1's tests use, so
 * the routing — `type: outline` INSIDE the folder-page mode and nowhere else — is proven by the
 * editor appearing at all, and every write travels the real door it will travel in the app.
 *
 * `OutlineEditor` itself is STUBBED here (a real Crepe instance in jsdom is slow, and the lock, the
 * seeding and the debounce are pinned next door in `OutlineEditor.test.tsx`): the stub renders the
 * markdown it was handed and hands back the `onChange` a debounced edit would call.
 *
 * Pinned here: the seed is `view.outline`, or the [D5] `order` frozen into a document when there is
 * none; one edit is ONE settings write that stores the document AND retires `order`; a link line
 * that appeared tags its page (never this folder page itself); a link line that vanished only asks,
 * through the sheet, one page at a time — Confirm un-tags, Cancel keeps the belonging; and ADOPTION
 * (YAZ-1152): a member the document does not NAME is WRITTEN INTO it — depth-0 `[[links]]` at the
 * end, alphabetical, spelled by `linkNames`, ONE settings write — never while a remove sheet is
 * pending, an un-tag is in flight, the editor holds the caret, or the seed was lossy. The
 * read-only appended section is GONE: cancel restores the line by construction instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../../editor/wikilink/wikilinkPlugin'
import { parseViews } from '../viewSchema'
import { ViewsPane } from '../ViewsPane'
import { FolderPageContents } from '../FolderPageContents'
import { folderPageSettings } from '../folderPageSettings'
import { removeMemberMessage } from './ConfirmRemoveMember'
import type { OutlineEditorProps } from './OutlineEditor'

vi.mock('../writeProperty', () => ({ writeProperty: vi.fn() }))
vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { readFile: vi.fn(), createDir: vi.fn(), createFile: vi.fn() },
}))
/** The editor, stubbed: what it was seeded with, and the door a debounced edit comes back through.
    The host div is FOCUSABLE, carrying the real editor's class — the caret guard is pinned on it. */
const editor = vi.hoisted(() => ({ props: null as OutlineEditorProps | null }))
vi.mock('./OutlineEditor', () => ({
  OutlineEditor: (props: OutlineEditorProps) => {
    editor.props = props
    return (
      <div className="view-outline-editor" tabIndex={0}>
        <pre className="outline-doc">{props.markdown}</pre>
      </div>
    )
  },
}))

import { api, BridgeRequestError } from '../../api'
import { writeProperty } from '../writeProperty'

const write = vi.mocked(writeProperty)
const readFile = vi.mocked(api.readFile)
const createDir = vi.mocked(api.createDir)
const createFile = vi.mocked(api.createFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// ---------- the vault ----------

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

const FUNNELS = '/vault/Funnel Stages.md'
const LEAD = '/vault/stages/Lead Gen.md'
const NURTURE = '/vault/stages/Nurture.md'
const SALES = '/vault/stages/Sales.md'
const OTHER = '/vault/Other.md'
const KPIS = '/vault/KPIs.md'

const OUTLINE = { type: 'outline', name: 'Outline' }
const TABLE = { type: 'table', name: 'Table', order: ['file.name'] }
const SETTINGS = { columns: {}, folder: 'stages', views: [OUTLINE, TABLE] }

/**
 * The folder page, three members (one of them ALSO in a second folder page, so the remove sheet
 * has something to name), a second folder page nobody here belongs to, and one loose page.
 */
function vault(settings: unknown = SETTINGS): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: settings }),
    rec(KPIS, { folder_page: true }),
    rec(OTHER, { title: 'not a member' }),
    rec(LEAD, { folder_pages: ['[[Funnel Stages]]'] }),
    rec(NURTURE, { folder_pages: ['[[Funnel Stages]]', '[[KPIs]]'], note: 'keep me' }),
    rec(SALES, { folder_pages: ['[[Funnel Stages]]'] }),
  ]
}

/** `Alpha` is a folder page holding two pages, and belongs to this one — the glyph + count row. */
function nested(): IndexRecord[] {
  return [
    rec(FUNNELS, { folder_page: true, folder_page_settings: { views: [{ ...OUTLINE, outline: '- nothing yet' }, TABLE] } }),
    rec('/vault/Alpha.md', { folder_page: true, folder_pages: ['[[Funnel Stages]]'] }),
    rec('/vault/One.md', { folder_pages: ['[[Alpha]]'] }),
    rec('/vault/Two.md', { folder_pages: ['[[Alpha]]'] }),
  ]
}

// ---------- harness (FolderPageContents.test.tsx's, verbatim) ----------

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const onOpenFile = vi.fn()
const onOpenFileBackground = vi.fn()

function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path = FUNNELS, records: IndexRecord[] = vault()): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <FolderPageContents path={path} root="/vault" source={source} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} />,
    ),
  )
  feed(records)
  return container
}

beforeEach(() => {
  source = createWikilinkResolveSource()
  editor.props = null
  write.mockResolvedValue({ mtime: 2 })
  readFile.mockRejectedValue(new BridgeRequestError('NOT_FOUND', 'path does not exist')) // no template
  createDir.mockResolvedValue({ path: '/vault/stages' })
  createFile.mockResolvedValue({ path: '', mtime: 1, size: 0 })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
})

// ---------- DOM helpers ----------

function q<T extends Element>(el: ParentNode, sel: string): T {
  const n = el.querySelector<T>(sel)
  if (n === null) throw new Error(`missing ${sel}`)
  return n
}

const all = <T extends Element>(el: ParentNode, sel: string): T[] => [...el.querySelectorAll<T>(sel)]
const texts = (el: ParentNode, sel: string): string[] => all(el, sel).map((n) => n.textContent ?? '')
const byLabel = <T extends HTMLElement>(el: ParentNode, label: string): T => q<T>(el, `[aria-label="${label}"]`)
/** The document the editor was seeded with. */
const doc = (el: ParentNode): string => q(el, '.outline-doc').textContent ?? ''
/** One committed edit — what the editor's debounce hands back. */
const edit = (markdown: string): void => act(() => editor.props?.onChange(markdown))
const settingsWrites = () => write.mock.calls.filter((c) => c[1] === 'folder_page_settings')
const memberWrites = () => write.mock.calls.filter((c) => c[1] === 'folder_pages')
const sheetButton = (label: string): HTMLElement => all<HTMLElement>(document.body, '.confirm__btn').find((b) => b.textContent === label)!

function click(el: Element, init: MouseEventInit = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init })))
}

async function flush(): Promise<void> {
  await act(async () => {})
}

// ---------- routing ----------

describe('the outline is the folder page’s skin — and only ever hers', () => {
  it('a folder page’s `type: outline` view renders the EDITOR, not the placeholder rows', () => {
    const el = mount()
    expect(el.querySelector('.view-outline')).not.toBeNull()
    expect(el.querySelector('.outline-doc')).not.toBeNull()
    expect(el.querySelector('.view-row__link')).toBeNull() // the old unknown-view placeholder
    expect(texts(el, '.view-tab__btn')).toEqual(['Outline', 'Table']) // the card's own views, verbatim
  })

  it('a null `thisFile` keeps the placeholder rows — there is no folder page to be an outline of', () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <ViewsPane
          parsed={parseViews('views:\n  - type: outline\n    name: Outline\n')}
          onChange={vi.fn()}
          root="/vault"
          thisFile={null}
          records={[rec(LEAD)]}
          folderPage={{ settings: folderPageSettings(rec(FUNNELS, { folder_page: true })), vaultRecords: vault(), create: () => Promise.reject(new Error('no')), setColumn: async () => {}, setColumns: () => {}, deleteColumn: async () => {} }}
          onOpenFile={onOpenFile}
        />,
      ),
    )
    expect(container.querySelector('.view-outline')).toBeNull()
    expect(texts(container, '.view-row__link')).toEqual(['Lead Gen.md'])
  })

  it('the Properties menu and search are not offered while it shows — a document has no columns and no rows to filter', () => {
    const el = mount()
    expect(el.querySelector('[aria-label="Properties"]')).toBeNull()
    expect(el.querySelector('[aria-label="Search"]')).toBeNull()
    const tab = all<HTMLElement>(el, '.view-tab__btn').find((b) => b.textContent === 'Table')!
    click(tab)
    expect(el.querySelector('[aria-label="Properties"]')).not.toBeNull() // the table keeps both
    expect(el.querySelector('[aria-label="Search"]')).not.toBeNull()
  })

  it('the editor is handed the window’s link feed, and a nav whose identity survives a re-render', () => {
    const el = mount()
    const first = editor.props
    expect(el.querySelector('.ProseMirror')).toBeNull() // the stub stands in the real editor's place
    feed([...vault(), rec('/vault/Late.md')])
    // A new snapshot re-renders the block; a NEW nav object would remount the editor and eat the caret.
    expect(editor.props?.nav).toBe(first?.nav)
    expect(editor.props?.nav?.openCurrent).toBe(onOpenFile)
    expect(editor.props?.nav?.openBackground).toBe(onOpenFileBackground)
    expect(editor.props?.wikilinks).toBe(source)
  })
})

// ---------- the seed (🔒 D2 + the lazy migration) ----------

describe('the document comes from the card', () => {
  it('a stored `outline` naming every member is the document, verbatim — adoption has nothing to add', () => {
    const stored = '- [[Sales]]\n    - a note about it\n- [[Lead Gen]]\n- [[Nurture]]\n- free text'
    expect(doc(mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: stored }, TABLE] })))).toBe(stored)
    expect(write).not.toHaveBeenCalled() // nothing to adopt, nothing written — no gratuitous writes
  })

  it('no `outline` migrates the [D5] `order`: its entries first, every unlisted member behind them', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]')
  })

  it('no order at all is every member, alphabetical — the arrangement `orderedMembers` gave', () => {
    expect(doc(mount())).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
  })

  it('a stale `order` entry rides along as the text it is, and the member still appears once', () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Gone]]', '[[Nurture]]'] }, TABLE] }))
    expect(doc(el)).toBe('- [[Gone]]\n- [[Nurture]]\n- [[Lead Gen]]\n- [[Sales]]')
  })

})

// ---------- the disk moving under the open page (YAZ-1356) ----------

describe('a document changed OUTSIDE the app reaches the editor', () => {
  const stored = '- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]'
  const card = (outline: string) => vault({ ...SETTINGS, views: [{ ...OUTLINE, outline }, TABLE] })

  it('a new `outline` on the card that is not the last committed document is handed to the editor', () => {
    const el = mount(FUNNELS, card(stored))
    feed(card(`${stored}\n- typed by an AI`))
    expect(doc(el)).toBe(`${stored}\n- typed by an AI`)
    expect(write).not.toHaveBeenCalled() // looking at the disk writes nothing
  })

  it('the card echoing the document this component just committed changes nothing', async () => {
    const el = mount(FUNNELS, card(stored))
    edit(`${stored}\n- mine`)
    await flush()
    expect(settingsWrites()).toHaveLength(1)
    feed(card(`${stored}\n- mine`))
    expect(doc(el)).toBe(`${stored}\n- mine`)
    expect(settingsWrites()).toHaveLength(1)
  })

  it('an external link line that resolves tags its page — reconcile reads the document that is really on disk', async () => {
    mount(FUNNELS, card(stored))
    feed(card(`${stored}\n- [[Other]]`))
    await flush()
    expect(memberWrites()).toEqual([[OTHER, 'folder_pages', ['[[Funnel Stages]]']]])
  })

  it('the next commit diffs against the external document, not the stale one', async () => {
    mount(FUNNELS, card(stored))
    feed(card(`${stored}\n- [[Other]]`))
    await flush()
    write.mockClear()
    edit(`${stored}\n- [[Other]]\n- [[KPIs]]`) // the user adds one more line on top of the AI's
    await flush()
    expect(memberWrites()).toEqual([[KPIS, 'folder_pages', ['[[Funnel Stages]]']]]) // Other is not tagged twice
  })
})

// ---------- the commit (ONE settings write, and `order` retires) ----------

describe('an edit stores the document and retires the order', () => {
  it('the document lands on the FIRST outline view and takes `order` with it — ONE write', async () => {
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, order: ['[[Sales]]'] }, TABLE] }))
    edit('- [[Sales]]\n- [[Lead Gen]]')
    await flush()

    expect(settingsWrites()).toHaveLength(1)
    const [path, , value] = settingsWrites()[0]
    expect(path).toBe(FUNNELS) // the FOLDER PAGE's card
    expect(value).toEqual({
      folder: 'stages',
      views: [{ type: 'outline', name: 'Outline', outline: '- [[Sales]]\n- [[Lead Gen]]' }, TABLE],
    })
    expect(el.querySelector('.view-view__error')).toBeNull()
  })

  it('free text is just text: it stores, and it tags nobody', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- read [[Other]] some day')
    await flush()
    expect(settingsWrites()).toHaveLength(1)
    expect(memberWrites()).toEqual([]) // a link INSIDE prose is not a link line (🔒 the click rule)
  })
})

// ---------- tagging (🔒 E1: a link line IS the belonging) ----------

describe('a link line that appears tags its page, at once', () => {
  it('the entry lands on the TARGET’s own card, preserving what was already there', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(memberWrites()).toEqual([[OTHER, 'folder_pages', ['[[Funnel Stages]]']]])

    write.mockClear()
    mount(FUNNELS, vault().map((r) => (r.path === OTHER ? rec(OTHER, { folder_pages: ['[[KPIs]]'] }) : r)))
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(memberWrites()).toEqual([[OTHER, 'folder_pages', ['[[KPIs]]', '[[Funnel Stages]]']]])
  })

  it('the folder page can not become its own member', async () => {
    mount()
    edit('- [[Funnel Stages]]\n- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a page that already belongs is not written at all — tagging is idempotent through the resolver', async () => {
    mount() // the seed names every member with its canonical spelling
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[lead gen]]') // a different SPELLING of a member
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a failed belonging write is reported in place and never takes the block down', async () => {
    write.mockRejectedValue(new Error('read-only vault'))
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Other]]')
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('read-only vault')
  })
})

// ---------- reconcile: a line that STARTS resolving (YAZ-1357) ----------

const ALEX = '/vault/Alex Hormozi.md'
/** The seed names every member and one page that does not exist yet — text, until it does. */
const DANGLING = '- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[Alex Hormozi]]'
const dangling = (extra: IndexRecord[] = []): IndexRecord[] => [
  ...vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: DANGLING }, TABLE] }),
  ...extra,
]

describe('a link line that STARTS resolving is reconciled — tag only (YAZ-1357)', () => {
  it('a dangling line tags nobody; the page appearing on the next snapshot is tagged, without an edit', async () => {
    mount(FUNNELS, dangling())
    await flush()
    expect(memberWrites()).toEqual([])
    feed(dangling([rec(ALEX)]))
    await flush()
    expect(memberWrites()).toEqual([[ALEX, 'folder_pages', ['[[Funnel Stages]]']]])
  })

  it('a second snapshot before the index echoes the tag does not write twice; the echo ends the hold', async () => {
    mount(FUNNELS, dangling())
    feed(dangling([rec(ALEX)]))
    await flush()
    feed(dangling([rec(ALEX, { note: 'touched elsewhere' })]))
    await flush()
    expect(memberWrites()).toHaveLength(1)
    feed(dangling([rec(ALEX, { folder_pages: ['[[Funnel Stages]]'] })]))
    await flush()
    expect(memberWrites()).toHaveLength(1)
  })

  it('a page that already belongs under another spelling is not written — idempotent through the resolver', async () => {
    mount(FUNNELS, dangling([rec(ALEX, { folder_pages: ['[[funnel stages]]'] })]))
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a lossy seed never writes', async () => {
    mount(FUNNELS, dangling())
    act(() => editor.props?.onSeedLoss?.())
    feed(dangling([rec(ALEX)]))
    await flush()
    expect(memberWrites()).toEqual([])
  })

  it('a line that STOPS resolving is not un-tagged and opens no sheet', async () => {
    mount()
    feed(vault().filter((r) => r.path !== SALES))
    await flush()
    expect(memberWrites()).toEqual([])
    expect(all(document.body, '.confirm__btn')).toEqual([])
  })

  it('a failed reconcile write is reported in place, and the page is offered again on the next snapshot', async () => {
    write.mockRejectedValue(new Error('read-only vault'))
    const el = mount(FUNNELS, dangling())
    feed(dangling([rec(ALEX)]))
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('read-only vault')
    write.mockResolvedValue({ mtime: 2 })
    feed(dangling([rec(ALEX, { note: 'again' })]))
    await flush()
    expect(memberWrites()).toHaveLength(2)
  })
})

// ---------- un-tagging (🔒 sheet-gated, and cancel KEEPS) ----------

describe('the confirm copy is a pure function', () => {
  it('names where the page still lives', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', ['KPIs', 'Roadmap'])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It remains in: KPIs, Roadmap.",
    )
  })

  it('names Uncategorized when this was its last folder page', () => {
    expect(removeMemberMessage('Lead Gen', 'Funnel Stages', [])).toBe(
      "Remove 'Lead Gen' from 'Funnel Stages'? The page is not deleted — its file stays put. It has no other folder pages, so it moves to Uncategorized.",
    )
  })
})

describe('a link line that vanishes only ASKS', () => {
  it('the sheet opens and nothing is un-tagged on the edit itself — and adoption holds its breath', async () => {
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Sales]]') // Nurture dropped
    await flush()
    expect(q(document.body, '[role="dialog"]').textContent).toContain('It remains in: KPIs.')
    expect(memberWrites()).toEqual([])
    // While the question stands, the document is NOT rewritten under it: no re-append yet.
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Sales]]')
  })

  it('Confirm removes ONLY this folder page’s entry, on the member’s own card', async () => {
    mount()
    edit('- [[Lead Gen]]\n- [[Sales]]')
    click(sheetButton('Remove'))
    await flush()
    expect(memberWrites()).toEqual([[NURTURE, 'folder_pages', ['[[KPIs]]']]])
  })

  it('an entry that merely SPELLS the folder page is not a link, and is left alone', async () => {
    mount(FUNNELS, vault().map((r) => (r.path === LEAD ? rec(LEAD, { folder_pages: ['Funnel Stages', '[[Funnel Stages]]'] }) : r)))
    edit('- [[Nurture]]\n- [[Sales]]')
    click(sheetButton('Remove'))
    await flush()
    expect(memberWrites()).toEqual([[LEAD, 'folder_pages', ['Funnel Stages']]])
  })

  it('CANCEL KEEPS THE BELONGING — and adoption puts the line straight back', async () => {
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Sales]]')
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([])
    // Still a member: its card was never touched — so the document must name it again (YAZ-1152),
    // at the END: cancel restores the line by construction, and the editor re-seeds to show it.
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Sales]]\n- [[Nurture]]')

    // The restore travelled `commit`, so `prev` advanced: typing on does not re-open the sheet.
    edit('- [[Lead Gen]]\n- [[Sales]]\n- [[Nurture]]\n- and now some prose')
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([])
  })

  it('two pages dropped in ONE edit are asked one sheet at a time, in document order', async () => {
    const el = mount()
    edit('- [[Sales]]') // Lead Gen and Nurture both gone
    expect(q(document.body, '[role="dialog"]').textContent).toContain("Remove 'Lead Gen'")
    click(sheetButton('Remove'))
    await flush()
    expect(q(document.body, '[role="dialog"]').textContent).toContain("Remove 'Nurture'")
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(memberWrites()).toEqual([[LEAD, 'folder_pages', []]])
    // The split verdict lands in the document: the cancelled page returns, the removed one — whose
    // un-tag is still waiting for the index echo — must NOT be re-adopted while it is in flight.
    expect(doc(el)).toBe('- [[Sales]]\n- [[Nurture]]')

    // The echo arrives without Lead Gen: nothing more to adopt, the document is at rest.
    feed(vault().filter((r) => r.path !== LEAD))
    await flush()
    expect(doc(el)).toBe('- [[Sales]]\n- [[Nurture]]')
  })
})

// ---------- adoption (YAZ-1152: a member the document does not name is written into it) ----------

describe('a member the document does not name is ADOPTED into it', () => {
  /** The stored-outline shorthand every adoption mount uses. */
  const stored = (outline: string, records: IndexRecord[] = vault()) =>
    records.map((r) => (r.path === FUNNELS ? rec(FUNNELS, { folder_page: true, folder_page_settings: { ...SETTINGS, views: [{ ...OUTLINE, outline }, TABLE] } }) : r))
  const editorHost = (el: ParentNode): HTMLElement => q<HTMLElement>(el, '.view-outline-editor')

  it('an empty stored document adopts every member: depth-0 links, alphabetical, ONE settings write', async () => {
    const el = mount(FUNNELS, stored(''))
    await flush()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(settingsWrites()).toHaveLength(1)
    // Every adopted page already belongs — the tag pass is idempotent through the resolver.
    expect(memberWrites()).toEqual([])
  })

  it('a document naming some members adopts only the missing, at the END — the text above survives byte-for-byte', async () => {
    const el = mount(FUNNELS, stored('* [[Sales]]\n\n  free text about it'))
    await flush()
    expect(doc(el)).toBe('* [[Sales]]\n\n  free text about it\n- [[Lead Gen]]\n- [[Nurture]]')
  })

  it('a member that arrives on the next snapshot is adopted — the read-only rows are gone for good', async () => {
    const named = '- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]'
    const el = mount(FUNNELS, stored(named))
    await flush()
    expect(write).not.toHaveBeenCalled() // nothing missing at mount

    feed([...stored(named), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(doc(el)).toBe(`${named}\n- [[Expansion]]`)
    expect(el.querySelector('.view-outline__list')).toBeNull() // the appended section does not exist
    expect(settingsWrites()).toHaveLength(1)

    // The echo of the very same snapshot has nothing left to adopt: no second write, ever.
    feed([...stored(named), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(settingsWrites()).toHaveLength(1)
  })

  it('an ambiguous basename is adopted under its folder-qualified spelling — the one that resolves BACK to the member', async () => {
    const el = mount(FUNNELS, [
      ...stored('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]'),
      rec('/vault/Dup.md'), // the shallower page owns the bare name…
      rec('/vault/stages/Dup.md', { folder_pages: ['[[Funnel Stages]]'] }), // …so the member cannot use it
    ])
    await flush()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[stages/Dup]]')
  })

  it('the caret is never yanked: adoption WAITS while the editor holds focus, and lands on blur', async () => {
    const el = mount(FUNNELS, stored('- [[Sales]]'))
    await flush()
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]') // mount adoption ran unfocused

    act(() => editorHost(el).focus())
    feed([...stored('- [[Sales]]'), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]') // held: the user is typing

    act(() => editorHost(el).blur())
    await flush()
    expect(doc(el)).toBe('- [[Sales]]\n- [[Lead Gen]]\n- [[Nurture]]\n- [[Expansion]]')
  })

  it('a failed un-tag write restores the line — the page still belongs, so the document must say so', async () => {
    write.mockImplementation((_path, key) =>
      key === 'folder_pages' ? Promise.reject(new Error('read-only vault')) : Promise.resolve({ mtime: 2 }),
    )
    const el = mount()
    edit('- [[Lead Gen]]\n- [[Sales]]') // Nurture dropped
    click(sheetButton('Remove'))
    await flush()
    expect(q(el, '[role="alert"]').textContent).toContain('read-only vault')
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Sales]]\n- [[Nurture]]')
  })

  it('a lossy seed is never appended to: the guard said read-only, and adoption believes it', async () => {
    const el = mount()
    act(() => editor.props?.onSeedLoss?.())
    feed([...vault(), rec('/vault/stages/Expansion.md', { folder_pages: ['[[Funnel Stages]]'] })])
    await flush()
    expect(write).not.toHaveBeenCalled()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
  })

  it('StrictMode’s double-invoked effects adopt ONCE — each member lands on exactly one line', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() =>
      root?.render(
        <StrictMode>
          <FolderPageContents path={FUNNELS} root="/vault" source={source} onOpenFile={onOpenFile} onOpenFileBackground={onOpenFileBackground} />
        </StrictMode>,
      ),
    )
    feed(stored(''))
    await flush()
    expect(doc(container)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(settingsWrites()).toHaveLength(1)
  })

  it('a nested folder page is adopted as a plain link — no glyph, no count, no rows anywhere', async () => {
    const el = mount(FUNNELS, nested())
    await flush()
    expect(doc(el)).toBe('- nothing yet\n- [[Alpha]]')
    expect(el.querySelector('.view-outline__glyph')).toBeNull()
    expect(el.querySelector('.view-outline__count')).toBeNull()
    expect(el.querySelector('.view-outline__list')).toBeNull()
  })
})

// ---------- sync from folder (YAZ-953) ----------

/**
 * The toolbar's button opens the sheet the OUTLINE owns, and approving appends through `commit` —
 * the one door — so the very pass that stores the document tags every newly-linked note. The
 * vault root is the folder used here on purpose: its notes (`KPIs`, `Other`) are not members yet,
 * so the tagging is visible, and the folder page itself is never offered among them.
 */
describe('sync from folder appends through the outline’s one door', () => {
  /** The sheet's folder row, by the name it shows — `Vault root` for the root itself. */
  const folderRow = (folder: string): HTMLElement =>
    all<HTMLElement>(document.body, '.sync__folder').find((b) => b.firstElementChild?.textContent === folder)!

  const openSheet = (el: ParentNode, folder: string): void => {
    click(byLabel(el, 'Sync from folder'))
    click(folderRow(folder))
  }

  it('the approved links land as depth-0 bullets at the END, and each newly-linked note is tagged', async () => {
    const el = mount()
    openSheet(el, 'Vault root')
    click(sheetButton('Add'))
    await flush()

    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]\n- [[KPIs]]\n- [[Other]]')
    expect(settingsWrites()).toHaveLength(1)
    // THE POINT (🔒 YAZ-950): the append travelled `commit`, so belonging synced for free.
    expect(memberWrites()).toEqual([
      [KPIS, 'folder_pages', ['[[Funnel Stages]]']],
      [OTHER, 'folder_pages', ['[[Funnel Stages]]']],
    ])
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('the document above is kept byte-for-byte — the markers, the blank line and the prose all survive', async () => {
    const stored = '* [[Sales]]\n\n  free text about it'
    const el = mount(FUNNELS, vault({ ...SETTINGS, views: [{ ...OUTLINE, outline: stored }, TABLE] }))
    await flush() // mount adoption appends the unnamed members first (YAZ-1152)
    openSheet(el, 'Vault root')
    click(sheetButton('Add'))
    await flush()
    expect(doc(el)).toBe(`${stored}\n- [[Lead Gen]]\n- [[Nurture]]\n- [[KPIs]]\n- [[Other]]`)
  })

  it('a folder with nothing missing offers no Add at all, and dismissing writes nothing', async () => {
    const el = mount()
    openSheet(el, 'stages')
    expect(q(document.body, '[role="dialog"]').textContent).toContain('Nothing to add')
    expect(texts(document.body, '.confirm__btn')).toEqual(['Dismiss'])
    click(sheetButton('Dismiss'))
    await flush()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(write).not.toHaveBeenCalled()
  })

  it('Cancel writes nothing at all', async () => {
    const el = mount()
    openSheet(el, 'Vault root')
    click(sheetButton('Cancel'))
    await flush()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    expect(doc(el)).toBe('- [[Lead Gen]]\n- [[Nurture]]\n- [[Sales]]')
    expect(write).not.toHaveBeenCalled()
  })
})

describe('the seed-loss banner (YAZ-974): the editor reports, the view warns through its one error surface', () => {
  it('shows the read-only explanation when the editor reports a lossy seed', () => {
    mount()
    expect(editor.props?.onSeedLoss).toBeTypeOf('function')
    act(() => editor.props?.onSeedLoss?.())
    const alert = container?.querySelector('.view-view__error')
    expect(alert?.textContent ?? '').toMatch(/read-only/i)
    expect(alert?.textContent ?? '').toMatch(/file/i)
    // The banner wears the guard's own words alone — never the belonging-write lead-in.
    expect(alert?.textContent ?? '').not.toMatch(/could not update/i)
  })
})
