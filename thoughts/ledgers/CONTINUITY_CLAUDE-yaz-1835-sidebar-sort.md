# CONTINUITY — YAZ-1835 Sidebar sort + right-click Info

Parent: [YAZ-1835](https://linear.app/growprofit/issue/YAZ-1835). Children YAZ-1848 (A), 1849 (B), 1850 (C), 1851 (D), 1847 (E), 1852 (F), 1853 (G), 1854 (H).

## Goal

The Files lens sorts by Name / Last updated / Created from a header button, per vault, every window
follows, a save reorders live; right-click a board → Info, a live popover with its dates, size and
place. Done when the 12 locked scenarios hold, typecheck + all vitest projects + build are green,
merged to main. Release is a separate step Yasin asked for after the merge.

## Constraints

- Worktree `yaseen-draw-app-sort`, branch `yaz-1835-sidebar-sort` off `origin/main` @ `5460e58`.
- No Playwright. Evidence = unit + integration tests; a hand pass only on Yasin's request.
- Renderer-side sort (D1); no bridge change but the folder patch; no new IPC for Info (D7).
- Labels `🔒 YAZ-1835 D<n>`; commits via `/commit`, no trailers.

## Key Decisions (locked on YAZ-1835)

- D1 sort in the renderer (`sortTree`), Files lens only. D2 Name/Updated/Created, folders first by name, block > mtime, tie → name.
- D3 `FolderState.sortOrder` per vault, persisted, Sidebar subscribes to the store. D4 refresh on every watcher event.
- D5 one header button → `ContextMenu` with ✓. D6 Info above Delete, one board, `ContextMenuSurface`. D7 Info reads the live tree node; `formatDateTime`/`formatBytes`.

## State

- Done:
  - [x] Prototype demoed in an isolated profile on a 44-board vault; Yasin approved as built
  - [x] 1835A scope comment (YAZ-1848)
  - [x] 1835B state door + tests (YAZ-1849)
  - [x] 1835C pure helpers + tests (YAZ-1850) — `sortTree` moved to `shared/treeSort.ts`
  - [x] 1835D control + refresh + tests + CONTRACTS (YAZ-1851)
  - [x] 1835E Info + tests (YAZ-1847)
  - [x] 1835F `tools/seedSortDemoVault.mjs` + `sortVault.integration.test.ts` (YAZ-1852)
  - [x] 1835G audit (YAZ-1853) — 36 items, one real bug (overlapping tree walks)
  - [x] 1835H apply, merge (YAZ-1854)
- Now: merged to main; nothing pending. Future "last opened" or grid work: see the debt notes on YAZ-1853.

## Open Questions

- none

## Learnings

- **`sortTree` belongs in `shared/`**: a pure rule over `TreeNode`, no React, and the desktop
  integration test can import it — the same reason `drawingAssets.ts` lives there.
- **The real `storage` module keeps state across Sidebar tests** (expansion, sort). A test that
  expands a folder must fold it back, or read only top-level rows.
- **Info must ask the tree whether the row is a board**: `MenuRow` carries only `type`/`path`, and
  `notes.txt` is a file row too. `isBoard(tree, path)` is the one gate.
- **`localeCompare` orders the space before the dot** ("BIG 2" before "big.") — the name order is
  the locale's, not ASCII's; the test says so.
- **A legacy board's mtime is its Created date too** (🔒 YAZ-1834 D6 fallback), so a legacy board
  touched 5 minutes ago leads "Created" over a board born 30 minutes ago. Expected, and documented
  in the integration test.
- **Refresh-on-every-event needs an ordering guard.** Two tree walks can overlap and land out of
  order; `TreeResponse.generatedAt` (written by main, read by nobody until now) is the clock that
  drops the stale answer. The audit caught it; a test with two out-of-order resolutions pins it.
- **Pin `now` at open** for any popover with relative times (the vault switcher's idiom), or the
  text shifts on unrelated re-renders.

## Working Set

- `shared/treeSort.ts`, `shared/types/appState.ts`, `shared/types/bridge.ts`, `desktop/src/main/store.ts`, `desktop/src/main/ipc/state.ts`, `desktop/src/main/fs/sortVault.integration.test.ts`, `client/src/lib/{storage,format}.ts`, `client/src/sidebar/{Sidebar.tsx,menuSections.ts,BoardInfo.tsx}`, `client/src/components/{icons,ContextMenuSurface}.tsx`, `client/src/app.css`, `docs/CONTRACTS.md`, `tools/seedSortDemoVault.mjs`.
