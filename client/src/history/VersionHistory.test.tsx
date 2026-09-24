/**
 * Version history (YAZ-1897 D4): the list, the picture it draws for the chosen version and view,
 * the restore round trip, and the modal key boundary. The bridge and the engine are stand-ins;
 * `compare.test.ts` pins what gets marked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { BoardVersion } from '@shared/types'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    github: { history: vi.fn(), version: vi.fn(), restore: vi.fn() },
    drawing: { load: vi.fn() },
  },
}))
vi.mock('../diagrams/renderDiagram', () => ({ renderDiagramPreview: vi.fn(async () => 'data:image/svg+xml;base64,PHN2Zy8+') }))
vi.mock('../drawings/engine', () => ({
  loadExcalidraw: vi.fn(async () => ({
    restoreElements: (els: unknown[]) => els,
    getCommonBounds: () => [0, 0, 10, 10],
  })),
}))
vi.mock('../lib/scenePreview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/scenePreview')>()),
  createScenePreviewPng: vi.fn(async () => 'data:image/png;base64,eA=='),
}))
vi.mock('../share/liveShare', () => ({ noteBoardSaved: vi.fn() }))

import { api } from '../api'
import { renderDiagramPreview } from '../diagrams/renderDiagram'
import { createScenePreviewPng } from '../lib/scenePreview'
import { noteBoardSaved } from '../share/liveShare'
import { VersionHistory } from './VersionHistory'

const github = vi.mocked(api.github)
const ROOT = '/v'
const P = '/v/Roadmap.excalidraw'
const NOW = Date.now()
const scene = (ids: string[]) => JSON.stringify({ type: 'excalidraw', elements: ids.map((id) => ({ id, type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: false })), appState: {}, files: {} })
const v = (ref: string, over: Partial<BoardVersion> = {}): BoardVersion => ({ ref, author: 'Sam', at: NOW - 60_000, merged: false, localOnly: false, ...over })

const VERSIONS = [v('a'.repeat(40) + ':Roadmap.excalidraw', { merged: true, author: 'Yasin' }), v('b'.repeat(40) + ':Roadmap.excalidraw', { localOnly: true, author: 'Yasin', at: NOW - 120_000 }), v('c'.repeat(40) + ':Roadmap.excalidraw', { at: NOW - 86_400_000 * 2 })]
const SCENES: Record<string, string> = { [VERSIONS[0].ref]: scene(['x', 'y']), [VERSIONS[1].ref]: scene(['x']), [VERSIONS[2].ref]: scene([]) }

let root: Root | null = null
let host: HTMLElement

beforeEach(() => {
  github.history.mockReset().mockResolvedValue(VERSIONS)
  github.version.mockReset().mockImplementation(async (_r, _p, ref) => ({ kind: 'drawing', json: SCENES[ref] ?? scene([]), files: {} }))
  github.restore.mockReset().mockResolvedValue(undefined)
  vi.mocked(api.drawing.load).mockReset().mockResolvedValue({ path: P, json: scene(['x', 'y']), mtime: 1, size: 1, files: {}, stored: [] })
  vi.mocked(createScenePreviewPng).mockClear()
  vi.mocked(renderDiagramPreview).mockClear()
  vi.mocked(noteBoardSaved).mockClear()
})
afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })

async function mount(fromMerge = false, path = P) {
  const onClose = vi.fn()
  const onNotice = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<VersionHistory root={ROOT} path={path} fromMerge={fromMerge} darkColors="adapt" onClose={onClose} onNotice={onNotice} />))
  await flush()
  const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T & HTMLElement>(sel)
  const rows = () => [...document.querySelectorAll<HTMLElement>('.history-list__row')]
  const text = (sel: string) => $(sel)?.textContent ?? ''
  const key = (target: Element, k: string) => act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))
  return { onClose, onNotice, $, rows, text, key }
}

describe('VersionHistory', () => {
  it('lists every version, newest first, and draws the newest with what changed since it', async () => {
    const d = await mount()
    expect(d.rows().map((r) => r.textContent)).toEqual(['Yasin1 minute ago · merged', 'Your version before the merge2 minutes ago · only on this computer', 'Sam2 days ago'])
    expect(d.rows()[0].getAttribute('aria-selected')).toBe('true')
    expect(d.$('.history-view__picture img')).not.toBeNull()
    // The newest version IS the board now: nothing to mark, nothing to restore.
    expect(d.text('[data-testid="history-legend"]')).toBe('No changes since this version.')
    expect(d.$<HTMLButtonElement>('[data-testid="history-restore"]')?.disabled).toBe(true)
  })

  it('opened from a merge notice, starts on "your version before the merge" and marks what the merge brought in', async () => {
    const d = await mount(true)
    expect(d.rows()[1].getAttribute('aria-selected')).toBe('true')
    expect(d.text('[data-testid="history-legend"]')).toBe('1 added')
    const drawn = vi.mocked(createScenePreviewPng).mock.calls.at(-1)?.[1].elements as Array<{ id: string }>
    expect(drawn.map((e) => e.id)).toEqual(['x', 'y', 'yaz-mark-y'])
  })

  it('↓ / ↑ move through the list; each version is fetched once however often it is shown', async () => {
    const d = await mount()
    const list = d.$('.history-list') as HTMLElement
    expect(document.activeElement).toBe(list)
    await d.key(list, 'ArrowDown')
    await flush()
    await d.key(list, 'ArrowDown')
    await flush()
    expect(d.rows()[2].getAttribute('aria-selected')).toBe('true')
    expect(d.text('[data-testid="history-legend"]')).toBe('2 added')
    await d.key(list, 'ArrowUp')
    await d.key(list, 'ArrowDown')
    await flush()
    expect(github.version.mock.calls.filter(([, , ref]) => ref === VERSIONS[2].ref)).toHaveLength(1)
  })

  it('"As it was" draws the chosen version itself, unmarked', async () => {
    const d = await mount(true)
    act(() => [...document.querySelectorAll<HTMLElement>('.history-view__tab')][1].click())
    await flush()
    const drawn = vi.mocked(createScenePreviewPng).mock.calls.at(-1)?.[1].elements as Array<{ id: string }>
    expect(drawn.map((e) => e.id)).toEqual(['x'])
    expect(d.text('[data-testid="history-legend"]')).toBe('The board as it was in this version.')
  })

  it('restores after a confirm: the bridge writes it, a shared link re-uploads, and the dialog says so and closes', async () => {
    const d = await mount(true)
    act(() => d.$('[data-testid="history-restore"]')?.click())
    expect(github.restore).not.toHaveBeenCalled()
    act(() => d.$('[data-testid="history-restore-confirm"]')?.click())
    await flush()
    expect(github.restore).toHaveBeenCalledWith(ROOT, P, VERSIONS[1].ref)
    expect(noteBoardSaved).toHaveBeenCalledWith(ROOT, P)
    expect(d.onNotice).toHaveBeenCalledWith('Restored “Roadmap” to the version from 2 minutes ago.')
    expect(d.onClose).toHaveBeenCalled()
  })

  it('a failed restore stays open and says why', async () => {
    github.restore.mockRejectedValueOnce(new Error('disk full'))
    const d = await mount(true)
    act(() => d.$('[data-testid="history-restore"]')?.click())
    act(() => d.$('[data-testid="history-restore-confirm"]')?.click())
    await flush()
    expect(d.text('[role="alert"]')).toBe('disk full')
    expect(d.onClose).not.toHaveBeenCalled()
  })

  it('a board with no versions says how to get them', async () => {
    github.history.mockResolvedValueOnce([])
    const d = await mount()
    expect(d.text('[data-testid="history-empty"]')).toContain('Settings › Sync')
    expect(d.$<HTMLButtonElement>('[data-testid="history-restore"]')?.disabled).toBe(true)
  })

  it('Escape backs out of a confirm first, then closes; keys aimed outside never reach the app', async () => {
    const outside = vi.fn()
    const behind = document.createElement('div')
    behind.tabIndex = 0
    behind.addEventListener('keydown', outside)
    document.body.append(behind)
    const d = await mount(true)
    act(() => d.$('[data-testid="history-restore"]')?.click())
    await d.key(behind, 'Escape')
    expect(d.$('[data-testid="history-restore-confirm"]')).toBeNull()
    expect(d.onClose).not.toHaveBeenCalled()
    await d.key(behind, 'Delete')
    expect(outside).not.toHaveBeenCalled()
    await d.key(behind, 'Escape')
    expect(d.onClose).toHaveBeenCalled()
  })

  describe('a draw.io diagram (🔒 YAZ-1802 D10)', () => {
    const FLOW = '/v/Flow.drawio'
    const FLOW_VERSIONS = [v('d'.repeat(40) + ':Flow.drawio'), v('e'.repeat(40) + ':Flow.drawio', { at: NOW - 86_400_000 })]
    const xml = (label: string) => `<mxfile><diagram id="p"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0" value="${label}"/></root></mxGraphModel></diagram></mxfile>`

    beforeEach(() => {
      github.history.mockResolvedValue(FLOW_VERSIONS)
      github.version.mockImplementation(async (_r, _p, ref) => ({ kind: 'diagram', xml: xml(ref.slice(0, 1)) }))
    })

    it('draws each version with the D9 renderer in the app`s theme and colour setting — no Changes view, no legend, no drawing door', async () => {
      const d = await mount(false, FLOW)
      expect(d.$('.history-view__picture img')?.getAttribute('src')).toBe('data:image/svg+xml;base64,PHN2Zy8+')
      expect(renderDiagramPreview).toHaveBeenLastCalledWith(xml('d'), 'light', 'adapt', expect.objectContaining({ maxWidth: 1100 }))
      expect(d.$('.history-view__tabs')).toBeNull()
      expect(d.$('[data-testid="history-legend"]')).toBeNull()
      expect(api.drawing.load).not.toHaveBeenCalled()
      await d.key(d.$('.history-list') as HTMLElement, 'ArrowDown')
      await flush()
      expect(renderDiagramPreview).toHaveBeenLastCalledWith(xml('e'), 'light', 'adapt', expect.anything())
    })

    it('a version the renderer cannot draw says so instead of spinning', async () => {
      vi.mocked(renderDiagramPreview).mockRejectedValueOnce(new Error('not a draw.io diagram'))
      const d = await mount(false, FLOW)
      expect(d.text('[data-testid="history-picture"]')).toBe("This version can't be drawn.")
    })

    it('restores through the bridge after a confirm, like a drawing', async () => {
      const d = await mount(false, FLOW)
      await d.key(d.$('.history-list') as HTMLElement, 'ArrowDown')
      act(() => d.$('[data-testid="history-restore"]')?.click())
      act(() => d.$('[data-testid="history-restore-confirm"]')?.click())
      await flush()
      expect(github.restore).toHaveBeenCalledWith(ROOT, FLOW, FLOW_VERSIONS[1].ref)
      expect(noteBoardSaved).toHaveBeenCalledWith(ROOT, FLOW)
      expect(d.onClose).toHaveBeenCalled()
    })
  })
})
