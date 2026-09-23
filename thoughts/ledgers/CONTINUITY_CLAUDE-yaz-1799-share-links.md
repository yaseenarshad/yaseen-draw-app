# Continuity Ledger: YAZ-1799 share links

## Goal
- Always-live Cloudflare share links (approved demo, hardened) on main. All 16 approved scenarios pass: 1–15 against the fake Cloudflare, 16 live on Yasin's own account. Polish pass done. Merged. No release tag.

## Constraints
- Decision record = comments on YAZ-1799 from "✅ APPROVED" onwards; children YAZ-1880…1896.
- No Playwright, ever. Hand-tests go to Yasin in an isolated dev profile.
- Main owns Cloudflare + secrets + uploads; the renderer never sees a token or password; IPC is shape-checked through the envelope.
- Architecture decisions go to Yasin (problem/options/recommendation/diff/after). Never decide them on the fly.

## Key Decisions
- D1 the user's own Cloudflare (R2 + Worker) set up in-app · D2 no encryption · D3 always live (~10 s quiet, one in flight, latest wins) · D5/D9 one link `/b/<id>` + server-side allowDownload · D6 Google Docs dialog · D7 Settings › Sharing page · D10 rename follows, delete stops · D11 reuse on re-setup · D12 account picker if >1 · D13 bundled viewer · D14 sidebar icon · D15 `perm/<id>` flag object · D16 five token permissions · D17 auto-claim a workers.dev subdomain · D18 account-owned `cfat_` keys.
- All written up in `docs/CONTRACTS.md` › "Share links (YAZ-1799)".

## State
- Done:
  - [x] Scoping, demo approved, Linear tree created
  - [x] Branch rebased on main 31c01d4 (YAZ-1801 conflicts kept both sides)
  - [x] 1 Deep scope: the real Cloudflare API (YAZ-1880)
  - [x] 2A Worker (dc9b32d) · [x] 2B viewer + packaging
  - [x] 3A Cloudflare setup (12e48c7) · [x] 3B records + live upload
  - [x] 4A dialog (65b2015) · [x] 4B Settings page (6ec81f6) · [x] 4C sidebar icon (ee2a589)
  - [x] 5A fake-CF verification (6ead7eb, YAZ-1892)
  - [x] 6A audit (YAZ-1895)
  - [x] 6B apply the audit (YAZ-1896): security (secrets:set allowlist, dev-only demo switches, viewer CSP), sharing.ts split into config/setup/boards, badges skip the live check, client simplifications, share.css on the confirm styles, tools tidy, CONTRACTS + README
- Now: [→] 5B live verification on Yasin's own Cloudflare account (scenario 16)
- Remaining:
  - [ ] Merge: squash-merge the PR with a clean, attribution-free message (the WIP / Co-Authored-By commits never reach main)

## Open Questions
- None blocking. The branch's early commits (8f50d35 Co-Authored-By line, bf9548f "WIP … prototype") are left as they are on purpose: the squash-merge drops them.

## Working Set
- Worktree `/Users/yasin/Documents/GitHub/yaseen-draw-app-yaz-1799`, branch `yaz-1799-share-links`
- `npm run typecheck`, `npm test`, `npm run build` (full path /opt/homebrew/bin/npm)
- Demo: `node tools/seedShareDemoVault.mjs --dir <dir>` then `<dir>/start-demo.sh`
