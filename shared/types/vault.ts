/** What lives in a vault's own `.yaseendraw/`: its config files, its GitHub switch and its favorites. */

import type { MAX_FAVORITES } from './appState'
import type { DrawingFileEntry } from './drawing'

/**
 * The `.obsidian/`-style dotfolder that travels with a vault, and THE one definition of its name
 * (YAZ-861 — main's `vaultConfig.ts` and the client's `ensureHome.ts` each used to declare their
 * own copy of the literal). Both sides read it from here: main joins paths under it, and the
 * client probes it because its existence IS adoption (6C-, YAZ-849).
 */
export const VAULT_CONFIG_DIR = '.yaseendraw'

/**
 * Pushed to every window after a config file under `<root>/.yaseendraw/` changes — an own
 * `vaultConfig.write` or an external edit (sync tools). Renderers filter by their own root,
 * the same posture as `state:changed`, and re-read the named file.
 */
export interface VaultConfigChange {
  root: string
  /** Config file name inside `.yaseendraw/`, e.g. `github.json`. */
  name: string
}

// ---------- GitHub sync (`<root>/.yaseendraw/github.json` — YAZ-1081) ----------

/**
 * The per-vault sync switch (YAZ-1081 D4), stored as `<root>/.yaseendraw/github.json` so it
 * travels with the folder like every other vault-local setting. OFF by default and off for any
 * shape that isn't exactly `{ enabled: true }` — a vault someone copies onto a second machine
 * therefore syncs there too, and a corrupt or hand-edited file fails closed rather than starting
 * background git work nobody asked for.
 */
export interface GithubSyncConfig {
  enabled: boolean
}

/**
 * Why a root is stuck, when it is. Each value is a DIFFERENT thing to say to the user, which is
 * the whole reason the set is closed: `no-git` wants "install git" (the Command Line Tools on a Mac, Git for Windows on a PC),
 * `no-identity` wants "set a name and email", `auth` wants "sign in again", `conflict` wants
 * "sync could not finish merging" — since YAZ-1897 every ordinary conflict is merged, so this is
 * the rare pass that had to stop (the lossless rule: the working tree was put back exactly as it
 * was — see `git/resolve.ts`), `too-large` wants "shrink it or move it out" (YAZ-1801 D3: files
 * held back under `tooLarge`, everything else synced), and `error` is the honest catch-all that
 * carries a message.
 */
export type GithubSyncAttention = 'no-git' | 'no-identity' | 'auth' | 'conflict' | 'error' | 'too-large'

/**
 * YAZ-1801 D3: the size at which a sync pass holds a file back instead of committing it.
 * GitHub REFUSES any file over 100 MiB, and one such file inside a commit rejects the whole push —
 * so every other edit in the vault would stop syncing behind it. 95 MiB leaves a margin for a
 * file that grows between the check and the push. `too-large` is the attention that says so.
 */
export const GITHUB_FILE_LIMIT_BYTES = 95 * 1024 * 1024
/**
 * GitHub warns on a push past 50 MiB (YAZ-1801): from here a file is listed under Settings ›
 * Storage's "Needs attention" — amber below `GITHUB_FILE_LIMIT_BYTES`, red at or above it (the
 * same line the sync guard holds files back at, so the page's colour and sync never disagree).
 */
export const GITHUB_FILE_WARN_BYTES = 50 * 1024 * 1024
/** GitHub: ideally under 1 GB, strongly under 5 GB, and 10 GB is its stated maximum — the bar's three steps. */
export const GITHUB_REPO_SOFT_BYTES = 1024 * 1024 * 1024
export const GITHUB_REPO_HARD_BYTES = 5 * 1024 * 1024 * 1024
export const GITHUB_REPO_MAX_BYTES = 10 * 1024 * 1024 * 1024

/**
 * What a vault's sync is doing right now — one object per root, pushed on every transition.
 *
 * `off` is not a failure: it is a vault with sync disabled, or one that is not a repo, or a repo
 * with no `origin`. `pending` means "there is work to do and it will happen" — edits waiting out
 * the quiet period (D2 cadence) or a pass that found the network down and armed a retry — so it
 * is the one non-terminal state the UI should show as calm rather than alarming.
 */
export interface GithubSyncStatus {
  root: string
  state: 'off' | 'synced' | 'pending' | 'syncing' | 'attention'
  attention?: GithubSyncAttention
  message?: string
  /** Read-only repo facts for the settings panel; absent when they could not be read at all. */
  repo?: { remoteUrl: string | null; branch: string | null }
  /**
   * Whether the per-vault SWITCH is on — i.e. the manager is running this root. Distinct from
   * `state: 'off'`, which also covers not-a-repo and no-remote: a vault the user just enabled
   * that has no remote yet is `enabled: true` + `state: 'off'`, and the settings switch reads
   * THIS field so it never contradicts the click that set it. Stamped by the manager; absent
   * on statuses that never passed through it (a bare `syncPass` call in tests).
   */
  enabled?: boolean
  /**
   * YAZ-1801 D3: vault-relative POSIX paths the last pass held back because each is at or
   * over `GITHUB_FILE_LIMIT_BYTES`. They stay on this machine only; everything else synced. Present
   * (and non-empty) only while there is at least one — the sidebar's cloud-off icon, the chip's
   * "N files not synced" and the `too-large` banner all read this one list.
   */
  tooLarge?: readonly string[]
  /**
   * YAZ-1897 D4: what THIS pass merged — present only on the status of the pass that did it (the
   * manager never keeps it as the root's last status, so a late `status()` cannot replay the notice).
   */
  merged?: readonly GithubSyncMerge[]
}

/**
 * One file a pass merged instead of stopping (YAZ-1897 D1/D3). A board merged shape by shape has
 * no `copy`; a file that could not be merged kept both versions — the remote's at `path`, ours at
 * `copy` — and the notice has to say where ours went.
 */
export interface GithubSyncMerge {
  /** Vault-relative POSIX path. */
  path: string
  /** Who made the remote's side of it ("Sara", "Sara and Sam"). */
  author: string
  /** Shapes both machines edited; the newest edit of each was kept. */
  clashes: number
  /** Vault-relative POSIX path of our copy, when both versions were kept. */
  copy?: string
}

/**
 * Per-vault GitHub sync as the renderer sees it (YAZ-1081, YAZ-1809). Four methods, because there are
 * only four things a UI ever needs: what is this vault doing, do it now, turn it on or off, and
 * tell me when it changes.
 *
 * Every call answers with the SAME `GithubSyncStatus` the push carries, so a caller never has to
 * follow a mutation with a read. `status` is the cheap one — it answers from the manager's last
 * broadcast without touching git, and for a root whose sync is OFF it falls back to a read-only
 * inspection (remote + branch) so a settings panel can show the repo it would sync to.
 */
export interface GithubApi {
  /** This root's current status; `off` for a vault with sync disabled, never a failure. */
  status(root: string): Promise<GithubSyncStatus>
  /** Run a pass NOW (the manual "sync" button). A pass already running is joined, never raced; `off` roots answer `off`. */
  syncNow(root: string): Promise<GithubSyncStatus>
  /**
   * The per-vault switch (D4), written to `<root>/.yaseendraw/github.json`. Turning it ON waits
   * for the first pass and answers with its real outcome — "synced", or what needs fixing —
   * rather than an optimistic `syncing`; turning it OFF is immediate and total (no watcher, no
   * timers, no passes).
   */
  setEnabled(root: string, enabled: boolean): Promise<GithubSyncStatus>
  /** Fired in every window on every transition of any vault; filter by `status.root`. Returns an unsubscribe. */
  onStatus(listener: (status: GithubSyncStatus) => void): () => void
  /**
   * YAZ-1897 D4 — Version history. A board's committed versions, newest first, plus "your version
   * before the merge" when the last merge changed this board. Empty for a vault with no git history.
   * `path` is the board (absolute, or vault-relative), exactly as `drawing.load` takes it.
   */
  history(root: string, path: string): Promise<BoardVersion[]>
  /**
   * One version: a drawing's scene and its pictures, resolved from `assets/` the way `drawing.load`
   * does, or a diagram's XML (🔒 YAZ-1802 D10).
   */
  version(root: string, path: string, ref: string): Promise<BoardVersionScene>
  /** Writes that version over the board as an ordinary edit; the watcher and sync take it from there. */
  restore(root: string, path: string, ref: string): Promise<void>
}

/** One entry in a board's Version history (YAZ-1897 D4). */
export interface BoardVersion {
  /** Opaque to the renderer: hand it back to `version` / `restore`. */
  ref: string
  author: string
  /** Epoch milliseconds of the commit. */
  at: number
  /** The version a sync merge produced (its commit carries a `Merged-with:` trailer). */
  merged: boolean
  /** "Your version before the merge": never pushed, kept on this machine only until the next merge. */
  localOnly: boolean
}

export type BoardVersionScene = { kind: 'drawing'; json: string; files: Record<string, DrawingFileEntry> } | { kind: 'diagram'; xml: string }

// ---------- Storage (Settings › Storage — YAZ-1801) ----------

/** One file in "Needs attention" (YAZ-1801): any file in the vault at or over `GITHUB_FILE_WARN_BYTES`. */
export interface VaultStorageFile {
  /** Vault-relative POSIX path. */
  path: string
  bytes: number
}

/**
 * What a vault weighs, from the disk and the LOCAL git only (YAZ-1801 D2) — never the network.
 * Every number is bytes. `git` is null when the vault is not a git repo (or there is no git).
 */
export interface VaultStorageStats {
  root: string
  /** Every `.excalidraw` under the vault (dot-folders skipped). */
  boards: { bytes: number; count: number }
  /** The top-level `assets/` store (🔒 YAZ-1775 D3). */
  pictures: { bytes: number; count: number }
  /** Everything else that is not a dot-entry: a video, a PDF someone dropped in. */
  other: { bytes: number; count: number }
  git: {
    /** `git count-objects -v`: loose + packed, i.e. everything `.git` holds for this repo. */
    historyBytes: number
    /** The compressed size of the objects HEAD's tree needs — the current snapshot. */
    headBytes: number
    /** `max(0, history − head)`: what a history reset would free (YAZ-1801 D6 shows it, never does it). */
    oldVersionsBytes: number
  } | null
  /** Every file — board, picture in `assets/`, anything else — at or over `GITHUB_FILE_WARN_BYTES`, biggest first. */
  large: VaultStorageFile[]
  /** Pictures still inside boards: their total `dataURL` bytes and how many boards carry any. */
  embedded: { bytes: number; boards: number }
}

/** What "Move pictures out of boards" did (YAZ-1801 D5). `bytesMoved` is how much lighter the boards got. */
export interface ShrinkResult {
  shrunk: number
  skipped: number
  bytesMoved: number
}

/** Settings › Storage's door (YAZ-1801): the numbers, and the one action. */
export interface StorageApi {
  /** Walks the vault and asks the local git; answers in seconds on a big vault, never touches the network. */
  stats(root: string): Promise<VaultStorageStats>
  /**
   * Rewrites every legacy board lean — its pictures into `assets/`, its `yaseendraw` block kept
   * verbatim (`updatedAt` does NOT move). `skip` = absolute paths not to touch (boards with
   * unsaved edits in a tab). Never throws per board: an unreadable one counts as skipped.
   */
  shrink(root: string, skip: readonly string[]): Promise<ShrinkResult>
}

// ---------- Favorites (`<root>/.yaseendraw/favorites.json` — YAZ-1766 6A, D11) ----------

/** The file on disk: VAULT-RELATIVE POSIX paths in the user's order (`MAX_FAVORITES` at most). */
export interface FavoritesConfig {
  version: 1
  favorites: string[]
}

/**
 * The Favorites tab's list as `window.yaseenDraw.favorites` (YAZ-1766 6A): ABSOLUTE paths over
 * `.yaseendraw/favorites.json`, so the list travels with the vault (D11). A malformed file reads
 * as `[]` and rejects every `set` with `INVALID_CONFIG`, never overwritten (D12); `set` drops
 * entries whose path is gone from disk (D14); in-app rename/delete repair the file in main (D13).
 */
export interface FavoritesApi {
  /** Absolute paths in stored order; `[]` when the file is absent or malformed. Never creates anything. */
  get(root: string): Promise<string[]>
  /** Replace the list; every path must be inside `root` (→ `BAD_REQUEST`). Creates the dotfolder and file on first write. */
  set(root: string, paths: readonly string[]): Promise<void>
  /** Fired in every window after any change to a vault's favorites.json, own or external; filter by `root`. Returns an unsubscribe. */
  onChanged(listener: (change: { root: string }) => void): () => void
}
