import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TextField } from './TextField'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let container: HTMLElement | null = null

function mount(normalize: (draft: string) => string | null) {
  const onCommit = vi.fn()
  const onDone = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<TextField aria-label="Value" value="280" normalize={normalize} onCommit={onCommit} onDone={onDone} />))
  const input = container.querySelector<HTMLInputElement>('[aria-label="Value"]')
  if (input === null) throw new Error('missing input')
  return { input, onCommit, onDone }
}

function setValue(input: HTMLInputElement, value: string): void {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(input: HTMLInputElement, key: string): void {
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
}

function blur(input: HTMLInputElement): void {
  act(() => {
    input.focus()
    input.blur()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('TextField normalization', () => {
  it('normalizes before comparison and visibly keeps a valid normalized draft even when unchanged', () => {
    const { input, onCommit } = mount((draft) => draft.trim())
    setValue(input, ' 280 ')
    press(input, 'Enter')
    expect(input.value).toBe('280')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('restores rejected drafts without committing, then accepts a later valid edit', () => {
    const { input, onCommit } = mount((draft) => (/^\d+$/.test(draft) ? draft : null))
    setValue(input, 'invalid')
    blur(input)
    expect(input.value).toBe('280')
    expect(onCommit).not.toHaveBeenCalled()

    setValue(input, '400')
    press(input, 'Enter')
    expect(input.value).toBe('400')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('400')
  })

  it('Escape bypasses normalization and restores, then a later edit still commits', () => {
    const normalize = vi.fn((draft: string) => draft.trim())
    const { input, onCommit } = mount(normalize)
    setValue(input, '500')
    press(input, 'Escape')
    expect(input.value).toBe('280')
    expect(normalize).not.toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()

    setValue(input, '400')
    press(input, 'Enter')
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('400')
  })

  it('deduplicates Enter followed by blur', () => {
    const { input, onCommit, onDone } = mount((draft) => draft)
    setValue(input, '400')
    press(input, 'Enter')
    blur(input)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith('400')
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})
