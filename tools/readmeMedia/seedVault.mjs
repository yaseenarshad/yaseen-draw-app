#!/usr/bin/env node
/**
 * USAGE: node tools/readmeMedia/seedVault.mjs --vault <dir> [--profile <dir>] [--force]
 *
 * The vault the README's pictures are taken in (lib/demoVault.mjs): everyday boards in
 * `Home/`, `Ideas/`, `Trips/` and `Work/` — ten Excalidraw drawings, two draw.io
 * diagrams — with a local git history (no origin, sync off) that gives the Product roadmap three versions.
 * `tools/readmeMedia/capture.mjs` builds its own copy; this script is for looking at the vault by hand.
 *
 * `--vault` IS REQUIRED AND THE PATH IS WIPED (the `seedDemoVault.mjs` rule): an existing path is
 * refused unless `--force`. `--profile` also writes an isolated Electron profile whose one window is
 * already on the vault (docs/LAUNCH.md "Behaviour checks"), so no dialog is needed and the real profile is
 * never read: launch with `YASEEN_DRAW_USER_DATA_DIR=<profile>`.
 */
import { cli, refuseExisting, wipe, writeProfile } from '../lib/seedKit.mjs'
import { buildVault } from './lib/demoVault.mjs'

const USAGE = 'usage: node tools/readmeMedia/seedVault.mjs --vault <dir> [--profile <dir>] [--force]'
const args = cli(USAGE, { '--vault': 'dir', '--profile': 'dir' }, ['--vault'])
const targets = [args.vault, args.profile].filter(Boolean)
for (const dir of targets) refuseExisting(dir, USAGE, { force: args.force })
wipe(...targets)

const boards = buildVault(args.vault)
if (args.profile) writeProfile(args.profile, args.vault, { theme: 'light', sidebarWidth: 260, file: boards.week, tabs: [boards.week] })

console.log(`vault:  ${args.vault}`)
if (args.profile) console.log(`launch: cd desktop && YASEEN_DRAW_USER_DATA_DIR="${args.profile}" npx electron-vite dev`)
