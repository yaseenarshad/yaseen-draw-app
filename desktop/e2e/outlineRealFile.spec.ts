/**
 * THE REAL SHAPE, end to end (YAZ-975 — the proof YAZ-964 demanded): `AI Curriculum.md` is a
 * line-for-line stand-in for the vault file that hit the bug (fixtures/curriculum-vault) — the
 * words are placeholders, the structure is verbatim: 123 outline lines including the 24
 * `1.`-spelled ones the seed used to drop, the escaped `1\)` / `\*` / `\=` survivors, inline
 * `<u>` HTML and one `<br />` spacer. YAZ-1329
 * canonicalizes the numeric same-line escape away on the first real save; the other escapes stay.
 *
 * WHAT IS PROVEN, in order (serial — each step continues the last):
 *   1 open: every line the grammar parses RENDERS (123 bullets, the once-dropped spellings among
 *     them) — and opening alone writes NOTHING (the on-disk outline is byte-identical after the
 *     editor has mounted, so a mere look can never be the edit that destroys)
 *   2 one real edit: a line typed at the end lands on disk as line 124, and EVERY original line's
 *     text survives around it — compared whole-array, escape-insensitively, because the commit
 *     keeps same-line `1.` visible without an escape (YAZ-1329) and the `<br />` spacer as an empty bullet (Decision A);
 *     the file stays frontmatter-only
 *   3 quit → relaunch: the converged spelling reloads to the same 124 rendered lines — the
 *     round-trip is a fixed point, not a slow mutation
 *
 * The guard (YAZ-974) has no scenario here BY DESIGN: after the escape there is no known construct
 * left that loses a line, so the read-only path is pinned by fault injection in
 * `client/src/views/view/outlineSeedGuard.test.tsx` instead of by shipping a hole to trip on.
 */
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFrontmatter, splitFrontmatter } from '../../shared/frontmatter'
import { appWindow, bulletAfterLine, caretAtEndOfLine, copyVault, launchApp, outlineLineIndex, outlineLines, quitApp, seededState, shoot, writeOutlineLine } from './helpers'

test.describe.configure({ mode: 'serial' })

const FIXTURE = path.join(__dirname, 'fixtures', 'curriculum-vault')
const FILE = 'AI Curriculum.md'
/** `outlineDoc.ts`'s BULLET_LINE, verbatim — the spec counts lines with the grammar's own eyes. */
const BULLET_LINE = /^(([ \t]*)[-*+](?:[ \t]+|(?=\r?$)))(.*?)[ \t]*\r?$/

/** Once-dropped spellings (YAZ-964's casualties) that must now be ON SCREEN, verbatim. */
const ONCE_DROPPED = [
  '1. Title > Promise > Intro > Temp Check',
  '2. Gauge the Audience - Questions',
  '4. Level 1) Human (Good old Meat Machines)',
]
/** An escaped survivor and the spacer: rendered without the backslash, and as an empty bullet. */
const ESCAPED_SURVIVOR = '1) have a subscription?'
const SPACER = '<br />'
const ADDED = 'added end to end, and every original line survived'

let userData: string
let vault: string
let app: ElectronApplication
let win: Page
/** The fixture's outline lines as shipped — read once, the yardstick every step measures against. */
let originalOutline: string
let originalTexts: string[]

const layer = (w: Page) => w.locator('.tabstack__layer:not(.tabstack__layer--hidden)')
const contents = (w: Page) => layer(w).locator('.folder-page-contents')

const outlineOnDisk = async (): Promise<string> => {
  const { frontmatter } = splitFrontmatter(await readFile(path.join(vault, FILE), 'utf8'))
  const settings = (parseFrontmatter(frontmatter).properties.folder_page_settings ?? {}) as { views?: { type?: string; outline?: string }[] }
  return settings.views?.find((v) => v.type === 'outline')?.outline ?? ''
}

const textsOf = (outline: string): string[] =>
  outline
    .split('\n')
    .map((line) => BULLET_LINE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[3])

test.beforeAll(async () => {
  userData = await mkdtemp(path.join(tmpdir(), 'realfile-userdata-'))
  vault = await copyVault(FIXTURE)
  originalOutline = await outlineOnDisk()
  originalTexts = textsOf(originalOutline)
  expect(originalTexts).toHaveLength(123)
})

test.afterAll(async () => {
  await app?.close().catch(() => undefined)
  await Promise.all([userData, vault].filter(Boolean).map((dir) => rm(dir, { recursive: true, force: true })))
})

test('step 1 — every line renders, the once-dropped spellings included, and opening writes nothing', async () => {
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FILE)) })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()

  await expect(outlineLines(contents(win))).toHaveCount(123)
  for (const text of ONCE_DROPPED) expect(await outlineLineIndex(contents(win), text)).toBeGreaterThanOrEqual(0)
  // The escape renders INVISIBLY: the survivor shows without its backslash.
  expect(await outlineLineIndex(contents(win), ESCAPED_SURVIVOR)).toBeGreaterThanOrEqual(0)
  await shoot(win, 'realfile-01-all-lines-render')

  // A mere OPEN is not an edit: the document on disk is byte-identical to what shipped.
  expect(await outlineOnDisk()).toBe(originalOutline)
})

test('step 2 — one edit writes line 124 and every original line survives on disk', async () => {
  await caretAtEndOfLine(win, contents(win), 122)
  await bulletAfterLine(win, contents(win), 122)
  await writeOutlineLine(win, ADDED)

  await expect.poll(async () => (await outlineOnDisk()).includes(ADDED), { timeout: 10_000 }).toBe(true)
  const committed = textsOf(await outlineOnDisk())
  expect(committed).toHaveLength(124)

  // EVERY original line, in order, then the new one — compared escape-insensitively, because the
  // commit converges to YAZ-1329's visible same-line spelling, and the `<br />` spacer
  // serialises as the empty bullet it renders as (Decision A). Nothing else may change.
  const spelledAsCommitted = (text: string): string => (text === SPACER ? '' : text.replace(/\\/g, ''))
  expect(committed.map((text) => text.replace(/\\/g, ''))).toEqual([...originalTexts.map(spelledAsCommitted), ADDED])

  // Numeric same-line text is canonical without an escape; visible delimiters and text survive.
  const outline = await outlineOnDisk()
  expect(outline).toContain('1. Title > Promise > Intro > Temp Check')
  expect(outline).toContain('4. Level 1) Human (Good old Meat Machines)')
  expect(outline).toContain('1) have a subscription?')
  // The file is still title → outline: frontmatter, and nothing after it.
  expect((await readFile(path.join(vault, FILE), 'utf8')).trimEnd().endsWith('---')).toBe(true)
  await shoot(win, 'realfile-02-edit-preserves-all')
})

test('step 3 — relaunch: the converged spelling reloads to the same document', async () => {
  await quitApp(app)
  app = await launchApp({ userData, seedState: seededState(vault, path.join(vault, FILE)) })
  win = await appWindow(app, 'w1')
  await expect(contents(win)).toBeVisible()

  await expect(outlineLines(contents(win))).toHaveCount(124)
  for (const text of [...ONCE_DROPPED, ESCAPED_SURVIVOR, ADDED]) expect(await outlineLineIndex(contents(win), text)).toBeGreaterThanOrEqual(0)
  await shoot(win, 'realfile-03-relaunch-stable')
})
