/**
 * THE SEED GUARD under FAULT INJECTION (YAZ-974): the guard exists for the escape gap nobody has
 * found yet — so the test MAKES one. `escapeBlockStart` is mocked to the identity, the seed
 * carries a `# doomed` line, and the parse drops it exactly as YAZ-964 did. (The old `1. doomed`
 * fault is now deliberately safe under YAZ-1329's same-line numeric bullet boundary.) The guard's whole
 * contract is then asserted: the loss is reported ONCE, the editor is read-only, and `onChange`
 * never fires — a lossy load can never write.
 *
 * The healthy path (real escape, no report, editable) is pinned next door in
 * `outlineSeed.test.tsx`; this file is the only place the escape is ever faked, and only to
 * simulate its own future failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../outlineDoc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../outlineDoc')>()),
  escapeBlockStart: (text: string) => text,
}))

import { OutlineEditor } from './OutlineEditor'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

async function tick(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

async function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out')
    await tick(25)
  }
}

describe('the seed guard: a lossy load can never write (YAZ-974)', () => {
  it('reports the loss once, goes read-only, and never calls onChange', async () => {
    const onChange = vi.fn()
    const onSeedLoss = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<OutlineEditor markdown={'- above\n- # doomed\n- below'} onChange={onChange} onSeedLoss={onSeedLoss} />)
    })
    await waitFor(() => container?.querySelector('.ProseMirror') !== null)
    // Past the create, the guard's verdict and both debounce windows (200ms + 500ms).
    await tick(900)
    expect(onSeedLoss).toHaveBeenCalledTimes(1)
    expect(container?.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('guards the apply door too: a snapshot the parse cannot hold goes read-only and is never written (YAZ-1356)', async () => {
    const onChange = vi.fn()
    const onSeedLoss = vi.fn()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(<OutlineEditor markdown={'- above\n- below'} onChange={onChange} onSeedLoss={onSeedLoss} />)
    })
    await waitFor(() => container?.querySelector('.ProseMirror') !== null)
    await tick(300)
    expect(onSeedLoss).not.toHaveBeenCalled()
    await act(async () => {
      root?.render(<OutlineEditor markdown={'- above\n- # doomed\n- below'} onChange={onChange} onSeedLoss={onSeedLoss} />)
    })
    await tick(900)
    expect(onSeedLoss).toHaveBeenCalledTimes(1)
    expect(container?.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false')
    expect(onChange).not.toHaveBeenCalled()
  })
})
