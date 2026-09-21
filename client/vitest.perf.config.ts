import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

/**
 * The timing budgets (YAZ-740). Same environment and alias as `client`, but `groupOrder: 1`
 * runs this project only after `client` and `desktop` (both group 0) have finished, and
 * `fileParallelism: false` runs its files one at a time — so every budget is measured on an
 * idle pool and can stay tight enough to catch a real algorithmic regression. A busy machine
 * used to fail a 7 ms test against a 50 ms budget purely through scheduling.
 *
 * Written out in full rather than `mergeConfig`-ed from the client config: mergeConfig
 * CONCATENATES `include` arrays, which silently re-ran the whole client suite in here.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    name: 'perf',
    environment: 'jsdom',
    css: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.perf.test.{ts,tsx}'],
    testTimeout: 30_000,
    sequence: { groupOrder: 1 },
    fileParallelism: false,
  },
})
