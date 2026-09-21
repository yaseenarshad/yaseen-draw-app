import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { agentPrompt } from '@shared/agentInstructions'
import { CH } from '../../channels'
import { BridgeFailure, fsCall, requireAbsPath, requireMarkdownFile } from '../fs/fsUtils'
import { handle } from './envelope'

/** What main knows and the renderer does not: where the `yaseendraw` command lives on this machine. */
export interface AgentHost {
  packaged: boolean
  /** `process.resourcesPath` — the bundle's `Contents/Resources`, where `bin/yaseendraw` is (YAZ-1621). */
  resourcesPath: string
  /** The main bundle's directory (`out/main`), where `cli.js` sits in dev. */
  mainDir: string
}

/** The command as an agent must type it: the shim in the bundle, or `node` on the built entry in dev. */
export function agentCommand({ packaged, resourcesPath, mainDir }: AgentHost): string {
  return packaged ? `"${join(resourcesPath, 'bin', 'yaseendraw')}"` : `node "${join(mainDir, 'cli.js')}"`
}

/**
 * Copy for Agent (YAZ-1617): the renderer asks for the handshake text for one page and writes the
 * clipboard itself, the way Copy path does. Read-only and enveloped like `reveal`: a page that is
 * no longer there rejects NOT_FOUND so the row can show a passive notice; a non-Markdown file is
 * not a page and rejects UNSUPPORTED_EXTENSION (the write guard's own code).
 */
export function registerAgentIpc(host: AgentHost): void {
  handle(CH.shellAgentPrompt, async (req: unknown) => {
    if (typeof req !== 'object' || req === null) throw new BridgeFailure('BAD_REQUEST', 'request must be an object')
    const p = requireAbsPath((req as Record<string, unknown>).path, 'path')
    requireMarkdownFile(p)
    return fsCall(p, async () => {
      await stat(p)
      return agentPrompt(agentCommand(host), p)
    })
  })
}
