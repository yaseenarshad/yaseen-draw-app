/**
 * The window's one passive notice (E1, GRO-2171; restyled bottom-left in YAZ-1674). App owns the
 * toast; every surface reaches it through an `onNotice(text, icon?)` callback.
 */

/** A can't-open-link notice (E1, GRO-2171) dismisses itself after this long. */
export const LINK_NOTICE_MS = 4000

/**
 * The toast's glyph (D10 amended, YAZ-1674): what KIND of thing just happened, drawn before the
 * text. `'info'` unless the caller names a kind; the file clipboard's confirmations name their
 * verb, its failures say `'error'`; a favorite added or removed says `'favorite'` (YAZ-1766 D6).
 */
export type NoticeKind = 'copy' | 'cut' | 'paste' | 'favorite' | 'error' | 'info'

export interface Notice {
  text: string
  icon: NoticeKind
  /**
   * One button on the toast (YAZ-1897: "See changes" after a merge). A notice with an action is
   * news to act on, so it stays until acted on or dismissed instead of fading after `LINK_NOTICE_MS`.
   */
  action?: { label: string; run: () => void }
}
