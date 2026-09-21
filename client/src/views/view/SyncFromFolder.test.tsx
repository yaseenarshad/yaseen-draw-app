/**
 * SYNC FROM FOLDER, the sheet (YAZ-952, the asking half of YAZ-950). The answer is already
 * `views/folderSync.ts`'s and is tested there; what this file pins is the ASKING — the copy, the
 * picker, the preview, and the fact that the sheet REPORTS and hands back, never writes.
 *
 * Four rules could quietly rot here: the count and its plurals, the nothing-to-add case (which
 * must read sensibly for a folder whose ONE note is the page itself — `foldersWithNotes` counts
 * it), the folder being asked EVERY time (🔒 3, never remembered), and the ~15ms answer being
 * memoized rather than rebuilt per render.
 *
 * The resolver is handed in, keyed like the real one (`makeResolver`, `views/engine.ts`), so the
 * already-listed lines resolve the way a click would.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import type { ResolveLink } from '../../editor/wikilink/wikilinkPlugin'
import { SyncFromFolder, syncFromFolderMessage } from './SyncFromFolder'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const ROOT = '/vault'

const rec = (path: string, over: Partial<IndexRecord> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const rel = path.slice(`${ROOT}/`.length)
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ''),
    folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
    ext: name.slice(name.lastIndexOf('.') + 1),
    size: 1,
    ctime: 1,
    mtime: 1,
    properties: {},
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  } as IndexRecord
}

/** A resolver over these records: bare basename, and `folder/basename`, both case-insensitively. */
const resolverOver =
  (records: readonly IndexRecord[]): ResolveLink =>
  (target: string) => {
    const needle = target.trim().replace(/^\[\[|\]\]$/g, '').toLowerCase()
    const rel = (r: IndexRecord) => (r.folder === '' ? r.basename : `${r.folder}/${r.basename}`).toLowerCase()
    return records.find((r) => rel(r) === needle)?.path ?? records.find((r) => r.basename.toLowerCase() === needle)?.path ?? null
  }

/** The folder page lives in `Bases`, where it is the ONLY note — the copy case the module's review flagged. */
const PAGE = rec(`${ROOT}/Bases/Topic.md`)
const RECORDS = [
  PAGE,
  rec(`${ROOT}/Root Note.md`),
  rec(`${ROOT}/auto/Alpha.md`),
  rec(`${ROOT}/auto/Listed.md`),
  rec(`${ROOT}/auto/Zebra.md`),
  rec(`${ROOT}/auto/cover.png`),
  rec(`${ROOT}/auto/deep/Nested.md`),
]
const OUTLINE = '- [[Listed]]'

describe('syncFromFolderMessage', () => {
  it('with no folder picked, asks for one and says DIRECTLY — the non-recursive rule, in the user’s words (🔒 5)', () => {
    expect(syncFromFolderMessage(null)).toBe('Pick a folder. Only the notes directly in it are added — never those in its subfolders.')
  })

  it('counts the missing against the folder’s own notes, agreeing in number on both halves', () => {
    expect(syncFromFolderMessage({ folder: 'auto', notes: 3, missing: 2 })).toBe('2 of 3 notes directly in "auto" are not listed on this page yet.')
    expect(syncFromFolderMessage({ folder: 'auto', notes: 3, missing: 1 })).toBe('1 of 3 notes directly in "auto" is not listed on this page yet.')
    expect(syncFromFolderMessage({ folder: 'solo', notes: 1, missing: 1 })).toBe('1 of 1 note directly in "solo" is not listed on this page yet.')
  })

  it('nothing to add names the page itself — the folder whose only note IS the page still reads sensibly', () => {
    expect(syncFromFolderMessage({ folder: 'Bases', notes: 1, missing: 0 })).toBe(
      'Nothing to add — apart from this page itself, every note directly in "Bases" is already listed here.',
    )
  })

  it('never prints the vault root as an empty string', () => {
    expect(syncFromFolderMessage({ folder: '', notes: 2, missing: 1 })).toBe('1 of 2 notes directly in "Vault root" is not listed on this page yet.')
  })
})

const mounted: { root: Root; container: HTMLElement }[] = []
afterEach(() => {
  for (const m of mounted) {
    act(() => m.root.unmount())
    m.container.remove()
  }
  mounted.length = 0
})

function mount(outline = OUTLINE) {
  const onAdd = vi.fn()
  const onCancel = vi.fn()
  const resolve = vi.fn(resolverOver(RECORDS))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  const draw = () =>
    act(() =>
      root.render(
        <SyncFromFolder records={RECORDS} resolve={resolve} outline={outline} folderPagePath={PAGE.path} onAdd={onAdd} onCancel={onCancel} />,
      ),
    )
  draw()
  return { el: container, onAdd, onCancel, resolve, draw }
}

const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>('.sync__folder')].map((r) => r.textContent)
const pick = (el: HTMLElement, label: string) =>
  act(() => [...el.querySelectorAll<HTMLButtonElement>('.sync__folder')].find((r) => r.textContent?.startsWith(label))?.click())
const btn = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.confirm__btn')].find((b) => b.textContent === label)
const preview = (el: HTMLElement) => [...el.querySelectorAll('.sync__missing li')].map((li) => li.textContent)
const text = (el: HTMLElement) => el.querySelector('.confirm__text')?.textContent

describe('SyncFromFolder', () => {
  it('lists every folder holding notes with its count, the vault root under a readable label', () => {
    const { el } = mount()
    expect(rows(el)).toEqual(['Vault root1 note', 'auto3 notes', 'auto/deep1 note', 'Bases1 note'])
  })

  it('picking a folder previews the missing notes BY NAME, and says how many of how many', () => {
    const { el } = mount()
    expect(preview(el)).toEqual([])
    pick(el, 'auto')
    expect(preview(el)).toEqual(['Alpha', 'Zebra'])
    expect(text(el)).toBe('2 of 3 notes directly in "auto" are not listed on this page yet.')
  })

  it('a second folder replaces the preview — never its own subtree (🔒 5)', () => {
    const { el } = mount()
    pick(el, 'auto')
    pick(el, 'auto/deep')
    expect(preview(el)).toEqual(['Nested'])
    expect(text(el)).toBe('1 of 1 note directly in "auto/deep" is not listed on this page yet.')
  })

  it('Add hands the caller exactly the missing entries, and nothing else', () => {
    const { el, onAdd } = mount()
    pick(el, 'auto')
    act(() => btn(el, 'Add')?.click())
    expect(onAdd).toHaveBeenCalledWith([
      { path: `${ROOT}/auto/Alpha.md`, insert: 'Alpha' },
      { path: `${ROOT}/auto/Zebra.md`, insert: 'Zebra' },
    ])
  })

  it('Cancel hands back nothing', () => {
    const { el, onAdd, onCancel } = mount()
    pick(el, 'auto')
    act(() => btn(el, 'Cancel')?.click())
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('nothing to add offers NO Add button — only Dismiss', () => {
    const { el } = mount()
    pick(el, 'Bases')
    expect(text(el)).toBe('Nothing to add — apart from this page itself, every note directly in "Bases" is already listed here.')
    expect(preview(el)).toEqual([])
    expect(btn(el, 'Add')).toBeUndefined()
    expect(btn(el, 'Cancel')).toBeUndefined()
    expect(btn(el, 'Dismiss')).toBeDefined()
  })

  it('Escape dismisses and adds nothing', () => {
    const { onAdd, onCancel } = mount()
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('is an in-app dialog labelled by its own text — never a native one', () => {
    const { el } = mount()
    const dialog = el.querySelector('.confirm')
    expect(dialog?.getAttribute('role')).toBe('dialog')
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(el.querySelector('#sync-from-folder-text')?.textContent).toContain('Pick a folder')
  })

  it('asks for the folder EVERY time — a second sheet starts with nothing picked (🔒 3)', () => {
    const first = mount()
    pick(first.el, 'auto')
    expect(preview(first.el)).toEqual(['Alpha', 'Zebra'])
    const second = mount()
    expect(preview(second.el)).toEqual([])
    expect(text(second.el)).toContain('Pick a folder')
  })

  it('does not rebuild the answer on a render that changed nothing — the vault-wide call is memoized', () => {
    const { el, resolve, draw } = mount()
    pick(el, 'auto')
    const calls = resolve.mock.calls.length
    expect(calls).toBeGreaterThan(0)
    draw()
    expect(resolve.mock.calls.length).toBe(calls)
  })
})
