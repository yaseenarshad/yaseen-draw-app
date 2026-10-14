/**
 * The main process of a bare Electron that holds ONE blank window, for `capture.mjs` to load a
 * designed page into (banner.html, social.html) and screenshot. Like the capture app's windows
 * (quietHook.cjs) it is invisible, shown inactive, and takes neither keyboard nor mouse.
 */
const { app, BrowserWindow } = require('electron')

if (process.platform === 'darwin') app.setActivationPolicy('accessory')
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600, show: false, focusable: false, webPreferences: { sandbox: true } })
  win.setOpacity(0)
  win.setIgnoreMouseEvents(true)
  win.showInactive()
  void win.loadURL('about:blank')
})
app.on('window-all-closed', () => app.quit())
