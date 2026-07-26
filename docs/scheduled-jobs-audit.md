# Hadley Bricks — Scheduled Jobs Audit

**Rebuilt: 2026-07-26** from live sources, not from `gcp/setup.ps1` or memory:

```
gcloud scheduler jobs list --location=europe-west2     42 jobs (31 enabled, 11 paused)
gcloud functions list                                   3 functions
gcloud run jobs list --region=europe-west2              1 job
Get-ScheduledTask -TaskName 'HadleyBricks-*'           18 local tasks
vercel.json                                             NO crons
```

> **The 2026-03-18 version of this file described every job as a Vercel cron.** That is
> now wrong on every row: `vercel.json` has no `crons` block at all. Scheduled work moved
> to GCP Cloud Scheduler and the local Windows Task Scheduler, and this doc was never
> rebuilt — which meant "does X run?" could not be answered from it. Treat this as a dated
> snapshot; re-check against the commands above rather than trusting the tables.

**GCP project:** `gen-lang-client-0823893317` (europe-west2)
**App URL:** `https://hadley-bricks-inventory-management.vercel.app`

---

## Where a job can live

Four places, and a job can be live in any of them. **A route existing under `/api/cron/`
proves nothing about whether anything calls it.**

| Host | What it runs | How to check |
|------|-------------|--------------|
| GCP Cloud Scheduler | HTTP → Vercel `/api/cron/*`, Cloud Run, Cloud Functions | `gcloud scheduler jobs list` |
| Local Windows Task Scheduler | anything needing Chrome CDP, or moved off Vercel for CPU | `Get-ScheduledTask 'HadleyBricks-*'` |
| Supabase `pg_cron` | in-database cleanup | SQL: `select * from cron.job` |
| Peter Bot (APScheduler, WSL) | Chris's personal/ops jobs | Peter's `job_history.db` |
| ~~Vercel crons~~ | **none** | `vercel.json` — expect no `crons` block |

---

## GCP Cloud Scheduler — 31 enabled

| Job | Schedule (UTC) | Target |
|-----|---------------|--------|
| amazon-two-phase-sync | `*/10 * * * *` | `/api/cron/amazon-sync` |
| minifig-poll-bricqer-orders | `*/30 * * * *` | `/api/cron/minifigs/poll-bricqer-orders` |
| minifig-poll-ebay-orders | `*/30 * * * *` | `/api/cron/minifigs/poll-ebay-orders` |
| minifig-process-removals | `*/30 * * * *` | `/api/cron/minifigs/process-removals` |
| spapi-buybox-refresh | `*/30 * * * *` | `/api/cron/spapi-buybox-refresh` |
| order-issues-sync | `0 */2 * * *` | `/api/cron/order-issues-sync` |
| amazon-orders-backfill | `15 */6 * * *` | `/api/cron/amazon-orders-backfill` |
| amazon-transactions-sync | `30 */6 * * *` | `/api/cron/amazon-transactions-sync` |
| email-purchases | `17 2 * * *` | `/api/cron/email-purchases` |
| ebay-promotions | `0 5 * * *` | `/api/cron/ebay-promotions` |
| verify-punditry-daily | `30 5 * * *` | Cloud Function `verify-punditry` (non-HB) |
| minifig-daily-inventory | `0 6 * * *` | `/api/cron/minifigs/daily-inventory` |
| spapi-buybox-overlay | `0 6 * * *` | via Cloud Function `pricing-sync-driver` |
| minifig-reconcile | `30 6 * * *` | `/api/cron/minifigs/reconcile` |
| monzo-sync | `40 6 * * *` | `/api/cron/monzo-sync` |
| bricklink-transaction-sync | `0 7 * * *` | `/api/cron/bricklink-transaction-sync` |
| delivery-report-daily | `0 7 * * *` | Cloud Run job `delivery-report` |
| markdown-suggest | `0 7 * * *` | `/api/cron/markdown` |
| vercel-usage-report | `0 7 * * *` | `/api/cron/vercel-usage` |
| brickowl-transaction-sync | `5 7 * * *` | `/api/cron/brickowl-transaction-sync` |
| paypal-sync | `10 7 1,8,15,22,29 * *` | `/api/cron/paypal-sync` |
| bricqer-sync-status | `35 7 * * *` | `/api/cron/bricqer-sync-status` |
| amazon-fee-reconcile | `0 8 * * *` | `/api/cron/amazon-fee-reconcile` |
| pov-freshness-report | `0 8 * * *` | `/api/cron/pov-freshness-report` |
| vinted-collections | `0 8 * * *` | `/api/cron/vinted-collections` |
| ebay-negotiation-sync | `0 8,12,16,20 * * *` | `/api/cron/negotiation` |
| ebay-listing-refresh | `0 19 * * *` | `/api/cron/ebay-listing-refresh` |
| japan-daily-digest | `0 21 * * *` | Cloud Function `japan-digest` (non-HB) |
| refresh-watchlist | `0 3 * * 0` | `/api/cron/refresh-watchlist` (Sun) |
| rebrickable-sync | `0 4 * * 0` | `/api/cron/rebrickable-sync` (Sun) |
| **ebay-category-audit** | `0 7 * * 1` | `/api/cron/ebay-category-audit` (Mon) |

`ebay-category-audit` emails a report and **persists nothing**, so there is no artefact
proving it ran — easy to assume dead. It is enabled and firing (last attempt 2026-07-20).
It exists because our own complete sets end up in category 183448 instead of 19006.

## GCP Cloud Scheduler — 11 paused

Paused is often deliberate. The ones with no known replacement are flagged.

| Job | Schedule | Status |
|-----|---------|--------|
| ebay-auction-sniper | `*/30 * * * *` | moved to `HadleyBricks-Ebay-Auctions-Local` |
| ebay-pricing-sync | `0 2 * * *` | moved to `HadleyBricks-Ebay-Pricing-Local` |
| amazon-pricing-sync | `0 */3 * * *` | moved to `HadleyBricks-Amazon-Pricing-Local` |
| bricklink-pricing-sync | `30 2 * * *` | superseded by `HadleyBricks-PG-Refresh-Cycle` |
| investment-retrain | `0 5 1 * *` | retrain is manual — see [[investment-ml-v2]] |
| full-sync | `45 3,7,11,15,19,23 * * *` | ⚠️ no replacement found |
| investment-sync | `0 7 * * *` | ⚠️ no replacement found |
| retirement-sync | `0 6 * * *` | ⚠️ no replacement found |
| inventory-bricklink-enrich | `10 3,6,9,12,15 * * *` | ⚠️ no replacement found |
| cost-allocation | `15 21 * * *` | ⚠️ no replacement found |
| ebay-fp-cleanup | `0,15,30,45 4 * * *` | ⚠️ no replacement found |

The six ⚠️ rows were paused at some point and never revisited. Each is either
intentionally retired or a silently-dead job; worth one pass to decide and record which.

## GCP Cloud Functions / Run

| Name | Type | State |
|------|------|-------|
| `pricing-sync-driver` | Function | ACTIVE — resumable driver, loops a Vercel endpoint until `{complete:true}` |
| `verify-punditry` | Function | ACTIVE — non-HB |
| `japan-digest` | Function | ACTIVE — non-HB |
| `delivery-report` | Cloud Run job | present |

---

## Local Windows Task Scheduler — 18 tasks

`S4U` runs whether Chris is logged on or not. `Interactive` only fires while logged on —
which is **correct for anything driving Chrome CDP**, because there is no browser without
a desktop session. Do not "tidy" the Interactive ones to S4U.

| Task | Time (local) | Logon | Notes |
|------|-------------|-------|-------|
| PG-Refresh-Cycle | 00:05 | S4U | BrickLink price-guide trawl (~7k rows/day) |
| Bricqer-Snapshot-Local | 01:30, **every 2nd Sun** | S4U | ~312 Bricqer calls/sweep |
| Store-Assessment-Local | 02:15 | Interactive | needs CDP :9225 |
| Ebay-Pricing-Local | 03:00 | S4U | |
| POV-Refresh | 03:00 | Interactive | needs CDP :9225 |
| Keepa-Refresh-Local | 05:30 | S4U | |
| Vercel-Usage-Scraper | 06:30 | Interactive | needs CDP :9222 |
| RM-Backfill | 07:00 | Interactive | needs CDP :9222 |
| PG-Canary | 07:30 | S4U | |
| PG-Digest | 07:45 | S4U | |
| Discord-Health-Local | 08:00 | S4U | |
| OrderIssues-BL-CDP | 08:00 | S4U | |
| PG-Heartbeat | 08:00 | S4U | |
| PG-Rank | 09:00 | S4U | |
| Amazon-Pricing-Local | 09:02 | S4U | |
| Identity-Enrichment | 17:59 | S4U | |
| Ebay-Auctions-Local | every 5 min | S4U | |
| Ebay-Bin-Partout-Local | every 15 min | S4U | |

Several run from dedicated worktrees (`hb-assess-wt`) pinned to `origin/main`, because the
main checkout's branch changes constantly and repo files may be absent when a task fires.

---

## Not re-verified in this pass

| Area | Last known | How to check |
|------|-----------|--------------|
| Supabase `pg_cron` | 1 job — stale job-execution cleanup, `*/5` | `select jobname, schedule, active from cron.job` (SQL editor; no service-role RPC exists) |
| Peter Bot (APScheduler, WSL) | ~8 HB-related jobs | Peter's `job_history.db` — see [[peter-heartbeat-quiet-mode]] |

---

## How to re-check

```powershell
gcloud scheduler jobs list --location=europe-west2 `
  --format="table(name.basename(),schedule,state,lastAttemptTime)"

gcloud functions list
gcloud run jobs list --region=europe-west2

Get-ScheduledTask -TaskName 'HadleyBricks-*' | ForEach-Object {
  $i = Get-ScheduledTaskInfo -TaskName $_.TaskName
  '{0}|{1}|{2}|{3}' -f $_.TaskName, $_.State, $_.Principal.LogonType, $i.LastRunTime
}

Get-Content vercel.json   # expect NO crons block
```
