/**
 * Preloaded into the capture app's MAIN process after `e2e/support/mainHook.cjs` (which already makes
 * every window transparent). A capture run lasts minutes on a Mac someone is using, so its windows
 * must take nothing from that person and get nothing from them:
 *
 *  - a window is shown INACTIVE and cannot take keyboard focus, and the app has no Dock icon, so
 *    the app in front stays in front and whatever is being typed keeps going there — never onto a
 *    board mid-capture;
 *  - a window ignores the real mouse, so a click or a hover over the invisible window passes
 *    through to what is under it;
 *  - a window floats above the others and Chromium's background throttling is off, so a window the
 *    person's own windows would cover keeps painting at full speed;
 *  - a window may be larger than the screen it is on: on a 1× display lib/stage.mjs zooms the page
 *    to 2× and needs a window twice the size.
 *
 * Nothing the app draws changes. The capture's own input is not affected either: Playwright sends
 * it straight to the page (DevTools protocol) with focus emulated, not through the OS.
 */
const Module = require('node:module')
const electron = require('electron')
const { app } = electron

for (const flag of ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']) app.commandLine.appendSwitch(flag)
if (process.platform === 'darwin') app.setActivationPolicy('accessory')

// Named BrowserWindow like its parent: `BrowserWindow.getAllWindows()` lists windows by that name.
const QuietWindow = class BrowserWindow extends electron.BrowserWindow {
  constructor(options) {
    super({ ...options, show: false, focusable: false, enableLargerThanScreen: true })
    this.setIgnoreMouseEvents(true)
    this.setAlwaysOnTop(true)
    this.showInactive()
  }
}

// `electron.BrowserWindow` cannot be redefined, so the app's main — loaded after this file — is
// handed an `electron` that inherits everything and overrides that one name.
const quiet = Object.create(electron, { BrowserWindow: { value: QuietWindow, enumerable: true } })
const load = Module._load
Module._load = function (request, ...rest) {
  const loaded = load.call(this, request, ...rest)
  return loaded === electron ? quiet : loaded
}
