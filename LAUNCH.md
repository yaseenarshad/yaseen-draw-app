# LAUNCH — how to run this app (for humans and agents)

Yaseen Draw: a local markdown editor as an Electron macOS desktop app — React + Milkdown Crepe renderer, main-process file layer. See `README.md` for the human overview and `docs/CONTRACTS.md` for the bridge and editor contracts.

## Dev loop (do this when asked to "run it")

```bash
npm install
npm run dev
```

- `npm run dev` runs `electron-vite dev` in `desktop/`: it builds main + preload, serves the renderer with HMR and launches the Electron app — one command, and every remembered window reopens. There is no server of any kind and nothing listens for the app itself on any port (the only network socket is electron-vite's private HMR channel in dev); renderer ↔ main is the typed `window.yaseenDraw` bridge.
- Yasin's vault is `$HOME/Documents/GitHub/yaseen-draw-vault` — a git repo the app's GitHub sync pushes to (the username part of `$HOME` differs per machine — resolve it, don't hardcode). The app repo itself is `yaseen-draw-app`; the vault is `yaseen-draw-vault`. If a window opens the wrong folder, click the vault name in the sidebar header (or ⌘O) and choose **Open folder…**, or run `window.yaseenDraw.window.setIdentity({ root: '<abs path>', file: null })` from the devtools console and reload.
- Folder picking is the native open-directory dialog (`window.yaseenDraw.pickFolder()`), which pops up on Yasin's screen; in an agent session seed `<user-data-dir>/yaseendraw.json` with a `windows[]` entry (`{ id, root, file, bounds }`) before launch, or call `window.yaseenDraw.window.setIdentity({ root, file: null })` and reload, instead of using the vault switcher's **Open folder…**.

## Build + install

```bash
npm run desktop:build
```

- Builds `desktop/out` (electron-vite) and then packages with electron-builder: `desktop/dist-app/mac-arm64/Yaseen Draw.app` and `desktop/dist-app/Yaseen Draw-0.3.0-arm64.dmg` (arm64 only; the filenames contain spaces, so quote them). `mac.identity: null` makes electron-builder skip signing, so `desktop/build/adhocSign.cjs` (`afterPack`) deep ad-hoc signs the bundle itself — without that seal Gatekeeper reports a downloaded copy as "damaged" instead of offering **Open Anyway**.
- The first packaging run on a clean machine needs network: electron-builder downloads its Electron dist zip and dmgbuild once, then caches them.
- Install: drag `Yaseen Draw.app` into `/Applications` in Finder — either straight from `desktop/dist-app/mac-arm64/`, or from the mounted dmg:

```bash
open "desktop/dist-app/Yaseen Draw-0.3.0-arm64.dmg"
```

- On another Mac the first open is blocked by Gatekeeper (the app is not notarized): System Settings › Privacy & Security › **Open Anyway**, once. See `README.md` "Sharing it".
- Windows: `npm run desktop:build:win` packages an unsigned x64 NSIS installer, `desktop/dist-app/Yaseen Draw-<version>-win-x64-setup.exe` (electron-builder can produce it from a Mac too). First open shows SmartScreen — **More info › Run anyway**, once. Both scripts stamp the root `package.json` version through `tools/packDesktop.mjs`.
- No toolchain on the target machine? Download the `.dmg` (Mac, Apple Silicon) or the `-win-x64-setup.exe` (Windows) from the repo's [Releases page](https://github.com/yaseenarshad/yaseen-draw-app/releases). Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds both on GitHub runners and attaches them to that tag's release.

## App state — where it lives, how to reset it

- ONE user-global file, owned by the main process: `~/Library/Application Support/Yaseen Draw/yaseendraw.json` (settings, recents, open windows, per-folder view state including which sidebar lens and which Topics rows are expanded — schema in `docs/CONTRACTS.md` "App state"). Nothing is ever stored in the browser profile.
- TWO things do live in the vault, both by design and both the user's own data rather than app state: a folder page's view configuration, written into that note's own frontmatter under the single `folder_page_settings` key, and the vault-wide property declarations at `<vault>/.yaseendraw/properties.json` — the `.obsidian`-style dotfolder that travels with the notes. The dotfolder is created lazily on the first write and never otherwise; reading it creates nothing. Everything else about a vault stays in the state file above.
- To reset or hand-edit: **quit the app first** (⌘Q — quitting flushes the file), then delete or edit the JSON; on the next launch a missing file gets defaults and a corrupt one is moved aside as `yaseendraw.json.corrupt-<epoch>`, never silently overwritten. To find it (the folder first appears after the app has run once against the real state):

```bash
ls "$HOME/Library/Application Support/Yaseen Draw/"
```

- `--user-data-dir=<dir>` relocates the whole state file — this is how agent checks run against a temp state without touching the real one.
- To try a branch by hand against a SCRATCH vault (YAZ-1656's demo pattern): seed `<dir>/yaseendraw.json` with a `windows[]` entry for the scratch vault (the `seededState` shape in `desktop/e2e/helpers.ts`), then from `desktop/` run `YASEEN_DRAW_USER_DATA_DIR=<dir> npx electron-vite dev`. The env var is read before the single-instance lock, so the installed app and the dev app run side by side. Do NOT add `--watch` while agents are editing main-process files: every rebuild relaunches the window on the user's screen.

## Verify

```bash
npm test          # vitest suite, FOUR projects: client (jsdom), desktop (node), tools (node — the migration CLI), perf (jsdom — the budget tripwires)
npm run e2e       # Playwright-Electron suite (desktop/e2e/, 17 specs, ~1.5 min): builds, then drives the real app against a fixture-vault copy + temp user-data-dir, serially on ONE worker with no retries; step screenshots land in desktop/e2e/artifacts/
npm run typecheck
npm run build     # electron-vite build → desktop/out
```

- If `npm` isn't in the shell's PATH (agent shells often lack it), use its install location directly — e.g. `/opt/homebrew/bin/npm` (ARM mac), `/usr/local/bin/npm` (Intel mac), or the Volta/nvm/fnm install under `$HOME`.

### Agent note: live checks

The preview tool is gone — there is no browser mode and no URL to point one at. Verify through Playwright-Electron, always launched with a temp `--user-data-dir` so the real app state is never touched; seed `<user-data-dir>/yaseendraw.json` to skip the native folder dialog (see `desktop/e2e/helpers.ts` — `launchApp` + `seedState` — for the pattern; one-off throwaway scripts go under `node_modules/.verify/`, gitignored). A minimal smoke check against the dev build (run `npm run build` first):

```bash
node --input-type=module -e '
const { _electron } = await import("playwright")
const { mkdtemp } = await import("node:fs/promises")
const { tmpdir } = await import("node:os")
const { join } = await import("node:path")
const dir = await mkdtemp(join(tmpdir(), "yaseendraw-smoke-"))
const app = await _electron.launch({ args: ["desktop/out/main/index.js", `--user-data-dir=${dir}`] })
const win = await app.firstWindow()
console.log("window title:", await win.title())
await app.close()'
```

The packaged app is driven the same way with `executablePath: 'desktop/dist-app/mac-arm64/Yaseen Draw.app/Contents/MacOS/Yaseen Draw'` instead of `args[0]` (same launch pattern as `desktop/e2e/helpers.ts`, swapping the entry for the bundle's binary).

## Gotchas

- Never type into real vault files during testing — copy the vault to a scratch dir first. Files the app only *opens* are never rewritten; the first real edit normalises formatting (tabs → 2 spaces, bullet markers alternate `*`/`-`).
- The vault is on NFS: saves can take 0.3–4 s and chokidar may double-fire. Echo suppression is by mtime (`Autosave.settled()`). This applies to the packaged app exactly as to dev — same main-process fs, same libuv.
- The main process has no path jail (owner's choice): any absolute path the user can read or write, the app can too.
- Linear project: https://linear.app/growprofit/project/milkdown-382fb0a0cd6a — initial build was GRO-1959.
