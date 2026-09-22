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
| `client/src/drawings/` | the drawing document: the engine seam (`ExcalidrawSurface`, the ONE importer of the package), its host, and what a scene is |
| `client/src/drawings/presentation/` | the canvas panel's Present tab: the slide rules, the panel and the full-pane player |
| `client/src/media/` | the canvas panel's Images tab: the Image Studio, the shapes catalog, both insert paths |
| `client/src/components-library/` | the canvas panel's Components tab: the saved-component library, its capture, import, preview and insert (named so it is never confused with `client/src/components/`) |
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
- Image bytes do NOT live in the scene JSON: they are content-addressed at
  `<vault>/assets/<fileId>.<ext>` (🔒 D3 on YAZ-1775) and travel with the scene through
  `drawing:load` / `drawing:save`. The id is Excalidraw's own — the SHA-1 of the bytes — so an
  asset is immutable, rename-proof and shared by every board that uses the picture. The scene is
  always written with `files: {}`; a legacy file that still embeds its images is extracted on its
  first save. `assets/` is hidden from the sidebar tree (the TOP-LEVEL one only: a folder the
  user called `assets` inside a subfolder is theirs and shows).
- There is ONE door that makes a drawing, and it is the sidebar's context menu (🔒 R1 on
  YAZ-1775): the Create group is **New drawing**, New folder, New dated folder, in that order, on
  a row or on blank space. Nowhere else in the app creates a file.
  - "New drawing" does not ask for a name. The board is born `Untitled.excalidraw` — then
    `Untitled 2`, `Untitled 3`… beside its siblings, filling a gap rather than running past it,
    compared case-insensitively because the filesystem is — in the right-clicked FOLDER (a file
    row means its parent, blank space means the vault root).
  - It is written with the `EMPTY_SCENE` in the same `wx` write (content-at-create), never
    overwriting: a name lost to a race retries with the next number.
  - It then opens in the CURRENT tab and lands with the tree's inline rename field focused, so the
    first thing typed is its name.
- A `.excalidraw` has ONE door per direction (🔒 YAZ-1810): `drawing:load` and `drawing:save`.
  Not `fs:read` / `fs:write` (a text buffer capped at 10 MiB), and not the image pipe — which
  stopped accepting drawings in YAZ-1810, because a second writer with different rules about the
  scene's images is a race with no upside. `fs:create-file` is the one exception and only for
  BIRTH: "New drawing" writes the empty scene with the file, under `wx`.
- `client/src/Editor.tsx` dispatches on the kind: "Select a file from the sidebar." with no file,
  "Unsupported file type." for a `null` kind, and `DrawingEditor` for a drawing.

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
| `drawing.load(req)` | `drawing:load` | one `.excalidraw` AS A DOCUMENT: its bytes, its mtime, and the images it names |
| `drawing.save(req)` | `drawing:save` | images first, then the scene, atomically; `expectedMtime` → `CONFLICT` with NOTHING written |
| `drawing.libraryFolder()` | `drawing:library-folder` | the RESOLVED library folder — the setting, or `<userData>/library` (🔒 D5) |
| `pickFolder()` | `dialog:pick-folder` | the native open-directory dialog |
| `dialog.openDrawing()` | `dialog:open-file` | the native OPEN-FILE dialog, `.excalidraw` filter → `{ path, name, content }` or `{ cancelled: true }`; the bytes come back because the picked file is outside the vault |
| `dialog.saveDrawing(req)` | `dialog:save-file` | the native SAVE sheet AND the atomic write behind it → `{ path }` or `{ cancelled: true }`; the only path ever written is the one the user just typed |
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
| `menu.on*` | `menu:*` | Open Folder…, Open Recent, Search Vault, Switch Vault…, Settings…, Toggle Sidebar, Close Tab, Next/Previous Tab, Export Image…, Export Drawing…, Canvas Background |
| `link.onOpenFile` / `onNotice` | `link:*` | a routed `yaseendraw://` link |
| `favorites.get` / `set` / `onChanged` | `favorites:*` | `<vault>/.yaseendraw/favorites.json` |
| `media.favorites(req)` | `media:favorites` | `{ op: 'list' }` · `{ op: 'add', item }` · `{ op: 'remove', itemKey }` over `<library>/media.json` (🔒 D5); every verb answers the resulting list |
| `media.recent(req)` | `media:recent` | `{ op: 'list' }` · `{ op: 'record', item }` — the MRU, `RECENT_LIMIT` 60 |
| `media.onChanged` | `media:changed` | pushed to EVERY window when `media.json` changes — any vault, any writer, no payload |
| `media.search(req)` | `media:search` | `{ q, source: 'all' \| 'iconify' \| 'pixabay', cursor? }` → `{ items, nextCursor, pixabayAvailable, warnings }` (🔒 D4) |
| `media.preview(req)` | `media:preview` | `{ provider: 'pixabay' \| 'iconify', id }` → `{ mimeType, dataURL }`, from the 24 h disk cache when it is there |
| `media.import(req)` | `media:import` | the same request → `{ mimeType, dataURL, item }`; NEVER cached, capped at `MAX_IMPORT_BYTES` 20 MB |
| `components.list()` | `components:list` | the saved-component index over `<library>/components/` (🔒 D5); a missing or corrupt index is rebuilt from the folder |
| `components.save(req)` | `components:save` | `{ name, fragmentJson, previewPng }` → the `ComponentItem` it made; writes `<slug>.excalidraw` + `<slug>.png` |
| `components.read(req)` | `components:read` | `{ slug }` → `{ fragmentJson }` — the bytes an insert needs |
| `components.rename(req)` | `components:rename` | `{ slug, name }` → the row; the LABEL only, both files keep their names |
| `components.delete(req)` | `components:delete` | `{ slug }`; both files to the OS trash (`shell.trashItem`) and the row out of the index |
| `components.preview(req)` | `components:preview` | `{ slug }` → the stored PNG as a dataURL |
| `components.onChanged` | `components:changed` | pushed to EVERY window when the components library changes — any vault, any writer, no payload |
| `secrets.set(req)` / `has(req)` | `secrets:set` / `secrets:has` | `{ name, value \| null }` writes or clears an encrypted secret; `{ name }` → boolean. NO channel answers a value (🔒 D4) |
| `vaultConfig.read` / `write` / `onChanged` | `vaultConfig:*` | any file in `<vault>/.yaseendraw/` |
| `github.status` / `syncNow` / `setEnabled` / `onStatus` | `github:*` | per-vault GitHub sync |

Rules that hold across the whole surface:

- **Main owns the disk and the state file.** The renderer never touches either directly.
- **Never overwrite.** Create and rename use `wx` / exclusive semantics; a collision is
  `ALREADY_EXISTS`, not a silent clobber.
- **Atomic writes.** Every write is tmp-file + rename, so a crash cannot truncate a drawing.
- **Echo suppression by mtime.** A write's own watcher event is recognised by the mtime the write
  returned and ignored; a genuine external change while the buffer is dirty raises the conflict bar.
- **One door per direction, per kind.** Where a kind has a dedicated pair (`drawing:load` /
  `drawing:save`), nothing else may read or write those bytes. A save is an ORDER as well as a
  write: the images the scene names land before the scene that names them.
- **Read ceilings are per door.** `MAX_FILE_BYTES` (10 MiB) bounds the text reads;
  `MAX_DRAWING_BYTES` (200 MiB) bounds `drawing:load`, which has to open legacy scenes that still
  embed their images as base64.
- **Assets are immutable and append-only.** A save writes an asset with `wx` and treats EEXIST as
  success; nothing but the orphan sweep ever removes one.
- **The renderer never reaches a provider** (🔒 D4). Iconify and Pixabay are fetched by MAIN, which
  holds the key, does the curation, keeps the cache and enforces the import cap. The renderer's
  whole knowledge of the key is the boolean `pixabayAvailable`.
- **A secret never crosses the bridge outward** (🔒 D4). The renderer may `set` one and ask `has`;
  there is no channel, no state field and no push that carries a value, so a key cannot reach a
  devtools console, a `state:get` answer or a renderer crash dump. Main reads it itself.

### The orphan sweep (🔒 D3)

The first `fs:tree` for a root in a session — the moment a vault is "opened" — also runs one
sweep of `<vault>/assets/`, detached, so the tree answers immediately. A file goes to the OS
trash (`shell.trashItem`, never `fs.rm`) only when BOTH hold: no `.excalidraw` anywhere under the
root references its id, and it is older than 24 h (`ORPHAN_MAX_AGE_MS`). The age guard is what
makes this safe with editors open — an image pasted a minute ago is already in `assets/` while
the board naming it has not saved yet. The scan reads every board fresh, nested folders included,
skips dot-dirs, `node_modules` and the store itself, and tolerates a corrupt or unreadable file
by skipping it. When it trashed something the asking window shows "Cleaned N unused images"
through the existing passive notice; when it did not, it says nothing.
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
  settings: {
    theme: 'system' | 'light' | 'dark'
    libraryFolder: string | null         // 🔒 D5, null = `<userData>/library`
    confirmDelete: boolean
    canvas: CanvasPrefs                  // 🔒 D9, below
    canvasPanel: { tab: 'image-studio' | 'components' | 'presentation'; docked: boolean }
  }
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

`SettingsState.canvas` is `CanvasPrefs` (`shared/types.ts`, mapped by `shared/canvasPrefs.ts`) —
the fourteen user-level canvas preferences 🔒 D9 took out of the engine's browser localStorage:

```ts
CanvasPrefs {
  gridModeEnabled: boolean          // false
  objectsSnapModeEnabled: boolean   // false
  snapToMidpoints: boolean          // true   (engine `isMidpointSnappingEnabled`)
  arrowBinding: boolean             // true   (engine `isBindingEnabled`)
  selectOn: 'wrap' | 'overlap'      // 'wrap' (engine `boxSelectionMode` contain/overlap)
  toolLock: boolean                 // false  (engine `activeTool.locked`)
  zenModeEnabled: boolean           // false
  writingMode: boolean              // false
  writingStrokeWidth: number        // 0.5    (engine `currentItemWritingStrokeWidth`)
  vectorStrokeWidth: number         // 2      (engine `currentItemVectorStrokeWidth`)
  framesVisible: boolean            // true   (engine `updateFrameRendering`, never appState)
  defaultFontFamily: number         // 10 Assistant (engine `currentItemFontFamily`)
  defaultRoughness: 0 | 1 | 2       // 0 architect  (engine `currentItemRoughness`)
  defaultTextAlign: 'left'|'center'|'right'  // 'center' (engine `currentItemTextAlign`)
}
```

Every default is the engine's own (`packages/excalidraw/appState.ts`, `packages/common/src/constants.ts`).
They are seeded into `initialData.appState` at mount and kept in step both ways, each direction
comparing against one "what the engine holds" ref before writing, so two windows can never
ping-pong; the engine's own read-back is 300 ms debounced. The guard is STRICT at the IPC boundary
(a renderer hands over a whole `CanvasPrefs` or nothing) and LENIENT on load (field by field over
the defaults, so a state file written before a key existed keeps every key it does have). Per BOARD
there is only what the engine writes into the file itself — `viewBackgroundColor`, `gridSize`,
`gridStep`. None of the web app's localStorage keys are carried over; the one engine key this app
touches is `excalidraw.desktopUIMode`, WRITTEN before every mount and never read (⚡ R4/R5).

Invariants: `file ∈ tabs` whenever `file` is non-null, and `tabs: []` ⇔ `file: null`.
`sidebarCollapsed`, `sidebarLens` and both focus lists are WINDOW identity — a duplicate inherits
them by value and then diverges; a global `state:changed` broadcast never moves another window's.
Settings and `sidebarWidth` are global and every window follows a change live.

`SettingsState.libraryFolder` (🔒 D5) is the ONE folder every vault shares, where media favorites
and saved components live (3A / 3B filled it; 3C adds `components/`): an absolute path the user picked, or null
for `<userData>/library`. Only main can resolve null, so Settings asks through
`drawing:library-folder`; main also `mkdir -p`s the folder at startup, so the row always names a
directory that exists. A folder that cannot be created is still the answer — a launch must not
fail because a picked path has gone read-only.

### The Library folder (🔒 D5)

```
<library>/
  media.json                      the media library — 3A (YAZ-1817)
  components.json                 the saved-component index — 3C (YAZ-1819)
  components/
    <slug>.excalidraw             one component: a whole Excalidraw document, images EMBEDDED
    <slug>.png                    its preview, bounded at 800 × 600
```

`media.json` is `{ version: 1, favorites: StoredMediaItem[], recent: StoredMediaItem[] }`, both
lists newest-first, de-duplicated by `itemKey`, and capped on the tail — `favorites` at 500
(`MAX_MEDIA_FAVORITES`), `recent` at `RECENT_LIMIT` 60 as an MRU. A `StoredMediaItem` is the web
app's (`convex/mediaTypes.ts`, field for field, so a library written by either app reads in the
other): `itemKey` (the identity), `provider` (`pixabay` | `iconify` | `shape`), `providerId`,
`kind`, `title`, the optional attribution and layout fields (`previewUrl`, `creator`,
`creatorUrl`, `collectionName`, `sourceUrl`, `licenseName`, `licenseUrl`, `attribution`, `width`,
`height`, `trademarkNotice`), and `updatedAt`, which MAIN stamps on every write — a renderer's own
is dropped. `previewUrl` is stored but NEVER trusted: a CDN URL expires, and the Images tab
re-derives every preview from `provider` + `providerId` over `media:preview`. Pointers only — the BYTES never live in the library (they
go through `media:import` into the vault's `assets/`).

The rules are pure (`shared/mediaLibrary.ts`); the disk half (`desktop/src/main/library/mediaStore.ts`)
follows the app's file idioms: a read never creates the file, a mutation that changes nothing does
not write, writes are tmp + rename and serialised, a file that is not a version-1 library is moved
aside as `media.json.corrupt-<epoch>`, and a bad ROW in a good file is dropped rather than costing
the rest. ONE chokidar watches the library folder (depth 0, `media.json` only), re-pointed when
`settings.libraryFolder` changes; an own write notifies every window synchronously and its echo is
dropped by mtime, an external write (the other machine, through a synced vault) notifies as usual.
`media:changed` carries no payload because every window re-lists regardless of its vault — that is
the cross-vault promise.

### The Image Studio's providers (🔒 D4)

The canvas panel's **Images** tab is the web app's Image Studio, and everything behind it is the
main process. `worker/imageStudio.ts` — the Cloudflare Worker that used to serve
`draw.yaseenarshad.com` — was PORTED, not simplified, into `desktop/src/main/media/`:

| Module | What it is |
|---|---|
| `curation.ts` | the pure rules: normalisation, ranking, the interleave, the opaque cursor, every constant |
| `cachePolicy.ts` | the pure cache policy: key scheme, 24 h, the sweep plan |
| `cache.ts` | the disk half of the cache; never throws at a caller |
| `providers.ts` | the fetching: the Iconify walk, the Pixabay pages, the refill, the image proxy |

The numbers are the Worker's own and are locked: `SEARCH_LIMIT` 18, `ICONIFY_ALL_RESULT_LIMIT` 14
and `PIXABAY_ALL_RESULT_LIMIT` 4 in `all`, `ICONIFY_COLOR_BATCH_LIMIT` 6, `PIXABAY_PAGE_SIZE` 4,
`SEARCH_CACHE_VERSION` `'2'`, `MAX_IMPORT_BYTES` 20 MB, `COLOR_COLLECTION_PRIORITY` and
`LOW_PRIORITY_COLLECTIONS` verbatim. Iconify is searched twice — a colour-collection batch, then a
general pass with those collections filtered OUT — and the page is three icons to one graphic.
Pixabay serves `vector` and `illustration` only, alternating, de-duplicated by the cursor's
`seenIds`. The cursor is opaque base64url and carries the query and the source: one minted for
another search is `BAD_REQUEST`, never a silent restart.

- **No key, no provider.** `secrets.read('pixabayApiKey')` is main's alone. With no key Pixabay is
  SKIPPED — not warned about, not shown failing — and the answer says `pixabayAvailable: false`,
  which is the only thing the renderer ever learns about it.
- **One provider failing is not the request failing.** In `all`, a dead Pixabay still answers with
  the icons plus a `warnings` line, and its half of the cursor is untouched so the next page
  retries it from where it was. Only when EVERY requested provider failed does the call reject.
- **Failure is typed.** A `fetch` that threw is `OFFLINE` (the machine never reached the provider);
  a provider that answered and refused is `PROVIDER_FAILED`; a non-image is `UNSUPPORTED_TYPE`;
  past 20 MB is `TOO_LARGE`, checked on `Content-Length` AND on the bytes that actually arrived.
- **Previews travel as dataURLs.** No custom protocol, no renderer fetch. A stored `previewUrl` is
  never read: every tile asks `media:preview` by `provider` + `providerId`.
- **An import is not cached and does not touch the disk here.** Its bytes go to the engine's
  `insertImages`, and the SAVE path (🔒 D3, 2E) writes them into `<vault>/assets/` before the scene
  names them.

```
<userData>/media-cache/
  <sha256 of the cache key>.json     search answers, Pixabay pages and records, previews
```

One flat folder of JSON, named by the hash of the Worker's own key strings (`search?_iscv=2&q=…`,
`pixabay/search/<q>/<type>/<page>/<perPage>`, `pixabay/item/<id>`, `image/<provider>/<id>/preview`);
the search key also carries whether a key was set, so adding one never keeps serving yesterday's
Iconify-only page. Freshness is the FILE's mtime, so the 24 h read guard and the startup sweep are
one rule. The sweep runs once at registration, detached, and removes only `*.json` past 24 h —
which is exactly what a read would have refused. Imports are never written here. A cache that
cannot read or write is a miss, never an error.

The renderer half is `client/src/media/`: `ImageStudio.tsx` (Search / Shapes / Favorites / Recent),
`shapes.ts` (7 basic shapes plus the engine's 12 Smart Shapes as NATIVE elements — the smart half
needs `@excalidraw/element`, which arrives on its own lazy promise so the basics render at once),
`insertShape.ts` (both insert paths, and `IMAGE_STUDIO_INSERTION` = 320 px capped at 55 % of the
viewport) and `imageStudio.css`. ⌘F opens the tab AND focuses its search field; offline, Search
shows a passive line while Shapes, Favorites and Recent keep working — previews from the cache
where main still has them, a placeholder where it does not.

### Saved components (🔒 D5)

The canvas panel's **Components** tab is the web app's Saved Components, and the library is a
folder rather than a Convex table. One component is TWO files named after its slug —
`<library>/components/<slug>.excalidraw` and `<slug>.png` — plus a row in
`<library>/components.json`, which is `{ version: 1, items: ComponentItem[] }` with
`ComponentItem = { slug, name, elementCount, createdAt, updatedAt }`, newest-updated first.

**The fragment embeds its images**, which is the one place this app deliberately does not follow
🔒 D3: it is a whole `{ type: 'excalidraw', version: 2, source, elements, appState: {}, files }`
document whose `files` map carries the component's bytes as dataURLs. A component is small and has
to insert into ANY vault on ANY machine, so it cannot point at a `<vault>/assets/` file. On insert
those bytes are handed to the canvas as files; the board's next save extracts them into THIS
vault's `assets/` through 2E, deduped by `fileId`.

**The slug is the identity, the name is only the label.** The slug is the kebab of the name, uniqued
with `-2`, `-3` (Finder's counting, never `-1`), capped at 60 characters, and validated as a path
segment — lowercase words joined by single hyphens and nothing else, so a slug out of a hand-edited
index can never name a file outside the folder. A rename therefore moves no file.

**The folder is the truth; the index is a cache.** Every read reconciles them: a fragment the index
does not know is adopted (named after its own slug, counted by reading it once), a row whose file
has gone drops out, an unreadable fragment is skipped rather than offered as a tile that cannot be
inserted, and an index that is missing or is not a version-1 index is rebuilt from the folder — the
bad one moved aside as `components.json.corrupt-<epoch>`. A READ NEVER WRITES: the reconciliation is
in memory and only a mutation puts it on disk, so listing costs a read-only disk nothing and does
not churn a synced folder. One chokidar watches the library folder at depth 1 (the index, and the
two files a component is — an `atomicWrite` tmp file is silence), own writes are echo-suppressed by
path + mtime, and `components:changed` carries no payload because every window re-lists regardless
of its vault. A delete is `shell.trashItem`, never `fs.rm`, and a trash that fails leaves the row.

The rules are pure (`shared/savedComponents.ts`); the disk half is
`desktop/src/main/library/componentStore.ts`, guarded by `desktop/src/main/ipc/components.ts`.

The renderer half is `client/src/components-library/`: `componentData.ts` (the web app's
`SavedComponentsData.ts` — the capture with its four assertions, the fragment, and the insert),
`componentPreview.ts` (`SavedComponentPreview.ts`, PNG instead of WebP so every reader can open the
file), `SavedComponents.tsx` and `savedComponents.css`. **Insert makes an independent copy**: the
elements go through the engine's own `insertElements`, which duplicates ids and centres on the
viewport, so two inserts of one component are two unrelated sets of elements. Search is the app's
ONE ranking matcher (`search/matchCandidates.ts`, the same one ⌘K uses) over the names, paged by
`PAGE_SIZE` 24. Rename and delete are inline in the card rather than `window.prompt` /
`window.confirm`, and 🔒 `confirmDelete` (Settings › Files) decides whether the delete asks first.

**Import JSON** (YAZ-1833) is the same library through a different door: the button opens the
native open-file dialog (`dialog:open-file`, `.excalidraw` filter), `componentImport.ts` parses
what comes back — the web app's `parseImportedComponentJson` envelope table
(`growprofit/saved-component` with its schema-version and element-count checks, `excalidraw`,
`excalidraw/clipboard`, `excalidraw-api/clipboard`, and a ONE-item `excalidrawlib`), then
`restoreElements(…, { repairBindings: true })`, the soft-deleted filter, a second assertion pass
and the 750 000-byte element ceiling — and the result goes through `components:save` exactly as a
captured selection does. Two differences from the web app, both deliberate: it is a FILE PICKER
rather than a paste box (a desktop app has a dialog; a browser tab did not), and IMAGES ARE KEPT,
because the picked file carries its own `files` map, so importing a legacy embedded board yields a
component with its pictures. An image id with no bytes behind it in that file is a refusal. The
component is named after the file's base name and its preview is drawn from the fragment and
bounded like every other, so importing a board-sized scene is allowed and still yields a tile.
Every refusal throws BEFORE `components:save` is called and shows as a PASSIVE notice
(`role="status"`, not the assertive error line) — nothing is written.

### Presenting (YAZ-1820)

The canvas panel's **Present** tab is the web app's `PresentationSidebar`, and ▶ Start
presentation mounts its `PresentationPlayer` over the canvas pane. The whole of it is
`client/src/drawings/presentation/`: `slides.ts` (the rules), `camera.ts` (the offsets),
`PresentationSidebar.tsx`, `PresentationPlayer.tsx`, `presentationIcons.tsx`, `presentation.css`.

**A slide is a top-level frame, and the deck's order lives in the FILE.** The position is
`frame.customData.presentationOrder`, with `customData.yaseenPresentation.presentationOrder` read
as a fallback so a deck generated against the in-package contract
(`packages/excalidraw/presentation/CONTRACT.md`) and a deck a human dragged into shape are the
same deck. Nothing about a presentation is in `SettingsState` or in any store: a board carries its
own deck. A frame nested in another frame is a shape in a slide, not a slide; a deleted one is not
a slide either.

**The order is a request, not a guarantee.** A file is user data, so a claim is honoured only when
it is in range AND is the only claim for its slot; everything else fills the gaps in scene order.
The answer is therefore always exactly the top-level frames, numbered 1..n with no holes. A
reorder — drag the handle, or Alt+↑ / Alt+↓ — writes the new numbers back through `updateScene`
with `CaptureUpdateAction.IMMEDIATELY`, so it is one undo step and it lands in the file on the next
autosave. A reorder request is completed rather than trusted: unknown ids are dropped, duplicates
taken once, and a frame the caller forgot keeps its place at the end, so a stale list can reshuffle
the deck but can never lose a slide out of it. A rename writes the frame's own `name`.

**The player covers the PANE, not the window.** The web app portalled to `document.body`, hid the
chrome with a `body` class and measured `window.innerWidth`; this shell keeps several drawing tabs
mounted at once, each with its own engine, so the overlay is a child of `.drawing-surface`, the two
chrome classes (`--presenting`, `--presentation-tools`) go on that element, and the camera reserve
(0.32 of the width, always on) is a fraction of the pane. The keyboard and double-click handlers
are still document-wide — the canvas has the keyboard while presenting, and it is not inside the
overlay — so both stand down unless the overlay is in the visible tab layer, the same test
`drawingCommand.ts` makes for the menu's canvas items.

**Keys:** → / PageDown / Space (Space only while the tools are hidden) next, ← / PageUp previous,
Home / End the ends, **Esc zooms out to the whole deck and never leaves** (restarting a deck by
accident is worse than reaching for ✕), ⇧T shows or hides the editor chrome, Tab is trapped in the
control bar while the chrome is hidden. Double-clicking the canvas presents the smallest slide
under the pointer. Presenting is free-form: the camera is never locked, the hand tool pans while
the chrome is hidden, and the tool the presenter had before is put back on exit. Frame outlines are
hidden for the duration and restored to `SettingsState.canvas.framesVisible` — never to a
hardcoded value — whether the presenter left through ✕, the deck emptied under them, or the
component was simply unmounted.

**Not ported** (locked exclusion on 🔒 YAZ-1775): hosted HTML animations and everything that served
them — `PresentationAnimationController`, `animationOrchestrator`, `animationDomAdapter`, the
CSP-sandboxed iframe assets, and the `yaseendraw:presentation-frame` lifecycle event they were the
only subscriber to. What that event DROVE is kept, because it is the camera behaving itself rather
than an animation protocol: the transition token that stops a stale landing, and the rule that an
in-flight transition must not land while the deck is zoomed out.

### Secrets (🔒 D4)

`<userData>/secrets.json` = `{ version: 1, values: Record<name, base64(safeStorage.encryptString(value))> }`,
owned by `desktop/src/main/secrets.ts`. It is NOT part of the app state file and never rides
`state:changed`. `has` means "stored AND decryptable on this machine": a file copied from another
Mac is full of blobs this keychain cannot open, and the honest answer is then no. Without an OS
keychain at all (`safeStorage.isEncryptionAvailable()` false) `set` refuses with
`ENCRYPTION_UNAVAILABLE` rather than falling back to plaintext, and `has` is false. The one name so
far is `pixabayApiKey` (`PIXABAY_SECRET`), typed once in Settings › Images and read by main when it
builds a Pixabay request.

Two things live in the VAULT instead, because they are the user's own data:
`<vault>/.yaseendraw/favorites.json` (YAZ-1794: vault-relative paths, so favorites travel with the
vault) and `<vault>/.yaseendraw/github.json` (the per-vault sync switch). Nothing else is ever
written into a vault except the drawings and `assets/`.

To reset or hand-edit the state file: **quit the app first** (⌘Q flushes it), then edit or delete
the JSON. A missing file launches one empty window.

## ⌘K search

One search, over NAMES, in the sidebar's own bar (🔒 YAZ-797: a persistent bar, never a modal).
⌘K focuses it — the sidebar un-collapses first — and a typed query replaces the active lens's body
with a FLAT ranked list (🔒 the flat-list ruling on YAZ-739), never a filtered tree.

- **The catalog** (`client/src/search/searchCandidates.ts`, 🔒 2H on YAZ-1814) is one row per
  `.excalidraw` file — under the name the tree and the tab strip show, WITHOUT the extension — plus
  one row per folder, matched by its own name (🔒 D2 on YAZ-1491) and labelled by its parent. A
  drawing never matches on its folder; the folder is its own row instead.
- **It is derived, not indexed.** There is no vault index any more (it went with the markdown layer
  in YAZ-1808): the catalog is one walk of the tree the Sidebar already holds, which IS `fs:tree`
  and is already kept fresh by the structural watcher — so a drawing created a second ago is
  findable without a restart, and searching costs no second read of the vault.
- **What never appears:** a file of no supported kind (it lists in the tree and opens in the OS app,
  but it is not a document this app can search for), and the image store `assets/`, which `fs:tree`
  has already dropped (🔒 D3 on YAZ-1775). A folder the user called `assets` inside a subfolder is
  theirs and is searchable, exactly as the tree rule says.
- **Ranking** is the ONE matcher every naming surface uses (`search/matchCandidates.ts`, GRO-2197):
  case-insensitive, exact → prefix → substring, input order inside a bucket, capped at `SEARCH_CAP`
  (50) AFTER ranking, so a late exact match still tops a page of substrings. Folders lead the
  catalog, so a folder sits above a drawing it ties with — the reveal is the cheaper mistake.
- **The feed is lazy and latches.** Nothing is built until the first non-empty query of a mount;
  from then on it rebuilds with every new tree. There is NO debounce — the scan is synchronous and
  a tripwire test over a 5,000-drawing catalog fails if it ever stops being cheap.
- **Keys, in the bar** (it keeps focus throughout, so ↑/↓ carry on walking): ↑/↓ move and WRAP at
  both ends; Enter activates — a drawing OPENS in the current tab, a folder REVEALS itself in the
  Files lens (🔒 D3 on YAZ-1491) — ⌘-Enter opens in a background tab; Escape clears a typed query
  and only gives up focus on a second press. A click does exactly what Enter does on that row.

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
| File | Export Image… (a drawing tab only) | ⌘⇧E |
| File | Export Drawing… (a drawing tab only) | ⌘⇧S |
| File | Close Tab | ⌘W |
| File | Close Window | ⌘⇧W |
| Edit | Undo / Redo / Cut / Copy / Paste / Select All | stock roles |
| View | Toggle Sidebar | — |
| View | Reload · Toggle Developer Tools (dev builds) | — |
| View | Actual Size / Zoom In / Zoom Out | ⌘0 / ⌘+ / ⌘− |
| View | Canvas Background ▸ White / Slate / Blue / Yellow / Bronze (a drawing tab only) | — |
| Window | Minimize · Zoom · Next Tab · Previous Tab · Bring All to Front | ⌃Tab / ⌃⇧Tab (⌘⇧] / ⌘⇧[ alternates) |
| Help | Yaseen Draw on GitHub | — |

Zoom is deliberately NOT the stock roles: a registered accelerator never reaches the page on
macOS, so main applies the step to the focused window's `webContents` itself.

Export Image…, Export Drawing… and Canvas Background are the canvas's own three items, moved out
of the engine's main menu by 🔒 D10 (there is no `<MainMenu>` in a drawing and the engine's stock
trigger is hidden). Main enables them only while the window a menu action would target has a
`.excalidraw` in front, rebuilding the menu when any window's active file changes and when focus
moves between windows. Each is pushed to that window's renderer, which dispatches it as a DOM
event on the VISIBLE drawing layer (`client/src/drawings/drawingCommand.ts`) — several tabs are
mounted at once, each with its own engine, so a prop or a `window` listener would reach the wrong
canvas. The drawing then calls the engine's own door: `openDialog: { name: 'imageExport' }` (the
engine's PNG / SVG export dialog), or `viewBackgroundColor`, which the engine writes into the
file — or, for Export Drawing…, the assembly below.

### Export Drawing… (🔒 D3, YAZ-1821)

**🔒 D3 says the vault file never embeds, and that export is the one place that does.** A board in
a vault is a lean scene (`files: {}`) beside a shared `<vault>/assets/` folder, because embedding
base64 makes multi-MB files that git rewrites on every save. A file being handed to someone else
has no `assets/` folder to point at, so Export Drawing… writes a STANDALONE `.excalidraw` with
every image it uses embedded — the file upstream Excalidraw and excalidraw.com open with its
pictures intact. Sharing links and view-only tokens are not ported; this is the sharing story.

- **The renderer assembles it** (`client/src/drawings/exportDrawing.ts`):
  `serializeAsJSON(elements, appState, files, 'local')` — the library's own writer, the same one
  the vault save uses — over the **full canvas files map**: everything 2E hydrated out of `assets/`
  at load, plus anything pasted, imported or inserted since and not yet saved. The engine's live
  map is the only place all of it is in one piece.
- **Files only deleted elements name are not sent.** An undo can leave an image's bytes in the
  engine's map long after the element is gone, and shipping them would put a deleted picture inside
  a file about to be handed to someone. The filter is `referencedFileIds`, the same rule 2E's save
  path uses; `serializeAsJSON(…, 'local')` filters again (`filterOutDeletedFiles`) — belt and
  braces, and idempotent.
- **Main owns the sheet and the write.** `dialog:save-file` shows the save dialog (default name
  `<board name>.excalidraw`, `.excalidraw` filter) and then writes atomically, in the same call.
  One door rather than "pick a path, then write it": a renderer holding an arbitrary absolute path
  it may write to is what the fs layer's root-relative rules exist to prevent, so the only path
  ever written is the one the user has just typed into a native sheet. The extension is enforced
  after the sheet, because a name can be typed freely.
- **The vault file is not touched.** An export reads nothing from the vault, writes nothing into
  it, and does not flush the autosave: exporting a dirty board exports what is on the canvas, and
  the board's own save timer carries on. Where it landed, or why it did not, is the window's one
  passive notice.

**Focus on tab reveal** (🔒 the focus-handoff decision on YAZ-1812). Several tabs are mounted at
once; the canvas has `autoFocus`, but that fires only at mount, so switching to an
already-mounted tab used to leave the keyboard nowhere until the user clicked. The reveal effect in
`DrawingEditor` (the `IntersectionObserver` that re-measures the canvas) now also hands it the
keyboard through `DrawingSurfaceApi.focus()` — GATED by `drawings/focusHandoff.ts`: only when
`document.activeElement` is the body or nothing at all, or is inside the tab layer (the tab being
left). The sidebar search bar, the vault switcher, a dialog and the tab strip keep what they have;
a tab becoming visible must never pull ⌘K's caret out from under the user. The re-measure is
unconditional — only the focus is gated.

Renderer-owned chords (`client/src/lib/*Hotkey.ts`, all gated by `ownsWindowChord` so a text field
or an open modal keeps the key): ⌘B toggles the sidebar (YAZ-1280); ⌘X / ⌘C / ⌘V drive the
sidebar's file clipboard when the selection owns them. Inside a focused canvas, ⌘F and ⌘C open the
canvas panel's Images and Components tabs — and ⌘F additionally puts the caret in the Images tab's
search field (YAZ-1818, the web app's `onRequestImageStudioSearch`, as a counter the tab watches)
— bound on the drawing's own element in the capture
phase, never `window`, and suppressed whenever the keystroke could have meant something else (an
editable target, a live selection, a gesture in flight, a dialog, or anything selected on the
canvas). That last gate is why ⌘C with a selection is still the engine's COPY and nothing else
(YAZ-1819): the Components tab is what ⌘C means only when there is nothing to copy. Settings › Hotkeys lists every one of them and is the single place that copy lives.

The right-click menu inside the renderer is Electron's (`buildContextMenuTemplate`): spelling
suggestions, Add to Dictionary, and cut/copy/paste. Electron ships no default one, which is why
this exists at all.

### Settings

The dialog (`client/src/settings/`) is one scrolling page of sections plus a standalone Hotkeys
page, driven entirely by the registry in `registry.tsx`: a setting is declared once — id, label,
hint, search keywords, how it renders — and appears in its section, in the nav and in search from
that one entry. The row's `id` IS its `SettingsState` field name, so a spec that knows the field
knows the row.

| Section | Rows |
|---|---|
| Appearance | Theme (the only one — 🔒 D9 put everything else about the canvas in Canvas) |
| Canvas | the fourteen `CanvasPrefs` (🔒 D9) in three groups: Drawing aids, Modes, New elements |
| Files | Confirm before deleting · Library folder (🔒 D5: resolved path, Choose…, Reset to default) |
| Images | Pixabay API key (🔒 D4: a password field, Save / Clear, "Key set" / "No key" from `secrets:has`, never echoed) — NOT in `SettingsState`, it lives in main's encrypted `secrets.json` |
| Sync | the per-vault GitHub switch — the other setting NOT in `SettingsState` (it lives in `.yaseendraw/github.json`) |
| Hotkeys | its own page: the Window, Canvas and Mouse tables, from `hotkeys.ts` |

`hotkeys.ts` is the single source of truth for every binding the app advertises, and
`hotkeys.test.ts` pins the expected set so a keymap change anywhere fails loudly here.

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
`.excalidraw` as an Owner file association (🔒 D1 on YAZ-1775).

**Opening a drawing from outside the app** — a Finder double-click, `open -a "Yaseen Draw"
Board.excalidraw`, or a plain `open Board.excalidraw` once the association is registered — travels
the deep-link pipeline rather than a path of its own. The OS delivers it differently per platform
and main converts each into the same `yaseendraw://` push:

| Platform | How the path arrives | Where it is read |
|---|---|---|
| macOS | the `open-file` event (before `ready` on a cold start) | `app.on('open-file')` → `fileLink` → the link queue |
| Windows / Linux, app not running | this process's own `process.argv` | `openableFileArgs(process.argv)` after `restoreAll()` |
| Windows / Linux, app running | the `second-instance` argv | `openableFileArgs(argv)` in that handler |

`main/fileArgs.ts` is the one filter: an argument counts only when it is not a switch, is not a
URL, and names a file of a kind this app owns.

From there the routing rule is the ordinary link rule, and it decides **which window and which
tab**: the open window whose root contains the file (most specific root wins) activates the tab if
that file is already open and otherwise opens it in the current tab; failing that, a new window on
the most recent remembered vault that contains the file; and failing that — a drawing outside every
open and every remembered vault — **a new window with the file's PARENT FOLDER as the vault**. An
unsupported or missing file shows the window's one passive notice, never a dialog.

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
