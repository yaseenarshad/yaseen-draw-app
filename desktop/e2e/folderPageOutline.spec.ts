/**
 * THE FREE-FORM OUTLINE, end to end (YAZ-904; the surface landed in YAZ-900→903, and ⚡ YAZ-1152
 * finished it): a folder page's outline view is ONE markdown bullet list the user types into — a
 * second Milkdown instance (`OutlineEditor`) holding `views[i].outline` — and it is the WHOLE
 * surface. A member the document does not NAME is not listed beside it any more; it is WRITTEN
 * INTO it (ADOPTION), as a depth-0 `[[link]]` line at the END.
 *
 * WHAT IS PROVEN HERE, and nowhere else: that the document and the vault agree. A line that is
 * exactly one resolving wikilink IS a membership — writing it tags the target's own card, deleting
 * it asks before un-tagging — while every other line is text and means nothing at all. Everything
 * is asserted ON DISK through the shared frontmatter helpers (`folderPageColumns.spec.ts`'s idiom):
 * the outline is a string inside `folder_page_settings`, and a `toContain` over the whole file
 * would pass on a block that had lost half of it.
 *
 * Driven through the REAL app over the committed encyclopedia fixture (`fixtures/bible-vault`), on
 * `Home` — the one folder page that SHIPS an outline `order`, which is what makes the lazy
 * migration visible: `order` is read by nobody and retires with the page's FIRST settings write,
 * which since YAZ-1152 is ADOPTION's own, made before the user has touched a key.
 *
 * ⚡ TOMBSTONE (YAZ-1152), because this file used to be the appended section's own proof: the
 * read-only rows under the editor — `.view-outline__list` / `__row` / `__bullet` / `__link` /
 * `__glyph` / `__count` / `__x` — do not exist. Those selectors match NOTHING, and the two claims
 * they carried moved: membership-not-named is now a LINE of the document (step 1), and cancelling
 * a removal RESTORES that line at the end rather than dropping the page into a section below
 * (step 5, superseding the YAZ-903 "cancel does not put the text back" ruling).
 *
 * ⚡ YAZ-919 CHANGED WHERE THE DOCUMENT COMES FROM, and step 1 is the place that says so: `Home.md`
 * ships a BODY, and a folder page is title → outline now, so that body MOVES into
 * `views[0].outline` on the page's first open — heading marker stripped, blank lines dropped, one
 * bullet per surviving line, the file left frontmatter-only. That prose names NOBODY, so adoption
 * immediately writes all five members in under it. Everything this file proves about link lines
 * then happens ON TOP of that text, which is exactly where a user's link lines live.
 *
 * The arc, in order (serial by design — each step continues the previous state):
 *   1 first open: the migrated body IS the document and ADOPTION appends the five topics to it —
 *     one settings write that also retires `order` — with a TEXT line typed on top of both,
 *     proving user prose and adopted links share one document (and the Table has not moved)
 *   2 `[[` opens the picker; picking a non-member turns the line into a wikilink, writes
 *     `folder_pages` onto the PICKED page's own card, and the page arrives as a Table row
 *   3 Tab indents: the nesting is in the document on disk and in the editor's own DOM (step 7
 *     reads it back after a relaunch)
 *   4 deleting the link line ASKS — the very sheet the × used to open — and CONFIRM un-tags on
 *     disk, drops the Table row, and the line stays GONE: an un-tag in flight is never re-adopted
 *   5 the same deletion CANCELLED keeps the membership, so adoption puts the line straight BACK at
 *     the end of the document — and the next edit never asks again
 *   6 bullets-only (🔒 F3): `# heading` typed in a bullet stays six literal characters
 *   7 quit → relaunch: the text, the nesting and the adopted links are all on the page, not in the
 *     session — byte for byte — and the membership facts read back off the Table
 *
 * DRIVING A PROSEMIRROR FROM PLAYWRIGHT is its own small craft — macOS caret keys, a wikilink's
 * hidden brackets, and ProseMirror's deferred read of the browser's selection all bite — so the
 * craft lives in `helpers.ts` (`outlineCaret` → `caretAtEndOfLine` → `bulletAfterLine` /
 * `writeOutlineLine` / `pickOutlineLink`), shared with every spec that types into an outline. Read
 * its docblock before changing a keystroke here.
 *
 * Nothing here sleeps: every debounced commit (500 ms, `OutlineEditor`'s own) and every adoption
 * write is gated on the disk state or on the UI consequence it causes.
 *
 * Same harness as folderPages.spec.ts (temp `--user-data-dir`, a COPY of the fixture, `outline-`
 * step screenshots).
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import {
  appWindow,
  bulletAfterLine,
  clearOutlineLine,
  copyVault,
  indentOutlineLine,
  launchApp,
  outlineEditor,
  outlineLineIndex,
  outlineLines,
  outlineNested,
  outlineSaid,
  pickOutlineLink,
  quitApp,
  seededState,
  shoot,
  typeOutlineLine,
} from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia. Copied per run; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
const FOLDER_PAGE = 'Home.md'
/**
 * Home's members. The `order` the page ships names these five in this sequence — and ADOPTION's
 * own order, alphabetical by basename through the base collator, happens to be the same, which is
 * why nothing below has to say which of the two it is reading.
 */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']
/** The page this spec tags into Home: a kpi, so it starts a NON-member that already belongs elsewhere. */
const SUBJECT = 'CAC'
const SUBJECT_FILE = path.join('kpis', 'CAC.md')

/**
 * `Home.md`'s own BODY, as the outline DOCUMENT holds it after YAZ-919 moved it there — the
 * `# ` marker stripped, the blank line dropped. As the editor RENDERS it: the code span around
 * `order` is an element, so its backticks are not in the text.
 */
const BODY = [
  'Home',
  'The root of the map. Every folder page below says in its own frontmatter that it belongs here,',
  "and the outline's order is the only thing that decides what comes first.",
]
/** The same three lines as the MIGRATION wrote them — `outlineDoc`'s own spelling, backticks and all. */
const BODY_ON_DISK = [
  '- Home',
  '- The root of the map. Every folder page below says in its own frontmatter that it belongs here,',
  "- and the outline's `order` is the only thing that decides what comes first.",
].join('\n')
/** …and as the EDITOR re-serialises them, once the page has been typed into at all. */
const BODY_COMMITTED = BODY_ON_DISK.split('\n').map((line) => line.replace(/^- /, '* '))
/** The five lines ADOPTION writes under it: depth-0, `serializeOutline`'s own `- ` marker, alphabetical. */
const ADOPTED_ON_DISK = TOPICS.map((name) => `- [[${name}]]`).join('\n')
/** Every name as a LINK LINE — how a membership reads inside the document, and on screen. */
const asLinks = (...names: string[]) => names.map((n) => `[[${n}]]`)

/** The two text lines the document grows; neither is a link, so neither means anything to membership. */
const NOTE = 'Only the lines below that are links mean anything'
const CHILD = 'and this one is nested under it'
/** The unrelated edit step 5 makes after a cancelled removal — the one that must not re-ask. */
const KEPT = 'kept on purpose, and never asked about again'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page

/** The VISIBLE tab layer — every visited tab keeps its own DOM mounted. */
const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')
const viewTabs = (scope: Locator) => scope.locator('.view-tab__btn[role="tab"]')
/** The name cell shows the page TITLE — the basename, never `.md` (YAZ-1513). */
const rowNames = (scope: Locator) => scope.locator('.view-table__link')
/** TOMBSTONE (YAZ-1152): every selector the appended section wore. It is gone, so these match nothing. */
const appendedRows = (w: Page) =>
  w.locator('.view-outline__list, .view-outline__row, .view-outline__link, .view-outline__glyph, .view-outline__count, .view-outline__x, [data-outline-row]')
const sheet = (w: Page) => w.locator('[role="dialog"]')
const sheetBtn = (w: Page, label: string) => sheet(w).locator('.confirm__btn', { hasText: label })
const fileRow = (w: Page, label: string) => w.locator('.tree__row--file').filter({ hasText: new RegExp(`^${label}$`) })

const read = (rel: string) => readFile(path.join(vault, rel), 'utf8')

/** One outline view, as the folder page's frontmatter holds it. */
interface OnDiskView {
  type?: string
  name?: string
  order?: string[]
  outline?: string
}

/** Home's outline VIEW as written — parsed, never string-matched (folderPageColumns.spec.ts's rule). */
async function outlineViewOnDisk(): Promise<OnDiskView> {
  const { frontmatter } = splitFrontmatter(await read(FOLDER_PAGE))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: OnDiskView[] }
  return settings.views?.find((v) => v.type === 'outline') ?? {}
}

/** The stored document itself — `''` while the page still has none (the pre-migration state). */
const outlineOnDisk = async (): Promise<string> => (await outlineViewOnDisk()).outline ?? ''

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'outline-userdata-'))
  vault = await copyVault(FIXTURE)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — first open: the migrated body IS the document, adoption writes the five members into it, and `order` retires', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FOLDER_PAGE)) })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()

  // THE FIRST OPEN, in two writes and no gestures. ⚡ YAZ-919 moves `Home.md`'s body into
  // `views[0].outline` before the editor ever mounts; that prose names NOBODY, so ⚡ YAZ-1152's
  // adoption immediately writes all five members in under it — depth-0 link lines at the END,
  // alphabetical, spelled by `linkNames`. The whole VIEW is asserted as one object, which is how
  // the third fact gets proven at the same time: `order` is GONE. Adoption's commit travels the
  // outline's one door, so it IS the first edit the lazy migration was waiting for — and nothing
  // else about the view moved.
  await expect
    .poll(outlineViewOnDisk, { timeout: 10_000 })
    .toEqual({ type: 'outline', name: 'Outline', outline: `${BODY_ON_DISK}\n${ADOPTED_ON_DISK}` })
  // The body LEFT the file in the same move: frontmatter, and nothing after it.
  expect((await read(FOLDER_PAGE)).trimEnd().endsWith('---')).toBe(true)

  // ON SCREEN it is ONE surface: the prose and the five memberships are bullets of the same
  // editor, which is the whole of YAZ-1152. The read-only rows that used to carry the unnamed
  // members are not merely empty — they do not exist, anywhere in the window.
  await expect(outlineLines(contents(win))).toHaveText([...BODY, ...asLinks(...TOPICS)])
  await expect(appendedRows(win)).toHaveCount(0)
  await shoot(win, 'outline-01-adopted')

  // …and the user's own text lives in the very same document, between the prose and the links.
  await typeOutlineLine(win, contents(win), BODY.length - 1, NOTE)

  // ONE `folder_page_settings` write, debounced 500ms — and the editor re-serialises the WHOLE
  // document, so this is where a line adoption had put there could have been lost: every one of
  // them is still here, in Milkdown's own `* ` spelling, with the typed line among them.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(NOTE)
  const view = await outlineViewOnDisk()
  expect(view.order).toBeUndefined() // still retired: nothing puts [D5] back
  expect(view.name).toBe('Outline') // the view itself is untouched — only its content key moved
  expect(view.outline?.split('\n').filter((l) => l.trim() !== '')).toEqual([
    ...BODY_COMMITTED,
    `* ${NOTE}`,
    ...TOPICS.map((n) => `* [[${n}]]`),
  ])

  // TEXT MEANS NOTHING: the membership set is exactly what it was, so the Table has not moved.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(TOPICS)
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect(sheet(win)).toHaveCount(0)
  await shoot(win, 'outline-02-text-line')
})

test('step 2 — `[[` picks a page, and the LINK LINE tags it on that page’s own card', async () => {
  const before = await read(SUBJECT_FILE)
  expect(before).not.toContain('[[Home]]') // CAC is a kpi and nothing else, before this step

  await bulletAfterLine(win, contents(win), await outlineLineIndex(contents(win), NOTE))
  await pickOutlineLink(win, SUBJECT, 'outline-03-picker')

  // The picker inserts PLAIN TEXT `[[CAC]]` — and that line, being exactly one resolving wikilink,
  // is a membership. The write lands on the PICKED page's card and it ADDS: `[[KPIs]]` survives.
  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).toContain('[[Home]]')
  const after = await read(SUBJECT_FILE)
  expect(after).toContain('[[KPIs]]') // a page belongs to as many topics as it says
  expect(after).toContain('unit: currency') // every other key survives
  expect(after).toContain(`# ${SUBJECT}`) // and the body
  // The DOCUMENT is where the new member stands — typed in by hand, above the five adoption
  // wrote, and it is the only place this folder page mentions CAC at all.
  await expect.poll(() => outlineSaid(contents(win))).toEqual([...BODY, NOTE, `[[${SUBJECT}]]`, ...asLinks(...TOPICS)])
  expect(await outlineOnDisk()).toContain(`* [[${SUBJECT}]]`)
  await expect(appendedRows(win)).toHaveCount(0)

  // The membership set moved, so THIS time the Table did too.
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText([...TOPICS, SUBJECT])
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await shoot(win, 'outline-04-tagged')
})

test('step 3 — Tab indents, and the nesting is in the document itself', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), NOTE), CHILD)
  await indentOutlineLine(win, contents(win), CHILD)

  // The editor's own DOM says it: a bullet list inside a bullet list, which is the only shape the
  // bullets-only lock allows to nest at all.
  await expect(outlineNested(contents(win))).toHaveText([CHILD])
  // And so does the document on disk — two spaces deeper than the line it hangs from.
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(`* ${NOTE}\n  * ${CHILD}`)
  // The link line is a SIBLING of the text, not a casualty of it: still depth 0, still a membership.
  expect(await outlineOnDisk()).toContain(`\n* [[${SUBJECT}]]`)
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  await shoot(win, 'outline-05-nested')
})

test('step 4 — deleting the link line ASKS, and CONFIRM un-tags on disk and leaves it gone', async () => {
  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), `[[${SUBJECT}]]`))

  // The very sheet the hover × used to open — a deletion is a QUESTION, never a write.
  await expect(sheet(win)).toContainText(
    `Remove '${SUBJECT}' from 'Home'? The page is not deleted — its file stays put. It remains in: KPIs.`,
  )
  await shoot(win, 'outline-06-remove-sheet')
  await sheetBtn(win, 'Remove').click()

  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).not.toContain('[[Home]]')
  expect(await read(SUBJECT_FILE)).toContain('[[KPIs]]') // only THIS folder page's entry was dropped
  await expect(sheet(win)).toHaveCount(0)

  // AND IT STAYS GONE. This is adoption's sharpest edge: between the confirm and the index echo,
  // `records` still names CAC — so an un-tag IN FLIGHT is held back, and by the time the echo
  // arrives the page is not a member at all. The Table dropping the row IS that echo…
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText(TOPICS)
  // …and coming back re-MOUNTS the outline, which re-asks adoption's question from scratch against
  // the snapshot that just arrived. Neither the document on disk nor the one on screen names CAC.
  await viewTabs(contents(win)).filter({ hasText: 'Outline' }).click()
  await expect.poll(() => outlineSaid(contents(win))).toEqual([...BODY, NOTE, CHILD, ...asLinks(...TOPICS)])
  expect(await outlineOnDisk()).not.toContain(`[[${SUBJECT}]]`)
  await shoot(win, 'outline-07-untagged')
})

test('step 5 — CANCEL keeps the membership, so the line is RESTORED at the end, and never asked about twice', async () => {
  // Tag it again, so there is a membership to decline dropping — on a line of its own at the very
  // END, which is a DEPTH-0 line: a bullet opened under `NOTE` would be a sibling of the nested
  // `CHILD`, and the deletion below would leave an empty NESTED bullet behind — a shape the seed
  // guard (YAZ-974) refuses to re-display, which would make the re-seed this step is about
  // read-only before it happened. Where the line goes is not what is being proven here.
  await bulletAfterLine(win, contents(win), (await outlineLines(contents(win)).count()) - 1)
  await pickOutlineLink(win, SUBJECT)
  await expect.poll(() => read(SUBJECT_FILE), { timeout: 10_000 }).toContain('[[Home]]')

  await clearOutlineLine(win, contents(win), await outlineLineIndex(contents(win), `[[${SUBJECT}]]`))
  await expect(sheet(win)).toBeVisible()
  await sheetBtn(win, 'Cancel').click()

  // ⚡ THE YAZ-1152 AMENDMENT, superseding the YAZ-903 ruling this step used to pin. Cancel keeps
  // the membership — the member's card was never touched — and a member the document does not name
  // is ADOPTED, so the line comes straight back. Not where it was: at the END, which is where
  // adoption always writes. The editor re-seeds on that write, so the restore is on screen too.
  await expect.poll(() => outlineSaid(contents(win))).toEqual([...BODY, NOTE, CHILD, ...asLinks(...TOPICS), `[[${SUBJECT}]]`])
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(`- [[${SUBJECT}]]`)
  expect((await outlineOnDisk()).trimEnd().endsWith(`- [[${SUBJECT}]]`)).toBe(true)
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  await shoot(win, 'outline-08-cancel-restores-the-line')

  // …and the restore travelled `commit` like every other write, so `prev` advanced: the next
  // keystroke does not re-ask a question already answered. An unrelated edit commits with no sheet.
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), NOTE), KEPT)
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain(KEPT)
  await expect(sheet(win)).toHaveCount(0)
  // Restored ONCE: adoption recomputes its todo against the document it just wrote, so the line it
  // put back is not put back again by the next render.
  expect((await outlineOnDisk()).match(/\[\[CAC\]\]/g)).toHaveLength(1)
})

test('step 6 — bullets-only: `# heading` typed in a bullet is six literal characters', async () => {
  await typeOutlineLine(win, contents(win), await outlineLineIndex(contents(win), CHILD), '# heading')

  // 🔒 F3: the narrowed `list_item` schema makes the markdown input rule DECLINE rather than fire,
  // so the characters stay standing as list text and no heading node is ever created.
  await expect(outlineEditor(contents(win)).locator('h1, h2, h3, h4, h5, h6')).toHaveCount(0)
  await expect(outlineLines(contents(win)).filter({ hasText: '# heading' })).toHaveCount(1)
  await expect.poll(outlineOnDisk, { timeout: 10_000 }).toContain('# heading')
  await shoot(win, 'outline-09-bullets-only')
})

test('step 7 — the document lives on the page, not in the session: it survives quit → relaunch', async () => {
  const document = await outlineOnDisk()
  await quitApp(app) // the REAL quit path: the pending settings write is flushed before exit

  app = await launchApp({ userData }) // NO re-seed: restore is whatever quit wrote
  win = await appWindow(app, 'w1')
  await fileRow(win, 'Home').click()
  await expect(contents(win)).toBeVisible()

  // The text, the nesting, the migrated prose and the adopted links, read back out of the one
  // place they live — BYTE FOR BYTE the document the quit flushed. Adoption ran again on this
  // mount and found nothing to do, which is the other half of the claim: a document that already
  // names every member is never rewritten.
  await expect(outlineLines(contents(win)).filter({ hasText: NOTE })).toHaveCount(1)
  await expect(outlineNested(contents(win)).filter({ hasText: CHILD })).toHaveCount(1)
  await expect(outlineLines(contents(win)).first()).toHaveText(BODY[0])
  await expect(outlineLines(contents(win)).last()).toHaveText(`[[${SUBJECT}]]`)
  expect(await outlineOnDisk()).toBe(document)
  await expect(appendedRows(win)).toHaveCount(0)

  // The membership step 5 declined to drop is still a membership — on the member's own card, and
  // in the Table, which is the surface that answers "who belongs here" independently of the text.
  expect(await read(SUBJECT_FILE)).toContain('[[Home]]')
  await viewTabs(contents(win)).filter({ hasText: 'Table' }).click()
  await expect(rowNames(contents(win))).toHaveText([...TOPICS, SUBJECT])
  await shoot(win, 'outline-10-survives-relaunch')

  await quitApp(app)
})
