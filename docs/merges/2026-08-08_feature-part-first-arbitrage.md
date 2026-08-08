# Merge Report — feature/part-first-arbitrage (PR #669)

**Merged:** 2026-08-08, squash commit `0d03eb5c` | **Track:** FEATURE | **Previous deploy:** `f766f26b` (PR #665)

## What shipped

Part-first arbitrage: the inverse lens to bl-basket. Screen the UK price-guide
cache for undervalued high-STR part/minifig tuples (anchors, using the
current-stock price histogram for depth-below-margin), find which scraped stores
hold those units (new flattened `bl_store_lots` index), score each nominated
store's whole cached inventory through the common `bl-store-report` module, and
persist findings to `part_arb_candidates`. Two-stage grounding: nothing is bought
from a cached scrape — the ground stage live re-scrapes, then either writes a
wanted-list XML (`--xml-only`) or hands off to bl-basket (`--cart`).

Spec: `docs/features/part-first-arbitrage/done-criteria.md`.

## Verification chain

| Step | Result |
|------|--------|
| Unit tests | 21 new (engine seams); full suite 3,749 pass / 166 files |
| tsc / eslint | clean |
| Migrations | 20260808120000 + 20260808124500 applied via db:push |
| Backfill | 2,473,421 `bl_store_lots` rows = exact Σ `bl_store_scrapes.lot_count` |
| Live smoke | discover run: 4,793 anchors → 477 stores → top-10 persisted; anchor maths spot-checked to the penny vs source tables |
| Code review | 2 independent agents (correctness, security/conventions): 0 Critical/Major; all follow-ups applied same day |
| CI | Typecheck/Lint/Test + Vercel preview green |
| Prod deploy | Vercel success; /login 200, / auth-redirect 307 |
| Local server | `redeploy-local.ps1` OK — rebuilt, restarted, :3000 200 |
| E2E validation | multi-agent workflow `validate-part-first-arbitrage`: **PASS**, 0 confirmed issues (6 agents, 5 dimensions). Data integrity exact across 624 stores; 5 sampled anchors re-derived to full float precision; persisted headline figures reproduced to the penny by a read-only re-run; 1,443-entry XML from a real 19,622-lot scrape met every BL-uploader invariant; migrations in remote history, advisors clean. WARN resolved: hb-assess-wt worktree fast-forwarded to `0d03eb5c` so tonight's sweep flattens with the new code. |

## Operational notes

- Discover run: `cd apps/web; npx tsx scripts/part-arb.ts` (flags in the script
  header). Ground: `--ground --store-slug=X --xml-only|--cart` (CDP :9222).
- The nightly 02:15 store-assessment sweep now refreshes `bl_store_lots`
  per store after each scrape (non-fatal); discover self-heals stragglers via
  `bl_store_lots_freshness`.
- First live candidates (2026-08-08): IVG_Bricks £951.56 LIQUID net (374 anchors),
  Bman101 £753.76, JangoFett £601.24.

## Rollback

`git revert 0d03eb5c && git push` (schema is additive — new tables/view/function
only; reverting code leaves them dormant).
