# CONTINUITY — YAZ-1855 Default zoom: open every board fitted

Parent: [YAZ-1855](https://linear.app/growprofit/issue/YAZ-1855/default-zoom-level) · children 1 (YAZ-1856), 2 (YAZ-1857), 3 (YAZ-1858), 3A (YAZ-1862), 4 (YAZ-1859) → 4A (YAZ-1860), 4B (YAZ-1861).

## Goal
- Every board opens zoomed out to show all its live elements: never past 100%, floor 10%. Empty boards open at 100%.
- Done when: typecheck, all vitest projects and build green; merged to main. No release (Yasin bundles releases).

## Constraints
- Worktree `../yaseen-draw-app-yaz-1855`, branch `yaz-1855-fit-on-open`, off `origin/main` at `7846a68`.
- No Playwright. Evidence = unit tests + a DevTools-protocol probe of the dev app on a throwaway profile (`YASEEN_DRAW_USER_DATA_DIR`).
- Labels written as `🔒 YAZ-1855 D<n>`; commits via `/commit`.

## Key Decisions (locked on YAZ-1855)
- D1: fit on open (`initialState.viewport`, `fit: 'scale-down'`), not a fixed 10%.
- D2: no setting.
- D3: no per-board zoom/scroll memory.
- 🔒 YAZ-1862: hidden tab layers hide every descendant with `!important` (engine forces footer buttons visible).

## State
- Done:
  - [x] 1 Scope: engine measures the canvas before resolving the initial viewport; hidden tabs keep their size.
  - [x] 2 `openViewport` in `drawingScene.ts`, wired as `initialState` in `ExcalidrawSurface.tsx`; `scrollToContent` removed.
  - [x] 3 E2E: 10% / 24% / 100% ×4, tab switch keeps live zoom, relaunch re-fits, files untouched.
  - [x] 3A Hidden-tab footer leak fixed (`tabs.css` + `tabs.test.ts`).
  - [x] 4A audit · 4B applied (filter tightened, header reflowed, CONTRACTS + README).

## Open Questions
- Not in scope: the app menu owns ⌘0, so the engine's own ⌘0 reset-zoom never fires (Shift+0 does).

## Working Set
- `client/src/drawings/drawingScene.ts`, `ExcalidrawSurface.tsx`, `client/src/tabs/tabs.css`, `docs/CONTRACTS.md`, `README.md`.
- Gotcha: a worktree needs BOTH root and `client/node_modules` symlinked, or `TabBar.test.tsx` fails on a second React copy.
- Test: `npm run typecheck && npm test && npm run build`.
