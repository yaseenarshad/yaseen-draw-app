# Yaseen Draw

> Seeded from yaseen-docs-app @ 66c9806

Yaseen Draw — a local markdown editor for a folder of notes (e.g. an Obsidian vault), as an Electron macOS desktop app: a React renderer running [Milkdown Crepe](https://milkdown.dev/), and a main process that reads and writes the files on this machine (the renderer only ever talks to the `window.yaseenDraw` bridge — there is no server of any kind). Pick a folder, browse its `.md` files in the sidebar, edit WYSIWYG, and changes are saved back to disk (debounced, atomic). Files changed outside the app (another editor, sync) are reloaded live; if you have unsaved edits you get a Reload / Keep mine choice. YAML frontmatter is preserved byte-for-byte. Lineage in one line: product behaviour follows Obsidian, the transport mechanism follows VS Code (sandboxed renderer + typed preload bridge + main-process fs).

## Requirements

Node.js 20.19 or newer (22+ recommended), npm, macOS (the packaged app targets macOS arm64; the dev build runs wherever Electron does).

## Run

```sh
npm install
npm run dev      # launches the Electron app with HMR
```

See `LAUNCH.md` for the full launch recipe (state file, packaged-app install, agent verification).

```sh
npm test         # unit tests (vitest, four projects: client jsdom, desktop node, tools node, perf jsdom)
npm run typecheck
npm run build    # electron-vite build into desktop/out
npm run e2e      # 44 Playwright-Electron specs driving the real app
```

## Build the app

```sh
npm run desktop:build
```

produces `desktop/dist-app/mac-arm64/Yaseen Draw.app` and `desktop/dist-app/Yaseen Draw-0.3.0-arm64.dmg` (arm64, ad-hoc signed). Drag the `.app` into `/Applications`, or send someone the dmg.

## Sharing it

Every packaged version is downloadable from the repo's [Releases page](https://github.com/yaseenarshad/yaseen-draw-app/releases) — the `.dmg` for a Mac (Apple Silicon), the `-win-x64-setup.exe` for Windows — no build toolchain needed on the installing machine.

The Mac app is ad-hoc signed, not notarized, so on someone else's Mac (macOS 15) the first open is blocked with "Apple could not verify…". Once: open **System Settings › Privacy & Security**, scroll to the blocked-app notice, click **Open Anyway**, and confirm. After that it opens normally. The Windows installer is unsigned, so SmartScreen shows "Windows protected your PC" the first time: click **More info › Run anyway**, once.

GitHub sync uses the computer's own git, found at a fixed set of locations rather than on `PATH` (`desktop/src/main/git/exec.ts`): on a Mac the Command Line Tools or Homebrew git, on Windows [Git for Windows](https://git-scm.com/download/win) (its installer bundles the Git Credential Manager, so a one-time GitHub sign-in sticks). Without one, the sync banner says so and offers a setup prompt to paste into an LLM.

## Editing

Lists behave like an outliner (Obsidian / Logseq), see `docs/CONTRACTS.md` "Editor rules" and "Keyboard" for the exact semantics:

- **Fold**: parent bullets get a chevron — and so do `H1`–`H3` headings outside lists, where the chevron collapses the heading's section (everything up to the next same-or-bigger heading). A bullet holding an image folds too: the picture shrinks to a small thumbnail on the line (type before or after it to name it), clicking the thumbnail unfolds it, and an expanded image shows a corner button that folds it back. Collapsed state is remembered per file in the app state file (`~/Library/Application Support/Yaseen Draw/yaseendraw.json`) only — the markdown on disk (and its mtime) is never touched by folding. `⌘↑` / `⌘↓` fold / unfold the bullet or heading section at the caret (Logseq's defaults; a no-op on leaves, native document jump outside both), `⌘⇧U` folds every foldable bullet, `⌘⇧I` unfolds all, and `⌘Z` right after a fold reverts it (folds older than the latest action stay put; `⌘Z` is normal text undo otherwise).
- **Bullet threading** (Roam / Logseq "bullet paths"): the lines from each nested list's top down to the bullet at the caret, and the bullets on that path, take the accent colour and stop at the active bullet. View-only; Settings › Editor › Bullet threading has Show on/off (default on), Line width 1/2/3px and Line colour (Default = the app accent).
- **Keys**: `Tab` indents (no-op on a first sibling), `Shift-Tab` outdents (level 1 → paragraph), `Enter` at the end of a parent creates its first child, `Enter` on an empty item outdents, `Backspace` at the start of an item joins it into the previous line.
- **Tasks**: `⌘Enter` cycles the item(s) under the selection: bullet → `[ ]` → `[x]` → bullet.
- **Marks**: `⌘U` toggles underline (stored as `<u>text</u>`, like obsidian-underline), `⌘⇧X` toggles strikethrough.
- **Images**: Double-click an image for a full-size lightbox that pages through every image on the page (`←` / `→` or the arrows at the bottom).
- **Lines**: `⇧↓` / `⇧↑` select by whole lines (a line = the paragraph, heading, or bullet text, never a wrapped row): mid-line they first take the rest of this line, from a line edge each press adds exactly one more line, never a piece of the next, and going back undoes one press at a time. Folded or zoomed-away lines are skipped, and nothing hidden is ever deleted: `⌫`, `Delete`, typing and `Enter` over such a selection remove only what you can see. A deleted parent bullet's children move up one level (unfold a parent first to delete it with its children).
- **Zoom**: click a bullet's glyph (or `⌘.` at the caret) to zoom into that subtree, Workflowy-style; breadcrumbs at the top zoom back out (`⌘⇧.` = out one level). View-only — the file is never touched.
- **Zoom history**: every zoom in/out is a history entry, so Back returns to the level you were at before an accidental zoom and Forward re-zooms. `⌘Z` right after a zoom reverts it too — `⌘Z` always reverts the single latest view action — bullet fold, heading fold or zoom — and is normal text undo otherwise.
- **Bullet markers**: `-`, `*` and `+` are the same bullet — bullets at the same indent are siblings whatever marker each uses (unified on load; saved as `*` like before).
- **Guide lines**: nested lists draw a vertical line under their parent's glyph; clicking a line collapses the parent bullets directly alongside it or fully expands every parent below them, never the line's owner (caret stays put).
- **Drag**: the 6-dot handle moves a block; with several blocks highlighted, grabbing a handle inside the highlight moves them all together (drop position controls nesting depth). Over a guide line or a fold chevron the handle yields, so those clicks always land.
- **Look**: ● ○ ■ bullet glyphs by depth and Obsidian's default typography (system font, 16px, Obsidian heading scale). Content width is Narrow (1040px), Medium (1440px), or Full (fluid); the page header, editor, folder-page contents, comments, and backlinks stay aligned to that one global setting. Width, line spacing, and the gap between blocks are adjustable in Settings (the cog bottom-left, or `⌘,`); stored in the app state file (every window follows a change live), never in the files. Settings › Hotkeys lists every hotkey.
- **Spelling**: misspellings get the OS squiggle; right-click for suggestions, "Add to Dictionary", and cut/copy/paste.
- **Round-trip**: the first real edit rewrites the file in remark's normalised form (bullet markers, 2-space indent, …); empty items are written as a bare `*` / `* [ ]`. Typing without changes never writes.

### Comments

Every note carries a Linear-style comment stream under its body — after a folder page's contents, before "Linked mentions". It lives in the note's own frontmatter, under one `comments` key, so it travels with the file (sync, rename, Obsidian); no sidecar, nothing else is written. Threads are one level deep (a reply names its top-level parent in `reply_to`; a reply to a reply is filed under the root), a comment can carry an optional one-line title, every comment wears a stable number (`#3`, a reply `#3.1`) that never changes, even after a delete, and folds like a bullet without its header text ever moving (Expand all / Collapse all on the header), and bodies are GitHub-flavoured Markdown, rendered read-only and sanitised. The Properties panel shows the key as Reserved, and it never enters the index or a view column. `⌘Enter` posts; Delete asks first.

For agents: the app ships a command. Right-click a page (or its tab) › **Copy for Agent** and paste the three lines into the agent's chat — the page's path, one sentence saying the app has a command line for its pages, and that command's full path with `--help`. The agent runs `--help` and learns the rest: `yaseendraw comment "<page.md>" --body "…"` (with `--title`, `--reply-to`, `--by`), `comments` (`--json` for the threads), `edit` and `delete` — the last two only on comments an agent wrote (`by`), never yours. It writes exactly what the app writes. Without the command, append by hand: `by: agent`, `n` one past the highest in its run — the page's top-level comments, or that parent's replies — and quote the `id` if it happens to be all digits:

```yaml
comments:
  - id: 3f9a1c2e
    n: 1
    at: 2026-09-11T18:22:31Z
    by: agent
    title: Numbers check
    body: The Q3 figure in the second table is off by one row.
```

## Sidebar and windows

- **Three lenses**: the sidebar shows your vault three ways, switched by the tabs at the top. **Topics** (the default) browses by MEANING — the folder-page tree, Home first, everything else nested under the pages it belongs to, with an Uncategorized section at the bottom for notes that belong nowhere yet. **Files** is the ordinary folder tree on disk — every file, not just the ones the app can open: a file with no in-app viewer (an EPUB, a ZIP, …) is listed muted and a click hands it to the OS default app, as does right-click → Open in ▸ "Default app" on any row. The **♥** tab is your favorites (below). Same vault, three readings; all offer the same right-click menu.
- **Create**: right-click a folder, a file, a topic row, or the blank space under the tree → "New note" / "New folder page" / "New folder" / "New dated folder" (a folder pre-named with today's `MM_DD- `, cursor ready for the title); name it inline (Enter confirms, Esc cancels). Notes get `.md` automatically and open at once; "New folder page" is a note born with `folder_page: true` (any note can be turned into one — or back — from the same menu, and turning back deletes only that key); nothing is ever overwritten.
- **Rename and delete**: both are in the same right-click menu, in both lenses. Renaming edits the name inline and rewrites every `[[wikilink]]` pointing at the note across the vault (a summary notice says how many); deleting moves the file to the system Trash — never a permanent delete — and closes its tabs. A rename or move done OUTSIDE the app (Finder, sync) is detected too and offers to repair the links, always confirm-first.
- **Cut, copy, paste**: right-click a row (or a selection) → **Cut** / **Copy**, then right-click a folder → **Paste** (`⌘X` / `⌘C` / `⌘V` do the same on the selected rows; `⌘V` pastes into the selected folder, beside the selected file, or into the vault root when nothing is selected). One clipboard for the whole app, so you can copy in one window and paste into another vault's window. A copy that lands on an existing name becomes "Note copy.md", then "Note copy 2.md" — pasting into the same folder is how you duplicate; a cut never overwrites, moves tabs and links along like drag-drop, and pastes once. Folders copy whole. The menu itself is six groups: open, clipboard, new, this row, favorites + **Open in ▸** (new window, VS Code, default app, Finder), delete.
- **Search**: `⌘K` searches note titles and aliases across the vault from the sidebar; ↑/↓ pick, Enter opens, ⌘-Enter opens in a background tab.
- **Tabs and windows**: notes open in tabs (`⌃Tab` / `⌃⇧Tab` or `⌘⇧]` / `⌘⇧[` to switch, `⌘W` closes the **tab** — on the last one it empties the window and then closes it). `⌘⇧N` duplicates the window (same folder, same file), `⌘O` opens the vault switcher in the sidebar header (type to filter, `⏎` brings that vault to the front or opens it in a new window), `⌘⇧O` opens a folder, `⌘⇧W` closes the window; File › Open Recent lists the last folders (⌥-click an entry to open it beside the current window). ⌘-click a sidebar file — or right-click → Open in ▸ "New window" — to open it in its own window. Open windows and their tabs are restored on relaunch.
- **Links**: a `yaseendraw://` URL opens that exact note from anywhere (Slack, another app), and inside a note `[[` completes a link to any other note. Finder's Open With also lists Yaseen Draw for `.md`/`.markdown` (as an alternate, never stealing the default handler).
- **Folders start closed**: both trees open fully collapsed on every launch, with your last tab restored. Folders you open are remembered for the session and shared by every window on the vault; quitting forgets them. Opening a note from search, a link or another tab still opens its folders. The double chevron beside the tabs expands or collapses everything on screen.
- **Collapse**: the panel icon in the header hides the sidebar (a floating button on the left edge brings it back); the choice survives reload. Drag the sidebar's right edge to resize it (180–520 px, remembered); drag it well past the minimum to collapse.
- **Paths**: the open file shows in the URL as `#/absolute/path.md`; right-click any row for "Copy path"; a click selects a row, shift-click adds files and folders to the selection, then right-click it for "Copy N paths" (or press ⌘⇧C).
- **Focus**: right-click a folder (or a topic in the Topics lens) → "Focus on folder" / "Focus on topic" and the tree shows only that — shift-select several first for "Focus on N folders". An eye appears beside the collapse button while you are focused; click it to see everything again. Each lens keeps its own focus, and it survives a restart.
- **Favorites**: right-click any file or folder → "Add to favorites" (shift-select several for "Add N to favorites"); a heart toast confirms. The **♥** tab lists them in the order you added them — drag a row up or down to reorder — and a favorited folder opens in place, so a note can show both on its own and inside its folder. Every row keeps the full right-click menu, including Focus, which narrows the ♥ tab on its own. Favorites live in the vault's own `.yaseendraw/favorites.json` and sync with it — turn on GitHub sync and the same list shows up on your other machine; a favorited note that hasn't synced yet simply doesn't show until it arrives. Every window sees the same list, it survives a restart, follows renames and drops out when deleted.

## Folder pages

A **folder page** is an ordinary note that carries `folder_page: true` in its frontmatter. Other notes say they belong to it by naming it in a `folder_pages:` list — `folder_pages: ["[[Metrics]]"]` — and the folder page then shows them all, live, in a database view beneath its own body. That is the whole model: plain frontmatter, no sidecar files, and belonging is decided the way a click is (case-insensitive, alias-aware), so every spelling that would open the page also counts as belonging to it. A note that names nobody shows up under Uncategorized in the Topics lens until it does.

The views live INSIDE the note, under whatever you have written there — never a separate pane, never a separate file:

- **Views**: outline (the default, and the one that only exists here), table, board (kanban), cards and list. The tabs across the top **switch** between them; a folder page's views are not created, renamed or deleted from the toolbar.
- **The outline**: rows are pages, not free text. Click opens, ⌘-click opens in a background tab, a member that is itself a folder page shows its own glyph and direct-member count with a chevron to descend. Drag reorders (top level only); "+ Link a page…" at the bottom adds an existing page as a member, and offers to create one only on an explicit click — Enter never commits free text.
- **Configure**: Sort / Properties menus and a search box, plus grouping and column setup. A Table keeps its header visible while the note scrolls and can freeze its leading visible columns; reorder the column you want to the front, then choose the prefix under Properties → Table. The two freezes compose, and in a grouped Table each section's controls stay visible at the left edge while the columns scroll. A Board has one Board-wide numeric Properties → Board → Column width setting that applies equally to every column, shown in px (280 by default, no fixed maximum). Enter or leaving a changed valid value saves it as a whole pixel with a 180 minimum; invalid or blank input restores without saving, Escape cancels, and untouched older widths below 180 remain readable. Every config change is saved into the folder page's own frontmatter, under the single `folder_page_settings` key — one write, in the note itself.
- **Edit in place**: note properties edit right in table cells and card/list rows — text, numbers, checkboxes, dates, lists and `[[links]]` with completion; an edit rewrites just that one frontmatter key on the member's own note.
- **Board drag**: drag a card to another column to change its group property; the "No value" column removes it.
- **Open from a table or board**: click a card to select it (arrows walk cards like cells); the title or Enter opens the note in this tab, ⌘ a background tab, ⌥ the right panel — the same on a table's name. Right-click a row or card for the page menu.
- **New**: the toolbar's New button (or a group header's "+") creates a member from the folder page's own declaration, parked in the folder the settings name.
- **Built-in columns**: a Table shows the page's title under **Name** (no `.md`) and a `#` that counts from 1 inside every group (Properties → Table → Row numbers, or right-click the `#` header, to hide it). Every folder page is born with one `status` Select — Backlog / Todo / In progress / Done — whether it comes from "New folder page", "Turn into folder page" or the automatic Home; turning a page into a folder page never overwrites settings it already has.
- **Columns**: right-click a Table header to rename it, hide it, add a column to its right or delete it; drag a header to reorder. A rename changes only what the header says — the frontmatter key stays. The Properties panel is two-level: the list shows, hides and reorders; open a row to edit its title, key, type, options, relation and (on a Board) card styling. Delete asks first, then removes the column from this page and the value from every member note.
- **Existing vaults**: `node tools/seedDefaultColumns.mjs --vault <path>` gives folder pages created before the `status` column the same start. It is a dry run by default, `--apply` writes, it refuses a vault that is not a clean git repo, and running it twice changes nothing.
- **Property declarations** (optional): a vault-wide `properties.json` decides which editor a column gets. It is written INTO the vault, at `<vault>/.yaseendraw/properties.json` — the `.obsidian/`-style dotfolder that travels with your notes, so the declarations move with the vault rather than living in app state. Nothing else is ever written into your vault.

Coming from the old `page_type` scheme? `node tools/migrateFolderPages.mjs --vault <path>` converts a vault to this model. It is a dry run by default, refuses to touch anything that is not a clean git repo, is safe to run twice, and writes a full report.

## Out of scope

Tags stay plain text (not resolved into links); `[[wikilinks]]`, by contrast, are live — they resolve, they are clickable, they autocomplete as you type `[[`, and they are rewritten when a note is renamed. There is no browser mode: the app runs only inside Electron. The file layer has no path jail: anything under your user account can be read or written. Distribution is deliberately minimal (locked decisions): no Developer-ID signing or notarization, no auto-update, no Intel or universal builds, no Windows/Linux — all Future issues.

Retired in YAZ-844: Obsidian's `.base` file format. There is no "New base", no `.base` file type, no `![[X.base]]` embed and no ` ```base ` code block — a folder page's own contents block is the only place these views are mounted now.
