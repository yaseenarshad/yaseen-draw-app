/**
 * Heading folding (YAZ-1140). Contract tests written FIRST (Fable) — the implementation in
 * headingFolding.ts must pass these unchanged. Mirrors the outlineFolding.test.ts harness so the
 * two suites stay comparable: same mount helper, same save-path guard, same panic-undo shape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import { createCrepe, getMarkdownForSave, type CreateCrepeOptions } from '../createCrepe'
import { Autosave } from '../../lib/autosave'
import {
  getHeadingFoldKey,
  HEADING_FOLDED_ATTR,
  HEADING_TOGGLE_CLASS,
  setHeadingFoldAtSelection,
  undoLastHeadingFold,
} from './headingFolding'
import { OUTLINE_FOLDED_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'

const DOC = `# Part 1

Intro paragraph.

## Section A

Alpha body.

### Deep dive

Deep body.

## Section B

Beta body.

# Part 2

Closing.
`

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(opts: Omit<CreateCrepeOptions, 'root'>): Promise<{ crepe: Crepe; root: HTMLElement }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, ...opts })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root }
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

const toggles = (root: HTMLElement): HTMLButtonElement[] => [
  ...root.querySelectorAll<HTMLButtonElement>(`.${HEADING_TOGGLE_CLASS}`),
]
const toggleFor = (root: HTMLElement, label: string): HTMLButtonElement => {
  const btn = toggles(root).find((b) => b.getAttribute('aria-label')?.endsWith(` ${label}`))
  if (!btn) throw new Error(`no heading toggle for "${label}"`)
  return btn
}
const folded = (root: HTMLElement) => root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`)
const foldedText = (root: HTMLElement) => [...folded(root)].map((el) => el.textContent).join(' | ')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Place the caret inside the first text occurrence of `needle`. */
const caretIn = (crepe: Crepe, needle: string) =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    let target = -1
    view.state.doc.descendants((node, pos) => {
      if (target !== -1) return false
      if (node.isText && node.text?.includes(needle)) target = pos + node.text.indexOf(needle) + 1
      return true
    })
    if (target === -1) throw new Error(`text "${needle}" not found`)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)))
  })

const runCommand = (crepe: Crepe, command: (state: any, dispatch: any) => boolean): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return command(view.state, view.dispatch)
  })

describe('heading folding: which headings are foldable', () => {
  it('renders a toggle on every H1-H3 that owns a non-empty section, and nothing else', async () => {
    const { root } = await mount({ defaultValue: DOC })
    const labels = toggles(root).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual([
      'Collapse Part 1',
      'Collapse Section A',
      'Collapse Deep dive',
      'Collapse Section B',
      'Collapse Part 2',
    ])
    for (const b of toggles(root)) expect(b.getAttribute('aria-expanded')).toBe('true')
  })

  it('gives no toggle to a heading with an empty section', async () => {
    const EMPTY = `## Empty\n\n## After\n\nBody.\n`
    const { root } = await mount({ defaultValue: EMPTY })
    const labels = toggles(root).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Collapse After'])
  })

  it('gives no toggle to a heading that is the last node in the document', async () => {
    const TAIL = `Intro.\n\n# Tail heading\n`
    const { root } = await mount({ defaultValue: TAIL })
    expect(toggles(root)).toHaveLength(0)
  })

  it('skips headings inside list items — the bullet chevron owns that gutter', async () => {
    const IN_BULLET = `* # In bullet\n  * Child\n\n# Top\n\nBody.\n`
    const { root } = await mount({ defaultValue: IN_BULLET })
    const labels = toggles(root).map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Collapse Top'])
    // The in-bullet heading still has its bullet toggle (unchanged behavior).
    const bulletLabels = [...root.querySelectorAll(`.${OUTLINE_TOGGLE_CLASS}`)].map((b) => b.getAttribute('aria-label'))
    expect(bulletLabels).toEqual(['Collapse In bullet'])
  })
})

describe('heading folding: section hiding', () => {
  it('collapsing an H2 hides exactly its section — deeper headings in, next H2 out', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })
    const before = getMarkdownForSave(crepe)

    toggleFor(root, 'Section A').click()

    const btn = toggleFor(root, 'Section A')
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Expand Section A')
    // Alpha body, ### Deep dive, Deep body — three sibling blocks.
    expect(folded(root)).toHaveLength(3)
    expect(foldedText(root)).toContain('Alpha body.')
    expect(foldedText(root)).toContain('Deep dive')
    expect(foldedText(root)).toContain('Deep body.')
    expect(foldedText(root)).not.toContain('Section B')
    expect(foldedText(root)).not.toContain('Intro paragraph.')
    expect(getMarkdownForSave(crepe)).toBe(before)

    toggleFor(root, 'Section A').click()
    expect(folded(root)).toHaveLength(0)
  })

  it('collapsing an H1 hides everything up to the next H1, including nested collapsed state', async () => {
    const { root } = await mount({ defaultValue: DOC })
    toggleFor(root, 'Deep dive').click()
    toggleFor(root, 'Part 1').click()
    // Part 1's section: Intro, ## A, Alpha, ### Deep dive, Deep body, ## B, Beta — 7 sibling blocks,
    // plus the Deep-dive inner fold (1 block) already hidden within it.
    expect(foldedText(root)).toContain('Section A')
    expect(foldedText(root)).toContain('Section B')
    expect(foldedText(root)).not.toContain('Part 2')
    expect(foldedText(root)).not.toContain('Closing.')
    // Expanding Part 1 restores the view; Deep dive stays collapsed (independent state).
    toggleFor(root, 'Part 1').click()
    expect(toggleFor(root, 'Deep dive').getAttribute('aria-expanded')).toBe('false')
    expect(foldedText(root)).toContain('Deep body.')
    expect(foldedText(root)).not.toContain('Alpha body.')
  })

  it('a bullet list inside a heading section hides with the section, and bullet folds coexist', async () => {
    const MIXED = `# Top\n\nIntro.\n\n* Parent\n  * Child\n\n# Next\n\nTail.\n`
    const { crepe, root } = await mount({ defaultValue: MIXED })
    const before = getMarkdownForSave(crepe)

    // Bullet fold first (existing plugin), then heading fold over it.
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click()
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)

    toggleFor(root, 'Top').click()
    expect(foldedText(root)).toContain('Parent')
    expect(foldedText(root)).not.toContain('Tail.')
    expect(getMarkdownForSave(crepe)).toBe(before)

    // Expanding the heading section leaves the bullet fold in place.
    toggleFor(root, 'Top').click()
    expect(folded(root)).toHaveLength(0)
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
  })
})

describe('heading folding: save path is untouched', () => {
  it('fold toggles never reach markdownUpdated or Autosave; a real edit still saves', async () => {
    const updates: string[] = []
    const save = vi.fn(async () => ({ mtime: 2 }))
    let autosave: Autosave | null = null
    const { crepe, root } = await mount({
      defaultValue: DOC,
      onMarkdownUpdated: (md) => void (updates.push(md), autosave?.update(md)),
    })
    await sleep(400)
    updates.length = 0
    autosave = new Autosave({ markdown: getMarkdownForSave(crepe), mtime: 1, delayMs: 20, save, onStatus: () => {}, onConflict: () => {} })

    toggleFor(root, 'Section A').click()
    toggleFor(root, 'Part 2').click()
    toggleFor(root, 'Section A').click()
    await sleep(400)
    expect(updates).toEqual([])
    expect(autosave.dirty).toBe(false)
    expect(save).not.toHaveBeenCalled()

    // Control: a real edit saves, and the surviving fold is re-mapped, not lost.
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText(' edited', 1 + 'Part 1'.length))
    })
    await sleep(400)
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain('# Part 1 edited')
    expect(save).toHaveBeenCalledTimes(1)
    expect(toggleFor(root, 'Part 2').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('heading folding: keys and persistence', () => {
  it('uses h:-prefixed keys and restores them in a fresh instance, pruning stale keys', async () => {
    const onCollapsedKeysChange = vi.fn<(keys: readonly string[]) => void>()
    const first = await mount({ defaultValue: DOC, headingFolding: { onCollapsedKeysChange } })
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([])

    const key = toggleFor(first.root, 'Section A').dataset.headingFoldKey
    expect(key).toBe(getHeadingFoldKey('Section A', 0))
    expect(key!.startsWith('h:')).toBe(true)

    toggleFor(first.root, 'Section A').click()
    expect(onCollapsedKeysChange).toHaveBeenLastCalledWith([key])
    const firstMarkdown = getMarkdownForSave(first.crepe)
    await first.crepe.destroy()
    first.root.remove()
    mounted.pop()

    const onSecond = vi.fn<(keys: readonly string[]) => void>()
    const second = await mount({
      defaultValue: DOC,
      headingFolding: { seedCollapsedKeys: () => new Set([key!, 'h:stale:9']), onCollapsedKeysChange: onSecond },
    })
    expect(toggleFor(second.root, 'Section A').getAttribute('aria-expanded')).toBe('false')
    expect(foldedText(second.root)).toContain('Alpha body.')
    expect(onSecond).toHaveBeenLastCalledWith([key])
    expect(getMarkdownForSave(second.crepe)).toBe(firstMarkdown)
  })
})

describe('heading folding: fold at selection (Cmd-Up / Cmd-Down path)', () => {
  it('folds the innermost enclosing section and consumes; declines outside any section', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })

    caretIn(crepe, 'Deep body')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    expect(toggleFor(root, 'Deep dive').getAttribute('aria-expanded')).toBe('false')

    caretIn(crepe, 'Alpha body')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    expect(toggleFor(root, 'Section A').getAttribute('aria-expanded')).toBe('false')

    // Caret ON a heading line folds that heading's own section.
    caretIn(crepe, 'Part 2')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(true)
    expect(toggleFor(root, 'Part 2').getAttribute('aria-expanded')).toBe('false')
    expect(runCommand(crepe, setHeadingFoldAtSelection(false))).toBe(true)
    expect(toggleFor(root, 'Part 2').getAttribute('aria-expanded')).toBe('true')
  })

  it('declines when the document has no heading above the caret', async () => {
    const { crepe } = await mount({ defaultValue: 'Plain paragraph.\n\n# Later\n\nBody.\n' })
    caretIn(crepe, 'Plain paragraph')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(false)
  })

  it('declines inside a list so the bullet handler keeps owning Cmd-Up there', async () => {
    const LISTY = `# Top\n\n* Parent\n  * Child\n\nTail.\n`
    const { crepe } = await mount({ defaultValue: LISTY })
    caretIn(crepe, 'Child')
    expect(runCommand(crepe, setHeadingFoldAtSelection(true))).toBe(false)
  })
})

describe('heading folding: panic-undo protocol', () => {
  it('reverts the most recent heading fold, once', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })
    toggleFor(root, 'Section A').click()
    expect(folded(root).length).toBeGreaterThan(0)
    expect(runCommand(crepe, undoLastHeadingFold)).toBe(true)
    expect(folded(root)).toHaveLength(0)
    expect(runCommand(crepe, undoLastHeadingFold)).toBe(false)
  })

  it('a document change clears eligibility and keeps the fold', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })
    toggleFor(root, 'Section A').click()
    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      view.dispatch(view.state.tr.insertText('!', 1 + 'Part 1'.length))
    })
    expect(runCommand(crepe, undoLastHeadingFold)).toBe(false)
    expect(folded(root).length).toBeGreaterThan(0)
  })

  it('a bullet fold after a heading fold takes over Cmd-Z (heading pending cleared)', async () => {
    const MIXED = `# Top\n\nIntro.\n\n* Parent\n  * Child\n\nTail.\n`
    const { crepe, root } = await mount({ defaultValue: MIXED })
    toggleFor(root, 'Top').click()
    toggleFor(root, 'Top').click()
    // Heading pending exists now; a bullet fold is the newer view action.
    root.querySelector<HTMLButtonElement>(`.${OUTLINE_TOGGLE_CLASS}`)!.click()
    expect(runCommand(crepe, undoLastHeadingFold)).toBe(false)
  })

  it('reverting an unfold re-folds it', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })
    toggleFor(root, 'Section A').click()
    toggleFor(root, 'Section A').click()
    expect(folded(root)).toHaveLength(0)
    expect(runCommand(crepe, undoLastHeadingFold)).toBe(true)
    expect(folded(root).length).toBeGreaterThan(0)
  })
})

describe('heading folding: widget quality', () => {
  it('is keyboard-operable: Enter and Space toggle and keep focus on the toggle', async () => {
    const { crepe, root } = await mount({ defaultValue: DOC })
    const before = getMarkdownForSave(crepe)
    toggleFor(root, 'Part 1').focus()
    toggleFor(root, 'Part 1').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Part 1').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggleFor(root, 'Part 1'))
    toggleFor(root, 'Part 1').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    expect(toggleFor(root, 'Part 1').getAttribute('aria-expanded')).toBe('true')
    expect(getMarkdownForSave(crepe)).toBe(before)
  })

  it('renders an SVG chevron (no text glyph) in both states, inside the heading element', async () => {
    const { root } = await mount({ defaultValue: DOC })
    const expanded = toggleFor(root, 'Part 1')
    expect(expanded.querySelector('svg')).not.toBeNull()
    expect(expanded.textContent).toBe('')
    expect(expanded.closest('h1')).not.toBeNull()

    expanded.click()
    const collapsed = toggleFor(root, 'Part 1')
    expect(collapsed.getAttribute('aria-expanded')).toBe('false')
    expect(collapsed.querySelector('svg')).not.toBeNull()
  })
})
