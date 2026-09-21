/**
 * THE OUTLINE DOCUMENT (🔒 D2, YAZ-900): an outline view IS one markdown bullet list, free-form,
 * held as the single string `views[i].outline` — not a list of members with an order beside it.
 * This module owns that string's grammar and NOTHING else reads it as markdown: parse to lines,
 * serialise back, ask one line whether it is a link — and armour a line's text for the two doors
 * that DO re-read it as full markdown (the editor seed and the paste, YAZ-973): `escapeBlockStart`
 * and `escapeOutlineMarkdown`, the one escape rule.
 *
 * DEPTH IS RELATIVE INDENTATION, the outliner rule the editor already follows
 * (`editor/listItemRoundTrip.ts` `unifySiblingMarkers`): a wider indent is exactly ONE level down
 * however wide it is, tabs count as 4 spaces, and `-` / `*` / `+` are one bullet. So a list
 * written by Milkdown (`* `, two spaces), by Obsidian (`- `, tabs) or by hand all read the same.
 * Serialising picks ONE spelling — `- ` at four spaces per level — so a document this app writes
 * is byte-stable through a parse → serialise round-trip.
 *
 * THE LINK RULE is the click rule and no second rule: a line whose text trims to EXACTLY a
 * wikilink and resolves is a link line, everything else is text (`links/folderPages.ts`
 * `entryTarget`). Whether the target is a folder page — or a member at all — is belonging's
 * question, asked elsewhere.
 */
import { entryTarget, isExactWikilink } from '../links/folderPages'
import type { ResolveLink } from '../editor/wikilink/wikilinkPlugin'

/** One bullet: its nesting level (0 = top) and its text — everything after the marker, untouched but for the padding. */
export interface OutlineLine {
  depth: number
  text: string
}

/**
 * A bullet line as three pieces: the whole prefix (so a rewrite can splice by offset), the
 * indentation alone (depth) and the text, trimmed of the trailing whitespace and any `\r`. A bare
 * marker is an empty line; `-foo`, with no gap, is not a bullet at all (nor is it to CommonMark).
 */
const BULLET_LINE = /^(([ \t]*)[-*+](?:[ \t]+|(?=\r?$)))(.*?)[ \t]*\r?$/

/** The canonical spelling written back — one level of nesting. */
const INDENT = '    '

/** Tabs count as four spaces, exactly as the editor's sibling-marker pass measures indentation. */
const widthOf = (indent: string): number => indent.replace(/\t/g, INDENT).length

/** Lines of the bullet list; blank lines, prose and ordered items are not outline lines and are skipped. */
export function parseOutline(markdown: string): OutlineLine[] {
  const lines: OutlineLine[] = []
  // The indent width standing at each depth: a wider one pushes a level, a narrower one pops back.
  const widths: number[] = []
  for (const raw of markdown.split('\n')) {
    const match = BULLET_LINE.exec(raw)
    if (match === null) continue
    const width = widthOf(match[2])
    while (widths.length > 0 && width < widths[widths.length - 1]) widths.pop()
    if (widths.length === 0 || width > widths[widths.length - 1]) widths.push(width)
    lines.push({ depth: widths.length - 1, text: match[3] })
  }
  return lines
}

/** The one canonical spelling: `- ` at four spaces per level, a bare marker for an empty line. */
export function serializeOutline(lines: OutlineLine[]): string {
  return lines
    .map(({ depth, text }) => `${INDENT.repeat(Math.max(0, depth))}-${text === '' ? '' : ` ${text}`}`)
    .join('\n')
}

/** An ordered item opening the line: the digits, then a `.`/`)` delimiter and a space or the line's end. */
const ORDERED_START = /^\d+(?=[.)](?:[ \t]|$))/

/**
 * Every other block opener, defused by ONE backslash before the line's first character: a nested
 * bullet marker, one to six hashes, a quote, a fence, or a thematic break of three or more of the
 * same mark. Seven hashes and `-foo` are no block to CommonMark either, so neither is touched.
 * And one GFM block the CommonMark scan missed (YAZ-974): a footnote DEFINITION, `[^id]: …`, which
 * leaves the list entirely and takes its bullet with it. A plain link reference (`[x]: /url`) is
 * not one and stays literal text in the editor already, so the `^` is what the pattern insists on.
 */
const BLOCK_START = /^(?:[-*+](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|>|```|~~~|\[\^[^\]]*\]:|([-_*])(?:[ \t]*\1){2,}[ \t]*$)/

/** Text that would re-parse as a BLOCK construct inside its bullet — an ordered item (`1. `),
 * a nested marker (`- `), a heading (`# `), a quote (`> `), a fence or a thematic break — gets
 * one backslash so Milkdown reads it as the literal text the outline grammar already says it is. */
export function escapeBlockStart(text: string): string {
  if (ORDERED_START.test(text)) return text.replace(ORDERED_START, '$&\\')
  return BLOCK_START.test(text) ? `\\${text}` : text
}

/** Every bullet line's text in `markdown`, escaped by `escapeBlockStart`; other bytes untouched. */
export function escapeOutlineMarkdown(markdown: string): string {
  return markdown
    .split('\n')
    .map((raw) => {
      const match = BULLET_LINE.exec(raw)
      if (match === null) return raw
      // Splice the text alone: the marker, the indentation and any trailing bytes stay as written.
      const lead = match[1].length
      return raw.slice(0, lead) + escapeBlockStart(match[3]) + raw.slice(lead + match[3].length)
    })
    .join('\n')
}

/** The path this LINE counts for, or null when it is text — the click rule, unchanged. */
export function lineTarget(text: string, resolve: ResolveLink): string | null {
  return entryTarget(text, resolve)
}

/** Names sort the way the base engine sorts them: case- and accent-insensitive, numeric-aware. */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/**
 * The [D5] `order` list as an outline document: one flat wikilink line per entry (verbatim, stale
 * ones included — the outline is free text and nothing here judges them), then every unlisted
 * member, alphabetical by basename. The same arrangement `orderedMembers` produced, frozen into a
 * document ONCE. Pure: the migration that stores the result is its own issue.
 */
export function fromOrder(order: string[] | undefined, unlistedMembers: string[]): OutlineLine[] {
  const rest = [...unlistedMembers].sort(collator.compare)
  return [...(order ?? []), ...rest.map((name) => `[[${name}]]`)].map((text) => ({ depth: 0, text }))
}

/**
 * A rename walking INTO the outline (YAZ-900): every LINE that is exactly a wikilink is offered to
 * `map`, `undefined` meaning leave it — the same leaf contract `mapFolderPageSettingsLinks` uses
 * for an `order` entry, so an outline link and an order entry cannot spell themselves differently.
 * A wikilink inside prose is NOT a leaf and is never touched. Undefined when no line changed;
 * every other byte — markers, indentation, blank lines, prose — survives, since only the link text
 * is spliced.
 */
export function mapOutlineLinks(outline: string, map: (link: string) => string | undefined): string | undefined {
  let changed = false
  const out = outline.split('\n').map((raw) => {
    const match = BULLET_LINE.exec(raw)
    if (match === null || !isExactWikilink(match[3])) return raw
    const next = map(match[3])
    if (next === undefined) return raw
    changed = true
    // Splice the link text alone: the marker, the indentation and any trailing bytes stay as written.
    const lead = match[1].length
    return raw.slice(0, lead) + next + raw.slice(lead + match[3].length)
  })
  return changed ? out.join('\n') : undefined
}

/**
 * A member LEAVING from outside the editor — the Topics drag (YAZ-1364, 🔒 D4): every LINE that is
 * exactly a wikilink resolving to `path` is dropped, the same set the × un-tag counts, and every
 * other byte survives — prose that merely mentions the page, and the children lines beneath a
 * dropped one, which keep their indent. Undefined when no line named it, so the caller writes
 * nothing. Without this the reconcile pass (YAZ-1357) would read the stale line and tag the page
 * straight back into the topic it was just dragged out of.
 */
export function dropOutlineLinks(outline: string, path: string, resolve: ResolveLink): string | undefined {
  const lines = outline.split('\n')
  const kept = lines.filter((raw) => {
    const match = BULLET_LINE.exec(raw)
    return match === null || lineTarget(match[3], resolve) !== path
  })
  return kept.length === lines.length ? undefined : kept.join('\n')
}
