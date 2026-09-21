/**
 * The comment stream block (YAZ-1472): one test per locked ruling, mounted with react-dom in
 * jsdom, `api` mocked so every read / write is observable — the properties panel's harness.
 * The block writes through `views/writeProperty`'s `transformFile`, so the mock sits UNDER it:
 * `readFile` hands back the fresh bytes, `writeFile` receives the exact bytes that would land,
 * and the real read → transform → write dance is what runs. The pure model has its own tests
 * (`comments.test.ts`); nothing here re-proves it.
 *
 * Only `Date` is faked — a fixed clock makes "2 days ago" and the written `at` deterministic —
 * while timers stay real, so a write's promise chain settles on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { readComments } from '@shared/comments'
import type { CommentsOrder } from '@shared/types'
import { CommentsSection } from './CommentsSection'
import commentsCss from './comments.css?inline'

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  api: { readFile: vi.fn(), writeFile: vi.fn(), openLink: vi.fn() },
}))

import { BridgeRequestError, api } from '../api'

const readFile = vi.mocked(api.readFile)
const writeFile = vi.mocked(api.writeFile)
const openLink = vi.mocked(api.openLink)

;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

const PATH = '/vault/Funnel.md'
/** The clock every relative stamp is read against, and the `at` every write stamps. */
const NOW = Date.parse('2026-09-13T20:00:00Z')
const ID = /^[0-9a-f]{8}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/

const fileOf = (content: string, mtime = 100) => ({ path: PATH, content, mtime, size: content.length })

const note = (entries: string) => `---\ntitle: Funnel\ncomments:\n${entries}---\nBody\n`

/** One comment, no replies yet. */
const LONE = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
`)

/** LONE as the disk moved on after the prop was taken: the FRESH bytes a write must build on. */
const FRESHER = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
  - id: ffffffff
    at: 2026-09-12T20:00:00Z
    body: Landed meanwhile
`)

/** Deliberately out of `at` order on disk: a thread of two replies, a lone comment, an orphan reply. */
const THREADED = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: Parent comment
  - id: bbbbbbbb
    at: 2026-09-12T20:00:00Z
    reply_to: aaaaaaaa
    body: First reply
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: Earliest, filed last
  - id: dddddddd
    at: 2026-09-12T21:00:00Z
    reply_to: zzzzzzzz
    body: Orphan reply
  - id: eeeeeeee
    at: 2026-09-13T08:00:00Z
    reply_to: aaaaaaaa
    body: Second reply
`)

/** A titled comment after a title-less one whose first line carries a Markdown marker. */
const TITLED = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    title: Churn
    body: Parent comment
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: |-
      # Heading line
      More text
`)

const AGENT = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    by: agent
    body: Written by an agent
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: Written by nobody in particular
`)

/** Multi-line bodies and one title, so every comment but the one-liner has something to fold. */
const FOLDABLE = note(`  - id: aaaaaaaa
    at: 2026-09-11T20:00:00Z
    body: |-
      Parent comment
      with more below
  - id: bbbbbbbb
    at: 2026-09-12T20:00:00Z
    reply_to: aaaaaaaa
    body: |-
      First reply
      and its detail
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: A one-liner
  - id: eeeeeeee
    at: 2026-09-13T08:00:00Z
    reply_to: aaaaaaaa
    title: Second
    body: Second reply
`)

/** Numbered the way `addComment` numbers, plus a hand-written comment without one and an orphan reply that has one. */
const NUMBERED = note(`  - id: aaaaaaaa
    n: 1
    at: 2026-09-11T20:00:00Z
    body: Parent comment
  - id: bbbbbbbb
    n: 1
    at: 2026-09-12T20:00:00Z
    reply_to: aaaaaaaa
    body: First reply
  - id: cccccccc
    at: 2026-09-10T20:00:00Z
    body: Hand-written, no number
  - id: dddddddd
    n: 4
    at: 2026-09-12T21:00:00Z
    reply_to: zzzzzzzz
    body: Orphan reply
`)

const EMPTY = '---\ntitle: Funnel\n---\nBody\n'
const FOREIGN = '---\ntitle: Funnel\ncomments: text\n---\nBody\n'
const INVALID = '---\ntags: [a, b\nstatus: : :\n---\nBody\n'

let root: Root | null = null
let container: HTMLElement | null = null
/** The order toggle's door (YAZ-1515): the block writes the SETTING through it and holds no order of its own. */
const onChangeOrder = vi.fn<(order: CommentsOrder) => void>()

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  readFile.mockReset()
  writeFile.mockReset()
  writeFile.mockResolvedValue({ path: PATH, mtime: 200, size: 10 })
  openLink.mockReset()
  openLink.mockResolvedValue(undefined)
  onChangeOrder.mockReset()
})

afterEach(() => {
  unmount()
  vi.useRealTimers()
})

function unmount(): void {
  act(() => root?.unmount())
  root = null
  container?.remove()
  container = null
}

/** Mount over `content`; the disk agrees with the prop unless a test says otherwise via `readFile`. Oldest-first unless a test says otherwise. */
function mount(content: string, mtime = 100, order: CommentsOrder = 'oldest'): HTMLElement {
  unmount()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  readFile.mockResolvedValue(fileOf(content, mtime))
  act(() => root?.render(<CommentsSection file={{ path: PATH, content }} order={order} onChangeOrder={onChangeOrder} />))
  return container
}

// ---------- DOM helpers ----------

const must = <T,>(value: T | null | undefined, what: string): T => {
  if (value === null || value === undefined) throw new Error(`no ${what}`)
  return value
}
const q = <T extends Element = HTMLElement>(scope: ParentNode, selector: string): T | null => scope.querySelector<T>(selector)
const all = <T extends Element = HTMLElement>(scope: ParentNode, selector: string): T[] => [...scope.querySelectorAll<T>(selector)]

const header = (el: ParentNode) => q<HTMLButtonElement>(el, 'button.comments__header')
const tools = (el: ParentNode) => all<HTMLButtonElement>(el, 'button.comments__tool')
/** The fold-all button, by its label — the order toggle (YAZ-1515) shares its class and seat. */
const tool = (el: ParentNode) => tools(el).find((b) => /^(Collapse|Expand) all$/.test(b.textContent ?? '')) ?? null
/** The order toggle (YAZ-1515), by its label. */
const orderTool = (el: ParentNode) => tools(el).find((b) => /^(Oldest|Newest) first$/.test(b.textContent ?? '')) ?? null
const threads = (el: ParentNode) => all(el, '.comments__thread')
const articles = (scope: ParentNode) => all(scope, 'article.comments__item')
const bodyText = (article: ParentNode) => q(article, '.comments__body')?.textContent?.trim() ?? null
const headOf = (article: ParentNode) => q(article, '.comments__summary')?.textContent?.trim() ?? null
/** What a comment says on screen: its body when one is rendered, else its header line — a one-liner IS its header (🔒 D16). */
const textOf = (article: ParentNode) => bodyText(article) ?? headOf(article)
const markOf = (article: ParentNode) => q(article, '.comments__mark')
const repliesOf = (thread: ParentNode) => all(thread, '.comments__replies > article.comments__item').map(textOf)
const sheet = (el: ParentNode) => q(el, '.confirm[role="dialog"]')
/** The sheet's own buttons — never a row action. */
const sheetButton = (el: ParentNode, text: string) => all<HTMLButtonElement>(el, '.confirm__btn').find((b) => b.textContent?.trim() === text) ?? null
const bottomComposer = (el: ParentNode) => must(q<HTMLElement>(el, '.comments > .comments__composer'), 'bottom composer')
const textareaOf = (composer: ParentNode) => q<HTMLTextAreaElement>(composer, 'textarea.comments__textarea')
const titleInputOf = (composer: ParentNode) => q<HTMLInputElement>(composer, 'input.comments__title-input')
const submitOf = (composer: ParentNode) => q<HTMLButtonElement>(composer, 'button.btn--primary')
const buttonNamed = (scope: ParentNode, text: string) => all<HTMLButtonElement>(scope, 'button').find((b) => b.textContent?.trim() === text) ?? null
/** A row action (Reply / Edit / Delete) — never a composer's button. */
const action = (article: ParentNode, text: string) => all<HTMLButtonElement>(article, '.comments__action').find((b) => b.textContent?.trim() === text) ?? null

const click = (el: Element | null) => act(() => (el as HTMLElement | null)?.click())
const focus = (el: HTMLElement | null) => act(() => el?.focus())
const press = (el: Element | null, key: string, init: KeyboardEventInit = {}) =>
  act(() => void el?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })))

/** Native prototype setter + bubbling input event, so React's value tracker sees the change. */
function setValue(el: HTMLTextAreaElement | HTMLInputElement | null, value: string): void {
  if (el === null) throw new Error('no field')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  act(() => {
    setter?.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

/** Let a write's read → transform → write → adopt chain settle (timers are real; only Date is faked). */
const flush = () =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  })

/** Type into a composer (title too, when given), press its primary button, let the write land. */
async function submitVia(composer: HTMLElement, body: string, title?: string): Promise<void> {
  setValue(textareaOf(composer), body)
  if (title !== undefined) setValue(titleInputOf(composer), title)
  click(submitOf(composer))
  await flush()
}

/** The bytes the last write carried. */
const written = (): string => must(writeFile.mock.calls.at(-1), 'a write')[0].content

// ---------- render ----------

describe('CommentsSection — render', () => {
  it('threads render oldest-first by `at`, replies under their top-level parent, an orphan reply at top level', () => {
    const el = mount(THREADED)
    expect(threads(el).map((t) => textOf(articles(t)[0]))).toEqual(['Earliest, filed last', 'Parent comment', 'Orphan reply'])
    expect(threads(el).map(repliesOf)).toEqual([[], ['First reply', 'Second reply'], []])
    // The orphan is its own root: no replies row, no reply group.
    expect(q(threads(el)[2], '.comments__replies-toggle')).toBeNull()
  })

  it('the header collapses everything below it and counts replies too', () => {
    const el = mount(THREADED)
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(header(el)?.textContent).toBe('Comments (5)')

    click(header(el))
    expect(header(el)?.getAttribute('aria-expanded')).toBe('false')
    expect(q(el, '.comments__list')).toBeNull()
    expect(q(el, '.comments__composer')).toBeNull()
    expect(tool(el)).toBeNull()

    click(header(el))
    expect(q(el, '.comments__list')).not.toBeNull()
    expect(q(el, '.comments > .comments__composer')).not.toBeNull()
  })

  it('no count and no fold-all when there is nothing to count', () => {
    const el = mount(EMPTY)
    expect(header(el)?.textContent).toBe('Comments')
    expect(q(el, '.comments__count')).toBeNull()
    click(header(el)) // an empty page starts collapsed (🔒 E); the header is the door
    expect(tool(el)).toBeNull()
    expect(bottomComposer(el)).not.toBeNull()
  })

  it('relative stamps read against a fixed clock; the title holds the absolute local time', () => {
    const el = mount(THREADED)
    const times = all<HTMLTimeElement>(el, 'time.comments__when')
    // Document order: the earliest lone comment, the parent, its two replies, the orphan.
    expect(times.map((t) => t.textContent)).toEqual(['3 days ago', '2 days ago', 'yesterday', '12 hours ago', '23 hours ago'])
    expect(times[1].getAttribute('datetime')).toBe('2026-09-11T20:00:00Z')
    expect(times[1].title).toBe(new Date('2026-09-11T20:00:00Z').toLocaleString())
  })
})

// ---------- fold ----------

describe('CommentsSection — fold', () => {
  it('one fold-all control: Collapse all while anything foldable is open, Expand all once every foldable comment AND every reply group is folded — a one-liner never counts', () => {
    const el = mount(FOLDABLE)
    // ONE fold-all, at the right of the tools; the order toggle (YAZ-1515) sits to its left.
    expect(tools(el).map((b) => b.textContent)).toEqual(['Oldest first', 'Collapse all'])
    expect(tool(el)?.textContent).toBe('Collapse all')
    // Three can fold (the parent, both replies); the one-liner has no fold button and no body.
    expect(all(el, 'button.comments__fold')).toHaveLength(3)
    expect(all(el, '.comments__body')).toHaveLength(3)

    click(tool(el))
    expect(tool(el)?.textContent).toBe('Expand all')
    expect(q(el, '.comments__body')).toBeNull()
    expect(q(el, '.comments__replies')).toBeNull()
    expect(q(el, '.comments__replies-toggle')?.getAttribute('aria-expanded')).toBe('false')
    // With the reply group hidden only the parent's fold button is on screen — folded.
    expect(all(el, 'button.comments__fold').map((b) => b.getAttribute('aria-expanded'))).toEqual(['false'])
    // The one-liner still stands as its own header, untouched by the fold.
    expect(textOf(articles(el)[0])).toBe('A one-liner')

    click(tool(el))
    expect(tool(el)?.textContent).toBe('Collapse all')
    expect(all(el, '.comments__body')).toHaveLength(3)
    expect(all(el, 'button.comments__fold').every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true)

    // Every foldable comment folded by hand is not "all folded" while the reply group is still open.
    all(el, 'button.comments__fold').forEach((b) => click(b))
    expect(q(el, '.comments__body')).toBeNull()
    expect(tool(el)?.textContent).toBe('Collapse all')
    click(q(el, '.comments__replies-toggle'))
    // …and once it is, the open one-liner does not hold "Expand all" back: it has nothing to fold.
    expect(tool(el)?.textContent).toBe('Expand all')
  })

  it('the header text never moves: a titled comment folds its body under the title; a title-less multi-line comment keeps its first line (marker stripped) in the header and folds only the rest', () => {
    const el = mount(TITLED)
    const [plain, titled] = articles(el)
    // Title-less: the first line is the header from the start; only what follows is the body.
    expect(headOf(plain)).toBe('Heading line')
    expect(q(plain, '.comments__summary--title')).toBeNull()
    expect(bodyText(plain)).toBe('More text')
    expect(q(plain, '.comments__body h1')).toBeNull()
    // Titled: the title is the header; the whole body sits below.
    expect(q(titled, '.comments__summary--title')?.textContent).toBe('Churn')
    expect(bodyText(titled)).toBe('Parent comment')

    click(q(plain, 'button.comments__fold'))
    expect(q(plain, 'button.comments__fold')?.getAttribute('aria-expanded')).toBe('false')
    expect(q(plain, '.comments__body')).toBeNull()
    expect(headOf(plain)).toBe('Heading line')

    click(q(titled, 'button.comments__fold'))
    expect(q(titled, '.comments__body')).toBeNull()
    expect(all(titled, '.comments__summary').map((s) => s.textContent)).toEqual(['Churn'])

    click(q(plain, 'button.comments__fold'))
    expect(headOf(plain)).toBe('Heading line')
    expect(bodyText(plain)).toBe('More text')
  })

  it('a one-liner is its own header: no fold button (the seat is kept), its text in the header, no body', () => {
    const el = mount(LONE)
    const [one] = articles(el)
    expect(q(one, 'button.comments__fold')).toBeNull()
    expect(q(one, '.comments__fold--none')).not.toBeNull()
    expect(q(one, '.comments__summary--whole')?.textContent).toBe('Parent comment')
    expect(q(one, '.comments__summary--title')).toBeNull()
    expect(q(one, '.comments__body')).toBeNull()
  })

  it('the "N replies" row folds the replies and the in-card reply composer together', () => {
    const el = mount(THREADED)
    const thread = threads(el)[1]
    const toggle = q<HTMLButtonElement>(thread, 'button.comments__replies-toggle')
    expect(toggle?.textContent).toBe('2 replies')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(repliesOf(thread)).toEqual(['First reply', 'Second reply'])
    expect(q(thread, '.comments__replies > .comments__composer')).not.toBeNull()

    click(toggle)
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(q(thread, '.comments__replies')).toBeNull()

    click(toggle)
    expect(repliesOf(thread)).toEqual(['First reply', 'Second reply'])
    expect(q(thread, '.comments__replies > .comments__composer')).not.toBeNull()
  })
})

// ---------- composer ----------

describe('CommentsSection — composer', () => {
  it('a textarea; the title line once in use; Comment disabled while blank; ⌘Enter submits, Enter alone does not', async () => {
    const el = mount(LONE)
    const composer = bottomComposer(el)
    const textarea = textareaOf(composer)
    expect(textarea?.placeholder).toBe('Leave a comment…')
    expect(titleInputOf(composer)).toBeNull()
    expect(submitOf(composer)?.textContent).toBe('Comment')
    expect(submitOf(composer)?.disabled).toBe(true)

    focus(textarea)
    expect(titleInputOf(composer)?.placeholder).toBe('Title (optional)')
    expect(submitOf(composer)?.disabled).toBe(true)

    setValue(textarea, 'Typed')
    expect(submitOf(composer)?.disabled).toBe(false)

    press(textarea, 'Enter')
    await flush()
    expect(writeFile).not.toHaveBeenCalled()

    press(textarea, 'Enter', { metaKey: true })
    await flush()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(textarea?.value).toBe('')
  })

  it('Esc clears the draft, body and title', () => {
    const el = mount(LONE)
    const composer = bottomComposer(el)
    setValue(textareaOf(composer), 'Draft')
    setValue(titleInputOf(composer), 'Working title')

    press(textareaOf(composer), 'Escape')
    expect(textareaOf(composer)?.value).toBe('')
    expect(titleInputOf(composer)).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('submit writes addComment over the FRESH bytes, and the block adopts what landed without a watcher', async () => {
    const el = mount(LONE)
    readFile.mockResolvedValue(fileOf(FRESHER, 150))

    await submitVia(bottomComposer(el), 'New comment', 'Hello')

    expect(writeFile).toHaveBeenCalledTimes(1)
    const [request] = writeFile.mock.calls[0]
    expect(request).toMatchObject({ path: PATH, expectedMtime: 150 })
    // The entry the disk did not have when the prop was taken is still there: fresh bytes, not the prop.
    expect(request.content).toContain('    body: Landed meanwhile\n')
    // Key order on disk: id, n, at, title, body — and the number is the first of the page's run.
    expect(request.content).toMatch(/ {2}- id: "?[0-9a-f]{8}"?\n {4}n: 1\n {4}at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}title: Hello\n {4}body: New comment\n---\n/)
    expect(readComments(request.content).at(-1)).toMatchObject({ id: expect.stringMatching(ID), n: 1, at: expect.stringMatching(ISO), title: 'Hello', body: 'New comment' })

    // On screen from the returned content alone — no rerender, no watcher event.
    expect(articles(el).map(textOf)).toEqual(['Parent comment', 'Landed meanwhile', 'New comment'])
    expect(header(el)?.textContent).toBe('Comments (3)')
    expect(textareaOf(bottomComposer(el))?.value).toBe('')
  })

  it('a blank title writes no title key', async () => {
    const el = mount(LONE)
    await submitVia(bottomComposer(el), 'Untitled', '   ')
    expect(written()).toMatch(/ {2}- id: "?[0-9a-f]{8}"?\n {4}n: 1\n {4}at: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}body: Untitled\n---\n/)
    expect(readComments(written()).at(-1)).not.toHaveProperty('title')
  })
})

// ---------- reply ----------

describe('CommentsSection — reply', () => {
  it('a lone comment offers Reply: the composer opens inside the card with focus and writes reply_to', async () => {
    const el = mount(LONE)
    expect(q(el, '.comments__replies')).toBeNull()

    click(action(articles(el)[0], 'Reply'))
    const composer = must(q<HTMLElement>(el, '.comments__replies > .comments__composer'), 'reply composer')
    expect(textareaOf(composer)?.placeholder).toBe('Reply…')
    expect(document.activeElement).toBe(textareaOf(composer))

    await submitVia(composer, 'A reply')
    // The first reply under this parent: n: 1 in its own run, right after id.
    expect(written()).toMatch(/ {2}- id: "?[0-9a-f]{8}"?\n {4}n: 1\n {4}at: [^\n]+\n {4}reply_to: aaaaaaaa\n {4}body: A reply\n/)
    expect(readComments(written()).at(-1)).toMatchObject({ n: 1, reply_to: 'aaaaaaaa', body: 'A reply' })

    // Now a thread: the seat closed, the card carries its own reply row and no Reply action.
    expect(repliesOf(threads(el)[0])).toEqual(['A reply'])
    expect(q(el, 'button.comments__replies-toggle')?.textContent).toBe('1 reply')
    expect(action(articles(el)[0], 'Reply')).toBeNull()
  })

  it('a threaded card carries its own Reply… row and NO Reply action; submitting it writes reply_to the parent', async () => {
    const el = mount(THREADED)
    const thread = threads(el)[1]
    expect(all(thread, '.comments__action').filter((b) => b.textContent?.trim() === 'Reply')).toHaveLength(0)

    const composer = must(q<HTMLElement>(thread, '.comments__replies > .comments__composer'), 'thread reply composer')
    expect(composer.classList.contains('comments__composer--collapsed')).toBe(true)
    expect(textareaOf(composer)?.placeholder).toBe('Reply…')
    expect(submitOf(composer)).toBeNull()

    setValue(textareaOf(composer), 'Third reply')
    expect(composer.classList.contains('comments__composer--collapsed')).toBe(false)
    expect(submitOf(composer)?.textContent).toBe('Reply')

    click(submitOf(composer))
    await flush()
    expect(readComments(written()).at(-1)).toMatchObject({ reply_to: 'aaaaaaaa', body: 'Third reply' })
    expect(repliesOf(threads(el)[1])).toEqual(['First reply', 'Second reply', 'Third reply'])
  })
})

// ---------- edit and delete ----------

describe('CommentsSection — edit and delete', () => {
  it('Edit replaces the body with a composer prefilled with body AND title; Save writes edited and the new title', async () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]

    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')
    expect(q(titled, '.comments__body')).toBeNull()
    expect(textareaOf(composer)?.value).toBe('Parent comment')
    expect(titleInputOf(composer)?.value).toBe('Churn')

    setValue(textareaOf(composer), 'Parent comment revised')
    setValue(titleInputOf(composer), 'Churn revisited')
    click(buttonNamed(composer, 'Save'))
    await flush()

    expect(written()).toMatch(/ {4}title: Churn revisited\n {4}edited: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\n {4}body: Parent comment revised\n/)
    expect(readComments(written()).find((c) => c.id === 'aaaaaaaa')).toMatchObject({ title: 'Churn revisited', body: 'Parent comment revised', edited: expect.stringMatching(ISO) })

    const after = articles(el)[1]
    expect(q(after, '.comments__composer')).toBeNull()
    expect(bodyText(after)).toBe('Parent comment revised')
    expect(q(after, '.comments__summary--title')?.textContent).toBe('Churn revisited')
    expect(q(after, '.comments__edited')?.textContent).toBe('(edited)')
  })

  it('a blank title on Save removes the title key', async () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]
    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')

    setValue(titleInputOf(composer), '')
    click(buttonNamed(composer, 'Save'))
    await flush()

    expect(written()).not.toContain('    title:')
    expect(readComments(written()).find((c) => c.id === 'aaaaaaaa')).not.toHaveProperty('title')
    expect(q(articles(el)[1], '.comments__summary--title')).toBeNull()
  })

  it('Cancel restores the body without a write', () => {
    const el = mount(TITLED)
    const titled = articles(el)[1]
    click(action(titled, 'Edit'))
    const composer = must(q<HTMLElement>(titled, '.comments__composer'), 'edit composer')
    setValue(textareaOf(composer), 'scrapped')

    click(buttonNamed(composer, 'Cancel'))
    expect(q(titled, '.comments__composer')).toBeNull()
    expect(bodyText(titled)).toBe('Parent comment')
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('Delete asks first (🔒 D17): the sheet opens with no write; Confirm writes the delete, a parent taking its replies with it', async () => {
    const el = mount(THREADED)
    click(action(articles(threads(el)[1])[0], 'Delete'))
    await flush()

    // The sheet, and nothing on disk touched — not even read.
    const dialog = must(sheet(el), 'the confirm sheet')
    expect(q(dialog, '.confirm__text')?.textContent).toBe('Delete this comment and its 2 replies? This cannot be undone.')
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(articles(el)).toHaveLength(5)

    click(sheetButton(dialog, 'Delete'))
    await flush()
    expect(sheet(el)).toBeNull()
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(readComments(written()).map((c) => c.id)).toEqual(['cccccccc', 'dddddddd'])
    expect(threads(el).map((t) => textOf(articles(t)[0]))).toEqual(['Earliest, filed last', 'Orphan reply'])
    expect(header(el)?.textContent).toBe('Comments (2)')
  })

  it('Cancel on the sheet writes nothing and leaves the comment where it was', async () => {
    const el = mount(LONE)
    click(action(articles(el)[0], 'Delete'))
    const dialog = must(sheet(el), 'the confirm sheet')

    click(sheetButton(dialog, 'Cancel'))
    await flush()
    expect(sheet(el)).toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
    expect(articles(el).map(textOf)).toEqual(['Parent comment'])
  })

  it('the sheet names the number the row wears and, for a parent, its replies', () => {
    const el = mount(NUMBERED)
    const [unnumbered, parent, reply] = articles(el)

    click(action(parent, 'Delete'))
    expect(q(must(sheet(el), 'sheet'), '.confirm__text')?.textContent).toBe('Delete comment #1 and its reply? This cannot be undone.')
    click(sheetButton(el, 'Cancel'))

    click(action(reply, 'Delete'))
    expect(q(must(sheet(el), 'sheet'), '.confirm__text')?.textContent).toBe('Delete comment #1.1? This cannot be undone.')
    click(sheetButton(el, 'Cancel'))

    click(action(unnumbered, 'Delete'))
    expect(q(must(sheet(el), 'sheet'), '.confirm__text')?.textContent).toBe('Delete this comment? This cannot be undone.')
    click(sheetButton(el, 'Cancel'))
    expect(sheet(el)).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------- numbers ----------

describe('CommentsSection — numbers (🔒 D15)', () => {
  it('the mark wears `#1` for a top-level comment, `#1.1` for its reply, a dot for a comment without `n` and for an orphan reply', () => {
    const el = mount(NUMBERED)
    // Document order: the unnumbered hand-written one (earliest), the parent, its reply, the orphan.
    expect(articles(el).map(textOf)).toEqual(['Hand-written, no number', 'Parent comment', 'First reply', 'Orphan reply'])
    expect(articles(el).map((a) => markOf(a)?.textContent)).toEqual(['·', '#1', '#1.1', '·'])
    expect(articles(el).map((a) => markOf(a)?.title)).toEqual(['No number on this comment', 'Comment #1', 'Comment #1.1', 'No number on this comment'])
  })

  it('a reply under a parent that has no number is a dot too — there is no run to belong to', () => {
    const el = mount(note(`  - id: aaaaaaaa\n    at: 2026-09-11T20:00:00Z\n    body: Parent comment\n  - id: bbbbbbbb\n    n: 1\n    at: 2026-09-12T20:00:00Z\n    reply_to: aaaaaaaa\n    body: First reply\n`))
    expect(articles(el).map((a) => markOf(a)?.textContent)).toEqual(['·', '·'])
  })

  it('a comment written from the block wears its number at once — one past the highest on the page', async () => {
    const el = mount(NUMBERED)
    await submitVia(bottomComposer(el), 'Fresh')
    // The orphan's n: 4 is a reply's number and never bumps the top-level run: the new comment is #2.
    expect(readComments(written()).at(-1)).toMatchObject({ n: 2, body: 'Fresh' })
    expect(markOf(must(articles(el).at(-1), 'the new comment'))?.textContent).toBe('#2')
  })
})

// ---------- by ----------

describe('CommentsSection — by', () => {
  it('`by` marks the article as an agent’s and shows the raw value after the time; without it, neither', () => {
    const el = mount(AGENT)
    const [plain, agent] = articles(el)

    expect(agent.classList.contains('comments__item--agent')).toBe(true)
    const by = must(q<HTMLElement>(agent, '.comments__by'), 'by')
    expect(by.textContent).toBe('(agent)')
    const time = must(q<HTMLElement>(agent, 'time.comments__when'), 'time')
    expect(time.compareDocumentPosition(by) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(plain.classList.contains('comments__item--agent')).toBe(false)
    expect(q(plain, '.comments__by')).toBeNull()
  })
})

// ---------- shapes ----------

describe('CommentsSection — shapes', () => {
  it('a foreign `comments` value: the notice, no composer, no write on any interaction', () => {
    const el = mount(FOREIGN)
    click(header(el)) // nothing to read → starts collapsed (🔒 E)
    expect(q(el, '.comments__notice')?.textContent).toContain("isn't a comment list")
    expect(q(el, '.comments__composer')).toBeNull()
    expect(q(el, '.comments__list')).toBeNull()
    expect(header(el)?.textContent).toBe('Comments')

    click(header(el))
    click(header(el))
    expect(q(el, '.comments__notice')).not.toBeNull()
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('a properties block that does not parse: the "doesn\'t parse" notice, no composer, no write', () => {
    const el = mount(INVALID)
    click(header(el)) // nothing to read → starts collapsed (🔒 E)
    expect(q(el, '.comments__notice')?.textContent).toContain("doesn't parse")
    expect(q(el, '.comments__composer')).toBeNull()

    click(header(el))
    click(header(el))
    expect(readFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

// ---------- errors ----------

describe('CommentsSection — errors', () => {
  it('a failed write shows one alert line and keeps the draft; the block stays usable', async () => {
    const el = mount(LONE)
    writeFile.mockRejectedValueOnce(new BridgeRequestError('IO_ERROR', 'disk on fire'))
    const composer = bottomComposer(el)

    await submitVia(composer, 'Keep me')
    const alerts = all(el, '[role="alert"].comments__error')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toBe('Could not save the comment: disk on fire')
    expect(textareaOf(composer)?.value).toBe('Keep me')
    expect(submitOf(composer)?.disabled).toBe(false)
    expect(articles(el)).toHaveLength(1)

    click(submitOf(composer))
    await flush()
    expect(q(el, '.comments__error')).toBeNull()
    expect(articles(el).map(textOf)).toEqual(['Parent comment', 'Keep me'])
    expect(textareaOf(composer)?.value).toBe('')
  })
})

describe('CommentsSection — links and stale edits', () => {
  it('a link in a body opens through the shell; the click never navigates the app window', () => {
    // Below the header line: the first line is the header, rendered as text, so a link lives in the rest.
    const el = mount(note(`  - id: aaaaaaaa\n    at: 2026-09-11T18:22:31Z\n    body: "Read this\\nSee [the site](https://example.com) now."\n`))
    const a = must(q<HTMLAnchorElement>(el, '.comments__body a'), 'the link')
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true })
    act(() => void a.dispatchEvent(ev))
    expect(ev.defaultPrevented).toBe(true)
    expect(openLink).toHaveBeenCalledWith({ href: 'https://example.com', sourcePath: PATH })
  })

  it('Save refuses when the comment changed on disk underneath: one alert line, no write, the edit seat stays open', async () => {
    const el = mount(LONE)
    const article = articles(el)[0]
    click(action(article, 'Edit'))
    // Meanwhile another window edited the same comment.
    readFile.mockResolvedValue(fileOf(LONE.replace('Parent comment', 'Parent comment, changed elsewhere'), 150))
    const composer = must(q<HTMLElement>(article, '.comments__composer'), 'the edit seat')
    await submitVia(composer, 'My version')
    expect(writeFile).not.toHaveBeenCalled()
    expect(q(el, '[role="alert"].comments__error')?.textContent).toContain('changed on disk')
    expect(q(article, '.comments__composer')).not.toBeNull()
    expect(textareaOf(composer)?.value).toBe('My version')
  })
})

describe('CommentsSection — one-liners keep their Markdown; nothing to fold, no fold-all', () => {
  it('a title-less one-liner renders its inline Markdown in the header row', () => {
    const el = mount(note(`  - id: aaaaaaaa\n    n: 1\n    at: 2026-09-11T18:22:31Z\n    body: "See **this** and [site](https://example.com)"\n`))
    const head = must(q(el, '.comments__summary'), 'the header seat')
    expect(head.querySelector('strong')?.textContent).toBe('this')
    expect(head.querySelector('a')?.getAttribute('href')).toBe('https://example.com')
    expect(q(el, '.comments__body')).toBeNull()
  })

  it('a page of only one-liners has nothing to fold, so there is no fold-all button', () => {
    const el = mount(note(`  - id: aaaaaaaa\n    n: 1\n    at: 2026-09-11T18:22:31Z\n    body: One.\n  - id: bbbbbbbb\n    n: 2\n    at: 2026-09-11T19:22:31Z\n    body: Two.\n`))
    expect(articles(el)).toHaveLength(2)
    expect(tool(el)).toBeNull()
  })
})

// ---------- order (YAZ-1515) ----------

/** Three top-level comments, numbered, filed in `at` order. */
const THREE = note(`  - id: aaaaaaaa
    n: 1
    at: 2026-09-10T20:00:00Z
    body: First
  - id: bbbbbbbb
    n: 2
    at: 2026-09-11T20:00:00Z
    body: Second
  - id: cccccccc
    n: 3
    at: 2026-09-12T20:00:00Z
    body: Third
`)

const marks = (el: ParentNode) => threads(el).map((t) => markOf(articles(t)[0])?.textContent)

describe('order (YAZ-1515)', () => {
  it('oldest-first reads #1 #2 #3 top-down; newest-first reads #3 #2 #1', () => {
    expect(marks(mount(THREE, 100, 'oldest'))).toEqual(['#1', '#2', '#3'])
    expect(marks(mount(THREE, 100, 'newest'))).toEqual(['#3', '#2', '#1'])
  })

  it('replies inside a thread stay oldest-first under both orders: a conversation reads down', () => {
    const oldest = mount(THREADED, 100, 'oldest')
    expect(threads(oldest).map((t) => textOf(articles(t)[0]))).toEqual(['Earliest, filed last', 'Parent comment', 'Orphan reply'])
    expect(repliesOf(threads(oldest)[1])).toEqual(['First reply', 'Second reply'])

    const newest = mount(THREADED, 100, 'newest')
    expect(threads(newest).map((t) => textOf(articles(t)[0]))).toEqual(['Orphan reply', 'Parent comment', 'Earliest, filed last'])
    expect(repliesOf(threads(newest)[1])).toEqual(['First reply', 'Second reply'])
  })

  it('the toggle names the CURRENT order and asks for the other one; it never flips itself', () => {
    const el = mount(THREE, 100, 'oldest')
    expect(orderTool(el)?.textContent).toBe('Oldest first')
    expect(orderTool(el)?.title).toBe('Show newest first')
    click(orderTool(el))
    expect(onChangeOrder).toHaveBeenCalledTimes(1)
    expect(onChangeOrder).toHaveBeenCalledWith('newest')
    // State-driven: the label follows the PROP, not the click.
    expect(orderTool(el)?.textContent).toBe('Oldest first')

    const flipped = mount(THREE, 100, 'newest')
    expect(orderTool(flipped)?.textContent).toBe('Newest first')
    expect(orderTool(flipped)?.title).toBe('Show oldest first')
    click(orderTool(flipped))
    expect(onChangeOrder).toHaveBeenLastCalledWith('oldest')
  })

  it('the toggle sits LEFT of fold-all, and is absent below two threads and while the header is collapsed', () => {
    expect(orderTool(mount(EMPTY))).toBeNull()
    expect(orderTool(mount(LONE))).toBeNull()
    // Exactly two roots is the boundary: that is enough, because the roots are what reorder.
    expect(orderTool(mount(FRESHER))).not.toBeNull()
    expect(tools(mount(FOLDABLE)).map((b) => b.textContent)).toEqual(['Oldest first', 'Collapse all'])

    const el = mount(THREE)
    expect(orderTool(el)).not.toBeNull()
    click(header(el))
    expect(orderTool(el)).toBeNull()
    click(header(el))
    expect(orderTool(el)).not.toBeNull()
  })

  it('the composer follows the list under BOTH orders (it never moves to the top)', () => {
    for (const order of ['oldest', 'newest'] as const) {
      expect(q(mount(THREE, 100, order), '.comments > .comments__list + .comments__composer')).not.toBeNull()
    }
    // And the rule that seats it below the list carries no `order` of its own.
    const rule = must(commentsCss.match(/\.comments__list\s*\+\s*\.comments__composer\s*\{([^}]*)\}/s)?.[1], 'the list + composer rule')
    expect(rule).toMatch(/margin-top:\s*16px;/)
    expect(rule).not.toMatch(/\border:/)
  })

  it('the block draws no hairline of its own above the header (YAZ-1675)', () => {
    const rule = must(commentsCss.match(/\.comments\s*\{([^}]*)\}/s)?.[1], 'the .comments rule')
    expect(rule).not.toMatch(/border/)
  })

  it('adding under newest-first: the new comment renders FIRST on screen while the file still APPENDS it', async () => {
    const el = mount(THREE, 100, 'newest')
    await submitVia(bottomComposer(el), 'Fourth')
    expect(readComments(written()).at(-1)?.body).toBe('Fourth')
    expect(threads(el).map((t) => textOf(articles(t)[0]))[0]).toBe('Fourth')
    expect(markOf(articles(threads(el)[0])[0])?.textContent).toBe('#4')
  })
})

// ---------- header wrap (⚡ YAZ-1516) ----------

describe('header wrap (YAZ-1516)', () => {
  const TITLE = 'Why the enterprise onboarding funnel leaks at Q3'

  it('a 48-char title is rendered WHOLE in the header row', () => {
    expect(TITLE).toHaveLength(48)
    const el = mount(note(`  - id: aaaaaaaa\n    n: 1\n    at: 2026-09-11T18:22:31Z\n    title: ${TITLE}\n    body: |-\n      Line one\n      Line two\n`))
    const head = must(q(el, '.comments__summary'), 'the header seat')
    expect(head.textContent).toBe(TITLE)
    expect(head.classList.contains('comments__summary--title')).toBe(true)
  })

  it('CSS: the summary wraps — no nowrap, no ellipsis — and every seat beside it sits on the 20px first line', () => {
    const summary = must(commentsCss.match(/\.comments__summary\s*\{([^}]*)\}/s)?.[1], 'the .comments__summary rule')
    expect(summary).not.toMatch(/nowrap|text-overflow|overflow:\s*hidden/)
    expect(summary).toMatch(/line-height:\s*20px;/)
    expect(summary).toMatch(/overflow-wrap:\s*anywhere;/)
    // The one-liner's class is a hook only now: no rule of its own.
    expect(commentsCss).not.toMatch(/\.comments__summary--whole\s*\{/)
    expect(commentsCss).toMatch(/\.comments__meta\s*\{[^}]*align-items:\s*flex-start;/s)
  })
})

// ---------- default open state (🔒 E, YAZ-1515) ----------

describe('default open state (YAZ-1515 🔒 E)', () => {
  it('a page with comments opens expanded; a page with none opens collapsed, header only', () => {
    expect(header(mount(LONE))?.getAttribute('aria-expanded')).toBe('true')
    expect(q(mount(LONE), '.comments__composer')).not.toBeNull()

    const empty = mount(EMPTY)
    expect(header(empty)?.getAttribute('aria-expanded')).toBe('false')
    expect(q(empty, '.comments__composer')).toBeNull()
    expect(tools(empty)).toEqual([])
  })

  it('a foreign or invalid block has nothing to read, so it starts collapsed too', () => {
    expect(header(mount(FOREIGN))?.getAttribute('aria-expanded')).toBe('false')
    expect(header(mount(INVALID))?.getAttribute('aria-expanded')).toBe('false')
  })

  it('the default is decided once at mount: opening an empty page and adding the first comment leaves it open', async () => {
    const el = mount(EMPTY)
    click(header(el))
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    await submitVia(bottomComposer(el), 'First')
    expect(header(el)?.textContent).toBe('Comments (1)')
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
  })

  it('deleting the last comment does not close the block', async () => {
    const el = mount(LONE)
    click(action(articles(el)[0], 'Delete'))
    await flush()
    click(sheetButton(must(sheet(el), 'the sheet'), 'Delete'))
    await flush()
    expect(header(el)?.textContent).toBe('Comments')
    expect(header(el)?.getAttribute('aria-expanded')).toBe('true')
    expect(bottomComposer(el)).not.toBeNull()
  })
})
