/**
 * The "Linked mentions" section (Links D, GRO-2193). Mounted with react-dom in jsdom over a REAL
 * `WikilinkResolveSource` (the App-owned feed) so snapshot swaps exercise the live path; `api` is
 * mocked so every `fs:read` is observable — the point of the lazy-on-expand rule.
 *
 * Pinned here: collapsed by default with N always visible, zero mentions render NOTHING, no file
 * is read until the section is expanded, snippets highlight the resolving link, plain/⌘ clicks
 * ride the tabs API, an unreadable file leaves its entry standing, and a fresh index snapshot
 * updates N live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { resolverFor } from '../views/engine'
import { createWikilinkResolveSource, type MutableWikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { BacklinksSection } from './BacklinksSection'
import backlinksCss from './backlinks.css?inline'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn() },
}))

import { api } from '../api'

const readFile = vi.mocked(api.readFile)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const rec = (path: string, init: { links?: string[]; embeds?: string[]; aliases?: string[]; mtime?: number } = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice('/vault/'.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: init.mtime ?? 1,
    properties: {},
    aliases: init.aliases ?? [],
    tags: [],
    links: init.links ?? [],
    embeds: init.embeds ?? [],
  }
}

const B = '/vault/B.md'
const A = '/vault/A.md'
const C = '/vault/Sub/C.md'

/** A + C both mention B (C through B's alias); D mentions nobody we care about. */
const RECORDS: IndexRecord[] = [
  rec(A, { links: ['B'] }),
  rec(B, { aliases: ['Bee'] }),
  rec('/vault/D.md', { links: ['Elsewhere'] }),
  rec(C, { links: ['Bee'] }),
]

const CONTENT: Record<string, string> = {
  [A]: '# A\n\nSee [[B]] for the details.\n',
  [C]: '# C\n\nrelated to [[Bee]] as well\n',
}

let root: Root | null = null
let container: HTMLElement | null = null
let source: MutableWikilinkResolveSource
const openCurrent = vi.fn()
const openBackground = vi.fn()

/** The bridge's own wrapping: THE shared resolver, unwrapped to a path. */
function feed(records: IndexRecord[]): void {
  const resolve = resolverFor(records, '/vault')
  act(() => source.update((target) => resolve(target)?.record.path ?? null, records))
}

function mount(path = B): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<BacklinksSection path={path} source={source} openCurrent={openCurrent} openBackground={openBackground} />))
  return container
}

async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

const header = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.backlinks__header')
const notes = (el: HTMLElement) => [...el.querySelectorAll('.backlinks__note')] as HTMLElement[]
const snippets = (el: HTMLElement) => [...el.querySelectorAll('.backlinks__snippet')] as HTMLElement[]

function click(el: Element, modifiers: { metaKey?: boolean } = {}): void {
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers })))
}

beforeEach(() => {
  vi.useFakeTimers()
  source = createWikilinkResolveSource()
  readFile.mockImplementation(async (path: string) => ({ path, content: CONTENT[path] ?? '', mtime: 1, size: 1 }))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.resetAllMocks()
  vi.useRealTimers()
})

describe('BacklinksSection (Links D, GRO-2193)', () => {
  it('renders nothing before the first index snapshot', () => {
    expect(mount().innerHTML).toBe('')
  })

  it('renders nothing at all when no note mentions this one (zero-mention rule)', () => {
    const el = mount('/vault/D.md')
    feed(RECORDS)
    expect(el.innerHTML).toBe('')
  })

  it('is COLLAPSED by default, shows N, and reads no file until expanded', async () => {
    const el = mount()
    feed(RECORDS)
    expect(header(el)?.textContent).toBe('Linked mentions (2)')
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('.backlinks__list')).toBeNull()
    await flush()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('expanding lists the referencing notes (basename + full-path tooltip) and lazily reads them', async () => {
    const el = mount()
    feed(RECORDS)
    click(header(el)!)
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    // Path order, one entry per referencing note.
    expect(notes(el).map((n) => n.textContent)).toEqual(['A', 'C'])
    expect(notes(el).map((n) => n.getAttribute('title'))).toEqual([A, C])
    // A skeleton stands in while the reads are in flight — never an empty flash.
    expect(el.querySelectorAll('.backlinks__skeleton')).toHaveLength(2)
    await flush()
    expect(readFile.mock.calls.map((c) => c[0]).sort()).toEqual([A, C])
    expect(el.querySelector('.backlinks__skeleton')).toBeNull()
  })

  it('shows one snippet per mention line, in display text, with the resolving link highlighted (alias form included)', async () => {
    const el = mount()
    feed(RECORDS)
    click(header(el)!)
    await flush()
    // FN9 (GRO-2197): snippets read as the EDITOR shows the line — display text, no brackets.
    expect(snippets(el).map((s) => s.textContent)).toEqual(['See B for the details.', 'related to Bee as well'])
    expect([...el.querySelectorAll('.backlinks__match')].map((m) => m.textContent)).toEqual(['B', 'Bee'])
  })

  it('clicks ride the tabs API: plain → current tab, ⌘ → background tab (entry and snippet alike)', async () => {
    const el = mount()
    feed(RECORDS)
    click(header(el)!)
    await flush()
    click(notes(el)[0])
    expect(openCurrent).toHaveBeenCalledWith(A)
    expect(openBackground).not.toHaveBeenCalled()
    click(notes(el)[1], { metaKey: true })
    expect(openBackground).toHaveBeenCalledWith(C)
    click(snippets(el)[0])
    expect(openCurrent).toHaveBeenLastCalledWith(A)
    click(snippets(el)[1], { metaKey: true })
    expect(openBackground).toHaveBeenLastCalledWith(C)
  })

  it('a failed read leaves the entry standing without snippets — never an error surface', async () => {
    readFile.mockRejectedValue(new Error('gone'))
    const el = mount()
    feed(RECORDS)
    click(header(el)!)
    await flush()
    expect(notes(el).map((n) => n.textContent)).toEqual(['A', 'C'])
    expect(snippets(el)).toHaveLength(0)
    expect(el.querySelector('.backlinks__skeleton')).toBeNull()
  })

  it('a fresh index snapshot updates N live — and drops the section when the last mention goes', async () => {
    const el = mount()
    feed(RECORDS)
    expect(header(el)?.textContent).toBe('Linked mentions (2)')
    // A's link removed on disk → the next snapshot is a new array with one mention left.
    feed([rec(A), rec(B, { aliases: ['Bee'] }), rec(C, { links: ['Bee'] })])
    expect(header(el)?.textContent).toBe('Linked mentions (1)')
    feed([rec(A), rec(B, { aliases: ['Bee'] }), rec(C)])
    expect(el.innerHTML).toBe('')
  })

  it('while expanded, a referencing note whose mtime moved re-reads its snippets (changed files only)', async () => {
    const el = mount()
    feed(RECORDS)
    click(header(el)!)
    await flush()
    expect(readFile).toHaveBeenCalledTimes(2)
    CONTENT[A] = '# A\n\nnow it says [[B]] twice: [[B]]\n'
    feed([rec(A, { links: ['B'], mtime: 2 }), rec(B, { aliases: ['Bee'] }), rec(C, { links: ['Bee'] })])
    await flush()
    expect(readFile).toHaveBeenCalledTimes(3) // only A was re-read
    expect(readFile.mock.calls[2]?.[0]).toBe(A)
    // FN10 (GRO-2197): two mentions on one line are ONE row with TWO highlights, not two rows.
    expect(snippets(el).map((s) => s.textContent)).toEqual(['now it says B twice: B', 'related to Bee as well'])
    expect([...snippets(el)[0].querySelectorAll('.backlinks__match')].map((m) => m.textContent)).toEqual(['B', 'B'])
    CONTENT[A] = '# A\n\nSee [[B]] for the details.\n'
  })

  it('the header draws no hairline above it (YAZ-1680)', () => {
    const rule = backlinksCss.match(/\.backlinks__header\s*\{([^}]*)\}/s)?.[1]
    expect(rule).toBeDefined()
    expect(rule).not.toMatch(/border/)
  })
})
