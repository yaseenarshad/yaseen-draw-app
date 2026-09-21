import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { createReadStream, existsSync } from 'node:fs'
import { cp } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))
const shared = resolve(here, '../shared')
const client = resolve(here, '../client')
const rendererOut = resolve(here, 'out/renderer')

/** Where the renderer expects Excalidraw's assets (mirrors `EXCALIDRAW_ASSET_DIR` in renderScene.ts). */
const EXCALIDRAW_ASSET_DIR = 'excalidraw-assets'

/** The package's own `fonts/` tree, wherever npm hoisted the workspace dependency. */
function excalidrawFontsDir(): string {
  for (const base of [resolve(here, '..'), client]) {
    const dir = resolve(base, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
    if (existsSync(dir)) return dir
  }
  throw new Error('@excalidraw/excalidraw fonts not found — run `npm install`')
}

/**
 * Excalidraw's fonts under the renderer's OWN origin (YAZ-878, 🔒 the locked offline rule).
 *
 * A drawing preview with text elements makes Excalidraw fetch its woff2 files; unless
 * `window.EXCALIDRAW_ASSET_PATH` points somewhere that ANSWERS, the library falls back to its
 * esm.sh CDN. So the package's own folder is copied beside the renderer bundle at build time
 * (`app://yaseen/excalidraw-assets/fonts/…`, served by main's `app` protocol handler and picked
 * up by electron-builder's `out/**`) and served from node_modules in dev — the bytes are never
 * committed. Text-free scenes fetch nothing at all.
 */
function excalidrawAssets(): Plugin {
  const fonts = excalidrawFontsDir()
  const prefix = `/${EXCALIDRAW_ASSET_DIR}/fonts/`
  return {
    name: 'yaseen-excalidraw-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith(prefix)) return next()
        const file = resolve(fonts, decodeURIComponent(url.slice(prefix.length)))
        if (!file.startsWith(`${fonts}/`) || !existsSync(file)) return next()
        res.setHeader('Content-Type', 'font/woff2')
        createReadStream(file).pipe(res)
      })
    },
    async writeBundle() {
      await cp(fonts, resolve(rendererOut, EXCALIDRAW_ASSET_DIR, 'fonts'), { recursive: true })
    },
  }
}

export default defineConfig({
  main: {
    // No externalizeDepsPlugin: chokidar 4 is pure JS and gets bundled, so the packaged app
    // needs no node_modules at all (spike decision, see GRO-2151 findings).
    resolve: { alias: { '@shared': shared } },
    // Two entries (YAZ-1617): the app, and the `yaseendocs` command the packaged shim runs as plain Node.
    build: { rollupOptions: { input: { index: resolve(here, 'src/main/index.ts'), cli: resolve(here, 'src/cli/index.ts') } } },
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    build: { rollupOptions: { input: resolve(here, 'src/preload/index.ts') } },
  },
  renderer: {
    root: client,
    plugins: [react(), excalidrawAssets()],
    resolve: {
      alias: { '@shared': shared },
      /**
       * 🔒 ONE React in the renderer (YAZ-879). npm hoists a SECOND, older `react` to the repo
       * root (a transitive peer of the Excalidraw tree), and `@excalidraw/excalidraw` lives up
       * there too — so without this its bundle carried its own React while `client/` used 19.x,
       * and the first `<Excalidraw>` mount died on a null dispatcher ("Cannot read properties of
       * null (reading 'useEffect')"). Invisible until now only because YAZ-878's previews call
       * `exportToSvg` and render no components at all.
       */
      dedupe: ['react', 'react-dom'],
    },
    build: { outDir: rendererOut, rollupOptions: { input: resolve(client, 'index.html') } },
  },
})
