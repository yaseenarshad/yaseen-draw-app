import { defineConfig } from 'vitest/config'

/**
 * The `tools/` project. `tools/packEngine.mjs` is plain ESM run straight by node, so its suite is
 * `.mjs` too and drives the real script against real temp dirs — no alias, no jsdom, nothing mocked.
 */
export default defineConfig({
  test: {
    name: 'tools',
    environment: 'node',
    include: ['*.test.mjs'],
    testTimeout: 60_000,
  },
})
