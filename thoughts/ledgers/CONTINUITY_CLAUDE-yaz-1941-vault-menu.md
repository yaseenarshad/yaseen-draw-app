# CONTINUITY — YAZ-1941 vault right-click menu (port of Docs YAZ-1798)

## Goal
- Right-click the sidebar header's vault name or any ⌘O switcher row → the Docs vault menu. Merged to main, Linear Done, no release.

## Constraints
- LOCKED D1–D3 + inherited Docs decisions + S1–S20: pinned comments on YAZ-1941.
- No Playwright, by anyone. Hand pass by Yasin on `YASEEN_DRAW_USER_DATA_DIR`.
- No release cut (Yasin batches releases).

## Key Decisions
- D1 same items as Docs · D2 keep "Open in this window" (calls `openRoot` directly) · D3 port Docs' final code (Docs main `0965cfd`).

## State
- Done:
  - [x] 1- Scope (YAZ-1942)
  - [x] 2- Build (YAZ-1943) — 3-way merge of Docs `9437799..0965cfd` onto draw; typecheck clean, 154 files / 2333 tests green
- Now: [→] 3- Hand pass S1–S20 (YAZ-1944)
- Remaining:
  - [ ] 4A- Audit (YAZ-1946)
  - [ ] 4B- Apply, merge, cleanup (YAZ-1947)

## Open Questions
- none

## Working Set
- Worktree `../yaseen-draw-app-yaz-1941`, branch `yaz-1941-vault-menu`
- `npx vitest run` · `npm run typecheck`
