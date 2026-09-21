import { api, BridgeRequestError } from '../api'
import { basename } from './paths'

/**
 * Copy for Agent (YAZ-1617 🔒 D2): main composes the handshake for `path` (it knows where the
 * `yaseendocs` command lives), the renderer writes the clipboard exactly as Copy path does, and
 * the panel's passive notice reports either way. One helper, so the sidebar row and the tab
 * cannot spell the gesture two ways.
 */
export async function copyForAgent(path: string, notice?: (message: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(await api.agentPrompt({ path }))
    notice?.('Copied for agent')
  } catch (err) {
    notice?.(
      err instanceof BridgeRequestError && err.code === 'NOT_FOUND'
        ? `Can't copy "${basename(path)}" for an agent — it is no longer there`
        : `Can't copy for agent: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}
