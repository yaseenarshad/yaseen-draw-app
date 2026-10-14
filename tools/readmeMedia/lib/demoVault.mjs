/**
 * The README demo vault, written to disk: `Home/`, `Ideas/`, `Trips/` and `Work/`, holding the
 * everyday boards of lib/boards.mjs — ten Excalidraw drawings and two draw.io diagrams — and a
 * local git history in which the Product roadmap has three versions, so Version history has
 * added, changed and removed shapes to mark.
 * There is no origin and sync stays off: nothing here can reach a network.
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { GIT_ENV, git, identity, json, scene, write } from '../../lib/seedKit.mjs'
import { birthdayParty, gardenLayout, launchFunnel, lisbonTrip, packingList, picnic, roadmap, roadmapOrder, signUpFlow, soupRecipe, teamChart, weekPlan, weekendProjects } from './boards.mjs'

const DAY = 24 * 60 * 60 * 1000
const SOURCE = 'yaseen-draw-readme'

/** Vault-relative paths of the boards the captures open by name. */
export const BOARDS = {
  week: 'Home/Week plan.excalidraw',
  soup: 'Home/Tomato soup recipe.excalidraw',
  garden: 'Home/Garden layout.excalidraw',
  party: 'Ideas/Birthday party.excalidraw',
  picnic: 'Ideas/Picnic.excalidraw',
  projects: 'Ideas/Weekend projects.excalidraw',
  trip: 'Trips/Trip to Lisbon.excalidraw',
  packing: 'Trips/Packing list.excalidraw',
  funnel: 'Work/Launch funnel.excalidraw',
  roadmap: 'Work/Product roadmap.excalidraw',
  signup: 'Work/Sign-up flow.drawio',
  team: 'Work/Team.drawio',
}

/** A commit as `name`, `daysAgo` days back — Version history lists the author and the age. */
function commit(vault, name, daysAgo, message, now) {
  identity(vault, name)
  const when = new Date(now - daysAgo * DAY).toISOString()
  git(vault, ['add', '-A'])
  execFileSync(process.env.GIT || 'git', ['commit', '-q', '-m', message], { cwd: vault, env: { ...GIT_ENV, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when }, stdio: ['ignore', 'pipe', 'pipe'] })
}

/** A board's file, as the app saves one: the scene, stamped created and updated `days` ago. */
export const boardText = (sketch, days = [2, 2], { now = Date.now(), order } = {}) =>
  json(scene(SOURCE, sketch.elements(order), { block: { createdAt: now - days[0] * DAY, updatedAt: now - days[1] * DAY } }))

/**
 * Writes the vault at `vault` (which must not exist yet) and returns the absolute path of each board.
 * `sync` also switches the vault's GitHub sync on and gives it a "GitHub" to sync with: a bare
 * repository beside it, `<vault> (origin).git`, the way `tools/seedMergeDemoVault.mjs` does — the
 * app pushes there with the real `git`, and nothing leaves the Mac.
 * @param {string} vault
 * @param {{ now?: number, sync?: boolean }} [options]
 */
export function buildVault(vault, { now = Date.now(), sync = false } = {}) {
  if (fs.existsSync(vault)) throw new Error(`${vault} already exists`)
  const board = (rel, sketch, days, order) => write(vault, rel, boardText(sketch, days, { now, order }))
  const stamp = (xml, days) => xml.replace('<mxfile', `<mxfile yaseendraw-created="${now - days[0] * DAY}" yaseendraw-updated="${now - days[1] * DAY}"`)

  board(BOARDS.week, weekPlan(), [5, 1])
  board(BOARDS.soup, soupRecipe(), [40, 12])
  board(BOARDS.garden, gardenLayout(), [18, 3])
  board(BOARDS.party, birthdayParty(), [9, 4])
  board(BOARDS.picnic, picnic(), [2, 2])
  board(BOARDS.projects, weekendProjects(), [25, 2])
  board(BOARDS.trip, lisbonTrip(), [14, 6])
  board(BOARDS.packing, packingList(), [6, 6])
  board(BOARDS.funnel, launchFunnel(), [12, 2])
  write(vault, BOARDS.signup, stamp(signUpFlow(), [20, 5]))
  write(vault, BOARDS.team, stamp(teamChart(), [40, 15]))

  // The Roadmap's three versions, one commit each; the last is the file on disk.
  const order = roadmapOrder()
  if (sync) write(vault, '.yaseendraw/github.json', { enabled: true })
  git(vault, ['init', '-q', '-b', 'main'])
  board(BOARDS.roadmap, roadmap(1), [21, 21], order)
  commit(vault, 'Maya', 21, 'First roadmap', now)
  board(BOARDS.roadmap, roadmap(2), [21, 6], order)
  commit(vault, 'Sam', 6, 'Roadmap: add the billing page', now)
  board(BOARDS.roadmap, roadmap(3), [21, 1], order)
  commit(vault, 'Maya', 1, 'Roadmap: dark mode is next, offline mode dropped', now)

  if (sync) {
    const origin = `${vault} (origin).git`
    git(undefined, ['init', '-q', '--bare', '-b', 'main', origin])
    git(vault, ['remote', 'add', 'origin', origin])
    git(vault, ['push', '-q', '-u', 'origin', 'main'])
    identity(vault, 'You')
  }

  return Object.fromEntries(Object.entries(BOARDS).map(([key, rel]) => [key, path.join(vault, rel)]))
}
