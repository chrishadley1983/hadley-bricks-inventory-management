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

## Follow-up — 30 Jun 2026: `ebay-pricing` moved off Vercel to the local bot

**Verified 30 Jun** (via `job_execution_history`): the 26 Jun cuts landed exactly as
designed — `amazon-pricing` 48→8 runs/day (~1,135→~201 wall-s/day), total
Vercel-executing cron wall **2,005→909 s/day (−55%)**, rolling-30d Fluid CPU peaked
28,980s on 26 Jun and began declining. Steady-state projects ~3.6h/30d — clears 4h
but with only ~9% margin.

To widen the margin, the **largest remaining untouched Vercel pricing job** was
migrated. `ebay-pricing` (like `amazon-pricing`/`bricklink-pricing`) runs **on
Vercel** because `gcp/functions/pricing-sync-driver` loops calling the
`…vercel.app/api/cron/ebay-pricing` route. It is a once-daily cursor-resumable batch
(02:00 UTC, ~1,000 watchlist items in 100-item chunks, ~207 wall-s/day, ~100 CPU-s/day).
A once-daily batch is ideal for the local bot.

**Change (same pattern as the 12 Jun local migration of full-sync/ebay-fp-cleanup/etc.):**
- New `scripts/run-ebay-pricing.ps1` — loops POSTing `http://localhost:3000/api/cron/ebay-pricing`
  (local NSSM Next.js server) until `{ complete: true }`, mirroring the driver loop.
  Reads `CRON_SECRET` from `apps/web/.env.local`.
- New `scripts/register-ebay-pricing-task.ps1` — registers Windows Task
  `HadleyBricks-Ebay-Pricing-Local`, daily 03:00 local.
- GCP `ebay-pricing-sync` Cloud Scheduler job **PAUSED** (was `0 2 * * *`) so the work
  no longer executes on Vercel. No route code changed → no local rebuild needed.

**Rollback:**
```
gcloud scheduler jobs resume ebay-pricing-sync --location=europe-west2 --project=gen-lang-client-0823893317
Unregister-ScheduledTask -TaskName "HadleyBricks-Ebay-Pricing-Local" -Confirm:$false
```

**Projected effect:** removes ~209 s/day Vercel wall (~100 CPU-s/day) → steady-state
rolling-30d Fluid CPU ~3.6h → **~2.8h/30d**, lifting headroom from ~9% to ~30%.

## Follow-up — 02 Jul 2026: `ebay-auction-sniper` moved off Vercel to the local bot (and sped up to 5 min)

The 26 Jun cut halved the sniper cadence (`*/15` → `*/30`) while the scan window
stayed 15 min — leaving **half of ending auctions never scanned** (worse once the
window was tightened to 10 min on 2 Jul: two-thirds missed). Auctions are
latency-sensitive after all: the alert has to land minutes before the hammer.
Instead of restoring cadence on Vercel (which would claw back the CPU win), the
sniper moved to the local bot at a **5-minute cadence with a 5-minute scan
window** — contiguous coverage of ending auctions at zero Vercel cost. This also
carries the new POV buy signals (PR #477: New-POV hybrid + opt-in USED scan,
PR #480 fix: used scan runs even when the NEW search is empty).

**Change (same pattern as the ebay-pricing local migration):**
- New `scripts/run-ebay-auctions.ps1` — single POST per run to
  `http://localhost:3000/api/cron/ebay-auctions`, `CRON_SECRET` from
  `apps/web/.env.local`; appends a one-line summary per run to
  `logs\ebay-auctions-local.log` (gitignored, self-trimming). Quiet hours
  (23:00–07:00) are enforced inside the route (`skipped: quiet_hours`).
- New `scripts/register-ebay-auctions-task.ps1` — registers Windows Task
  `HadleyBricks-Ebay-Auctions-Local`, repeating every 5 minutes
  (`MultipleInstances IgnoreNew`, 4-min execution limit).
- `ebay_auction_config.scan_window_minutes` set **10 → 5** to match the cadence.
- GCP `ebay-auction-sniper` Cloud Scheduler job **PAUSED** (was `*/30 * * * *`).
  No route code changed by the migration itself.

**Rollback:**
```
gcloud scheduler jobs resume ebay-auction-sniper --location=europe-west2 --project=gen-lang-client-0823893317
Unregister-ScheduledTask -TaskName "HadleyBricks-Ebay-Auctions-Local" -Confirm:$false
-- and restore ebay_auction_config.scan_window_minutes (15 pre-2-Jul, 5 post-migration)
```

**Projected effect:** removes the sniper's 48 Vercel invocations/day (~2–15 s wall
each, ~100–300 wall-s/day) on top of the ebay-pricing win, while the 6× cadence
increase (288 runs/day) costs Vercel nothing. E2E validation workflow:
`.claude/workflows/validate-ebay-auctions-local.js`.

---

## Addendum — 10 Jul 2026: amazon-pricing migrated local (the last big Vercel cron)

**Trigger:** Vercel "Fluid Active CPU 100%" alert fired 4 Jul. Investigation showed
the rolling-30d metric peaked 28,980s (201%) on 26 Jun and has fallen every day
since 1 Jul (24,660s / 171% on 10 Jul) as pre-reduction days roll off — the 26 Jun
changes are working. But two problems remained, both `amazon-pricing`:

1. **Steady burn:** still the #1 Vercel cron consumer (~210 wall-s/day at `0 */3`
   via the pricing-sync-driver → Vercel route).
2. **Storm risk:** 21:00 2 Jul – 12:00 3 Jul the route wedged — six consecutive
   runs marked timeout at 894s each (~89 min of max-duration Fluid burn overnight),
   which is what tipped the rolling window into the 4 Jul alert. Self-recovered
   at 15:00 3 Jul.

**Change (mirrors the ebay-pricing pattern):**
- `scripts/run-amazon-pricing.ps1` — single POST to
  `http://localhost:3000/api/cron/amazon-pricing` (route is self-contained,
  driver used maxIterations=1). Logs to `logs/amazon-pricing-local.log`.
- `scripts/register-amazon-pricing-task.ps1` — Windows task
  `HadleyBricks-Amazon-Pricing-Local`, every 3h. Registered 10 Jul
  (interactive-only; re-run elevated for S4U run-while-logged-out).
- GCP `amazon-pricing-sync` Cloud Scheduler job **PAUSED** (was `0 */3 * * *`).
- Gate passed before cutover: two local runs completed (57 ASINs each, 19–27s),
  rows verified in `job_execution_history`.

**Rollback:**
```
gcloud scheduler jobs resume amazon-pricing-sync --location=europe-west2 --project=gen-lang-client-0823893317
Unregister-ScheduledTask -TaskName "HadleyBricks-Amazon-Pricing-Local" -Confirm:$false
```

**Projected effect:** removes ~210 wall-s/day plus all storm exposure from Vercel.
Remaining Vercel cron load is `spapi-buybox-overlay` (~80 wall-s/day via the
driver at 06:00) and ~25 small direct GCP pollers/dailies (~230 wall-s/day
combined). Watch the daily `vercel-usage` report slope; if the rolling-30d does
not clear 14,400s by ~26 Jul (when the window is fully post-reduction),
`spapi-buybox-overlay` is the next candidate — same runner pattern, loop-until-
complete like ebay-pricing.

**Incident note (same morning):** `apps/web/.env.local` was lost when apps/web
was re-materialized from git by an unrelated session (~08:22); the every-5-min
auction sniper failed for 2 ticks and all local runners + jobs/hb_crons.py were
at risk (they read CRON_SECRET from that file), as was any HadleyBricks NSSM
restart. Recovered via `vercel env pull` (production), Vercel-injected vars
stripped, values de-quoted (the PS runners don't strip quotes). If this recurs:
the file is gitignored — treat it as precious, and consider keeping the SOPS-
encrypted backup current.
