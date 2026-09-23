import { describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { viewerAssetsDir } from './share'

vi.mock('electron', () => ({ shell: {}, ipcMain: { handle: vi.fn(), on: vi.fn() } }))

describe('viewerAssetsDir', () => {
  const where = { resourcesPath: '/Applications/Yaseen Draw.app/Contents/Resources', appPath: '/repo/desktop' }

  it('reads the extraResource inside a packaged app', () => {
    expect(viewerAssetsDir({ ...where, isPackaged: true })).toBe(path.join(where.resourcesPath, 'share-viewer'))
  })

  it('reads the repo checkout beside desktop/ in dev', () => {
    expect(viewerAssetsDir({ ...where, isPackaged: false })).toBe(path.join('/repo', 'share', 'dist', 'assets'))
  })
})
