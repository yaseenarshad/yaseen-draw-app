/**
 * ALWAYS-LIVE LINKS (YAZ-1799, Yasin's amendment — replaces "frozen snapshot + Update"). Every
 * successful save of a board that has a `shares.json` entry re-uploads the standalone export to
 * the SAME id, so the link always shows the board as last saved. There is no Update button.
 *
 * Coalescing, per board, in this renderer (the window whose autosave wrote the board):
 *  - SETTLE: an upload starts only after 10 s with no further save — a drawing session is many
 *    saves, and each would otherwise be a full re-upload of every image.
 *  - ONE IN FLIGHT: a board never has two uploads at once.
 *  - LATEST WINS: a save that lands mid-upload schedules one more upload after it finishes, which
 *    reads the board from disk again — so the last save is always what ends up behind the link.
 *
 * A failed upload (offline, too large, refused) keeps the share record; main records the reason
 * (the Share dialog and Settings › Sharing show it) and the next save simply tries again. Nothing
 * here retries on a timer.
 */
import { api } from '../api'
import { buildShareContent } from './shareContent'

export const SETTLE_MS = 10_000

interface BoardState {
  root: string
  timer: ReturnType<typeof setTimeout> | null
  inFlight: boolean
  again: boolean
}

const boards = new Map<string, BoardState>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Whether `path` has saved edits waiting for the settle period (or a queued re-run). The dialog shows it. */
export function isPending(path: string): boolean {
  const b = boards.get(path)
  return b !== undefined && (b.timer !== null || b.again)
}

/** Subscribe to pending-state changes; returns the unsubscribe. */
export function onLiveShareChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Called by `DrawingEditor` after every successful save. Cheap: it only (re)arms a timer. */
export function noteBoardSaved(root: string, path: string, settleMs = SETTLE_MS): void {
  const b = boards.get(path) ?? { root, timer: null, inFlight: false, again: false }
  b.root = root
  if (b.timer !== null) clearTimeout(b.timer)
  b.timer = setTimeout(() => {
    b.timer = null
    void run(path)
  }, settleMs)
  boards.set(path, b)
  emit()
}

async function run(path: string): Promise<void> {
  const b = boards.get(path)
  if (b === undefined) return
  if (b.inFlight) {
    b.again = true
    emit()
    return
  }
  b.inFlight = true
  b.again = false
  emit()
  try {
    // Only boards that are shared, and only once sharing is set up; everything else is a no-op.
    const entry = await api.share.get({ root: b.root, path })
    if (entry === null) return
    const status = await api.share.status()
    if (status.state !== 'ready') return
    // No flush: this run was triggered BY a save, so the disk is at least that new. Main checks
    // the size (TOO_LARGE is recorded as the board's error) and records every outcome.
    const built = await buildShareContent(b.root, path, { flush: false })
    await api.share.publish({ root: b.root, path, content: built.content })
  } catch {
    // Recorded by main (the dialog and Settings show it); the next save retries.
  } finally {
    b.inFlight = false
    if (b.again) void run(path)
    else if (b.timer === null) boards.delete(path)
    emit()
  }
}

/** Test seam: forget every board (timers included). */
export function resetLiveShareForTests(): void {
  for (const b of boards.values()) if (b.timer !== null) clearTimeout(b.timer)
  boards.clear()
}
