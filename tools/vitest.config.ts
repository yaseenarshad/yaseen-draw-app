import { defineConfig } from 'vitest/config'

/**
 * The `tools/` project. Both scripts are plain ESM run straight by node, so their suites are
 * `.mjs` too and drive the real code against real temp dirs — no alias, no jsdom, nothing mocked.
 */
export default defineConfig({
  test: {
    name: 'tools',
    environment: 'node',
    include: ['*.test.mjs'],
    testTimeout: 60_000,
  },
})
