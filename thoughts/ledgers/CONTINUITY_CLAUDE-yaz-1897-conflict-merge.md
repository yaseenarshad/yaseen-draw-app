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
  - [x] 2A board merge (79259b7) · [x] 2B resolve inside sync (e0f6796) · [x] 2C 60 s poll (639d07e) · [x] 2D history backend (7006768)
  - [x] 3A merged notice + 3B Version history panel (9ebc09a)
  - [x] 4A scenarios S1–S28 (34114bf: S9 parent revival, S12, S14) · [x] 4B live dev-app check via CDP + demo vault (d4c4250)
  - [x] 5A audit (YAZ-1911) · [x] 5B polish (2f19b1f)
  - [x] Merged PR #11 (72ce61b), released v0.1.6 (8fabfc7), installed on Yasin's Mac
- Now: nothing. YAZ-1897 is done.

## Gotchas learned
- In a rebase, stage 2 is the UPSTREAM and stage 3 is ours. Read stages with `checkout-index --stage=all --temp` (no stdout buffer).
- `rebase --abort` resets a save made mid-rebase, and an unstaged tracked file blocks `--continue`. Park by copy before both.
- An empty resolution blocks `--continue`. Use `rebase --skip`.
- `rev-parse --verify` takes exactly one name.
- `git show --output=` does not redirect a blob.
- The repo has no Prettier config and CI checks no formatting: match the surrounding style (long lines), never run Prettier over files.

## Open Questions
- None blocking.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-draw-app-yaz-1897`, branch `yaz-1897-conflict-merge`
- `/opt/homebrew/bin/npm test`, `npm run typecheck`, `npm run build`
