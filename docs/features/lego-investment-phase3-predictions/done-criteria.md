# Done Criteria: lego-investment-phase3-predictions

**Created:** 2026-02-07
**Author:** Define Done Agent + Chris
**Status:** APPROVED
**PRD Reference:** `C:\Users\Chris Hadley\Documents\LEGO_INVESTMENT_PREDICTOR_PRD.md`
**Phase 1 Reference:** `docs/features/lego-investment-model/done-criteria.md`
**Phase 2 Reference:** `docs/features/lego-investment-phase2/done-criteria.md`

## Feature Summary

Combined Phase 3 (Historical Data & Training) and Phase 4 (Predictions & Scoring) of the LEGO Investment Predictor. Seeds historical Amazon UK price data via a Keepa API importer, calculates actual appreciation for retired sets, trains a TensorFlow.js ML model to predict 1-year and 3-year post-retirement Amazon buy box appreciation, and surfaces predictions through an investment score (1-10) on the dashboard, set detail pages, and a dedicated Top Picks page.

**Key architectural decisions:**
- Keepa API importer for historical price seeding (user subscribes separately; build with test data support)
- TensorFlow.js for ML training and inference (runs in Node.js, no Python dependency)
- Dedicated `investment_predictions` table for scores and predictions
- Historical training data table (`investment_historical`) for retired set appreciation
- Dual-output model: 1-year and 3-year predicted appreciation
- Composite investment score (1-10) combining ML prediction + theme performance + exclusivity + demand
- Top Picks page at `/investment/top-picks` for highest-scored sets
- Monthly model retraining cron as new retirements complete

## Success Criteria

### Functional

#### F1: Keepa API importer populates historical price data
- **Tag:** AUTO_VERIFY
- **Criterion:** A Keepa API client exists that fetches historical Amazon UK price and sales rank data for a given list of ASINs. The importer stores daily price snapshots in the `price_snapshots` table (source = `keepa_amazon_buybox`). It processes ASINs in batches respecting rate limits (20 tokens/minute). The importer can be triggered via an API endpoint (`/api/admin/keepa-import`) with a list of ASINs or a "retired sets" flag. When run with mock/test data, it correctly processes and stores results.
- **Evidence:** Keepa client file exists at `apps/web/src/lib/keepa/`. API route exists. Calling the endpoint with a test ASIN returns 200 with import stats. `price_snapshots` table has rows with `source = 'keepa_amazon_buybox'` after import.
- **Test:** Call import endpoint with test data (mocked Keepa response), verify `price_snapshots` rows created with correct fields (set_num, date, source, price_gbp, sales_rank).

#### F2: Historical appreciation calculated for retired sets
- **Tag:** AUTO_VERIFY
- **Criterion:** An `investment_historical` table stores actual appreciation data for retired sets. A calculation service computes: `actual_1yr_appreciation` and `actual_3yr_appreciation` as percentage change from RRP to Amazon buy box price at 1yr and 3yr post-retirement. The service uses `price_snapshots` (Keepa) and/or `amazon_arbitrage_pricing` data to find prices at the relevant dates. Sets without sufficient price data are flagged with `data_quality = 'insufficient'`.
- **Evidence:** `investment_historical` table exists with columns: `set_num`, `retired_date`, `rrp_gbp`, `price_at_retirement`, `price_1yr_post`, `price_3yr_post`, `actual_1yr_appreciation`, `actual_3yr_appreciation`, `had_amazon_listing`, `avg_sales_rank_post`, `data_quality`. After running calculation on retired sets with price data, rows are populated with non-null appreciation values.
- **Test:** Run calculation for a known retired set with Keepa/pricing data. Verify appreciation = (post_price - rrp) / rrp * 100. Verify sets without data get `data_quality = 'insufficient'`.

#### F3: TensorFlow.js model trained on historical data
- **Tag:** AUTO_VERIFY
- **Criterion:** A TensorFlow.js model is trained using features from `brickset_sets` and `investment_historical`. Features include: theme (encoded), piece_count, minifig_count, rrp_gbp, price_per_piece, exclusivity_tier (encoded), is_licensed, is_ucs, is_modular, set_age_years, has_amazon_listing, avg_sales_rank, theme_historical_avg_appreciation. The model predicts `predicted_1yr_appreciation` and `predicted_3yr_appreciation`. A training script/endpoint exists at `/api/admin/train-model`. The trained model is saved as a JSON artifact in Supabase Storage or a known path. Training reports accuracy metrics (MAE, R-squared) on a 20% holdout set.
- **Evidence:** Training script exists. Model artifact is saved after training. Training response includes `{ metrics: { mae_1yr, mae_3yr, r_squared_1yr, r_squared_3yr }, training_samples, holdout_samples, model_version }`. Model can be loaded for inference.
- **Test:** Run training with available data (or seed data). Verify model artifact created. Verify metrics are present and finite numbers. Verify model loads successfully for inference.

#### F4: Investment score algorithm (1-10) computed per set
- **Tag:** AUTO_VERIFY
- **Criterion:** An `investment_predictions` table stores per-set predictions. A scoring service computes a composite `investment_score` (1-10, one decimal place) combining: ML predicted appreciation (40% weight), theme historical performance (20%), exclusivity tier bonus (15%), demand indicators from sales_rank/offer_count (15%), retirement timing proximity (10%). Each factor is normalised to 0-1 before weighting. The score also stores: `predicted_1yr_appreciation`, `predicted_3yr_appreciation`, `predicted_1yr_price_gbp`, `predicted_3yr_price_gbp`, `confidence` (0-1), `risk_factors` (JSON array of strings), `amazon_viable` (boolean), and `model_version`. A scoring cron/endpoint runs predictions for all sets with `retirement_status IN ('available', 'retiring_soon')`.
- **Evidence:** `investment_predictions` table exists. After scoring, rows populated for tracked sets. Score values are between 1.0 and 10.0. Confidence between 0 and 1. Risk factors array is non-empty for at-risk sets.
- **Test:** Run scoring for all tracked sets. Verify `investment_predictions` has rows. Verify a known high-value set (e.g., UCS Star Wars) scores > 7. Verify a generic play set scores lower. Verify all scores in 1-10 range.

#### F5: Predictions displayed on set detail page
- **Tag:** AUTO_VERIFY
- **Criterion:** The `/investment/[setNumber]` detail page displays an "Investment Prediction" section showing: investment score (with colour-coded badge: green >= 7, amber 4-6.9, red < 4), predicted 1yr and 3yr appreciation (%), predicted future prices (GBP), confidence level, risk factors list, model version, and last predicted date. Sets without predictions show "Prediction not available" with explanation.
- **Evidence:** Navigating to a set with predictions shows the prediction section with all fields. Navigating to a set without predictions shows fallback text. Score badge colour matches the score value.
- **Test:** Navigate to `/investment/[setNumber]` for a scored set. Verify prediction section renders with score, appreciation, prices, confidence, risk factors. Verify colour coding. Navigate to an unscored set, verify fallback message.

#### F6: Top Investment Picks page at /investment/top-picks
- **Tag:** AUTO_VERIFY
- **Criterion:** A new page at `/investment/top-picks` displays the top 20 highest-scored sets in a card-based or table layout. Each entry shows: set image, number, name, investment score (badge), predicted 1yr appreciation, current buy box vs RRP comparison, retirement status/date, and a link to the detail page. The page has a filter for "retiring within" (3/6/12 months / all). The page is linked from the investment dashboard and sidebar navigation.
- **Evidence:** Navigating to `/investment/top-picks` renders a list of up to 20 sets sorted by score descending. Filter controls work. Each entry links to detail page. Sidebar has "Top Picks" nav item.
- **Test:** Page renders without console errors. Sets are ordered by score descending. Clicking a set navigates to detail page. "Retiring within" filter narrows results.

#### F7: Investment score column on dashboard table
- **Tag:** AUTO_VERIFY
- **Criterion:** The `/investment` DataTable adds an `investment_score` column displaying the 1-10 score with a colour-coded badge (green >= 7, amber 4-6.9, red < 4). The column is sortable. Sets without a score show "—". The investment list API is updated to join from `investment_predictions`.
- **Evidence:** Investment table shows score column. Sorting by score works. Badge colours are correct.
- **Test:** Load `/investment`, verify score column present. Sort by score, verify ordering. Verify colour coding matches score values.

#### F8: Model retraining cron endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** A cron endpoint at `/api/cron/investment-retrain` triggers: 1) recalculation of historical appreciation data, 2) model retraining with latest data, 3) re-scoring of all active sets. The endpoint is protected by CRON_SECRET. It logs training metrics and saves the new model version. Designed to run monthly.
- **Evidence:** Endpoint exists and returns 200 with `{ historical_updated, model_metrics, sets_scored, model_version, duration_ms }`. Model version increments on each retrain.
- **Test:** Call retrain endpoint. Verify response contains all expected fields. Verify model_version is updated. Verify predictions updated.

### Error Handling

#### E1: Model inference graceful fallback when no model exists
- **Tag:** AUTO_VERIFY
- **Criterion:** If no trained model artifact exists (first deploy, model deleted, etc.), the scoring service falls back to a rule-based score using only: theme performance, exclusivity, retirement timing, and demand signals (no ML component). The fallback score is flagged with `confidence = 0` and `risk_factors` includes `"no_ml_model_available"`. The API and UI still function normally.
- **Evidence:** When model artifact is absent, scoring still produces results. All scores have `confidence = 0` and the risk factor flag. Dashboard and detail pages render correctly.
- **Test:** Delete/rename model artifact. Run scoring. Verify predictions created with fallback scores. Verify UI renders without errors.

#### E2: Insufficient training data handled gracefully
- **Tag:** AUTO_VERIFY
- **Criterion:** If fewer than 50 sets have valid historical appreciation data, the training endpoint returns a warning instead of training a poor model. Response includes `{ status: 'insufficient_data', available_samples: N, minimum_required: 50 }`. Existing model (if any) is preserved. Scoring falls back to rule-based.
- **Evidence:** With < 50 training samples, training returns warning. No model artifact created/overwritten. Existing predictions still work.
- **Test:** Ensure < 50 historical rows exist. Call train endpoint. Verify warning response. Verify existing model not overwritten.

### Integration

#### I1: Predictions API endpoint for external consumers
- **Tag:** AUTO_VERIFY
- **Criterion:** A GET endpoint at `/api/investment/predictions` returns paginated predictions sorted by score descending. Supports filters: `minScore`, `retiringWithinMonths`, `theme`. A GET endpoint at `/api/investment/predictions/[setNumber]` returns the prediction for a single set. Both endpoints return the full prediction object including score, appreciation, confidence, risk factors.
- **Evidence:** GET `/api/investment/predictions?minScore=7` returns sets with score >= 7. GET `/api/investment/predictions/75192-1` returns that set's prediction. Response shape matches `investment_predictions` schema.
- **Test:** Call predictions API with filters, verify results match. Call single-set endpoint, verify full prediction returned.

### Performance

#### P1: Scoring all active sets completes within 5 minutes
- **Tag:** AUTO_VERIFY
- **Criterion:** Running the full scoring pipeline (feature extraction + model inference + database writes) for all sets with `retirement_status IN ('available', 'retiring_soon')` completes within 300 seconds (Vercel max duration). Uses batch processing. The scoring response includes `duration_ms`.
- **Evidence:** Scoring endpoint response has `duration_ms < 300000`. All eligible sets are scored (count matches).
- **Test:** Run full scoring. Verify `duration_ms < 300000`. Verify scored set count matches eligible set count.

## Out of Scope

- GWP tracker
- Portfolio manager / ROI tracking against inventory
- Theme analytics dashboard (separate phase)
- Discord bot commands (`/lego-invest top`, etc.) - alerts only for now
- Automatic Keepa subscription management
- Model explainability / SHAP values
- A/B testing of model versions
- Prediction accuracy tracking dashboard (future phase)
- BrickLink price integration (Keepa + Amazon only)
- Real-time re-scoring (daily cron is sufficient)

## Dependencies

- Phase 1 complete (brickset_sets, Rebrickable sync, retirement tracking)
- Phase 2 complete (ASIN linkage, classification, Amazon pricing on dashboard/detail)
- Keepa API subscription (user subscribes separately; importer works with mock data)
- `price_snapshots` table exists (created in Phase 1 migration)
- `amazon_arbitrage_pricing` table with daily snapshots
- TensorFlow.js npm package (to be installed)

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
