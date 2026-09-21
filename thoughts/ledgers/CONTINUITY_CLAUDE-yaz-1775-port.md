# CONTINUITY — YAZ-1775 Port to Electron App (Local Version)

Single source of truth for the Yaseen Draw port. Parent issue: [YAZ-1775](https://linear.app/growprofit/issue/YAZ-1775/port-to-electron-app-local-version).

## Goal

`yaseen-draw-app` is a local Excalidraw whiteboard as an Electron desktop app: the `yaseen-docs-app` shell (windows, tabs, vault, favorites, GitHub sync, settings) with `.excalidraw` as the primary document and the vendored `yaseendraw` engine as the canvas. Done when a `v0.1.0` DMG installs on Yasin's Mac, opens `.excalidraw` files from Finder, and the phase-4 scenario list passes.

## Constraints

- **Fresh history.** Seeded from `yaseen-docs-app` @ `66c9806` (v0.9.25) as one commit; docs-app ledgers, `docs/superpowers/`, `docs/CONTRACTS.md` and `.claude/` were deliberately not copied.
- **No trace of the old product name.** Product "Yaseen Draw", appId `com.yasinarshad.yaseendraw`, scheme `yaseendraw://`, vault config dir `.yaseendraw/`, bridge global `window.yaseenDraw` (`YaseenDrawApi`), state file `yaseendraw.json`, env override `YASEEN_DRAW_USER_DATA_DIR`. Only allowed survivor: the one-line README history note.
- **No Playwright / e2e runs**, by agents or in CI (Yasin's rule). CI = typecheck + unit tests. Behaviour is verified by launching the dev app in an isolated profile against the test vault and asking Yasin to run a short scenario list.
- **Never launch the Electron app** without being asked; never touch `yaseen-docs-app` or its worktrees (read-only).
- Commit messages are plain and imperative, with no attribution trailers.
- Known traps that survived the copy and must not be "cleaned up": React `dedupe` in `desktop/electron.vite.config.ts`, prop stability in `client/src/drawings/ExcalidrawSurface.tsx`.

## Key Decisions

All locked on YAZ-1775; the 🔒 comments there hold the reasoning.

- **🔒 D1 — Repo seed: fresh history, copied tree** (+ ⚡ amendment: seed point is docs-app `66c9806` (v0.9.25), plain main, no side branch).
- **🔒 D2 — Engine: vendored fork tarballs, re-packed at `e72242f8`** (`tools/packEngine.mjs`; lockfile rewritten by integrity, not filename).
- **🔒 D3 — Image bytes: vault-level content-addressed `assets/` folder** (SHA-1 ids, `files: {}` in scene JSON, 24 h orphan sweep, `assets/` hidden in the tree).
- **🔒 D4 — Image Studio providers: main process fetches, Pixabay key in Settings via `safeStorage`** (`userData/secrets.json`, 24 h disk cache).
- **🔒 D5 — Account-wide library: one "Library folder" shared by every vault** (default `userData/library/`, `media.json` + `components/`).
- **🔒 D6 — Background removal: not in v1** (deferred to YAZ-1830).
- **🔒 D7 — CI: typecheck + unit tests on every PR** (macos-latest, node 20; release workflow kept, artifact names renamed).
- **🔒 D8 — Panels live in the sidebar, toggles live on the rail** — superseded by **⚡ D8 amended — two sidebars, two jobs** (shell sidebar = Files + Favorites; Images / Components / Present = the web app's in-canvas docked panel).
- **🔒 D9 — Theme and canvas preferences are user-level, stored in the shell settings** (`SettingsState.canvas`; per-board = only what the engine writes into the file; diff-before-write both directions).
- **🔒 D10 — The canvas hamburger opens the canvas panel; no canvas main menu** (Export image → File ⌘⇧E; Canvas background → View; both enabled only on a drawing tab).
- **⚡ Round 4/5 — one toolbar only:** the fork's `full` desktop mode (`ContextualPropertiesToolbar`), `YASEEN_FULL_TOOLBAR_MODE = 'full'` written before every mount; `UIOptions.getFormFactor` never returns `tablet`.
- **✅ Demo approved — decision index and scenario record** is the map for any future agent; its scenario list is the regression list for 4A/4B.

## State

- Done:
  - [x] 2A — Seed the repo from docs-app and rename to Yaseen Draw (YAZ-1807)
- Now: [→] 2B — Strip the markdown-only subsystems, delete never hide (YAZ-1808)
- Remaining:
  - [ ] 2C — Re-pack the engine at `e72242f8` and add `packEngine` (YAZ-1809)
  - [ ] 2D — Make `.excalidraw` the document: load, save, autosave, conflict, chips (YAZ-1810)
  - [ ] 2E — Image store: `assets/`, hydrate, extract, orphan sweep (YAZ-1811)
  - [ ] 2F — Canvas chrome: rail, panel shell, menus, full toolbar, parity checklist (YAZ-1812)
  - [ ] 2G — Settings: canvas preferences, Library folder, trims (YAZ-1813)
  - [ ] 2H — ⌘K search over the drawing catalog (YAZ-1814)
  - [ ] 2I — New drawing, naming, extension display, file association (YAZ-1815)
  - [ ] 3A — Library folder and secrets plumbing (YAZ-1817)
  - [ ] 3B — Images tab: Image Studio with main-process providers (YAZ-1818)
  - [ ] 3C — Components tab: Saved Components as library files (YAZ-1819)
  - [ ] 3D — Present tab: presentation sidebar and player (YAZ-1820)
  - [ ] 3E — Export menu: PNG, SVG, standalone `.excalidraw` (YAZ-1821)
  - [ ] 4A — Prove the image-heavy board round trip through quit, relaunch, sync and clone (YAZ-1823)
  - [ ] 4B — Prove windows, tabs, favorites, vault switcher and same-board-in-two-windows (YAZ-1824)
  - [ ] 4C — Prove Image Studio, Components and Present online and offline (YAZ-1825)
  - [ ] 4D — Release workflow renamed and a local DMG install verified (YAZ-1826)
  - [ ] 5A — Audit the change set and scope the polish, comment only (YAZ-1828)
  - [ ] 5B — Apply the audit: simplify, finalize, docs, ledger, cleanup (YAZ-1829)

## Open Questions

- UNCONFIRMED: ~14 source comments still point at `docs/CONTRACTS.md`, which D1 deliberately did not copy. 2B rewrites the docs — it should either add a Draw-shaped `CONTRACTS.md` or drop those pointers. Left untouched in 2A on purpose.
- UNCONFIRMED: the CLI shim is `yaseendraw` (`desktop/src/cli`, `desktop/build/bin/yaseendraw`) and its help text still talks about page *comments*. 2B decides whether it survives at all.
- UNCONFIRMED: `desktop/package.json` still carries its own `version: 0.4.4`, which is what `${version}` in the dmg/nsis artifact names resolves to. Root is `0.1.0`. 4D should settle which version stamps a release.
- UNCONFIRMED: `LAUNCH.md` and `README.md` still describe a markdown editor (2A only fixed titles and names). 2B owns the rewrite.
- UNCONFIRMED: `desktop/build/icon.png` is the only icon asset; the stale docs-app `icon.icns`/`icon.ico` were deleted and electron-builder now derives both from the PNG. Confirm during the 4D packaging run.

## Working Set

- **Repo:** `/Users/yasin/Documents/GitHub/yaseen-draw-app` (remote `origin` = `https://github.com/yaseenarshad/yaseen-draw-app.git`).
- **Branch:** `yaz-1775-port` (off `main`).
- **Worktree:** `/Users/yasin/Documents/GitHub/yaseen-draw-app-port` — do all work here.
- **Test vault:** `~/Desktop/Port to Electron App - Local Version/` (plus `(origin).git` beside it for sync proofs).
- **Read-only references:** `yaseen-docs-app` @ `66c9806` (shell source), `yaseen-excalidraw` @ `e72242f8` (engine + `public/favicon.svg` + `docs/yaseen-whiteboard-icons.md`), prototype worktree `~/Documents/GitHub/yaseen-docs-app-draw-demo` on `demo/yaz-1775-draw-prototype` (uncommitted; lift patterns, do not copy; delete after phase 2).
- **Commands:**
  ```sh
  npm ci
  npm run typecheck
  npm test          # vitest, 4 projects: client jsdom, desktop node, tools node, perf jsdom
  npm run build     # electron-vite build into desktop/out
  # npm run e2e     # FORBIDDEN — Playwright is never run
  ```
