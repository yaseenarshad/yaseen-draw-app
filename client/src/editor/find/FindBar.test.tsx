/**
 * The find bar (YAZ-969): CMD+F claim rules, live counter, Enter/Shift+Enter cycling, Esc —
 * driven against REAL `createCrepe()` editors through the same FindChannel the hosts wire
 * (findInPage.test.ts proves the engine; this file proves the bar and the keyboard surface).
 *
 * Claim rule under test (locked in YAZ-967): CMD+F is a window capture-phase listener per bar.
 * An `outline` bar claims only while focus is inside its own host element; the `note` bar
 * claims whenever focus is NOT inside any `.view-outline-editor`. At most one of each is
 * mounted, so exactly one bar answers.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, type CreateCrepeOptions } from '../createCrepe'
import { createFindChannel, type FindChannel } from './findChannel'
import { FindBar } from './FindBar'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ crepe: Crepe; el: HTMLElement }> = []
const roots: Array<{ root: Root; el: HTMLElement }> = []

async function mountEditor(markdown: string, opts: Omit<CreateCrepeOptions, 'root' | 'defaultValue'> = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const crepe = createCrepe({ root: el, defaultValue: markdown, ...opts })
  await crepe.create()
  mounted.push({ crepe, el })
  let view: EditorView | null = null
  crepe.editor.action((ctx) => {
    view = ctx.get(editorViewCtx)
  })
  if (view === null) throw new Error('no editor view')
  return { crepe, el, view: view as EditorView }
}

function renderBar(channel: FindChannel, scope: 'note' | 'outline', host: HTMLElement) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  act(() => {
    root.render(<FindBar channel={channel} scope={scope} hostRef={{ current: host }} />)
  })
  roots.push({ root, el })
  return el
}

afterEach(async () => {
  for (const r of roots.splice(0)) {
    act(() => r.root.unmount())
    r.el.remove()
  }
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.el.remove()
  }
})

/** CMD+F as the window capture listener sees it: dispatched from wherever focus stands. */
const pressCmdF = (target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true })
  act(() => {
    target.dispatchEvent(event)
  })
  return event
}

const barInput = (barEl: HTMLElement): HTMLInputElement => {
  const input = barEl.querySelector<HTMLInputElement>('.find-bar__input')
  if (!input) throw new Error('no find bar input')
  return input
}

const counterText = (barEl: HTMLElement): string | null => barEl.querySelector('.find-bar__count')?.textContent ?? null

/** React's controlled-input dance: set through the native setter, then fire `input`. */
const type = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const keyOn = (input: HTMLInputElement, key: string, shift = false) => {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true }))
  })
}

describe('opening', () => {
  it('CMD+F opens the note bar, focuses its input, and consumes the key', async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    expect(barEl.querySelector('.find-bar-dock--note')).not.toBeNull()
    expect(barEl.querySelector('.find-bar')).toBeNull()
    view.dom.focus()
    const event = pressCmdF(view.dom)
    expect(event.defaultPrevented).toBe(true)
    expect(channel.getState().open).toBe(true)
    expect(barEl.querySelector('.find-bar-dock--note > .find-bar')).not.toBeNull()
    expect(barEl.querySelector('.find-bar')).not.toBeNull()
    expect(document.activeElement).toBe(barInput(barEl))
  })

  it('CMD+F while already open refocuses the input', async () => {
    const channel = createFindChannel()
    const { el, view } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    pressCmdF()
    view.dom.focus()
    expect(document.activeElement).not.toBe(barInput(barEl))
    pressCmdF(view.dom)
    expect(channel.getState().open).toBe(true)
    expect(document.activeElement).toBe(barInput(barEl))
  })
})

describe('claim rule on a folder page (note editor + outline view mounted together)', () => {
  it('routes CMD+F to the outline bar only while focus is inside the outline host', async () => {
    const noteChannel = createFindChannel()
    const note = await mountEditor('note apple', { find: noteChannel })
    // The production DOM detail the claim reads: CrepeHost mounts the note editor inside
    // `.editor-mount` (the element a folder page hides, YAZ-919 / the visibility amendment).
    const noteMount = document.createElement('div')
    noteMount.className = 'editor-mount'
    document.body.appendChild(noteMount)
    noteMount.appendChild(note.el)
    const outlineChannel = createFindChannel()
    const outlineHost = document.createElement('div')
    outlineHost.className = 'view-outline-editor'
    document.body.appendChild(outlineHost)
    const outline = await mountEditor('* outline apple', { find: outlineChannel })
    outlineHost.appendChild(outline.el)
    renderBar(noteChannel, 'note', note.el)
    const outlineBarEl = renderBar(outlineChannel, 'outline', outlineHost)

    outline.view.dom.focus()
    pressCmdF(outline.view.dom)
    expect(outlineChannel.getState().open).toBe(true)
    expect(outlineBarEl.querySelector('.find-bar-dock--outline > .find-bar')).not.toBeNull()
    expect(noteChannel.getState().open).toBe(false)

    act(() => outlineChannel.close())
    note.view.dom.focus()
    pressCmdF(note.view.dom)
    expect(noteChannel.getState().open).toBe(true)
    expect(outlineChannel.getState().open).toBe(false)
    outlineHost.remove()
  })
})

describe('the counter and cycling', () => {
  it('shows N of M live, wraps with Enter, walks back with Shift+Enter', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple one apple two apple three', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    pressCmdF()
    const input = barInput(barEl)
    type(input, 'apple')
    expect(counterText(barEl)).toBe('1 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('2 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('3 of 3')
    keyOn(input, 'Enter')
    expect(counterText(barEl)).toBe('1 of 3')
    keyOn(input, 'Enter', true)
    expect(counterText(barEl)).toBe('3 of 3')
  })

  it('shows the zero state for a query with no matches, and no counter for an empty query', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    pressCmdF()
    const input = barInput(barEl)
    expect(counterText(barEl)).toBeNull()
    type(input, 'zzz')
    expect(counterText(barEl)).toBe('0 of 0')
  })
})

describe('closing', () => {
  it('Esc in the input closes the bar and clears the highlights', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    pressCmdF()
    type(barInput(barEl), 'apple')
    keyOn(barInput(barEl), 'Escape')
    expect(channel.getState().open).toBe(false)
    expect(barEl.querySelector('.find-bar')).toBeNull()
    expect(el.querySelector('.find-match')).toBeNull()
  })

  it('the close button does the same', async () => {
    const channel = createFindChannel()
    const { el } = await mountEditor('apple', { find: channel })
    const barEl = renderBar(channel, 'note', el)
    pressCmdF()
    const close = barEl.querySelector<HTMLButtonElement>('button[aria-label="Close find"]')
    if (!close) throw new Error('no close button')
    act(() => close.click())
    expect(channel.getState().open).toBe(false)
    expect(barEl.querySelector('.find-bar')).toBeNull()
  })
})
