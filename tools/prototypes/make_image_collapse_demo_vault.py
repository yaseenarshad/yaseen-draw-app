#!/usr/bin/env python3
"""Generate the YAZ-1709 'image collapse' demo vault.

Throwaway, self-contained (Pillow only). Re-running wipes and rebuilds the VAULT and PRISTINE
folders under the demo dir; the app profile and launcher next to them are left alone (the
YAZ-1656 gotcha: never wipe the profile with the vault).

    python3 tools/prototypes/make_image_collapse_demo_vault.py [/Users/yasin/Desktop/yaz-1709-demo]
"""
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

DEMO = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else Path("/Users/yasin/Desktop/yaz-1709-demo")
VAULT = DEMO / "Image Collapse Feature YAZ-1709"
PRISTINE = DEMO / "pristine"
PASTE_SOURCE = DEMO / "paste-source.png"
IMG = "assets/images"

PALETTE = [
    "#1E88E5", "#43A047", "#8E24AA", "#F4511E", "#00897B", "#3949AB", "#C0CA33", "#D81B60",
    "#6D4C41", "#546E7A", "#039BE5", "#7CB342", "#5E35B1", "#FB8C00", "#00ACC1", "#E53935",
    "#9E9D24", "#AD1457", "#F9A825", "#2E7D32", "#0277BD", "#6A1B9A", "#EF6C00", "#00695C",
    "#283593", "#C62828", "#4E342E", "#37474F", "#9C27B0", "#FF7043", "#26A69A", "#5C6BC0",
]
_next_color = [0]


def fg_for(bg_hex: str) -> str:
    r, g, b = int(bg_hex[1:3], 16), int(bg_hex[3:5], 16), int(bg_hex[5:7], 16)
    return "#000000" if 0.299 * r + 0.587 * g + 0.114 * b > 150 else "#FFFFFF"


def font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def make_img(path: Path, w: int, h: int, lines, bg=None):
    """Big centred text on a solid background — every image says which case it belongs to."""
    if bg is None:
        bg = PALETTE[_next_color[0] % len(PALETTE)]
        _next_color[0] += 1
    path.parent.mkdir(parents=True, exist_ok=True)
    fg = fg_for(bg)
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    text = "\n".join(lines)
    assert text.isascii(), text
    size = max(8, h // (len(lines) + 1))
    f = font(size)
    while size > 6:
        f = font(size)
        bb = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=size // 4)
        if bb[2] - bb[0] <= w * 0.92 and bb[3] - bb[1] <= h * 0.9:
            break
        size = int(size * 0.9)
    bb = d.multiline_textbbox((0, 0), text, font=f, align="center", spacing=size // 4)
    d.multiline_text(((w - (bb[2] - bb[0])) // 2 - bb[0], (h - (bb[3] - bb[1])) // 2 - bb[1]),
                     text, font=f, fill=fg, align="center", spacing=size // 4)
    d.rectangle([0, 0, w - 1, h - 1], outline=fg, width=max(1, min(w, h) // 100))
    img.save(path)
    return path


def case(n: int, name: str, w: int = 600, h: int = 300, what: str = "", bg=None) -> str:
    """Make `assets/images/<name>.png` and return its root-relative ref."""
    make_img(VAULT / IMG / f"{name}.png", w, h, [f"CASE {n}", what or name, f"{w}x{h}"], bg)
    return f"{IMG}/{name}.png"


def write(rel: str, text: str):
    p = VAULT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.lstrip("\n"), encoding="utf-8")


def build():
    for d in (VAULT, PRISTINE):
        if d.exists():
            shutil.rmtree(d)
    (VAULT / IMG).mkdir(parents=True)

    make_img(PASTE_SOURCE, 900, 500, ["PASTE SOURCE", "copy me in Preview,", "paste onto a bullet", "(case 32)"], "#000000")

    # ---- 01 Basics -------------------------------------------------------
    c1 = case(1, "01-Basics-20260920-090001", what="image-only bullet (paste-style name)")
    c2 = case(2, "01-Basics-20260920-090002", what="custom alt label")
    c3 = case(3, "01-Basics-20260920-090003", what="text BEFORE image")
    c4 = case(4, "01-Basics-20260920-090004", what="text AFTER image")
    c5 = case(5, "01-Basics-20260920-090005", what="EMPTY alt -> src label")
    c6a = case(6, "01-Basics-20260920-090006a", 400, 300, what="two images, A")
    c6b = case(6, "01-Basics-20260920-090006b", 400, 300, what="two images, B")
    write("01 Basics.md", f"""
* Each bullet below holds an image directly. Put the caret on a bullet and press ⌘↑ to fold, ⌘↓ to unfold. Hover the row to see the chevron.
* Case 1 — image-only bullet, auto-named like a paste. Fold it: chip = a small thumbnail, no label; the row stays exactly as tall as a text row.
* ![01-Basics-20260920-090001|400]({c1})
* Case 2 — custom alt text — invisible on the chip; hover the chevron: its tooltip/aria says "Collapse Schedule panel screenshot", and zooming into the bullet shows that name in the breadcrumb.
* ![Schedule panel screenshot|400]({c2})
* Case 3 — text before the image. Folded, the chip sits after the text on one line.
* Schedule button > schedule panel ![Schedule panel|400]({c3})
* Case 4 — text after the image.
* ![Before the text|400]({c4}) and this text comes after
* Case 5 — no alt text: the fold still works; identity falls back to the path.
* ![]({c5})
* Case 6 — two images in ONE bullet. Both shrink together.
* ![Two A|300]({c6a}) ![Two B|300]({c6b})
""")

    # ---- 02 With children -----------------------------------------------
    c7 = case(7, "02-Children-20260920-090007", what="image bullet WITH children")
    c8 = case(8, "02-Children-20260920-090008", what="image bullet inside a parent")
    c9 = case(9, "02-Children-20260920-090009", what="the old habit: Image parent + child")
    write("02 With children.md", f"""
* Case 7 — an image bullet that also has children. ONE chevron: fold hides the children AND shrinks the image.
* ![Case 7 parent|400]({c7})

  * child one
  * child two

    * grandchild
* Case 8 — image bullet nested inside a text parent. Fold the parent: the whole thing hides. Unfold: the image bullet keeps its own fold state.
* Parent text bullet

  * ![Nested image|400]({c8})
  * sibling text bullet
* Case 9 — the OLD habit (Obsidian style): a text bullet "Image" with the image as a child. Folding "Image" hides the child completely, as it always did. Compare with case 7.
* Image

  * ![Old habit child|400]({c9})
""")

    # ---- 03 Sizes --------------------------------------------------------
    c10 = case(10, "03-Sizes-20260920-090010", 80, 40, what="tiny")
    c11 = case(11, "03-Sizes-20260920-090011", 600, 1400, what="TALL |300")
    c12 = case(12, "03-Sizes-20260920-090012", 1600, 200, what="WIDE 1600x200")
    c13 = case(13, "03-Sizes-20260920-090013", what="title attr + |240")
    c14 = case(14, "03-Sizes-20260920-090014", what="resize me, then fold")
    write("03 Sizes.md", f"""
* Case 10 — tiny 80x40 image. The chip is the same fixed box as every other chip.
* ![Tiny|80]({c10})
* Case 11 — tall image at |300. Folded it is one text line; unfolded it comes back at 300 wide.
* ![Tall|300]({c11})
* Case 12 — wide 1600x200 image at |600.
* ![Wide|600]({c12})
* Case 13 — image with a title attribute and |240. Hover title still works when expanded.
* ![Titled|240]({c13} "Hover title")
* Case 14 — drag a handle to resize this one, THEN fold, THEN unfold. Width must come back to what you dragged, and the file must show the new |width.
* ![Resize me|400]({c14})
""")

    # ---- 04 Persistence --------------------------------------------------
    c15 = case(15, "04-Persist-20260920-090015", what="fold, quit, relaunch")
    c16a = case(16, "04-Persist-20260920-090016a", what="SAME alt text, first")
    c16b = case(16, "04-Persist-20260920-090016b", what="SAME alt text, second")
    c17 = case(17, "04-Persist-20260920-090017", what="fold me, then edit above")
    write("04 Persistence.md", f"""
* Fold state lives in the app state file, never in the markdown. Run `diff -r` against the pristine copy after playing: only files you TYPED in may differ.
* Case 15 — fold this, quit the app (⌘Q), run the launcher again. It must still be folded.
* ![Persist me|400]({c15})
* Case 16 — two image bullets with the SAME alt text. Fold only the SECOND one, relaunch: the second stays folded, the first stays open.
* ![Same label|400]({c16a})
* ![Same label|400]({c16b})
* Case 17 — fold the image below, then type new bullets ABOVE it and delete some. The fold must stay put while you edit.
* type new bullets here
* ![Survives edits|400]({c17})
""")

    # ---- 05 Hotkeys and bulk --------------------------------------------
    c18 = case(18, "05-Hotkeys-20260920-090018", what="fold-all target")
    c19 = case(19, "05-Hotkeys-20260920-090019", what="undo the fold")
    c20 = case(20, "05-Hotkeys-20260920-090020", what="guide-line click")
    c21 = case(21, "05-Hotkeys-20260920-090021", what="click the chip")
    c22 = case(22, "05-Hotkeys-20260920-090022", what="find while folded")
    c23 = case(23, "05-Hotkeys-20260920-090023", what="Enter at end")
    c24 = case(24, "05-Hotkeys-20260920-090024", what="zoom breadcrumb")
    write("05 Hotkeys and bulk.md", f"""
* Case 18 — ⌘⇧U folds every parent AND every image bullet in this file. ⌘⇧I opens everything again.
* ![Fold all A|400]({c18})
* A normal parent

  * with a child
* Case 19 — fold the image below with ⌘↑, then press ⌘Z straight away: the fold reverts (no text undo happens).
* ![Undo me|400]({c19})
* Case 20 — click the vertical guide line under this parent: its image-bullet children fold like parents would.
* Guide line parent

  * ![Guide A|300]({c20})
  * ![Guide B|300]({c20})
  * plain text child
* Case 21 — fold this, then CLICK the small chip: the bullet expands. Double-click the expanded image: the lightbox still opens.
* ![Click the chip|400]({c21})
* Case 22 — fold this bullet, then ⌘F for the word "needle". The text stays visible because only the image shrank.
* needle in the haystack ![Find me|400]({c22})
* Case 23 — fold this, put the caret at the very end (after the chip), press Enter: a new empty sibling appears below it.
* ![Enter after me|400]({c23})
* Case 24 — click this bullet's glyph (zoom in). The breadcrumb at the top must say "Zoom breadcrumb label", not "Untitled item".
* ![Zoom breadcrumb label|400]({c24})

  * a child so zoom has something to show
""")

    # ---- 06 Edge cases ---------------------------------------------------
    c26 = case(26, "06-Edge-20260920-090026", what="inside a TASK bullet")
    c27 = case(27, "06-Edge-20260920-090027", what="ordered list")
    c28 = case(28, "06-Edge-20260920-090028", what="outside any list")
    c29 = case(29, "06-Edge-20260920-090029", what="heading bullet")
    c30 = case(30, "06-Edge-20260920-090030", what="SECOND paragraph of a bullet")
    c31 = case(31, "06-Edge-20260920-090031", what="depth 4")
    write("06 Edge cases.md", f"""
* Case 25 — a BROKEN image (file missing). Fold it and see what the chip does with the broken state.
* ![Missing file|400](assets/images/does-not-exist.png)
* Case 26 — image inside a task bullet. ⌘Enter still cycles the checkbox; fold still works.
* [ ] ![Task image|400]({c26})
* Case 27 — image in an ordered list.

1. ![Ordered image|400]({c27})
2. second item

* Case 28 — image in a paragraph OUTSIDE any list. No chevron; ⌘↑ jumps to the top of the document like before.

![Outside lists|400]({c28})

* Case 29 — heading bullet with an image after the heading text.
* # Heading bullet ![Heading image|300]({c29})
* Case 30 — the image lives in the bullet's SECOND paragraph (Shift-Enter style block). Fold shrinks it too.
* first paragraph of the bullet

  ![Second paragraph|400]({c30})
* Case 31 — depth 4. Chevron and chip geometry deep in the gutter.
* one

  * two

    * three

      * ![Depth four|400]({c31})
* Case 32 — paste your own. Open `paste-source.png` (next to this vault) in Preview, ⌘A ⌘C, put the caret on the empty bullet below and ⌘V. Then fold it.
*
""")

    # ---- 07 Gallery / 08 Single image ------------------------------------
    g1 = case(33, "07-Gallery-20260920-090033", what="gallery ONE")
    g2 = case(33, "07-Gallery-20260920-090034", what="gallery TWO")
    g3 = case(33, "07-Gallery-20260920-090035", what="gallery THREE")
    write("07 Gallery.md", f"""
* Case 33 — the lightbox is a gallery of every image on the page, in document order.
* Double-click the SECOND image: the pill at the bottom says `2 / 3` and the caption says "two".
* Press → until the end: `3 / 3`, the right arrow goes dead, another → stays put (no wrap-around).
* Press ← back to the start: `1 / 3`, the left arrow goes dead, another ← stays put.
* Esc closes it and the caret is back where it was.
* ![one|400]({g1})
* ![two|400]({g2})
* ![three|400]({g3})
""")

    s1 = case(34, "08-Single-20260920-090036", what="the only image")
    write("08 Single image.md", f"""
* Case 34 — a page with ONE image. Double-click it: the old lightbox exactly — no pill, no arrows; → and ← do nothing; Esc closes.
* ![solo|400]({s1})
""")

    write("00 Start here.md", """
* Image Collapse Feature (YAZ-1709) — demo vault. Everything in here exists only to test THIS feature.
* How to drive it

  * ⌘↑ folds the bullet at the caret, ⌘↓ unfolds it. Hover a row for the chevron.
  * Folded image = small thumbnail on the line, no label. Click the chip to expand.
  * ⌘⇧U / ⌘⇧I fold / unfold everything. ⌘Z right after a fold reverts it.
* Files, in order

  * 01 Basics — the plain cases
  * 02 With children — image bullets that also have children, and the old "Image" parent habit
  * 03 Sizes — tiny, tall, wide, titled, resize-then-fold
  * 04 Persistence — relaunch, same-label collisions, edits above a fold
  * 05 Hotkeys and bulk — fold-all, undo, guide line, chip click, find, Enter, zoom
  * 06 Edge cases — broken, task, ordered, outside lists, heading, second paragraph, depth 4, paste your own
  * 07 Gallery — three images: the lightbox pages through them
  * 08 Single image — one image: the lightbox with no pill
""")

    shutil.copytree(VAULT, PRISTINE)
    print(f"vault:    {VAULT}")
    print(f"pristine: {PRISTINE}")
    print(f"paste:    {PASTE_SOURCE}")


if __name__ == "__main__":
    build()
