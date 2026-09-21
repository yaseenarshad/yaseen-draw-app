/**
 * ⌘C / ⌘X / ⌘V ownership for the file clipboard (D6 amended, YAZ-1674): `ownsCopyPathHotkey`'s
 * sibling on the SAME boundary (`ownsWindowChord`) — the boundary's own cases live in
 * `copyPathHotkey.test.ts`; this pins the verb map and the two rules that are this chord's own:
 * Shift never means us (⌘⇧C is Copy path), and the editor keeps its text copy/paste.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fileClipboardVerb } from './fileClipboardHotkey'

function event(target: EventTarget, over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return { key: 'c', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, repeat: false, isComposing: false, target, ...over } as KeyboardEvent
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('fileClipboardVerb (YAZ-1674, D6)', () => {
  it.each([
    ['c', 'copy'],
    ['x', 'cut'],
    ['v', 'paste'],
    ['C', 'copy'],
  ] as const)('maps ⌘%s to %s on ordinary chrome', (key, verb) => {
    expect(fileClipboardVerb(event(document.body, { key }))).toBe(verb)
  })

  it.each([
    ['Shift — ⌘⇧C is Copy path', { shiftKey: true }],
    ['Control — the platform menu’s spelling', { metaKey: false, ctrlKey: true }],
    ['Option', { altKey: true }],
    ['another key', { key: 'a' }],
    ['already consumed', { defaultPrevented: true }],
  ])('declines %s', (_name, over) => {
    expect(fileClipboardVerb(event(document.body, over))).toBeNull()
  })

  it('leaves the editor its own copy/paste: a contenteditable target is never ours', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const inside = document.createElement('p')
    editor.append(inside)
    document.body.append(editor)
    expect(fileClipboardVerb(event(inside, { key: 'v' }))).toBeNull()
    expect(fileClipboardVerb(event(inside, { key: 'x' }))).toBeNull()
  })

  it('leaves a field its own copy/paste: the inline rename box keeps ⌘C', () => {
    const input = document.createElement('input')
    document.body.append(input)
    expect(fileClipboardVerb(event(input))).toBeNull()
  })
})
