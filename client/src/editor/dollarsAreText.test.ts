/**
 * DOLLARS ARE TEXT (YAZ-977, pinned by YAZ-978): a business wiki writes `$500K–$1M/yr`, and the
 * editor must render it as written. With Crepe's Latex feature enabled, `$…$` is inline MATH —
 * the real Project-Brief.md line below renders as the formula `500K−`, dollars gone.
 *
 * Two pins, different lifetimes:
 *  - the RENDER pin is `it.fails` while the Latex feature stands — YAZ-979 (the feature moves to
 *    `DISABLED_FEATURES`) must flip it to `it` in the same diff;
 *  - the ROUND-TRIP pin passes TODAY and forever: the misrender was display-only — the math node
 *    serialises back to the very bytes it swallowed, so no file was ever rewritten (the YAZ-964
 *    contrast, proven rather than assumed).
 *
 * Real Crepe in jsdom, the note editor's own feature map — the harness idiom of
 * `outline/bulletsOnly.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { createCrepe, getMarkdownForSave } from './createCrepe'
import { features } from './featureConfig'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

async function mount(markdown: string): Promise<Crepe> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown, features })
  await crepe.create()
  mounted.push({ crepe, root })
  return crepe
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

/** Every node and mark name in the document — the math feature would contribute `math_inline`. */
const nodeNames = (crepe: Crepe): string[] =>
  crepe.editor.action((ctx) => {
    const names = new Set<string>()
    ctx.get(editorViewCtx).state.doc.descendants((node) => {
      names.add(node.type.name)
      for (const mark of node.marks) names.add(mark.type.name)
      return true
    })
    return [...names]
  })

const textOf = (crepe: Crepe): string =>
  crepe.editor.action((ctx) => {
    const { doc } = ctx.get(editorViewCtx).state
    return doc.textBetween(0, doc.content.size, '\n')
  })

/** Project-Brief.md's dollar lines (16, 32, 37), verbatim — line 16 is the YAZ-977 screenshot. */
const REAL_LINES = [
  'Floor: owners doing at least $500K–$1M/yr. Ideal: $2M–$10M+/yr, and even beyond.',
  '**One audience, compounding.** Everything targets the same audience of $1M+/yr owners. The same lead flow and acquisition system carries through later phases; only the offer on the call changes.',
  '**Pricing.** $3K initial build + $400/mo maintenance was a theoretical starting point only, expected to increase.',
]

describe('dollars are text (YAZ-977)', () => {
  it('renders every real Project-Brief dollar line as written — no math node, dollars intact', async () => {
    for (const line of REAL_LINES) {
      const crepe = await mount(line)
      expect(nodeNames(crepe).filter((name) => name.includes('math'))).toEqual([])
      // The VISIBLE text: `**` is a strong mark on screen, not characters — bytes are the round-trip test's claim.
      expect(textOf(crepe)).toBe(line.replace(/\*\*/g, ''))
    }
  })

  it('round-trips every line byte-for-byte — the misrender never rewrote a file', async () => {
    for (const line of REAL_LINES) {
      const crepe = await mount(line)
      expect(getMarkdownForSave(crepe)).toBe(`${line}\n`)
    }
  })
})
