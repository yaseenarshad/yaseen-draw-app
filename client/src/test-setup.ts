// jsdom lacks a few layout/observer APIs the canvas and the tree touch.
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
// React 18+ refuses `act()` unless the environment opts in; every component suite needs it.
g.IS_REACT_ACT_ENVIRONMENT = true
// jsdom leaves `navigator.platform` empty; `buildSetupPrompt` reads it to pick the git-install
// line, and the app ships mac-only, so say what the user's machine says.
if (navigator.platform === '') Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
document.elementFromPoint ??= () => null
