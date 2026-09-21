/**
 * Home's birth (6C-, YAZ-849): the pure decision behind "every adopted vault has a Home", and the
 * one atomic create it ends in. Each case pins ONE locked rule of 🔒 D1/D2 (YAZ-821) + the
 * ⚡ amendment on YAZ-797:
 *
 *  - detection is RESOLVER-based, never a path check: an alias Home counts, a `home.md` counts,
 *    and an ORDINARY (unflagged) page called Home counts too — it IS Home, the user simply has
 *    not flagged it, so nothing is written over it (the TOPICS TREE separately shows no Home row
 *    for it, 6B's rule, which is not this module's business);
 *  - an ADOPTED vault (`.yaseendraw/` exists) with no Home writes `<root>/Home.md` carrying
 *    exactly the flag bytes — through 4B's own birth call, never a local literal;
 *  - it is IDEMPOTENT: a second call finds the page through the resolver and returns 'exists',
 *    and the double-open RACE resolves at the fs layer — `createFile`'s `wx` write rejects
 *    ALREADY_EXISTS, which is success, not failure (nothing was overwritten);
 *  - an UN-ADOPTED folder is never written into at all: 'unadopted', and the Topics lens offers.
 *
 * `api` mocked like scaffold.test.ts — the two calls this module makes and nothing else.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: {
    tree: vi.fn(),
    createFile: vi.fn(),
  },
}))

import { VAULT_CONFIG_DIR } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createHome, ensureHome, HOME_CONTENT, HOME_LINK, homePath, isAdopted } from './ensureHome'

const tree = vi.mocked(api.tree)
const createFile = vi.mocked(api.createFile)

const ROOT = '/vault'
const HOME = `${ROOT}/Home.md`
const DOTFOLDER = `${ROOT}/${VAULT_CONFIG_DIR}`

const fail = (code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'FORBIDDEN' | 'IO_ERROR') => new BridgeRequestError(code, code)

/** The vault HAS been adopted: the dotfolder answers. */
const adopted = () => tree.mockResolvedValue({ root: DOTFOLDER, tree: [], generatedAt: 1 })
/** No `.yaseendraw/` anywhere: the probe rejects NOT_FOUND, exactly as `requireDir` does. */
const unadopted = () => tree.mockRejectedValue(fail('NOT_FOUND'))

/** A resolver over a basename/alias map, keyed the way `makeResolver` keys: lowered, brackets off. */
const resolverOver = (names: Record<string, string>) => (target: string) => names[target.replace(/^\[\[|\]\]$/g, '').toLowerCase()] ?? null
const noHome = resolverOver({})

beforeEach(() => {
  vi.clearAllMocks()
  createFile.mockResolvedValue({ path: HOME, mtime: 1, size: HOME_CONTENT.length })
})

// ---------------------------------------------------------------- 🔒 D1: what Home IS

describe('detection is the RESOLVER (🔒 D1), never a hardcoded path', () => {
  it('the link it asks is a wikilink, so every spelling a click would follow lands', () => {
    expect(HOME_LINK).toBe('[[Home]]')
  })

  it('a page named Home answers, whatever its case or folder — nothing is created', async () => {
    adopted()
    const resolve = resolverOver({ home: `${ROOT}/notes/home.md` })
    await expect(ensureHome(ROOT, resolve)).resolves.toBe('exists')
    expect(createFile).not.toHaveBeenCalled()
    // Resolver-based means the probe is not even reached: a vault WITH a Home is never asked
    // whether it has been adopted.
    expect(tree).not.toHaveBeenCalled()
  })

  it('an ALIAS Home answers too — the map may be called anything on disk', async () => {
    adopted()
    await expect(ensureHome(ROOT, resolverOver({ home: `${ROOT}/Map of content.md` }))).resolves.toBe('exists')
    expect(createFile).not.toHaveBeenCalled()
  })

  it("an ORDINARY (unflagged) page called Home IS Home: 'exists', never overwritten, never respawned", async () => {
    adopted()
    // The tree shows no Home ROW for it (6B's roots rule wants the flag); this module still must
    // not write a second Home over the user's page. Flagging it is the user's to do.
    await expect(ensureHome(ROOT, resolverOver({ home: HOME }))).resolves.toBe('exists')
    expect(createFile).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------- 🔒 D2: adopted vaults auto-create

describe('an ADOPTED vault with no Home creates one, exactly once', () => {
  it('writes `<root>/Home.md` with exactly the flag bytes, through 4B’s own birth call', async () => {
    adopted()
    await expect(ensureHome(ROOT, noHome)).resolves.toBe('created')
    expect(tree).toHaveBeenCalledWith(DOTFOLDER)
    expect(createFile).toHaveBeenCalledTimes(1)
    // Born through the ONE builder (YAZ-1549): the flag AND the default `status` column, like every folder page.
    expect(createFile).toHaveBeenCalledWith({ path: HOME, content: HOME_CONTENT })
    expect(HOME_CONTENT).toBe('---\nfolder_page: true\nfolder_page_settings:\n  columns:\n    status:\n      kind: select\n      options:\n        - 1-Backlog\n        - 2-Todo\n        - 3-In-Progress\n        - 4-Done\n---\n')
    expect(homePath(ROOT)).toBe(HOME)
  })

  it("is IDEMPOTENT: the second call resolves the page it just made and returns 'exists'", async () => {
    adopted()
    await expect(ensureHome(ROOT, noHome)).resolves.toBe('created')
    // The index has caught up; the resolver now finds it — no second write.
    await expect(ensureHome(ROOT, resolverOver({ home: HOME }))).resolves.toBe('exists')
    expect(createFile).toHaveBeenCalledTimes(1)
  })

  it('the double-open RACE is benign: ALREADY_EXISTS from the `wx` write is SUCCESS, not failure', async () => {
    adopted()
    // Two windows opened the same vault on the same stale (Home-less) snapshot; the loser's
    // atomic create rejects — and nothing was overwritten, which is the whole guarantee.
    createFile.mockRejectedValueOnce(fail('ALREADY_EXISTS'))
    await expect(ensureHome(ROOT, noHome)).resolves.toBe('exists')
  })

  it('a REAL write failure propagates — a silent swallow would hide a broken vault', async () => {
    adopted()
    createFile.mockRejectedValueOnce(fail('FORBIDDEN'))
    await expect(ensureHome(ROOT, noHome)).rejects.toThrow('FORBIDDEN')
  })

  it('`createHome` is the same create the offer button runs — one routine, two triggers', async () => {
    await expect(createHome(ROOT)).resolves.toBe('created')
    expect(createFile).toHaveBeenCalledWith({ path: HOME, content: HOME_CONTENT })
    createFile.mockRejectedValueOnce(fail('ALREADY_EXISTS'))
    await expect(createHome(ROOT)).resolves.toBe('exists')
  })
})

// ---------------------------------------------------------------- ⚡ the amendment: un-adopted folders

describe('an UN-ADOPTED folder is never written into', () => {
  it("reports 'unadopted' and touches nothing", async () => {
    unadopted()
    await expect(ensureHome(ROOT, noHome)).resolves.toBe('unadopted')
    expect(createFile).not.toHaveBeenCalled()
  })

  it('adoption is the DOTFOLDER answering, read-only — the probe never creates it', async () => {
    unadopted()
    await expect(isAdopted(ROOT)).resolves.toBe(false)
    expect(tree).toHaveBeenCalledWith(DOTFOLDER)
    adopted()
    await expect(isAdopted(ROOT)).resolves.toBe(true)
  })

  it('any OTHER probe failure also refuses to write: unreadable is not permission to adopt', async () => {
    // FORBIDDEN, IO_ERROR, a `.yaseendraw` FILE — none of them prove adoption, and the safe
    // answer is always the offer card, which writes nothing until the user clicks.
    for (const code of ['FORBIDDEN', 'IO_ERROR'] as const) {
      tree.mockRejectedValueOnce(fail(code))
      await expect(ensureHome(ROOT, noHome)).resolves.toBe('unadopted')
    }
    expect(createFile).not.toHaveBeenCalled()
  })
})
