/**
 * Live Crepe theme swap (Desktop K, GRO-2218): the frame / frame-dark themes are pure
 * `--crepe-*` custom-property blocks on `.milkdown`, so flipping Appearance is CSS-only —
 * no editor remount. Both files are bundled as strings (`?inline`, so neither lands as a
 * global stylesheet) and the active one lives in a single managed <style> tag; app.css
 * overrides (fonts, transparent background) keep winning on specificity, exactly as they
 * did over the old static `theme/frame.css` import (replaced by this, see main.tsx).
 */
import frameDark from '@milkdown/crepe/theme/frame-dark.css?inline'
import frameLight from '@milkdown/crepe/theme/frame.css?inline'

export const CREPE_THEME_STYLE_ID = 'crepe-theme'

export function applyCrepeTheme(theme: 'light' | 'dark'): void {
  let el = document.getElementById(CREPE_THEME_STYLE_ID)
  if (el === null) {
    el = document.createElement('style')
    el.id = CREPE_THEME_STYLE_ID
    document.head.appendChild(el)
  }
  const css = theme === 'dark' ? frameDark : frameLight
  if (el.textContent !== css) el.textContent = css
}
