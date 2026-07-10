# Merge Report — feature/markdown-amazon-position-pricing (PR #510)

**Merged:** 2026-07-06, squash commit `46114ed5` (previous main `d764ce45`)
**Track:** FEATURE (audit-driven; design agreed interactively with Chris in-session in lieu of a done-criteria doc)

## What shipped (markdown v2)

The audit of the two markdown processes found the 30-day suggestion sweep untrustworthy:
258 Amazon step-4 proposals at breakeven floor (median 53% of Keepa market; at-market items
cut −83% for being >150d old) and every eBay proposal judged blind at 0 views (Analytics API
never called). Full findings in the session transcript / PR #510 body.

- **Amazon position-first engine** (`lib/pricing/engine.ts`): stable reference = median daily
  buy-box over 180d of `amazon_arbitrage_pricing` snapshots (composite-ordered, paginated),
  cross-checked vs Keepa `was_price_180d` (>25% divergence → manual-review hold); persistence
  gate (box below us ≥75% of last 14 snapshots); we-hold-box/sole-offer items velocity-gated
  via Keepa `salesRankDrops90` (0 drops = hold, healthy = hold, thin = −5%/60d decay bounded
  at 60% of anchor); competitor-held box matched at largest charm ≤ max(stable, today's box);
  −10% escalation only after an applied match ran 20d+ without winning the box; ≥365d → eBay
  auction exit recommendation. Diagnosis now drives the action.
- **eBay sweep**: real Analytics views (`enrichListingsWithViews` with `throwOnError`);
  views/day over the 89d analytics window; no-engagement items hold instead of blind-COLD.
  The 90-day auto-relist mechanism unchanged (audited sound).
- **Floors include postage** (`amazon_postage_cost` £2.80 / `ebay_postage_cost` £1.55).
- **Shared config loader** (`lib/markdown/config.ts`) for both cron routes.
- Migrations `20260706100000` (columns + config knobs) and `20260706110000`
  (diagnosis CHECK widened for `EXIT`) pushed to cloud.

## Verification

- CI: Typecheck, Lint & Test pass; full local suite 3,286 tests green; 39 engine unit tests.
- Adversarial review: 8 findings (1 critical — EXIT vs CHECK constraint; 2 major — swallowed
  Analytics errors, pagination tie-break) — all fixed pre-merge.
- Live-data simulation over the 37 ASINs behind old step-4 proposals: 10 box-held (now
  hold/decay), 19 match a stable market avg £37.79 vs old proposed £10.56.
- Prod smoke post-deploy: /inventory 307 (auth), cron gates 401/405, config 401.

## Post-merge actions completed

- `scripts/_markdown-v2-cleanup.ts --apply`: 580 PENDING proposals rejected
  (396 amazon / 184 ebay), eval clocks reset to 2026-07-06, `amazon_step1_days` = 30.
- Local production server rebuilt + restarted (`scripts/redeploy-local.ps1`).

## Watch items

- `was_price_180d` / `sales_rank_drops_90d` fill via the 30-min Keepa sync (~1 day for all
  267 owned ASINs). Until then box-held items HOLD with "no velocity data yet" — by design.
- First v2 sweep will evaluate ~584 due items in one run; check the Discord summary and the
  digest email for sanity (expect far fewer, far shallower suggestions than before).
- Rollback: revert squash commit `46114ed5`; both migrations are additive.
