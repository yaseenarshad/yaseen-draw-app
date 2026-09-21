/**
 * The handshake (YAZ-1617 🔒 D2): what right-click › Copy for Agent puts on the clipboard. Three
 * lines — what this file is, that the app has a command for its pages, and how to ask it what it
 * can do. It names NO verb, on purpose: the command's `--help` owns capabilities, so a verb added
 * later changes nothing here. `command` is the full invocation (quoted path, or `node "…cli.js"`
 * in dev — 🔒 D3: no PATH install, the path travels with the text).
 */
export function agentPrompt(command: string, page: string): string {
  return `This file is a page in Yaseen Docs: ${page}
The app has a command line for working with its pages. Run it first to see what it can do:
${command} --help`
}
