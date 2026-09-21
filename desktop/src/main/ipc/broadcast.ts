import { BrowserWindow } from 'electron'

/**
 * Sends `channel` (+ payload) to every live window, whichever window — or main itself —
 * caused the change. Renderers filter by their own root where that matters (the
 * `state:changed` / `vaultConfig:changed` posture).
 */
export function broadcastAll(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue
    win.webContents.send(channel, ...args)
  }
}
