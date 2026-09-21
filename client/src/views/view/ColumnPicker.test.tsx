import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ColumnPicker } from './ColumnPicker'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let container: HTMLDivElement | undefined

function mount() {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState('note.status')
    return <>
      <ColumnPicker label="Sort property" value={value} options={[
        { value: 'file.name', label: 'Name' },
        { value: 'note.status', label: 'Stage' },
        { value: 'note.priority', label: 'Priority' },
      ]} onChange={(next) => { onChange(next); setValue(next) }} />
      <button type="button">Next control</button>
    </>
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
  const el = container
  const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Sort property"]')!
  const input = () => el.querySelector<HTMLInputElement>('[role="combobox"]')!
  return { el, trigger, input, onChange }
}

const click = (el: HTMLElement) => act(() => el.click())
const press = (el: HTMLElement, key: string) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
})
function search(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

describe('ColumnPicker accessibility and dismissal', () => {
  it('announces the active option while arrow navigation preserves selection until Enter', () => {
    const { el, trigger, input, onChange } = mount()
    press(trigger, 'ArrowDown')
    const field = input()
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(field.getAttribute('aria-controls')!)?.getAttribute('role')).toBe('listbox')
    const activeValue = () => document.getElementById(field.getAttribute('aria-activedescendant')!)?.dataset.value
    expect(activeValue()).toBe('note.status')
    press(field, 'ArrowDown')
    expect(activeValue()).toBe('note.priority')
    press(field, 'ArrowDown')
    expect(activeValue()).toBe('note.priority')
    press(field, 'ArrowUp')
    expect(activeValue()).toBe('note.status')
    press(field, 'ArrowUp')
    expect(activeValue()).toBe('file.name')
    press(field, 'ArrowUp')
    expect(activeValue()).toBe('file.name')
    expect(onChange).not.toHaveBeenCalled()
    expect(el.querySelector('[aria-selected="true"]')?.getAttribute('data-value')).toBe('note.status')
    press(field, 'Enter')
    expect(onChange).toHaveBeenCalledExactlyOnceWith('file.name')
    expect(trigger.textContent).toContain('Name')
    expect(document.activeElement).toBe(trigger)
    expect(el.querySelector('[role="listbox"]')).toBeNull()
  })

  it('clears its active descendant for empty results and dismisses on focus leaving without stealing focus', () => {
    const { el, trigger, input, onChange } = mount()
    click(trigger)
    search(input(), 'not-a-column')
    expect(input().hasAttribute('aria-activedescendant')).toBe(false)
    expect(el.querySelector('[role="status"]')?.textContent).toBe('No columns found.')
    press(input(), 'Enter')
    const next = el.lastElementChild as HTMLButtonElement
    press(input(), 'Tab')
    // jsdom does not perform the browser's Tab default action; focus the next control.
    act(() => next.focus())
    expect(document.activeElement).toBe(next)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(el.querySelector('[role="listbox"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    click(trigger)
    expect(input().value).toBe('')
    expect(el.querySelectorAll('[role="option"]')).toHaveLength(3)
  })

  it('keeps input focus on option mousedown, commits clicked choices, and click-away writes nothing', () => {
    const { el, trigger, input, onChange } = mount()
    click(trigger)
    const option = el.querySelector<HTMLElement>('[role="option"][data-value="note.priority"]')!
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    act(() => { option.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(input())
    click(option)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('note.priority')
    click(trigger)
    search(input(), 'file.name')
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(el.querySelector('[role="listbox"]')).toBeNull()
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(trigger.textContent).toContain('Priority')
  })
})

/** The checklist half of the same component (🔒 D6, YAZ-1467): ticks instead of a single choice. */
function mountMultiple(initial: string[] = []) {
  const onChange = vi.fn()
  function Harness() {
    const [value, setValue] = useState(initial)
    return <ColumnPicker multiple noun="options" label="Value" value={value} options={[
      { value: 'Done', label: 'Done' },
      { value: 'Doing', label: 'Doing' },
      { value: 'Idea', label: 'Idea' },
    ]} onChange={(next) => { onChange(next); setValue(next) }} />
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<Harness />))
  const el = container
  const trigger = el.querySelector<HTMLButtonElement>('[aria-label="Value"]')!
  const option = (value: string) => el.querySelector<HTMLElement>(`[role="option"][data-value="${value}"]`)!
  return { el, trigger, option, input: () => el.querySelector<HTMLInputElement>('[role="combobox"]')!, onChange }
}

describe('ColumnPicker as a value checklist (YAZ-1467)', () => {
  it('toggles on click and on Enter, one write each, and the panel stays open', () => {
    const { el, trigger, option, input, onChange } = mountMultiple()
    expect(trigger.textContent).toContain('Choose…')
    click(trigger)
    expect(el.querySelector('[role="listbox"]')?.getAttribute('aria-multiselectable')).toBe('true')
    click(option('Doing'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Doing'])
    expect(el.querySelector('[role="listbox"]')).not.toBeNull()
    expect(option('Doing').getAttribute('aria-selected')).toBe('true')
    expect(option('Done').getAttribute('aria-selected')).toBe('false')
    press(input(), 'ArrowDown')
    press(input(), 'ArrowDown')
    press(input(), 'Enter')
    expect(onChange).toHaveBeenLastCalledWith(['Doing', 'Idea'])
    click(option('Doing'))
    expect(onChange).toHaveBeenLastCalledWith(['Idea'])
    expect(onChange).toHaveBeenCalledTimes(3)
    expect(trigger.textContent).toContain('Idea')
  })

  it('says options where the single picker says columns, and opens on the first tick', () => {
    const { el, trigger, input, onChange } = mountMultiple(['Doing'])
    expect(trigger.textContent).toContain('Doing')
    click(trigger)
    expect(input().placeholder).toBe('Search options…')
    expect(el.querySelector('[role="listbox"]')?.getAttribute('aria-label')).toBe('Value options')
    expect(input().getAttribute('aria-activedescendant')).toBe(el.querySelector('[role="option"][data-value="Doing"]')!.id)
    search(input(), 'not-a-value')
    expect(el.querySelector('[role="status"]')?.textContent).toBe('No options found.')
    act(() => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(el.querySelector('[role="listbox"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
})
