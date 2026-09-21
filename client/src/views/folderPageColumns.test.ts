/**
 * Existing-member column reconciliation (YAZ-999): index presence is a fast skip; the conditional
 * writer is the latest-bytes authority. Every missing write is attempted and failures are reported
 * together so one broken card cannot silently prevent the rest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IndexRecord } from '@shared/types'

vi.mock('./writeProperty', () => ({ writePropertyIfMissing: vi.fn() }))

import { writePropertyIfMissing } from './writeProperty'
import { backfillFolderPageColumns } from './folderPageColumns'

const write = vi.mocked(writePropertyIfMissing)

const rec = (path: string, properties: Record<string, unknown> = {}): IndexRecord => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return {
    path,
    name,
    basename: name.replace(/\.md$/, ''),
    folder: '',
    ext: 'md',
    size: 0,
    ctime: 0,
    mtime: 1,
    properties,
    aliases: [],
    tags: [],
    links: [],
    embeds: [],
  }
}

beforeEach(() => {
  write.mockReset()
  write.mockResolvedValue({ mtime: 2 })
})

describe('backfillFolderPageColumns', () => {
  it('writes every missing exact key with the canonical empty value and skips every present value', async () => {
    const a = rec('/vault/A.md', { kept: 0, nullable: null, empty: '' })
    const b = rec('/vault/B.md', {})

    await backfillFolderPageColumns([a, b], {
      kept: { kind: 'number' },
      nullable: { kind: 'text' },
      empty: { kind: 'text' },
      tags: { kind: 'list' },
    })

    expect(write.mock.calls).toEqual([
      ['/vault/A.md', 'tags', []],
      ['/vault/B.md', 'kept', null],
      ['/vault/B.md', 'nullable', null],
      ['/vault/B.md', 'empty', null],
      ['/vault/B.md', 'tags', []],
    ])
  })

  it('attempts every missing write before reporting all failures with page and key', async () => {
    write.mockImplementation(async (path, key) => {
      if (key === 'score') throw new Error(`denied ${path}`)
      return { mtime: 2 }
    })

    await expect(
      backfillFolderPageColumns([rec('/vault/A.md'), rec('/vault/B.md')], {
        score: { kind: 'number' },
        tags: { kind: 'multi-link' },
      }),
    ).rejects.toThrow('Could not initialize 2 column values: A.score; B.score')

    expect(write).toHaveBeenCalledTimes(4)
    expect(write).toHaveBeenCalledWith('/vault/A.md', 'tags', [])
    expect(write).toHaveBeenCalledWith('/vault/B.md', 'tags', [])
  })

  it('does no I/O without members or declarations', async () => {
    await backfillFolderPageColumns([], { score: { kind: 'number' } })
    await backfillFolderPageColumns([rec('/vault/A.md')], {})
    expect(write).not.toHaveBeenCalled()
  })
})
