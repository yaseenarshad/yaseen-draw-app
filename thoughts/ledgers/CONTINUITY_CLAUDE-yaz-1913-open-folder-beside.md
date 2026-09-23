# Continuity — YAZ-1913 Open folder… opens beside

## Goal
- Opening a folder never replaces the vault a window already has: ⌘⇧O, the switcher's Open folder… and File › Open Recent open the vault in its own window (or raise it). Only Welcome fills in place. Tests + typecheck + build green, merged to main, release cut (smallest bump) and installed on Yasin's Mac.

## Constraints
- No Playwright, ever (not in subagents either). Hand-tests go to Yasin in an isolated dev app (`YASEEN_DRAW_USER_DATA_DIR`).
- Docs app is out of scope (another agent).

## Key Decisions (Linear YAZ-1913 comments)
- 🔒 D1: Open folder… AND plain-click Open Recent change; ⌥ on Open Recent carries no meaning.
- 🔒 D2: picked folders decide in the renderer (`App.tsx` `openPicked`); Open Recent decides in main (`menu.ts` `openRecent`). Rule stated once in CONTRACTS › Menus and shortcuts.
- 🔒 D3: docs app out.

## State
- Done:
  - [x] 1- Deep scope (YAZ-1915)
  - [x] 2- Build (YAZ-1916) — 67eeda1
  - [x] 3- Verify end-to-end (YAZ-1917) — 12/12 real-app checks via the main-process inspector
  - [x] 4A- Audit (YAZ-1919) — A1–A6
  - [x] 4B- Applied A1–A6 (c2cdb5a); merged PR #12 (944c31f), released v0.1.7 (b59ed36), installed on Yasin's Mac
- Now: nothing — closed.

## Open Questions
- None.

## Working Set
- Branch `yaz-1913-open-folder-beside`, worktree `../yaseen-draw-app-yaz-1913`
- `npm test`, `npm run typecheck`, `npm run build`

## Learnings
- S10 (Open Recent with no window) cannot happen: the app quits on its last window.
- Real-app checks without Playwright: launch the built app with `--inspect` + `YASEEN_DRAW_USER_DATA_DIR`, click menu items from main, stub only `dialog.showOpenDialog`, read each renderer's `window.identity()`.
- Under heavy machine load the git integration tests hit their 20 s timeouts; rerun those files alone before blaming a change.
