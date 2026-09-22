/**
 * The sidebar's inline rename box (Links E1, GRO-2194; YAZ-1553): ONE door. Leaving the field —
 * click-away, Enter, Cmd-Tab — commits the name; Escape is the only discard. The parent owns the
 * same-name no-op and the confirm sheet, so this box only decides: submit, keep editing, or cancel.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RenameInline } from './RenameInline'


let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

function mount(onSubmit: (name: string) => Promise<void> = () => Promise.resolve()) {
  const submit = vi.fn(onSubmit)
  const onCancel = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<RenameInline initial="Old Note" indent={0} onSubmit={submit} onCancel={onCancel} />))
  const field = container.querySelector<HTMLInputElement>('.create-inline__input')
  if (field === null) throw new Error('the rename input did not mount')
  return { el: container, field, onSubmit: submit, onCancel }
}

const error = (el: HTMLElement) => el.querySelector('.create-inline__error')?.textContent ?? null
const press = (field: HTMLInputElement, key: string) => act(() => void field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })))
const leave = (field: HTMLInputElement) => act(() => void field.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
const flush = () => act(async () => {})

describe('RenameInline (YAZ-1553)', () => {
  it('mounts focused with the current name selected', () => {
    const { field } = mount()
    expect(document.activeElement).toBe(field)
    expect(field.value).toBe('Old Note')
  })

  it('Enter commits through the one door: focus leaves, the trimmed name is submitted', async () => {
    const { field, onSubmit } = mount()
    field.value = '  New Note  '
    press(field, 'Enter')
    await flush()
    expect(onSubmit).toHaveBeenCalledWith('New Note')
    expect(document.activeElement).not.toBe(field)
  })

  it('click-away commits the changed name', async () => {
    const { field, onSubmit, onCancel } = mount()
    field.value = 'New Note'
    leave(field)
    await flush()
    expect(onSubmit).toHaveBeenCalledWith('New Note')
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('click-away with the unchanged name still submits — the parent owns the same-name no-op', async () => {
    const { field, onSubmit } = mount()
    leave(field)
    await flush()
    expect(onSubmit).toHaveBeenCalledWith('Old Note')
  })

  it('click-away with an empty name cancels: there is nothing to commit', async () => {
    const { field, onSubmit, onCancel } = mount()
    field.value = '   '
    leave(field)
    await flush()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('click-away with a name the rules reject keeps the box open with the error — the typing is not lost', async () => {
    const { el, field, onSubmit, onCancel } = mount()
    field.value = 'a/b'
    leave(field)
    await flush()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(error(el)).toBe('Name cannot contain "/"')
    expect(field.isConnected).toBe(true)
  })

  it('Escape discards, and the trailing blur Chromium fires on removal submits nothing', async () => {
    const { field, onSubmit, onCancel } = mount()
    field.value = 'Discarded'
    act(() => {
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await flush()
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('one leave submits ONCE even when the trailing blur follows it', async () => {
    const { field, onSubmit } = mount()
    field.value = 'Once'
    act(() => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    await flush()
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('a rejected submit shows its message and keeps the box open; leaving again retries', async () => {
    let calls = 0
    const { el, field, onSubmit } = mount(() => (++calls === 1 ? Promise.reject(new Error('Taken')) : Promise.resolve()))
    field.value = 'New Note'
    leave(field)
    await flush()
    expect(error(el)).toBe('Taken')
    leave(field)
    await flush()
    expect(onSubmit).toHaveBeenCalledTimes(2)
  })
})
