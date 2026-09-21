/**
 * Desktop G1 (GRO-2178): shared harness for the Playwright-Electron smoke suite.
 *
 * The permanent home of the idioms proven in the `node_modules/.verify/*.mjs` throwaways:
 * launch the REAL app (`desktop/out/main/index.js`, run `npm run build` first — `npm run e2e`
 * does) against a temp `--user-data-dir`, seed `<userData>/yaseendraw.json` with a `windows[]`
 * entry to skip the native folder dialog (the locked no-dialog-in-tests rule), and always work
 * on a COPY of a generated fixture vault — the real vault and real app state are never touched.
 */
import { _electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { defaultAppState, defaultRightPanelIdentity, type AppState, type WindowBounds } from '../../shared/types'

export const REPO_ROOT = path.resolve(__dirname, '..', '..')
export const MAIN_ENTRY = path.join(REPO_ROOT, 'desktop', 'out', 'main', 'index.js')
export const ARTIFACTS_DIR = path.join(__dirname, 'artifacts')

// ---------- app lifecycle ----------

export interface LaunchOptions {
  /** The temp dir passed as `--user-data-dir` (state file lives at `<userData>/yaseendraw.json`). */
  userData: string
  /** Written to `<userData>/yaseendraw.json` before launch — a `windows[]` entry skips the native dialog. */
  seedState?: AppState
}

export async function launchApp({ userData, seedState }: LaunchOptions): Promise<ElectronApplication> {
  if (seedState !== undefined) {
    await writeFile(path.join(userData, 'yaseendraw.json'), JSON.stringify(seedState, null, 2))
  }
  return _electron.launch({ args: [MAIN_ENTRY, `--user-data-dir=${userData}`] })
}

/**
 * The REAL quit path (what ⌘Q runs): `app.quit()` fires `before-quit`, which flushes every
 * renderer's autosave and the pending state write before `app.exit(0)`. Resolves once the
 * process is actually gone, so the state file on disk is final when this returns.
 */
export async function quitApp(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolve) => app.on('close', () => resolve()))
  // The evaluate connection can drop mid-call while the app exits — that is success, not failure.
  await app.evaluate(({ app: electronApp }) => electronApp.quit()).catch(() => undefined)
  await Promise.race([
    closed,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('app did not exit within 15s of app.quit()')), 15_000)),
  ])
}

export const windowCount = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)

/** The window restored for `windows[]` entry `winId` (main loads `<renderer>?win=<id>`). */
export async function appWindow(app: ElectronApplication, winId: string, timeout = 15_000): Promise<Page> {
  const t0 = Date.now()
  for (;;) {
    const page = app.windows().find((p) => p.url().includes(`win=${winId}`))
    if (page !== undefined) return page
    if (Date.now() - t0 > timeout) throw new Error(`no window with ?win=${winId} appeared within ${timeout}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

// ---------- fixture vault ----------

/** The file the smoke suite seeds open; has nested bullets so outline folding is exercisable. */
export const SEED_FILE = 'Welcome note.md'
export const SEED_BODY = 'seed-welcome-body'
export const PARENT_BULLET = 'Parent bullet'
export const CHILD_BULLET = 'Child bullet alpha'
export const LAST_BULLET = 'Second parent'

/**
 * Generates a small synthetic vault (nested folders, a few `.md` files) into a fresh temp dir.
 * Callers never open this directly — `copyVault` it first (mirror of the never-touch-the-real-vault rule).
 */
export async function buildFixtureVault(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'g1-vault-src-'))
  await mkdir(path.join(root, 'Projects', 'archive'), { recursive: true })
  await Promise.all([
    writeFile(
      path.join(root, SEED_FILE),
      `# Welcome\n\n${SEED_BODY}\n\n* ${PARENT_BULLET}\n  * ${CHILD_BULLET}\n  * Child bullet beta\n* ${LAST_BULLET}\n`,
    ),
    writeFile(path.join(root, 'Ideas.md'), '# Ideas\n\nsynthetic-idea-body\n'),
    writeFile(path.join(root, 'Projects', 'Roadmap.md'), '# Roadmap\n\nsynthetic-roadmap-body\n'),
    writeFile(path.join(root, 'Projects', 'archive', 'Old plan.md'), '# Old plan\n\nsynthetic-archive-body\n'),
  ])
  return root
}

/** Copies the generated vault to a second temp dir; tests type into the copy only. */
export async function copyVault(src: string): Promise<string> {
  const dest = await mkdtemp(path.join(tmpdir(), 'g1-vault-'))
  await cp(src, dest, { recursive: true })
  return dest
}

// ---------- app state ----------

/**
 * The lens every seeded window starts on (YAZ-847; per window since YAZ-1628). The app's own default is `topics` — the
 * folder-page tree since YAZ-848 — while every spec in this suite is about the FILE TREE, so the
 * seeds below pre-select `files`: the same kind of pre-configuration as the `windows[]` entry
 * that skips the native folder dialog, not a change to the default. `lenses.spec.ts` seeds its
 * own state (including a pre-847 file with no lens key at all) to pin the default and the
 * switch; `topics.spec.ts` seeds `topics` to drive the tree itself.
 */
const SEEDED_LENS = 'files' as const

/**
 * One-window seed on `vault`/`file` — the no-native-dialog "open folder" (schema: shared/types.ts AppState v1).
 * No `expanded` option since YAZ-1642: both tree expansions are session lists main reads back as
 * `[]`, so a spec that needs a nested row opens its dir the way a user does — `expandDirs`.
 */
export function seededState(vault: string, file: string | null): AppState {
  const state = defaultAppState()
  state.recents = [{ path: vault, lastOpened: Date.now() }]
  state.windows = [{ id: 'w1', root: vault, file, tabs: file === null ? [] : [file], rightPanel: defaultRightPanelIdentity(), sidebarCollapsed: false, sidebarLens: SEEDED_LENS, focusDirs: [], focusTopics: [], focusFavorites: [], bounds: { x: 60, y: 60, width: 1100, height: 750 } }]
  state.folders = { [vault]: { expanded: [], lastFile: file, folds: {}, baseGroups: {}, topicsExpanded: [] } }
  return state
}

/**
 * Opens each dir in `dirs`, outermost first, by the click a user makes — since YAZ-1642 the only
 * way a nested row gets on screen (a launch restores no open dirs and does not unfold the active
 * file's ancestors). A plain click TOGGLES, so an already-open dir is left alone.
 */
export async function expandDirs(win: Page, dirs: string[]): Promise<void> {
  for (const dir of dirs) {
    const row = win.locator(`.tree__row--dir[data-path="${dir}"]`)
    // `aria-expanded` is the LI's, not the button's (client/src/sidebar/Tree.tsx) — so the row is
    // what gets clicked and the item is what gets read.
    const item = win.locator(`li[role="treeitem"]:has(> .tree__row--dir[data-path="${dir}"])`)
    await expect(row).toBeVisible()
    await expect
      .poll(async () => {
        if ((await item.getAttribute('aria-expanded')) === 'true') return true
        await row.click()
        return (await item.getAttribute('aria-expanded')) === 'true'
      })
      .toBe(true)
  }
}

export async function readState(userData: string): Promise<AppState> {
  return JSON.parse(await readFile(path.join(userData, 'yaseendraw.json'), 'utf8')) as AppState
}

// ---------- multi-window seeds & gestures (G3, GRO-2180) ----------

/** One `windows[]` entry for `multiWindowState`; bounds cascade from a default when omitted. */
export interface SeedWindow {
  id: string
  root: string
  file: string | null
  sidebarCollapsed?: boolean
  bounds?: WindowBounds
}

/**
 * `seededState` for several windows (possibly on several roots): one `windows[]` entry per
 * seed, a `folders` entry per distinct root, `recents` exactly as given (most-recent first).
 */
export function multiWindowState(wins: SeedWindow[], recentRoots: string[]): AppState {
  const state = defaultAppState()
  const now = Date.now()
  state.recents = recentRoots.map((p, i) => ({ path: p, lastOpened: now - i }))
  state.windows = wins.map((w, i) => ({
    id: w.id,
    root: w.root,
    file: w.file,
    tabs: w.file === null ? [] : [w.file],
    rightPanel: defaultRightPanelIdentity(),
    sidebarCollapsed: w.sidebarCollapsed ?? false,
    sidebarLens: SEEDED_LENS,
    focusDirs: [],
    focusTopics: [],
    focusFavorites: [],
    bounds: w.bounds ?? { x: 60 + i * 40, y: 60 + i * 30, width: 1000, height: 700 },
  }))
  for (const w of wins) {
    state.folders[w.root] ??= { expanded: [], lastFile: w.file, folds: {}, baseGroups: {}, topicsExpanded: [] }
  }
  return state
}

/** The `?win=<id>` a window was created with (null for a page the manager did not create). */
export const winParam = (page: Page): string | null => new URL(page.url()).searchParams.get('win')

/** Waits for a window whose `?win=` id is NOT in `known` — how tests catch a freshly created window. */
export async function extraWindow(app: ElectronApplication, known: readonly string[], timeout = 15_000): Promise<Page> {
  const t0 = Date.now()
  for (;;) {
    const page = app.windows().find((p) => {
      const id = winParam(p)
      return id !== null && !known.includes(id)
    })
    if (page !== undefined) return page
    if (Date.now() - t0 > timeout) throw new Error(`no window beyond [${known.join(', ')}] appeared within ${timeout}ms`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * Drives a menu item by its stable id — the REAL user path for menu gestures (menu.ts assigns
 * ids for exactly this). `focusWinId` focuses that window first, so handlers that resolve the
 * focused window (File › New Window reads `BrowserWindow.getFocusedWindow()`) see the right one.
 *
 * Focus is asynchronous AND conditional (GRO-2197): while the app is not frontmost, macOS
 * refuses to activate it — `win.focus()` returns with `getFocusedWindow()` still null, and a
 * click fired in that state used to hit the old no-focused-window no-op. So: focus, poll
 * briefly (~500ms) for the focus to actually LAND; only if it has not, steal app focus ONCE
 * (`app.focus({ steal: true })` — the suite runs headed on a machine someone may be using, so
 * never steal when the plain focus took) and poll again (~3s total). Then click regardless:
 * main's own last-focused fallback (`pickMenuTargetWindow`) covers the single-window case even
 * when macOS never granted focus at all.
 */
export async function clickMenuItem(app: ElectronApplication, itemId: string, focusWinId?: string): Promise<void> {
  await app.evaluate(
    async ({ Menu, BrowserWindow, app: electronApp }, arg) => {
      const target =
        arg.focusWinId === undefined
          ? undefined
          : BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`win=${arg.focusWinId}`))
      if (target !== undefined) {
        const focusLanded = async (deadline: number): Promise<boolean> => {
          while (BrowserWindow.getFocusedWindow() !== target) {
            if (Date.now() >= deadline) return false
            await new Promise((r) => setTimeout(r, 50))
          }
          return true
        }
        target.focus()
        if (!(await focusLanded(Date.now() + 500))) {
          electronApp.focus({ steal: true })
          target.focus()
          await focusLanded(Date.now() + 2500) // best effort — the click below runs either way
        }
      }
      const item = Menu.getApplicationMenu()?.getMenuItemById(arg.itemId)
      if (item == null) throw new Error(`no menu item with id ${arg.itemId}`)
      item.click()
    },
    { itemId, focusWinId },
  )
}

/** Replays macOS's `open-url` (a clicked `yaseendraw://` link) on the running app — the E1 entry point. */
export async function emitOpenUrl(app: ElectronApplication, url: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, u) => {
    electronApp.emit('open-url', { preventDefault: () => undefined }, u)
  }, url)
}

/** Replays macOS's `open-file` (Finder "Open With") — E2 rides the same link pipeline as E1. */
export async function emitOpenFile(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ app: electronApp }, p) => {
    electronApp.emit('open-file', { preventDefault: () => undefined }, p)
  }, filePath)
}

/** Closes the window of state entry `winId` through the REAL close path (flush handshake included). */
export async function closeWindow(app: ElectronApplication, winId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes(`win=${id}`))
      ?.close()
  }, winId)
}

// ---------- the folder page's OUTLINE editor (YAZ-903; harnessed in YAZ-904) ----------

/**
 * THE OUTLINE IS A PROSEMIRROR NOW, and driving one from Playwright is its own small craft — so
 * the craft lives here, once, and every spec that types into an outline shares it.
 *
 * Four things race, and all four have bitten:
 *  - `Home` / `End` do NOT move the caret on macOS. `Meta+ArrowLeft` / `Meta+ArrowRight` do — and
 *    `Meta+ArrowUp` / `Meta+ArrowDown` are the outliner's own fold keys, so they never move it.
 *  - a resolved wikilink renders its `[[ ]]` as `display: none` spans, and a caret cannot stop
 *    inside hidden text — so end-of-line lands in FRONT of the closing `]]` until the plugin's
 *    REVEAL rule steps the decorations aside, which the click itself triggers. The second attempt,
 *    on the raw text, lands properly.
 *  - the browser owns the DOM selection but ProseMirror owns `state.selection`, and PM reads the
 *    browser's only on its own deferred flush. Every keyboard COMMAND runs against PM's — so an
 *    Enter sent too early splits the document where PM still THINKS the caret is (on a freshly
 *    mounted editor, the document's start).
 *  - and a keystroke that arrives while the editor is re-rendering is simply DROPPED, so typing
 *    cannot be trusted to have landed either. Retrying a bare `type` would double whatever did,
 *    so the writers below take over a line they own and WIPE it before each attempt.
 * Hence the shape of everything below: perform the gesture, then CHECK it against ProseMirror's
 * own answer, and retry the whole thing until the two agree. Never a sleep.
 */

/** The outline view's editor — a real contenteditable, the note editor's own Crepe (YAZ-901). */
export const outlineEditor = (scope: Locator) => scope.locator('.view-outline .editor-instance .ProseMirror')

/**
 * Its bullets, in document order — nested ones included, as siblings. Read with `textContent`
 * (never `innerText`) on purpose: a resolved link's brackets are hidden spans, and reading them is
 * how a line's LINK-ness is asserted at all.
 */
export const outlineLines = (scope: Locator) => outlineEditor(scope).locator('.content-dom > p')

/** Only the bullets nested at least one level in — what a Tab produces. */
export const outlineNested = (scope: Locator) => outlineEditor(scope).locator('ul ul .content-dom > p')

/**
 * The bullets that still SAY something. Clearing a line's text leaves its bullet standing (an
 * empty level-1 bullet cannot be lifted out of a bullets-only document), so the blanks are real,
 * expected, and not what any assertion about a document's content is about. Read through
 * `allTextContents` — `textContent`, never `innerText` — so a resolved link's hidden brackets count.
 */
export const outlineSaid = async (scope: Locator): Promise<string[]> =>
  (await outlineLines(scope).allTextContents()).filter((line) => line !== '')

/**
 * Its LINK LINES, in document order: a bullet whose whole text is one `[[wikilink]]`. Since
 * YAZ-1152 that is what a membership looks like inside the outline — adoption writes one per
 * member the text does not already name — so this is how a spec asks the DOCUMENT who belongs
 * here without caring what prose is standing above it.
 */
export const outlineLinkLines = async (scope: Locator): Promise<string[]> =>
  (await outlineLines(scope).allTextContents()).filter((line) => /^\[\[[^[\]]+\]\]$/.test(line))

/** The `[[` picker, while it is showing (Links B). */
export const linkPicker = (w: Page) => w.locator('.wikilink-picker[data-show="true"]')

/** The bullet reading exactly `text` (raw, brackets included) — how a line is addressed by name. */
export const outlineLineIndex = async (scope: Locator, text: string): Promise<number> =>
  (await outlineLines(scope).allTextContents()).indexOf(text)

/** What the caret reading answers with; `null` when the outline editor is not even focused. */
export interface OutlineCaret {
  /** The whole raw text of the bullet the caret sits in. */
  text: string
  /** How far into it, hidden bracket spans counted. */
  offset: number
  /** Whether PROSEMIRROR agrees the caret is in this bullet (see `outlineCaret`). */
  live: boolean
}

/**
 * WHERE THE CARET IS, and — crucially — where ProseMirror thinks it is.
 *
 * `text` / `offset` come from the DOM selection, measured with a Range so the hidden bracket spans
 * are counted. `live` is the other half: `outline-thread-node` is the bullet-threading
 * decoration's caret path (`editor/outline/bulletThreading.ts`, derived from
 * `state.selection.$from`), so it is PM's OWN answer, read back off the DOM. Null when the outline
 * editor is not focused — a stale DOM selection outlives the focus that made it, and would happily
 * answer for keystrokes that are going somewhere else entirely.
 */
export const outlineCaret = (w: Page): Promise<OutlineCaret | null> =>
  w.evaluate(() => {
    const active = document.activeElement
    if (active === null || !active.classList.contains('ProseMirror') || active.closest('.view-outline') === null) return null
    const sel = document.getSelection()
    const node = sel === null ? null : sel.anchorNode
    if (sel === null || node === null) return null
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
    const bullet = el === null ? null : el.closest('.view-outline .content-dom > p')
    if (bullet === null) return null
    const range = document.createRange()
    range.selectNodeContents(bullet)
    range.setEnd(node, sel.anchorOffset)
    const item = bullet.closest('.milkdown-list-item-block')
    return {
      text: bullet.textContent ?? '',
      offset: range.toString().length,
      live: item !== null && item.classList.contains('outline-thread-node'),
    }
  })

/**
 * The caret once it has stopped moving, with the `[[` picker's verdict beside it. Two reads a
 * round trip apart catch a selection that is still settling; `picking` answers the one question
 * the DOM cannot be trusted on, because the picker's session is computed from `state.selection`:
 * an OPEN picker means PM's caret is inside an unclosed `[[…`, which on a link line means it has
 * not got past the hidden `]]` yet, however the DOM measures it.
 */
export const settledCaret = async (w: Page): Promise<(OutlineCaret & { picking: boolean }) | null> => {
  const first = await outlineCaret(w)
  const second = await outlineCaret(w)
  if (second === null || JSON.stringify(first) !== JSON.stringify(second)) return null
  return { ...second, picking: (await linkPicker(w).count()) > 0 }
}

/** Every gesture below leaves the caret in this state — settled, live, and not mid-completion. */
const at = (text: string, offset: number) => ({ text, offset, live: true, picking: false })

/** THE ONE CARET PRIMITIVE: click into bullet `i` and land after its LAST character. */
export async function caretAtEndOfLine(w: Page, scope: Locator, i: number): Promise<void> {
  const line = outlineLines(scope).nth(i)
  const text = (await line.textContent()) ?? ''
  await expect
    .poll(async () => {
      await line.click() // free to repeat: a click never changes the document
      await w.keyboard.press('Meta+ArrowRight')
      return settledCaret(w)
    })
    .toEqual(at(text, text.length))
}

/**
 * A fresh bullet after bullet `i`, caret in it. It leaves behind exactly one guarantee — ONE more
 * bullet than there was, EMPTY, with ProseMirror's own caret inside it — so the typing that
 * follows has somewhere to land.
 */
export async function bulletAfterLine(w: Page, scope: Locator, i: number): Promise<void> {
  await expect
    .poll(async () => {
      // Counted per attempt, never once up front: a retry has to judge the Enter it just sent.
      const before = await outlineLines(scope).count()
      await caretAtEndOfLine(w, scope, i)
      await w.keyboard.press('Enter')
      const now = await settledCaret(w)
      return (await outlineLines(scope).count()) === before + 1 ? now : null
    })
    .toEqual(at('', 0))
}

/** The whole of bullet `i` selected and deleted — the "select + delete" a user does to drop a line. */
export async function clearOutlineLine(w: Page, scope: Locator, i: number): Promise<void> {
  await caretAtEndOfLine(w, scope, i)
  await w.keyboard.press('Shift+Meta+ArrowLeft')
  await w.keyboard.press('Backspace')
}

/**
 * `[[` at the caret, narrowed to `name`, committed with Enter — Links B, inside the outline.
 * `shot` names a screenshot taken while the picker is open, for specs that want that evidence.
 *
 * THE CARET'S LINE IS TAKEN OVER WHOLE, and retried by WIPING first: a keystroke that arrives
 * while the editor is re-rendering is simply dropped, and a retry that just typed `[[` again would
 * turn a half-landed `[` into `[[[`. So each attempt clears the line and types the fragment afresh,
 * until ProseMirror shows the fragment standing there with its picker open — which is also the
 * proof that the picker is looking at what we think it is. Callers therefore hand this a line they
 * own: a fresh bullet, or the empty one the seed guarantees.
 */
export async function pickOutlineLink(w: Page, name: string, shot?: string): Promise<void> {
  const fragment = `[[${name}`
  await expect
    .poll(async () => {
      const now = await settledCaret(w)
      if (now !== null && now.text === fragment && now.picking) return now
      // Wipe only what is THERE. A Backspace on an already-empty bullet is not a no-op — it merges
      // the bullet into the line above, which would put the caret in somebody else's text.
      if (now !== null && now.text !== '') {
        await w.keyboard.press('Meta+ArrowRight')
        await w.keyboard.press('Shift+Meta+ArrowLeft')
        await w.keyboard.press('Backspace')
      }
      await w.keyboard.type(fragment, { delay: 20 })
      return settledCaret(w)
    })
    .toEqual({ text: fragment, offset: fragment.length, live: true, picking: true })
  // The picker narrows over REAL pages: the row it will insert is the one this asserts.
  await expect(linkPicker(w).locator('[role="option"]').first()).toHaveText(name)
  if (shot !== undefined) await shoot(w, shot)
  await w.keyboard.press('Enter')
  // The picker inserts PLAIN TEXT, so the proof it took is the caret's own line reading it back.
  await expect.poll(() => settledCaret(w)).toEqual(at(`[[${name}]]`, name.length + 4))
}

/**
 * `text` typed as the WHOLE of the caret's line, retried by WIPING first — same discipline as
 * `pickOutlineLink`, for the same reason: a keystroke that arrives while the editor is
 * re-rendering is dropped, and retrying a bare `type` would double what did land. Callers hand
 * this a line they own, which is what makes wiping safe.
 */
export async function writeOutlineLine(w: Page, text: string): Promise<void> {
  await expect
    .poll(async () => {
      const now = await settledCaret(w)
      if (now !== null && now.text === text) return now
      // Only what is THERE: a Backspace on an already-empty bullet merges it into the line above.
      if (now !== null && now.text !== '') {
        await w.keyboard.press('Meta+ArrowRight')
        await w.keyboard.press('Shift+Meta+ArrowLeft')
        await w.keyboard.press('Backspace')
      }
      await w.keyboard.type(text, { delay: 15 })
      return settledCaret(w)
    })
    .toEqual(at(text, text.length))
}

/**
 * Tab until the caret's line has actually nested. A dropped keypress is the only reason it would
 * not have, and a Tab on a line that is already the first child of its parent is a no-op — the
 * outliner has nothing deeper to put it under — so repeating is safe.
 */
export async function indentOutlineLine(w: Page, scope: Locator, text: string): Promise<void> {
  const nestedLine = () => outlineNested(scope).filter({ hasText: text }).count()
  await expect
    .poll(async () => {
      if ((await nestedLine()) > 0) return true
      await w.keyboard.press('Tab')
      return (await nestedLine()) > 0
    })
    .toBe(true)
}

/** A whole line written from scratch after bullet `i`: a fresh bullet, then the text typed into it. */
export async function typeOutlineLine(w: Page, scope: Locator, i: number, text: string): Promise<void> {
  await bulletAfterLine(w, scope, i)
  await writeOutlineLine(w, text)
}

// ---------- evidence ----------

export async function md5(file: string): Promise<string> {
  return createHash('md5').update(await readFile(file)).digest('hex')
}

/** Screenshots are the evidence format (locked): step-numbered PNGs under the gitignored artifacts dir. */
export async function shoot(page: Page, name: string): Promise<string> {
  await mkdir(ARTIFACTS_DIR, { recursive: true })
  const file = path.join(ARTIFACTS_DIR, `${name}.png`)
  await page.screenshot({ path: file })
  return file
}
