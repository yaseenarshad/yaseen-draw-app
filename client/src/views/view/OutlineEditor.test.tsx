/**
 * The outline editor component (YAZ-901): the REAL Crepe instance mounted with react-dom in jsdom
 * (nothing is faked — the whole point of the unit is the wiring), driven by keydown events on the
 * ProseMirror element, which is all a user has. What the lock itself guarantees is pinned next door
 * in `editor/outline/bulletsOnly.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { OutlineEditor } from './OutlineEditor'

// React's act() refuses to run outside a test renderer unless this flag is set.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

/** Let React effects, Crepe's async create and its 200ms markdownUpdated debounce settle. */
async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await tick(25)
  }
}

let lastOnChange: (md: string) => void = vi.fn()

async function mount(markdown: string, onChange: (md: string) => void = vi.fn()): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  lastOnChange = onChange
  await act(async () => {
    root?.render(<OutlineEditor markdown={markdown} onChange={onChange} />)
  })
  await waitFor(() => container?.querySelector('.ProseMirror') !== null)
  return container
}

/** The SAME mount handed a later `markdown` — what the disk moving under an open folder page looks like. */
async function rerender(markdown: string): Promise<void> {
  await act(async () => {
    root?.render(<OutlineEditor markdown={markdown} onChange={lastOnChange} />)
  })
}

const bullets = (host: HTMLElement): string[] => [...host.querySelectorAll('li.list-item > .children > .content-dom > p')].map((p) => p.textContent ?? '')

function press(host: HTMLElement, key: string): void {
  const dom = host.querySelector('.ProseMirror')
  if (dom === null) throw new Error('no editor')
  act(() => {
    dom.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }))
  })
}

describe('OutlineEditor (YAZ-901)', () => {
  it('seeds its bullets from the markdown', async () => {
    const host = await mount('- alpha\n    - beta\n- gamma\n')
    expect(bullets(host)).toEqual(['alpha', 'beta', 'gamma'])
    // Nesting survives the seed: beta is a child of alpha, not a third sibling.
    expect(host.querySelectorAll('ul ul li.list-item')).toHaveLength(1)
  })

  it('seeds ONE empty bullet when there is no outline yet', async () => {
    const host = await mount('')
    expect(bullets(host)).toEqual([''])
  })

  it('mounts inside the note editor\'s own .editor-instance so the outline CSS applies', async () => {
    const host = await mount('- a\n')
    expect(host.querySelector('.view-outline-editor > .editor-instance > .milkdown')).not.toBeNull()
  })

  it('keeps the sticky find dock before the editor DOM appended by the mount effect', async () => {
    const host = await mount('- a\n')
    const outline = host.querySelector('.view-outline-editor')
    const dock = outline?.querySelector('.find-bar-dock--outline') ?? null
    const editor = outline?.querySelector('.editor-instance') ?? null
    expect(outline?.firstElementChild).toBe(dock)
    expect(dock?.nextElementSibling).toBe(editor)
    expect(dock?.querySelector('.find-bar')).toBeNull()
  })

  it('does not report the mount-time normalisation as a change', async () => {
    // Milkdown rewrites `- ` at four spaces as `* ` at two — a normalisation, not an edit, and a
    // caller that wrote it back would dirty the folder page's settings just by looking at it.
    const onChange = vi.fn()
    await mount('- alpha\n    - beta\n', onChange)
    await tick(900)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('reports an edit as a bullet list, once, after the debounce', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    press(host, 'Enter')
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => onChange.mock.calls.length > 0)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toBe('*\n* alpha\n')
  })

  it('flushes the pending edit on unmount so a view switch keeps the last keystroke', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    press(host, 'Enter')
    // Past Crepe's own 200ms listener debounce, inside our 500ms one.
    await waitFor(() => container?.querySelectorAll('li.list-item').length === 2)
    await tick(250)
    act(() => root?.unmount())
    root = null
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toBe('*\n* alpha\n')
  })
})

describe('a later `markdown` lands as a diff over the live editor (YAZ-1356)', () => {
  it('shows the new bullet without remounting: same ProseMirror node, no re-seed', async () => {
    const host = await mount('- alpha\n- beta\n')
    const pm = host.querySelector('.ProseMirror')
    await rerender('- alpha\n- beta\n- gamma\n')
    await waitFor(() => bullets(host).length === 3)
    expect(bullets(host)).toEqual(['alpha', 'beta', 'gamma'])
    expect(host.querySelector('.ProseMirror')).toBe(pm)
  })

  it('does not report the apply as an edit — nothing is written back for looking at the disk', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    await rerender('- alpha\n- beta\n')
    await waitFor(() => bullets(host).length === 2)
    await tick(900)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('still reports the user’s NEXT edit after an apply', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    await rerender('- alpha\n- beta\n')
    await waitFor(() => bullets(host).length === 2)
    await tick(900)
    press(host, 'Enter')
    await waitFor(() => onChange.mock.calls.length > 0)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toBe('*\n* alpha\n* beta\n')
  })

  it('typing wins: a snapshot arriving while an edit is pending is skipped, and the edit still flushes', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    press(host, 'Enter')
    // INSIDE Crepe's own 200ms listener debounce: the DOM has the keystroke, nobody has been told.
    await waitFor(() => bullets(host).length === 2)
    await rerender('- alpha\n- zeta\n')
    await waitFor(() => onChange.mock.calls.length > 0)
    expect(onChange.mock.calls[0][0]).toBe('*\n* alpha\n')
    await tick(300)
    expect(bullets(host)).not.toContain('zeta')
  })

  it('text that merely looks like a block goes through the seed’s own grammar and stays literal', async () => {
    const host = await mount('- alpha\n')
    await rerender('- alpha\n- 1. Title\n- # not a heading\n')
    await waitFor(() => bullets(host).length === 3)
    expect(bullets(host)).toEqual(['alpha', '1. Title', '# not a heading'])
  })

  it('a snapshot that arrives AFTER an edit was reported still lands — one serialisation for edit, echo and apply', async () => {
    // A wikilink line: raw `getMarkdown()` escapes it (`\\[\\[`), the reported save-space string does
    // not. Comparing across the two called every document "typing in flight" after the first edit.
    const onChange = vi.fn()
    const host = await mount('- [[alpha]]\n', onChange)
    press(host, 'Enter')
    await waitFor(() => onChange.mock.calls.length > 0)
    const emitted = onChange.mock.calls[0][0] as string // '*\n* [[alpha]]\n'
    await rerender(`${emitted}* beta\n`)
    await waitFor(() => bullets(host).length === 3)
    expect(bullets(host)).toEqual(['', '[[alpha]]', 'beta'])
    await tick(900)
    expect(onChange).toHaveBeenCalledTimes(1) // the apply is not an edit
  })

  it('a `markdown` equal to what the editor last emitted is a no-op — the caller’s own echo', async () => {
    const onChange = vi.fn()
    const host = await mount('- alpha\n', onChange)
    press(host, 'Enter')
    await waitFor(() => onChange.mock.calls.length > 0)
    const emitted = onChange.mock.calls[0][0] as string
    await rerender(emitted)
    await tick(900)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(bullets(host)).toEqual(['', 'alpha'])
  })
})
