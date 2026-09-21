# Yaseen Draw — contracts

The one document an agent should read before changing anything. It states what is true about the
app's shape — layout, bridge, state, menus, windows, links, packaging — not how any one feature is
implemented. Prose here is normative; where it disagrees with the code, the code is a bug.

**Convention.** 🔒 marks a decision that is LOCKED: it was argued once, on the Linear issue named
beside it, and must not be re-litigated in passing — reopen it on the issue or leave it alone. ⚡
marks an amendment to an earlier locked decision; the amendment wins.

> Yaseen Draw is the drawing sibling of Yaseen Docs. It was seeded from `yaseen-docs-app`
> @ `66c9806` (🔒 D1 on YAZ-1775) and then stripped of every subsystem the canvas does not need
> (YAZ-1808).
> Git history before the seed lives in that repo, not this one.

## Repo layout

| Path | What it is |
|---|---|
| `client/` | the renderer: React 19, Vite. Talks to nothing but `window.yaseenDraw`. |
| `client/src/drawings/` | the engine seam — `<Excalidraw>` mount, scene read/write, assets |
| `client/src/sidebar/` | the file tree, its context menu, rename/move/trash, favorites, vault switcher |
| `client/src/tabs/` | the tab strip |
| `client/src/workspace/` | the tab model (`tabsReducer`) and its per-tab history |
| `client/src/settings/` | the settings dialog and its registry |
| `client/src/search/` | ⌘K title search and the one ranking matcher |
| `client/vendor/` | the five vendored `yaseendraw-*-<forkCommit>.tgz` engine tarballs (🔒 D2) |
| `desktop/` | the Electron shell: `src/main` (files, state, windows, menu, git sync), `src/preload` (the bridge) |
| `shared/` | types and pure helpers imported by BOTH sides (`@shared/*`) |
| `tools/` | `packEngine.mjs` (bump the vendored engine), `packDesktop.mjs` (electron-builder) |
| `docs/` | this file |
| `thoughts/ledgers/` | continuity ledgers for in-flight work |

### Scripts

| Command | What it does |
|---|---|
| `npm install` | installs the workspaces and unpacks the vendored engine tarballs |
| `npm run dev` | `electron-vite dev` in `desktop/`: main + preload built, renderer served with HMR |
| `npm test` | vitest, three projects — `client` (jsdom), `desktop` (node), `tools` (node) |
| `npm run typecheck` | `tsc --noEmit` over client, shared and desktop |
| `npm run build` | `electron-vite build` into `desktop/out` |
| `npm run desktop:build` | build + electron-builder → `desktop/dist-app` (`--win` variant for Windows) |

There is no e2e script. 🔒 (OD1 on YAZ-1805, resolved by Yasin at execution start): behaviour is
verified by launching the dev app in an isolated profile against a test vault and running a
scenario list by hand — never by a UI driver, by an agent or in CI.

## Supported file capabilities

One kind, one extension.

| Extension | Kind | Read | Write | Create |
|---|---|---|---|---|
| `.excalidraw` | `drawing` | yes | yes | yes |
| anything else | `null` | no | no | no |

- `shared/fileKind.ts` is the ONE classifier: `fileKind(name)` returns `'drawing'` or `null`, and
  `isDrawing` / `isSupportedFile` / `canRenameWithoutConversion` are derived from it. No surface
  may re-test an extension by hand.
- A file of no kind still LISTS in the tree (YAZ-1577) and opens in the OS default app; it is
  never read or written through the bridge (`UNSUPPORTED_EXTENSION`).
- `.excalidraw` hides its extension wherever a name is shown — tree rows, tab labels, the window
  title, the rename field (⚡ D8 amended on YAZ-1775). Every other file shows its full name.
- Image bytes do NOT live in the scene JSON: they are content-addressed under `<vault>/assets/`
  (🔒 D3 on YAZ-1775), served through the asset pipe (`fs:read-asset` / `fs:write-asset`).
- At the close of YAZ-1808 the document pane is a dispatcher with nothing to dispatch to:
  `client/src/Editor.tsx` renders "Select a file from the sidebar." with no file, "Unsupported
  file type." for a `null` kind, and an empty pane for a drawing. YAZ-1809 (2D) mounts the canvas.

## Bridge API

The renderer is sandboxed (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
Its ONLY door to the machine is `window.yaseenDraw`, defined by `desktop/src/preload/index.ts`
over the channels in `desktop/src/channels.ts`, typed by `YaseenDrawApi` in `shared/types.ts`.
Every `ipcMain.handle` answers with an `Envelope<T>`: `{ ok: true, value }` or
`{ ok: false, error }` carrying a structured `BridgeError` (`code`, `message`, optional `path` /
`mtime`), which the preload rethrows and `client/src/api.ts` wraps as `BridgeRequestError`.
Electron flattens a thrown Error to its message, which is why failure travels as data.

| `window.yaseenDraw` | Channel | What it does |
|---|---|---|
| `tree(root)` | `fs:tree` | the folder tree; dot-entries and `node_modules` are invisible |
| `readFile(path)` | `fs:read` | UTF-8 bytes of a supported file, with `mtime` + `size` |
| `writeFile(req)` | `fs:write` | atomic write (tmp + rename); `expectedMtime` rejects `CONFLICT` |
| `createDir(path)` | `fs:create-dir` | never overwrites (`ALREADY_EXISTS`) |
| `createFile(req)` | `fs:create-file` | `.excalidraw` only; content-at-create, `wx` flag |
| `readAsset(root, ref)` | `fs:read-asset` | an image or scene under the vault, base64 + mime |
| `writeAsset(req)` | `fs:write-asset` | atomic asset write with the same mtime guard |
| `pickFolder()` | `dialog:pick-folder` | the native open-directory dialog |
| `watch(root, cb)` | `watch:*` | chokidar under the root; `ready` / `change` / `add` / `unlink` / `error` |
| `file.rename(req)` | `fs:rename` | same-parent rename or a move; never overwrites |
| `file.delete(req)` | `fs:delete` | `shell.trashItem` ONLY — never `fs.rm`, no permanent fallback |
| `file.clip` / `paste` / `clipState` | `fs:clip*`, `fs:paste` | main owns the ONE app-wide file clipboard |
| `file.onRenamed` / `onDeleted` / `onClipChanged` | `file:*`, `clip:changed` | pushes to EVERY window |
| `shell.reveal` / `openVsCode` / `openDefault` / `openLink` | `shell:*` | OS hand-offs |
| `state.get` / `setSettings` / `setSidebarWidth` / `pushRecent` / `removeRecent` / `setFolder` | `state:*` | the app state file |
| `state.onChange` | `state:changed` | a change in any window replaces the cache in all of them |
| `window.identity` / `setIdentity` | `window:*` | THIS window's `WindowEntry`, by the `?win=<id>` in its URL |
| `window.open` / `duplicate` / `openRecent` / `closeSelf` / `zoom` | `window:*` | window lifecycle |
| `window.onFlush` | `app:flush` / `app:flushed` | the close/quit handshake (main waits, 5s cap) |
| `menu.on*` | `menu:*` | Open Folder…, Open Recent, Search Vault, Switch Vault…, Settings…, Toggle Sidebar, Close Tab, Next/Previous Tab |
| `link.onOpenFile` / `onNotice` | `link:*` | a routed `yaseendraw://` link |
| `favorites.get` / `set` / `onChanged` | `favorites:*` | `<vault>/.yaseendraw/favorites.json` |
| `vaultConfig.read` / `write` / `onChanged` | `vaultConfig:*` | any file in `<vault>/.yaseendraw/` |
| `github.status` / `syncNow` / `setEnabled` / `onStatus` | `github:*` | per-vault GitHub sync |

Rules that hold across the whole surface:

- **Main owns the disk and the state file.** The renderer never touches either directly.
- **Never overwrite.** Create and rename use `wx` / exclusive semantics; a collision is
  `ALREADY_EXISTS`, not a silent clobber.
- **Atomic writes.** Every write is tmp-file + rename, so a crash cannot truncate a drawing.
- **Echo suppression by mtime.** A write's own watcher event is recognised by the mtime the write
  returned and ignored; a genuine external change while the buffer is dirty raises the conflict bar.
- **No path jail** (out of scope, below): anything under the user's account is reachable.

## App state schema

ONE user-global JSON file, owned by the main process:
`~/Library/Application Support/Yaseen Draw/yaseendraw.json`
(`YASEEN_DRAW_USER_DATA_DIR` overrides the directory — that is how an isolated profile is made).
Nothing is ever stored in the browser profile. `desktop/src/main/store.ts` loads it field by field:
anything unrecognised or malformed falls back to its default rather than failing the launch.

```ts
AppState {
  version: 1
  settings: { theme: 'system' | 'light' | 'dark'; confirmDelete: boolean }
  sidebarWidth: number                     // clamped to [180, 520]
  recents: { path: string; lastOpened: number }[]   // MRU, max 10
  windows: WindowEntry[]
  folders: Record<string /* vault root */, FolderState>
}

WindowEntry {
  id: string
  root: string | null                      // null = the Welcome screen
  file: string | null                      // doubles as the ACTIVE tab
  tabs: string[]                           // absolute, de-duplicated, left→right
  sidebarCollapsed: boolean
  sidebarLens: 'files' | 'favorites'       // ⚡ D8 amended; an unknown value reads as 'files'
  focusDirs: string[]                      // Focus Mode, Files lens
  focusFavorites: string[]                 // Focus Mode, Favorites lens
  bounds: { x, y, width, height }
}

FolderState {
  expanded: string[]                       // SESSION only: never written to disk (YAZ-1642)
  lastFile: string | null
}
```

Invariants: `file ∈ tabs` whenever `file` is non-null, and `tabs: []` ⇔ `file: null`.
`sidebarCollapsed`, `sidebarLens` and both focus lists are WINDOW identity — a duplicate inherits
them by value and then diverges; a global `state:changed` broadcast never moves another window's.
Settings and `sidebarWidth` are global and every window follows a change live.

Two things live in the VAULT instead, because they are the user's own data:
`<vault>/.yaseendraw/favorites.json` (YAZ-1794: vault-relative paths, so favorites travel with the
vault) and `<vault>/.yaseendraw/github.json` (the per-vault sync switch). Nothing else is ever
written into a vault except the drawings and `assets/`.

To reset or hand-edit the state file: **quit the app first** (⌘Q flushes it), then edit or delete
the JSON. A missing file launches one empty window.

## Menus and shortcuts

The application menu is a pure function of its inputs (`desktop/src/main/menu.ts`
`buildMenuTemplate`), so its structure and accelerators unit-test without Electron. Item ids are
stable. A menu action targets the OS-focused window, else the most recently focused live window
(GRO-2197: macOS reports no focused window while the app is not frontmost, and a menu item must
never silently do nothing).

| Menu | Item | Key |
|---|---|---|
| Yaseen Draw | Settings… | ⌘, |
| File | New Window | ⌘⇧N |
| File | Switch Vault… | ⌘O |
| File | Open Folder… | ⌘⇧O |
| File | Open Recent ▸ | — (⌥-click an entry opens it beside this window) |
| File | Search Vault | ⌘K |
| File | Close Tab | ⌘W |
| File | Close Window | ⌘⇧W |
| Edit | Undo / Redo / Cut / Copy / Paste / Select All | stock roles |
| View | Toggle Sidebar | — |
| View | Reload · Toggle Developer Tools (dev builds) | — |
| View | Actual Size / Zoom In / Zoom Out | ⌘0 / ⌘+ / ⌘− |
| Window | Minimize · Zoom · Next Tab · Previous Tab · Bring All to Front | ⌃Tab / ⌃⇧Tab (⌘⇧] / ⌘⇧[ alternates) |
| Help | Yaseen Draw on GitHub | — |

Zoom is deliberately NOT the stock roles: a registered accelerator never reaches the page on
macOS, so main applies the step to the focused window's `webContents` itself.

Renderer-owned chords (`client/src/lib/*Hotkey.ts`, all gated by `ownsWindowChord` so a text field
or an open modal keeps the key): ⌘B toggles the sidebar (YAZ-1280); ⌘X / ⌘C / ⌘V drive the
sidebar's file clipboard when the selection owns them. Settings › Hotkeys lists every one of them and is the
single place that copy lives.

The right-click menu inside the renderer is Electron's (`buildContextMenuTemplate`): spelling
suggestions, Add to Dictionary, and cut/copy/paste. Electron ships no default one, which is why
this exists at all.

## Multi-window

`desktop/src/main/windows.ts` owns the lifecycle; `main/index.ts` is its Electron-only half.

- Every window is one `WindowEntry`; the renderer learns which one it is from `?win=<id>` in its
  URL and asks `window.identity()`.
- ⌘⇧N duplicates the focused window — same folder, same file, same tabs, cascaded bounds — and
  the copy then diverges.
- Windows and their tabs are restored on relaunch; bounds are clamped to a live display, so a
  window from a disconnected monitor comes back on screen.
- Closing runs the flush handshake: main holds the window open, pushes `app:flush`, and waits for
  `app:flushed` (5s cap) so an in-flight autosave lands before the process lets go. ⌘Q does the
  same for every window, then writes the state file.
- One running instance. A second launch focuses the first; a `yaseendraw://` URL in its argv
  routes instead of focusing.

## Links

`yaseendraw://` is path-only, absolute and percent-encoded:
`yaseendraw:///Users/me/vault/Board.excalidraw`, with an optional `?root=` (also a percent-encoded
absolute path) naming the vault the link should open under. `shared/links.ts` owns the one
encoding, so main's parser and the renderer's generator cannot drift; `#` and `?` are encoded on
top of `encodeURI` because either would truncate the path on parse.

Main routes a link to the best window — one already on that vault, else the focused one, else a
new one — and the renderer then treats it exactly like a sidebar click (activate the tab if the
file is already open, else open it in the current tab). A link that cannot be opened shows the
window's one passive notice; never a dialog. macOS delivers links through `open-url`, which fires
before `ready` on a cold start, so they queue (`main/linkQueue.ts`) until the windows exist.

The packaged app registers the scheme (`protocols` in `desktop/package.json`) and claims
`.excalidraw` as an Owner file association.

## Packaging

`npm run desktop:build` runs `electron-vite build` and then electron-builder through
`tools/packDesktop.mjs`.

- appId `com.yasinarshad.yaseendraw`, productName **Yaseen Draw**, icon from `desktop/build/`.
- macOS: arm64 `dmg` + `dir`, `identity: null` — ad-hoc signed by `desktop/build/adhocSign.cjs`,
  never Developer-ID signed or notarized (out of scope).
- Windows: unsigned x64 NSIS installer.
- `files: ["out/**"]` is the whole payload: the main bundle carries its dependencies (chokidar is
  pure JS and gets bundled), so the packaged app ships no `node_modules`.
- The renderer serves from the custom `app://yaseen/` protocol; Excalidraw's fonts are copied
  beside the bundle at build time so a scene with text never reaches a CDN (🔒 the offline rule).
- `.github/workflows/release.yml` builds both on a `v*` tag and attaches them to the release.

Bumping the vendored engine is `node tools/packEngine.mjs --commit <sha>` followed by `npm ci` —
see `client/vendor/README.md` for the two traps that script exists to defuse.

## Out of scope (locked)

No browser mode — the app runs only inside Electron. No path jail in the file layer. No
Developer-ID signing or notarization, no auto-update, no Intel or universal builds. No end-to-end
UI-driver suite, by agents or in CI.
