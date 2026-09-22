# CONTINUITY — YAZ-1800 Mouse over Preview

Parent: [YAZ-1800](https://linear.app/growprofit/issue/YAZ-1800/mouse-over-preview) · children 1800A (YAZ-1863), 1800B (YAZ-1864), 1800C (YAZ-1865), 1800D (YAZ-1866), 1800E (YAZ-1867), 1800F (YAZ-1868), 1800G (YAZ-1869).

## Goal
- Rest on a board row (pointer or focus) for 400 ms → a big panel beside the sidebar shows the whole drawing; a header toggle (default on, app-wide) turns it off.
- Done when: typecheck, all vitest projects and build green; merged to main. No release (Yasin bundles releases).

## Constraints
- Worktree `../yaseen-draw-app-yaz-1800`, branch `yaz-1800-hover-preview`, rebased on main `e5ab46e` (YAZ-1855).
- No Playwright. Evidence = unit tests + `previewVault.integration.test.ts` over `tools/seedPreviewDemoVault.mjs`; Yasin ran the 20 scenarios live on the prototype.
- Labels written as `🔒 YAZ-1800 D<n>`; commits via `/commit`.

## Key Decisions (locked on YAZ-1800, one comment each)
- D1: draw on first hover in the renderer, memory only (no disk, no vault files); key `root\npath\nmtime\ntheme` (mtime amended from `updatedAt` in review).
- D2: `SettingsState.hoverPreview`, app-wide, default true, in `yaseendraw.json`.
- D3: picture-frame toggle right of sort; one `.sidebar__tools` group.
- D4: the old app's panel geometry, portalled, `pointer-events: none`.
- D5: 400 ms dwell; pointer + focus; every close; capture Escape; save = swap in place (amended in review).
- D6: `createPreviewCache({ limit })` LRU, boards keep 32.
- D7: applied app theme, in the key.

## State
- Done:
  - [x] 1800A scope + demo + lock
  - [x] 1800B renderer shared (`lib/scenePreview.ts`), `boardPreviewCache.ts`, LRU
  - [x] 1800C setting, Settings row, header toggle
  - [x] 1800D panel, dwell, closes, swap in place
  - [x] 1800E integration test over the seeded vault
  - [x] 1800F audit (13 items) · 1800G applied

## Open Questions
- Later option only: persist pictures under userData for instant hovers after relaunch (D1).

## Working Set
- `client/src/sidebar/{boardPreviewCache.ts,BoardPreview.tsx,Sidebar.tsx,Tree.tsx}`, `client/src/lib/{scenePreview.ts,previewCache.tsx,paths.ts}`, `shared/types/appState.ts`, `desktop/src/main/store.ts`, `client/src/app.css`, `tools/seedPreviewDemoVault.mjs`.
- Gotcha: `boardPreview.ts` beside `BoardPreview.tsx` clashes on macOS's case-insensitive disk → the cache is `boardPreviewCache.ts`.
- Gotcha: a worktree `npm install` skips Electron's postinstall under `allow-scripts`; copy `node_modules/electron/dist` + `path.txt` from the main checkout (same version).
- Test: `npm run typecheck && npm test && npm run build`.
