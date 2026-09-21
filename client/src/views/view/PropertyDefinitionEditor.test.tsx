import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropertyDecl } from '@shared/types'
import { PropertyDefinitionEditor } from './PropertyDefinitionEditor'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
const initial = ['First', 'Second', 'Third', 'Fourth']
function mount(options = initial) {
  const change = vi.fn()
  function Harness() {
    const [value, setValue] = useState<PropertyDecl>({ kind: 'select', options })
    return <PropertyDefinitionEditor value={value} onChange={next => { change(next.options); setValue(next) }} />
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  act(() => root.render(<Harness />))
  return change
}
afterEach(() => { act(() => root.unmount()); host.remove() })
const rows = () => [...host.querySelectorAll<HTMLElement>('.property-def__option')]
const handle = (i: number) => rows()[i].querySelector('button')!
function drag(element: Element, type: string, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY: y })
  act(() => element.dispatchEvent(event))
}
function hover(index: number, half: 'top' | 'bottom') {
  const row = rows()[index]
  row.getBoundingClientRect = () => ({ top: 100, height: 34 } as DOMRect)
  drag(row, 'dragover', half === 'top' ? 105 : 130)
  return row
}

describe('option reorder feedback', () => {
  it('shows the insertion boundary before a row and drops down into that exact slot', () => {
    const change = mount()
    drag(handle(0), 'dragstart')
    const target = hover(2, 'top')
    expect(target.dataset.insert).toBe('before')
    expect(change).not.toHaveBeenCalled()
    drag(target, 'drop', 105)
    expect(change).toHaveBeenCalledExactlyOnceWith(['Second', 'First', 'Third', 'Fourth'])
    expect(host.querySelector('[data-insert]')).toBeNull()
  })
  it('shows the end boundary and can drop after the last option', () => {
    const change = mount()
    drag(handle(0), 'dragstart')
    const target = hover(3, 'bottom')
    expect(target.dataset.insert).toBe('after')
    drag(target, 'drop', 130)
    expect(change).toHaveBeenCalledExactlyOnceWith(['Second', 'Third', 'Fourth', 'First'])
  })
  it('moves upward below the hovered row, matching the indicator', () => {
    const change = mount()
    drag(handle(3), 'dragstart')
    const target = hover(0, 'bottom')
    expect(rows()[1].dataset.insert).toBe('before')
    drag(target, 'drop', 130)
    expect(change).toHaveBeenCalledExactlyOnceWith(['First', 'Fourth', 'Second', 'Third'])
  })
  it('cancels without changing the order or leaving an insertion line', () => {
    const change = mount()
    drag(handle(0), 'dragstart'); hover(3, 'top')
    drag(handle(0), 'dragend')
    expect(change).not.toHaveBeenCalled()
    expect(host.querySelector('[data-insert]')).toBeNull()
    expect(host.querySelector('[data-dragging]')).toBeNull()
  })
  it('does not write when dropping at either edge of the same slot; keyboard reorder still works', () => {
    const change = mount()
    drag(handle(1), 'dragstart')
    drag(hover(1, 'bottom'), 'drop', 130)
    expect(change).not.toHaveBeenCalled()
    act(() => handle(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })))
    expect(change).toHaveBeenCalledExactlyOnceWith(['Second', 'First', 'Third', 'Fourth'])
  })
})


describe('option order modes', () => {
  const labels = () => [...host.querySelectorAll('.property-def__chip')].map(chip => chip.textContent)
  const setMode = (mode: string) => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Option order"]')!
    act(() => { select.value = mode; select.dispatchEvent(new Event('change', { bubbles: true })) })
  }
  it('shows natural alphabetical order, hides drag handles, and restores manual order', () => {
    const manual = ['Stage 10', 'alpha', 'Stage 2']
    const change = mount(manual)
    setMode('ascending')
    expect(labels()).toEqual(['alpha', 'Stage 2', 'Stage 10'])
    expect(host.querySelector('[draggable]')).toBeNull()
    expect(change).toHaveBeenLastCalledWith(manual)
    setMode('descending')
    expect(labels()).toEqual(['Stage 10', 'Stage 2', 'alpha'])
    setMode('manual')
    expect(labels()).toEqual(manual)
    expect(host.querySelectorAll('[draggable]')).toHaveLength(3)
  })
  it('removes the selected sorted option from its original manual position', () => {
    const change = mount(['Z', 'A', 'M'])
    setMode('ascending')
    act(() => host.querySelector<HTMLButtonElement>('[aria-label="Edit option A"]')!.click())
    act(() => host.querySelector<HTMLButtonElement>('.property-def__delete')!.click())
    expect(change).toHaveBeenLastCalledWith(['Z', 'M'])
    expect(labels()).toEqual(['M', 'Z'])
    setMode('manual')
    expect(labels()).toEqual(['Z', 'M'])
  })
})
