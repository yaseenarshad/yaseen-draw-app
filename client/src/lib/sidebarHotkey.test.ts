import { afterEach, describe, expect, it } from 'vitest'
import { ownsSidebarHotkey } from './sidebarHotkey'

function event(target: EventTarget, over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'b',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    target,
    ...over,
  } as KeyboardEvent
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ownsSidebarHotkey', () => {
  it('accepts plain Meta+B case-insensitively on ordinary application chrome', () => {
    const button = document.createElement('button')
    document.body.append(button)
    expect(ownsSidebarHotkey(event(button))).toBe(true)
    expect(ownsSidebarHotkey(event(document.body, { key: 'B' }))).toBe(true)
  })

  it.each([
    ['no Command', { metaKey: false }],
    ['Control', { ctrlKey: true }],
    ['Option', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['another key', { key: 'k' }],
    ['already consumed', { defaultPrevented: true }],
    ['repeat', { repeat: true }],
    ['composition', { isComposing: true }],
  ])('declines %s', (_name, over) => {
    expect(ownsSidebarHotkey(event(document.body, over))).toBe(false)
  })

  it.each(['input', 'textarea', 'select'])('declines a %s target or descendant', (tag) => {
    const field = document.createElement(tag)
    const child = document.createElement('span')
    field.append(child)
    document.body.append(field)
    expect(ownsSidebarHotkey(event(field))).toBe(false)
    expect(ownsSidebarHotkey(event(child))).toBe(false)
  })

  it('declines an enabled contenteditable target or descendant, but not contenteditable=false', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editable.append(child)
    const disabled = document.createElement('div')
    disabled.setAttribute('contenteditable', 'false')
    document.body.append(editable, disabled)
    expect(ownsSidebarHotkey(event(editable))).toBe(false)
    expect(ownsSidebarHotkey(event(child))).toBe(false)
    expect(ownsSidebarHotkey(event(disabled))).toBe(true)
  })

  it('declines everywhere while an aria-modal tool is open, including canvas/overlay targets', () => {
    const canvas = document.createElement('canvas')
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    modal.append(canvas)
    const outside = document.createElement('button')
    document.body.append(modal, outside)
    expect(ownsSidebarHotkey(event(canvas))).toBe(false)
    expect(ownsSidebarHotkey(event(outside))).toBe(false)
  })

  it('declines a non-Element target instead of guessing ownership', () => {
    expect(ownsSidebarHotkey(event(window))).toBe(false)
  })
})
