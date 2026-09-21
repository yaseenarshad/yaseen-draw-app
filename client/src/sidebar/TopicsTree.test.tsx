/**
 * The Topics tree (6B-, YAZ-848): the folder-page tree in the sidebar. Each case pins ONE locked
 * rule — the roots rule (🔒 D2, amended by YAZ-920), the row gestures (🔒 D3, amended by
 * YAZ-921), the keyboard walk (YAZ-921), the guarded descent (⚡ D6 of YAZ-814) with its own
 * per-level ordering ([D5]), page-path expansion (🔒 D4) and its persistence, the Uncategorized
 * section (🔒 D7), and the drag (YAZ-991) over YAZ-990's engine.
 *
 * THE YAZ-917 WAVE, which every fixture below is now shaped by: Home is a PINNED LEAF (YAZ-920) —
 * it leads the tree, wears a house instead of the folder glyph, counts nothing, offers no chevron
 * and descends into nothing — and the topics that named it as their parent stand at the ROOT
 * beside it. So a vault's topics live one indent shallower than they used to, and a fixture that
 * wants a second rung hangs it off a topic, never off Home.
 *
 * The feed is the real `WikilinkResolveSource` shape (records + resolver, always together) over a
 * hand-built snapshot, resolved by a basename map keyed exactly like `makeResolver`
 * (`folderPages.test.ts`'s helper). Persistence goes through the REAL `lib/storage` module over a
 * jsdom bridge stub, so the bucket, its patch and its restore are all exercised end to end.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The drag's ENGINE is landed and pinned on its own (YAZ-990, `topicsMove.test.ts`): only its ONE
// write is mocked here, so a confirmed move is observable, while `canDrop` — which decides what
// this view may even highlight — stays the real thing and can never be re-derived by the test.
vi.mock('./topicsMove', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./topicsMove')>()),
  performMove: vi.fn(),
}))

import { StrictMode, act, useEffect, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MAX_TOPICS_EXPANDED_PAGES, defaultAppState, defaultFolderState, defaultRightPanelIdentity, type AppState, type IndexRecord, type WindowIdentity } from '@shared/types'
import { stripBrackets } from '../views/expr'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { storage } from '../lib/storage'
import { EMPTY_SELECTION } from '../lib/selection'
import { folderPagesLookup } from '../links/folderPages'
import { performMove } from './topicsMove'
import { TopicsTree, allExpandableTopics, topicRevealPlan, topicRoots, uncategorizedDiskTree } from './TopicsTree'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const move = vi.mocked(performMove)

const ROOT = '/vault'

// ---------- the snapshot ----------

const rec = (path: string, properties: Record<string, unknown> = {}, aliases: string[] = []): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice(`${ROOT}/`.length)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: 'md',
    size: 1,
    ctime: 1,
    mtime: 1,
    properties,
    aliases,
    tags: [],
    links: [],
    embeds: [],
  }
}

/** A page carrying the strict flag. */
const folder = (path: string, properties: Record<string, unknown> = {}): IndexRecord => rec(path, { folder_page: true, ...properties })

/** The frontmatter a note declares its parents with. */
const belongs = (...entries: string[]): Record<string, unknown> => ({ folder_pages: entries })

/** A folder page's [D5] order, as the FIRST outline view's wikilink list. */
const ordered = (...order: string[]): Record<string, unknown> => ({
  folder_page_settings: { views: [{ type: 'outline', name: 'Outline', order }] },
})

/** Basename/alias → path, keyed like `makeResolver`: brackets stripped, `#`/`|` tail dropped, lowered. */
const resolverOver = (records: readonly IndexRecord[]): ResolveLink => {
  const byName = new Map<string, string>()
  for (const record of records) {
    byName.set(record.basename.toLowerCase(), record.path)
    for (const alias of record.aliases) byName.set(alias.toLowerCase(), record.path)
  }
  return (target) => byName.get(stripBrackets(target).replace(/[#|].*$/, '').trim().toLowerCase()) ?? null
}

/** The window's feed, pokeable: `update` swaps the snapshot and wakes every subscriber, as App's does. */
function sourceOver(records: readonly IndexRecord[]) {
  let snapshot = records
  const listeners = new Set<() => void>()
  const source: WikilinkResolveSource & { update: (next: readonly IndexRecord[]) => void } = {
    get records() {
      return snapshot
    },
    get resolve() {
      return snapshot.length === 0 ? null : resolverOver(snapshot)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update(next) {
      snapshot = next
      listeners.forEach((l) => l())
    },
  }
  return source
}

/**
 * The standing vault: Home leads as the pinned leaf (a folder page), Metrics names Home as its
 * parent and so stands at the root BESIDE it since YAZ-920 — with two members of its own —
 * Projects is a third root with nobody in it, and Loose belongs nowhere.
 */
const HOME = `${ROOT}/Home.md`
const METRICS = `${ROOT}/Metrics.md`
const PROJECTS = `${ROOT}/Projects.md`
const vault = (): IndexRecord[] => [
  folder(HOME),
  folder(METRICS, belongs('[[Home]]')),
  folder(PROJECTS),
  rec(`${ROOT}/Revenue.md`, belongs('[[Metrics]]')),
  rec(`${ROOT}/Churn.md`, belongs('[[Metrics]]')),
  rec(`${ROOT}/Loose.md`),
]

// ---------- the bridge + mount harness ----------

let bridgeSetFolder = vi.fn(async () => undefined)

async function initStorage(state: AppState = defaultAppState()): Promise<void> {
  bridgeSetFolder = vi.fn(async () => undefined)
  const bridge = {
    state: { get: vi.fn(async () => state), setFolder: bridgeSetFolder, onChange: vi.fn(() => () => undefined) },
    window: { identity: vi.fn(async (): Promise<WindowIdentity> => ({ id: 'w1', root: ROOT, file: null, tabs: [], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: 'topics', focusDirs: [], focusTopics: [], focusFavorites: [] })) },
  }
  Object.defineProperty(window, 'yaseenDraw', { value: bridge, configurable: true, writable: true })
  await storage.init()
}

let root: Root | null = null
let container: HTMLElement | null = null

type Props = Parameters<typeof TopicsTree>[0]
/** What the harness hands over: the tree's props minus the ones its OWNER supplies, plus the vault. */
type OwnedProps = Omit<Props, 'expanded' | 'onExpandedChange'> & { root: string }

/**
 * ⚡ YAZ-873 lifted the expansion into the Sidebar, so the tree is CONTROLLED. This is that owner
 * in miniature — the same restore from the per-vault bucket and the same idempotent write-back —
 * so every case below still drives the real gestures and still proves the persistence end to end.
 */
function Controlled({ root, ...props }: OwnedProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(storage.getTopicsExpanded(root)))
  useEffect(() => {
    const next = [...expanded]
    const stored = storage.getTopicsExpanded(root)
    if (stored.length === next.length && stored.every((path, i) => path === next[i])) return
    storage.setTopicsExpanded(root, next)
  }, [root, expanded])
  return <TopicsTree root={root} {...props} expanded={expanded} onExpandedChange={setExpanded} />
}

async function mount(over: Partial<OwnedProps> & { source: Props['source'] }) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  container = el
  root = createRoot(el)
  const props: OwnedProps = {
    root: ROOT,
    focus: [],
    activeFile: null,
    onOpenFile: vi.fn(),
    onOpenFileBackground: vi.fn(),
    // Multi-select (YAZ-1336): the SIDEBAR owns the set and this lens only draws it, so the
    // default is nothing selected and the two gestures are spies — the "shift+click" describe
    // hands over a populated set of its own.
    selection: { paths: EMPTY_SELECTION, toggle: vi.fn(), set: vi.fn() },
    // 6C's offer (YAZ-849): every case below runs on an ADOPTED vault, where the card never
    // shows; the "the offer card" describe is the one that flips this.
    unadopted: false,
    onCreateHome: vi.fn(),
    // The menu, the inline rename and the inline create all belong to the SIDEBAR (8G-,
    // YAZ-865): this component only reports the row and draws whatever it is handed. The
    // whole gesture is pinned end to end in `Sidebar.test.tsx`, where the real menu renders.
    onRowContextMenu: vi.fn(),
    renaming: null,
    creating: null,
    // The panel's passive notice, handed down from the Sidebar (YAZ-991): the drag's one failure
    // route, so a confirmed move that never reaches disk cannot vanish silently.
    onNotice: vi.fn(),
    revealRequest: null,
    ...over,
  }
  await act(async () => root?.render(<StrictMode><Controlled {...props} /></StrictMode>))
  const rerender = async (next: Partial<OwnedProps>) =>
    act(async () => root?.render(<StrictMode><Controlled {...props} {...next} /></StrictMode>))
  return { el, props, rerender }
}

/**
 * The tree's own element: since YAZ-921 the whole lens renders inside ONE div carrying the
 * keyboard walk's `onKeyDown`, so the offer card and the `<ul>`s are ITS children, not the
 * mount container's — and a keydown dispatched anywhere inside reaches the handler by bubbling.
 */
const host = (el: HTMLElement) => el.firstElementChild as HTMLElement
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.tree__row')]
const labels = (el: HTMLElement) => rows(el).map((r) => r.querySelector('.tree__label')?.textContent ?? '')
const rowFor = (el: HTMLElement, label: string) => rows(el).find((r) => r.querySelector('.tree__label')?.textContent === label)
const countOn = (el: HTMLElement, label: string) => rowFor(el, label)?.querySelector('.tree__count')?.textContent ?? null
const indentOf = (el: HTMLElement, label: string) => rowFor(el, label)?.style.paddingLeft ?? null
const chevrons = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLElement>(`[aria-label="${label}"]`)]
/** A real MOUSE click (`detail: 1`) — the browser's Enter-on-a-button synthetic click reports
    `detail: 0`, which is how the rows tell the two modalities apart (YAZ-947); keyboard cases
    pass `{ detail: 0 }` explicitly. */
const click = async (node: Element, init: MouseEventInit = {}) => act(async () => void node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...init })))
/** One key press, from wherever it is dispatched — the walk reads `document.activeElement` itself. */
const press = async (node: Element, key: string) => act(async () => void node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
/** The label of the row DOM focus stands on, or null when focus is outside the rows. */
const focused = (el: HTMLElement) => rows(el).find((r) => r === document.activeElement)?.querySelector('.tree__label')?.textContent ?? null

beforeEach(async () => {
  await initStorage()
})

describe('Show in sidebar reveal planning (YAZ-1064)', () => {
  const SHARED = `${ROOT}/Shared.md`

  it('unions only the ancestor topics needed for every multi-parent occurrence', () => {
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(PROJECTS),
      rec(SHARED, belongs('[[Metrics]]', '[[Projects]]')),
      folder(`${ROOT}/Archive.md`),
    ]
    const resolve = resolverOver(records)
    expect(topicRevealPlan(records, folderPagesLookup(records, resolve), resolve, SHARED)).toEqual({
      found: true,
      ancestors: [METRICS, PROJECTS],
      uncategorized: false,
    })
  })

  it('adds no expansion for a root and routes an undrawn note only to Uncategorized', () => {
    const records = vault()
    const resolve = resolverOver(records)
    const lookup = folderPagesLookup(records, resolve)
    expect(topicRevealPlan(records, lookup, resolve, METRICS)).toEqual({ found: true, ancestors: [], uncategorized: false })
    expect(topicRevealPlan(records, lookup, resolve, `${ROOT}/Loose.md`)).toEqual({ found: true, ancestors: [], uncategorized: true })
    expect(topicRevealPlan(records, lookup, resolve, `${ROOT}/Missing.md`)).toEqual({ found: false, ancestors: [], uncategorized: false })
  })

  it('opens the union for all occurrences while preserving an unrelated closed topic', async () => {
    const SHARED_TOPIC = `${ROOT}/Shared Topic.md`
    const LEAF = `${ROOT}/Leaf.md`
    const ARCHIVE = `${ROOT}/Archive.md`
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(PROJECTS),
      folder(ARCHIVE),
      folder(SHARED_TOPIC, belongs('[[Metrics]]', '[[Projects]]')),
      rec(LEAF, belongs('[[Shared Topic]]')),
      rec(`${ROOT}/Hidden.md`, belongs('[[Archive]]')),
    ]
    const { el } = await mount({ source: sourceOver(records), revealRequest: { id: 1, path: LEAF, lens: 'topics' } })
    const revealed = rows(el).filter((row) => row.dataset.path === LEAF)
    expect(revealed).toHaveLength(2)
    expect(revealed.every((row) => row.classList.contains('tree__row--revealed'))).toBe(true)
    expect(labels(el)).not.toContain('Hidden')
  })

  it('opens only Uncategorized when that is the target note\'s sole location', async () => {
    const { el } = await mount({ source: sourceOver(vault()), revealRequest: { id: 1, path: `${ROOT}/Loose.md`, lens: 'topics' } })
    expect(rowFor(el, 'Loose')?.classList.contains('tree__row--revealed')).toBe(true)
    expect(labels(el)).not.toContain('Revenue')
    expect(labels(el)).not.toContain('Churn')
  })

  it('reopens collapsed disk ancestors before revealing a nested Uncategorized note', async () => {
    const nested = rec(`${ROOT}/inbox/deep/Alpha.md`)
    const { el, rerender } = await mount({ source: sourceOver([nested]) })
    await click(rowFor(el, 'Uncategorized')!)
    await click(rowFor(el, 'inbox')!)
    expect(rowFor(el, 'Alpha')).toBeUndefined()

    await rerender({ revealRequest: { id: 1, path: nested.path, lens: 'topics' } })
    expect(rowFor(el, 'inbox')?.parentElement?.getAttribute('aria-expanded')).toBe('true')
    expect(rowFor(el, 'deep')?.parentElement?.getAttribute('aria-expanded')).toBe('true')
    expect(rowFor(el, 'Alpha')).toBeDefined()
  })

  it('reports one passive notice after a coherent Topics feed cannot show the path', async () => {
    const { props } = await mount({ source: sourceOver(vault()), revealRequest: { id: 1, path: `${ROOT}/Missing.md`, lens: 'topics' } })
    expect(props.onNotice).toHaveBeenCalledExactlyOnceWith('Can\'t show "Missing.md" in Topics — it is no longer there')
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  // The commit gesture (YAZ-921) reaches for the editor by DOM query, so its stand-in lives in
  // the document beside the mount — and must not survive into the next case.
  document.querySelectorAll('.editor-instance').forEach((node) => node.remove())
  delete (window as unknown as Record<string, unknown>).yaseenDraw
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------- ⚡ YAZ-873: the expand-all set

describe('allExpandableTopics (⚡ YAZ-873): every page the tree could unfold, once, loop-safe, capped', () => {
  const setOf = (records: readonly IndexRecord[]) => {
    const resolve = resolverOver(records)
    return allExpandableTopics(records, folderPagesLookup(records, resolve), resolve)
  }

  it('collects every folder page the TREE can unfold — never the pinned-leaf Home, never a page it cannot draw', () => {
    // Home is a leaf now (YAZ-920) and unfolds nothing, so it is never in the set. The A↔B loop
    // hangs only off Home: the tree draws neither (they stand in Uncategorized, flat), so neither
    // can unfold. Shared descends from Projects, its real parent, exactly as the rows do.
    const records = [
      folder(HOME),
      folder(PROJECTS),
      folder(`${ROOT}/A.md`, belongs('[[Home]]', '[[B]]')),
      folder(`${ROOT}/B.md`, belongs('[[A]]')),
      folder(`${ROOT}/Shared.md`, belongs('[[Home]]', '[[Projects]]')),
      rec(`${ROOT}/Leaf.md`, belongs('[[Shared]]')),
    ]
    expect([...setOf(records)].sort()).toEqual([PROJECTS, `${ROOT}/Shared.md`].sort())
  })

  it('the pinned-leaf Home is never expandable, however many members it claims', () => {
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), rec(`${ROOT}/Leaf.md`, belongs('[[Metrics]]'))]
    expect(setOf(records)).toEqual([METRICS])
  })

  it('a leaf-only vault and an empty feed both answer nothing', () => {
    expect(setOf([folder(PROJECTS), rec(`${ROOT}/Loose.md`)])).toEqual([])
    expect(allExpandableTopics([], folderPagesLookup([], () => null), null)).toEqual([])
  })

  it('caps at MAX_TOPICS_EXPANDED_PAGES — the bucket the answer is written into', () => {
    // A chain of 600 folder pages, each the sole member of the one before it: 599 can unfold.
    const chain: IndexRecord[] = [folder(`${ROOT}/T000.md`)]
    for (let i = 1; i < 600; i++) {
      const name = `T${String(i).padStart(3, '0')}`
      chain.push(folder(`${ROOT}/${name}.md`, belongs(`[[T${String(i - 1).padStart(3, '0')}]]`)))
    }
    expect(setOf(chain)).toHaveLength(MAX_TOPICS_EXPANDED_PAGES)
  })
})

// ---------------------------------------------------------------- 🔒 D2: the roots

describe('the roots rule (🔒 D2, as YAZ-920 amends it): the pinned Home, then every topic it held', () => {
  const rootsOf = (records: readonly IndexRecord[]) => {
    const resolve = records.length === 0 ? null : resolverOver(records)
    return topicRoots(records, folderPagesLookup(records, resolve ?? (() => null)), resolve).map((r) => r.path)
  }

  it('puts Home first, then every folder page whose parents-minus-Home are empty, path-sorted', () => {
    // Metrics names Home as its parent and is a ROOT anyway (YAZ-920): Home is no longer the
    // umbrella everything hangs under, so the tree stops opening one indent deep on every vault
    // whose Home lists all its topics.
    expect(rootsOf(vault())).toEqual([HOME, METRICS, PROJECTS])
    // Path order, not declaration order: the snapshot below lists them backwards.
    const records = [folder(`${ROOT}/Zebra.md`), folder(`${ROOT}/Alpha.md`), folder(HOME)]
    expect(rootsOf(records)).toEqual([HOME, `${ROOT}/Alpha.md`, `${ROOT}/Zebra.md`])
  })

  it('resolves Home the way a CLICK would — case-insensitively and through an alias', () => {
    expect(rootsOf([folder(`${ROOT}/home.md`), folder(PROJECTS)])).toEqual([`${ROOT}/home.md`, PROJECTS])
    const aliased = rec(`${ROOT}/Start Here.md`, { folder_page: true }, ['Home'])
    expect(rootsOf([aliased, folder(PROJECTS)])).toEqual([`${ROOT}/Start Here.md`, PROJECTS])
  })

  it('an ORDINARY page called Home is no Home for the tree — no row, and the other roots still stand', async () => {
    const records = [rec(HOME), folder(PROJECTS)]
    expect(rootsOf(records)).toEqual([PROJECTS])
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Projects', 'Uncategorized'])
  })

  it('a folder page with a real NON-Home parent is not a root — it nests under that parent only', async () => {
    const SUB = `${ROOT}/Sub.md`
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), folder(SUB, belongs('[[Metrics]]'))]
    // Metrics is promoted (Home is its only parent); Sub is not (Metrics is a real parent).
    expect(rootsOf(records)).toEqual([HOME, METRICS])
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Home', 'Metrics'])
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Sub'])
  })

  it('a vault with NO Home keeps the old rule: every UNPARENTED folder page is a root, and only those', () => {
    // Nothing answers `[[Home]]`, so nothing is promoted — a parent is a parent again.
    const records = [folder(PROJECTS), folder(METRICS, belongs('[[Projects]]')), folder(`${ROOT}/Alpha.md`)]
    expect(rootsOf(records)).toEqual([`${ROOT}/Alpha.md`, PROJECTS])
  })

  it('Home is a PINNED LEAF: a house, no count, no chevron, and it descends into nothing', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    const home = rowFor(el, 'Home')!
    // The house (YAZ-920), not `FolderPageGlyph` — whose square-and-cross is a rect plus lines.
    expect(home.querySelector('.tree__glyph path')).not.toBeNull()
    expect(home.querySelector('.tree__glyph rect')).toBeNull()
    expect(rowFor(el, 'Metrics')?.querySelector('.tree__glyph rect')).not.toBeNull()
    // No count and no chevron: its members are the roots standing beside it, not a fold.
    expect(countOn(el, 'Home')).toBeNull()
    expect(home.querySelector('.tree__chevron--none')).not.toBeNull()
    expect(chevrons(el, 'Expand Home')).toHaveLength(0)
    // …and the row cannot be made to descend from any direction: clicking it opens, only.
    await click(home)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })

  it('a Home that belongs somewhere still LEADS — and can never appear inside itself', async () => {
    // Home names Projects as its parent: it is both the lead root and a member of Projects.
    const records = [folder(HOME, belongs('[[Projects]]')), folder(PROJECTS)]
    expect(rootsOf(records)).toEqual([HOME, PROJECTS])
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Projects')[0])
    // Projects > Home, and there is no third rung: the nested Home is the SAME pinned leaf
    // (YAZ-920) wherever it stands, so it descends into nothing and offers no chevron either.
    expect(labels(el)).toEqual(['Home', 'Projects', 'Home'])
    expect(chevrons(el, 'Expand Home')).toHaveLength(0)
  })

  it('what the tree cannot draw stands in Uncategorized: a note whose only parent is the leaf Home', async () => {
    // Guide's one parent is Home — which unfolds nothing (YAZ-920), so no row would draw it.
    // 🔒 D7's honest answer, as YAZ-920 amends it: Uncategorized is what the tree does NOT draw,
    // computed from the SAME descent the rows come from — never "no parents" read off the index.
    const GUIDE = `${ROOT}/Guide.md`
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), rec(GUIDE, belongs('[[Home]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Uncategorized'])
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Uncategorized', 'Guide'])
  })

  it('an A↔B loop hanging only off Home surfaces in Uncategorized instead of vanishing', async () => {
    // Neither is promoted (each has a non-Home parent: the other), neither is reachable from any
    // root — before the reachability rule they had NO row anywhere. Nothing silently disappears.
    const records = [folder(HOME), folder(`${ROOT}/A.md`, belongs('[[Home]]', '[[B]]')), folder(`${ROOT}/B.md`, belongs('[[A]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Uncategorized', 'A', 'B'])
  })

  it('an empty snapshot (before the first index) renders NOTHING — not even the Uncategorized row', async () => {
    const { el } = await mount({ source: sourceOver([]) })
    expect(rows(el)).toHaveLength(0)
    expect(el.textContent).toBe('')
  })
})

// ------------------------------------------------------------- ⚡ YAZ-1605: Focus Mode's narrowing

/**
 * FOCUS MODE narrows the whole lens to the topics the user chose: the focused folder pages ARE
 * the roots, in the ORDER they were chosen, and everything outside them — the pinned-leaf Home,
 * the sibling topics, the Uncategorized section — is simply not there. `topicRoots` is the one
 * door the rows, the expand-all set and the orphan walk all come through, so the three can never
 * disagree; a focus that names no folder page any more falls THROUGH to the full rule rather than
 * leaving an empty tree behind.
 */
describe('topicRoots under a focus (YAZ-1605): the chosen folder pages, in the chosen order', () => {
  const rootsOf = (records: readonly IndexRecord[], focus: readonly string[]) => {
    const resolve = records.length === 0 ? null : resolverOver(records)
    return topicRoots(records, folderPagesLookup(records, resolve ?? (() => null)), resolve, focus).map((r) => r.path)
  }

  it('one focused topic is the ONLY root — no pinned Home, no sibling topics', () => {
    expect(rootsOf(vault(), [METRICS])).toEqual([METRICS])
  })

  it('keeps the ORDER the focus was given in, not the path order the full rule sorts by', () => {
    expect(rootsOf(vault(), [PROJECTS, METRICS])).toEqual([PROJECTS, METRICS])
  })

  it('a focus naming a PLAIN page falls through to the full rule — a note is no topic', () => {
    expect(rootsOf(vault(), [`${ROOT}/Loose.md`])).toEqual([HOME, METRICS, PROJECTS])
  })

  it('a focus naming a path the snapshot no longer holds falls through to the full rule', () => {
    expect(rootsOf(vault(), [`${ROOT}/Gone.md`])).toEqual([HOME, METRICS, PROJECTS])
  })

  it('a focus mixing a topic with a plain page keeps only the topic', () => {
    expect(rootsOf(vault(), [`${ROOT}/Loose.md`, METRICS])).toEqual([METRICS])
  })

  it('focusing Home itself makes it the lone root — this rule does not special-case it', () => {
    // Whether Home may be FOCUSED at all is the Sidebar menu's gate (pinned there); the roots
    // rule just obeys the list it is handed.
    expect(rootsOf(vault(), [HOME])).toEqual([HOME])
  })
})

describe('allExpandableTopics under a focus (YAZ-1605): only the focused subtrees can unfold', () => {
  const setOf = (records: readonly IndexRecord[], focus: readonly string[]) => {
    const resolve = resolverOver(records)
    return allExpandableTopics(records, folderPagesLookup(records, resolve), resolve, focus)
  }

  it('lists only pages reachable from the focused topic — a sibling topic\'s foldables are absent', () => {
    const SUB = `${ROOT}/Sub.md`
    const OTHER = `${ROOT}/Other.md`
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(SUB, belongs('[[Metrics]]')),
      rec(`${ROOT}/Deep.md`, belongs('[[Sub]]')),
      folder(PROJECTS),
      folder(OTHER, belongs('[[Projects]]')),
      rec(`${ROOT}/Leaf.md`, belongs('[[Other]]')),
    ]
    expect(setOf(records, [METRICS])).toEqual([METRICS, SUB])
  })

  it('a loop under the focused topic still ends — the trail guard travels with the descent', () => {
    const records = [folder(PROJECTS), folder(`${ROOT}/A.md`, belongs('[[Projects]]', '[[B]]')), folder(`${ROOT}/B.md`, belongs('[[A]]'))]
    // B's one member is A, already standing above it on this trail, so B unfolds nothing.
    expect(setOf(records, [PROJECTS])).toEqual([PROJECTS, `${ROOT}/A.md`])
  })
})

describe('the tree under a focus (YAZ-1605): the focused topics ARE the tree', () => {
  it('draws ONE focused topic at depth 0 with its members — no Home, no siblings, no Uncategorized', async () => {
    // Loose belongs nowhere and heads an Uncategorized section on the full tree (🔒 D7); under a
    // focus that section is gone entirely, because everything outside the focus is hidden.
    const { el } = await mount({ source: sourceOver(vault()), focus: [METRICS] })
    expect(labels(el)).toEqual(['Metrics'])
    expect(indentOf(el, 'Metrics')).toBe('8px')
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(labels(el)).toEqual(['Metrics', 'Churn', 'Revenue'])
  })

  it('draws two focused topics as roots in the ORDER they were focused', async () => {
    const { el } = await mount({ source: sourceOver(vault()), focus: [PROJECTS, METRICS] })
    expect(labels(el)).toEqual(['Projects', 'Metrics'])
  })

  it('a focus that resolves to no topic draws the FULL tree — the fall-through, on screen', async () => {
    const { el } = await mount({ source: sourceOver(vault()), focus: [`${ROOT}/Loose.md`] })
    // The full tree, Uncategorized INCLUDED: the orphan walk keys off whether the focus resolved,
    // exactly as the roots rule does, so Loose keeps its row instead of vanishing from both.
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })

  it('a page claimed by two focused topics still renders under EACH (⚡ D6, under a focus)', async () => {
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), folder(PROJECTS), rec(`${ROOT}/Shared.md`, belongs('[[Metrics]]', '[[Projects]]'))]
    const { el } = await mount({ source: sourceOver(records), focus: [METRICS, PROJECTS] })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Metrics', 'Shared', 'Projects', 'Shared'])
  })
})

// ---------------------------------------------------------------- 🔒 D3: the rows

describe('the rows (🔒 D3): the file tree\'s two open handlers, a chevron of its own, glyph + count', () => {
  it('a row click OPENS the page and ⌘-click sends it to a background tab', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Home')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(HOME)
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    await click(rowFor(el, 'Projects')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(PROJECTS)
    expect(props.onOpenFile).toHaveBeenCalledTimes(1)
  })

  it('the chevron only EXPANDS — it never opens the page under it', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    await click(chevrons(el, 'Collapse Metrics')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })

  it('folder-page rows wear the glyph and their DIRECT-member count; leaves wear neither', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(countOn(el, 'Metrics')).toBe('2')
    expect(countOn(el, 'Projects')).toBe('0')
    expect(countOn(el, 'Revenue')).toBeNull()
    // Home is the one folder page that counts NOTHING (YAZ-920) — its own case is pinned with
    // the roots rule above, beside the house it wears in place of the glyph.
    expect(countOn(el, 'Home')).toBeNull()
    expect(rowFor(el, 'Metrics')?.querySelector('.tree__glyph')).not.toBeNull()
    expect(rowFor(el, 'Revenue')?.querySelector('.tree__glyph')).toBeNull()
  })

  it('indents by 8 + depth * 14, exactly as the file tree does', async () => {
    // Three rungs since YAZ-920 means hanging them off a TOPIC: Home is a leaf and holds none.
    const SUB = `${ROOT}/Sub.md`
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), folder(SUB, belongs('[[Metrics]]')), rec(`${ROOT}/Revenue.md`, belongs('[[Sub]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Sub')[0])
    expect(indentOf(el, 'Metrics')).toBe('8px')
    expect(indentOf(el, 'Sub')).toBe('22px')
    expect(indentOf(el, 'Revenue')).toBe('36px')
  })

  it('the open file is highlighted wherever it stands', async () => {
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(PROJECTS),
      rec(`${ROOT}/Shared.md`, belongs('[[Metrics]]', '[[Projects]]')),
    ]
    const { el } = await mount({ source: sourceOver(records), activeFile: `${ROOT}/Shared.md` })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(rows(el).filter((r) => r.classList.contains('tree__row--active'))).toHaveLength(2)
  })
})

// ------------------------------------------- ⚡ YAZ-870 + YAZ-921: the row unfolds, then commits

/**
 * The row gesture, in the shape YAZ-921 leaves it. YAZ-870's ruling still stands where it was
 * aimed — NAVIGATION never folds the tree under you — but YAZ-921 splits off the two gestures
 * that are not navigation:
 *
 *  - the TOPIC you are already reading toggles its fold on every activation, BOTH directions,
 *    and opens nothing (its document IS its outline, so there is nowhere else to go);
 *  - the PLAIN page you are already reading COMMITS: the caret jumps into the editor's own
 *    ProseMirror node instead of opening the file a second time.
 *
 * ⌘-click is untouched: a background tab, no unfold, no caret.
 */
describe('the row gesture: open + unfold (⚡ YAZ-870), then toggle or commit (YAZ-921)', () => {
  const REVENUE = `${ROOT}/Revenue.md`
  /** Stands in for the mounted editor, so a commit has a real caret target to land on. */
  /** A ProseMirror stand-in that models the browser's visibility answer (YAZ-947): the commit
      gesture picks the first VISIBLE editor via `offsetParent`, which layoutless jsdom always
      answers `null` — so the stub declares its own, like the browser would. */
  const editorStub = (visible = true): HTMLElement => {
    const instance = document.createElement('div')
    instance.className = 'editor-instance'
    const pm = document.createElement('div')
    pm.className = 'ProseMirror'
    pm.tabIndex = -1
    Object.defineProperty(pm, 'offsetParent', { get: () => (visible ? document.body : null) })
    instance.appendChild(pm)
    document.body.appendChild(instance)
    return pm
  }

  it('a row click on a topic you are NOT on opens it AND expands it in place', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Metrics')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(METRICS)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    // …and through the same 🔒 D4 bucket a chevron expansion takes, so it persists.
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS])
  })

  it('a second click on a topic you are NOT on still only unfolds — navigation cannot fold the tree under you', async () => {
    // ⚡ YAZ-870's add-only half, exactly where it was aimed: `activeFile` is still elsewhere,
    // so both clicks are real navigation and the second one leaves the fold open.
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Metrics')!)
    await click(rowFor(el, 'Metrics')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    await click(chevrons(el, 'Collapse Metrics')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })

  it('clicking the TOPIC you are already reading TOGGLES its fold — both directions, and never navigates', async () => {
    // YAZ-921's amendment on ⚡ YAZ-870: a click on the page you are already on is not
    // navigation, so it is free to fold — and it must not re-open the file either.
    const { el, props } = await mount({ source: sourceOver(vault()), activeFile: METRICS })
    await click(rowFor(el, 'Metrics')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    await click(rowFor(el, 'Metrics')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('⌘-click still means "not now": a background tab, the tree does not move, the caret stays put', async () => {
    const pm = editorStub()
    const { el, props } = await mount({ source: sourceOver(vault()), activeFile: METRICS })
    await click(rowFor(el, 'Metrics')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(METRICS)
    // Neither of YAZ-921's two gestures fires under ⌘: no toggle, and no commit into the text.
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
    expect(document.activeElement).not.toBe(pm)
  })

  it('a folder page with nothing under it just opens — nothing to unfold, nothing recorded', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Projects')!)
    expect(props.onOpenFile).toHaveBeenCalledWith(PROJECTS)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
  })

  it('the FIRST activation of a plain page opens it and leaves focus in the tree', async () => {
    const pm = editorStub()
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Revenue')!)
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(REVENUE)
    // The walk stays armed: nothing reaches into the editor on the way in.
    expect(document.activeElement).not.toBe(pm)
  })

  it('Enter (detail 0) on the plain page you are already reading COMMITS: the caret, not another open', async () => {
    const pm = editorStub()
    const { el, props } = await mount({ source: sourceOver(vault()), activeFile: REVENUE })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Revenue')!, { detail: 0 })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(pm)
  })

  it('a MOUSE click on the page you are already reading only SELECTS it (D11, YAZ-1674): no open, no caret jump', async () => {
    // Click-then-⌘C must work on the open note too: a caret jump would hand the key to the editor.
    const pm = editorStub()
    const { el, props } = await mount({ source: sourceOver(vault()), activeFile: REVENUE })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Revenue')!)
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.selection.set).toHaveBeenCalledWith(REVENUE)
    expect(document.activeElement).not.toBe(pm)
  })

  it('keyboard Enter (detail 0) on a topic OPENS it and moves the tree not at all (YAZ-947)', async () => {
    // Enter through the walk is a browser-synthetic click with detail 0 — the row's one tell.
    // ←/→ are the only keyboard folds; previewing topics never rearranges the panel underfoot.
    const { el, props } = await mount({ source: sourceOver(vault()) })
    await click(rowFor(el, 'Metrics')!, { detail: 0 })
    expect(props.onOpenFile).toHaveBeenCalledWith(METRICS)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
  })

  it('keyboard Enter on the ACTIVE topic does not toggle either — it commits, like a plain page (YAZ-947)', async () => {
    const pm = editorStub()
    const { el, props } = await mount({ source: sourceOver(vault()), activeFile: METRICS })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Metrics')!, { detail: 0 })
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized']) // still open
    expect(document.activeElement).toBe(pm)
  })

  it('the commit lands in the VISIBLE editor — a folder page hides its body, so the outline takes the caret (YAZ-947)', async () => {
    const hiddenBody = editorStub(false)
    const outline = editorStub()
    const { el } = await mount({ source: sourceOver(vault()), activeFile: METRICS })
    await click(rowFor(el, 'Metrics')!, { detail: 0 })
    expect(document.activeElement).not.toBe(hiddenBody)
    expect(document.activeElement).toBe(outline)
  })
})

// ---------------------------------------------------------------- YAZ-921: the keyboard walk

/**
 * Walking the tree from the keyboard (YAZ-921). The whole lens is wrapped in ONE div carrying an
 * `onKeyDown`, so every row's key press is answered in one place:
 *
 *  - ↓ / ↑ rove DOM focus across every `.tree__row` in DOCUMENT order — topics, pages and the
 *    Uncategorized rows alike. From outside the rows ↓ enters at the first and ↑ at the last;
 *    both ends CLAMP rather than wrap.
 *  - ← folds the focused row and → unfolds it, through the same expanded / onExpandedChange
 *    contract the chevron uses and WITHOUT ever opening the page (Enter is the visit). Only in
 *    the direction there is somewhere to go, and only on a row with a REAL chevron: leaves and
 *    the Uncategorized header (which carries no `data-path`) ignore both.
 */
describe('the keyboard walk (YAZ-921): ↑/↓ rove focus, ←/→ fold without visiting', () => {
  it('every topic row carries its own data-path; the Uncategorized header carries none', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    expect(rows(el).map((r) => r.dataset.path)).toEqual([HOME, METRICS, PROJECTS, undefined])
  })

  it('↓ enters at the first row and walks every visible row in document order, clamping at the end', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(focused(el)).toBeNull() // from OUTSIDE the rows
    await press(host(el), 'ArrowDown')
    expect(focused(el)).toBe('Home')
    for (const next of ['Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized']) {
      await press(document.activeElement as Element, 'ArrowDown')
      expect(focused(el)).toBe(next)
    }
    await press(document.activeElement as Element, 'ArrowDown')
    expect(focused(el)).toBe('Uncategorized') // the end clamps; it never wraps round to Home
  })

  it('↑ enters at the LAST row and walks back up, clamping at the top', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await press(host(el), 'ArrowUp')
    expect(focused(el)).toBe('Uncategorized')
    for (const next of ['Projects', 'Metrics', 'Home']) {
      await press(document.activeElement as Element, 'ArrowUp')
      expect(focused(el)).toBe(next)
    }
    await press(document.activeElement as Element, 'ArrowUp')
    expect(focused(el)).toBe('Home')
  })

  it('→ unfolds the focused row and ← folds it — through the 🔒 D4 bucket, and never opening it', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    const metrics = rowFor(el, 'Metrics')!
    metrics.focus()
    await press(metrics, 'ArrowRight')
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS])
    await press(metrics, 'ArrowLeft')
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
    // The walk tidies the tree; it never visits. Enter (the row's own click) is the visit.
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
  })

  it('each arrow acts in ONE direction only: → on an open row and ← on a closed one do nothing', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    const metrics = rowFor(el, 'Metrics')!
    metrics.focus()
    await press(metrics, 'ArrowLeft') // already closed
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    await press(metrics, 'ArrowRight')
    await press(metrics, 'ArrowRight') // already open — not a toggle
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS])
  })

  it('a row with no REAL chevron ignores ←/→: the pinned Home, a leaf, and the Uncategorized header', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    for (const label of ['Home', 'Projects', 'Uncategorized']) {
      const row = rowFor(el, label)!
      row.focus()
      await press(row, 'ArrowRight')
      await press(row, 'ArrowLeft')
    }
    // Nothing unfolded — the header's own section included, which ← / → must not drive.
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([])
  })
})

// ---------------------------------------------------------------- ⚡ D6 + [D5]: the descent

describe('the descent: guardedChildren only (⚡ D6), ordered per level by its OWN settings ([D5])', () => {
  it('orders each level by that level\'s folder page, falling back to alphabetical', async () => {
    // The ordering lives on the folder page that OWNS the members, so since YAZ-920 it is pinned
    // on a topic rather than on Home — which now owns nobody to order.
    const records = [
      folder(HOME),
      folder(METRICS, { ...belongs('[[Home]]'), ...ordered('[[Zulu]]') }),
      rec(`${ROOT}/Alpha.md`, belongs('[[Metrics]]')),
      rec(`${ROOT}/Zulu.md`, belongs('[[Metrics]]')),
      folder(`${ROOT}/Mid.md`, belongs('[[Metrics]]')),
      rec(`${ROOT}/Beta.md`, belongs('[[Mid]]')),
      rec(`${ROOT}/Aleph.md`, belongs('[[Mid]]')),
    ]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    // Metrics' own `order` places Zulu first; the unlisted rest follow alphabetically. (Every page
    // here has a home and Home itself is a root, so there is no Uncategorized row at all.)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Zulu', 'Alpha', 'Mid'])
    await click(chevrons(el, 'Expand Mid')[0])
    // Mid declares no order at all, so ITS level is all-alphabetical — Metrics' order says nothing here.
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Zulu', 'Alpha', 'Mid', 'Aleph', 'Beta'])
  })

  it('an A ↔ B loop renders FINITELY: the branch ends quietly where an ancestor comes round again', async () => {
    // A's parents are Projects AND B, so YAZ-920 promotes nothing here: the loop hangs off a root.
    const records = [folder(PROJECTS), folder(`${ROOT}/A.md`, belongs('[[Projects]]', '[[B]]')), folder(`${ROOT}/B.md`, belongs('[[A]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Projects')[0])
    await click(chevrons(el, 'Expand A')[0])
    expect(labels(el)).toEqual(['Projects', 'A', 'B'])
    // B's only member is A, already standing above it — so B offers no chevron at all.
    expect(chevrons(el, 'Expand B')).toHaveLength(0)
    // …and the count still tells the truth about B: A really does belong to it.
    expect(countOn(el, 'B')).toBe('1')
  })

  it('a diamond renders under BOTH parents (a path guard, never a global visited set)', async () => {
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(PROJECTS),
      rec(`${ROOT}/Shared.md`, belongs('[[Metrics]]', '[[Projects]]')),
    ]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Shared', 'Projects', 'Shared'])
  })

  it('expanding ONE occurrence of a multi-parent page expands them ALL (🔒 D4: keyed by page path)', async () => {
    const records = [
      folder(HOME),
      folder(METRICS, belongs('[[Home]]')),
      folder(PROJECTS),
      folder(`${ROOT}/Shared.md`, belongs('[[Metrics]]', '[[Projects]]')),
      rec(`${ROOT}/Leaf.md`, belongs('[[Shared]]')),
    ]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Shared', 'Projects', 'Shared'])
    await click(chevrons(el, 'Expand Shared')[0]) // the occurrence under Metrics
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Shared', 'Leaf', 'Projects', 'Shared', 'Leaf'])
  })

  it('a refetched snapshot rebuilds the tree in place — no fetch, no watcher of its own', async () => {
    const source = sourceOver(vault())
    const { el } = await mount({ source })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
    await act(async () => source.update([...vault(), folder(`${ROOT}/Aha.md`)]))
    expect(labels(el)).toEqual(['Home', 'Aha', 'Metrics', 'Projects', 'Uncategorized'])
  })
})

// ---------------------------------------------------------------- 🔒 D7: Uncategorized

describe('the Uncategorized disk projection (YAZ-956)', () => {
  it('keeps root pages direct and builds only populated folders, directories then pages case-insensitively', () => {
    const records = [
      rec(`${ROOT}/z-root.md`),
      rec(`${ROOT}/Alpha.md`),
      rec(`${ROOT}/Zeta/deep/Beta.md`),
      rec(`${ROOT}/alpha/deep/zebra.md`),
      rec(`${ROOT}/alpha/deep/Apple.md`),
      rec(`${ROOT}/alpha/Gamma.md`),
    ]

    expect(uncategorizedDiskTree(records)).toEqual({
      folders: [
        {
          name: 'alpha',
          path: 'alpha',
          folders: [
            {
              name: 'deep',
              path: 'alpha/deep',
              folders: [],
              pages: [records[4], records[3]],
            },
          ],
          pages: [records[5]],
        },
        {
          name: 'Zeta',
          path: 'Zeta',
          folders: [
            {
              name: 'deep',
              path: 'Zeta/deep',
              folders: [],
              pages: [records[2]],
            },
          ],
          pages: [],
        },
      ],
      pages: [records[1], records[0]],
    })
  })
})

describe('Uncategorized (🔒 D7): a muted row that expands IN PLACE, minus whatever already shows', () => {
  it('renders a Files-shaped hierarchy, default-open, and remembers folder folds while the section is hidden', async () => {
    const records = [
      rec(`${ROOT}/Root.md`),
      rec(`${ROOT}/inbox/Zed.md`),
      rec(`${ROOT}/inbox/deep/Alpha.md`),
    ]
    const { el } = await mount({ source: sourceOver(records) })

    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'deep', 'Alpha', 'Zed', 'Root'])
    expect(rowFor(el, 'inbox')).toMatchObject({ className: expect.stringContaining('tree__row--dir') })
    expect(rowFor(el, 'inbox')?.getAttribute('aria-expanded')).toBe(null)
    expect(rowFor(el, 'inbox')?.parentElement?.getAttribute('aria-expanded')).toBe('true')
    expect(indentOf(el, 'inbox')).toBe('22px')
    expect(indentOf(el, 'deep')).toBe('36px')
    expect(indentOf(el, 'Alpha')).toBe('50px')
    expect(indentOf(el, 'Zed')).toBe('36px')
    expect(indentOf(el, 'Root')).toBe('22px')

    await click(rowFor(el, 'deep')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'deep', 'Zed', 'Root'])
    await click(rowFor(el, 'Uncategorized')!)
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'deep', 'Zed', 'Root'])
  })

  it('walks disk folders with Up/Down and folds them with Left/Right without opening a page', async () => {
    const records = [rec(`${ROOT}/inbox/Zed.md`), rec(`${ROOT}/inbox/deep/Alpha.md`)]
    const { el, props } = await mount({ source: sourceOver(records) })
    await click(rowFor(el, 'Uncategorized')!)

    rowFor(el, 'inbox')!.focus()
    await press(rowFor(el, 'inbox')!, 'ArrowLeft')
    expect(labels(el)).toEqual(['Uncategorized', 'inbox'])
    expect(focused(el)).toBe('inbox')
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()

    await press(rowFor(el, 'inbox')!, 'ArrowRight')
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'deep', 'Alpha', 'Zed'])
    await press(rowFor(el, 'inbox')!, 'ArrowDown')
    expect(focused(el)).toBe('deep')
  })

  it('reports disk folders as absolute directory menu targets while nested pages remain file targets', async () => {
    const nested = rec(`${ROOT}/inbox/deep/Alpha.md`)
    const { el, props } = await mount({ source: sourceOver([nested]) })
    await click(rowFor(el, 'Uncategorized')!)

    expect(rowFor(el, 'inbox')?.getAttribute('draggable')).toBeNull()
    // `data-path` is the ABSOLUTE folder, for the selection's on-screen ordering (YAZ-1578);
    // the relative `data-uncategorized-folder` is still what says "a disk folder, not a page".
    expect(rowFor(el, 'inbox')?.dataset.path).toBe(`${ROOT}/inbox`)
    expect(rowFor(el, 'inbox')?.dataset.uncategorizedFolder).toBe('inbox')
    await act(async () => void rowFor(el, 'inbox')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(props.onRowContextMenu).toHaveBeenCalledWith(
      { type: 'dir', path: `${ROOT}/inbox` },
      expect.objectContaining({ type: 'contextmenu' }),
    )

    expect(rowFor(el, 'Alpha')?.getAttribute('draggable')).toBe('true')
    await act(async () => void rowFor(el, 'Alpha')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })))
    expect(props.onRowContextMenu).toHaveBeenCalledWith(
      { type: 'file', path: nested.path },
      expect.objectContaining({ type: 'contextmenu' }),
    )
    await click(rowFor(el, 'Alpha')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(nested.path)
  })

  it('renders a folder rename in place at the folder row depth', async () => {
    const { el } = await mount({
      source: sourceOver([rec(`${ROOT}/inbox/deep/Alpha.md`)]),
      renaming: { path: `${ROOT}/inbox`, onSubmit: vi.fn(async () => undefined), onCancel: vi.fn() },
    })
    await click(rowFor(el, 'Uncategorized')!)

    const field = el.querySelector<HTMLInputElement>('.create-inline__input')
    expect(field?.value).toBe('inbox')
    expect(field?.parentElement?.style.paddingLeft).toBe('22px')
    expect(rowFor(el, 'inbox')).toBeUndefined()
    expect(rowFor(el, 'deep')).toBeDefined()
  })

  it('renders a folder-anchored create once beneath that folder at the child depth', async () => {
    const { el } = await mount({
      source: sourceOver([rec(`${ROOT}/inbox/deep/Alpha.md`)]),
      creating: { kind: 'file', seed: '', anchorPath: `${ROOT}/inbox`, onSubmit: vi.fn(async () => undefined), onCancel: vi.fn() },
    })
    await click(rowFor(el, 'Uncategorized')!)

    const fields = el.querySelectorAll<HTMLInputElement>('.create-inline__input')
    expect(fields).toHaveLength(1)
    expect(fields[0]?.placeholder).toBe('New note')
    expect(fields[0]?.parentElement?.style.paddingLeft).toBe('36px')
    expect(fields[0]?.closest('ul')?.parentElement?.querySelector(':scope > .tree__row .tree__label')?.textContent).toBe('inbox')
  })

  it('rebuilds from live snapshots and resets disk-folder folds only on a true remount', async () => {
    const initial = [rec(`${ROOT}/inbox/deep/Alpha.md`)]
    const source = sourceOver(initial)
    const first = await mount({ source })
    await click(rowFor(first.el, 'Uncategorized')!)
    await click(rowFor(first.el, 'inbox')!)

    await act(async () => source.update([...initial, rec(`${ROOT}/later/Beta.md`), rec(`${ROOT}/Root.md`)]))
    expect(labels(first.el)).toEqual(['Uncategorized', 'inbox', 'later', 'Beta', 'Root'])

    act(() => root?.unmount())
    root = null
    container?.remove()
    const { el } = await mount({ source })
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'deep', 'Alpha', 'later', 'Beta', 'Root'])
  })

  it('counts and lists the orphans, subtracting the folder pages standing as roots', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    // Home and Projects have no parents either, so the carve-out-free lookup calls them orphans —
    // this surface subtracts them because they are already on screen. Loose is what is left.
    expect(countOn(el, 'Uncategorized')).toBe('1')
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized', 'Loose'])
    expect(indentOf(el, 'Loose')).toBe('22px')
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Projects', 'Uncategorized'])
  })

  it('is muted, and its rows open like any other (⌘-click included) — never a page of its own', async () => {
    const { el, props } = await mount({ source: sourceOver(vault()) })
    expect(rowFor(el, 'Uncategorized')?.classList.contains('tree__row--muted')).toBe(true)
    await click(rowFor(el, 'Uncategorized')!)
    await click(rowFor(el, 'Loose')!, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledWith(`${ROOT}/Loose.md`)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('hides itself entirely when every page already stands somewhere', async () => {
    // Metrics belongs to Home AND is promoted beside it (YAZ-920) — either way it is on screen,
    // so the subtraction empties the section out and the muted row goes with it.
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    expect(labels(el)).toEqual(['Home', 'Metrics'])
  })
})

// ---------------------------------------------------------------- 🔒 D4: persistence

describe('expansion persists through the per-vault storage bucket (🔒 D4)', () => {
  it('restores the open pages from folders[root].topicsExpanded, at every depth', async () => {
    const SUB = `${ROOT}/Sub.md`
    const deep = [...vault(), folder(SUB, belongs('[[Metrics]]')), rec(`${ROOT}/Deep.md`, belongs('[[Sub]]'))]
    const state = defaultAppState()
    state.folders = { [ROOT]: { ...defaultFolderState(), topicsExpanded: [METRICS, SUB] } }
    await initStorage(state)
    const { el } = await mount({ source: sourceOver(deep) })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Sub', 'Deep', 'Projects', 'Uncategorized'])
    // Restoring is not a write: the value already on disk is not sent back.
    expect(bridgeSetFolder).not.toHaveBeenCalled()
  })

  it('writes PAGE PATHS back through the bucket on every toggle, keyed by this vault', async () => {
    // Two nested topics, since Home holds no fold of its own since YAZ-920.
    const SUB = `${ROOT}/Sub.md`
    const deep = [...vault(), folder(SUB, belongs('[[Metrics]]')), rec(`${ROOT}/Deep.md`, belongs('[[Sub]]'))]
    const { el } = await mount({ source: sourceOver(deep) })
    await click(chevrons(el, 'Expand Metrics')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS])
    expect(bridgeSetFolder).toHaveBeenLastCalledWith(ROOT, { topicsExpanded: [METRICS] })
    await click(chevrons(el, 'Expand Sub')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([METRICS, SUB])
    await click(chevrons(el, 'Collapse Metrics')[0])
    expect(storage.getTopicsExpanded(ROOT)).toEqual([SUB])
    expect(bridgeSetFolder).toHaveBeenLastCalledWith(ROOT, { topicsExpanded: [SUB] })
  })

  it('survives a remount — the lens switch away and back (the tree is unmounted meanwhile)', async () => {
    const first = await mount({ source: sourceOver(vault()) })
    await click(chevrons(first.el, 'Expand Metrics')[0])
    act(() => root?.unmount())
    root = null
    container?.remove()
    const { el } = await mount({ source: sourceOver(vault()) })
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
  })
})

// ---------------------------------------------------------------- ⚡ the amendment: the offer

describe('the offer card (6C-, YAZ-849): un-adopted AND no Home, and nothing else', () => {
  const card = (el: HTMLElement) => el.querySelector<HTMLElement>('.topics-offer')
  const offerButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.topics-offer button')

  it('shows at the TOP of the lens when the folder is un-adopted and nothing answers [[Home]]', async () => {
    const { el } = await mount({ source: sourceOver([folder(PROJECTS), rec(`${ROOT}/Loose.md`)]), unadopted: true })
    expect(card(el)?.textContent).toContain('Your map starts here')
    expect(offerButton(el)?.textContent).toBe('Create Home')
    // First thing in the lens, and it REPLACES nothing: the tree still stands Projects up and
    // still lists the orphan (there is never a silent fallback to Files). "First" is measured
    // inside the walk's host div (YAZ-921), which is what the lens renders into now.
    expect(host(el).firstElementChild).toBe(card(el))
    expect(labels(el)).toEqual(['Projects', 'Uncategorized'])
  })

  it('one click runs the create — App makes Home and opens it; the card asks for nothing else', async () => {
    const onCreateHome = vi.fn()
    const { el } = await mount({ source: sourceOver([rec(`${ROOT}/Loose.md`)]), unadopted: true, onCreateHome })
    await click(offerButton(el) as Element)
    expect(onCreateHome).toHaveBeenCalledTimes(1)
  })

  it('an ADOPTED vault never offers — its Home was created for it, silently', async () => {
    const { el } = await mount({ source: sourceOver([rec(`${ROOT}/Loose.md`)]), unadopted: false })
    expect(card(el)).toBeNull()
  })

  it('a Home that RESOLVES retires the card live, flagged or not (🔒 D1)', async () => {
    const source = sourceOver([rec(`${ROOT}/Loose.md`)])
    const { el } = await mount({ source, unadopted: true })
    expect(card(el)).not.toBeNull()
    // The click made Home (or the user did, by hand, unflagged): the next snapshot answers
    // `[[Home]]`, so the offer retires — even though 6B's roots rule shows no Home ROW for an
    // unflagged page. The folder is still un-adopted; it simply has a Home now.
    await act(async () => source.update([rec(`${ROOT}/Loose.md`), rec(HOME)]))
    expect(card(el)).toBeNull()
    expect(labels(el)).toEqual(['Uncategorized'])
  })

  it('never shows before the first index lands — an empty feed knows nothing about Home', async () => {
    const { el } = await mount({ source: sourceOver([]), unadopted: true })
    expect(card(el)).toBeNull()
    expect(el.textContent).toBe('')
  })
})

// ---------------------------------------------------------------- YAZ-991: the drag

describe('the drag (YAZ-991): a row onto a folder-page row, and nothing written before the confirm', () => {
  const REVENUE = `${ROOT}/Revenue.md`
  const LOOSE = `${ROOT}/Loose.md`

  /** Drag events bubble like the real thing; jsdom has no DragEvent, so the handlers guard
      `dataTransfer` (Tree.tsx's idiom, pinned exactly this way in Sidebar.test.tsx). */
  const fire = async (target: Element | null | undefined, type: string) =>
    act(async () => void target?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })))
  /** Whatever is currently lit as a drop target, by label — the file tree's own `tree__row--drop`. */
  const dropping = (el: HTMLElement) =>
    rows(el)
      .filter((r) => r.classList.contains('tree__row--drop'))
      .map((r) => r.querySelector('.tree__label')?.textContent ?? '')
  /** A page stands under EVERY parent that claims it, so a row is picked by OCCURRENCE. */
  const occurrence = (el: HTMLElement, label: string, at: number) =>
    rows(el).filter((r) => r.querySelector('.tree__label')?.textContent === label)[at]
  const sheetText = (el: HTMLElement) => el.querySelector('#confirm-move-text')?.textContent ?? null
  const sheetBtn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)

  beforeEach(() => move.mockReset())

  it('a valid folder-page row lights up; a row the ENGINE refuses never does, and a drop there does nothing', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await fire(rowFor(el, 'Revenue'), 'dragstart')
    await fire(rowFor(el, 'Projects'), 'dragover')
    expect(dropping(el)).toEqual(['Projects'])
    await fire(rowFor(el, 'Projects'), 'dragleave')
    expect(dropping(el)).toEqual([])
    // Churn is a plain page — it holds nobody — and Metrics is Revenue's parent already: both are
    // `canDrop`'s refusals, asked of the engine and never re-decided here.
    await fire(rowFor(el, 'Churn'), 'dragover')
    await fire(rowFor(el, 'Metrics'), 'dragover')
    expect(dropping(el)).toEqual([])
    await fire(rowFor(el, 'Churn'), 'drop')
    expect(sheetText(el)).toBeNull()
    expect(move).not.toHaveBeenCalled()
  })

  it('a drop opens the sheet — the page, the parent the ROW came from, the target — and Cancel writes nothing', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await fire(rowFor(el, 'Revenue'), 'dragstart')
    await fire(rowFor(el, 'Projects'), 'dragover')
    await fire(rowFor(el, 'Projects'), 'drop')
    expect(sheetText(el)).toBe("Move 'Revenue' from 'Metrics' into 'Projects'? The file stays put — only its folder pages change.")
    expect(dropping(el)).toEqual([]) // the highlight goes with the drag the sheet took over from
    // While the sheet stands, the keyboard is ITS own: the walk behind it does not rove.
    await press(sheetBtn(el, 'Cancel') as Element, 'ArrowDown')
    expect(document.activeElement).toBe(sheetBtn(el, 'Cancel'))
    await click(sheetBtn(el, 'Cancel') as Element)
    expect(sheetText(el)).toBeNull()
    expect(move).not.toHaveBeenCalled()
  })

  it('confirming runs the engine ONCE — the row\'s own parent as the source, the WINDOW\'s resolver — and moves no row itself', async () => {
    const columns = { score: { kind: 'number' as const } }
    const records = vault().map((record) =>
      record.path === PROJECTS
        ? folder(PROJECTS, { folder_page_settings: { columns, views: [{ type: 'outline', name: 'Outline' }] } })
        : record,
    )
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await fire(rowFor(el, 'Revenue'), 'dragstart')
    await fire(rowFor(el, 'Projects'), 'dragover')
    await fire(rowFor(el, 'Projects'), 'drop')
    await click(sheetBtn(el, 'Move') as Element)
    expect(move).toHaveBeenCalledTimes(1)
    const [child, from, to, resolve] = move.mock.calls[0]!
    expect(child).toBe(records.find((r) => r.path === REVENUE))
    expect(from).toBe(records.find((r) => r.path === METRICS)) // the RECORD: its outline drops the line (YAZ-1364)
    // `path` is what a surviving entry must RESOLVE to; `name` is what a new entry is written as.
    expect(to).toEqual({ path: PROJECTS, name: 'Projects', columns })
    // The window's own resolver, not the null stand-in: alias-aware and case-insensitive, every
    // spelling a click would follow — it is what filters the old parent out of the list.
    expect(resolve('[[metrics]]')).toBe(METRICS)
    // No optimistic re-render (YAZ-989): the row stands where it stood until the index echo says
    // otherwise, and the sheet goes.
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Churn', 'Revenue', 'Projects', 'Uncategorized'])
    expect(sheetText(el)).toBeNull()
  })

  it('the SAME page dragged from its OTHER parent leaves THAT one — the row instance decides, not the page', async () => {
    const ARCHIVE = `${ROOT}/Archive.md`
    const SHARED = `${ROOT}/Shared.md`
    const records = [folder(HOME), folder(METRICS, belongs('[[Home]]')), folder(PROJECTS), folder(ARCHIVE), rec(SHARED, belongs('[[Metrics]]', '[[Projects]]'))]
    const { el } = await mount({ source: sourceOver(records) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Archive', 'Metrics', 'Shared', 'Projects', 'Shared'])
    await fire(occurrence(el, 'Shared', 1), 'dragstart') // the occurrence standing under Projects
    await fire(rowFor(el, 'Archive'), 'dragover')
    await fire(rowFor(el, 'Archive'), 'drop')
    // …and the sheet answers the multi-parent question by name: Metrics is not part of this move.
    expect(sheetText(el)).toBe(
      "Move 'Shared' from 'Projects' into 'Archive'? The file stays put — only its folder pages change. It also stays in: Metrics.",
    )
    await click(sheetBtn(el, 'Move') as Element)
    expect(move.mock.calls[0]?.[1]).toMatchObject({ path: PROJECTS })
  })

  it('a row in Uncategorized has no parent to leave: it confirms with a NULL source', async () => {
    const records = vault()
    const { el } = await mount({ source: sourceOver(records) })
    await click(rowFor(el, 'Uncategorized')!)
    await fire(rowFor(el, 'Loose'), 'dragstart')
    await fire(rowFor(el, 'Projects'), 'dragover')
    expect(dropping(el)).toEqual(['Projects'])
    await fire(rowFor(el, 'Projects'), 'drop')
    // Nothing to name as a source, so the sentence names none — and the drop GAINS a belonging.
    expect(sheetText(el)).toBe("Move 'Loose' into 'Projects'? The file stays put — only its folder pages change.")
    await click(sheetBtn(el, 'Move') as Element)
    const [child, from, to] = move.mock.calls[0]!
    expect(child).toBe(records.find((r) => r.path === LOOSE))
    expect(from).toBeNull()
    expect(to).toEqual({ path: PROJECTS, name: 'Projects', columns: {} })
  })

  it('the pinned Home and the Uncategorized header are out of the gesture on BOTH sides', async () => {
    const { el } = await mount({ source: sourceOver(vault()) })
    expect(rowFor(el, 'Home')?.getAttribute('draggable')).toBe('false')
    expect(rowFor(el, 'Metrics')?.getAttribute('draggable')).toBe('true')
    // The muted header has no page behind it at all, so it is not even in the gesture's grammar.
    expect(rowFor(el, 'Uncategorized')?.getAttribute('draggable')).toBeNull()
    await click(rowFor(el, 'Uncategorized')!)
    await fire(rowFor(el, 'Loose'), 'dragstart')
    // Home IS a folder page and Loose belongs nowhere, so the ENGINE would allow this drop —
    // the tree refuses it itself (YAZ-920): Home unfolds nothing, so a drop there is a root-drop
    // in disguise, which v1 does not do.
    await fire(rowFor(el, 'Home'), 'dragover')
    await fire(rowFor(el, 'Uncategorized'), 'dragover')
    expect(dropping(el)).toEqual([])
    await fire(rowFor(el, 'Home'), 'drop')
    expect(sheetText(el)).toBeNull()
    expect(move).not.toHaveBeenCalled()
  })

  it('a confirmed move that never reaches disk says so through the panel notice — never silence', async () => {
    move.mockRejectedValueOnce(new Error('EACCES'))
    const onNotice = vi.fn()
    const { el } = await mount({ source: sourceOver(vault()), onNotice })
    await click(rowFor(el, 'Uncategorized')!)
    await fire(rowFor(el, 'Loose'), 'dragstart')
    await fire(rowFor(el, 'Projects'), 'dragover')
    await fire(rowFor(el, 'Projects'), 'drop')
    await click(sheetBtn(el, 'Move') as Element)
    expect(onNotice).toHaveBeenCalledWith('Can\'t move "Loose" into "Projects": EACCES')
    expect(sheetText(el)).toBeNull() // the failure is a notice, never a second dialog
  })
})

describe('multi-select (YAZ-1336): shift+click, path-keyed across every occurrence', () => {
  const SHARED = `${ROOT}/Shared.md`
  /** A diamond: one page claimed by two topics, so it renders TWICE (⚡ D6 of YAZ-814). */
  const diamond = (): IndexRecord[] => [
    folder(HOME),
    folder(METRICS, belongs('[[Home]]')),
    folder(PROJECTS),
    rec(SHARED, belongs('[[Metrics]]', '[[Projects]]')),
  ]
  const selectionOver = (paths: readonly string[]) => ({ paths: new Set(paths), toggle: vi.fn(), set: vi.fn() })
  const selectedLabels = (el: HTMLElement) =>
    rows(el)
      .filter((r) => r.classList.contains('tree__row--selected'))
      .map((r) => r.querySelector('.tree__label')?.textContent ?? '')

  it('🔒 D3: ONE selected path lights up EVERY row that draws it — a page under two parents shows selected under both', async () => {
    const { el } = await mount({ source: sourceOver(diamond()), selection: selectionOver([SHARED]) })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(chevrons(el, 'Expand Projects')[0])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Shared', 'Projects', 'Shared'])
    expect(selectedLabels(el)).toEqual(['Shared', 'Shared'])
    // The `<li>` says the same thing wherever the page stands, beside the active file's own flag.
    expect(
      rows(el)
        .filter((r) => r.querySelector('.tree__label')?.textContent === 'Shared')
        .map((r) => r.closest('[role="treeitem"]')?.getAttribute('aria-selected')),
    ).toEqual(['true', 'true'])
  })

  it('🔒 D2: shift+click toggles the row and does nothing else — no open, and no fold either way', async () => {
    const selection = selectionOver([])
    // Metrics is the OPEN topic and stands unfolded: a plain click there would FOLD it (YAZ-921),
    // and a plain click on the closed Projects would unfold it (⚡ YAZ-870). Shift does neither.
    const { el, props } = await mount({ source: sourceOver(diamond()), selection, activeFile: METRICS })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Shared') as Element, { shiftKey: true })
    await click(rowFor(el, 'Metrics') as Element, { shiftKey: true })
    await click(rowFor(el, 'Projects') as Element, { shiftKey: true })
    expect(selection.toggle.mock.calls).toEqual([[SHARED], [METRICS], [PROJECTS]])
    expect(labels(el)).toEqual(['Home', 'Metrics', 'Shared', 'Projects'])
    expect(props.onOpenFile).not.toHaveBeenCalled()
    expect(props.onOpenFileBackground).not.toHaveBeenCalled()
    expect(selection.set).not.toHaveBeenCalled() // shift never SETS either (D9 leaves it the toggle)
  })

  it('an Uncategorized DISK-FOLDER row shift-selects, wears the mark, and never folds (YAZ-1578)', async () => {
    const selection = selectionOver([`${ROOT}/inbox`])
    const { el, props } = await mount({ source: sourceOver([rec(`${ROOT}/inbox/Zed.md`)]), selection })
    await click(rowFor(el, 'Uncategorized')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'Zed'])
    expect(selectedLabels(el)).toEqual(['inbox'])
    expect(rowFor(el, 'inbox')?.dataset.path).toBe(`${ROOT}/inbox`) // so orderedSelection can place it
    expect(rowFor(el, 'inbox')?.closest('[role="treeitem"]')?.getAttribute('aria-selected')).toBe('true')
    await click(rowFor(el, 'inbox')!, { shiftKey: true })
    expect(selection.toggle).toHaveBeenCalledExactlyOnceWith(`${ROOT}/inbox`)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox', 'Zed']) // shift never folds
    expect(props.onOpenFile).not.toHaveBeenCalled()
    await click(rowFor(el, 'inbox')!)
    expect(labels(el)).toEqual(['Uncategorized', 'inbox']) // a plain click still folds…
    expect(selection.set).toHaveBeenCalledExactlyOnceWith(`${ROOT}/inbox`) // …and SELECTS the folder (D9, YAZ-1674)
  })

  it('an Uncategorized page row plays by the same two rules', async () => {
    const selection = selectionOver([`${ROOT}/Loose.md`])
    const { el, props } = await mount({ source: sourceOver(vault()), selection })
    await click(rowFor(el, 'Uncategorized') as Element)
    expect(selectedLabels(el)).toEqual(['Loose'])
    await click(rowFor(el, 'Loose') as Element, { shiftKey: true })
    expect(selection.toggle).toHaveBeenCalledExactlyOnceWith(`${ROOT}/Loose.md`)
    expect(props.onOpenFile).not.toHaveBeenCalled()
  })

  it('a PLAIN click and a ⌘-click both make the selection THE CLICKED PAGE before they open (D9, YAZ-1674)', async () => {
    const selection = selectionOver([SHARED])
    const { el, props } = await mount({ source: sourceOver(diamond()), selection })
    await click(chevrons(el, 'Expand Metrics')[0])
    await click(rowFor(el, 'Shared') as Element, { metaKey: true })
    expect(props.onOpenFileBackground).toHaveBeenCalledExactlyOnceWith(SHARED)
    expect(selection.set).toHaveBeenCalledExactlyOnceWith(SHARED)
    await click(rowFor(el, 'Shared') as Element)
    expect(props.onOpenFile).toHaveBeenCalledExactlyOnceWith(SHARED)
    expect(selection.set).toHaveBeenCalledTimes(2)
    expect(selection.toggle).not.toHaveBeenCalled()
  })
})
