/**
 * The sidebar's multi-select, pure (YAZ-1336, 🔒 D1) — `treeState.ts`'s sibling: the Sidebar owns
 * the state, this owns the rules. A selection is a set of PATHS — files and, since YAZ-1578,
 * folders (a folder is itself, never its contents) — so ONE path is ONE entry however many rows
 * draw it (🔒 D3: a favorited folder's contents also show under Files, and all of those rows are
 * the same selected thing).
 */

/** The one empty selection: an untouched sidebar and a cleared one are then the SAME value. */
export const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>()

export type SelectionAction =
  /** 🔒 D2 as Yasin amended it: shift+click ADDS or REMOVES the one row. There is no range. */
  | { type: 'toggle'; path: string }
  /**
   * D9 (YAZ-1674, reversing YAZ-1336's plain-click-clears): a PLAIN click — and ⌘-click, and a
   * right-click on a row outside the selection (Finder) — makes the selection EXACTLY that row,
   * so ⌘C / ⌘X / ⌘V always have a target after a click. Shift keeps its toggle.
   */
  | { type: 'set'; path: string }
  | { type: 'clear' }
  /** Drop what the vault no longer has; `exists` is asked once per selected path. */
  | { type: 'prune'; exists: (path: string) => boolean }

/**
 * Every no-op returns the SAME set, deliberately: this feeds a `useReducer`, so an unchanged
 * selection has to be reference-identical or React re-renders the whole tree for nothing — and
 * the clear-on-lens-change / prune-on-refresh effects fire far more often than they change
 * anything. No input set is ever mutated.
 */
export function selectionReducer(sel: ReadonlySet<string>, action: SelectionAction): ReadonlySet<string> {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(sel)
      if (!next.delete(action.path)) next.add(action.path)
      return next
    }
    case 'set':
      return sel.size === 1 && sel.has(action.path) ? sel : new Set([action.path])
    case 'clear':
      return sel.size === 0 ? sel : EMPTY_SELECTION
    case 'prune': {
      const kept = [...sel].filter(action.exists)
      return kept.length === sel.size ? sel : new Set(kept)
    }
  }
}

/**
 * The selection as a LIST, for every gesture that acts on all of it at once — the context menu's
 * plural items (YAZ-1337) read one order, because a copied list and the tabs it opens must not
 * disagree about what the user picked.
 *
 * ⚡ Fable's ruling on YAZ-1338: THE SELECTION IS THE TRUTH, THE DOM IS ONLY THE ORDER. So this
 * walks the rows the panel is currently drawing (`flashTreeRows`' idiom, revealRow.ts) to put the
 * on-screen paths in the order the eye reads them — deduped, because one path may be drawn by
 * more than one row (🔒 D3) — and then APPENDS whatever the selection still
 * holds that has no row: a path inside a folder the user collapsed after selecting it is still
 * selected, and dropping it would make "Copy N paths" copy fewer than N. The result therefore
 * always has exactly `selected.size` entries. A null host (the sidebar is collapsed, so there is
 * no panel to read an order from) is simply the set's own insertion order.
 */
export function orderedSelection(selected: ReadonlySet<string>, host: ParentNode | null): string[] {
  const ordered: string[] = []
  for (const row of host?.querySelectorAll<HTMLElement>('.tree__row[data-path]') ?? []) {
    const path = row.dataset.path
    if (path === undefined || !selected.has(path) || ordered.includes(path)) continue
    ordered.push(path)
  }
  for (const path of selected) if (!ordered.includes(path)) ordered.push(path)
  return ordered
}
