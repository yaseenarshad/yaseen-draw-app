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
  - [x] 2C — Re-pack the engine at `e72242f8` and add `packEngine` (YAZ-1809)
  - [x] 2B — Strip the markdown-only subsystems, delete never hide (YAZ-1808)
  - [x] 2D — Make `.excalidraw` the document: load, save, autosave, conflict, chips (YAZ-1810)
  - [x] 2E — Image store: `assets/`, hydrate, extract, orphan sweep (YAZ-1811)
  - [x] 2F — Canvas chrome: rail, panel shell, menus, full toolbar, parity checklist (YAZ-1812)
  - [x] 2G — Settings: canvas preferences, Library folder, trims (YAZ-1813)
- Now: [→] 2H — ⌘K search over the drawing catalog (YAZ-1814)
- Remaining:
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

- UNCONFIRMED: `desktop/build/icon.png` is the only icon asset; the stale docs-app `icon.icns`/`icon.ico` were deleted and electron-builder now derives both from the PNG. Confirm during the 4D packaging run.
- UNCONFIRMED (2B leftover, for 2D/2G): the rename CONFIRM sheet survives without its reason. ⚡ YAZ-888 made a name change ask first *because* the rename chained into every `[[wikilink]]`; with links gone the sheet now only says "Rename 'x' to 'y'?". Kept rather than removed — deleting a confirm is a product decision, not a strip — but it may want to go.
- RESOLVED (🔒 "Dead asset pipe deleted" on YAZ-1775): the image half of the asset pipe is gone — module, tests, channels, preload methods, types and CONTRACTS rows — in 2F's first commit.
- UNCONFIRMED (posted on YAZ-1812, awaiting Yasin): `focusOpenDocument`. A tab that becomes visible LATER still gets no focus — `autoFocus` only fires at mount. Whether the canvas should claim focus when its layer becomes visible is a product call, so 2F left it alone.

## Learnings (2D / 2E / 2F / 2G)

- **The toolbar-mode names read backwards.** The fully built-out `ContextualPropertiesToolbar` is the engine's `full` desktop mode; `compact` is upstream's vertical strip. `YASEEN_FULL_TOOLBAR_MODE` exists so no one ever writes the bare string and inverts it again (rounds 3–4 did).
- **`getFormFactor` is the other half of that gate.** Without it a canvas pane narrowed by the shell sidebar falls into the engine's ≤ 1180 px tablet band and is forced to `compact` before the localStorage key is ever consulted.
- **Nothing the engine is handed may change identity.** `<Excalidraw>` is memoized and calls `onChange` on every render, so `initialData` is built ONCE from the mount-time scene and prefs, and the rail reads live state from a tiny external store rather than props.
- **One ref, two directions.** `appliedRef` is "what the engine is believed to hold"; both the engine→shell read-back and the shell→engine push compare against it before writing. That single comparison is the whole anti-ping-pong rule.
- **`toolLock` and `framesVisible` are not plain appState.** A partial `activeTool` wipes the tool the user is holding, so a live lock update merges with what the engine holds; frames go through `updateFrameRendering` and never through `updateScene`.
- **Strict at the bridge, lenient on load.** The IPC guard demands a whole `CanvasPrefs` from a sandboxed renderer; the state FILE is repaired key by key, so a store written before a pref existed keeps every pref it does have instead of resetting the lot. One guard map, two callers.
- **Only main can resolve the library folder.** `null` means `<userData>/library`, and only main knows where that is — which is why the Settings row asks over IPC instead of working it out.
- **Menu commands reach the canvas by DOM, not by prop.** Several tabs are mounted at once, each with its own engine; a CustomEvent on the visible `.editor--drawing` section is the only address that means "the one in front".


- **The document's bytes get ONE door per direction.** `drawing:load` / `drawing:save`, because a scene and the images it names are one thing: a save is "assets first, then the scene", and any second writer (the old `writeAsset` string body) would land half of it. 2D narrowed the asset pipe to images for exactly this reason.
- **Autosave on the engine's scene VERSION, not the bytes.** The canvas reports a change per pointer move; `Autosave<number>` is fed the integer and serialises once, inside `save()`, when the timer fires. `Autosave` is generic over its content key now — string for text, number for a canvas.
- **A reload must not write.** `updateScene` provokes the engine's own `onChange`, so the naive version saves what it has just read. Two guards: `replaceScene` returns the version computed from the elements it HANDED the engine (reading back races its commit), and the first snapshot after a reload is consumed as the new baseline.
- **`getSceneVersion` is a SUM.** An undo back to the same total reads clean. Accepted on YAZ-1775; the failure mode is a skipped redundant save, not a lost edit.
- **Register rename-continuity from the canvas too.** Without `retire()`, closing the tab of a deleted board flushes on unmount and resurrects the file. `capture()` returns null: a live canvas has no string buffer to carry, and the pre-rename flush already put it on disk.
- **`stripEmbeddedFiles` must be byte-stable on a lean scene**, or every untouched save rewrites the file and churns the vault's git history.
- **The sweep's age guard is the whole safety property.** Unreferenced is not enough — a paste lands in `assets/` before the board that names it is saved.
- **Pre-existing flake:** `desktop/src/main/git/{sync,guarantees}.test.ts` intermittently time out under full-suite load (real git subprocesses). Reproduced on the 2D baseline with 2E stashed — not caused by either. Worth a look in 5A/5B.

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
  npm test          # vitest, 3 projects: client jsdom, desktop node, tools node
  npm run build     # electron-vite build into desktop/out
  # there is no e2e script: Playwright was deleted in 2B (OD1)
  ```
