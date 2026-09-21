/**
 * THE SEED MUST SURVIVE (YAZ-964, pinned by YAZ-972): every line the outline grammar parses
 * (`outlineDoc.ts` says a line's text is LITERAL) must come out the other side of the Milkdown
 * seed and render. Today it does not: text that starts like a numbered list (`1. Title`,
 * `4. Level 1) Human`) re-parses as an `ordered_list`, the bullets-only schema cannot place it,
 * and the whole subtree is silently dropped — `createNodeInParserFail` per node.
 *
 * The seed below is lifted verbatim from the real failing file
 * (`business-wiki-MASTER/z.END-AUG-PREP/AI Curriculum.md`) — harness realism: a fixture that
 * bends around the bug proves the harness, not the fix.
 *
 * PINNED AS `it.fails` so the branch stays green while the bug stands: YAZ-973 (the escape at
 * the editor door) must flip `it.fails` → `it` in the same diff that fixes the parse. If that
 * flip is forgotten, this file starts failing the moment the fix lands.
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

/** Let React effects and Crepe's async create settle. */
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

async function mount(markdown: string, extra: { onSeedLoss?: () => void } = {}): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(<OutlineEditor markdown={markdown} onChange={vi.fn()} {...extra} />)
  })
  await waitFor(() => container?.querySelector('.ProseMirror') !== null)
  await tick(100)
  return container
}

/** Rendered bullet texts, in document order — what the user actually sees. */
const bullets = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('li.list-item > .children > .content-dom > p')].map((p) => p.textContent ?? '')

/** Verbatim lines from AI Curriculum.md, every dropping shape included. */
const SEED = [
  '- My teaching outline',
  '    - 1. Title > Promise > Intro > Temp Check',
  '        - Promise: show visual',
  '    - 2. Gauge the Audience - Questions',
  '        - 1\\) have a subscription?',
  '- 4. Level 1) Human (Good old Meat Machines)',
  '    - What are the things Trevor needs to do',
  '- 1. Setup [[T2-The-Setup]]',
  '- \\*',
  '    - Note: you click the buttons',
].join('\n')

describe('the outline seed survives the Milkdown parse (YAZ-964)', () => {
  it('renders every line the grammar parsed, block-look text as literal text', async () => {
    const host = await mount(SEED)
    const texts = bullets(host)
    // Every line arrives, in order, as the literal text the grammar promised — escapes render
    // without their backslash, `1.`-style spellings render as themselves.
    expect(texts).toEqual([
      'My teaching outline',
      '1. Title > Promise > Intro > Temp Check',
      'Promise: show visual',
      '2. Gauge the Audience - Questions',
      '1) have a subscription?',
      '4. Level 1) Human (Good old Meat Machines)',
      'What are the things Trevor needs to do',
      '1. Setup [[T2-The-Setup]]',
      '*',
      'Note: you click the buttons',
    ])
  })
})

describe('the seed guard (YAZ-974): healthy seeds are untouched', () => {
  it('a footnote-definition line renders as literal text', async () => {
    const host = await mount('- above\n- [^1]: note\n- below')
    expect(bullets(host)).toEqual(['above', '[^1]: note', 'below'])
  })

  it('an empty bullet nested directly under a link line — the People.md shape (YAZ-1357) — renders both and stays editable', async () => {
    const onSeedLoss = vi.fn()
    const host = await mount('* [[Alex Hormozi]]\n  *', { onSeedLoss })
    expect(bullets(host)).toEqual(['[[Alex Hormozi]]', ''])
    expect(onSeedLoss).not.toHaveBeenCalled()
    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true')
  })

  it('a healthy seed stays editable and never reports loss', async () => {
    const onSeedLoss = vi.fn()
    const host = await mount(SEED, { onSeedLoss })
    expect(onSeedLoss).not.toHaveBeenCalled()
    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('true')
  })
})
