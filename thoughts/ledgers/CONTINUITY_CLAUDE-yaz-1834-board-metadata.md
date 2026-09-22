# CONTINUITY — YAZ-1834 Board metadata (createdAt / updatedAt in the .excalidraw)

Parent issue: [YAZ-1834](https://linear.app/growprofit/issue/YAZ-1834). Children YAZ-1836 (A) … YAZ-1841 (F).

## Goal

Every board carries `{ "yaseendraw": { "createdAt", "updatedAt" } }` as the FIRST key of its
`.excalidraw`, set by main in the doors that already write the file, read by the tree walk from the
file head, so the dates survive rename/move/clone/sync and the cloud backfill (YAZ-1832) can set them.
Done when: new boards are born stamped, legacy boards get a block on first save, `tree()` reports
`meta` for stamped boards, a backfilled block survives a save with `createdAt` + extra keys intact,
typecheck + all vitest projects + build green, merged to main. No release.

## Constraints

- Worktree `yaseen-draw-app-metadata`, branch `yaz-1834-board-metadata` off `origin/main` @ `b715f6b`.
- No Playwright, ever. No launching the Electron app unless Yasin asks. Evidence = main-process
  integration tests on real tmp vaults + the seeded stress vault (`tools/seedDemoVault.mjs --vault`).
- Renderer untouched. One door per write kind. Pure rules in `shared/`, Electron-free, co-located tests.
- Decision labels in code: `🔒 YAZ-1834 D<n>`. Commits via `/commit`, no attribution trailers.
- Never touch `yaseen-draw-app` (main checkout) or other worktrees.

## Key Decisions (locked on YAZ-1834, 2026-09-22)

- 🔒 D1 in-file block, first key; no sidecar, no index, no repair code.
- 🔒 D2 no `openedAt`. 🔒 D4 dropped with it.
- 🔒 D3 main stamps: create births; save re-reads the head, keeps `createdAt` + unknown block keys, sets `updatedAt = Date.now()` just before the atomic write.
- 🔒 D5 the block is the backfill contract; `createdAt` never rewritten when finite; extra keys preserved.
- 🔒 D6 `TreeNode.meta?` from a 1 KB head read; block wins over mtime.
- 🔒 D7 absent / misplaced / malformed = no meta; rebirth on next save; never blocks a write.
- Field audit: only the two dates. No id, tags, description.

## State

- Done:
  - [x] Scope + decisions locked; subissues created (YAZ-1836…1841)
  - [x] 1834A scope comment (YAZ-1836)
  - [x] 1834B pure functions + tests (YAZ-1837)
  - [x] 1834C wire create/save/tree, types, CONTRACTS (YAZ-1838)
  - [x] 1834D verify against seeded vault + clone (YAZ-1839) — `boardMetaVault.integration.test.ts`
  - [x] 1834E audit comment (YAZ-1840) — 37 items, 3 bugs
  - [x] 1834F apply audit, merge (YAZ-1841)
- Now: merged to main; nothing pending. Follow-ups live in YAZ-1835 (sort) and YAZ-1832 (importer).

## Open Questions

- none

## Learnings

- **The reader must return the WHOLE block.** First cut returned only the two dates, so a
  backfilled `cloudId` vanished on the first save — caught by the D5 test. The save hands the
  file's block to `stampBoardMeta` as `prior`; the tree picks the two dates out of it.
- **"Misplaced block gets reordered on save" was wrong.** The save reads the head only, so a
  block that is not first is replaced, not moved. Locked as D7 wording; the importer writes first.
- **The old "untouched save is byte-identical" test had to change meaning:** with `updatedAt`
  stamped on every save, the invariant is "byte-identical BELOW the block". Recorded in CONTRACTS.
- **`fs:create-file` got stricter, then simpler:** content is required and must be a JSON object
  (`BAD_REQUEST` otherwise, before the disk is touched). The bare-path and empty-content forms
  were dead in the app and were the last way to write a zero-byte board; the audit deleted them.
- **The audit's three real catches:** (1) opening every drawing in the tree walk turned an
  unreadable board (EACCES) into a *missing* board — now it falls back to `stat` and lists
  without dates; (2) the `TOO_LARGE` ceiling measured the scene before the block was added, so
  a save could write what its own load refuses — the ceiling now measures the stamped bytes;
  (3) the head reader hardcoded the key its constant already named.
- **Two readers on purpose:** `readBoundedHandle` is "whole file or fail"; `readBoardHead` is
  "first KB of anything". Reusing one for the other would weaken its invariant.
- **A fresh-eyes audit agent over the full diff was worth it** — the three bugs above were all
  in code I had just written and re-read myself.

## Working Set

- `shared/drawingAssets.ts` (+ `.test.ts`), `shared/types/files.ts`, `desktop/src/main/fs/{create,drawing,fsUtils}.ts` (+ tests), `docs/CONTRACTS.md`.
- Tests: `npm test` (all projects), `npm run typecheck`, `npm run build`.
