import type { WebContents } from 'electron'
import { CH } from '../../channels'
import { BridgeFailure } from '../fs/fsUtils'
import type { WindowManagerIpc } from '../windows'
import { handleWithEvent } from './envelope'

// Bound renderer-supplied strings while allowing large document selections (UTF-16 code units).
export const MAX_COPY_TEXT_LENGTH = 16 * 1024 * 1024

export interface ClipboardHost {
  target(): Pick<WebContents, 'id'> | undefined
  /** Electron clipboard.writeText replaces existing formats with text only. */
  writeText(text: string): void
  rendererUrl: string
}

function isRendererUrl(raw: string, expected: string): boolean {
  try {
    const actual = new URL(raw)
    const renderer = new URL(expected)
    return actual.protocol === renderer.protocol && actual.host === renderer.host && actual.pathname === renderer.pathname
  } catch {
    return false
  }
}

/** Private preload reply to Copy as; no arbitrary clipboard writer is exposed to the renderer. */
export function registerClipboardIpc(windows: Pick<WindowManagerIpc, 'idFor'>, host: ClipboardHost): void {
  handleWithEvent(CH.menuCopyText, async (event, text: unknown) => {
    const { sender, senderFrame } = event
    if (sender.isDestroyed()
      || windows.idFor(sender) === undefined
      || sender.id !== host.target()?.id
      || !senderFrame
      || senderFrame !== sender.mainFrame
      || !isRendererUrl(senderFrame.url, host.rendererUrl)
      || typeof text !== 'string'
      || text.length > MAX_COPY_TEXT_LENGTH) {
      throw new BridgeFailure('BAD_REQUEST', 'invalid copy target or text')
    }
    if (text !== '') host.writeText(text)
  })
}
