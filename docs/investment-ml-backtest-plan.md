# Investment ML v2 — Backtest Plan

**Goal:** decide, with evidence, whether the v2 investment model is good enough to put real money behind — and define exactly how it may be used if it passes.

**Status:** plan (written 2026-07-02, alongside PR #500). Execute after the Keepa re-import completes and the first v2 retrain has run.

---

## Prerequisites

1. `_keepa-reimport-v2.ts` finished (progress file shows ~all candidates done, failures retried once).
2. Recalc + retrain + rescore run against the clean data (via `/api/cron/investment-retrain` on the local server — Vercel kills it at 300s).
3. `validate-investment-ml-v2` workflow passes (data cleanliness + artifact honesty).

## Phase A — Walk-forward temporal backtest

The training service already does one temporal 80/20 split. A single split is one sample; a walk-forward gives a distribution.

- Script: `apps/web/scripts/_backtest-investment-v2.ts` (to be written), reusing `feature-engineering.ts` + `ridge.ts` verbatim — no reimplementation, so the backtest tests the production code path.
- Folds: train on everything retired before cutoff, test on the following 12 months of retirements:
  - cutoff 2022-06-30 → test 2022-07..2023-06
  - cutoff 2023-06-30 → test 2023-07..2024-06
  - cutoff 2024-06-30 → test 2024-07..2025-06
- Metrics per fold, 1yr horizon (3yr where labels exist):
  - **Spearman rank correlation** (primary — buying needs ranking, not point accuracy)
  - MAE (pp), R²
  - **Top-decile precision**: of the top 10% by predicted appreciation, what share actually appreciated ≥ +30%?
  - Baselines: theme-average predictor and global-mean predictor — the model must beat both on Spearman and MAE in ≥ 2 of 3 folds.
- Robustness slices: exclude `retired_date_estimated=true` rows from the test set (real exit dates only) and re-report; if metrics collapse, date noise is carrying the result.

## Phase B — Decision-rule simulation (paper P&L)

Convert predictions into the actual buying rule and simulate it on each test fold:

- **Rule (initial):** buy when `predicted_1yr ≥ +40%` AND `confidence ≥ 0.5` AND `amazon_viable` AND RRP ≤ £150 (capital guardrail).
- **Cost model:** buy at 0.8 × RRP (typical pre-retirement discount achievable); sell at the *actual* 1yr-post median price; Amazon fees 17% (per `platform-fee-structure`); £3 outbound shipping.
- Report per fold: number of qualifying buys, hit rate (net-profitable share), median and mean ROI, worst single outcome, capital deployed vs. return.
- Compare against the naive alternative: buying the same £ spread across all retiring `lego_exclusive` sets (the no-model heuristic).

## Phase C — Go / no-go thresholds

Use the model for real buying decisions only if ALL of:

| Check | Threshold |
|---|---|
| Spearman (1yr), latest 2 folds | ≥ 0.40 each |
| Beats theme-average baseline MAE | ≥ 2 of 3 folds |
| Top-decile precision, pooled | ≥ 60% |
| Phase B hit rate, pooled | ≥ 65% and median ROI ≥ +15% net |

Below threshold → the model stays a **screening signal** (surfacing candidates for manual review) and never a purchase trigger. Re-evaluate after each monthly retrain.

## Phase D — Live forward tracking (prediction ledger)

Backtests can flatter; forward performance is the real test.

- `investment_predictions` already stores `scored_at` + `model_version` — snapshot each month's top-25 predictions into a `prediction ledger` (script or table) at retrain time.
- The daily `keepa-refresh` feed keeps accruing post-retirement prices, so each ledger entry becomes gradeable ~12 months after its set retires.
- Quarterly: grade all gradeable entries (predicted vs. realized 1yr appreciation, rank correlation of the ledger cohort) and append to the ledger doc.
- Kill-switch: if two consecutive quarterly gradings show Spearman < 0.2 on gradeable cohorts, suspend model-driven buying until retrained + re-backtested.

## Capital guardrails for the pilot (if Phase C passes)

- Max £300 per set (matches the existing `high_rrp_capital_required` risk flag).
- Model-driven buys capped at 10% of the monthly stock budget for the first 3 months, doubling only after the first positive quarterly grading.
- Every model-driven buy recorded with its prediction + confidence at time of purchase (the ledger), so outcomes are attributable.
