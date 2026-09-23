# Continuity Ledger: YAZ-1897 conflict merge

## Goal
- Two people syncing one vault through GitHub never jam: boards merge shape by shape, other files keep both copies (shares/favorites merge), a quiet 60 s pull keeps open boards fresh, and right-click › Version history shows any version as a coloured picture compare with Restore. Tests + typecheck + build green, merged to main, release cut (smallest bump) and installed on Yasin's Mac.

## Constraints
- Decision record = comments on YAZ-1897 (📘 record, 🔒 D1–D6) + scope findings on YAZ-1898. Children YAZ-1898…1912.
- No Playwright, ever (not in subagents either). Real-git integration tests; hand-tests go to Yasin in an isolated dev app.
- Lossless rule: anything the resolver cannot merge still aborts exactly as before; mid-rebase saves are parked by copy, never lost.
- Architecture decisions go to Yasin (problem/options/recommendation/diff/after). Bug-level calls are ours, recorded on Linear.

## Key Decisions
- D1 3-way per-shape board merge (newest `updated` on a clash; delete vs edit keeps the edit) · D2 `*.excalidraw -merge` in `.git/info/attributes` · D3 keep both for other files (shares/favorites merge, other `.yaseendraw` local wins) · D4 Version history + picture compare + Restore, merge notice links to it, `refs/yaseendraw/before-merge` · D5 no per-board hold · D6 60 s quiet poll, only when synced and idle.

## State
- Done:
  - [x] Scoping, decisions, Linear tree
  - [x] 1 Deep scope (YAZ-1898)
- Now: [→] 2A board merge (YAZ-1900)
- Remaining:
  - [ ] 2B resolve inside sync (YAZ-1901)
  - [ ] 2C 60 s poll (YAZ-1902)
  - [ ] 2D history backend (YAZ-1903)
  - [ ] 3A merged notice (YAZ-1905)
  - [ ] 3B version history panel (YAZ-1906)
  - [ ] 4A merge scenarios on real git (YAZ-1908)
  - [ ] 4B history / undo on a test vault (YAZ-1909)
  - [ ] 5A audit (YAZ-1911) · [ ] 5B apply + docs + merge + release (YAZ-1912)

## Open Questions
- None blocking.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-draw-app-yaz-1897`, branch `yaz-1897-conflict-merge`
- `/opt/homebrew/bin/npm test`, `npm run typecheck`, `npm run build`
