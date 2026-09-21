/**
 * Desktop G1 (GRO-2178): Playwright config for the Electron smoke suite (`npm run e2e` at the
 * repo root — it rebuilds `desktop/out` first, then runs this). One worker, serial: the specs
 * relaunch the same app state across tests, so parallelism would be a lie.
 */
import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: __dirname,
  outputDir: path.join(__dirname, 'artifacts', 'runner'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
})
