import type { Theme } from '@shared/types'
import type { Store } from './store'

/**
 * Appearance in the main process (Desktop K, GRO-2218). `SettingsState.theme` IS Electron's
 * `nativeTheme.themeSource` vocabulary ('system' | 'light' | 'dark'), so mirroring is a straight
 * assignment — index.ts applies it before any window exists and re-applies on store changes.
 * Electron-free (like menu.ts/store.ts) so it unit-tests without a browser.
 */

/** Window chrome/backing colours per effective theme — keep in sync with `--bg` in client/src/app.css. */
export const WINDOW_BG = { light: '#ffffff', dark: '#1e1e1e' } as const

/**
 * The `BrowserWindow` `backgroundColor` for the current setting: kills the white flash on dark
 * launches (the backing store shows this until the renderer's themed first paint).
 */
export function windowBackgroundColor(theme: Theme, systemPrefersDark: boolean): string {
  return WINDOW_BG[theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme]
}

/** Applies the loaded theme at once, then re-applies on store changes only when it actually changed. */
export function subscribeNativeTheme(store: Store, apply: (theme: Theme) => void): () => void {
  let last = store.get().settings.theme
  apply(last)
  return store.onChange((state) => {
    if (state.settings.theme === last) return
    last = state.settings.theme
    apply(last)
  })
}
