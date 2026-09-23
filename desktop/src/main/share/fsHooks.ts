/**
 * SHARES FOLLOW THE FILE (YAZ-1799, Yasin's pick on the rename/move open question). The fs IPC's
 * rename, cut-paste and delete handlers call these right beside their favorites repair; sharing
 * fills them in at registration (`registerShareIpc`). Until then they are no-ops, so the fs layer
 * never depends on the order the IPC modules register in, and a failure here is warned about and
 * never fails the file operation (the favorites posture).
 *
 *  - renamed: every shares.json key at or under `oldPath` is rewritten to the new path — in the
 *    same vault, or moved into the other vault's shares.json when a cut-paste crosses vaults.
 *    The link (id) and its permission are kept.
 *  - deleted: every share at or under `path` is stopped (the object deleted, the link dead) and
 *    forgotten. If the Worker cannot be reached the record is KEPT, so Settings › Sharing lists it
 *    as "no board at this path" and it can be stopped from there later.
 *
 * Renames made outside the app (Finder, git) are not seen here; those stay flagged in Settings.
 */
export interface ShareFsHooks {
  renamed(roots: readonly string[], oldPath: string, newPath: string): Promise<void>
  deleted(roots: readonly string[], path: string): Promise<void>
}

export const shareFsHooks: ShareFsHooks = {
  renamed: async () => {},
  deleted: async () => {},
}

/** Never let share bookkeeping fail a rename or a delete. */
export const repairShares = (p: Promise<void>): Promise<void> => p.catch((err: unknown) => console.warn(`[share] repair failed: ${String(err)}`))
