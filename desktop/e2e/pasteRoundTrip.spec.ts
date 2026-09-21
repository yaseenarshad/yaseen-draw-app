/**
 * THE PASTE ROUND TRIP (YAZ-939) — the whole of YAZ-933 proven against the REAL app and the REAL
 * system clipboard. The Slack-shaped sample (unicode fake bullets, blank lines, trailing " ."
 * junk — the parent issue's own payload) goes IN via Electron's paste path and must render as
 * genuinely nested lists with no literal `•` anywhere; Select-All + copy must put BOTH formats
 * back on the clipboard — readable text with the nesting intact (YAZ-1443: `• ` bullets, not
 * Markdown), HTML with real `<ul>` structure — and Edit → Copy as → Markdown is the second door,
 * the one that puts real `*` markers back.
 * Same harness as the rest of the suite: temp `--user-data-dir`, throwaway vault, `shoot`
 * screenshots as evidence.
 */
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SLACK_OUTLINE_SAMPLE } from '../../client/src/editor/outlinePaste.fixtures'
import { appWindow, clickMenuItem, launchApp, quitApp, seededState, shoot } from './helpers'

test.describe.configure({ mode: 'serial' })

let app: ElectronApplication
let win: Page

const editor = () =>
  win
    .locator('.tabstack__layer:not(.tabstack__layer--hidden)')
    .locator('.editor-mount .editor-instance .milkdown .ProseMirror')

test.beforeAll(async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'pastert-userdata-'))
  const vault = await mkdtemp(path.join(tmpdir(), 'pastert-vault-'))
  const note = path.join(vault, 'Paste target.md')
  await writeFile(note, 'seed-line\n')
  app = await launchApp({ userData, seedState: seededState(vault, note) })
  win = await appWindow(app, 'w1')
  await expect(editor()).toContainText('seed-line')
})

test.afterAll(async () => {
  await quitApp(app)
})

test('the Slack sample pastes IN as real nested lists, not flat • paragraphs', async () => {
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), SLACK_OUTLINE_SAMPLE)
  await editor().click()
  await win.keyboard.press('Meta+ArrowRight')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('win=w1'))!
      .webContents.paste()
  })
  // Three ranks in the sample → at least two levels of genuine <ul> nesting.
  await expect(editor().locator('ul ul li').first()).toBeVisible()
  await expect(editor().locator('ul ul ul li').first()).toBeVisible()
  await expect(editor()).toContainText('this is the foundation to:.')
  await expect(editor()).toContainText('database system')
  expect(await editor().textContent()).not.toContain('•')
  await shoot(win, 'pasteRoundTrip-1-pasted-nested')
})

test('Select-All + copy puts readable text AND rich HTML on the clipboard; Copy as → Markdown is the second door (YAZ-1443)', async () => {
  await editor().click()
  await win.keyboard.press('Meta+a')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('win=w1'))!
      .webContents.copy()
  })
  await expect
    .poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).includes('foundation'))
    .toBe(true)
  const payload = await app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }))
  // Text side (YAZ-1443): READABLE, not Markdown — `• ` bullets, two spaces per depth, the
  // `1)` left exactly as typed. Nesting survived; the fake bullets are now real ones.
  expect(payload.text).toContain('• this is the foundation to:.')
  expect(payload.text).toContain('  • 1) content (short form // long form)')
  expect(payload.text).toContain('    • database system')
  // HTML side: genuinely nested list structure for rich targets (Linear, Docs).
  expect(payload.html).toContain('<ul')
  expect(payload.html.match(/<ul/g)!.length).toBeGreaterThanOrEqual(2)
  await shoot(win, 'pasteRoundTrip-2-copied-out')

  // The explicit door: Edit → Copy as → Markdown, driven through the real menu item with the
  // editor still holding focus (the handler answers only for the focused editor). Bullets are
  // real markers, no unicode junk. The `1\)` is the serializer's own (correct) escape — bare `1)`
  // at item start would re-parse as an ordered marker; pasting this markdown back reproduces
  // `1) content …` exactly.
  await clickMenuItem(app, 'menu.edit.copy-markdown', 'w1')
  await expect
    .poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).includes('* this is the foundation'))
    .toBe(true)
  const markdown = await app.evaluate(({ clipboard }) => clipboard.readText())
  expect(markdown).toContain('* this is the foundation to:.')
  expect(markdown).toContain('  * 1\\) content (short form // long form)')
  expect(markdown).toContain('    * database system')
  expect(markdown).not.toContain('•')
  await shoot(win, 'pasteRoundTrip-3-copied-as-markdown')
})
