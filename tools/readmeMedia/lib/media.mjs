/**
 * ffmpeg for the README captures: recorded frames → a looping GIF, a 2× screenshot → a sharp PNG at
 * its final size. `FFMPEG` names the binary when it is not on PATH or in one of the usual places.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function findFfmpeg() {
  const candidates = [process.env.FFMPEG, 'ffmpeg', path.join(os.homedir(), '.local/bin/ffmpeg'), '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].filter(Boolean)
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' })
      return bin
    } catch {
      // try the next place
    }
  }
  throw new Error('ffmpeg not found: install it, or set FFMPEG to its path')
}
let ffmpegBin
const ffmpeg = (args) => execFileSync((ffmpegBin ??= findFfmpeg()), ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * The made-up desktop (desktop.html, rendered with a hole where the window's content goes) around a
 * picture of the app: `[inputs, filter]` that scale the stream `[app]` into `desktop.content`, set
 * it on a canvas the size of `desktop.png` and lay the desktop over it — the hole's rounded corners
 * are the window's.
 */
function onDesktop(desktop, index) {
  const { x, y, width, height } = desktop.content
  const canvas = sizeOf(desktop.png)
  return [['-i', desktop.png], `[app]scale=${width}:${height}:flags=lanczos,format=rgb24,pad=${canvas.width}:${canvas.height}:${x}:${y}:color=white[under];[under][${index}:v]overlay=0:0:format=gbrp`]
}

/**
 * `frames` (`Recorder.stop()`: `{ file, at }`, seconds) → `out`, a GIF that loops for ever: the
 * frames set in `desktop` (`{ png, content: { x, y, width, height } }`), or alone at `width` px. A
 * frame stays until the next one's time, the last for `hold` seconds; one palette is built from the
 * whole clip, and only the part of the picture that changed is stored per frame. Returns the GIF's
 * length in seconds.
 */
export function gif(frames, out, { width = 1200, fps = 20, hold = 1.8, colors = 256, desktop } = {}) {
  if (frames.length === 0) throw new Error(`no frames for ${out}`)
  const quote = (file) => `file '${file.replaceAll("'", "'\\''")}'`
  const lines = frames.flatMap((frame, i) => [quote(frame.file), `duration ${(i + 1 < frames.length ? frames[i + 1].at - frame.at : hold).toFixed(4)}`])
  lines.push(quote(frames.at(-1).file), 'duration 0.0100') // the concat demuxer drops the last duration without it
  const list = path.join(path.dirname(frames[0].file), 'frames.txt')
  fs.writeFileSync(list, `ffconcat version 1.0\n${lines.join('\n')}\n`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const [inputs, picture] = desktop ? onDesktop(desktop, 1) : [[], `[app]scale=${width}:-1:flags=lanczos`]
  const filter = `[0:v]fps=${fps}[app];${picture},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, ...inputs, '-filter_complex', filter, '-loop', '0', out])
  return gifSeconds(out)
}

/**
 * `src` (a PNG) → `out`: `crop` (`{ x, y, width, height }` in `src`'s own pixels) first, then either
 * set in `desktop` (as `gif`) or scaled to `width` × `height` (Lanczos; alpha is kept).
 */
export function png(src, out, { width, height = -1, crop, desktop } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const cut = crop ? `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}` : 'null'
  const [inputs, picture] = desktop ? onDesktop(desktop, 1) : [[], `[app]${width ? `scale=${width}:${height}:flags=lanczos` : 'null'}`]
  ffmpeg(['-i', src, ...inputs, '-filter_complex', `[0:v]${cut}[app];${picture}`, '-frames:v', '1', '-update', '1', out])
}

/** A GIF's length: the sum of its frames' delays (hundredths of a second, in each graphic control block). */
export function gifSeconds(file) {
  const buf = fs.readFileSync(file)
  let hundredths = 0
  for (let i = buf.indexOf(Buffer.from([0x21, 0xf9, 0x04])); i !== -1; i = buf.indexOf(Buffer.from([0x21, 0xf9, 0x04]), i + 8)) hundredths += buf.readUInt16LE(i + 4)
  return hundredths / 100
}

/** `{ width, height, bytes }` of a PNG or a GIF, read from its header. */
export function sizeOf(file) {
  const buf = fs.readFileSync(file)
  const bytes = buf.length
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), bytes }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes }
}
