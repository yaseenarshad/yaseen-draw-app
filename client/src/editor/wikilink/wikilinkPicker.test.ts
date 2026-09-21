/**
 * The `[[` link picker (Links B, GRO-2191): real editor (`createCrepe`), typing simulated with
 * insert transactions, keys dispatched through ProseMirror's `handleKeyDown` (so Crepe's + the
 * outliner's keymaps compete for real, in priority-and-addition order). Pinned here: open on
 * `[[`, filtering through the shared matcher (cap 8), ↑/↓ wraparound, Enter/click inserting
 * plain `[[name]]` text (valid markdown, A- decorations restyle it), the Create row, alias-`|`
 * close, Esc dismiss-and-stay-closed, code exclusion, live candidate updates, and — crucially —
 * that a CLOSED picker never swallows keys (the outliner keeps Enter in lists) while an OPEN
 * one wins the priority-100 Enter tie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import type { IndexRecord } from '@shared/types'
import { createCrepe, getMarkdownForSave } from '../createCrepe'
import { api, BridgeRequestError } from '../../api'

vi.mock('../../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api')>()),
  api: { createFile: vi.fn() },
}))
const createFile = vi.mocked(api.createFile)
import { linkCandidates, nameCandidate } from '../../links/completion'
import { WIKILINK_CLASS } from './wikilinkPlugin'
import {
  WIKILINK_PICKER_CLASS,
  WIKILINK_PICKER_CREATE_CLASS,
  createWikilinkCandidateSource,
  type MutableWikilinkCandidateSource,
} from './wikilinkPicker'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** The nav a real window hands the editor (Links C): the create row is its second user (YAZ-1357). */
const nav = () => ({ root: '/vault', createFolder: () => '', openCurrent: vi.fn(), openBackground: vi.fn(), onNotice: vi.fn() })

async function mount(markdown: string, candidates: MutableWikilinkCandidateSource, wikilinkNav?: ReturnType<typeof nav>) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, wikilinkCandidates: candidates, wikilinkNav })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

/** Plain-name candidates (E2, GRO-2214 made candidates rows, not strings — see `aliasSource`). */
function source(...names: string[]): MutableWikilinkCandidateSource {
  const s = createWikilinkCandidateSource()
  s.update(names.map(nameCandidate))
  return s
}

function viewOf(crepe: Crepe): EditorView {
  return crepe.editor.action((ctx) => ctx.get(editorViewCtx))
}

function posOf(crepe: Crepe, text: string, offset = 0): number {
  const doc = viewOf(crepe).state.doc
  let pos = -1
  doc.descendants((node, nodePos) => {
    if (pos >= 0) return false
    const index = node.isText ? (node.text ?? '').indexOf(text) : -1
    if (index >= 0) pos = nodePos + index + offset
    return pos < 0
  })
  if (pos < 0) throw new Error(`text not found: ${text}`)
  return pos
}

function caret(crepe: Crepe, pos: number): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
}

/** Insert at the caret (the selection maps to the end, like real typing). */
function type(crepe: Crepe, text: string): void {
  const view = viewOf(crepe)
  view.dispatch(view.state.tr.insertText(text))
}

const KEY_CODES: Record<string, number> = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 }

function press(crepe: Crepe, key: 'Enter' | 'Escape' | 'ArrowUp' | 'ArrowDown'): boolean {
  const view = viewOf(crepe)
  const event = new KeyboardEvent('keydown', { key, code: key, keyCode: KEY_CODES[key], bubbles: true, cancelable: true })
  return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
}

function popup(): HTMLElement | null {
  return document.querySelector(`.${WIKILINK_PICKER_CLASS}`)
}

function rows(): string[] {
  return Array.from(document.querySelectorAll(`.${WIKILINK_PICKER_CLASS} [role="option"]`)).map((el) => el.textContent ?? '')
}

function selectedRow(): string | null {
  return document.querySelector(`.${WIKILINK_PICKER_CLASS} [role="option"][aria-selected="true"]`)?.textContent ?? null
}

/** Flush SlashProvider's debounce(0) positioning/show pass. */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
  document.querySelectorAll(`.${WIKILINK_PICKER_CLASS}`).forEach((el) => el.remove())
})

describe('wikilink picker: open / filter (GRO-2191)', () => {
  it('typing [[ opens the picker over every candidate; typing filters through the shared matcher', async () => {
    const { crepe } = await mount('Intro here\n', source('Alpha', 'Beta', 'alphabet soup'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[')
    await tick()
    expect(popup()?.dataset.show).toBe('true')
    expect(rows()).toEqual(['Alpha', 'Beta', 'alphabet soup'])
    expect(popup()?.getAttribute('role')).toBe('listbox')
    type(crepe, 'al')
    expect(rows()).toEqual(['Alpha', 'alphabet soup'])
  })

  it('suggestions cap at 8', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `Note ${i}`)
    const { crepe } = await mount('X\n', source(...many))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(rows()).toHaveLength(8)
  })

  it('an empty vault and an empty fragment show nothing (no popup shell)', async () => {
    const { crepe } = await mount('X\n', source())
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })

  it('candidate updates while open refresh the rows live (index refetch)', async () => {
    const s = source('Alpha')
    const { crepe } = await mount('X\n', s)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(rows()).toEqual(['Alpha'])
    s.update(['Alpha', 'Beta'].map(nameCandidate))
    expect(rows()).toEqual(['Alpha', 'Beta'])
  })

  it('no picker inside code blocks or inline code (mirrors the decoration exclusions)', async () => {
    const { crepe } = await mount('```\ncode here\n```\n\nA `span x` and text\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'code here', 'code here'.length))
    type(crepe, '[[')
    expect(rows()).toEqual([])
    caret(crepe, posOf(crepe, 'span x', 'span'.length)) // inside the `span x` code span
    type(crepe, '[[')
    expect(rows()).toEqual([])
    caret(crepe, posOf(crepe, 'and text', 'and text'.length))
    type(crepe, '[[')
    expect(rows()).toEqual(['Alpha'])
  })
})

describe('wikilink picker: navigate / insert', () => {
  it('ArrowDown/ArrowUp move the highlight with wraparound', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'Beta', 'Gamma'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    expect(selectedRow()).toBe('Alpha')
    expect(press(crepe, 'ArrowDown')).toBe(true)
    expect(selectedRow()).toBe('Beta')
    expect(press(crepe, 'ArrowUp')).toBe(true)
    expect(selectedRow()).toBe('Alpha')
    expect(press(crepe, 'ArrowUp')).toBe(true)
    expect(selectedRow()).toBe('Gamma') // wraps
  })

  it('typing more resets the highlight to the first row', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'alphabet soup'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    press(crepe, 'ArrowDown')
    expect(selectedRow()).toBe('alphabet soup')
    type(crepe, 'a')
    expect(selectedRow()).toBe('Alpha')
  })

  it('Enter replaces the trigger with valid [[wiki link]] markdown and closes; the caret lands after ]]', async () => {
    const { crepe } = await mount('Intro here\n', source('Alpha', 'Beta'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[alp')
    expect(press(crepe, 'Enter')).toBe(true)
    await tick()
    expect(getMarkdownForSave(crepe)).toBe('Intro here[[Alpha]]\n')
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
    const view = viewOf(crepe)
    expect(view.state.selection.from).toBe(posOf(crepe, '[[Alpha]]') + '[[Alpha]]'.length)
  })

  it('the inserted text renders through the A- decorations once the caret moves away', async () => {
    const { crepe, root } = await mount('Intro here\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'Intro here', 'Intro here'.length))
    type(crepe, '[[alp')
    press(crepe, 'Enter')
    caret(crepe, posOf(crepe, 'Intro'))
    const links = Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).map((el) => el.textContent)
    expect(links).toEqual(['Alpha'])
  })

  it('a click inserts too (mousedown is prevented so the editor never blurs)', async () => {
    const { crepe } = await mount('X\n', source('Alpha', 'Beta'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[')
    await tick()
    const beta = Array.from(document.querySelectorAll(`.${WIKILINK_PICKER_CLASS} [role="option"]`))[1] as HTMLElement
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    beta.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    beta.click()
    expect(getMarkdownForSave(crepe)).toBe('X[[Beta]]\n')
    expect(rows()).toEqual([])
  })

  it('duplicate basenames insert their disambiguated folder form', async () => {
    const { crepe } = await mount('X\n', source('Note', 'sub/Note'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[note')
    expect(rows()).toEqual(['Note', 'sub/Note'])
    press(crepe, 'ArrowDown')
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[sub/Note]]\n')
  })

  it('view-only candidates, including images, insert the explicit extension and spaces verbatim', async () => {
    const { crepe } = await mount('X\n', source('Outbound Lead Qualifier.json', 'tool.PY', 'report.PDF', 'Launch Photo.PNG'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[outbound')
    expect(rows()).toEqual(['Outbound Lead Qualifier.json'])
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[Outbound Lead Qualifier.json]]\n')
  })

  it('filters and inserts an image candidate with its explicit extension', async () => {
    const { crepe } = await mount('X\n', source('data.json', 'Launch Photo.PNG'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[launch')
    expect(rows()).toEqual(['Launch Photo.PNG'])
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[Launch Photo.PNG]]\n')
  })

  it('mid-text triggers only replace [[fragment up to the caret; trailing text stays', async () => {
    const { crepe } = await mount('before after\n', source('Alpha'))
    caret(crepe, posOf(crepe, ' after'))
    type(crepe, '[[alp')
    expect(rows()).toEqual(['Alpha'])
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('before[[Alpha]] after\n')
  })
})

describe('wikilink picker: create-new row', () => {
  beforeEach(() => createFile.mockReset())

  it('nothing matching offers one Create row: Enter inserts the link AND makes the page, staying put (YAZ-1357, 🔒 D3 revised)', async () => {
    createFile.mockResolvedValue({ path: '/vault/New Page.md', mtime: 1, size: 0 })
    const n = nav()
    const { crepe } = await mount('X\n', source('Alpha'), n)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[New Page')
    const create = document.querySelector(`.${WIKILINK_PICKER_CREATE_CLASS}`)
    expect(rows()).toEqual(['Create "New Page"'])
    expect(create?.getAttribute('aria-selected')).toBe('true')
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[New Page]]\n')
    await new Promise((r) => setTimeout(r, 0))
    expect(createFile).toHaveBeenCalledExactlyOnceWith('/vault/New Page.md')
    expect(n.onNotice).toHaveBeenCalledExactlyOnceWith('Created "New Page"')
    expect(n.openCurrent).not.toHaveBeenCalled()
    expect(n.openBackground).not.toHaveBeenCalled()
  })

  it('a click on the Create row does the same', async () => {
    createFile.mockResolvedValue({ path: '/vault/Clicked.md', mtime: 1, size: 0 })
    const n = nav()
    const { crepe } = await mount('X\n', source('Alpha'), n)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Clicked')
    document.querySelector<HTMLElement>(`.${WIKILINK_PICKER_CREATE_CLASS}`)?.click()
    await new Promise((r) => setTimeout(r, 0))
    expect(getMarkdownForSave(crepe)).toBe('X[[Clicked]]\n')
    expect(createFile).toHaveBeenCalledExactlyOnceWith('/vault/Clicked.md')
  })

  it('a create failure is SAID through the notice, and the link text stays', async () => {
    createFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk full'))
    const n = nav()
    const { crepe } = await mount('X\n', source('Alpha'), n)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Doomed')
    press(crepe, 'Enter')
    await new Promise((r) => setTimeout(r, 0))
    expect(getMarkdownForSave(crepe)).toBe('X[[Doomed]]\n')
    await vi.waitFor(() => expect(n.onNotice).toHaveBeenCalledWith('Can\'t create "Doomed": disk full'))
    expect(n.openCurrent).not.toHaveBeenCalled()
  })

  it('without a nav there is no vault to create in: the row only inserts', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Nowhere')
    press(crepe, 'Enter')
    await new Promise((r) => setTimeout(r, 0))
    expect(getMarkdownForSave(crepe)).toBe('X[[Nowhere]]\n')
    expect(createFile).not.toHaveBeenCalled()
  })

  it('a whitespace-only fragment offers nothing', async () => {
    const { crepe } = await mount('X\n', source())
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[  ')
    expect(rows()).toEqual([])
  })
})

describe('wikilink picker: frontmatter aliases (Links E2, GRO-2214)', () => {
  /** One index record under `/vault`, with its frontmatter aliases. */
  const rec = (path: string, aliases: string[] = []): IndexRecord => {
    const name = path.slice(path.lastIndexOf('/') + 1)
    const folder = path.slice('/vault/'.length, path.lastIndexOf('/'))
    return {
      path,
      name,
      basename: name.replace(/\.md$/, ''),
      folder: path.indexOf('/', '/vault/'.length) === -1 ? '' : folder,
      ext: 'md',
      size: 1,
      ctime: 1,
      mtime: 1,
      properties: {},
      aliases,
      tags: [],
      links: [],
      embeds: [],
    }
  }

  /** The REAL pipeline: index records → `linkCandidates` → the picker's source. */
  function indexSource(...records: IndexRecord[]): MutableWikilinkCandidateSource {
    const s = createWikilinkCandidateSource()
    s.update(linkCandidates(records))
    return s
  }

  const CAC = rec('/vault/Customer Acquisition Cost.md', ['CAC'])

  it('typing an alias suggests the page, disambiguated by its name', async () => {
    const { crepe } = await mount('X\n', indexSource(CAC, rec('/vault/Ideas.md')))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[cac')
    await tick()
    expect(rows()).toEqual(['CAC — Customer Acquisition Cost'])
    expect(popup()?.dataset.show).toBe('true')
  })

  it('Enter on an alias row inserts the PIPED form; the note still inserts bare under its own name', async () => {
    const { crepe } = await mount('X\n', indexSource(CAC))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[cac')
    expect(press(crepe, 'Enter')).toBe(true)
    expect(getMarkdownForSave(crepe)).toBe('X[[Customer Acquisition Cost|CAC]]\n')

    const second = await mount('Y\n', indexSource(CAC))
    caret(second.crepe, posOf(second.crepe, 'Y', 1))
    type(second.crepe, '[[customer')
    expect(rows()).toEqual(['Customer Acquisition Cost'])
    press(second.crepe, 'Enter')
    expect(getMarkdownForSave(second.crepe)).toBe('Y[[Customer Acquisition Cost]]\n')
  })

  it('the piped insert renders through the A- decorations as the alias alone', async () => {
    const { crepe, root } = await mount('X\n', indexSource(CAC))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[cac')
    press(crepe, 'Enter')
    caret(crepe, posOf(crepe, 'X'))
    expect(Array.from(root.querySelectorAll(`.${WIKILINK_CLASS}`)).map((el) => el.textContent)).toEqual(['CAC'])
  })

  it('two pages claiming one alias offer both rows, told apart by the page name', async () => {
    const source = indexSource(CAC, rec('/vault/costs/CAC Model.md', ['CAC']))
    const { crepe } = await mount('X\n', source)
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[CAC')
    // F2 ranking (GRO-2197): the two EXACT alias hits rank ahead of the prefix-matched name.
    expect(rows()).toEqual(['CAC — Customer Acquisition Cost', 'CAC — CAC Model', 'CAC Model'])
    press(crepe, 'ArrowDown')
    press(crepe, 'Enter')
    expect(getMarkdownForSave(crepe)).toBe('X[[CAC Model|CAC]]\n')
  })
})

describe('wikilink picker: alias and dismissal', () => {
  it('typing | closes the suggestions (alias entry continues as plain text)', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Alpha')
    expect(rows()).toEqual(['Alpha'])
    type(crepe, '|')
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
  })

  it('Esc dismisses leaving the typed text; the same [[ stays closed while typing continues', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Al')
    expect(rows()).toEqual(['Alpha'])
    expect(press(crepe, 'Escape')).toBe(true)
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show).toBe('false')
    type(crepe, 'p')
    expect(rows()).toEqual([]) // still the dismissed [[ — no reopen
    expect(getMarkdownForSave(crepe)).toContain('[[Alp') // plain text kept as typed
  })

  it('a fresh [[ after a dismissal opens again', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[Al')
    press(crepe, 'Escape')
    type(crepe, ']] and [[')
    expect(rows()).toEqual(['Alpha'])
  })
})

describe('wikilink picker: a closed picker never swallows keys', () => {
  it('Escape / arrows fall through when the picker is closed', async () => {
    const { crepe } = await mount('Plain text\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'Plain text', 'Plain text'.length))
    expect(press(crepe, 'Escape')).toBe(false)
    const before = viewOf(crepe).state.doc
    press(crepe, 'ArrowDown') // whoever handles it, the picker must not: the doc is untouched
    expect(viewOf(crepe).state.doc).toBe(before)
  })

  it('the outliner keeps Enter in lists when closed; an OPEN picker wins the priority tie', async () => {
    const { crepe } = await mount('* item\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'item', 'item'.length))
    type(crepe, ' [[alp')
    expect(rows()).toEqual(['Alpha'])
    expect(press(crepe, 'Enter')).toBe(true)
    // The picker consumed Enter: ONE list item, with the link inserted — no new item.
    expect(getMarkdownForSave(crepe)).toBe('* item [[Alpha]]\n')
    // Closed now: Enter falls through to the outliner / Crepe and creates a second item.
    expect(press(crepe, 'Enter')).toBe(true)
    expect(getMarkdownForSave(crepe)).not.toBe('* item [[Alpha]]\n')
  })
})

describe('wikilink picker: walking never opens (YAZ-908)', () => {
  it('moving the caret into the middle of a closed [[Alpha]] never opens the picker', async () => {
    const { crepe } = await mount('before [[Alpha]] after\n', source('Alpha'))
    caret(crepe, posOf(crepe, '[[Alpha]]', 4)) // [[Al|pha]] — text before the caret reads like a fresh [[Al
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })

  it('moving the caret into loaded unclosed [[Al text never opens the picker either', async () => {
    const { crepe } = await mount('stray [[Al tail\n', source('Alpha'))
    caret(crepe, posOf(crepe, '[[Al', 4))
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })

  it('an open picker survives intra-fragment caret moves, closes on leave, and walking back in does NOT reopen it', async () => {
    const { crepe } = await mount('X\n', source('Alpha'))
    caret(crepe, posOf(crepe, 'X', 1))
    type(crepe, '[[al')
    expect(rows()).toEqual(['Alpha'])
    caret(crepe, posOf(crepe, '[[al', 3)) // [[a|l — same [[, still open
    expect(rows()).toEqual(['Alpha'])
    caret(crepe, posOf(crepe, 'X')) // left the fragment — closes
    expect(rows()).toEqual([])
    caret(crepe, posOf(crepe, '[[al', 4)) // walked back in — stays closed
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })

  it('typing inside a closed [[Alpha]] still opens suggestions (editing the tag — the Obsidian/Roam default)', async () => {
    const { crepe } = await mount('see [[Alpha]] here\n', source('Alpha'))
    caret(crepe, posOf(crepe, '[[Alpha]]', 4)) // [[Al|pha]]
    type(crepe, 'p') // doc changed: [[Alp|pha]] — fragment "Alp" prefix-matches Alpha
    expect(rows()).toEqual(['Alpha'])
  })

  it('a candidate refresh never opens a closed picker under the caret', async () => {
    const s = source('Alpha')
    const { crepe } = await mount('go [[Alpha]] on\n', s)
    caret(crepe, posOf(crepe, '[[Alpha]]', 4))
    s.update(['Alpha', 'Beta'].map(nameCandidate))
    await tick()
    expect(rows()).toEqual([])
    expect(popup()?.dataset.show ?? 'false').toBe('false')
  })
})
