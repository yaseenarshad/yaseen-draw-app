import { describe, expect, it } from 'vitest'
import tabsCss from './tabs.css?raw'

/**
 * 🔒 YAZ-1862: a hidden tab shows NOTHING. The engine forces its footer buttons back to
 * `visibility: visible` (`.excalidraw .ToolIcon_type_button--show`), which beats a plain hidden
 * parent — so a background tab's zoom label painted over the active one and took its clicks.
 */
describe('hidden tab layer', () => {
  it('keeps even an engine-forced visible child hidden', () => {
    const style = document.createElement('style')
    style.textContent = `${tabsCss}\n.excalidraw .ToolIcon_type_button--show { visibility: visible; }`
    document.head.append(style)
    document.body.innerHTML =
      '<div class="tabstack__layer tabstack__layer--hidden"><div class="excalidraw"><button class="ToolIcon_type_button--show">100%</button></div></div>'
    expect(getComputedStyle(document.querySelector('button')!).visibility).toBe('hidden')
    style.remove()
  })
})
