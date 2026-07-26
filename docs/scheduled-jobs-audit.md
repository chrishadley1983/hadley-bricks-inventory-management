# Hadley Bricks — Scheduled Jobs Audit

**Rebuilt: 2026-07-26** from live sources, not from `gcp/setup.ps1` or memory:

```
gcloud scheduler jobs list --location=europe-west2     42 jobs (31 enabled, 11 paused)
gcloud functions list                                   3 functions
gcloud run jobs list --region=europe-west2              1 job
Get-ScheduledTask -TaskName 'HadleyBricks-*'           18 local tasks
Discord-Messenger/jobs/hb_crons.py                     10 HB routes on Peter (APScheduler)
peter_dashboard/job_history.db                          run history for those 10
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

Five places, and a job can be live in any of them. **A route existing under `/api/cron/`
proves nothing about whether anything calls it — and a job showing PAUSED in GCP proves
nothing about whether it runs**, because ten of the eleven paused jobs were re-homed.

| Host | What it runs | How to check |
|------|-------------|--------------|
| GCP Cloud Scheduler | HTTP → Vercel `/api/cron/*`, Cloud Run, Cloud Functions | `gcloud scheduler jobs list` |
| Local Windows Task Scheduler | anything needing Chrome CDP, or moved off Vercel for CPU | `Get-ScheduledTask 'HadleyBricks-*'` |
| Supabase `pg_cron` | in-database cleanup | SQL: `select * from cron.job` |
| **Peter Bot (APScheduler, WSL)** | **10 HB cron routes moved off Vercel/GCP** | `Discord-Messenger/jobs/hb_crons.py` + `peter_dashboard/job_history.db` |
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

**Paused in GCP does not mean not running.** Ten of the eleven have a live replacement —
five moved to the local Windows Task Scheduler, five to **Peter Bot's `hb_crons.py`**
(`Discord-Messenger/jobs/hb_crons.py`, APScheduler on WSL, hitting
`HB_LOCAL_URL=http://localhost:3000`). Its phase-2 block says "ex-GCP Cloud Scheduler;
schedules preserved exactly", and Peter's `job_history.db` confirms they fire.

| Job | GCP schedule | Replaced by | Evidence (2026-07-26) |
|-----|-------------|-------------|----------------------|
| ebay-auction-sniper | `*/30 * * * *` | `HadleyBricks-Ebay-Auctions-Local` (every 5 min) | task Ready |
| ebay-pricing-sync | `0 2 * * *` | `HadleyBricks-Ebay-Pricing-Local` 03:00 | ran 03:00 |
| amazon-pricing-sync | `0 */3 * * *` | `HadleyBricks-Amazon-Pricing-Local` 09:02 | ran 09:02 |
| bricklink-pricing-sync | `30 2 * * *` | `HadleyBricks-PG-Refresh-Cycle` 00:05 | ran 00:05 |
| full-sync | `45 3,7,11,15,19,23 * * *` | Peter `hb_full_sync`, same 6 slots | last 08:45 · 258/262 ok |
| ebay-fp-cleanup | `0,15,30,45 4 * * *` | Peter `hb_ebay_fp_cleanup` | last 05:45 · 170/174 ok |
| investment-sync | `0 7 * * *` | Peter `hb_investment_sync` 07:00 UTC | last 08:00 · 45/45 ok |
| cost-allocation | `15 21 * * *` | Peter `hb_cost_allocation` 21:15 London | last 21:15 · 45/45 ok |
| retirement-sync | `0 6 * * *` | Peter `hb_retirement_sync` 06:00 UTC | last 07:00 · 45/45 ok |
| investment-retrain | `0 5 1 * *` | Peter `hb_investment_retrain`, 1st monthly | last 2026-07-01 · ok |
| **inventory-bricklink-enrich** | `10 3,6,9,12,15 * * *` | ⚠️ **nothing found** | see below |

`investment-retrain` is worth knowing about: it never completed on Vercel (work needs
~15+ min against a 300s platform cap; 5/5 timeouts since March, leaving the investment
dashboard on four-month-stale predictions). Locally it has no duration cap and takes a
measured 41 minutes.

### The one genuine gap

**`inventory-bricklink-enrich`** (`/api/cron/inventory/enrich`) is paused in GCP with no
replacement in Peter's `hb_crons.py`, no Windows task, and no runner script. It is the
only one of the eleven that looks silently dead rather than deliberately moved.

Before acting on that, note `inventory_items` is still being written (newest `updated_at`
2026-07-26 06:00), so *something* touches those rows — the enrichment specifically may
still be covered by another path. Worth one pass to confirm whether the enrichment it
performed is genuinely missing, then either re-home it alongside the others in
`hb_crons.py` or delete the job and the route.

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

Peter Bot WAS re-verified this pass — see the paused-jobs table above.

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
