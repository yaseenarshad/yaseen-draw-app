# CONTINUITY — YAZ-1802 draw.io support (a second, first-class board type)

## Goal
- `.drawio` diagrams are first-class boards beside Excalidraw: create, edit in a bundled offline draw.io, autosave, outside-change reload, sync keep-both, hover preview, export image, history, share, type mark, dark-colour setting. Merged to main, Linear Done, release cut (smallest bump), installed app replaced, every release has notes.

## Constraints
- LOCKED D0–D17 + decision record v2: comments on YAZ-1802 (read 📘 v2 first).
- No draw.io fork: config + our overlay scripts only. Never copy drawio-desktop code.
- No Playwright, by anyone. Verify by dev app in an isolated profile + unit tests + pointed asks to Yasin.
- Subagents run Opus 5.5; I review every diff for slop and quality.
- Commits via the /commit skill (no attribution). Merge to main when done.

## Key Decisions
- See YAZ-1802 🔒 comments. Prototype = starting point (this worktree's uncommitted diff at start).

## State
- Now: [→] 1- Deep scope (YAZ-1948)
- Remaining:
  - [ ] 2A classify (YAZ-1950) · [ ] 2B bundle (YAZ-1951) · [ ] 2C doors (YAZ-1952) · [ ] 2D host (YAZ-1953) · [ ] 2E feel (YAZ-1954) · [ ] 2F sync (YAZ-1955) · [ ] 2G naming (YAZ-1956)
  - [ ] 3A render/preview/export (YAZ-1958) · [ ] 3B history (YAZ-1959) · [ ] 3C share (YAZ-1960) · [ ] 3D type mark (YAZ-1961) · [ ] 3E dark setting (YAZ-1962)
  - [ ] 4A core E2E (YAZ-1964) · [ ] 4B everywhere-else E2E (YAZ-1965)
  - [ ] 5A audit (YAZ-1967) · [ ] 5B apply (YAZ-1968)
  - [ ] merge to main · [ ] release (smallest bump) + install · [ ] release notes backfill

## Open Questions
- none yet

## Working Set
- Worktree `../yaseen-draw-app-yaz-1802-demo`, branch `yaz-1802-drawio-support`
- `npx vitest run` · `npm run typecheck` · `npm run build` (PATH=/opt/homebrew/bin)
- Seed: `node tools/seedDrawioDemoVault.mjs --vault <tmp> --profile <tmp>`
