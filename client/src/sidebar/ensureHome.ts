/**
 * HOME'S BIRTH (6C-, YAZ-849) — the one routine behind "every adopted vault has a map, and no
 * folder is written into behind the user's back". Pure decision + one atomic create; the wiring
 * (App's once-per-root effect) and the offer card (the Topics lens) both come here.
 *
 * 🔒 D1 (YAZ-821): HOME IS WHATEVER `[[Home]]` RESOLVES TO. Detection goes through the window's
 * own resolver — alias-aware, case-insensitive, every spelling a CLICK would follow — and never
 * through a path check. So a `home.md` in a subfolder, or a page aliased `Home`, already IS the
 * vault's Home and nothing is created. That includes an ORDINARY, unflagged page called Home:
 * it IS Home, the user has simply not flagged it, and this routine must neither overwrite it nor
 * spawn a rival. (6B's tree separately shows no Home ROW for such a page — a different question,
 * asked by a different surface.)
 *
 * 🔒 D2 + ⚡ (the amendment on YAZ-797): what happens when nothing answers depends on whether the
 * vault has been ADOPTED — whether `<root>/.yaseendocs/` exists:
 *   ADOPTED    → `<root>/Home.md` is created automatically, on vault open, carrying exactly
 *                `folder_page: true` and nothing else.
 *   UN-ADOPTED → NOTHING is written. The Topics lens offers a card instead, and one click runs
 *                this very same create. The app never silently writes visible files into a
 *                folder it has not adopted.
 *
 * IDEMPOTENT by construction, three times over: the resolver answers before anything is written;
 * the create is 4B's own content-at-create call, whose `wx` flag never overwrites; and the
 * double-open RACE is therefore benign — an ALREADY_EXISTS rejection means the other window won
 * and the file is there, which is the outcome we wanted, so it reports 'exists'. A delete-then-
 * reopen re-creates Home (the vault is adopted and nothing answers) — but only on a reopen, and
 * never while any page still answers `[[Home]]`.
 *
 * ADOPTION DETECTION: the dotfolder is invisible to the tree/index/watcher but NOT to direct
 * bridge calls at an absolute path (`scaffold.ts`'s template read is the standing precedent), and
 * `fs:tree` is the one existing call that distinguishes a missing directory (NOT_FOUND, from
 * `requireDir`) from an existing one. `vaultConfig.read` cannot: it collapses "no dotfolder" and
 * "no such config file" into the same absent. So the probe is a READ-ONLY `api.tree` of
 * `<root>/.yaseendocs` — no new IPC, nothing created, and the answer honest. Anything other than
 * a clean success (missing, unreadable, not a directory) counts as UN-ADOPTED: the safe side is
 * always the card, which writes nothing until the user clicks.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
// The dotfolder whose existence IS adoption. ONE definition, in shared, read by main too.
import { VAULT_CONFIG_DIR } from '@shared/types'
import { api, BridgeRequestError } from '../api'
import { createNewNote, seedContent } from '../views/newNote'
import type { ResolveLink, WikilinkResolveSource } from '../editor/wikilink/wikilinkPlugin'
import { newFolderPageProperties } from '../views/folderPageSettings'

/**
 * THE Home link (🔒 D1). A wikilink, not a bare name, because it goes through the very resolver a
 * CLICK would use: `[[home]]`, an alias, a `Home.md` anywhere in the vault — all of it lands here.
 */
export const HOME_LINK = '[[Home]]'

/** Where an auto-created Home lands: the vault ROOT, the one place a map belongs. */
export const HOME_BASENAME = 'Home.md'

/**
 * The bytes a newborn Home carries: 4B's birth — the flag and the default `status` column (YAZ-1513)
 * — spelled by the ONE builder every folder page is born through, so Home and "New folder page"
 * cannot drift. No body.
 */
export const HOME_CONTENT = seedContent(newFolderPageProperties())

export type EnsureHomeOutcome = 'created' | 'exists' | 'unadopted'

export const homePath = (root: string): string => `${root}/${HOME_BASENAME}`

const codeOf = (err: unknown): string | null => (err instanceof BridgeRequestError ? err.code : null)

/** Has this folder been adopted? Read-only, creates nothing; see the module doc for why `tree`. */
export async function isAdopted(root: string): Promise<boolean> {
  try {
    await api.tree(`${root}/${VAULT_CONFIG_DIR}`)
    return true
  } catch {
    // NOT_FOUND is the ordinary "never adopted"; FORBIDDEN / NOT_A_DIRECTORY / IO_ERROR are not
    // proof of adoption either, and the un-adopted branch is the one that writes nothing.
    return false
  }
}

/**
 * The create, on its own: the SAME call 4B's "New folder page" makes. Used by `ensureHome` and by
 * the offer card's one button — one routine, two triggers. ALREADY_EXISTS is success: the `wx`
 * write overwrote nothing and the file the caller wanted is on disk.
 */
export async function createHome(root: string): Promise<'created' | 'exists'> {
  try {
    await createNewNote(homePath(root), newFolderPageProperties())
    return 'created'
  } catch (err) {
    if (codeOf(err) === 'ALREADY_EXISTS') return 'exists'
    throw err
  }
}

/** The whole decision (see the module doc). `resolve` is the window's live resolver, never null. */
export async function ensureHome(root: string, resolve: ResolveLink): Promise<EnsureHomeOutcome> {
  if (resolve(HOME_LINK) !== null) return 'exists'
  if (!(await isAdopted(root))) return 'unadopted'
  return createHome(root)
}

export interface HomeState {
  /**
   * This folder has no `.yaseendocs/`, so nothing was written and the Topics lens should OFFER.
   * A durable fact about the FOLDER, not about Home: it stays true after the card's button has
   * made Home (the folder is still un-adopted) — the card stops rendering because `[[Home]]`
   * resolves now, which is the live half of the condition and the tree's own to see.
   */
  unadopted: boolean
  /** The card's button: the same create, then open the page it made. */
  createHome: () => void
}

/**
 * THE TRIGGER: once per root, the moment the window's index first lands. It lives in App — not in
 * the sidebar and not in the Topics tree — because Home is born ON VAULT OPEN: a collapsed
 * sidebar, or a window sitting on the Files lens, must not be able to skip it.
 *
 * "Index-ready" is `source.resolve !== null` — the same readiness every wikilink surface reads,
 * and the only honest one: before it, an empty snapshot would say "no Home" about a vault nobody
 * has looked at yet. A ref keyed by ROOT makes it exactly once per vault per session — index
 * refetches poke this subscriber constantly and must never re-run the decision.
 */
export function useEnsureHome(root: string | null, source: WikilinkResolveSource, onOpenFile: (path: string) => void, onNotice: (message: string) => void): HomeState {
  // Keyed by root so a folder switch can never show the PREVIOUS vault's answer for a moment,
  // and so a late reply from the old root lands on nothing.
  const [state, setState] = useState<{ root: string; outcome: EnsureHomeOutcome } | null>(null)
  const ran = useRef<string | null>(null)

  useEffect(() => {
    if (root === null) return
    const read = (): void => {
      const resolve = source.resolve
      if (resolve === null || ran.current === root) return
      ran.current = root
      ensureHome(root, resolve)
        .then((outcome) => setState({ root, outcome }))
        .catch((err: unknown) => onNotice(`Can't create Home: ${err instanceof Error ? err.message : String(err)}`))
    }
    read()
    return source.subscribe(read)
  }, [root, source, onNotice])

  const create = useCallback((): void => {
    if (root === null) return
    createHome(root)
      .then(() => onOpenFile(homePath(root)))
      .catch((err: unknown) => onNotice(`Can't create Home: ${err instanceof Error ? err.message : String(err)}`))
  }, [root, onOpenFile, onNotice])

  return { unadopted: state !== null && state.root === root && state.outcome === 'unadopted', createHome: create }
}
