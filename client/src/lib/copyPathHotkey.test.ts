/**
 * ⌘⇧C ownership (YAZ-1338, 🔒 D4): `ownsSidebarHotkey`'s sibling — the SHIFTED chord this
 * time, same second-boundary rules: editors, fields, and modal tools get first refusal, and a
 * key someone already consumed stays consumed.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { ownsCopyPathHotkey } from './copyPathHotkey'

function event(target: EventTarget, over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: 'c',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
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

describe('ownsCopyPathHotkey (YAZ-1338)', () => {
  it('accepts Meta+Shift+C case-insensitively on ordinary application chrome', () => {
    const button = document.createElement('button')
    document.body.append(button)
    expect(ownsCopyPathHotkey(event(button))).toBe(true)
    expect(ownsCopyPathHotkey(event(document.body, { key: 'C' }))).toBe(true)
  })

  it.each([
    ['no Command', { metaKey: false }],
    ['no Shift — that is the editor’s plain copy', { shiftKey: false }],
    ['Control', { ctrlKey: true }],
    ['Option', { altKey: true }],
    ['another key', { key: 'x' }],
    ['already consumed', { defaultPrevented: true }],
    ['repeat', { repeat: true }],
    ['composition', { isComposing: true }],
  ])('declines %s', (_name, over) => {
    expect(ownsCopyPathHotkey(event(document.body, over))).toBe(false)
  })

  it.each(['input', 'textarea', 'select'])('declines a %s target or descendant', (tag) => {
    const field = document.createElement(tag)
    const child = document.createElement('span')
    field.append(child)
    document.body.append(field)
    expect(ownsCopyPathHotkey(event(field))).toBe(false)
    expect(ownsCopyPathHotkey(event(child))).toBe(false)
  })

  it('declines an enabled contenteditable target, but not contenteditable=false', () => {
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const disabled = document.createElement('div')
    disabled.setAttribute('contenteditable', 'false')
    document.body.append(editable, disabled)
    expect(ownsCopyPathHotkey(event(editable))).toBe(false)
    expect(ownsCopyPathHotkey(event(disabled))).toBe(true)
  })

  it('declines while any modal tool is open', () => {
    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    const button = document.createElement('button')
    document.body.append(modal, button)
    expect(ownsCopyPathHotkey(event(button))).toBe(false)
  })
})
