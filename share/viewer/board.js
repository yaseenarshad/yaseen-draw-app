/**
 * WHAT BOTH VIEWERS SHARE (YAZ-1799, 🔒 YAZ-1802 D11): the board's details from the page's JSON
 * block and its "updated …" line, loading the board from `/scene/<id>`, and the real download. The
 * Excalidraw viewer (`entry.js`) and the draw.io one (`diagram.js`) differ only in what they draw.
 */
export const board = JSON.parse(document.getElementById('board').textContent)
if (board.updatedAt > 0) document.getElementById('meta').textContent = `${board.allowDownload ? 'View and download' : 'View only'} · updated ${new Date(board.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
export const note = document.getElementById('note')
export const safeName = board.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'board'

export function save(blob, filename) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
}

/** The board as stored, or null when it is gone — the page reloads into the "stopped" page. `noun` names it in a failure. */
export async function loadBoard(noun) {
  try {
    const res = await fetch(`/scene/${board.id}`, { cache: 'no-store' })
    if (res.status === 404) {
      location.reload()
      return null
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (err) {
    note.textContent = `This ${noun} could not be loaded. The link may have just been stopped.`
    throw err
  }
}

/** The board's own file (`.<ext>`) through the real download route: the Worker refuses it (403) if the owner turned downloads off since this page loaded. */
export function wireDownload(button, ext, noun) {
  button.onclick = async () => {
    const res = await fetch(`/raw/${board.id}?download=1`, { cache: 'no-store' })
    if (!res.ok) return alert(res.status === 403 ? `The owner turned off downloads for this ${noun}.` : `Download failed (HTTP ${res.status}).`)
    save(await res.blob(), `${safeName}.${ext}`)
  }
}
