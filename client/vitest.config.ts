import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'client',
    environment: 'jsdom',
    css: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000,
    // The engine's dist imports `roughjs/bin/rough` without an extension, which Node's ESM loader
    // refuses; inlining lets Vite resolve it, so a test can run the REAL engine (YAZ-1892
    // `shareContent.integration.test.ts`). Suites that mock `drawings/engine` never load it.
    server: { deps: { inline: [/@excalidraw\//] } },
  },
})
