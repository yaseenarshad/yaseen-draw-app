#!/usr/bin/env node
/**
 * USAGE: node tools/smokeShare.mjs [--port 8799] [--keep]
 *
 * A headless smoke of share links (YAZ-1892 5A) — no Electron, no browser. Seeds the share demo
 * vault (`tools/seedShareDemoVault.mjs`) into a temp dir, starts `tools/fakeCloudflare.mjs` on it,
 * and drives main's REAL `sharing.ts` (bundled on the fly with esbuild) the way the app does:
 * set up with `demo-good`, share board 02 (its lean images embedded, as the Share dialog would),
 * check `/b` and `/raw`, flip to view only (→ 403), stop (→ 404). Then stops the server and, unless
 * `--keep`, deletes the temp dir. Exits non-zero on the first failed check.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const args = process.argv.slice(2)
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : 8799)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ORIGIN = `http://127.0.0.1:${PORT}`
const dir = await mkdtemp(path.join(tmpdir(), 'share-smoke-'))
const vault = path.join(dir, 'Share Button (YAZ-1799)')
let failed = false
const check = (ok, what) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`)
  if (!ok) failed = true
}

let server = null
try {
  // 1. The demo vault (boards 01–13, three pre-existing share records, the fake bucket).
  const seeded = spawnSync(process.execPath, [path.join(REPO, 'tools', 'seedShareDemoVault.mjs'), '--dir', dir, '--port', String(PORT)], { encoding: 'utf8' })
  if (seeded.status !== 0) throw new Error(`seeding failed: ${seeded.stderr}`)

  // 2. Main's own modules, bundled for plain Node (they are TypeScript with `@shared/*` paths).
  const bundle = path.join(dir, 'main.mjs')
  await build({
    stdin: {
      contents: `export { createSharing } from './src/main/share/sharing'\nexport { createSecrets } from './src/main/secrets'\nexport { loadDrawing } from './src/main/fs/drawing'`,
      resolveDir: path.join(REPO, 'desktop'),
      loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'esm', outfile: bundle, tsconfig: path.join(REPO, 'desktop', 'tsconfig.json'), external: ['electron'], logLevel: 'error',
  })
  const { createSharing, createSecrets, loadDrawing } = await import(bundle)

  // 3. The fake Cloudflare (API + the real share Worker) on the seeded data.
  server = spawn(process.execPath, [path.join(REPO, 'tools', 'fakeCloudflare.mjs'), '--data', path.join(dir, 'fake-cloudflare'), '--port', String(PORT)], { stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes(ORIGIN) && resolve())
    server.once('exit', (code) => reject(new Error(`fakeCloudflare exited ${code}`)))
  })

  await mkdir(path.join(dir, 'userData')) // Electron's userData always exists
  const sharing = createSharing({
    secrets: createSecrets(path.join(dir, 'userData', 'secrets.json')),
    configFile: path.join(dir, 'userData', 'sharing.json'),
    apiBase: `${ORIGIN}/client/v4`,
    demoOrigin: ORIGIN,
    modules: { 'worker.js': await readFile(path.join(REPO, 'share', 'worker.js'), 'utf8') },
    readAssets: async () => [{ path: '/assets/viewer.js', bytes: new TextEncoder().encode('// smoke') }],
  })
  const steps = []
  const status = await sharing.setup('demo-good', (p) => p.state === 'done' && steps.push(p.step))
  check(status.state === 'ready' && steps.join() === 'verify,account,bucket,viewer,worker,subdomain,test', `setup demo-good: ${steps.join(' → ')}`)

  // Board 02 as the Share dialog builds it: the vault file is lean, the shared copy embeds its images.
  const board = path.join(vault, '02 Lean images — pictures live in assets, must arrive embedded.excalidraw')
  const doc = await loadDrawing({ root: vault, path: board })
  const scene = { ...JSON.parse(doc.json), files: doc.files }
  const entry = await sharing.publish(vault, board, `${JSON.stringify(scene)}\n`)
  const page = await fetch(entry.url)
  const html = await page.text()
  check(page.status === 200 && html.includes('id="dl-excalidraw"') && html.includes('id="dl-png"'), `GET /b/${entry.id} → ${page.status}, both download buttons`)
  const raw = await fetch(`${ORIGIN}/raw/${entry.id}`)
  const back = await raw.json()
  check(raw.status === 200 && Object.keys(back.files).length === 3, `GET /raw → ${raw.status}, ${Object.keys(back.files).length} images embedded (${(JSON.stringify(back).length / 1e6).toFixed(2)} MB)`)

  await sharing.setPermission(vault, board, false)
  const viewOnly = await fetch(`${ORIGIN}/raw/${entry.id}`)
  check(viewOnly.status === 403 && !(await (await fetch(entry.url)).text()).includes('dl-png'), `view only → /raw ${viewOnly.status}, buttons gone`)

  await sharing.stop(vault, board)
  const stopped = await fetch(entry.url)
  check(stopped.status === 404 && (await stopped.text()).includes('stopped'), `stop → /b ${stopped.status} "stopped"`)

  // Board 10 was shared view-only before this machine was set up; board 11 is stale.
  const rows = await sharing.list(vault)
  check(rows.some((r) => r.id.startsWith('demo10') && r.live === 'live') && rows.some((r) => r.id.startsWith('demo11') && r.stale), 'Settings list: board 10 live, board 11 stale')
} finally {
  server?.kill()
  if (!args.includes('--keep')) await rm(dir, { recursive: true, force: true })
  else console.log(`kept ${dir}`)
}
console.log(failed ? 'SMOKE FAILED' : 'SMOKE OK')
process.exit(failed ? 1 : 0)
