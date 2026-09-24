/**
 * The words the share UI shows (YAZ-1799): one status line for a shared board — the Share dialog,
 * the sidebar mark's tooltip and the Settings list all say the same thing — and a failure as text.
 */
import type { ShareEntry } from '@shared/types'
import { BridgeRequestError } from '../api'
import { relativeTime } from '../lib/relativeTime'

export type Line = { tone: 'ok' | 'busy' | 'error'; text: string }

export function errorText(err: unknown): string {
  if (err instanceof BridgeRequestError) return err.message
  if (err instanceof SyntaxError) return "This Excalidraw drawing's file isn't valid JSON, so it can't be shared."
  return err instanceof Error ? err.message : String(err)
}

/** The one status line: uploading beats a save waiting to upload, beats a failure, beats stale, beats up to date. */
export function liveLine(entry: ShareEntry, pending: boolean, now: number): Line {
  if (entry.sync.state === 'uploading') return { tone: 'busy', text: 'Uploading…' }
  if (pending) return { tone: 'busy', text: 'Waiting to upload changes…' }
  if (entry.sync.state === 'failed') return { tone: 'error', text: `Couldn't update: ${entry.sync.message ?? 'unknown error'}` }
  if (entry.stale) return { tone: 'error', text: "Couldn't update: the shared copy is gone from Cloudflare. Save the board to put it back." }
  return { tone: 'ok', text: `Up to date · ${relativeTime(entry.updatedAt, now)}` }
}
