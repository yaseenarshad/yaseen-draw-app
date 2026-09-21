/**
 * Readable text/plain (the `clipboardTextSerializer`, wired in clipboardCopyOut.ts): pins the
 * image stand-in of YAZ-1709 — an image copies as its alt TEXT with the `|width` display hint
 * stripped, an empty alt falls back to the src — so what lands in another app is the caption,
 * never `Shot|400`. It is the same stand-in `itemLabelText` (listNodes.ts) gives fold keys and
 * breadcrumbs. The list / heading / bold shapes are pinned in clipboardCopyOut.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { AllSelection } from '@milkdown/kit/prose/state'
import { createCrepe } from './createCrepe'
import { clipboardPlainText } from './clipboardPlainText'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** The whole document, as the plain-text copy would carry it. */
async function plainTextOf(markdown: string): Promise<string> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  const view = crepe.editor.ctx.get(editorViewCtx)
  return clipboardPlainText(new AllSelection(view.state.doc).content())
}

afterEach(async () => {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
})

describe('images in the plain-text copy (YAZ-1709)', () => {
  it('an image copies as its alt text with the |width stripped; an empty alt falls back to the src', async () => {
    expect(await plainTextOf('* ![Shot|400](a.png)\n* ![](b.png)\n')).toBe('• Shot\n• b.png')
  })

  it('text beside an image keeps its place around the stand-in', async () => {
    expect(await plainTextOf('Before ![Shot|400](a.png) after\n')).toBe('Before Shot after')
  })
})
