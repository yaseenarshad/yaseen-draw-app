/**
 * Settings › Storage (YAZ-1801 D1): its own page (standalone, before Hotkeys), present only with a
 * vault open. One bar that always ends at 10 GB (D7), with "Your files" and "Old versions" on two
 * muted lines under it; "Needs attention" only when a file is ≥ 50 MiB (red at the sync guard's
 * 95 MiB, amber below); "Make boards smaller" only while pictures are inside boards, its result
 * line outliving the numbers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { DEFAULT_SETTINGS, GITHUB_FILE_LIMIT_BYTES, type VaultStorageStats } from '@shared/types'
import { api } from '../api'
import { useVaultStorage, type VaultStorageState } from '../hooks/useVaultStorage'
import { SettingsDialog } from './SettingsDialog'
import { historyBar } from './storageSection'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    drawing: { libraryFolder: vi.fn(async () => '/userData/library') },
    pickFolder: vi.fn(async () => ({ cancelled: true as const })),
    secrets: { has: vi.fn(async () => false), set: vi.fn(async () => undefined) },
    storage: { stats: vi.fn(async () => STATS), shrink: vi.fn() },
  },
}))

const MB = 1024 * 1024
const GB = 1024 * MB
const STATS: VaultStorageStats = {
  root: '/v',
  boards: { bytes: 200 * MB, count: 12 },
  pictures: { bytes: 2 * MB, count: 4 },
  other: { bytes: 30 * MB, count: 1 },
  git: { historyBytes: 128 * MB, headBytes: 90 * MB, oldVersionsBytes: 38 * MB },
  large: [
    { path: 'Big video.mov', bytes: 120 * MB },
    { path: 'Too big.excalidraw', bytes: GITHUB_FILE_LIMIT_BYTES },
    { path: 'Folder/Sixty.excalidraw', bytes: 60 * MB },
  ],
  embedded: { bytes: 232 * MB, boards: 9 },
}

let root: Root | null = null
let container: HTMLElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
})

type StorageCtx = VaultStorageState

function render(storage: StorageCtx | undefined) {
  act(() => root?.render(<SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), sync: { status: null, setEnabled: vi.fn() }, storage }} onClose={vi.fn()} />))
}

function mount(stats: VaultStorageStats | null, over: Partial<StorageCtx> = {}, withStorage = true) {
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const storage: StorageCtx | undefined = withStorage ? { stats, failed: false, refresh: vi.fn(), shrink: vi.fn(async () => ({ shrunk: 0, skipped: 0, bytesMoved: 0 })), lastShrink: null, ...over } : undefined
  render(storage)
  return { el: container, storage }
}

const navTitles = (el: HTMLElement) => [...el.querySelectorAll('.settings-nav__item')].map((b) => b.textContent)
const openStorage = (el: HTMLElement) => {
  const button = [...el.querySelectorAll<HTMLButtonElement>('.settings-nav__item')].find((b) => b.textContent === 'Storage')!
  act(() => button.click())
}
const groupTitles = (el: HTMLElement) => [...el.querySelectorAll('.settings-group__title')].map((h) => h.textContent)
const row = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-setting="${id}"]`)

describe('Settings › Storage (YAZ-1801)', () => {
  it('is a standalone page under the divider, before Hotkeys — and absent with no vault', () => {
    const { el } = mount(STATS)
    expect(navTitles(el)).toEqual(['Appearance', 'Canvas', 'Files', 'Images', 'Sync', 'Storage', 'Sharing', 'Hotkeys'])
    // Under the divider with Hotkeys, not on the scrolling page.
    expect(el.querySelector('.settings-nav__divider + .settings-nav__item')?.textContent).toBe('Storage')
    expect(row(el, 'storageGithub')).toBeNull()
    openStorage(el)
    expect(el.textContent).toContain('This vault only. GitHub refuses any file over 100 MB and wants the whole repo under 1 GB.')
    act(() => root?.unmount())
    container?.remove()
    expect(navTitles(mount(null, {}, false).el)).not.toContain('Storage')
  })

  it('while measuring: the bar row says so and the conditional groups stay hidden', () => {
    const { el } = mount(null)
    openStorage(el)
    expect(row(el, 'storageGithub')?.textContent).toContain('Measuring…')
    expect(groupTitles(el)).toEqual([])
  })

  it("a failed first measure says so instead of measuring forever", () => {
    const { el } = mount(null, { failed: true })
    openStorage(el)
    expect(row(el, 'storageGithub')?.textContent).toContain("Couldn't measure this vault")
    expect(row(el, 'storageGithub')?.textContent).not.toContain('Measuring…')
  })

  it('measures again whenever the page is opened', () => {
    const { el, storage } = mount(STATS)
    expect(storage?.refresh).not.toHaveBeenCalled()
    openStorage(el)
    expect(storage?.refresh).toHaveBeenCalledOnce()
  })

  it('the bar row: history of 10 GB, then your files and old versions on two muted lines', () => {
    const { el } = mount(STATS)
    openStorage(el)
    const github = row(el, 'storageGithub')!
    expect(github.textContent).toContain('128.0 MB of 10 GB')
    expect(github.textContent).toContain('Your files 232.0 MB\nOld versions 38.0 MB')
    expect(github.querySelector('.storage__fill--ok')).not.toBeNull()
  })

  it('the bar always ends at 10 GB: green to 1 GB, amber to 5 GB, red past it, never under a 1 % sliver', () => {
    expect(historyBar(98 * MB)).toEqual({ pct: 1, tone: 'ok', of: '10 GB' })
    expect(historyBar(1.2 * GB)).toEqual({ pct: 12, tone: 'warn', of: '10 GB' })
    expect(historyBar(6 * GB)).toEqual({ pct: 60, tone: 'danger', of: '10 GB' })
    expect(historyBar(11 * GB)).toEqual({ pct: 100, tone: 'danger', of: "10 GB — over GitHub's max" })
  })

  it('a folder that is not a git repo: no bar, and just "Your files"', () => {
    const { el } = mount({ ...STATS, git: null })
    openStorage(el)
    const github = row(el, 'storageGithub')!
    expect(github.textContent).toContain('Not synced with git — nothing counts against GitHub')
    expect(github.textContent).toContain('Your files 232.0 MB')
    expect(github.textContent).not.toContain('Old versions')
    expect(github.querySelector('.storage__bar')).toBeNull()
  })

  it('needs attention: any large file, red at the sync guard ("Stays on this Mac"), amber below ("Close to the limit")', () => {
    const { el } = mount(STATS)
    openStorage(el)
    expect(groupTitles(el)).toEqual(['Needs attention', 'Make boards smaller'])
    const files = [...el.querySelectorAll<HTMLElement>('.storage__file')]
    expect(files.map((f) => f.dataset.path)).toEqual(['Big video.mov', 'Too big.excalidraw', 'Folder/Sixty.excalidraw'])
    expect(files.map((f) => f.classList.contains('storage__file--danger'))).toEqual([true, true, false])
    expect(files[1].textContent).toContain('Stays on this Mac')
    expect(files[2].textContent).toContain('Close to the limit')
    expect(files[1].textContent).not.toContain('.excalidraw')
  })

  it('both groups are gone when there is nothing to say', () => {
    const { el } = mount({ ...STATS, large: [], embedded: { bytes: 0, boards: 0 } })
    openStorage(el)
    expect(groupTitles(el)).toEqual([])
  })

  it('make boards smaller: the sentence carries the numbers, the button just acts, the result line stays after the numbers drop to zero', async () => {
    const { el, storage } = mount(STATS)
    openStorage(el)
    expect(el.textContent).toContain('9 boards still carry 232.0 MB of pictures inside.')
    const button = el.querySelector<HTMLButtonElement>('[data-testid="storage-shrink"]')!
    expect(button.textContent).toBe('Move pictures out')
    await act(async () => button.click())
    expect(storage?.shrink).toHaveBeenCalledOnce()
    // App's hook refreshes: the pictures are out, and it holds the result.
    render({ ...storage!, stats: { ...STATS, embedded: { bytes: 0, boards: 0 } }, lastShrink: { shrunk: 9, skipped: 1, bytesMoved: 230 * MB } })
    expect(groupTitles(el)).toContain('Make boards smaller')
    expect(el.querySelector('[data-testid="storage-shrink"]')).toBeNull()
    expect(el.textContent).toContain('9 boards 230.0 MB lighter · 1 skipped')
  })

  it("measures nothing while Settings is closed, and once when the page opens — not also on Settings' open (🔒 D13)", async () => {
    // App's wiring, real hook: a closed dialog passes no sync state; an open one passes the live one.
    function App({ open }: { open: boolean }) {
      const storage = useVaultStorage('/v', open ? 'synced' : null)
      return open ? <SettingsDialog ctx={{ settings: { ...DEFAULT_SETTINGS }, onChange: vi.fn(), sync: { status: null, setEnabled: vi.fn() }, storage }} onClose={vi.fn()} /> : null
    }
    const { el } = mount(null, {}, false)
    const stats = vi.mocked(api.storage.stats)
    stats.mockClear()
    await act(async () => root?.render(<App open={false} />))
    expect(stats).not.toHaveBeenCalled()
    await act(async () => root?.render(<App open />))
    expect(stats).not.toHaveBeenCalled()
    await act(async () => openStorage(el))
    expect(stats).toHaveBeenCalledOnce()
  })

  it('the pictures could not be moved: a failed shrink says so, and leaves no result line', async () => {
    const { el } = mount(STATS, { shrink: vi.fn(async () => Promise.reject(new Error('worker gone'))) })
    openStorage(el)
    await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="storage-shrink"]')!.click())
    expect(el.textContent).toContain('The pictures could not be moved.')
    expect(el.querySelector('[role="status"]')).toBeNull()
  })

  it.each(['old versions', 'too big', 'pictures', 'shrink'])('search for "%s" still reaches the page (S8)', (query) => {
    const { el } = mount(STATS)
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, query)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(el.querySelector('.settings-section__title')?.textContent).toMatch(/^Storage( › |$)/)
  })

  it('"too big" finds the page even when no file is large (the GitHub row carries it)', () => {
    const { el } = mount({ ...STATS, large: [] })
    const input = el.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'too big')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(row(el, 'storageGithub')).not.toBeNull()
  })
})
