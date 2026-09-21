/**
 * Folds survive a full document reload (YAZ-1342). Contract tests written FIRST (Fable) — the
 * seed-getter implementation must pass these unchanged.
 *
 * The bug: an external/AI edit lands on disk → Editor reloads via `setMarkdown` (Milkdown
 * `replaceAll` with flush) → a fresh EditorState re-runs plugin `init` from a mount-time snapshot
 * → every session fold expands AND the empty set is reported back, erasing the persisted keys.
 * The fixed contract: `init` seeds from a LIVE getter (`seedCollapsedKeys`), so folds whose line
 * text is unchanged survive the reload and the reported keys never pass through `[]` on the way.
 * Wiring below mirrors Editor.tsx exactly: the getter reads what the change callback last wrote.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { createCrepe, getMarkdownForSave, setMarkdown, type CreateCrepeOptions } from '../createCrepe'
import { getOutlineFoldKey } from './outlineFoldKeys'
import { OUTLINE_FOLDED_ATTR, OUTLINE_FOLDED_IMAGE_ATTR, OUTLINE_TOGGLE_CLASS } from './outlineFolding'
import { getHeadingFoldKey, HEADING_FOLDED_ATTR, HEADING_TOGGLE_CLASS } from './headingFolding'

const OUTLINE = `* Parent
  * Child
* Leaf
`

const DOC = `# Part 1

Intro paragraph.

## Section A

Alpha body.

## Section B

Beta body.
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

const toggleFor = (root: HTMLElement, cls: string, label: string): HTMLButtonElement => {
  const btn = [...root.querySelectorAll<HTMLButtonElement>(`.${cls}`)].find((b) => b.getAttribute('aria-label')?.endsWith(` ${label}`))
  if (!btn) throw new Error(`no toggle for "${label}"`)
  return btn
}

/** Editor.tsx-shaped wiring: a live key list the seed getter reads back. */
const liveWiring = () => {
  let liveKeys: readonly string[] = []
  const reports: string[][] = []
  return {
    reports,
    options: {
      seedCollapsedKeys: () => new Set(liveKeys),
      onCollapsedKeysChange: (keys: readonly string[]) => {
        liveKeys = keys
        reports.push([...keys])
      },
    },
  }
}

describe('folds survive setMarkdown (the external/AI-edit reload path)', () => {
  it('a collapsed bullet stays collapsed and its key is never dropped', async () => {
    const { reports, options } = liveWiring()
    const { crepe, root } = await mount({ defaultValue: OUTLINE, folding: options })

    toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Parent').click()
    const key = getOutlineFoldKey('Parent', 0)
    expect(reports.at(-1)).toEqual([key])
    const sinceCollapse = reports.length

    // The "AI edit": same collapsed line, new content elsewhere.
    setMarkdown(crepe, `${OUTLINE}* Agent added this\n`)

    expect(getMarkdownForSave(crepe)).toContain('Agent added this')
    expect(toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Parent').getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(1)
    // The disk-erase guard: no report on the way may be empty, and the key must still be live.
    expect(reports.slice(sinceCollapse).every((r) => r.length > 0)).toBe(true)
    expect(reports.at(-1)).toEqual([key])
  })

  it('a collapsed image bullet (YAZ-1709) stays collapsed through the reload: its key is its alt text', async () => {
    const { reports, options } = liveWiring()
    const IMAGES = `* ![Shot|400](a.png)\n* Leaf\n`
    const { crepe, root } = await mount({ defaultValue: IMAGES, folding: options, image: { root: '/v', notePath: '/v/n.md' } })

    toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Shot').click()
    const key = getOutlineFoldKey('Shot', 0)
    expect(reports.at(-1)).toEqual([key])
    const sinceCollapse = reports.length

    setMarkdown(crepe, `${IMAGES}* Agent added this\n`)

    expect(getMarkdownForSave(crepe)).toContain('Agent added this')
    expect(toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Shot').getAttribute('aria-expanded')).toBe('false')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_IMAGE_ATTR}="true"]`)).toHaveLength(1)
    expect(reports.slice(sinceCollapse).every((r) => r.length > 0)).toBe(true)
    expect(reports.at(-1)).toEqual([key])
  })

  it('a collapsed heading stays collapsed through the same reload', async () => {
    const { reports, options } = liveWiring()
    const { crepe, root } = await mount({ defaultValue: DOC, headingFolding: options })

    toggleFor(root, HEADING_TOGGLE_CLASS, 'Section A').click()
    const key = getHeadingFoldKey('Section A', 0)
    expect(reports.at(-1)).toEqual([key])
    const sinceCollapse = reports.length

    setMarkdown(crepe, `${DOC}
## Section C

Agent added this.
`)

    expect(getMarkdownForSave(crepe)).toContain('Section C')
    expect(root.querySelectorAll(`[${HEADING_FOLDED_ATTR}="true"]`).length).toBeGreaterThan(0)
    expect(toggleFor(root, HEADING_TOGGLE_CLASS, 'Section A').getAttribute('aria-expanded')).toBe('false')
    expect(reports.slice(sinceCollapse).every((r) => r.length > 0)).toBe(true)
    expect(reports.at(-1)).toEqual([key])
  })

  it('rewording the collapsed line itself expands that fold (accepted v1 boundary)', async () => {
    const { reports, options } = liveWiring()
    const { crepe, root } = await mount({ defaultValue: OUTLINE, folding: options })

    toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Parent').click()

    setMarkdown(crepe, OUTLINE.replace('* Parent', '* Parent renamed'))

    // The fold key hashes the line's own text: a reworded line is a new identity, so it opens.
    expect(toggleFor(root, OUTLINE_TOGGLE_CLASS, 'Parent renamed').getAttribute('aria-expanded')).toBe('true')
    expect(root.querySelectorAll(`[${OUTLINE_FOLDED_ATTR}="true"]`)).toHaveLength(0)
    expect(reports.at(-1)).toEqual([])
  })
})
