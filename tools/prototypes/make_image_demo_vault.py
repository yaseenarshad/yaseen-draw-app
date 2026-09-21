#!/usr/bin/env python3
"""Generate the YAZ-1656 'images in the editor' demo vault.

Throwaway, self-contained. Re-running wipes and rebuilds the demo folder.
"""
import os
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Target folder: first CLI argument, else the closeout-era default. EVERYTHING under it is wiped
# and rebuilt on each run — keep an app profile or launcher OUTSIDE it (YAZ-1656 gotcha).
DEMO = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path("/Users/yasin/Desktop/yaz-1656-demo")
VAULT = DEMO / "Images First-Class YAZ-1656"
PRISTINE = DEMO / "pristine"
OUTSIDE = DEMO / "outside.png"

REAL_SRC = Path(
    "/Users/yasin/Documents/GitHub/yaseen-docs-vault/Working-Log/"
    "09_18- LN-Agent-Smeet-Handoff/aws-guide-images"
)

# Distinct bold backgrounds, one per case (index = case number).
PALETTE = {
    0: "#222222",   # generic / outside
    1: "#1E88E5", 2: "#43A047", 3: "#8E24AA", 4: "#F4511E", 5: "#00897B",
    6: "#3949AB", 7: "#C0CA33", 8: "#D81B60", 9: "#6D4C41", 10: "#546E7A",
    11: "#039BE5", 12: "#7CB342", 13: "#5E35B1", 14: "#FB8C00", 15: "#00ACC1",
    16: "#E53935", 17: "#757575", 18: "#9E9D24", 19: "#AD1457", 20: "#F9A825",
    21: "#2E7D32", 22: "#0277BD", 23: "#6A1B9A", 24: "#EF6C00", 25: "#00695C",
    26: "#283593", 27: "#C62828", 28: "#4E342E", 29: "#37474F", 30: "#9C27B0",
    31: "#FF7043", 32: "#26A69A", 33: "#5C6BC0",
}


def fg_for(bg_hex: str) -> str:
    r, g, b = int(bg_hex[1:3], 16), int(bg_hex[3:5], 16), int(bg_hex[5:7], 16)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return "#000000" if lum > 150 else "#FFFFFF"


def font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Pillow < 10
        return ImageFont.load_default()


def make_img(rel: str, w: int, h: int, lines, bg: str, fmt: str | None = None):
    """Draw lines of big centred text on a solid background and save it."""
    path = VAULT / rel if not os.path.isabs(rel) else Path(rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    fg = fg_for(bg)
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    if lines:
        text = "\n".join(lines)
        assert text.isascii(), f"non-ascii in image text (tofu in default font): {text!r}"
        size = max(8, h // (len(lines) + 1))
        f = font(size)
        while size > 6:
            f = font(size)
            bb = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=size // 4)
            if bb[2] - bb[0] <= w * 0.92 and bb[3] - bb[1] <= h * 0.9:
                break
            size = int(size * 0.9)
        bb = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=size // 4)
        x = (w - (bb[2] - bb[0])) // 2 - bb[0]
        y = (h - (bb[3] - bb[1])) // 2 - bb[1]
        d.multiline_text((x, y), text, font=f, fill=fg, align="center", spacing=size // 4)
    # border so edges are visible against any editor background
    d.rectangle([0, 0, w - 1, h - 1], outline=fg, width=max(1, min(w, h) // 100))
    save_kwargs = {}
    ext = (fmt or path.suffix.lstrip(".")).lower()
    if ext in ("jpg", "jpeg"):
        save_kwargs["quality"] = 90
    if ext == "gif":
        img = img.convert("P", palette=Image.ADAPTIVE)
    if ext == "bmp":
        img = img.convert("RGB")
    img.save(path, **save_kwargs) if fmt is None else img.save(path, format=fmt.upper(), **save_kwargs)
    return path


def case_img(n: int, rel: str, w: int, h: int, what: str, expect: str, bg=None, extra=None):
    lines = [f"CASE {n}", what, f"{w}x{h}", expect]
    if extra:
        lines.append(extra)
    return make_img(rel, w, h, lines, bg or PALETTE[n])


def write(rel: str, text: str):
    p = VAULT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
def build():
    if DEMO.exists():
        shutil.rmtree(DEMO)
    for d in [
        VAULT / "Guides" / "images" / "deeper",
        VAULT / "Guides" / "Deep",
        VAULT / "assets" / "images",
        VAULT / "Archive" / "deeper" / "still-deeper",
        VAULT / "images" / "many",
        VAULT / "images" / "real",
        PRISTINE,
    ]:
        d.mkdir(parents=True, exist_ok=True)

    # outside-the-vault escape target
    make_img(str(OUTSIDE), 600, 300,
             ["OUTSIDE THE VAULT", "outside.png", "600x300", "MUST NEVER RENDER IN A NOTE",
              "(also: paste-source for note 2)"], "#000000")

    # ---- Note 1 images -----------------------------------------------------
    case_img(1, "Guides/images/case01-note-relative.png", 600, 300, "note-relative", "SHOULD RENDER")
    case_img(2, "assets/images/case02-root-relative.png", 600, 300, "root-relative", "SHOULD RENDER")
    case_img(3, "Archive/deeper/still-deeper/case03-deep-basename.png", 600, 300,
             "basename-only lookup", "SHOULD RENDER (vault search)")
    case_img(4, "Guides/images/case04-titled.png", 600, 300, "title attribute", "SHOULD RENDER + hover title")
    case_img(5, "Guides/images/case05-wide-1600x400.png", 1600, 400, "preset width |240", "SHOULD RENDER at 240px wide")
    case_img(6, "Guides/images/case06-empty-alt.png", 600, 300, "empty alt, |200", "SHOULD RENDER at 200px wide")
    # 7 remote, 8 missing, 9 app://, 10 blob: -> no files on purpose
    case_img(11, "Guides/images/case11 has space.png", 600, 300, "space in filename", "SHOULD RENDER (%20 form)")
    case_img(12, "Guides/images/CASE12-UPPER.PNG", 600, 300, "UPPERCASE .PNG", "SHOULD RENDER")
    for ext in ("jpg", "gif", "webp", "bmp"):
        case_img(13, f"Guides/images/case13-format.{ext}", 600, 300, f"format: .{ext}", "SHOULD RENDER")
    svg = VAULT / "Guides/images/case13-format.svg"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300">\n'
        '  <rect width="600" height="300" fill="#5E35B1" stroke="#fff" stroke-width="6"/>\n'
        '  <text x="300" y="90" font-family="Helvetica, Arial, sans-serif" font-size="56" font-weight="bold" '
        'fill="#fff" text-anchor="middle">CASE 13</text>\n'
        '  <text x="300" y="150" font-family="Helvetica, Arial, sans-serif" font-size="40" fill="#fff" '
        'text-anchor="middle">format: .svg (hand-written)</text>\n'
        '  <text x="300" y="200" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#fff" '
        'text-anchor="middle">600x300</text>\n'
        '  <text x="300" y="255" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="bold" '
        'fill="#fff" text-anchor="middle">SHOULD RENDER</text>\n'
        '</svg>\n', encoding="utf-8")
    case_img(14, "Guides/images/case14a.png", 200, 120, "14a inline", "BOTH RENDER")
    case_img(14, "Guides/images/case14b.png", 200, 120, "14b inline", "BOTH RENDER", bg="#FFB300")
    case_img(15, "Guides/images/case15-deep-bullet.png", 600, 300, "3 levels deep bullet", "SHOULD RENDER")
    # 16 escape -> outside.png + /etc/hosts, nothing inside vault
    # 17, 18 code -> reuse case01 file
    case_img(19, "Guides/images/case19-wiki-embed.png", 600, 300, "![[wiki embed]]",
             "MUST STAY PLAIN TEXT", extra="if you see this image = BUG")
    case_img(20, "Guides/images/case20-émoji-🙂.png", 600, 300, "unicode filename (e-acute + emoji)", "SHOULD RENDER")
    make_img("Archive/case21-dup.png", 600, 300,
             ["CASE 21", "SHALLOW - THIS ONE SHOULD SHOW", "Archive/case21-dup.png", "600x300"], "#2E7D32")
    make_img("Guides/images/deeper/case21-dup.png", 600, 300,
             ["CASE 21", "DEEP - SHOULD NOT SHOW", "Guides/images/deeper/case21-dup.png", "600x300"], "#C62828")
    case_img(22, "Guides/images/case22-table.png", 400, 200, "inside a table cell", "REPORT WHAT YOU SEE")
    case_img(23, "Guides/images/case23-under-heading.png", 600, 300, "child of a heading bullet", "SHOULD RENDER")
    case_img(24, "Guides/images/case24-huge-4000x1000.png", 4000, 1000, "huge image", "SHOULD RENDER capped at column width")
    make_img("Guides/images/case25-tiny.png", 16, 16, [], "#00695C")
    case_img(26, "Guides/images/case26-linked.png", 600, 300, "image wrapped in a link", "REPORT WHAT YOU SEE")
    case_img(27, "Guides/images/case27-pipes.png", 600, 300, "alt with |pipes| (not a width)", "NATURAL SIZE, alt untouched")

    # ---- Note 4 resize images ---------------------------------------------
    make_img("images/case-resize-small-300x200.png", 300, 200,
             ["RESIZE small", "300x200", "drag handle"], PALETTE[28])
    make_img("images/case-resize-medium-1200x600.png", 1200, 600,
             ["RESIZE medium", "1200x600", "drag handle -> |<w> in file", "dbl-click -> lightbox"], PALETTE[29])
    make_img("images/case-resize-large-3000x1500.png", 3000, 1500,
             ["RESIZE large", "3000x1500", "should be capped to column width", "drag handle -> |<w>"], PALETTE[30])

    # ---- Note 5 many images -----------------------------------------------
    for i in range(1, 61):
        hue_bg = "#%02X%02X%02X" % (
            int(120 + 100 * abs(((i * 37) % 200) / 200 - 0.5)),
            int(60 + (i * 53) % 150),
            int(80 + (i * 91) % 160),
        )
        make_img(f"images/many/many-{i:02d}.png", 200, 100, [f"{i:02d}", f"many-{i:02d}"], hue_bg)

    # ---- Note 7 real photos -----------------------------------------------
    for name in ("aws-logins-explained.png", "aws-proposed-setup.png"):
        shutil.copy2(REAL_SRC / name, VAULT / "images" / "real" / name)

    # ======================= MARKDOWN NOTES ================================
    write("Home.md", """* [[1 - Existing links render]] — 27 static cases: resolution order, widths, formats, broken chips, code blocks, escapes
* [[2 - Paste here]] — paste / drop images into empty bullets (root note)
* [[3 - Paste from a nested note]] — paste from `Guides/Deep/`, link must be root-relative
* [[4 - Resize expand copy]] — resize handle, lightbox, Copy Image, Reveal in Finder, undo
* [[5 - Many images]] — 60 images in one note: scroll smoothness + memory
* [[6 - Round trip]] — edit one line, autosave, diff against pristine copy
* [[7 - Real photos]] — two 1.5MB AWS photos + the original broken Codex `app://` line
""")

    write("Guides/1 - Existing links render.md", """* Case 1 — note-relative `images/…` → resolves to `Guides/images/`. EXPECTED: RENDERS
  * ![Case 1 note-relative](images/case01-note-relative.png)
* Case 2 — root-relative `assets/images/…` (no such folder under `Guides/`). EXPECTED: RENDERS via vault-root fallback
  * ![Case 2 root-relative](assets/images/case02-root-relative.png)
* Case 3 — basename only; the file lives at `Archive/deeper/still-deeper/`. EXPECTED: RENDERS via vault-wide basename search
  * ![Case 3 basename](case03-deep-basename.png)
* Case 4 — title attribute. EXPECTED: RENDERS, hover shows "Hover title text", and the title survives save (check the file)
  * ![Case 4 titled](images/case04-titled.png "Hover title text")
* Case 5 — Obsidian width syntax `|240` on a 1600x400 image. EXPECTED: RENDERS at exactly 240px wide
  * ![Case 5 preset width|240](images/case05-wide-1600x400.png)
* Case 6 — width with EMPTY alt `![|200]`. EXPECTED: RENDERS at 200px wide
  * ![|200](images/case06-empty-alt.png)
* Case 7 — remote https image (needs internet). EXPECTED: RENDERS a 400x250 dog photo
  * ![Case 7 remote](https://picsum.photos/id/237/400/250)
* Case 8 — missing file. EXPECTED: BROKEN CHIP (no crash, no blank space)
  * ![Case 8 missing](images/case08-does-not-exist.png)
* Case 9 — foreign Codex `app://` src. EXPECTED: BROKEN CHIP, src passed through untouched on save
  * ![Generated image 1](app://fs/@fs/Users/nobody/.codex/generated_images/x/exec-1.png "Generated image 1")
* Case 10 — dead `blob:` src, empty alt. EXPECTED: BROKEN CHIP
  * ![](blob:app://yaseen/fd738ed4-4c89-4290-acb9-37592b64206a)
* Case 11 — space in filename, RAW space. EXPECTED: unclear — CommonMark does not allow an unescaped space in a link destination, so this may not parse as an image at all (Obsidian does NOT support this form). Report what you see
  * ![Case 11 space](images/case11 has space.png)
* Case 11b — same file, `%20`-encoded. EXPECTED: RENDERS (this is the form Obsidian writes and supports)
  * ![Case 11b %20](images/case11%20has%20space.png)
* Case 12 — UPPERCASE `.PNG` extension. EXPECTED: RENDERS
  * ![Case 12 UPPER](images/CASE12-UPPER.PNG)
* Case 13 — formats. EXPECTED: ALL FIVE RENDER
  * jpg: ![Case 13 jpg](images/case13-format.jpg)
  * gif: ![Case 13 gif](images/case13-format.gif)
  * webp: ![Case 13 webp](images/case13-format.webp)
  * svg: ![Case 13 svg](images/case13-format.svg)
  * bmp: ![Case 13 bmp](images/case13-format.bmp)
* Case 14 — two images in ONE bullet, 200x120 each. EXPECTED: BOTH RENDER inline, text "and" between them
  * ![Case 14a](images/case14a.png) and ![Case 14b](images/case14b.png)
* Case 15 — image on a grandchild bullet (3 levels). EXPECTED: RENDERS, indented under the grandchild
  * child
    * ![Case 15 deep bullet](images/case15-deep-bullet.png)
* Case 16 — escape attempts. EXPECTED: BOTH BROKEN CHIPS. `outside.png` exists two levels above the vault root and must NEVER show; `/etc/hosts` must never be read
  * ![Case 16 escape](../../outside.png)
  * ![Case 16b escape](../../../../../../etc/hosts)
* Case 17 — fenced code block. EXPECTED: the line stays TEXT inside the code block, no image
  ```
  ![Case 17 code block](images/case01-note-relative.png)
  ```
* Case 18 — inline code. EXPECTED: stays TEXT (monospace), no image: `![Case 18 inline code](images/case01-note-relative.png)`
* Case 19 — wiki embed `![[…]]`. The file EXISTS at `Guides/images/case19-wiki-embed.png`. EXPECTED: PLAIN TEXT (deferred feature). If the image shows, that is a bug
  * ![[case19-wiki-embed.png]]
* Case 20 — unicode filename (é + emoji). EXPECTED: RENDERS
  * ![Case 20 unicode](images/case20-émoji-🙂.png)
* Case 21 — duplicate basename: `Archive/case21-dup.png` (depth 1, GREEN) vs `Guides/images/deeper/case21-dup.png` (depth 3, RED). EXPECTED: the GREEN "SHALLOW" one shows (shallowest match wins)
  * ![Case 21 dup](case21-dup.png)
* Case 22 — image inside a markdown table cell. EXPECTED: renders if tables render images; report what you see
  | column A | column B |
  | --- | --- |
  | ![Case 22 table](images/case22-table.png) | plain text cell |
* ## Case 23 — heading bullet
  * ![Case 23 under heading](images/case23-under-heading.png)
  * ↑ EXPECTED: RENDERS as a child of the heading bullet
* Case 24 — huge 4000x1000 png. EXPECTED: RENDERS, capped at column width (no horizontal scroll, no layout blow-out)
  * ![Case 24 huge 4000x1000](images/case24-huge-4000x1000.png)
* Case 25 — tiny 16x16 png (solid teal square, no text). EXPECTED: RENDERS tiny, not upscaled
  * ![Case 25 tiny 16x16](images/case25-tiny.png)
* Case 26 — link wrapping an image. EXPECTED: unknown — report what you see (image? link? both? clickable?)
  * [![Case 26 linked image](images/case26-linked.png)](https://example.com)
* Case 27 — alt contains pipes that are NOT a width. EXPECTED: RENDERS at natural 600x300, alt text preserved verbatim on save
  * ![Case 27 alt|with|pipes](images/case27-pipes.png)
""")

    write("2 - Paste here.md", """* How to get an image on the clipboard: open `/Users/yasin/Desktop/yaz-1656-demo/outside.png` in Preview → ⌘A → ⌘C. Or take a screenshot straight to clipboard with ⌘⌃⇧4
* Expected after every paste: a new file `assets/images/2 - Paste here-<timestamp>.png` and this line becomes `![name](assets/images/2 - Paste here-<timestamp>.png)` and renders
* Paste #1 on the empty bullet below
*
* Paste #2 on the empty bullet below
*
* Paste #3 on the empty bullet below
*
* paste INSIDE this code block — must NOT create an image (no file written, clipboard text/nothing inserted):
  ```
  paste here, inside the fence
  ```
* drag a PNG from Finder onto this line → expected: same `assets/images/…` save + `![…](…)` inserted
* paste the same image 3 times fast on the next three bullets → expected three DISTINCT files (`-2`, `-3` suffix or distinct timestamps), never an overwrite
*
*
*
* paste plain text still works: copy this sentence, paste on the next bullet, expect plain text and NO file in `assets/images/`
*
* paste an image copied from a web page (right-click → Copy Image in Chrome) → expected: saved locally as png/jpg, NOT an https link
*
* after pasting: check `assets/images/` in Finder (files exist, names match the links), then relaunch the app — every pasted image must still show
""")

    write("Guides/Deep/3 - Paste from a nested note.md", """* This note lives at `Guides/Deep/`. Paste an image on the empty bullet below
*
* EXPECTED link text: `![…](assets/images/3 - Paste from a nested note-<stamp>.png)` — root-relative, NOT `../../assets/images/…`
* EXPECTED render: the pasted image shows here, resolved via the vault-root fallback (there is no `Guides/Deep/assets/`)
* EXPECTED file: `assets/images/` at the vault ROOT gains the file (not `Guides/Deep/assets/images/`)
* Then relaunch the app and reopen this note — still renders
""")

    write("4 - Resize expand copy.md", """* SMALL 300x200 — click to select → corner handle appears → drag inward/outward → release → file line becomes `![…|<w>](…)`. Then ⌘Z → width removed again
  * ![Resize small](images/case-resize-small-300x200.png)
* MEDIUM 1200x600 — drag handle to ~400px → the file shows `|400`-ish; double-click → lightbox at natural size; Esc closes
  * ![Resize medium](images/case-resize-medium-1200x600.png)
* LARGE 3000x1500 — renders capped to column width. Drag handle smaller then larger than the column: never exceeds column, no horizontal scroll
  * ![Resize large](images/case-resize-large-3000x1500.png)
* right-click any image → Copy Image → paste into Slack or Preview (⌘N in Preview) → the same image appears
* right-click any image → Reveal in Finder → Finder opens `images/` with the file selected
* double-click → lightbox; Esc closes; click outside closes; arrow keys do nothing weird
* undo (⌘Z) right after a resize restores the previous width in BOTH the editor and the file
""")

    many = ["* Scroll this note top to bottom, then bottom to top. Expect: no jank, no images popping in late, no blank rows. Then open Activity Monitor → Memory and note the app's footprint; scroll again; it must not keep growing"]
    for i in range(1, 61):
        many.append(f"* many-{i:02d}\n  * ![many-{i:02d}](images/many/many-{i:02d}.png)")
    write("5 - Many images.md", "\n".join(many) + "\n")

    write("6 - Round trip.md", """* This note is at the vault root, so the `images/…` refs below resolve via basename search (files live in `Guides/images/`). That is fine — the point here is BYTE preservation, not rendering
* Case 1: ![Case 1 note-relative](images/case01-note-relative.png)
* Case 2: ![Case 2 root-relative](assets/images/case02-root-relative.png)
* Case 3: ![Case 3 basename](case03-deep-basename.png)
* Case 4: ![Case 4 titled](images/case04-titled.png "Hover title text")
* Case 5: ![Case 5 preset width|240](images/case05-wide-1600x400.png)
* Case 6: ![|200](images/case06-empty-alt.png)
* Case 9: ![Generated image 1](app://fs/@fs/Users/nobody/.codex/generated_images/x/exec-1.png "Generated image 1")
* Case 10: ![](blob:app://yaseen/fd738ed4-4c89-4290-acb9-37592b64206a)
* Case 19: ![[case19-wiki-embed.png]]
* Case 27: ![Case 27 alt|with|pipes](images/case27-pipes.png)
* edit THIS bullet's text, wait for autosave, then diff against pristine: `diff "/Users/yasin/Desktop/yaz-1656-demo/Images First-Class YAZ-1656/6 - Round trip.md" "/Users/yasin/Desktop/yaz-1656-demo/pristine/6 - Round trip.md"` — only your edited line may differ
""")

    write("7 - Real photos.md", """* Real 1536x1024 photo, ~1.4MB, note-relative. EXPECTED: RENDERS capped at column width, loads quickly
  * ![AWS logins](images/real/aws-logins-explained.png)
* Same kind of photo with `|500`. EXPECTED: RENDERS at 500px wide
  * ![AWS proposed setup|500](images/real/aws-proposed-setup.png)
* The ORIGINAL broken line from the AWS Guide, verbatim. EXPECTED: BROKEN CHIP, line unchanged on save
  * ![Generated image 1](app://fs/@fs/Users/yasin/.codex/generated_images/01a0b6fb-5fa5-7802-a570-bdeccdacc405/exec-0cd80b16-88a7-4934-96b8-d7610665497a.png "Generated image 1")
""")

    # ---- pristine copies of every .md --------------------------------------
    for md in sorted(VAULT.rglob("*.md")):
        dst = PRISTINE / md.relative_to(VAULT)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(md, dst)

    # ---- SCENARIOS.md -------------------------------------------------------
    (DEMO / "SCENARIOS.md").write_text("""# YAZ-1656 images-in-editor — test checklist

Vault: `/Users/yasin/Desktop/yaz-1656-demo/Images First-Class YAZ-1656/` — open it in the app, start at `Home`.

## Home
1. All 7 wikilinks open the right note. Expected: no dead links.

## 1 - Existing links render (Guides/)
2. Case 1 note-relative → renders (blue).
3. Case 2 root-relative `assets/images/` → renders (green).
4. Case 3 basename only, file 3 folders deep → renders (purple).
5. Case 4 title attr → renders, hover shows "Hover title text", title still in file after save.
6. Case 5 `|240` on 1600x400 → renders 240px wide.
7. Case 6 `![|200]` empty alt → renders 200px wide.
8. Case 7 https picsum → renders dog photo (internet on). Offline → broken chip, no hang.
9. Case 8 missing file → broken chip.
10. Case 9 `app://` Codex src → broken chip; src unchanged in file after save.
11. Case 10 `blob:` → broken chip.
12. Case 11 raw-space src → report (likely plain text / broken). Case 11b `%20` → renders.
13. Case 12 `.PNG` uppercase → renders.
14. Case 13 jpg / gif / webp / svg / bmp → all five render.
15. Case 14 two images one bullet → both inline, "and" between.
16. Case 15 grandchild bullet → renders, correctly indented.
17. Case 16 `../../outside.png` → broken chip (NOT the black "OUTSIDE THE VAULT" image). `/etc/hosts` → broken chip.
18. Case 17 fenced code → literal text, no image.
19. Case 18 inline code → literal monospace text, no image.
20. Case 19 `![[wiki]]` → plain text; seeing the magenta image = bug.
21. Case 20 `é` + emoji filename → renders.
22. Case 21 duplicate basename → GREEN "SHALLOW" shows, never RED "DEEP".
23. Case 22 image in table cell → report what you see.
24. Case 23 child of `## Heading` bullet → renders.
25. Case 24 4000x1000 → renders capped to column, no horizontal scroll.
26. Case 25 16x16 → tiny square, not upscaled.
27. Case 26 `[![img](…)](url)` → report what you see.
28. Case 27 `alt|with|pipes` → natural size, alt intact in file after save.
29. Save this note untouched, then `diff` against `pristine/Guides/1 - Existing links render.md` → no differences.

## 2 - Paste here (root)
30. Paste image on empty bullet → `assets/images/2 - Paste here-<stamp>.png` created, `![…](assets/images/…)` inserted, renders.
31. Paste inside the fenced code block → NO file created, no image.
32. Drag PNG from Finder onto a line → same save + insert as paste.
33. Paste same image 3x fast → three distinct files, none overwritten.
34. Paste plain text → text only, no file.
35. Paste Copy-Image from Chrome → local file saved (not an https link).
36. Relaunch app → all pasted images still render.

## 3 - Paste from a nested note (Guides/Deep/)
37. Paste → link is `assets/images/3 - Paste from a nested note-<stamp>.png` (root-relative, no `../../`).
38. File lands in ROOT `assets/images/`; image renders from the nested note; survives relaunch.

## 4 - Resize expand copy
39. Click image → handle appears; drag → resizes live; release → file gets `|<w>`.
40. ⌘Z after resize → old width back in editor AND file.
41. Large 3000x1500 → never exceeds column width while dragging.
42. Double-click → lightbox; Esc closes.
43. Right-click → Copy Image → pastes into Preview/Slack.
44. Right-click → Reveal in Finder → correct file selected.

## 5 - Many images
45. Scroll 60 images up and down → smooth, no late pop-in.
46. Activity Monitor memory → stable after repeated scrolling (no runaway growth).

## 6 - Round trip
47. Edit only the last bullet, wait for autosave, run the diff in that bullet → only that line differs (cases 4, 5, 6, 9, 10, 19, 27 byte-identical).

## 7 - Real photos
48. 1.4MB photo renders quickly, capped to column.
49. `|500` photo renders 500px wide.
50. Original Codex `app://` line → broken chip; line byte-identical after save.
""", encoding="utf-8")


if __name__ == "__main__":
    build()
    print("built", VAULT)
