# Vercel Fluid CPU Reduction — 26 Jun 2026

**Goal:** bring rolling-30d Fluid Active CPU back under the Hobby free limit (4h /
14,400s). It had reached **7h59m (199.6%)** and was *rising* despite the 12 Jun
"migration".

## Why the 12 Jun migration produced no improvement

- PR #435 removed 3 crons from `vercel.json` (`ebay-stock-sync`,
  `bricqer-batch-sync`, `scanner-image-cleanup`) on the theory they were "~75%
  of the Fluid CPU burn". Per `job_execution_history` they were **~9 min / 30d
  combined** — rounding error.
- The follow-up local migration (discord-messenger) correctly moved 6 heavy jobs
  (`full-sync`, `ebay-fp-cleanup`, `investment-sync`, `cost-allocation`,
  `retirement-sync`, `investment-retrain`) to the local bot and **paused** their
  GCP jobs — good, but it **excluded `amazon-pricing` + `ebay-pricing`** on the
  belief they "target Cloud Run, not Vercel". In fact `gcp/functions/pricing-sync-driver`
  *loops calling the Vercel route* (`…vercel.app/api/cron/amazon-pricing`), so the
  pricing work executes **on Vercel**. `amazon-pricing` (every 30 min) was the
  **#1 Vercel CPU consumer (1,138 wall-s/day, 57% of remaining Vercel cron load)**
  and was left untouched.
- Meanwhile the GCP fleet grew 27 → 40 jobs with new hourly/30-min Vercel pollers.

## Changes made

### In-repo (PR — `fix/vercel-cpu-overage`)
Strategy 1 of `docs/Vercel-Optimization-Plan.md` (never previously implemented):
- Pomodoro & time-tracking "current" polls 1s → 10s (panels already have local
  display timers); time-tracking summary 60s → 5m.
- `refetchIntervalInBackground: false` on all 14 polling hooks (stops polling in
  hidden tabs).
- 30s → 90s / 60s → 120s on remaining status pollers.
- `vercel-usage` report: replaced the hardcoded "migration effect surfaces …
  (~5d)" line (which printed whenever the metric was *not* falling, manufacturing
  false reassurance) with the real signed slope (RISING / flat / falling).

### GCP Cloud Scheduler (applied via `gcloud`, reversible)

| Job | Old | New | Rationale |
|---|---|---|---|
| `amazon-pricing-sync` | `*/30 * * * *` | `0 */3 * * *` | #1 burner. In-stock still refreshed ~2×/day; urgent buy-box covered by `spapi-buybox-refresh` (*/30, untouched) |
| `ebay-auction-sniper` | `*/15 * * * *` | `*/30 * * * *` | Alert scan, not latency-critical |
| `amazon-fee-reconcile` | `0 * * * *` | `0 8 * * *` | Fees reconcile fine daily |
| `amazon-orders-backfill` | `15 * * * *` | `15 */6 * * *` | Catch-up backfill |
| `amazon-transactions-sync` | `30 * * * *` | `30 */6 * * *` | Tx sync every 6h is ample |
| `order-issues-sync` | `*/30 * * * *` | `0 */2 * * *` | Issue polling every 2h |

**Rollback** (restore any job):
```
gcloud scheduler jobs update http <JOB> --schedule="<OLD>" \
  --location=europe-west2 --project=gen-lang-client-0823893317
```

## Projected effect

Vercel-executing cron wall-clock: **1,979 → ~880 s/day (−55%)**. Applying the same
ratio to Active CPU projects the rolling-30d to **~3.5h /30d**, clearing the 4h
limit with ~11% margin even under a pessimistic CPU:wall ratio — before counting
the client-polling savings. The rolling-30d figure lags ~2–3 weeks as pre-change
days roll off the window; the daily `vercel-usage` report now shows the true slope.
