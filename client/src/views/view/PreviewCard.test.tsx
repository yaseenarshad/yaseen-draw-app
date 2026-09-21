/**
 * Preview mode's hover card (YAZ-1244): the intent timing, the cache and the states, with
 * `createCrepe` and `api` mocked so fake timers own the clock. What the REAL Crepe renders
 * read-only is pinned next door in `PreviewCard.crepe.test.tsx`.
 *
 * The contract under test (locked in YAZ-1258's scope comment):
 * - `usePreview(enabled)` → `{ rowProps, card, close }`; `rowProps(record)` returns hover
 *   handlers to spread on a row, or `undefined` while disabled; `card` is the rendered
 *   `.view-preview` (null while closed); `close()` is the wiring's drag-suppression door.
 * - OPEN_DELAY_MS (300) before anything opens or fetches; CLOSE_GRACE_MS (200) after leaving,
 *   during which entering the card keeps it alive.
 * - Content: `api.readFile` → `splitFrontmatter().body` → read-only Crepe. One read per path,
 *   `mtime` invalidates, `_resetPreviewCache()` drops everything.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { CLOSE_GRACE_MS, OPEN_DELAY_MS, usePreview, _resetPreviewCache } from './PreviewCard'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const { readFile, crepes } = vi.hoisted(() => ({
  readFile: vi.fn<(path: string) => Promise<{ path: string; content: string; mtime: number; size: number }>>(),
  crepes: [] as Array<{ opts: { root: HTMLElement; defaultValue?: string }; create: Mock; setReadonly: Mock; destroy: Mock }>,
}))

vi.mock('../../api', () => ({ api: { readFile } }))

/** A stand-in Crepe: records its options, mirrors the seed into the root so the DOM is assertable. */
vi.mock('../../editor/createCrepe', () => ({
  createCrepe: vi.fn((opts: { root: HTMLElement; defaultValue?: string }) => {
    const inst = { opts, create: vi.fn(async () => {}), setReadonly: vi.fn(), destroy: vi.fn() }
    opts.root.textContent = opts.defaultValue ?? ''
    crepes.push(inst)
    return inst
  }),
}))

const CONTENT = '---\ntitle: Alpha\n---\n\n# Hello\n\nthe body\n'
const BODY = '\n# Hello\n\nthe body\n'

const rec = (over: Partial<IndexRecord> = {}): IndexRecord => ({ ...TEST_RECORDS[0]!, ...over })

let root: Root | null = null
let container: HTMLElement | null = null

function Harness({ enabled, records }: { enabled: boolean; records: IndexRecord[] }) {
  const { rowProps, card, close } = usePreview(enabled)
  return (
    <div>
      {records.map((r) => (
        <div key={r.path} data-row={r.path} {...rowProps(r)} />
      ))}
      <button data-close onClick={close} />
      {card}
    </div>
  )
}

function mount(records: IndexRecord[], enabled = true): HTMLElement {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness enabled={enabled} records={records} />))
  return container
}

const row = (path: string): HTMLElement => {
  const el = document.body.querySelector<HTMLElement>(`[data-row="${CSS.escape(path)}"]`)
  if (el === null) throw new Error(`missing row ${path}`)
  return el
}

const card = (): HTMLElement | null => document.body.querySelector('.view-preview')

/** React synthesises enter/leave from bubbling over/out; a null relatedTarget is "from outside". */
const enter = (el: HTMLElement): void => act(() => void el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
const leave = (el: HTMLElement): void => act(() => void el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))

const advance = async (ms: number): Promise<void> => act(() => vi.advanceTimersByTimeAsync(ms).then(() => undefined))

beforeEach(() => {
  vi.useFakeTimers()
  readFile.mockReset()
  readFile.mockImplementation(async (path: string) => ({ path, content: CONTENT, mtime: 1, size: CONTENT.length }))
  crepes.length = 0
  _resetPreviewCache()
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  vi.useRealTimers()
})

describe('hover intent', () => {
  it('a quick pass-through never opens nor fetches', async () => {
    const r = rec()
    mount([r])
    enter(row(r.path))
    await advance(OPEN_DELAY_MS - 1)
    leave(row(r.path))
    await advance(1000)
    expect(card()).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('opens after the delay: frontmatter stripped, Crepe seeded with the body and set read-only', async () => {
    const r = rec()
    mount([r])
    enter(row(r.path))
    await advance(OPEN_DELAY_MS)
    expect(card()).not.toBeNull()
    expect(readFile).toHaveBeenCalledExactlyOnceWith(r.path)
    expect(crepes).toHaveLength(1)
    expect(crepes[0]!.opts.defaultValue).toBe(BODY)
    expect(crepes[0]!.setReadonly).toHaveBeenCalledWith(true)
    expect(card()!.textContent).toContain('the body')
  })

  it('disabled: hovering does nothing at all', async () => {
    const r = rec()
    mount([r], false)
    enter(row(r.path))
    await advance(1000)
    expect(card()).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('leaving closes after the grace — unless the cursor lands on the card', async () => {
    const r = rec()
    mount([r])
    enter(row(r.path))
    await advance(OPEN_DELAY_MS)
    leave(row(r.path))
    await advance(CLOSE_GRACE_MS - 1)
    expect(card()).not.toBeNull()
    enter(card()!)
    await advance(1000)
    expect(card()).not.toBeNull()
    leave(card()!)
    await advance(CLOSE_GRACE_MS)
    expect(card()).toBeNull()
    expect(crepes[0]!.destroy).toHaveBeenCalled()
  })

  it('hovering another row re-targets the card', async () => {
    const a = rec()
    const b = rec({ path: '/vault/Other.md', mtime: 5 })
    readFile.mockImplementation(async (path: string) => ({ path, content: `---\nx: 1\n---\n\nbody of ${path}\n`, mtime: 5, size: 10 }))
    mount([a, b])
    enter(row(a.path))
    await advance(OPEN_DELAY_MS)
    expect(card()!.textContent).toContain(`body of ${a.path}`)
    leave(row(a.path))
    enter(row(b.path))
    await advance(OPEN_DELAY_MS)
    expect(card()!.textContent).toContain(`body of ${b.path}`)
    expect(document.body.querySelectorAll('.view-preview')).toHaveLength(1)
  })

  it('close() shuts the card immediately — the drag-suppression door', async () => {
    const r = rec()
    const el = mount([r])
    enter(row(r.path))
    await advance(OPEN_DELAY_MS)
    expect(card()).not.toBeNull()
    act(() => el.querySelector<HTMLElement>('[data-close]')!.click())
    expect(card()).toBeNull()
  })
})

describe('the content cache', () => {
  it('one read per path; a changed mtime refetches; reset drops everything', async () => {
    const r = rec({ mtime: 1 })
    mount([r])
    const cycle = async (record: IndexRecord) => {
      act(() => root?.render(<Harness enabled={true} records={[record]} />))
      enter(row(record.path))
      await advance(OPEN_DELAY_MS)
      expect(card()).not.toBeNull()
      leave(row(record.path))
      await advance(CLOSE_GRACE_MS)
      expect(card()).toBeNull()
    }
    await cycle(r)
    await cycle(r)
    expect(readFile).toHaveBeenCalledTimes(1)
    await cycle(rec({ mtime: 2 }))
    expect(readFile).toHaveBeenCalledTimes(2)
    _resetPreviewCache()
    await cycle(rec({ mtime: 2 }))
    expect(readFile).toHaveBeenCalledTimes(3)
  })
})

describe('states', () => {
  it('a failed read shows the error state, and does not poison the cache for a retry', async () => {
    const r = rec()
    mount([r])
    readFile.mockRejectedValueOnce(new Error('gone'))
    enter(row(r.path))
    await advance(OPEN_DELAY_MS)
    const err = document.body.querySelector('.view-preview__error')
    expect(err).not.toBeNull()
    expect(err!.textContent).toContain("Couldn't load preview")
    expect(crepes).toHaveLength(0)
  })

  it('a frontmatter-only page says Empty page', async () => {
    const r = rec()
    readFile.mockImplementation(async (path: string) => ({ path, content: '---\ntitle: A\n---\n', mtime: 1, size: 4 }))
    mount([r])
    enter(row(r.path))
    await advance(OPEN_DELAY_MS)
    expect(card()!.textContent).toContain('Empty page')
    expect(crepes).toHaveLength(0)
  })
})
