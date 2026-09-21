/**
 * Preview mode with the REAL Crepe (YAZ-1244): one integration proof that the card renders the
 * page's body through an actual Milkdown instance, read-only. The timing/cache matrix lives in
 * `PreviewCard.test.tsx` with Crepe mocked; here real timers run so Crepe's async create settles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { IndexRecord } from '@shared/types'
import { usePreview, _resetPreviewCache } from './PreviewCard'
import { TEST_RECORDS } from '../testRecords'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const CONTENT = '---\ntitle: Alpha\n---\n\n# Hello preview\n\nthe preview body\n'

vi.mock('../../api', () => ({
  api: { readFile: vi.fn(async (path: string) => ({ path, content: CONTENT, mtime: 1, size: CONTENT.length })) },
}))

let root: Root | null = null
let container: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
  _resetPreviewCache()
})

function Harness({ record }: { record: IndexRecord }) {
  const { rowProps, card } = usePreview(true)
  return (
    <div>
      <div data-row {...rowProps(record)} />
      {card}
    </div>
  )
}

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

describe('the real Crepe preview', () => {
  it('renders the body read-only inside the card', async () => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => root?.render(<Harness record={TEST_RECORDS[0]!} />))
    act(() => void container!.querySelector('[data-row]')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await waitFor(() => document.body.querySelector('.view-preview .ProseMirror') !== null)
    const pm = document.body.querySelector<HTMLElement>('.view-preview .ProseMirror')!
    await waitFor(() => (pm.textContent ?? '').includes('the preview body'))
    expect(pm.textContent).toContain('Hello preview')
    // Read-only is Milkdown's editable=false, which ProseMirror wears as contenteditable="false".
    await waitFor(() => pm.getAttribute('contenteditable') === 'false')
    // The frontmatter never shows.
    expect(document.body.querySelector('.view-preview')!.textContent).not.toContain('title: Alpha')
  })
})
