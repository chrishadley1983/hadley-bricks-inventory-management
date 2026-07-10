# Merge Report — feature/orders-page-audit-redesign

- **PR:** #544 (squash) → main `a494a749`
- **Merged:** 2026-07-09 ~21:10 BST
- **Deploy:** Vercel production `success` on commit status
- **Track:** FEATURE (built via /goal autonomous flow: audit → fix → redesign → adversarial design review → merge)

## What shipped

### Data-integrity fixes (all verified against live Supabase before coding)
| # | Error | Fix |
|---|-------|-----|
| 1 | 2 Shopify orders counted in All Orders/Paid but invisible (no card, no filter) — cards summed 4,283 vs 4,285, Paid chips 4 vs 6 | Shopify platform card + dropdown entry; totals now reconcile |
| 2 | Shopify orders stuck `Paid` forever (sync stored financial_status only) | Sync writes `Completed` when `fulfillment_status='fulfilled'`; 2 rows backfilled in prod DB |
| 3 | BrickLink "Last sync Jul 4" despite daily syncs (`synced_at` only set on insert) | `synced_at` refreshed on every upsert (both BL sync paths) |
| 4 | Search box silently dead for BL/BO/Amazon/Shopify (`/api/orders` dropped the param) | `search` in QuerySchema → repo ilike on order id + buyer name; 300ms debounce |
| 5 | All-Platforms table hardcoded `totalPages: 1` — only newest 40 rows ever reachable | Real merged pagination (page passthrough, totalPages = max of sources) |
| 6 | Status cards sent Pending/Shipped to the eBay API → silent 400s | eBay fetch skipped for statuses its API doesn't support |
| 7 | eBay "Synced X ago" could be green after a FAILED run (98 failed ORDERS rows in log) | Badge reads newest `sync_type=ORDERS AND status=COMPLETED` row |

Verified NOT a bug: BL had genuinely zero new orders Jul 5–9 (confirmed against the BrickLink API, active + filed).

### Redesign (initial pass + 19 confirmed findings from a 26-agent adversarial design-review workflow)
- Single semantic colour source (`order-status-meta.ts`); amber = act now (Paid), slate = inert Pending
- Actionable status cards tint surface + count; dispatch strip with View paid / View packed buttons
- Platform cards: brand top rail, proportional (flex-grow) status-distribution bar, sync-freshness badge, rose stale warning replaces the lying green tick, bottom-pinned aligned actions
- Loading skeletons replace misleading "Not configured"/0 during query load
- A11y: keyboard-operable cards, focus rings, 24px chip hit targets, contrast fixes
- Density: duplicate page title removed, Shopify spans row at xl, description column widens at xl/2xl

## Verification
- Typecheck + ESLint clean; **full vitest suite 149 files / 3,465 tests green** (worktree)
- CI "Typecheck, Lint & Test" + Vercel preview green on PR
- Live-data browser verification on dev server: card reconciliation held through live order arrivals (4,287 = 1,139+146+1,641+1,359+2; Paid 5 = BO 2 + eBay 2 + AZ 1), search/filters/pagination exercised

## Follow-ups
1. **`scripts/redeploy-local.ps1` not run** — the main checkout was on another session's branch (`feature/price-cache-cutover`) at merge time; building from it would have deployed unmerged code to localhost:3000. Run the script once the main tree is back on main.
2. BL "Stale" badge clears after the first post-deploy full-sync refreshes `synced_at` (next Vercel cron run).
3. Worktree `C:/Users/Chris Hadley/claude-projects/hb-orders-wt` (junctioned node_modules — unlink junctions non-recursively before `git worktree remove`).

## Rollback
`git revert a494a749` — page + 3 new components + repo/route/sync tweaks; no schema changes. The 2-row Shopify status backfill is independent and correct regardless.
