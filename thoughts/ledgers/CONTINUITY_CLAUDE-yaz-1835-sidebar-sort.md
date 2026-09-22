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
- Now: [→] 1835B state door + tests (YAZ-1849)
- Remaining:
  - [ ] 1835C pure helpers + tests (YAZ-1850)
  - [ ] 1835D control + refresh + tests + CONTRACTS (YAZ-1851)
  - [ ] 1835E Info + tests (YAZ-1847)
  - [ ] 1835F seeder in tools/ + integration test (YAZ-1852)
  - [ ] 1835G audit (YAZ-1853)
  - [ ] 1835H apply, merge (YAZ-1854)

## Open Questions

- none

## Working Set

- `shared/types/appState.ts`, `shared/types/bridge.ts`, `desktop/src/main/store.ts`, `desktop/src/main/ipc/state.ts`, `client/src/lib/{storage,treeSort,format}.ts`, `client/src/sidebar/{Sidebar.tsx,menuSections.ts,BoardInfo.tsx}`, `client/src/components/icons.tsx`, `client/src/app.css`, `docs/CONTRACTS.md`, `tools/seedSortDemoVault.mjs`.
