# Merge Report — feature/vinted-pov-modes

**Merged:** 2026-07-02 · PR [#477](https://github.com/chrishadley1983/hadley-bricks-inventory-management/pull/477) (squash) · commit `198e0770`
**Track:** FEATURE · **Files:** 9 (+716 / −124)

## Feature Summary

BrickLink Part-Out-Value (POV) buy signals layered on the existing Amazon-resale-margin logic:

- `get_pov_public(set_number)` — SECURITY DEFINER RPC giving the Vinted Sniper extension's anon key
  a safe POV read (no `my_inv_*`, no aggregate-listing rows). Migration `20260622144833` was applied
  to prod via MCP on 2026-06-22 (remote-recorded version matches the file) and re-verified present today.
- eBay auction cron: hybrid New-POV signal (**active immediately** — `pov_buy_enabled` defaults true,
  multiples 3×/4×) and an opt-in USED-auction scan behind `used_pov_mode_enabled` (false at deploy).
- POV audit columns on `ebay_auction_alerts`; condition-matched POV block on Discord embeds; the
  Amazon leg of alerts is now nullable (used-POV opportunities have no Amazon data).
- Extension client changes are tracked separately in `extensions/vinted-sniper` (PR #478).

## Prerequisites & Verification

| Check | Status |
|-------|--------|
| Spec / done criteria | ✅ `docs/features/vinted-pov-modes/goal.md` (R1/R2/R3) |
| Adversarial validation | ✅ 2026-06-22 workflow — SHIP-WITH-FIXES, all reqs PASS, 5 LOW fixed |
| Code review (fresh) | ✅ `docs/reviews/2026-07-02-feature-vinted-pov-modes.md` — READY, 0 critical/major |
| TypeScript / ESLint | ✅ / ✅ (one pre-existing unrelated warning) |
| Full local test suite | ✅ 3,154 tests / 127 files pass |
| GitHub CI (typecheck/lint/test + Vercel preview) | ✅ all green |
| Merge conflicts | None — main hadn't touched any branch file since merge-base |
| Vercel production deploy | ✅ deployment 5281657593 success 08:50:32Z |
| Prod smoke | ✅ `/`→307 dashboard, `/login` 200, cron + config routes 401-gated |
| Local NSSM server rebuild | scripts/redeploy-local.ps1 (apps/web changed) |

## Cleanup

Local + remote `feature/vinted-pov-modes` deleted (gh --delete-branch). No worktree.

## Follow-ups

1. **F3** — load extension from `extensions/vinted-sniper` (new ID → re-enter options)
2. **F4** — verify next cron run writes `buy_signal` on `ebay_auction_alerts`; extension decisions carry `mode`
3. **F5** — flip `used_pov_mode_enabled=true` once F4 passes
4. Review minors CR-001..004 (audit-labelling `sales_rank_too_high`, POV pagination tiebreaker, used-scan itemId collision, no unit tests) — none blocking

## Other Unmerged Branches

- `chore/vinted-sniper-extension` (PR #478 — in flight, this workstream)
- `origin/feature/gmail-api-vinted-collections`, `origin/feature/vinted-collections-royal-mail`, `origin/fix/vinted-collections-lint` (pre-existing)
