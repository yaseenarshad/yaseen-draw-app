/**
 * The shared harness for the editor tests (`highlight.test.ts`, `underline.test.ts`,
 * `lineSelection.test.ts`, `lineSelection.scenarios.test.ts`).
 *
 * They all drive a REAL editor (`createCrepe`) rather than a bare ProseMirror state, so they all
 * need the same things: a mount that registers itself for teardown, a way to find text or a node
 * by its characters or type, a way to select it or put a caret in it, the marks sitting on it,
 * one key press through ProseMirror's own `handleKeyDown` chain, typed text through
 * `handleTextInput`, and a command run against the live view. Each file used to carry a private
 * copy; this is the single one.
 *
 * Teardown is deliberately NOT an `afterEach` here — a module-level hook would register once per
 * importing file anyway, but leaving it explicit keeps the ownership obvious: every file that
 * calls `mount` calls `unmountAll()` in its own `afterEach`.
 *
 * Probes only one file cares about (colours, `<mark>` element lists, the bullets-only mount, …)
 * stay in that file.
 */
import type { Crepe } from '@milkdown/crepe'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { createCrepe, getMarkdownForSave } from '../createCrepe'

const mounted: Array<{ crepe: Crepe; root: HTMLElement }> = []

/** A real Crepe on a real detached root, pushed onto the teardown list. */
export async function mount(markdown: string): Promise<{ crepe: Crepe; root: HTMLElement; view: EditorView }> {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const crepe = createCrepe({ root, defaultValue: markdown })
  await crepe.create()
  mounted.push({ crepe, root })
  return { crepe, root, view: crepe.editor.ctx.get(editorViewCtx) }
}

/** Destroy every editor mounted since the last call — each test file's `afterEach` runs this. */
export async function unmountAll(): Promise<void> {
  for (const m of mounted.splice(0)) {
    await m.crepe.destroy()
    m.root.remove()
  }
}

/** `test-setup.ts` pins `navigator.platform` to MacIntel, so `Mod-` resolves to ⌘ here. */
export const IS_MAC = /Mac/.test(navigator.platform)

/**
 * One key press through ProseMirror's `handleKeyDown` — the same path a real keyboard takes, so
 * keymap priority and `Mod-` resolution are both under test. A bare key by default (`ArrowDown`,
 * `Backspace`, `Enter`); `{ mod: true }` adds `Mod` = ⌘ on mac, Ctrl elsewhere (the mark hotkeys,
 * `⌘.` zoom). `w3c-keyname` reads `key` / `keyCode` only, so no `code` is set.
 */
export function pressKey(crepe: Crepe, key: string, opts: { shift?: boolean; mod?: boolean } = {}): boolean {
  return crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const event = new KeyboardEvent('keydown', {
      key,
      shiftKey: opts.shift ?? false,
      ...(opts.mod === true ? (IS_MAC ? { metaKey: true } : { ctrlKey: true }) : {}),
      bubbles: true,
      cancelable: true,
    })
    return view.someProp('handleKeyDown', (handler) => handler(view, event)) ?? false
  })
}

/** Typed text through ProseMirror's `handleTextInput` chain, as the DOM input path would deliver it. */
export const typeText = (crepe: Crepe, text: string): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const { from, to } = view.state.selection
    return view.someProp('handleTextInput', (h) => h(view, from, to, text, () => view.state.tr)) ?? false
  })

/** Run a ProseMirror command against the live view (the fold plugins' own test pattern). */
export const runCommand = (crepe: Crepe, command: (state: EditorView['state'], dispatch: EditorView['dispatch']) => boolean): boolean =>
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    return command(view.state, view.dispatch)
  })

/** Document position of the first occurrence of `text` inside a single text node — its START. */
export function posOf(crepe: Crepe, text: string): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      const index = node.isText ? (node.text ?? '').indexOf(text) : -1
      if (index >= 0) pos = nodePos + index
      return pos < 0
    })
    if (pos < 0) throw new Error(`text not found: ${text}`)
    return pos
  })
}

/** Document position just after the first occurrence of `text`. */
export const endOf = (crepe: Crepe, text: string): number => posOf(crepe, text) + text.length

/** Document position (before) of the first node of type `typeName`. */
export function nodePos(crepe: Crepe, typeName: string): number {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos < 0 && node.type.name === typeName) pos = nodePos
      return pos < 0
    })
    if (pos < 0) throw new Error(`no ${typeName} node`)
    return pos
  })
}

/** Position inside the first EMPTY textblock (an empty paragraph or an empty bullet's paragraph). */
export const emptyTextblockPos = (crepe: Crepe): number =>
  crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    let pos = -1
    doc.descendants((node, nodePos) => {
      if (pos >= 0) return false
      if (node.isTextblock && node.content.size === 0) pos = nodePos + 1
      return pos < 0
    })
    if (pos < 0) throw new Error('no empty textblock')
    return pos
  })

/** Set a `TextSelection` by positions: a caret at `anchor`, or `anchor` → `head`. */
export function select(crepe: Crepe, anchor: number, head = anchor): void {
  crepe.editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)))
  })
}

/** The live selection's `anchor` / `head`. */
export const selection = (crepe: Crepe): { anchor: number; head: number } =>
  crepe.editor.action((ctx) => {
    const { anchor, head } = ctx.get(editorViewCtx).state.selection
    return { anchor, head }
  })

/** Select from the start of `start` to the end of `end` — a range that can span text nodes. */
export const selectAcross = (crepe: Crepe, start: string, end: string): void => select(crepe, posOf(crepe, start), endOf(crepe, end))

/** Select exactly `text`. */
export const selectText = (crepe: Crepe, text: string): void => selectAcross(crepe, text, text)

/** Put the caret (empty selection) just inside the text node containing `text`. */
export const caretIn = (crepe: Crepe, text: string): void => select(crepe, posOf(crepe, text) + 1)

/** Mark names on the text node containing `text`. */
export function marksOn(crepe: Crepe, text: string): string[] {
  return crepe.editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc
    const $pos = doc.resolve(posOf(crepe, text) + 1)
    return $pos.marks().map((m) => m.type.name).sort()
  })
}

/** The bytes this editor would write to the vault. */
export const md = (crepe: Crepe): string => getMarkdownForSave(crepe)
