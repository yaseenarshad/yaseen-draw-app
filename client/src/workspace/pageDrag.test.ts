import { describe, expect, it, vi } from 'vitest'
import { WORKSPACE_PAGE_MIME, readPageDrag, writePageDrag } from './pageDrag'

const dataWith = (type: string, value: string): DataTransfer => ({
  types: [type],
  getData: vi.fn((requested: string) => (requested === type ? value : '')),
  setData: vi.fn(),
} as unknown as DataTransfer)

describe('private workspace page drag payload', () => {
  it('rejects foreign, malformed, relative, and invalid-owner payloads', () => {
    expect(readPageDrag(dataWith('text/plain', '/v/a.md'))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, '{bad json'))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: 'relative.md', owner: 'main' })))).toBeNull()
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'somewhere' })))).toBeNull()
  })

  it('round-trips only an absolute page and its workspace owner', () => {
    const data = dataWith(WORKSPACE_PAGE_MIME, '')
    writePageDrag(data, { path: '/v/a.md', owner: 'main' })
    expect(data.setData).toHaveBeenCalledExactlyOnceWith(
      WORKSPACE_PAGE_MIME,
      JSON.stringify({ path: '/v/a.md', owner: 'main' }),
    )
    expect(data.effectAllowed).toBe('move')
    expect(readPageDrag(dataWith(WORKSPACE_PAGE_MIME, JSON.stringify({ path: '/v/a.md', owner: 'main' })))).toEqual({
      path: '/v/a.md',
      owner: 'main',
    })
  })
})
