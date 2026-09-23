# CONTINUITY — YAZ-1801 Board size: Storage page, GitHub size guard, move pictures out

Parent: [YAZ-1801](https://linear.app/growprofit/issue/YAZ-1801). Children YAZ-1870 (A), 1871 (B), 1872 (C), 1873 (D), 1874 (E), 1875 (F), 1876 (G), 1877 (H), 1878 (I). Future: YAZ-1879.

## Goal

Every vault has its own Settings › Storage page (one bar "X of 10 GB" with marks at 1 and 5 GB, "Your
files" / "Old versions", Needs attention, Move pictures out); sync never jams on a file GitHub would
refuse (≥ 95 MiB left out of every commit, loud banner + red chip + sidebar icon); fetch/push get
10 min; measuring never freezes the window. Done when every 📋 scenario on YAZ-1801 holds,
typecheck + all vitest projects + build are green, merged to main. No release (Yasin cuts them).

## Constraints

- Worktree `yaseen-draw-app-yaz-1801`, branch `yaz-1801-storage-demo`, rebased on `origin/main` @ `f94df06` (YAZ-1800 hover preview).
- No Playwright, no subagent drives the GUI. Evidence = unit + integration tests; GUI checks by Yasin in a dev app on an isolated profile (`YASEEN_DRAW_USER_DATA_DIR=<tmp> npx electron-vite dev --watch` from `desktop/`).
- Never touch the real vault `yaseen-draw-vault` or `~/Library/Application Support/Yaseen Draw/`.
- Labels `🔒 YAZ-1801 D<n>`; commits via `/commit`, no trailers.

## Key Decisions (🔒 YAZ-1801 FINAL comment — supersedes the earlier D1–D5 / D6 comments)

- D1 Storage = own standalone page, per vault. D1b layout: bar row, two muted lines, Needs attention (≥ 50 MiB, red ≥ 95), Make boards smaller.
- D2 history = `count-objects` size + size-pack; old versions = history − HEAD tree on disk.
- D3 exclude ≥ 95 MiB before `git add`; `attention/too-large` + `tooLarge[]`; persistent banner, red chip, cloud-off icon.
- D4 fetch/push 10 min. D5 Move pictures out button, block verbatim, one shared extraction. D6 no history reset.
- D7 fixed bar to 10 GB, marks 1/5 GB. D8 stats off the main thread. D9 already-committed oversize, 2 GB push, reset → Future YAZ-1879. D10 demo buttons do not ship.
- D11 shrink runs on the SAME storage worker (`desktop/src/main/storageWorker.ts` — not `git/`), one tagged job, one `runOffThread`.
- D12 a held-back TRACKED file is parked (`stash push -- <paths>`) across the rebase and its bytes copied back (`checkout stash@{0}`, unstage, `stash drop`) — the sync pass's only stash; status stays `too-large`, never a false `conflict`.
- D13 Storage measures only while Settings is open (`settingsOpen ? syncState : null`; page open, a pass finishing, after shrink); a vault change clears and does not measure; a failed first measure reads "Couldn't measure this vault".

## State

- Done:
  - [x] Scope, decisions, demo, sub-issues (YAZ-1870 Done)
  - [x] Prototype committed and rebased on main
  - [x] 1801B sync guard at ≥ 95 MiB, edge/Y8/Y9 tests (cf60f26)
  - [x] 1801C stats on a worker thread (`?modulePath`), same numbers, stall test (959861a)
  - [x] 1801D verbatim-block + mtime-race tests, `dirty()` required (12c965b)
  - [x] 1801E demo buttons gone, page-open refresh, spec-size bar tests (17fc46f)
  - [x] 1801F chip/banner copy folded to one path each (0e02038)
  - [x] 1801G integration test stats → sync → shrink → sync → stats; shrink on the worker (D11); Yasin's GUI click-list "all good"
  - [x] 1801H audit comment on YAZ-1877 (2 must / 18 should / 12 could)
  - [x] 1801I audit applied: D12 rebase park, D13 measure-while-open, failed-measure line, Windows icon paths, one vault walker, one too-large phrase, docs; packaged app loads the worker from inside `app.asar` (no `asarUnpack`). Suite 137 files / 2084 tests; typecheck + build green
- Now: [→] merge to main (coordinator)
- Remaining:
  - [ ] Future YAZ-1879: history reset, already-committed oversize file (GH001), 2 GB push

## Open Questions

- none

## Working Set

- `desktop/src/main/git/{sync,manager,storage,exec}.ts`, `desktop/src/main/fs/{drawing,shrink,fsUtils}.ts`, `desktop/src/main/ipc/storage.ts`, `desktop/src/main/{storageJob,storageWorker}.ts`
- `client/src/settings/{storageSection,registry,SettingRow,SettingsDialog}.tsx`, `client/src/hooks/useVaultStorage.ts`, `client/src/lib/{syncAttention,paths}.ts`, `client/src/drawings/SyncIndicator.tsx`, `client/src/sidebar/{Sidebar,Tree}.tsx`
- `shared/types/vault.ts`, `tools/seedStorageDemoVault.mjs`, `docs/CONTRACTS.md`
- Tests: `npm test`, `npm run typecheck`, `npm run build`
