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
  - [x] 2H — ⌘K search over the drawing catalog (YAZ-1814)
  - [x] 2I — New drawing, naming, extension display, file association (YAZ-1815)
  - [x] 3A — Library folder and secrets plumbing (YAZ-1817)
  - [x] 3B — Images tab: Image Studio with main-process providers (YAZ-1818)
- Now: [→] 3C — Components tab: Saved Components as library files (YAZ-1819)
- Remaining:
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
- RESOLVED (🔒 "Dead asset pipe deleted" on YAZ-1775): the image half of the asset pipe is gone — module, tests, channels, preload methods, types and CONTRACTS rows — in 2F's first commit.
- RESOLVED (🔒 "Focus handoff on tab reveal" on YAZ-1812, built in 2I): a revealed drawing tab takes the keyboard through `DrawingSurfaceApi.focus()`, gated by `drawings/focusHandoff.ts` — never from the sidebar search, the vault switcher or a dialog.
- UNCONFIRMED (posted on YAZ-1815, awaiting Yasin): where a drawing outside EVERY open vault should open. 2I kept the shipped E1 rule — a NEW window rooted at the file's parent folder — rather than repointing the focused window's vault, which would discard its tabs and would need a main→renderer "switch vault and open this" message that does not exist. Documented in CONTRACTS as built.
- RESOLVED (🔒 on YAZ-1775, with the phase-2 merge): the rename CONFIRM sheet is **deleted** — with wikilinks gone it warned about nothing, and "New drawing" landing on the inline rename field made every new `Untitled` board trip it. `ConfirmRename.tsx`/`.test.tsx` and App's `requestRename` detour are gone; rename commits on Enter. Delete and move keep their confirms. First commit of phase 3.

## Learnings (2D / 2E / 2F / 2G / 2H / 2I / 3A / 3B)

- **The library store is `vaultConfig.ts` with one file.** Same shape end to end: lazy read, tmp +
  rename write, one chokidar, own-write echo dropped by mtime, external edit debounced. The one
  new idea is that `media:changed` has NO payload — every window re-lists whichever vault it is
  on, because the library is one file for all of them (🔒 D5's whole point).
- **Watch the folder, not the file, at depth 0.** Tests run chokidar in polling mode, which loses a
  path that appears during its initialisation; the folder exists from startup (`ensureLibraryFolder`)
  where `media.json` does not. Depth 0 keeps 3C's `components/` and the tmp files out of it; the
  `anchored` re-add covers the folder that was unplugged at launch.
- **Strict item, lenient file.** The web app's validator rejects an item whole (a wrong-typed
  optional is a broken tile, not a field to drop), but the FILE drops the bad row and keeps the
  other 499 — and the caps are enforced on read too, so a hand edit cannot grow the lists.
- **A secret is not a setting.** `SettingsState` is broadcast to every window; a key in it would be
  a key in every devtools console. So the Pixabay row has no `SettingsState` field, `onChange` is
  never called, and the row's entire read-back is `secrets:has`. `has` means "stored AND
  decryptable HERE" — a `secrets.json` copied between Macs is a file of blobs the new keychain
  cannot open.
- **The cipher comes in as an argument.** `createSecrets(file, safeStorage)` — the module is
  Electron-free and its tests use a reversible scramble that is visibly not the plaintext, which is
  how the "never on disk in clear" claim is actually asserted.
- **The Worker's curation is four modules, and only one of them fetches.** `curation.ts` (pure
  rules and constants), `cachePolicy.ts` (pure key scheme and 24 h), `cache.ts` (the disk), and
  `providers.ts` (the only one that calls `fetch`, which comes in as an argument). Two of the four
  are testable with nothing mocked at all, and the provider tests stub not one global.
- **`curateIconifyResults` is dead in the Worker too.** It is exported and tested there and
  `searchUncached` never calls it. Ported anyway, with the fact written down: 🔒 D4 names
  `LOW_PRIORITY_COLLECTIONS`, and the next person to want ranking should find the rule rather than
  invent a worse one.
- **Put the key-presence bit IN the search cache key.** The Worker cached a search only when a
  Pixabay key was configured — the crude version of the same idea. With the bit in the key, both
  worlds cache and adding a key never keeps serving yesterday's Iconify-only page.
- **Freshness is the file's own mtime.** One number, written by the write: the 24 h read guard and
  the startup sweep become the same rule, and there is no sidecar timestamp to drift.
- **A `fetch` that THREW is offline; a response that refused is the provider's fault.** That one
  distinction is the whole difference between a passive "You're offline" line and an error banner.
- **`@excalidraw/element` is a SECOND lazy package.** The Smart Shapes' three values are not
  re-exported by `@excalidraw/excalidraw`'s index, so they need their own dynamic import — and
  because the seven basic shapes need nothing, the Shapes view renders immediately and grows.
- **`IMAGE_STUDIO_INSERTION` has no runtime module in the vendored build.** `@excalidraw/excalidraw/*`
  maps to TYPES only. The two numbers are copied (the `formFactor.ts` precedent) with the TYPE
  still imported, so a change in its shape is still a build error.
- **The studio writes nothing to disk.** It leaves the engine holding bytes the store has not got;
  2E's `unpersistedFiles` is what turns that into an `assets/` file, and the insert test asserts it
  with that very function.
- **`main/library.ts` became `main/library/folder.ts`** so `library/mediaStore.ts` could sit where
  the contract names it; TypeScript would have resolved `./library` to the file over the folder,
  which is a trap for the next reader.

- **⌘K is derived, never indexed.** The vault index died with markdown; the catalog is one walk of
  the tree the Sidebar already holds, which the structural watcher already refreshes. Nothing new
  subscribes, nothing new reads the disk, and a drawing created a second ago is findable.
- **Lazy, but latched.** A vault is opened far more often than it is searched, so the catalog is
  not built until the first non-empty query — and once built it stays, or the second query would
  pay for the walk again. The latch is written during render on purpose: an effect would show one
  empty frame of results on the very first keystroke.
- **The file association has THREE doors, not one.** macOS fires `open-file`; Windows and Linux
  put the path in argv and fire nothing — in this process's argv on a cold launch, in the
  `second-instance` argv when the app is already up. All three encode to `yaseendraw://` so the
  routing, the kind guard and the exists guard are written once.
- **`focusContainer()` is not on the engine's imperative handle.** It lives on the App class; the
  seam does what it does — focus the engine's own `.excalidraw-container`, the element it gives a
  `tabIndex` for exactly this.
- **The new drawing's rename field needs the tree to have caught up.** The birth refreshes the
  tree and then marks the new path as renaming; the field mounts when the row does. Fine in
  production (the refresh is awaited by the render), and the reason the test has to grow the
  mocked tree.

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
- **Branch:** `yaz-1775-phase-3` (off `main`, after the phase-2 merge).
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
