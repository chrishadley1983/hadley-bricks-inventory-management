# Hadley Bricks — Scheduled Jobs Audit

*Generated: 2026-03-18 — verified against live `gcloud scheduler jobs list` output*

## Executive Summary

| Metric | Count |
|--------|-------|
| **GCP Cloud Scheduler Jobs** | 27 (all ENABLED) |
| **GCP Cloud Run Jobs** | 1 (delivery-report-daily) |
| **GCP Cloud Functions** | 1 (pricing-sync-driver) |
| **Supabase pg_cron Jobs** | 1 (zombie cleanup) |
| **Peter Bot HB-Related Jobs** | ~8 |
| **Broken / Disabled** | 3 |
| **Total Cron Route Endpoints** | 31 |

**Systems:** GCP Cloud Scheduler → Vercel API routes, GCP Cloud Function (pricing driver), GCP Cloud Run (delivery report), Supabase pg_cron (zombie cleanup), Peter Bot (APScheduler on WSL).

**App URL:** `https://hadley-bricks-inventory-management.vercel.app`
**GCP Project:** `gen-lang-client-0823893317` (europe-west2)
**Runtime:** Vercel Pro (300s maxDuration)

> **Data source:** All schedules below are from live `gcloud scheduler jobs list` output, NOT from `gcp/setup.ps1` or `gcp/README.md` (both are stale).

---

## GCP Cloud Scheduler (27 Jobs)

### High-Frequency (Every 5–30 min)

| Job Name | Live Schedule | Target | Description |
|----------|--------------|--------|-------------|
| amazon-two-phase-sync | `*/5 * * * *` | Vercel `/api/cron/amazon-sync` | Two-phase feed processor (price → quantity), 6 intermediate states |
| amazon-pricing-sync | `*/30 * * * *` | Cloud Function `pricing-sync-driver` | Keepa API budget-spread, ~57 ASINs/call, in-stock prioritised |
| spapi-buybox-refresh | `*/30 * * * *` | Vercel `/api/cron/spapi-buybox-refresh` | Lightweight refresh for ASINs flagged `spapi_refresh_needed` |
| ebay-auction-sniper | `*/15 * * * *` | Vercel `/api/cron/ebay-auctions` | Find LEGO auctions ending soon with arbitrage potential, Discord alerts |
| minifig-poll-ebay-orders | `*/30 * * * *` | Vercel `/api/cron/minifigs/poll-ebay-orders` | Detect eBay minifig sales for cross-platform delisting |
| minifig-poll-bricqer-orders | `*/30 * * * *` | Vercel `/api/cron/minifigs/poll-bricqer-orders` | Detect Bricqer minifig sales for removal queue |

### Multi-Daily

| Job Name | Live Schedule | Target | Description |
|----------|--------------|--------|-------------|
| full-sync | `45 3,7,11,15,19,23 * * *` | Vercel `/api/cron/full-sync` | eBay, Amazon, BrickLink, Brick Owl, Shopify batch, Discord report (6x daily) |
| ebay-negotiation-sync | `0 8,12,16,20 * * *` | Vercel `/api/cron/negotiation` | Automated eBay offers: sync statuses + send new (4x daily) |

### Daily — Overnight (02:00–06:00 UTC)

| Job Name | Live Schedule | Target | Description |
|----------|--------------|--------|-------------|
| ebay-pricing-sync | `0 2 * * *` | Cloud Function `pricing-sync-driver` | Cursor-based eBay pricing, up to 1,000 items/day (resumable) |
| email-purchases | `17 2 * * *` | Vercel `/api/cron/email-purchases` | Gmail scan for Vinted/eBay purchase confirmations, batch import |
| bricklink-pricing-sync | `30 2 * * *` | Cloud Function `pricing-sync-driver` | Cursor-based BrickLink pricing, up to 1,000 items/day (resumable) |
| ebay-fp-cleanup | `0 4 * * *` | Vercel `/api/cron/ebay-fp-cleanup` | False-positive detection with 34 weighted signals (threshold 50) |
| ebay-promotions | `0 5 * * *` | Vercel `/api/cron/ebay-promotions` | Apply promotion schedules: bid percentages based on listing age |
| investment-retrain | `0 5 1 * *` | Vercel `/api/cron/investment-retrain` | Monthly ML model retrain and investment scoring (1st of month only) |
| verify-punditry-daily | `30 5 * * *` | Cloud Run `verify-punditry` | Football Prediction Game verification (non-HB) |
| retirement-sync | `0 6 * * *` | Vercel `/api/cron/retirement-sync` | Sync retirement status from Brickset + Brick Tap |
| spapi-buybox-overlay | `0 6 * * *` | Cloud Function `pricing-sync-driver` | SP-API buy box data for ~232 in-stock ASINs (resumable) |
| minifig-daily-inventory | `0 6 * * *` | Vercel `/api/cron/minifigs/daily-inventory` | Crash recovery + inventory pull + repricing (Mon only) |

### Daily — Daytime (07:00+ UTC)

| Job Name | Live Schedule | Target | Description |
|----------|--------------|--------|-------------|
| delivery-report-daily | `0 7 * * *` | Cloud Run job trigger | 10-step pipeline: orders → tracking → report → email |
| vercel-usage-report | `0 7 * * *` | Vercel `/api/cron/vercel-usage` | Vercel metrics, RAG status, email + Discord summary |
| investment-sync | `0 7 * * *` | Vercel `/api/cron/investment-sync` | ASIN linkage, auto-classification, price movement alerts |
| vinted-collections | `0 8 * * *` | Vercel `/api/cron/vinted-collections` | Gmail parsing for Vinted collection-ready + Royal Mail pickup |
| ebay-listing-refresh | `0 19 * * *` | Vercel `/api/cron/ebay-listing-refresh` | End stale listings (90+ days), recreate with engagement-based pricing |
| cost-allocation | `15 21 * * *` | Vercel `/api/cron/cost-allocation` | Distribute purchase costs proportionally across items |

### Weekly

| Job Name | Live Schedule | Target | Description |
|----------|--------------|--------|-------------|
| refresh-watchlist | `0 3 * * 0` | Vercel `/api/cron/refresh-watchlist` | Populate arbitrage watchlist with sold items (Sunday 3am) |
| rebrickable-sync | `0 4 * * 0` | Vercel `/api/cron/rebrickable-sync` | Sync LEGO set data from Rebrickable (Sunday 4am) |
| ebay-category-audit | `0 7 * * 1` | Vercel `/api/cron/ebay-category-audit` | eBay category audit report (Monday 7am) |

---

## Cloud Function: pricing-sync-driver

- **Runtime:** Gen2, Node.js 20, europe-west2
- **Entry point:** `pricingSyncDriver`
- **Trigger:** HTTP (authenticated via OIDC)
- **Timeout:** 3600s (1 hour)
- **Memory:** 256MB
- **Purpose:** Resumable retry driver — calls Vercel pricing endpoints in a loop until `{complete: true}`
- **Handles 4 jobs:** amazon-pricing, ebay-pricing, bricklink-pricing, spapi-buybox-overlay

---

## Supabase pg_cron (1 Job)

### cleanup-stale-job-executions
- **Schedule:** `*/5 * * * *` (every 5 minutes)
- **Function:** `cleanup_stale_job_executions()`
- **Purpose:** Auto-mark jobs stuck in "running" for >10 minutes as "timeout"

---

## Peter Bot HB-Related Jobs (~8)

APScheduler on WSL, timezone Europe/London.

| Job Name | Schedule | Description | Channel |
|----------|----------|-------------|---------|
| hb-full-sync-print | 09:35 daily | Triggers full-sync + pick list PDFs | #peterbot |
| daily-instagram-prep | 21:05 daily | Instagram content preparation | #peterbot |
| amazon-purchases | 09:30 daily | Personal Amazon order sync (CDP) | #peterbot |
| email-summary | 08:02 daily | Gmail summary (may surface HB emails) | #peterbot |
| schedule-today | 08:04 daily | Today's schedule | #peterbot |
| incremental-seed | 01:00 daily | Second Brain import (includes HB email) | #alerts |

---

## Broken / Disabled Jobs

### 1. `markdown` cron route — NOT SCHEDULED
- **Route:** `apps/web/src/app/api/cron/markdown/route.ts`
- **Issue:** Route exists but NO GCP Cloud Scheduler job fires it
- **Fix:** Create GCP scheduler job, suggested schedule: daily 8pm UK

### 2. `minifigs/research-refresh` — DISABLED IN CODE
- **Route:** `apps/web/src/app/api/cron/minifigs/research-refresh/route.ts`
- **Issue:** Terapeak research requires local Playwright, not available on Vercel
- **Fix:** No path on Vercel. Would need Cloud Run container with Playwright

### 3. Royal Mail Backfill — TASK NOT REGISTERED
- **Script:** `rm_backfill.py`
- **Issue:** Windows Task Scheduler task not registered
- **Fix:** Create PowerShell script to register Windows scheduled task

---

## Optimisation Opportunities

### 1. 6am UTC Collision
Three jobs fire simultaneously at `0 6 * * *` UTC:
- `retirement-sync`, `spapi-buybox-overlay`, `minifig-daily-inventory`
- **Fix:** Stagger by 10 minutes

### 2. Non-HB Job in HB Project
- `verify-punditry-daily` (05:30 UTC) is Football Prediction Game → Cloud Run function
- Consider moving to separate project

---

## 24-Hour Schedule Overview (UTC) — FROM LIVE GCP DATA

```
01:00  [Peter] incremental-seed
02:00  ebay-pricing-sync (Cloud Function, resumable)
02:17  email-purchases
02:30  bricklink-pricing-sync (Cloud Function, resumable)
03:00  refresh-watchlist (Sun only)
03:45  full-sync [1/6]
04:00  rebrickable-sync (Sun only), ebay-fp-cleanup
05:00  ebay-promotions, investment-retrain (1st only)
05:30  verify-punditry-daily (non-HB, Cloud Run)
06:00  retirement-sync, spapi-buybox-overlay (Cloud Function), minifig-daily-inventory ⚠️ COLLISION
07:00  delivery-report-daily (Cloud Run), vercel-usage-report, investment-sync, ebay-category-audit (Mon)
07:45  full-sync [2/6]
08:00  ebay-negotiation-sync [1/4], vinted-collections
08:02  [Peter] email-summary
08:04  [Peter] schedule-today
09:30  [Peter] amazon-purchases
09:35  [Peter] hb-full-sync-print
11:45  full-sync [3/6]
12:00  ebay-negotiation-sync [2/4]
15:45  full-sync [4/6]
16:00  ebay-negotiation-sync [3/4]
19:00  ebay-listing-refresh
19:45  full-sync [5/6]
20:00  ebay-negotiation-sync [4/4]
21:05  [Peter] daily-instagram-prep
21:15  cost-allocation
23:45  full-sync [6/6]

CONTINUOUS:
  */5   amazon-two-phase-sync
  */15  ebay-auction-sniper
  */30  amazon-pricing-sync (Cloud Function), spapi-buybox-refresh, minifig-poll-ebay-orders, minifig-poll-bricqer-orders
  */5   pg_cron: cleanup-stale-job-executions (Supabase)
```

---

## Key Corrections from Previous Audit

| Item | Was (from setup.ps1/README) | Actually Is (live GCP) |
|------|---------------------------|----------------------|
| investment-sync | `0 5 * * *` (05:00) | `0 7 * * *` (07:00) |
| investment-retrain | `0 6 1 * *` (06:00) | `0 5 1 * *` (05:00) |
| minifig-poll-ebay-orders | `*/15` (every 15 min) | `*/30` (every 30 min) |
| spapi-buybox-overlay | Direct to Vercel | Via Cloud Function `pricing-sync-driver` |
| verify-punditry-daily | "daily" (vague) | `30 5 * * *` → Cloud Run function |
| ebay-fp-cleanup | "Not scheduled" | `0 4 * * *` ENABLED |
| ebay-promotions | "Not scheduled" | `0 5 * * *` ENABLED |
| 5am collision | ebay-promotions + investment-sync | No collision — investment-sync is at 07:00 |
| Pricing-sync-driver | Handles 3 jobs | Handles 4 jobs (incl. spapi-buybox-overlay) |

---

*Source: `gcloud scheduler jobs list --location=europe-west2 --project=gen-lang-client-0823893317` (live, 2026-03-18)*
*`gcp/setup.ps1` and `gcp/README.md` are STALE — do not use as source of truth*
