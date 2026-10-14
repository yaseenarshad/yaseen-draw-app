# Yaseen Draw — development

How the app is built, and how to run and package it from source. To just use the app, see the
[README](../README.md); for what each feature does, see the [feature guide](GUIDE.md).

## How it is built

Yaseen Draw — a local whiteboard for a folder of boards (Excalidraw drawings and draw.io
diagrams), as an Electron macOS desktop app: a React renderer around a vendored
[Excalidraw](https://excalidraw.com) fork and a bundled, offline draw.io, and a main process
that reads and writes the files on this machine (the renderer only ever talks to the
`window.yaseenDraw` bridge — there is no server of any kind, except the optional share Worker on
your own Cloudflare account). Pick a folder, browse its
`.excalidraw` and `.drawio` files in the sidebar, draw, and changes are saved back to disk (debounced, atomic).
Files changed outside the app (another editor, sync) are reloaded live; if you have unsaved edits
you get a Reload / Keep mine choice. Lineage in one line: the shell follows Obsidian, the
transport mechanism follows VS Code (sandboxed renderer + typed preload bridge + main-process fs),
and the canvas is Yasin's own Excalidraw fork.

## Requirements

Node.js 22.2 or newer (`package.json` `engines`, and what CI runs), npm, macOS (the packaged app targets macOS arm64; the dev build runs wherever Electron does).

## Run

```sh
npm install
npm run dev      # launches the Electron app with HMR
```

The first `npm run dev` or `npm run build` downloads the pinned draw.io webapp once (54 MB,
sha256-checked) into `desktop/.cache/drawio/`; after that no network is needed.

See `docs/LAUNCH.md` for the full launch recipe (state file, isolated profiles, packaged-app install)
and `docs/CONTRACTS.md` for the bridge, app-state and packaging contracts.

```sh
npm test         # unit tests (vitest, three projects: client jsdom, desktop node, tools node)
npm run typecheck
npm run build    # electron-vite build into desktop/out + the share viewer into share/dist
npm run e2e      # build, then the Playwright suite against the built app (sandboxed profile + vaults)
```

What the E2E suite cannot see is checked by hand from `docs/REGRESSION.md`.

## Build the app

```sh
npm run desktop:build
```

produces `desktop/dist-app/mac-arm64/Yaseen Draw.app` and `desktop/dist-app/Yaseen Draw-<version>-arm64.dmg` (arm64, ad-hoc signed). Drag the `.app` into `/Applications`, or send someone the dmg.

The app bundles jgraph's draw.io webapp ([jgraph/drawio](https://github.com/jgraph/drawio), Apache-2.0) unmodified, with its licence as `LICENSE-drawio.txt` in the app's `drawio/` folder. Yaseen Draw is not affiliated with draw.io; it opens `.drawio` files.

## The README pictures

The banner, the pictures and the GIFs in `docs/assets/` come from the real app, on a made-up demo
vault and an isolated profile. Make them again after a release that changes the look:

```sh
npm run build
node tools/readmeMedia/capture.mjs --work "$TMPDIR/yaseen-draw-readme"
```

It takes about three minutes and shows nothing on screen. `--only hero,share` makes a subset. The
script also copies the link preview picture to `~/Downloads/yaseen-draw-app-social-preview.png`;
upload it by hand in the repo's Settings › General › Social preview.

## Out of scope

There is no browser mode: the app runs only inside Electron. The file layer has no path jail:
anything under your user account can be read or written. The end-to-end suite (`npm run e2e`) is
local, not part of CI; the rest of behaviour is verified by launching the app in an isolated profile
(see `docs/LAUNCH.md` and `docs/REGRESSION.md`).
Distribution is deliberately minimal (locked decisions): no Developer-ID signing or notarization,
no auto-update, no Intel or universal builds.
