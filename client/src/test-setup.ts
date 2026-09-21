// jsdom lacks a few layout/observer APIs that ProseMirror/CodeMirror touch; Crepe otherwise runs fine in jsdom.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
const g = globalThis as unknown as Record<string, unknown>
g.IntersectionObserver ??= NoopObserver
g.ResizeObserver ??= NoopObserver
// prosemirror-keymap resolves `Mod-` from `navigator.platform`, which jsdom leaves empty (→ Ctrl).
// The app ships mac-only, so `Mod-` is ⌘ everywhere it runs; say so, and a test pressing ⌘ presses
// what the user presses. (`IS_MAC` in the older keyboard tests reads the same property and follows.)
if (navigator.platform === '') Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
}
document.elementFromPoint ??= () => null
