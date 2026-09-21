#!/usr/bin/env python3
"""Generate the YAZ-1679 'Settings Panel' demo vaults.

Throwaway, self-contained, stdlib only. Re-running wipes and rebuilds the vault folders.
Three vaults exist ONLY so the Sync page's three repo hints can each be seen:

  Settings Panel YAZ-1679                 plain folder  -> "isn't a git repo"
  Settings Panel YAZ-1679 (git no remote) git init      -> "no GitHub remote"
  Settings Panel YAZ-1679 (git remote)    fake remote   -> "repo <url> · branch <b>"  (never turn sync ON here)

Everything under DEMO/<vault> is wiped on each run — the app profile and launcher live OUTSIDE
the vault folders (YAZ-1656 gotcha).
"""
import shutil
import subprocess
import sys
from pathlib import Path

DEMO = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path("/Users/yasin/Desktop/yaz-1679-demo")
MAIN = DEMO / "Settings Panel YAZ-1679"
GIT_NO_REMOTE = DEMO / "Settings Panel YAZ-1679 (git no remote)"
GIT_REMOTE = DEMO / "Settings Panel YAZ-1679 (git remote)"


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.lstrip("\n"), encoding="utf-8")


LOREM = (
    "The settings dialog replaces the old popover. This paragraph exists so content width, line "
    "spacing and block gap have something to push around. It keeps going for a while so a narrow "
    "column wraps many times and a full column wraps only once or twice on a wide window. "
)


def long_article() -> str:
    parts = ["# Long article for width and spacing\n", "Open **Settings › Appearance** and flip each control while watching this note.\n"]
    for i in range(1, 9):
        parts.append(f"## Section {i}\n")
        parts.append(LOREM * 3 + "\n")
        parts.append(f"* bullet one in section {i}\n* bullet two, a bit longer so it wraps on narrow width: " + LOREM + "\n  * nested child\n    * nested grandchild\n")
        parts.append("> A blockquote so the gap between block types is visible too.\n")
    parts.append("## A table\n\n| Setting | Where | Notes |\n|---|---|---|\n| Theme | Appearance | System / Light / Dark |\n| Content width | Appearance | Narrow / Medium / Full |\n| Line spacing | Appearance | 1.0 – 2.0 |\n")
    parts.append("## Code\n\n```ts\nexport const SETTINGS_SECTIONS = [/* one registry, one truth */]\n```\n")
    parts.append("Last paragraph. " + LOREM + "\n")
    return "\n".join(parts)


def dark_mode_check() -> str:
    return """
# Dark mode check

Switch **Settings › Appearance › Theme** between System, Light and Dark while this dialog is still open.

- The dialog itself must recolour instantly (nav, pane, search box, buttons, hairlines).
- The editor behind the overlay must recolour too.
- ==Highlighted text== and `inline code` and a [link](https://example.com) should stay readable.
- **Bold**, *italic*, ~~strike~~.

| Column | Value |
|---|---|
| border | var(--border) |
| accent | var(--accent) |

> Quote block in both themes.

```json
{ "theme": "dark" }
```
"""


def deep_bullets() -> str:
    return """
# Deep bullet threading

Open **Settings › Editor**. Toggle *Bullet threading*, change *Thread width* and *Thread colour* while watching the guide lines here.

* Level 1
  * Level 2
    * Level 3
      * Level 4
        * Level 5
          * Level 6 — the deepest thread
* A single-child chain
  * only child
    * only grandchild
* A long wrapped bullet: it keeps going and going so that the thread line has to span more than one visual line of text when the content width is narrow, which is exactly the case where thread rendering used to look odd.
  * child after the long one
* [ ] task bullet
  * [x] done child
1. numbered sibling
   1. nested numbered
      * bullet under numbered
*
* the bullet above is empty on purpose
"""


def comments_note(name: str, n: int) -> str:
    items = []
    for i in range(n):
        items.append(
            f"  - id: c{i:02d}\n    at: 2026-09-1{i % 9}T1{i % 9}:0{i % 6}:00Z\n    body: Comment number {i + 1} — written at hour 1{i % 9}"
        )
    if n >= 3:
        items[1] += "\n    reply_to: c00"
        items[2] += "\n    pinned: true"
    return f"---\ntitle: {name}\ncomments:\n" + "\n".join(items) + f"\n---\n\n# {name}\n\nOpen **Settings › Editor › Comments** and flip Oldest first / Newest first. The comments block below must reorder live. The comment block's own header toggle must ALSO update the setting in the dialog (two writers, one setting).\n"


def dangling(where: str) -> str:
    return f"""
# Source note in {where}

Open **Settings › Files & Links › Default location for new notes**, pick an option, then click a link below that has no note yet. Watch WHERE the new note lands in the sidebar.

- [[Brand new note from {where}]]
- [[Another new one {where}]]
- [[Name with spaces and émojis ✨ {where}]]

Try each of the three options, and for "In the folder specified below" try these values:

- `Inbox` (exists)
- `folder 1/folder 2` (exists, the placeholder example)
- `Née Notes ✨` (exists, unicode + space)
- `Made Up/Deeper` (does NOT exist — what happens?)
- `/absolute` → must be rejected, input turns red, stored value kept
- `../up` → rejected
- `a//b` → rejected
- `.` → rejected
- empty → rejected
"""


def scenarios() -> str:
    return """
# 00 START HERE — Scenarios

This vault exists only to stress-test the new **Settings dialog** (YAZ-1679). Nothing else matters here.

## Open it three ways
1. Click the cog at the bottom-left of the sidebar.
2. Press **⌘,** anywhere.
3. Menu bar → **Yaseen Docs › Settings…**
4. Collapse the sidebar (View › Toggle Sidebar), then **⌘,** — it must still open.

## Shell
5. **Esc** closes. Click on the dark backdrop closes. The × top-right closes.
6. Close it → keyboard focus goes back to where it was (tab into the editor first, open, close, keep typing).
7. Make the window very short and narrow → the dialog shrinks, the right pane scrolls, nothing overflows.
8. It is ONE scrolling page: scroll the right pane by hand → the left nav highlight follows the section you are in. Click a nav item → it scrolls to that heading.
9. **⌘⇧N** for a second window. Change Theme in one → the other window updates live. Open the dialog in both.

## Sections (H1) and groups (H2)
10. *Appearance* → open `Appearance/Long article for width and spacing` first, flip Theme / Content width / Line spacing / Space between blocks.
11. *Appearance › Theme* → open `Appearance/Dark mode check` and switch to Dark with the dialog open. Dialog + editor both recolour.
12. *Editor › Bullet threading* (one group: Show / Line width / Line colour) → open `Editor/Deep bullet threading`, toggle, change width, pick a colour, press **Default** (disabled once already default).
13. *Editor › Comments › Order* → open `Editor/Comments oldest vs newest`. Flip the order in the dialog, then flip it from the comment block's own header. Both stay in sync.
14. *Files & Links › Confirm before deleting* → right-click `Files and Links/Delete me 1` → Delete. With it **On** you get the sheet; tick "Don't ask me again" → reopen Settings, it now shows **Off**. Turn it back On.
15. *Files & Links › Default location* → follow the instructions inside `Files and Links/Dangling links (vault root)` and `Files and Links/nested/deeper/Dangling links (deep folder)`.
16. *Sync* → this vault is NOT a git repo, read the hint. Then File › Open Recent → the *(git no remote)* vault → different hint. Then *(git remote)* → shows repo + branch. **Do not turn sync ON in the (git remote) vault** (fake remote).
17. *Hotkeys* → below a divider in the left nav, its OWN page (not on the scrolling settings page). All four groups (Keyboard / Views / Window / Mouse) are there. Click *Appearance* on the left → back to the settings page, scrolled to Appearance. The old keyboard button is gone from the footer.

## Search (top of the nav)
18. Type `dark` → only the Theme row, under an "Appearance" heading. Click Dark right there in the result.
18b. Type `threading` → the three threading rows under "Editor › Bullet threading".
19. Type `width` → Content width AND Thread width, under two headings.
20. Type `trash` → Confirm before deleting (matched by its hint).
21. Type `close tab` → the Hotkeys entry.
22. Type `github` → Sync row (only when a vault is open).
23. Type `zzz` → "No settings match".
24. With text in the box, **Esc** once clears it (back to your page), **Esc** again closes.
25. With text in the box, click a nav item → the search clears and the page scrolls to that section.

## Things to look for
- Any row without a hairline, any control that wraps badly at 760px wide.
- Any place the old popover styling leaks (sidebar footer, hotkeys).
- Anything that takes more than one click that used to take one.
"""


def build_main() -> None:
    if MAIN.exists():
        shutil.rmtree(MAIN)
    write(MAIN / "00 START HERE - Scenarios.md", scenarios())
    write(MAIN / "Appearance" / "Long article for width and spacing.md", long_article())
    write(MAIN / "Appearance" / "Dark mode check.md", dark_mode_check())
    write(MAIN / "Editor" / "Deep bullet threading.md", deep_bullets())
    write(MAIN / "Editor" / "Comments oldest vs newest.md", comments_note("Comments oldest vs newest", 6))
    write(MAIN / "Editor" / "Comments single.md", comments_note("Comments single", 1))
    write(MAIN / "Editor" / "Comments none.md", "# Comments none\n\nNo comments here. Flipping the order setting must not touch this file.\n")
    write(MAIN / "Files and Links" / "Dangling links (vault root).md", dangling("vault root"))
    write(MAIN / "Files and Links" / "nested" / "deeper" / "Dangling links (deep folder).md", dangling("deep folder"))
    for i in range(1, 6):
        write(MAIN / "Files and Links" / f"Delete me {i}.md", f"# Delete me {i}\n\nDelete this via right-click to test *Confirm before deleting*.\n")
    write(MAIN / "Files and Links" / "Delete this folder" / "inside 1.md", "# inside 1\n")
    write(MAIN / "Files and Links" / "Delete this folder" / "inside 2.md", "# inside 2\n")
    # Target folders for "Default location for new notes → In the folder specified below".
    write(MAIN / "Inbox" / "About this folder.md", "# Inbox\n\nNew notes land here when the folder setting says `Inbox`.\n")
    write(MAIN / "folder 1" / "folder 2" / "About this folder.md", "# folder 2\n\nThe placeholder example path.\n")
    write(MAIN / "Née Notes ✨" / "About this folder.md", "# Née Notes ✨\n\nUnicode + space folder.\n")


def build_git(vault: Path, remote: str | None) -> None:
    if vault.exists():
        shutil.rmtree(vault)
    kind = "git repo WITH a fake remote" if remote else "git repo with NO remote"
    write(vault / "README.md", f"# {vault.name}\n\nThis vault is a {kind}. Open **Settings › Sync** and read the hint.\n\n{'**Do not turn sync ON here** — the remote is fake.' if remote else ''}\n")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=vault, check=True)
    subprocess.run(["git", "-c", "user.email=demo@example.com", "-c", "user.name=demo", "add", "-A"], cwd=vault, check=True)
    subprocess.run(["git", "-c", "user.email=demo@example.com", "-c", "user.name=demo", "commit", "-q", "-m", "demo"], cwd=vault, check=True)
    if remote:
        subprocess.run(["git", "remote", "add", "origin", remote], cwd=vault, check=True)


if __name__ == "__main__":
    DEMO.mkdir(parents=True, exist_ok=True)
    build_main()
    build_git(GIT_NO_REMOTE, None)
    build_git(GIT_REMOTE, "https://github.com/example/settings-panel-demo.git")
    for v in (MAIN, GIT_NO_REMOTE, GIT_REMOTE):
        print(f"built {v}")
