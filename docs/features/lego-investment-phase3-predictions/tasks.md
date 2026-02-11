# Tasks: lego-investment-phase3-predictions

## Implementation Tasks (verification implicit)

- [ ] F1: Keepa API importer populates historical price data
  - blocked_by: none
  - verify_type: AUTO
  - notes: Build Keepa client, batch import endpoint, store in price_snapshots. Works with mock data.

- [ ] F2: Historical appreciation calculated for retired sets
  - blocked_by: F1
  - verify_type: AUTO
  - notes: Create investment_historical table. Calculate 1yr/3yr appreciation from price data. Flag insufficient data.

- [ ] F3: TensorFlow.js model trained on historical data
  - blocked_by: F2
  - verify_type: AUTO
  - notes: Install TensorFlow.js. Feature engineering pipeline. Training script with holdout validation. Save model artifact.

- [ ] E2: Insufficient training data handled gracefully
  - blocked_by: F3
  - verify_type: AUTO
  - notes: Guard in training endpoint. Return warning if < 50 samples. Preserve existing model.

- [ ] F4: Investment score algorithm (1-10) computed per set
  - blocked_by: F3
  - verify_type: AUTO
  - notes: Create investment_predictions table. Composite score with weights. Rule-based fallback if no model.

- [ ] E1: Model inference graceful fallback when no model exists
  - blocked_by: F4
  - verify_type: AUTO
  - notes: Fallback scoring without ML. confidence=0, risk_factors includes flag.

- [ ] F7: Investment score column on dashboard table
  - blocked_by: F4
  - verify_type: AUTO
  - notes: Join investment_predictions into /api/investment. Add sortable score column with colour-coded badge.

- [ ] F5: Predictions displayed on set detail page
  - blocked_by: F4
  - verify_type: AUTO
  - notes: Add prediction section to InvestmentDetail. Colour-coded score badge. Fallback for unscored sets.

- [ ] I1: Predictions API endpoint for external consumers
  - blocked_by: F4
  - verify_type: AUTO
  - notes: /api/investment/predictions (paginated, filterable). /api/investment/predictions/[setNumber] for single set.

- [ ] F6: Top Investment Picks page at /investment/top-picks
  - blocked_by: F7
  - verify_type: AUTO
  - notes: Card/table layout. Top 20 by score. "Retiring within" filter. Linked from sidebar + dashboard.

- [ ] F8: Model retraining cron endpoint
  - blocked_by: F3, F4
  - verify_type: AUTO
  - notes: /api/cron/investment-retrain. Recalc historical → retrain → re-score. Monthly cadence. CRON_SECRET auth.

- [ ] P1: Scoring all active sets completes within 5 minutes
  - blocked_by: F4
  - verify_type: AUTO
  - notes: Batch processing. Verify duration_ms < 300000. All eligible sets scored.

## Dependency Graph

```
F1 (Keepa importer)
  └─→ F2 (Historical appreciation)
       └─→ F3 (TensorFlow.js model training)
            ├─→ E2 (Insufficient data guard)
            ├─→ F8 (Retrain cron)
            └─→ F4 (Investment score algorithm)
                 ├─→ E1 (No-model fallback)
                 ├─→ F5 (Detail page predictions)
                 ├─→ F7 (Dashboard score column)
                 │    └─→ F6 (Top Picks page)
                 ├─→ I1 (Predictions API)
                 └─→ P1 (Performance check)
```
