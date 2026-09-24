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
- Done:
  - [x] 1- Deep scope (YAZ-1948) — findings on every child; 4 small defaults decided
  - [x] 2A classify (YAZ-1950) · [x] 2B bundle (YAZ-1951) · [x] 2C doors (YAZ-1952) · [x] 2F sync (YAZ-1955) — commit 7075e93, 2,429 tests
  - [x] 2D host (YAZ-1953) · [x] 2E feel (YAZ-1954) · [x] 2G naming (YAZ-1956) — commit 831466f; review fix: guides a per-diagram toggle
  - [x] Yasin hand pass of phase 2: "all good" (logged on 4A)
  - [x] 3A–3E (YAZ-1958–1962) — commit 8addfd9
  - [x] 2B1 trim bundled draw.io (YAZ-1973) — commit 1b3693b, 2,519 tests
  - [x] 5A audit (YAZ-1967) — 10 MUST + 24 SHOULD, comment on YAZ-1967
  - [x] 4A core loop (YAZ-1964) · 4B everywhere else (YAZ-1965) — Yasin: "all good" on both builds
  - [x] 5B apply the audit (YAZ-1968) — 33/34 done, 1 half-declined; review fix: the build config imported `@shared` (no alias in Node) → `DRAWIO_TAG` moved to `shared/drawio.ts`; CI now runs `npm run build` as LAUNCH always said
- Now: [→] merge to main · release 0.1.9 + install · closeout (handoff comments, cleanup, statuses)
- Notes for a future agent:
  - Yasin must re-run Settings › Sharing › Set up sharing once after 0.1.9 (new Worker code + draw.io assets); old links keep working.
  - Future issues: YAZ-1969 Present for diagrams · YAZ-1970 cell merge + history marks · YAZ-1971 .drawio.svg/.png · YAZ-1972 diagram images in assets/.
  - draw.io bump: change `DRAWIO_TAG` in `shared/drawio.ts` + `tools/packDrawio.mjs` (+ `WAR_BYTES`/`WAR_SHA256`), run `npm run drawio:pack --force`, run tests (the overlay guard test fails if a patched draw.io internal vanished), watch the dev log for `app://drawio` 404s.

## Open Questions
- none

## Working Set
- Worktree `../yaseen-draw-app-yaz-1802-demo`, branch `yaz-1802-drawio-support`
- `npx vitest run` · `npm run typecheck` · `npm run build` (PATH=/opt/homebrew/bin)
- Seed: `node tools/seedDrawioDemoVault.mjs --vault <tmp> --profile <tmp>`
