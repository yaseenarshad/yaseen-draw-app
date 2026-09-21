/**
 * Underline mark (GRO-2028): real editor (`createCrepe`), `<u>…</u>` inline HTML ↔ `underline`
 * mark, byte-identical round trip, `Mod-u` through ProseMirror's `handleKeyDown`, and a
 * regression guard that other inline HTML keeps passing through untouched.
 *
 * The mount / posOf / selectText / marksOn / md / key-press helpers live in `markTestKit.ts`,
 * shared with `highlight.test.ts`.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { marksOn, md, mount, pressKey, selectText, unmountAll } from './markTestKit'

afterEach(unmountAll)

describe('underline mark', () => {
  it('loads `<u>b</u>` as an underline mark, renders <u>, and saves identical bytes', async () => {
    const { crepe, root } = await mount('a <u>b</u> c\n')
    expect(marksOn(crepe, 'b')).toEqual(['underline'])
    expect(root.querySelector('.milkdown u')?.textContent).toBe('b')
    expect(root.querySelector('.milkdown [data-type="html"]')).toBeNull()
    expect(md(crepe)).toBe('a <u>b</u> c\n')
  })

  it('round-trips nested with bold, inside list items and headings', async () => {
    const src = '# Title <u>u</u>\n\n* item with **<u>x</u>** and <u>two words</u>\n  * <u>child</u>\n'
    const { crepe } = await mount(src)
    expect(marksOn(crepe, 'x')).toEqual(['strong', 'underline'])
    expect(md(crepe)).toBe(src)
  })

  it('leaves other inline HTML and unmatched tags untouched', async () => {
    const src = 'a <span>b</span> c<sup>2</sup> d <u>inner <em>e</em> f</u> g\n\nlone <u>tag\n\nstray </u> here\n'
    const { crepe, root } = await mount(src)
    expect(md(crepe)).toBe(src)
    expect(root.querySelectorAll('.milkdown [data-type="html"]').length).toBeGreaterThan(0)
    expect(marksOn(crepe, 'inner')).toEqual(['underline'])
    expect(marksOn(crepe, 'tag')).toEqual([])
    expect(marksOn(crepe, 'here')).toEqual([])
  })

  it('merges a directly nested <u> into one mark', async () => {
    const { crepe } = await mount('<u>a <u>b</u> c</u>\n')
    expect(marksOn(crepe, 'c')).toEqual(['underline'])
    expect(md(crepe)).toBe('<u>a b c</u>\n')
  })

  it('Mod-u adds the mark on a selection and removes it again', async () => {
    const { crepe } = await mount('hello world\n')
    selectText(crepe, 'world')
    expect(pressKey(crepe, 'u', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('hello <u>world</u>\n')
    expect(marksOn(crepe, 'world')).toEqual(['underline'])
    expect(pressKey(crepe, 'u', { mod: true })).toBe(true)
    expect(md(crepe)).toBe('hello world\n')
  })
})
