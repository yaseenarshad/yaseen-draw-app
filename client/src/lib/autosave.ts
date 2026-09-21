/**
 * Pure debounced auto-save state machine (no DOM, no React) so the dirty /
 * debounce / conflict rules can be unit-tested.
 *
 * Rules (docs/CONTRACTS.md):
 *  - only content that differs from the last saved/loaded markdown is dirty
 *    (Crepe's first serialisation is a normalised rewrite — never save it);
 *  - save `delayMs` after the last change, with `expectedMtime` = mtime of the
 *    last read/write; a CONFLICT rejection is reported via `onConflict` and
 *    saving pauses until `reset()` (reload) or `adopt()` (overwrite);
 *  - `flush()` saves immediately (file switch / beforeunload).
 */
export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error'

export class SaveConflict extends Error {
  constructor(readonly mtime: number) {
    super('file changed on disk')
    this.name = 'SaveConflict'
  }
}

export interface AutosaveOptions {
  /** Baseline markdown (what is on disk, as Crepe serialises it). */
  markdown: string
  /** mtime of the baseline. */
  mtime: number
  save: (content: string, expectedMtime: number) => Promise<{ mtime: number }>
  onStatus: (status: SaveStatus) => void
  onConflict: (diskMtime: number) => void
  delayMs?: number
}

export class Autosave {
  private baseline: string
  private pending: string | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private inflight: Promise<void> | null = null
  private blocked = false
  private disposed = false
  private status: SaveStatus = 'saved'
  /** mtime of the last successful read or write — the echo-suppression key for watcher events. */
  mtime: number

  constructor(private readonly opts: AutosaveOptions) {
    this.baseline = opts.markdown
    this.mtime = opts.mtime
  }

  get dirty(): boolean {
    return this.pending !== null || this.inflight !== null
  }

  /**
   * Resolves once no save is in flight. Watcher events for our own write can arrive
   * before the `writeFile` response (slow rename on network filesystems), so callers
   * must wait for the in-flight save to settle before comparing mtimes for echo suppression.
   */
  settled(): Promise<void> {
    return this.inflight ?? Promise.resolve()
  }

  /** New editor content. Schedules a save when it differs from the baseline. */
  update(markdown: string): void {
    if (this.disposed) return
    this.clearTimer()
    if (markdown === this.baseline) {
      this.pending = null
      if (this.inflight === null) this.setStatus('saved')
      return
    }
    if (markdown === this.pending) {
      this.schedule()
      return
    }
    this.pending = markdown
    this.setStatus('unsaved')
    this.schedule()
  }

  /**
   * Save pending content now (awaits any in-flight save first).
   *
   * Guards on `disposed` (GRO-2272 `B1a-`): a disposed controller must never write, whatever
   * its caller does. `useAutosave` also checks its own `retiredRef` at every call site, but
   * that put the guard one layer ABOVE the object owning the state — a fourth call site added
   * later would not be protected, and the failure mode is silent file resurrection after a
   * delete. Cheap to make the object defend itself.
   */
  async flush(): Promise<void> {
    if (this.disposed) return
    this.clearTimer()
    if (this.inflight !== null) await this.inflight
    if (this.pending === null || this.blocked) return
    const content = this.pending
    this.pending = null
    this.setStatus('saving')
    this.inflight = this.opts.save(content, this.mtime).then(
      (res) => {
        this.mtime = res.mtime
        this.baseline = content
        this.inflight = null
        if (this.pending === null) this.setStatus('saved')
      },
      (err: unknown) => {
        this.inflight = null
        if (this.pending === null) this.pending = content
        if (err instanceof SaveConflict) {
          this.blocked = true
          this.setStatus('unsaved')
          this.opts.onConflict(err.mtime)
        } else {
          this.setStatus('error')
        }
      },
    )
    await this.inflight
  }

  /** Disk content was (re)loaded into the editor: new baseline, nothing pending. */
  reset(markdown: string, mtime: number): void {
    this.clearTimer()
    this.baseline = markdown
    this.mtime = mtime
    this.pending = null
    this.blocked = false
    this.setStatus('saved')
  }

  /** Keep the editor's content and overwrite the newer disk version. */
  adopt(diskMtime: number): Promise<void> {
    this.mtime = diskMtime
    this.blocked = false
    return this.flush()
  }

  dispose(): void {
    this.clearTimer()
    this.disposed = true
  }

  private setStatus(status: SaveStatus): void {
    if (status === this.status) return
    this.status = status
    this.opts.onStatus(status)
  }

  private schedule(): void {
    if (this.blocked) return
    this.timer = setTimeout(() => void this.flush(), this.opts.delayMs ?? 500)
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}
