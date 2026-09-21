// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcRenderer } from 'electron'
import { CH } from '../channels'
import { bridge } from './index'

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn(), on: vi.fn(), send: vi.fn(), removeListener: vi.fn() },
}))

const emit = (mode: unknown) => {
  const handler = vi.mocked(ipcRenderer.on).mock.calls.find(([ch]) => ch === CH.menuCopyAs)?.[1]
  expect(handler).toBeDefined()
  ;(handler as unknown as (event: unknown, mode: unknown) => void)(undefined, mode)
}
const subscriptions: Array<() => void> = []
beforeEach(() => {
  vi.mocked(ipcRenderer.invoke).mockReset().mockResolvedValue({ ok: true, value: undefined })
  document.body.innerHTML = ''
  window.getSelection()?.removeAllRanges()
})
afterEach(() => { subscriptions.splice(0).forEach((off) => off()) })

function selectedInput(tag: 'input' | 'textarea', value: string, start: number, end: number, type = 'text') {
  const input = document.createElement(tag)
  if (input instanceof HTMLInputElement) input.type = type
  input.value = value
  document.body.append(input)
  input.focus()
  input.setSelectionRange(start, end)
  return input
}

describe('Copy as preload selection routing', () => {
  it('the first claiming editor writes its selection once, and unsubscribe removes it', () => {
    const unfocused = vi.fn(() => undefined)
    const focused = vi.fn(() => '**selected**')
    const later = vi.fn(() => 'later')
    subscriptions.push(bridge.menu.onCopyAs(unfocused))
    const off = bridge.menu.onCopyAs(focused)
    subscriptions.push(off, bridge.menu.onCopyAs(later))
    emit('markdown')
    expect(unfocused).toHaveBeenCalledWith('markdown')
    expect(focused).toHaveBeenCalledWith('markdown')
    expect(later).not.toHaveBeenCalled()
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(CH.menuCopyText, '**selected**')
    off()
    vi.mocked(ipcRenderer.invoke).mockClear()
    emit('plain')
    expect(focused).toHaveBeenCalledTimes(1)
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(CH.menuCopyText, 'later')
  })

  it('an empty editor selection claims without overwriting the clipboard or falling through', () => {
    selectedInput('input', 'stale input selection', 0, 5)
    const later = vi.fn(() => 'wrong')
    subscriptions.push(bridge.menu.onCopyAs(() => ''), bridge.menu.onCopyAs(later))
    emit('plain')
    expect(later).not.toHaveBeenCalled()
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it.each(['plain', 'markdown'])('%s keeps ordinary input and textarea selections literal', (mode) => {
    selectedInput('input', 'before **literal** after', 7, 18)
    emit(mode)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(CH.menuCopyText, '**literal**')
    const area = selectedInput('textarea', '# Heading\nnext line', 2, 14)
    emit(mode)
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(CH.menuCopyText, 'Heading\nnext')
    vi.mocked(ipcRenderer.invoke).mockClear()
    area.setSelectionRange(4, 4)
    emit(mode)
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('never reads password values or writes for password selections', () => {
    const password = selectedInput('input', 'secret', 0, 6, 'password')
    const value = vi.spyOn(password, 'value', 'get')
    emit('plain')
    emit('markdown')
    expect(value).not.toHaveBeenCalled()
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('copies a focused CodeMirror DOM selection literally and ignores a stale selection outside the focus', () => {
    document.body.innerHTML = '<div class="cm-content" contenteditable="true" tabindex="0">const **literal** = 1</div><button>Elsewhere</button>'
    const code = document.querySelector<HTMLElement>('.cm-content')!
    code.focus()
    const range = document.createRange()
    range.setStart(code.firstChild!, 6)
    range.setEnd(code.firstChild!, 17)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    emit('markdown')
    expect(ipcRenderer.invoke).toHaveBeenCalledExactlyOnceWith(CH.menuCopyText, '**literal**')
    vi.mocked(ipcRenderer.invoke).mockClear()
    document.querySelector('button')!.focus()
    emit('plain')
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })

  it('invalid modes and collapsed DOM selections do not call subscribers or write', () => {
    const listener = vi.fn(() => undefined)
    subscriptions.push(bridge.menu.onCopyAs(listener))
    emit('html')
    emit({ mode: 'plain' })
    expect(listener).not.toHaveBeenCalled()
    emit('plain')
    expect(ipcRenderer.invoke).not.toHaveBeenCalled()
  })
})
