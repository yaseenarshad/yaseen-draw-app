/**
 * Editor continuity across an in-app rename (Links E1, GRO-2194) — and across an in-app
 * DELETE (GRO-2272). Editors are keyed by path, so remapping or removing a tab REMOUNTS or
 * unmounts its editor, and the unmount flush would write the buffer back to the OLD path,
 * resurrecting the file the rename or delete just removed.
 *
 * Two flows share the handle map below, and the difference between them IS the point:
 * a RENAME captures the dirty buffer, retires the old handle and stashes the buffer under
 * the new path (it has somewhere to travel to); a DELETE retires ONLY (it does not), because
 * a stashed buffer would be a live resurrection vector for whatever mounts there next.
 *
 * The design, pinned:
 *  - every `useAutosave` registers a per-path handle here (one editor per path per window);
 *  - the ORIGINATING window awaits `flushRenamedPath(oldPath)` BEFORE invoking `fs:rename`,
 *    so its own buffer is on disk and travels with the file;
 *  - EVERY window's `file:renamed` handler calls `carryEditorAcrossRename(old, new)` BEFORE
 *    remapping its tabs: a DIRTY buffer is captured and stashed under the NEW path, and the
 *    old handle is RETIRED — its unmount flush becomes a no-op, so nothing can write to the
 *    old path (no resurrection);
 *  - the editor mounting at the new path takes the stashed buffer (`takeRenameBuffer`) and
 *    applies it as an UNSAVED change over the freshly read file — the buffer survives into
 *    the new path and autosave writes it there (no silent loss).
 *
 * Residual race, accepted: a save already IN FLIGHT over IPC when the rename lands cannot
 * be recalled; `writeFile` recreates the old path in that sub-millisecond window. The
 * systematic paths (debounced saves, unmount flush, close flush) are covered above FOR THE
 * WINDOW THAT RENAMES — the handle map below is module-scoped, i.e. PER RENDERER, so another
 * window's pending debounced save for the same path is not retired by this flow and its window
 * is the same sub-millisecond race widened to a debounce interval (GRO-2197 audit: the earlier
 * wording claimed blanket coverage). Deferred, not fixed: retiring across windows needs a
 * main-side broadcast the rename path does not have today.
 *
 * E1b (GRO-2241) extends the same discipline to FOLDER renames: `flushRenamedDir` runs the
 * pre-rename flush for every mounted editor under the dir, and `carryEditorsAcrossDirRename`
 * runs the capture/retire/stash step once per affected open path.
 */

/** What a mounted editor's autosave exposes to the rename flow (registered by `useAutosave`). */
export interface RenameContinuityHandle {
  /** Push the live content through autosave and resolve once it is on disk (or blocked). */
  flush(): Promise<void>
  /** The live buffer when it differs from the last saved/loaded content; null when clean. */
  capture(): RenameBuffer | null
  /** Stop this editor writing ever again (pending drops, unmount flush becomes a no-op). */
  retire(): void
}

export interface RenameBuffer {
  /** Raw frontmatter block as `useAutosave` holds it. */
  frontmatter: string
  /** Editor body. */
  body: string
}

const handles = new Map<string, RenameContinuityHandle>()
const buffers = new Map<string, RenameBuffer>()

/** One handle per open path per window (tabs de-duplicate); returns the unregister. */
export function registerRenameContinuity(path: string, handle: RenameContinuityHandle): () => void {
  handles.set(path, handle)
  return () => {
    if (handles.get(path) === handle) handles.delete(path)
  }
}

/** Flush the editor open at `path`, if any — the pre-rename step (a) and the pre-rewrite step. */
export function flushRenamedPath(path: string): Promise<void> {
  return handles.get(path)?.flush() ?? Promise.resolve()
}

/**
 * The pre-rename step (a) for a FOLDER (E1b, GRO-2241): every mounted editor UNDER `dir`
 * flushes, so each buffer is on disk and travels with its file. No editors there → no-op.
 */
export function flushRenamedDir(dir: string): Promise<void> {
  const prefix = `${dir}/`
  return Promise.all([...handles].filter(([path]) => path.startsWith(prefix)).map(([, handle]) => handle.flush())).then(() => undefined)
}

/**
 * The `file:renamed` kind-`dir` step (E1b), run BEFORE the prefix workspace remap: every editor
 * under the old dir is carried to ITS new path — same capture/retire/stash discipline as
 * `carryEditorAcrossRename`, once per affected open path.
 */
export function carryEditorsAcrossDirRename(oldDir: string, newDir: string): void {
  const prefix = `${oldDir}/`
  for (const path of [...handles.keys()]) {
    if (path.startsWith(prefix)) carryEditorAcrossRename(path, newDir + path.slice(oldDir.length))
  }
}

/**
 * The `file:renamed` step, run BEFORE the workspace remap unmounts the old editor: capture a dirty
 * buffer into the new path's stash and retire the old handle. No editor at `oldPath` → no-op.
 */
function carryEditorBuffer(oldPath: string, newPath: string): void {
  const handle = handles.get(oldPath)
  if (handle === undefined) return
  const buffer = handle.capture()
  handle.retire()
  if (buffer !== null) buffers.set(newPath, buffer)
}

export function carryEditorAcrossRename(oldPath: string, newPath: string): void {
  carryEditorBuffer(oldPath, newPath)
}

/** Same-path handoff before React moves one editable owner between main and right panes. */
export function carryEditorAcrossPane(path: string): void {
  carryEditorBuffer(path, path)
}

/** Consume the stashed buffer for a freshly mounting editor at `path`; null when none. */
export function takeRenameBuffer(path: string): RenameBuffer | null {
  const buffer = buffers.get(path) ?? null
  buffers.delete(path)
  return buffer
}

/**
 * The `file:deleted` step (GRO-2272), run BEFORE the workspace remap unmounts the editor: retire
 * the editor at `path` so it can never write again, and drop any buffer stashed for it.
 *
 * Deliberately NOT `carryEditorAcrossRename`, which sits a few lines above and looks like the
 * thing to copy. That one CAPTURES, retires and STASHES, because a rename has a destination
 * for the dirty buffer to travel to. A delete has none: stashing would leave a live
 * resurrection vector for whatever mounts at this path next, and capturing at all is pointless
 * work. Retire only.
 *
 * Why this matters: closing a tab unmounts its editor, and `useAutosave`'s unmount cleanup
 * flushes the live buffer to disk — recreating the file the delete just trashed. `retire()`
 * makes that flush a no-op and clears the pending debounce. See the residual-race note in this
 * module's header: an in-flight save, and another WINDOW's pending debounce, are still out of
 * reach — the same limits rename has always had.
 */
export function retireDeletedPath(path: string): void {
  handles.get(path)?.retire()
  buffers.delete(path)
}

/** The `file:deleted` kind-`dir` twin: every editor (and stashed buffer) under `dir` retires. */
export function retireDeletedDir(dir: string): void {
  const prefix = `${dir}/`
  for (const path of [...handles.keys()]) if (path.startsWith(prefix)) handles.get(path)?.retire()
  for (const path of [...buffers.keys()]) if (path.startsWith(prefix)) buffers.delete(path)
}

/** Test hook. */
export function _resetRenameContinuity(): void {
  handles.clear()
  buffers.clear()
}
