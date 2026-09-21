import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditableCell } from './EditableCell'
import { fromYaml } from '../expr'

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let redraw: (raw: unknown) => void
const click = (element: Element | null) => act(() => (element as HTMLElement)?.click())
function mount(raw: unknown, multiple = false, onCommit = vi.fn().mockResolvedValue(undefined)) {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  redraw = raw => act(() => root.render(<EditableCell path="/scratch/note.md" propKey="Status" raw={raw} value={fromYaml(raw)} editor={multiple ? 'multi-select' : 'select'} options={['Ready', 'Later']} basenames={[]} onCommit={onCommit} />))
  redraw(raw)
  click(host.querySelector('[data-edit]'))
  return onCommit
}
afterEach(() => { act(() => root.unmount()); host.remove() })
const option = (label: string) => [...document.querySelectorAll('[role="option"]')].find(el => el.textContent?.startsWith(label)) ?? null

describe('shared Select value popover', () => {
  it('opens outside the cell, keeps the value visible and writes the exact configured option', () => {
    const save = mount('Ready')
    expect(host.textContent).toContain('Ready')
    expect(host.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    click(option('Later'))
    expect(save).toHaveBeenCalledExactlyOnceWith('Later')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(host.textContent).toContain('Later')
  })
  it('keeps unknown stored values available without silently changing them', () => {
    const save = mount('Legacy')
    expect(option('Legacy')?.textContent).toContain('Existing value')
    act(() => document.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(save).not.toHaveBeenCalled()
  })
  it('persists each multi-selection and keeps the menu open for another choice', async () => {
    const save = mount(['Ready'], true)
    click(option('Later'))
    expect(save).toHaveBeenLastCalledWith(['Ready', 'Later'])
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    click(option('Later'))
    await act(async () => {})
    expect(save).toHaveBeenLastCalledWith(['Ready'])
    click(option('Ready'))
    await act(async () => {})
    expect(save).toHaveBeenLastCalledWith([])
    act(() => document.querySelector('[role="listbox"]')?.dispatchEvent(new Event('scroll', { bubbles: false })))
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('clears a single choice to null and shows Empty', () => {
    const save = mount('Ready')
    click([...document.querySelectorAll('button')].find(b => b.textContent === 'Clear') ?? null)
    expect(save).toHaveBeenCalledExactlyOnceWith(null)
    expect(host.textContent).toBe('Empty')
  })
})

describe('multi-select persistence ordering', () => {
  it('serializes rapid choices so an earlier write cannot overwrite the final selection', async () => {
    let finishFirst!: () => void
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finishFirst = resolve })).mockResolvedValue(undefined)
    mount(['Ready'], true, save)
    click(option('Later'))
    click(option('Ready'))
    expect(save).toHaveBeenCalledTimes(1)
    await act(async () => { finishFirst() })
    expect(save).toHaveBeenNthCalledWith(2, ['Later'])
  })

  it('reconciles the open picker after a failed write', async () => {
    let fail!: (error: Error) => void
    const save = vi.fn().mockImplementation(() => new Promise<void>((_, reject) => { fail = reject }))
    mount(['Ready'], true, save)
    click(option('Later'))
    expect(option('Later')?.getAttribute('aria-selected')).toBe('true')
    await act(async () => { fail(new Error('disk unavailable')) })
    expect(option('Later')?.getAttribute('aria-selected')).toBe('false')
    expect(option('Ready')?.getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Save failed')
  })
})

it('retains the last choice through intermediate index echoes after all writes resolve', async () => {
  const save = mount(['Ready'], true)
  click(option('Later'))
  click(option('Ready'))
  await act(async () => {})
  expect(save).toHaveBeenLastCalledWith(['Later'])
  redraw(['Ready', 'Later'])
  expect(option('Ready')?.getAttribute('aria-selected')).toBe('false')
  expect(host.textContent).toBe('Later')
  redraw(['Later'])
  expect(host.textContent).toBe('Later')
  // A subsequent external edit is not hidden by an already-acknowledged optimistic choice.
  redraw(['Ready'])
  expect(host.textContent).toBe('Ready')
})
