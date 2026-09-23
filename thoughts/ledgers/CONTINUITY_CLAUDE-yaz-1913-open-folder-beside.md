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
  - [x] 2- Build (YAZ-1916)
- Now: [→] 3- Verify end-to-end (YAZ-1917)
- Remaining:
  - [ ] 4A- Audit (YAZ-1919)
  - [ ] 4B- Apply, merge, release, install (YAZ-1920)

## Open Questions
- None.

## Working Set
- Branch `yaz-1913-open-folder-beside`, worktree `../yaseen-draw-app-yaz-1913`
- `npm test`, `npm run typecheck`, `npm run build`
