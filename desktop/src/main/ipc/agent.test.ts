import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CH, type Envelope } from '../../channels'
import { agentCommand, registerAgentIpc } from './agent'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const invoke = (req: unknown) => {
  const handler = vi.mocked(ipcMain.handle).mock.calls.find(([ch]) => ch === CH.shellAgentPrompt)?.[1]
  return (handler as unknown as (event: unknown, req: unknown) => Promise<Envelope<string>>)({}, req)
}

let dir: string
beforeEach(async () => {
  vi.mocked(ipcMain.handle).mockClear()
  dir = await mkdtemp(path.join(tmpdir(), 'yaz-1617-agent-'))
  registerAgentIpc({ packaged: true, resourcesPath: '/Applications/Yaseen Draw.app/Contents/Resources', mainDir: '/unused' })
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('agentCommand', () => {
  it('packaged: the bundled shim, quoted; dev: node on the built entry beside main', () => {
    expect(agentCommand({ packaged: true, resourcesPath: '/Applications/Yaseen Draw.app/Contents/Resources', mainDir: '/x' })).toBe(
      '"/Applications/Yaseen Draw.app/Contents/Resources/bin/yaseendraw"',
    )
    expect(agentCommand({ packaged: false, resourcesPath: '/x', mainDir: '/repo/desktop/out/main' })).toBe('node "/repo/desktop/out/main/cli.js"')
  })
})

describe('shell:agent-prompt', () => {
  it('returns the three-line handshake for an existing page — path, the one sentence, the command with --help; no verb named', async () => {
    const page = path.join(dir, 'Weekly review.md')
    await writeFile(page, '# W\n')
    const env = await invoke({ path: page })
    expect(env).toEqual({
      ok: true,
      value: `This file is a page in Yaseen Draw: ${page}\nThe app has a command line for working with its pages. Run it first to see what it can do:\n"/Applications/Yaseen Draw.app/Contents/Resources/bin/yaseendraw" --help`,
    })
    for (const verb of ['comment', 'edit', 'delete']) expect((env as { value: string }).value).not.toContain(verb)
  })

  it('a page that is no longer there rejects NOT_FOUND; a non-Markdown file UNSUPPORTED_EXTENSION; a bad request BAD_REQUEST / NOT_ABSOLUTE', async () => {
    expect(await invoke({ path: path.join(dir, 'gone.md') })).toEqual({ ok: false, error: expect.objectContaining({ code: 'NOT_FOUND' }) })
    const epub = path.join(dir, 'book.epub')
    await writeFile(epub, '')
    expect(await invoke({ path: epub })).toMatchObject({ ok: false, error: { code: 'UNSUPPORTED_EXTENSION' } })
    expect(await invoke('nope')).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } })
    expect(await invoke({ path: 'relative.md' })).toMatchObject({ ok: false, error: { code: 'NOT_ABSOLUTE' } })
  })
})
