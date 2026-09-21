import { defineConfig } from 'vitest/config'

/**
 * The `tools/` project. `tools/migrateFolderPages.mjs` is plain ESM run straight by node (it reads
 * `shared/` through Node's own type stripping), so its suite is `.mjs` too and spawns the real CLI
 * against real temp vaults — no alias, no jsdom, nothing mocked.
 */
export default defineConfig({
  test: {
    name: 'tools',
    environment: 'node',
    include: ['*.test.mjs'],
    // Each case builds a vault, `git init`s it and runs the migration end to end.
    testTimeout: 60_000,
  },
})
