/**
 * The Share dialog (YAZ-1799 D6, YAZ-1888): one component per state it can show, the two pickers
 * driven by keyboard, and the modal's key boundary — nothing typed in the dialog or its menus
 * reaches the sidebar tree behind it, and nothing aimed at the tree while it is open can share or
 * unshare a board (the prototype's keyboard-test incident).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ShareEntry, ShareStatus } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    share: {
      status: vi.fn(),
      get: vi.fn(),
      publish: vi.fn(),
      stop: vi.fn(),
      setPermission: vi.fn(),
      onChanged: vi.fn(() => () => {}),
    },
  },
}))
vi.mock('./shareContent', () => ({ buildShareContent: vi.fn(async () => ({ content: '{"type":"excalidraw"}', bytes: 20, tooLarge: false })), formatMB: (b: number) => `${b / 1e6} MB` }))

import { api } from '../api'
import { buildShareContent } from './shareContent'
import { noteBoardSaved, resetLiveShareForTests } from './liveShare'
import { liveLine, ShareDialog } from './ShareDialog'

const share = vi.mocked(api.share)
const ROOT = '/v'
const P = '/v/Sub/Roadmap.excalidraw'
const READY = { state: 'ready' } as ShareStatus
const NOW = Date.now()
const entry = (over: Partial<ShareEntry> = {}): ShareEntry => ({ path: P, id: 'abc', url: 'https://share.test/b/abc', allowDownload: true, sharedAt: NOW - 86_400_000, updatedAt: NOW - 5 * 60_000, sync: { state: 'ok' }, stale: false, ...over })

let root: Root | null = null
let host: HTMLElement
const writeText = vi.fn(async () => {})

beforeEach(() => {
  share.status.mockReset().mockResolvedValue(READY)
  share.get.mockReset().mockResolvedValue(null)
  share.publish.mockReset().mockResolvedValue(entry())
  share.stop.mockReset().mockResolvedValue(undefined)
  share.setPermission.mockReset().mockImplementation(async ({ allowDownload }) => entry({ allowDownload }))
  vi.mocked(buildShareContent).mockClear()
  writeText.mockClear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  resetLiveShareForTests()
  vi.useRealTimers()
})

const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve()
  })

/** The dialog beside a stand-in for the sidebar tree, wired the way the real one hears keys. */
async function mount() {
  const onClose = vi.fn()
  const onOpenSettings = vi.fn()
  const treeKeys: string[] = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <>
        {/* The Sidebar body's React onKeyDown and a row button, as in Sidebar.tsx / Tree.tsx. */}
        <div className="sidebar__body" onKeyDown={(e) => treeKeys.push(`react:${e.key}`)}>
          <button type="button" className="tree__row" data-testid="row">
            Roadmap
          </button>
        </div>
        <ShareDialog root={ROOT} path={P} onClose={onClose} onOpenSettings={onOpenSettings} />
      </>,
    ),
  )
  await flush()
  return { onClose, onOpenSettings, treeKeys }
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)
const byTest = (id: string) => $(`[data-testid="${id}"]`) as HTMLButtonElement
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]')]
const click = (el: Element | null) => act(() => (el as HTMLElement).click())
const key = (target: Element, k: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
  act(() => void target.dispatchEvent(ev))
  return ev
}
/** A browser's button activation: Enter clicks on keydown, Space on keyup — unless a handler prevented it. */
const press = (k: 'Enter' | ' ') => {
  const el = document.activeElement as HTMLElement
  const down = key(el, k)
  if (k === 'Enter' && !down.defaultPrevented && el instanceof HTMLButtonElement) click(el)
  if (k === ' ') {
    const up = new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true })
    act(() => void el.dispatchEvent(up))
    if (!down.defaultPrevented && el instanceof HTMLButtonElement) click(el)
  }
}
const status = () => byTest('share-live')

describe('Share dialog states (YAZ-1888)', () => {
  it('not set up: says so, and its one button opens Settings › Sharing', async () => {
    share.status.mockResolvedValue({ state: 'off' } as ShareStatus)
    const { onClose, onOpenSettings } = await mount()
    expect($('.share-dialog__title')?.textContent).toBe('Share “Roadmap”')
    expect($('.share-dialog__text')?.textContent).toMatch(/isn't set up/)
    expect(byTest('share-access')).toBeNull()
    click(byTest('share-setup'))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('not shared: grey lock, "Not shared", only-you helper, no permission picker, no status, Copy link off', async () => {
    await mount()
    expect(byTest('share-access').textContent).toBe('Not shared')
    expect($('.share-access__icon')?.classList.contains('share-access__icon--on')).toBe(false)
    expect($('.share-access__helper')?.textContent).toBe('Only you can open this board')
    expect(byTest('share-permission')).toBeNull()
    expect(status()).toBeNull()
    expect(byTest('share-copy').disabled).toBe(true)
  })

  it('shared, view and download: green globe, both pickers, "Up to date", Copy link shows Copied for 1.5 s', async () => {
    share.get.mockResolvedValue(entry())
    await mount()
    expect(byTest('share-access').textContent).toBe('Anyone with the link')
    expect($('.share-access__icon')?.classList.contains('share-access__icon--on')).toBe(true)
    expect($('.share-access__helper')?.textContent).toBe('Anyone on the internet with this link can view and download')
    expect(byTest('share-permission').textContent).toBe('View and download')
    expect(status().textContent).toBe('Up to date · 5 minutes ago')
    expect(status().className).toContain('share-status--ok')
    vi.useFakeTimers()
    click(byTest('share-copy'))
    await flush()
    expect(writeText).toHaveBeenCalledWith('https://share.test/b/abc')
    expect(byTest('share-copy').textContent).toBe('Copied')
    act(() => vi.advanceTimersByTime(1500))
    expect(byTest('share-copy').textContent).toBe('Copy link')
  })

  it('shared, view only: the permission picker and the helper say so', async () => {
    share.get.mockResolvedValue(entry({ allowDownload: false }))
    await mount()
    expect(byTest('share-permission').textContent).toBe('View only')
    expect($('.share-access__helper')?.textContent).toBe('Anyone on the internet with this link can view')
  })

  it('uploading, and saved edits waiting out the settle period, read as busy', async () => {
    share.get.mockResolvedValue(entry({ sync: { state: 'uploading' } }))
    await mount()
    expect(status().textContent).toBe('Uploading…')
    expect(status().className).toContain('share-status--busy')
    act(() => root?.unmount())
    noteBoardSaved(ROOT, P, 1e9)
    share.get.mockResolvedValue(entry())
    await mount()
    expect(status().textContent).toBe('Waiting to upload changes…')
  })

  it('failed: red, with the reason', async () => {
    share.get.mockResolvedValue(entry({ sync: { state: 'failed', message: 'You are offline.' } }))
    await mount()
    expect(status().textContent).toBe("Couldn't update: You are offline.")
    expect(status().className).toContain('share-status--error')
  })

  it('stale (the copy is gone from Cloudflare): red, and how to fix it', async () => {
    share.get.mockResolvedValue(entry({ stale: true }))
    await mount()
    expect(status().textContent).toMatch(/^Couldn't update: the shared copy is gone from Cloudflare/)
    expect(status().className).toContain('share-status--error')
  })

  it('liveLine: uploading beats pending beats failed beats stale beats up to date', () => {
    expect(liveLine(entry({ sync: { state: 'uploading' }, stale: true }), true, NOW).text).toBe('Uploading…')
    expect(liveLine(entry({ sync: { state: 'failed', message: 'x' } }), true, NOW).tone).toBe('busy')
    expect(liveLine(entry({ sync: { state: 'failed', message: 'x' }, stale: true }), false, NOW).text).toBe("Couldn't update: x")
    expect(liveLine(entry({ stale: true }), false, NOW).tone).toBe('error')
    expect(liveLine(entry(), false, NOW)).toEqual({ tone: 'ok', text: 'Up to date · 5 minutes ago' })
  })
})

describe('Share dialog actions (YAZ-1888)', () => {
  it('"Anyone with the link" shares the export (Uploading… meanwhile); "Not shared" stops it', async () => {
    let finish: (e: ShareEntry) => void = () => {}
    share.publish.mockImplementation(() => new Promise((r) => (finish = r)))
    await mount()
    click(byTest('share-access'))
    expect(items().map((b) => [b.textContent, b.dataset.hint ?? ''])).toEqual([
      ['Not shared', '✓'],
      ['Anyone with the link', ''],
    ])
    click(items()[1])
    await flush()
    expect(buildShareContent).toHaveBeenCalledWith(ROOT, P)
    expect(share.publish).toHaveBeenCalledWith({ root: ROOT, path: P, content: '{"type":"excalidraw"}' })
    expect(status().textContent).toBe('Uploading…')
    expect(byTest('share-done').disabled).toBe(true)
    await act(async () => finish(entry({ updatedAt: Date.now() })))
    await flush()
    expect(status().textContent).toBe('Up to date · just now')
    expect(byTest('share-permission').textContent).toBe('View and download')

    click(byTest('share-access'))
    click(items()[0])
    await flush()
    expect(share.stop).toHaveBeenCalledWith({ root: ROOT, path: P })
    expect(byTest('share-access').textContent).toBe('Not shared')
    expect(byTest('share-permission')).toBeNull()
  })

  it('the permission flips on the same link, instantly; picking the ticked option does nothing', async () => {
    share.get.mockResolvedValue(entry())
    await mount()
    click(byTest('share-permission'))
    click(items()[0]) // "View and download", already ticked
    expect(share.setPermission).not.toHaveBeenCalled()
    click(byTest('share-permission'))
    click(items()[1])
    await flush()
    expect(share.setPermission).toHaveBeenCalledWith({ root: ROOT, path: P, allowDownload: false })
    expect(byTest('share-permission').textContent).toBe('View only')
    expect(share.publish).not.toHaveBeenCalled()
  })

  it('a board too large to share says why, in red, and stays unshared', async () => {
    vi.mocked(buildShareContent).mockResolvedValueOnce({ content: '', bytes: 150e6, tooLarge: true })
    await mount()
    click(byTest('share-access'))
    click(items()[1])
    await flush()
    expect(share.publish).not.toHaveBeenCalled()
    expect(status().className).toContain('share-status--error')
    expect(status().textContent).toMatch(/150 MB/)
    expect(byTest('share-access').textContent).toBe('Not shared')
  })
})

describe('Share dialog keyboard (YAZ-1888)', () => {
  it('focus is inside the dialog from the first frame, then lands on the access picker once loaded', async () => {
    let answer: (s: ShareStatus) => void = () => {}
    share.status.mockImplementation(() => new Promise((r) => (answer = r)))
    const row = document.createElement('button')
    document.body.appendChild(row)
    row.focus()
    await mount()
    expect(document.activeElement).toBe(byTest('share-dialog'))
    await act(async () => answer(READY))
    await flush()
    expect(document.activeElement).toBe(byTest('share-access'))
    act(() => root?.unmount())
    root = null
    expect(document.activeElement).toBe(row) // focus goes back to whatever had it
  })

  it('Enter opens a menu on the ticked option, arrows move and wrap, Enter picks', async () => {
    share.get.mockResolvedValue(entry())
    await mount()
    byTest('share-permission').focus()
    press('Enter')
    expect(byTest('share-permission').getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(items()[0])
    key(document.activeElement as Element, 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    key(document.activeElement as Element, 'ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    key(document.activeElement as Element, 'ArrowUp')
    expect(document.activeElement).toBe(items()[1])
    press('Enter')
    await flush()
    expect(share.setPermission).toHaveBeenCalledWith({ root: ROOT, path: P, allowDownload: false })
    expect(items()).toEqual([])
    expect(document.activeElement).toBe(byTest('share-permission'))
  })

  it('Space opens a menu too; Esc closes the menu first (focus back on its button), then the dialog', async () => {
    const { onClose } = await mount()
    byTest('share-access').focus()
    press(' ')
    expect(items()).toHaveLength(2)
    key(document.activeElement as Element, 'Escape')
    expect(items()).toEqual([])
    expect(document.activeElement).toBe(byTest('share-access'))
    expect(onClose).not.toHaveBeenCalled()
    key(document.activeElement as Element, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab closes an open menu; Tab and Shift+Tab cycle inside the dialog', async () => {
    share.get.mockResolvedValue(entry())
    await mount()
    click(byTest('share-access'))
    key(document.activeElement as Element, 'Tab')
    expect(items()).toEqual([])
    expect(document.activeElement).toBe(byTest('share-access'))
    const order = ['Close', 'General access: Anyone with the link', 'People with the link can: View and download', 'Copy link', 'Done']
    const name = () => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? document.activeElement?.textContent
    const seen = [name()]
    for (let i = 0; i < 4; i++) {
      key(document.activeElement as Element, 'Tab')
      seen.push(name())
    }
    expect(seen).toEqual(order.slice(1).concat(order[0]))
    key(document.activeElement as Element, 'Tab', { shiftKey: true })
    expect(name()).toBe('Done')
  })

  it('a held Enter never shares or unshares: it only opens and closes the menu on the ticked option', async () => {
    await mount()
    byTest('share-access').focus()
    for (let i = 0; i < 12; i++) press('Enter')
    for (let i = 0; i < 12; i++) press(' ')
    await flush()
    expect(share.publish).not.toHaveBeenCalled()
    expect(share.stop).not.toHaveBeenCalled()
  })
})

describe('the keyboard incident: keys never leak to the sidebar tree (YAZ-1888)', () => {
  const KEYS: [string, KeyboardEventInit?][] = [['Enter'], [' '], ['ArrowDown'], ['ArrowUp'], ['Delete'], ['Backspace'], ['a'], ['c', { metaKey: true }], ['v', { metaKey: true }], ['b', { metaKey: true }]]

  it('no key typed in the dialog or its open menus reaches the tree, the document or the window', async () => {
    share.get.mockResolvedValue(entry())
    const outside: string[] = []
    const onDoc = (e: KeyboardEvent) => outside.push(`document:${e.key}`)
    const onWin = (e: KeyboardEvent) => outside.push(`window:${e.key}`)
    document.addEventListener('keydown', onDoc)
    window.addEventListener('keydown', onWin)
    try {
      const { treeKeys } = await mount()
      const targets = () => [byTest('share-dialog'), byTest('share-access'), byTest('share-permission'), byTest('share-copy'), byTest('share-done')]
      for (const t of targets()) for (const [k, init] of KEYS) key(t, k, init)
      for (const which of ['share-access', 'share-permission']) {
        click(byTest(which))
        for (const item of items()) for (const [k, init] of KEYS.filter(([k]) => k !== 'Enter' && k !== ' ')) key(item, k, init)
        key(document.activeElement as Element, 'Escape')
      }
      expect(treeKeys).toEqual([])
      expect(outside).toEqual([])
    } finally {
      document.removeEventListener('keydown', onDoc)
      window.removeEventListener('keydown', onWin)
    }
  })

  it("while it is open, keys aimed at the tree are swallowed and focus pulled back in — they can't share or unshare", async () => {
    share.get.mockResolvedValue(entry())
    const { treeKeys, onClose } = await mount()
    for (const [k, init] of KEYS) {
      byTest('row').focus()
      key(byTest('row'), k, init)
      expect(document.activeElement).toBe(byTest('share-dialog'))
    }
    await flush()
    expect(treeKeys).toEqual([])
    expect(share.publish).not.toHaveBeenCalled()
    expect(share.stop).not.toHaveBeenCalled()
    expect(share.setPermission).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
