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
- **🔒 D7 — CI: typecheck + unit tests on every PR** (macos-latest, node 22 since `94f52ff`; release workflow kept, artifact names renamed).
- **🔒 D8 — Panels live in the sidebar, toggles live on the rail** — superseded by **⚡ D8 amended — two sidebars, two jobs** (shell sidebar = Files + Favorites; Images / Components / Present = the web app's in-canvas docked panel).
- **🔒 D9 — Theme and canvas preferences are user-level, stored in the shell settings** (`SettingsState.canvas`; per-board = only what the engine writes into the file; diff-before-write both directions).
- **🔒 D10 — The canvas hamburger opens the canvas panel; no canvas main menu** (Export image → File ⌘⇧E; Canvas background → View; both enabled only on a drawing tab).
- **⚡ Round 4/5 — one toolbar only:** the fork's `full` desktop mode (`ContextualPropertiesToolbar`), `YASEEN_FULL_TOOLBAR_MODE = 'full'` written before every mount; `UIOptions.getFormFactor` never returns `tablet`.
- **✅ Demo approved — decision index and scenario record** is the map for any future agent; its scenario list is the regression list for 4A/4B.

## State

Everything up to and including 5B is done and merged or on `yaz-1775-phase-4-5`. What is left is
Yasin's to run — the behaviour proofs — plus one install check.

- Now: [→] 4A — Prove the image-heavy board round trip through quit, relaunch, sync and clone (YAZ-1823) — **Yasin runs it**
- Remaining:
  - [ ] 4B — Prove windows, tabs, favorites, vault switcher and same-board-in-two-windows (YAZ-1824) — **Yasin runs it**
  - [ ] 4C — Prove Image Studio, Components and Present online and offline (YAZ-1825) — **Yasin runs it**
  - [ ] 4D — install check: the `v0.1.0` DMG installs and opens a `.excalidraw` from Finder (YAZ-1826 is Done for the
        workflow and the local build; 🔒 tag on Yasin's word only — no tag, no GitHub release, no `npm version` from an agent)

The scenario list to run against is the "✅ Demo approved" comment on YAZ-1775.

<details><summary>Done (phases 1–3, 5)</summary>

- [x] 1A — File map, rename list, engine parity checklist (YAZ-1805)
- [x] 2A — Seed the repo from docs-app and rename to Yaseen Draw (YAZ-1807)
- [x] 2B — Strip the markdown-only subsystems, delete never hide (YAZ-1808)
- [x] 2C — Re-pack the engine at `e72242f8` and add `packEngine` (YAZ-1809)
- [x] 2D — Make `.excalidraw` the document: load, save, autosave, conflict, chips (YAZ-1810)
- [x] 2E — Image store: `assets/`, hydrate, extract, orphan sweep (YAZ-1811)
- [x] 2F — Canvas chrome: rail, panel shell, menus, full toolbar, parity checklist (YAZ-1812)
- [x] 2G — Settings: canvas preferences, Library folder, trims (YAZ-1813)
- [x] 2H — ⌘K search over the drawing catalog (YAZ-1814)
- [x] 2I — New drawing, naming, extension display, file association (YAZ-1815)
- [x] 3A — Library folder and secrets plumbing (YAZ-1817)
- [x] 3B — Images tab: Image Studio with main-process providers (YAZ-1818)
- [x] 3C — Components tab: Saved Components as library files (YAZ-1819)
- [x] 3C1 — Import JSON into the components library (YAZ-1833)
- [x] 3D — Present tab: presentation sidebar and player (YAZ-1820)
- [x] 3E — Export menu: PNG, SVG, standalone `.excalidraw` (YAZ-1821)
- [x] 4D — Release workflow verified and a local DMG built (YAZ-1826)
- [x] 5A — Audit the change set and scope the polish, comment only (YAZ-1828)
- [x] 5B — Apply the audit: simplify, finalize, docs, ledger, cleanup (YAZ-1829)

</details>

## Open Questions

None open. The one that was — where a drawing outside EVERY open vault opens (posted on YAZ-1815)
— is RESOLVED as built: a NEW window rooted at the file's parent folder, rather than repointing the
focused window's vault and discarding its tabs. Documented at `docs/CONTRACTS.md` § Links.

## Learnings (phases 2 and 3)

- **A save dialog and its write are ONE door.** Splitting them would hand the renderer an arbitrary
  absolute path it may write to, which is exactly what the fs layer's root-relative rules exist to
  prevent. `dialog:save-file` shows the sheet and does the atomic write in the same call, and
  re-checks the extension afterwards because a name can be typed freely into a sheet.
- **Export reads the ENGINE's files map, not the store's.** The store knows what is in `assets/`;
  only the engine holds that plus everything pasted or inserted and not yet saved. An export off
  the store would silently drop the second half.
- **Filter the deleted elements' bytes yourself, even though the engine does too.** An undo leaves
  an image's bytes in the map long after its element is gone; `referencedFileIds` is the same rule
  the save path uses, so the two can never disagree, and `serializeAsJSON(…, 'local')` filtering
  again is idempotent redundancy rather than a second opinion.
- **The player cannot live in the tab that starts it.** A `Sidebar.Tab` body is unmounted the
  moment the panel closes, and closing the panel is the FIRST thing Play does. So `Play` goes up
  to `ExcalidrawSurface`, which mounts the player as a sibling of `<Excalidraw>`.
- **`body` classes do not survive a multi-tab shell.** The web app hid the editor chrome with a
  class on `document.body`; here that would hide the chrome of every mounted tab, so the classes go
  on `.drawing-surface` and the CSS is scoped to it. Same for the camera reserve: a fraction of the
  PANE, not of `window.innerWidth`, because a file sidebar sits beside the canvas.
- **A document-wide listener needs the frontmost test.** The canvas holds the keyboard while
  presenting and it is not inside the overlay, so the key and double-click handlers stay on
  `document` — gated on the overlay not being inside a `.tabstack__layer--hidden`, which is
  `drawingCommand.ts`'s own test one layer down.
- **The order is a request, not a guarantee.** The file is user data: two frames can claim slot 2
  and a frame can claim slot 9 of a three-slide deck. Only an unambiguous, in-range claim takes its
  slot; the rest fill the gaps in scene order, so the deck is always 1..n with no holes.
- **A fake engine has to close its own loop.** The panel re-derives from `onChange` rather than
  being optimistic, so a test double whose `updateScene` does not fire `onChange` shows a stale
  list — and pins the wrong behaviour if you assert on the scene instead.
- **Dropping the animation stack is not dropping the transition token.** The lifecycle event went
  with its only subscriber, but the token, the `isTransitioning` state and the "no landing while
  the deck is zoomed out" rule are the camera behaving itself and stayed.
- **A native dialog is the only place an arbitrary path may be read.** Import JSON needed the bytes
  of a file OUTSIDE the vault, and the bridge has no read-any-path door. Rather than open one,
  `dialog:open-file` reads what the user has just picked, bounded by `MAX_DRAWING_BYTES` and
  re-checked for the extension (a filter is defeated by typing a name) — so the door's reach is
  exactly one native gesture wide.
- **`parseImportedComponentJson` ported with its one flag inverted.** The web app passed
  `allowImages: false` because an imported payload had no bytes in its object store; a picked
  `.excalidraw` carries its own `files` map, so images are kept and travel into the fragment. The
  envelope table, the restore, the deleted filter and the size ceiling are verbatim.
- **A refusal that writes nothing is a PASSIVE notice.** `role="status"` for the import, not the
  tab's assertive `role="alert"` — the error line means "your save failed", the notice means
  "nothing happened".
- **A preview settles on a TASK.** `FileReader` is how the blob becomes a dataURL, so a test that
  flushes one turn records the call against the NEXT test under full-suite load; the import tests
  poll until the call lands.
- **The folder is the truth; the index is a cache.** `components.json` is rebuilt from
  `<library>/components/` on every read — adopted, dropped and repaired — not just when it is
  missing. That is what makes a component arriving through a synced folder, or a file deleted in
  Finder, simply correct with no repair step anywhere. And a READ NEVER WRITES: the reconciliation
  is in memory, so listing a library costs a read-only disk nothing.
- **A component embeds its images; a board does not.** 🔒 D3 keeps bytes OUT of scene JSON, and
  🔒 D5 puts them INSIDE a component — not a contradiction: a board lives in the vault beside its
  `assets/`, a component has to insert into a vault it has never seen. The two meet on insert: the
  embedded bytes are handed to the canvas, and 2E's `unpersistedFiles` turns them into THIS vault's
  assets on the next save, deduped by `fileId`.
- **The slug is the identity, the name is the label.** The web app's identity was a Convex `_id`;
  a folder can only carry a filename. So a rename moves no file, and the slug is validated as a
  path segment (lowercase words, single hyphens) rather than trusted — the `isValidFileId` posture.
- **Echo suppression needs one entry per FILE when a mutation writes three.** `mediaStore` drops
  its own watcher event by the single file's mtime; a component save writes a fragment, a preview
  and the index, so the map is path → mtime (and → null for a trash). The watcher's filter is what
  keeps `atomicWrite`'s tmp files out of it: only `<slug>.excalidraw`, `<slug>.png` and the index.
- **Chokidar loses a subfolder created during its own initialisation** (polling), which is the
  `mediaStore` note one level down: `components/` may be made by the first save. Re-adding it once
  on `ready` is the recovery, and it costs nothing when the folder is not there yet.
- **The selection is read off `onChange`, not off an engine hook.** The web app's `useUIAppState()`
  would have made the tab engine-bound and untestable; `ExcalidrawSurface` already sees every
  appState, so `hasSelection` is a boolean prop — and because it is a boolean, the memoized panel
  is re-made only when it actually flips.
- **Search is the app's ONE matcher.** The library is a folder of small files, so it is listed
  whole and ranked in the renderer through `search/matchCandidates.ts` — the same function ⌘K uses.
  A second search implementation would have been a second answer to the same question.

- **The library store is `vaultConfig.ts` with one file.** Same shape end to end: lazy read, tmp +
  rename write, one chokidar, own-write echo dropped by mtime, external edit debounced — which is
  why 5B pulled all three into `main/watchedFolder.ts`. The one new idea is that `media:changed`
  has NO payload: every window re-lists whichever vault it is on, because the library is one file
  for all of them (🔒 YAZ-1775 D5's whole point).
- **Watch the folder, not the file, at depth 0.** Tests run chokidar in polling mode, which loses a
  path that appears during its initialisation; the folder exists from startup (`ensureLibraryFolder`)
  where `media.json` does not. Depth 0 keeps `components/` and the tmp files out of it; the
  re-anchor covers the folder that was unplugged at launch. A folder that does NOT exist yet needs
  no depth at all, or chokidar never notices it appearing — which is why `vaultConfig` omits it.
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
- **`curateIconifyResults` was dead in the Worker too**, and porting it anyway was a mistake 5A
  caught: unreachable code with an argument for its own existence is still unreachable code. It is
  deleted, and the ranking rule lives on YAZ-1818 where a reader can find it without a grep.
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
  `unpersistedFiles` (YAZ-1811) is what turns that into an `assets/` file, and the insert test
  asserts it with that very function.
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
- **Register rename-continuity from the canvas too.** Without `retire()`, closing the tab of a deleted board flushes on unmount and resurrects the file. There is nothing to CARRY — the pre-rename flush already put the scene on disk — which is why 5B collapsed the whole dirty-buffer machinery to a retire.
- **`stripEmbeddedFiles` must be byte-stable on a lean scene**, or every untouched save rewrites the file and churns the vault's git history.
- **The sweep's age guard is the whole safety property.** Unreferenced is not enough — a paste lands in `assets/` before the board that names it is saved.
- **The real-git flake, answered (5A/5B).** `git/{sync,guarantees}.test.ts` timed out under
  full-suite load because they spawn real `git`. `62c21bc` raised the ceiling project-wide, which
  papered over it; 5B scoped it instead — `REAL_GIT_TIMEOUT_MS` on those two describes only, so
  the other 57 desktop files keep vitest's 5 s default — and replaced the wall-clock assertion in
  the flush test (which flaked for the very reason the ceiling was raised) with the guarantee it
  stood in for.

- **The packaged bundle is the only proof that the names took.** `plutil -p` on the packed
  `Info.plist` is what says `CFBundleName`/`CFBundleDisplayName` "Yaseen Draw", `CFBundleIdentifier`
  `com.yasinarshad.yaseendraw`, the `yaseendraw` URL scheme and the `.excalidraw` document type at
  rank `Owner` — the builder config only says what was ASKED for. `spctl` rejecting the ad-hoc
  bundle is the expected result, not a regression; `codesign -dv` printing `Signature=adhoc` is the
  one that has to hold.

## Learnings (5B, the audit applied)

- **A door nothing opens is a door aimed at something.** `fs:read` / `fs:write` were dead end to
  end, and `fs:write` was gated to `.excalidraw` — a second writer for exactly the bytes
  `drawing:save` owns, with none of its rules about images. Unused is not harmless when the unused
  thing contradicts a contract.
- **A test that supplies the behaviour it verifies proves the mock.** `renameContinuity.test.ts`
  passed its own `capture: () => ({ body: 'dirty body' })` while the one real registrant returned
  null; `hotkeys.test.ts` froze the missing ⌘⇧S into its expected set; `curation.test.ts` was the
  only caller of the code it covered. Three different shapes of the same mistake.
- **Sparse arrays do not `map`.** `Array(n)` then `slots.map` skips the very holes the fill loop
  exists to fill. `Array.from(slots, …)` visits them.
- **An optimistic write needs a revert or it needs to not be optimistic.** The component rename
  wrote the new name into the grid before awaiting the store and never put it back, so a refusal
  left the new name on the card beside an error naming the old one. Taking the STORE's answer is
  both simpler and correct.
- **`slice(lastIndexOf('.'))` is `slice(-1)` when there is no dot.** `renamedPath('/v/README',
  'NOTES')` gave `/v/NOTESE`. Every tree row offers Rename, so every extensionless file in a vault
  was exposed.
- **A default that wipes is a landmine with a fuse.** `tools/seedDemoVault.mjs` defaulted `--vault`
  to the live 4A vault and `rmSync`'d it, force, no prompt — two lines under a header saying never
  to point it at a real vault. A destructive script gets no defaults.
- **`git add -A` stages what the OS drops.** Finder's `.DS_Store` was committed, pushed and named
  in the commit subject. The fix belongs before the staging, is append-only in the user's own
  `.gitignore`, and has to untrack what earlier passes already committed or it changes nothing for
  the vault that has them.
- **A label that names no issue cannot be looked up.** 304 🔒 labels, 200 of them bare, drawn from
  three decision namespaces — `App.tsx` carried two different `D1`s a hundred lines apart. The
  convention was only ever usable because one person remembered which was which.
- **A `FileReader` in the path makes a test settle a TASK late.** Two `SavedComponents` cases
  passed alone and failed under full-suite load, and one of them recorded its save against the
  NEXT test. The fix is the file's own `settle()` helper, plus clearing the spy after the setup
  click — not a longer timeout.
- **An in-file copy of a document drifts from it.** The parity checklist was 171 lines duplicating
  a Linear comment named as its own source of truth, and had drifted three ways in three phases.
  The file keeps the short true list; the record stays where it was written.

## Working Set

- **Repo:** `/Users/yasin/Documents/GitHub/yaseen-draw-app` (remote `origin` = `https://github.com/yaseenarshad/yaseen-draw-app.git`).
- **Branch:** `yaz-1775-phase-4-5` (off `main`, after the phase-3 merge) — PR #3.
- **Worktree:** `/Users/yasin/Documents/GitHub/yaseen-draw-app-port` — do all work here.
- **Test vault:** `~/Desktop/Port to Electron App - Local Version/` (plus `(origin).git` beside it for sync proofs);
  regenerate with `node tools/seedDemoVault.mjs --vault <dir> --force`.
- **Read-only references:** `yaseen-docs-app` @ `66c9806` (shell source), `yaseen-excalidraw` @ `e72242f8`
  (engine + `public/favicon.svg` + `docs/yaseen-whiteboard-icons.md`).
- **Commands:**
  ```sh
  npm ci
  npm run typecheck
  npm test          # vitest, 3 projects: client jsdom, desktop node, tools node
  npm run build     # electron-vite build into desktop/out
  # there is no e2e script: Playwright was deleted in YAZ-1808 (OD1)
  ```

## Cleanup after 4A

Yasin is still using the test vault, so none of this is deleted yet. When 4A/4B/4C are signed off:

- `~/Documents/GitHub/yaseen-docs-app-draw-demo` — the prototype worktree (`git worktree remove`),
  and its branch `demo/yaz-1775-draw-prototype` in `yaseen-docs-app`.
- `~/Desktop/Port to Electron App - Local Version/` — the seeded test vault.
- `~/Desktop/Port to Electron App - Local Version (origin).git` — its bare origin.
- `/tmp/draw-profile` (or whichever `YASEEN_DRAW_USER_DATA_DIR` the checks used) — the isolated profiles.

Verify with `git worktree list` and `ls ~/Desktop`.

## Closeout (2026-09-22)

- YAZ-1775 closed: phases 1–5 merged to `main` via PRs #1 (`e85c89d`), #2 (`51e21b1`), #3 (`1c28130`). 4A/4D verified by Yasin in daily use on `~/Documents/GitHub/yaseen-draw-vault`.
- First release: `v0.1.1` (tag pushed from `main`; `.github/workflows/release.yml` builds the DMG/EXE). Later releases: Yasin batches them; bump with `npm version` on main only when he says so.
- Full handoff for a future agent: the "Handoff" comment on YAZ-1775 (mirrored on the phase parents).
- Cleanup done: prototype worktree `yaseen-docs-app-draw-demo` + branch `demo/yaz-1775-draw-prototype` removed; `yaseen-draw-app-port` worktree and the three `yaz-1775-*` branches removed (all merged); demo vault + bare origin on the Desktop and the scratchpad profiles deleted. `tools/seedDemoVault.mjs --vault <dir>` regenerates the test vault.
- Follow-ups live as their own issues: YAZ-1834 (board metadata), YAZ-1835 (sidebar sort), YAZ-1800 (previews), YAZ-1830 / YAZ-1831 (Future).

## YAZ-1842 (2026-09-22) — Pixabay key storage

- 🔒 YAZ-1842 D1 amends YAZ-1775 D4: `secrets.json` is plain text, mode 0600, `version: 2`; `safeStorage` removed (ad-hoc-signed builds are new Keychain identities per release, so a key saved by 0.1.0 was unreadable by 0.1.1). Version-1 files are quarantined; the next paste starts clean. `ENCRYPTION_UNAVAILABLE` gone from the contract.
- Shipped in v0.1.2.
