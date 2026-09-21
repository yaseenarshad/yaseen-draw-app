/**
 * THE DRAG, END TO END (YAZ-992): a row dragged onto a topic changes what it BELONGS to — and
 * changes nothing else, on screen or on disk.
 *
 * The gesture is `TopicsTree`'s (YAZ-991) over `topicsMove`'s engine (YAZ-990), and its whole
 * claim is a claim about a FILE: dropping a row onto a folder page LOOKS like moving a file
 * between folders and is not one. Nothing leaves its directory; ONE `folder_pages` list on the
 * dragged page's own frontmatter is rewritten, and neither topic is written to at all. So every
 * proof below reads the bytes back: the block that was allowed to change, and — with that block
 * cut out — the WHOLE REST OF THE FILE compared as one string, so a stray re-serialisation of
 * `function: exec`, a lost blank line or a reflowed heading fails here rather than in a vault.
 *
 * The five proofs, each on its OWN copy of the encyclopedia and its own launch — the rules are
 * shared, the state is not, so any one of these runs alone:
 *   1 a MEMBER between topics: CEO leaves Roles for Industries, in the tree and in `CEO.md`
 *   2 a TOPIC under a topic: Industries nests under Roles and takes its members with it — the
 *     expansion is keyed by page path (🔒 D4), so they arrive already open, untouched by this test
 *   3 CANCEL IS NOTHING: the sheet is the only thing that happened; the file is byte-identical
 *   4 an INVALID target: a plain page row never lights up and never accepts a drop — read
 *     mid-drag, with a valid row lit in the same gesture so the negative is not a vacuous one
 *   5 OUT OF UNCATEGORIZED: an unfiled note gains its FIRST belonging — a whole frontmatter block
 *     is born above a body that survives byte for byte
 *
 * Same harness as its siblings (temp `--user-data-dir`, a COPY of the fixture, `topics-drag-` step
 * screenshots), with the seed pre-selecting the Topics lens. Nothing is opened in the main pane on
 * purpose: with no folder page on screen the YAZ-919 body migration never runs, so the only write
 * any of these vaults sees is the move itself — which is what makes "byte-identical" mean it.
 *
 * THE DRAG ITSELF is `board.spec.ts`'s HTML5 drag with one thing added, and the addition is not
 * taste — it is a measured property of driving a drag over CDP (the long version is on
 * `litWhileResting`). Chromium delivers only a FRACTION of a synthetic drag's `dragover` events,
 * so whether the row under the pointer ever hears about the drag is luck: `locator.dragTo` armed
 * its target 117 times in 120 here, and the three misses released onto a row that had never been
 * told a drag was in flight, so the browser refused the drop and no sheet opened. The gesture below
 * therefore RESTS the pointer on the target — reissuing the move, which a real held pointer gets
 * for free — until the row says it accepts. Nothing is skipped and no drop is retried; the same
 * one drop is made, with the highlight the app puts up read on the way past.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, copyVault, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

/** The committed encyclopedia, post-migration. Copied per test; the source is never opened by the app. */
const FIXTURE = path.join(__dirname, 'fixtures', 'bible-vault')
/** The five folder pages the migration made, path-sorted — YAZ-920 stands every one of them at the root. */
const TOPICS = ['Funnel Stages', 'Industries', 'KPIs', 'Problems', 'Roles']

/** The topic a member is dragged OUT of, and its three members in the order the tree draws them. */
const ROLES = ['CEO', 'Head of Sales', 'RevOps Lead']
/** The topic it is dragged INTO — and, in proof 2, the topic that is itself dragged. */
const INDUSTRIES = ['PLG SaaS', 'VC-Backed B2B SaaS']
/** The two `inbox/` notes that carry no `folder_pages` entry at all (🔒 D7). */
const ORPHANS = ['Pipeline Review Notes', 'Positioning Draft']

/** Proof 5's extra loose note, seeded into the COPY — no frontmatter at all, so a block must be BORN. */
const LOOSE = 'Loose Thought.md'
const LOOSE_BODY = '# Loose Thought\n\nNobody filed this. It belongs nowhere until somebody drags it somewhere.\n'

let userData: string
/** Every temp vault this file made, torn down together. */
const vaults: string[] = []
let app: ElectronApplication
let win: Page

// ---------- locators ----------

/** Every row the topic tree renders, in document order — the Uncategorized section included. */
const topicLabels = (w: Page) => w.locator('.sidebar__body .tree__row .tree__label')
const rowFor = (w: Page, label: string) =>
  w.locator('.sidebar__body .tree__row').filter({ has: w.locator('.tree__label', { hasText: new RegExp(`^${label}$`) }) })
const chevron = (w: Page, action: 'Expand' | 'Collapse', label: string) => w.locator(`.sidebar__body [aria-label="${action} ${label}"]`)
/** Whatever is LIT as a drop target right now, by label — the file tree's own `tree__row--drop`. */
const dropTargets = (w: Page) => w.locator('.sidebar__body .tree__row--drop .tree__label')

/** The move sheet, its sentence and its two buttons (YAZ-991 mirrors `ConfirmRemoveMember` exactly). */
const sheet = (w: Page) => w.locator('.confirm', { has: w.locator('#confirm-move-text') })
const sheetText = (w: Page) => w.locator('#confirm-move-text')
const sheetBtn = (w: Page, label: 'Cancel' | 'Move') => sheet(w).locator('.confirm__btn', { hasText: new RegExp(`^${label}$`) })

/** What is on disk at `<vault>/<name>`, or null when it is not there at all. */
const onDisk = (vaultPath: string, name: string): Promise<string | null> => readFile(path.join(vaultPath, name), 'utf8').catch(() => null)
/** The same read, for a file this suite knows is there — so a comparison never gets handed a null. */
const bytes = (vaultPath: string, name: string): Promise<string> => readFile(path.join(vaultPath, name), 'utf8')

/**
 * The file with its `folder_pages:` block cut out — the key line and the `  - …` entries under it,
 * which is the ONE thing a move is allowed to touch. Everything that survives this is what the
 * before/after comparison is really about: other keys, their quoting, the fences, the body.
 */
const minusBelonging = (text: string): string => text.replace(/folder_pages:\n(?: {2}- .*\n)*/, '')

/**
 * The empty columns a folder page's own DECLARATIONS scaffold onto a page that has just joined it
 * (YAZ-999's missing-only reconciliation, for which a membership change is a trigger). `Roles`
 * declares two, so a page dropped onto Roles may gain either or both — a SECOND write, made after
 * the move's and by a different rule, and observably not always the same one (a run may land both,
 * one, or neither before the read below). Cutting them out is what leaves the thing this file is
 * actually about: everything THE MOVE was not allowed to touch, byte for byte, either way.
 */
const minusDeclared = (text: string): string => text.replace(/^(?:function|reports_to): null\n/gm, '')

// ---------- lifecycle ----------

/** A copy of the encyclopedia for one test's exclusive use; torn down with the rest. */
async function ownVault(): Promise<string> {
  const dir = await copyVault(FIXTURE)
  vaults.push(dir)
  return dir
}

/** The window on `vaultPath` with NOTHING open and the Topics lens showing (see the module doc). */
async function openTopics(vaultPath: string): Promise<void> {
  const state = seededState(vaultPath, null)
  state.windows[0].sidebarLens = 'topics'
  app = await launchApp({ userData, seedState: state })
  win = await appWindow(app, 'w1')
}

/** The middle of a row, in window coordinates — where a pointer has to be to be ON it. */
async function centre(row: Locator): Promise<{ x: number; y: number }> {
  const box = await row.boundingBox()
  if (box === null) throw new Error('a row with no box cannot be dragged')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * WHAT IS LIT while the pointer RESTS at `at` — with the move repeated, which is the whole trick
 * of driving an HTML5 drag from Playwright and is used by every gesture below.
 *
 * A real pointer held over a row keeps producing `dragover`: the browser's own drag loop reissues
 * it while the button is down. A SYNTHETIC drag gets only the events dispatched for it, and
 * Chromium delivers a fraction of those — a ten-step `mouse.move` across the sidebar landed THREE
 * `dragover`s in the run that caught this (`dragstart` 1, `dragend` 0: the drag was healthy, the
 * events simply were not all delivered). Whether the row under the pointer ever hears about the
 * drag is therefore luck: `locator.dragTo`, which travels in ONE move, armed the target 117 times
 * in 120 here, and a stepped move can miss too when the last delivered event fell on a row along
 * the way.
 *
 * So the pointer rests: the move is repeated until the tree answers. Repeating is free — a
 * `dragover` changes no document, exactly as `helpers.ts`'s caret click does — and it weakens
 * nothing, because a row that REFUSES the drop has no handler to light it however many arrive.
 * That is step 4's whole proof, and it is made with this same function.
 */
async function litWhileResting(at: { x: number; y: number }): Promise<string[]> {
  await win.mouse.move(at.x, at.y)
  return dropTargets(win).allTextContents()
}

/**
 * ROW ONTO ROW, the drag every proof below makes: press on the row, carry the pointer over to
 * `label`'s row, wait there until the row says it ACCEPTS the drop, release. The same three CDP
 * steps `locator.dragTo` performs, with the resting added (see `litWhileResting`).
 *
 * The wait is an ASSERTION, not a settle: the highlight IS the `dragover` handler the drop needs,
 * so a target that never lights fails here, in the sentence about arming, rather than ten seconds
 * later in a sentence about a sheet.
 */
async function dragRowOnto(source: Locator, target: Locator, label: string): Promise<void> {
  const from = await centre(source)
  const to = await centre(target)
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()
  await win.mouse.move(to.x, to.y, { steps: 10 })
  await expect.poll(() => litWhileResting(to)).toEqual([label])
  await win.mouse.up()
}

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'topicsdrag-userdata-'))
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, ...vaults].map((dir) => rm(dir, { recursive: true, force: true })))
})

// ------------------------------------------------------------------- 1: a member between topics

test('step 1 — a member dragged between topics: one line of its own frontmatter changes, and nothing else', async () => {
  const vault = await ownVault()
  await openTopics(vault)

  // Both topics open BEFORE the drag, so what moves afterwards is the app's answer and not a
  // gesture of this test's: CEO stands under Roles, Industries holds its own two.
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, 'Uncategorized'])
  await chevron(win, 'Expand', 'Industries').click()
  await chevron(win, 'Expand', 'Roles').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Industries', ...INDUSTRIES, 'KPIs', 'Problems', 'Roles', ...ROLES, 'Uncategorized'])
  const before = await bytes(vault, path.join('roles', 'CEO.md'))

  await dragRowOnto(rowFor(win, 'CEO'), rowFor(win, 'Industries'), 'Industries')

  // THE DROP ASKS BEFORE IT WRITES (🔒 YAZ-959). The sentence names all three: the page, the
  // parent THIS row rendered under, and the topic it landed on — and says what is NOT happening.
  await expect(sheet(win)).toBeVisible()
  await expect(sheetText(win)).toHaveText("Move 'CEO' from 'Roles' into 'Industries'? The file stays put — only its folder pages change.")
  await shoot(win, 'topics-drag-01-page-sheet')
  await sheetBtn(win, 'Move').click()

  // THE FILE — the durable half. The block says the new topic and only it…
  await expect.poll(() => onDisk(vault, path.join('roles', 'CEO.md'))).toContain('folder_pages:\n  - "[[Industries]]"\n')
  const after = await bytes(vault, path.join('roles', 'CEO.md'))
  expect(after).not.toContain('[[Roles]]')
  // …and with that block cut out, the two files are the SAME STRING: `function: exec` in place and
  // unquoted, the fences, the heading, the prose, the newlines. One write, one list, nothing else.
  expect(minusBelonging(after)).toBe(minusBelonging(before))
  // The file never left `roles/` either — that is the whole reason the sheet says so.
  expect(await onDisk(vault, path.join('industries', 'CEO.md'))).toBeNull()

  // THE TREE, untouched since the two expands: CEO stands under Industries, first by name, and is
  // gone from Roles. The counts are the same fact said twice.
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Industries', 'CEO', ...INDUSTRIES, 'KPIs', 'Problems', 'Roles', 'Head of Sales', 'RevOps Lead', 'Uncategorized'])
  await expect(rowFor(win, 'CEO')).toHaveCount(1)
  await expect(rowFor(win, 'CEO')).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'Industries').locator('.tree__count')).toHaveText('3')
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('2')
  await expect(dropTargets(win)).toHaveCount(0) // the highlight goes with the drag that made it
  await shoot(win, 'topics-drag-02-page-moved')
  await quitApp(app)
})

// -------------------------------------------------------------------- 2: a topic under a topic

test('step 2 — a topic dragged under a topic nests there, and its members travel with it', async () => {
  const vault = await ownVault()
  await openTopics(vault)

  // Industries is opened at the ROOT first, so its two members are visibly ITS members before the
  // move — and the expansion is keyed by PAGE PATH (🔒 D4), so they will still be open underneath
  // it afterwards without this test touching a chevron again.
  await chevron(win, 'Expand', 'Industries').click()
  await chevron(win, 'Expand', 'Roles').click()
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'Industries', ...INDUSTRIES, 'KPIs', 'Problems', 'Roles', ...ROLES, 'Uncategorized'])
  const before = await bytes(vault, 'Industries.md')

  await dragRowOnto(rowFor(win, 'Industries'), rowFor(win, 'Roles'), 'Roles')

  // A ROOT row stands under nobody, so the sentence names no source — and Industries' OTHER
  // belonging is named instead: `[[Home]]`, which this move leaves exactly where it was.
  await expect(sheetText(win)).toHaveText("Move 'Industries' into 'Roles'? The file stays put — only its folder pages change. It also stays in: Home.")
  await sheetBtn(win, 'Move').click()

  // THE FILE: the list GAINS an entry rather than swapping one, `[[Home]]` still first…
  await expect.poll(() => onDisk(vault, 'Industries.md')).toContain('folder_pages:\n  - "[[Home]]"\n  - "[[Roles]]"\n')
  const after = await bytes(vault, 'Industries.md')
  // …and nothing was written to either TOPIC's own file: belonging is child-declared (YAZ-825).
  expect(await bytes(vault, 'Roles.md')).toBe(await bytes(FIXTURE, 'Roles.md'))
  // The rest of the page, byte for byte — including the whole `folder_page_settings` block, which
  // a re-serialised frontmatter would have been free to reflow and did not.
  expect(minusDeclared(minusBelonging(after))).toBe(minusBelonging(before))

  // THE TREE: Industries is no longer a root — a parent that is not Home takes it off that row
  // (YAZ-920) — and it stands among Roles' members, by name, with PLG SaaS and VC-Backed B2B SaaS
  // still open one rung further in. Nobody expanded anything after the drag.
  await expect(topicLabels(win)).toHaveText(['Home', 'Funnel Stages', 'KPIs', 'Problems', 'Roles', 'CEO', 'Head of Sales', 'Industries', ...INDUSTRIES, 'RevOps Lead', 'Uncategorized'])
  await expect(rowFor(win, 'Industries')).toHaveCount(1)
  await expect(rowFor(win, 'Roles')).toHaveCSS('padding-left', '8px')
  await expect(rowFor(win, 'Industries')).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'PLG SaaS')).toHaveCSS('padding-left', '36px')
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('4')
  await expect(rowFor(win, 'Industries').locator('.tree__count')).toHaveText('2')
  await shoot(win, 'topics-drag-03-folder-nested')
  await quitApp(app)
})

// --------------------------------------------------------------------------- 3: cancel is nothing

test('step 3 — Cancel writes NOTHING: the file is byte-identical and the tree never moved', async () => {
  const vault = await ownVault()
  await openTopics(vault)
  await chevron(win, 'Expand', 'Industries').click()
  await chevron(win, 'Expand', 'Roles').click()
  const settled = ['Home', 'Funnel Stages', 'Industries', ...INDUSTRIES, 'KPIs', 'Problems', 'Roles', ...ROLES, 'Uncategorized']
  await expect(topicLabels(win)).toHaveText(settled)
  const before = await bytes(vault, path.join('roles', 'CEO.md'))

  // The same drop step 1 confirmed — refused this time at the last possible moment.
  await dragRowOnto(rowFor(win, 'CEO'), rowFor(win, 'Industries'), 'Industries')
  await expect(sheetText(win)).toHaveText("Move 'CEO' from 'Roles' into 'Industries'? The file stays put — only its folder pages change.")
  await shoot(win, 'topics-drag-04-cancelled')
  await sheetBtn(win, 'Cancel').click()
  await expect(sheet(win)).toHaveCount(0)

  // The tree is the same list of rows it was before the pointer went down — Industries still holds
  // its own two, Roles still holds its three. Asserting the WHOLE list is how "unchanged" is said
  // once instead of five times, and it is also the round trip that gives a stray write time to land.
  await expect(topicLabels(win)).toHaveText(settled)
  await expect(rowFor(win, 'Industries').locator('.tree__count')).toHaveText('2')
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('3')
  // BYTE-IDENTICAL: not "still says Roles" — the same string, top to bottom.
  expect(await bytes(vault, path.join('roles', 'CEO.md'))).toBe(before)
  await quitApp(app)
})

// ------------------------------------------------------------------------- 4: an invalid target

test('step 4 — a PLAIN page row is no target: it never lights up, and a drop on it opens nothing', async () => {
  const vault = await ownVault()
  await openTopics(vault)
  await chevron(win, 'Expand', 'Roles').click()
  const settled = ['Home', ...TOPICS, ...ROLES, 'Uncategorized']
  await expect(topicLabels(win)).toHaveText(settled)
  const before = await bytes(vault, path.join('roles', 'CEO.md'))

  // `dragRowOnto`'s steps, opened up: this proof has to READ the tree BETWEEN the moves, and it
  // ends on a row that must never arm — so the one thing the helper waits for is the one thing
  // that must not happen here. The resting is the same (`litWhileResting`), and it is what makes
  // the negative mean anything: the plain row is asked over and over and never answers.
  const from = await centre(rowFor(win, 'CEO'))
  const folderPage = await centre(rowFor(win, 'Industries'))
  const otherFolderPage = await centre(rowFor(win, 'KPIs'))
  const plainPage = await centre(rowFor(win, 'Head of Sales'))
  await win.mouse.move(from.x, from.y)
  await win.mouse.down()

  // THE POSITIVE CONTROL, in the same gesture: a folder-page row lights up under the pointer. Without
  // it the negative below would prove only that the drag never started.
  await win.mouse.move(folderPage.x, folderPage.y, { steps: 10 })
  await expect.poll(() => litWhileResting(folderPage)).toEqual(['Industries'])
  await shoot(win, 'topics-drag-05-target-lit')

  // …and a PLAIN page holds no members, so it is no target: the row has no `dragover` handler at
  // all (🔒 D4 of YAZ-959, through `canDrop`), the highlight the pointer brought with it goes out,
  // and NOTHING in the panel is lit — not the row under the pointer, not the one it came from.
  await win.mouse.move(plainPage.x, plainPage.y, { steps: 10 })
  await expect.poll(() => litWhileResting(plainPage)).toEqual([])
  await shoot(win, 'topics-drag-06-plain-row-dead')

  // A DEAD ROW AND A DEAD DRAG LOOK THE SAME from outside, so the drag says it is still in flight:
  // a SECOND folder page lights under the pointer, and goes out again when the pointer comes back
  // to the plain row — where the drop below is attempted.
  await win.mouse.move(otherFolderPage.x, otherFolderPage.y, { steps: 10 })
  await expect.poll(() => litWhileResting(otherFolderPage)).toEqual(['KPIs'])
  await win.mouse.move(plainPage.x, plainPage.y, { steps: 10 })
  await expect.poll(() => litWhileResting(plainPage)).toEqual([])

  // The drop attempt itself: the browser refuses it for us (nothing called `preventDefault`), so no
  // sheet opens — and with no sheet there is nothing that could ever have reached disk.
  await win.mouse.up()
  await expect(sheet(win)).toHaveCount(0)
  await expect(topicLabels(win)).toHaveText(settled)
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('3')
  await expect(dropTargets(win)).toHaveCount(0)
  expect(await bytes(vault, path.join('roles', 'CEO.md'))).toBe(before)
  expect(await bytes(vault, path.join('roles', 'Head of Sales.md'))).toBe(await bytes(FIXTURE, path.join('roles', 'Head of Sales.md')))
  await quitApp(app)
})

// -------------------------------------------------------------------- 5: out of Uncategorized

test('step 5 — an unfiled note dragged onto a topic gains its FIRST belonging and leaves Uncategorized', async () => {
  const vault = await ownVault()
  // Seeded into the COPY before the app ever sees the folder — a note with no frontmatter at all,
  // so the move has no list to edit and a whole block has to be born above the body.
  await writeFile(path.join(vault, LOOSE), LOOSE_BODY)
  await openTopics(vault)

  await chevron(win, 'Expand', 'Roles').click()
  // 🔒 D7: the section expands IN PLACE, and the newcomer waits in it with the two `inbox/` notes.
  // Since YAZ-956 it expands as a MINI FILE TREE — disk folders first, then the loose note sitting
  // at the vault root — so the shape below is disk location, and belonging is still only an entry.
  await expect(rowFor(win, 'Uncategorized').locator('.tree__count')).toHaveText('3')
  await rowFor(win, 'Uncategorized').click()
  await expect(topicLabels(win)).toHaveText(['Home', ...TOPICS, ...ROLES, 'Uncategorized', 'inbox', ...ORPHANS, 'Loose Thought'])

  await dragRowOnto(rowFor(win, 'Loose Thought'), rowFor(win, 'Roles'), 'Roles')

  // Nothing stands above an unfiled row, so the sentence names no source — this drop GAINS a
  // belonging rather than swapping one.
  await expect(sheetText(win)).toHaveText("Move 'Loose Thought' into 'Roles'? The file stays put — only its folder pages change.")
  await sheetBtn(win, 'Move').click()

  // THE FILE, exactly: a fresh block, and BELOW IT the body this test wrote, byte for byte — with
  // YAZ-999's own scaffolding cut out, because a page joining `Roles` also gains Roles' declared
  // columns and that is a separate rule's write, not the drag's (see `minusDeclared`).
  await expect.poll(() => onDisk(vault, LOOSE)).toContain('folder_pages:\n  - "[[Roles]]"\n')
  expect(minusDeclared(await bytes(vault, LOOSE))).toBe(`---\nfolder_pages:\n  - "[[Roles]]"\n---\n${LOOSE_BODY}`)

  // THE TREE: it stands among Roles' members by name, and the section it came from is one shorter —
  // still open, because nothing about this move closed it.
  await expect(topicLabels(win)).toHaveText([
    'Home',
    ...TOPICS,
    'CEO',
    'Head of Sales',
    'Loose Thought',
    'RevOps Lead',
    'Uncategorized',
    'inbox',
    ...ORPHANS,
  ])
  await expect(rowFor(win, 'Loose Thought')).toHaveCount(1)
  await expect(rowFor(win, 'Loose Thought')).toHaveCSS('padding-left', '22px')
  await expect(rowFor(win, 'Roles').locator('.tree__count')).toHaveText('4')
  await expect(rowFor(win, 'Uncategorized').locator('.tree__count')).toHaveText('2')
  await shoot(win, 'topics-drag-07-out-of-uncategorized')
  await quitApp(app)
})
