/**
 * The real-world Slack plain-text payload from YAZ-933 (abridged to the shape that matters):
 * unicode fake bullets (• ◦ ■), blank lines between every bullet, trailing " ." junk on most
 * lines. This is the canonical paste-in fixture — the app must turn it into real nested lists.
 */
export const SLACK_OUTLINE_SAMPLE = [
  'Phase 0) Business Wiki',
  '',
  '• this is the foundation to:.',
  '',
  '◦ 1) content (short form // long form)  .',
  '',
  '◦ 2) business (lead magnets // agents, automations we would build) .',
  '',
  '• What is the business wiki? .',
  '',
  '◦ it’s my library of Alexandria // my mochi // my second brain for business .',
  '',
  '■ database system .',
  '',
  '■ linking (wiki links) .',
].join('\n')

/**
 * What the translator must produce for SLACK_OUTLINE_SAMPLE. Trailing whitespace-then-period
 * junk is STRIPPED (YAZ-933 decision, 2026-08-26): a period after whitespace at line end is
 * never real prose. `to:.` has no space before the period, so it stays.
 */
export const SLACK_OUTLINE_EXPECTED = [
  'Phase 0) Business Wiki',
  '',
  '- this is the foundation to:.',
  '  - 1) content (short form // long form)',
  '  - 2) business (lead magnets // agents, automations we would build)',
  '- What is the business wiki?',
  '  - it’s my library of Alexandria // my mochi // my second brain for business',
  '    - database system',
  '    - linking (wiki links)',
].join('\n')
