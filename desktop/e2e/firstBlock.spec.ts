/**
 * THE FIRST BLOCK HUGS THE TITLE (YAZ-918/YAZ-932) — pinned at the COMPUTED-STYLE level because
 * this selector was wrong TWICE before a DOM probe caught why: ProseMirror's literal first child
 * is not the first block. The note editor leads with Milkdown's `prosemirror-virtual-cursor`
 * widget (an invisible DIV, nothing to do with the visible caret), and the outline editor wraps
 * its blocks in `.content-dom`. A heading standing first must carry NO top margin — it sits on
 * the title row's gap exactly like a first paragraph — while headings between blocks keep their
 * per-level lead-in.
 */
import { expect, test } from '@playwright/test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { appWindow, launchApp, quitApp, seededState } from './helpers'

test('a heading-first body carries no lead-in; a mid-document heading keeps its own', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'firstblock-userdata-'))
  const vault = await mkdtemp(path.join(tmpdir(), 'firstblock-vault-'))
  const note = path.join(vault, 'Probe.md')
  await writeFile(note, '# First\n\nwords\n\n## Later\n\nmore\n')
  const app = await launchApp({ userData, seedState: seededState(vault, note) })
  const win = await appWindow(app, 'w1')
  const pm = win
    .locator('.tabstack__layer:not(.tabstack__layer--hidden)')
    .locator('.editor-mount .editor-instance .milkdown .ProseMirror')
  await expect(pm.locator('h1')).toHaveText('First')
  await expect
    .poll(() =>
      pm.evaluate((el) => {
        const first = getComputedStyle(el.querySelector('h1')!).marginTop
        const later = getComputedStyle(el.querySelector('h2')!).marginTop
        return `${first} | ${later}`
      }),
    )
    .toBe('0px | 28px')
  await quitApp(app)
})
