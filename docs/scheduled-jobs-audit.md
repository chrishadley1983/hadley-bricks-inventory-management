# Hadley Bricks — Scheduled Jobs Audit

*Generated: 2026-03-18*

## Executive Summary

| Metric | Count |
|--------|-------|
| **GCP Cloud Scheduler Jobs** | 27 |
| **GCP Cloud Run Jobs** | 1 |
| **GCP Cloud Functions** | 1 |
| **Supabase pg_cron Jobs** | 1 |
| **Peter Bot HB-Related Jobs** | ~8 |
| **Broken / Disabled** | 4 |
| **Total Scheduled Endpoints** | 31 cron routes |

**Systems:** GCP Cloud Scheduler → Vercel API routes, GCP Cloud Function (pricing driver), GCP Cloud Run (delivery report), Supabase pg_cron (zombie cleanup), Peter Bot (APScheduler on WSL).

**App URL:** `https://hadley-bricks-inventory-management.vercel.app`
**GCP Project:** `gen-lang-client-0823893317` (europe-west2)
**Runtime:** Vercel Pro (300s maxDuration)

---

## GCP Cloud Scheduler (28 Jobs)

### High-Frequency (Every 5–30 min)

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| amazon-two-phase-sync | `*/5 * * * *` | `/api/cron/amazon-sync` | UTC | default | Two-phase feed processor (price → quantity), 6 intermediate states |
| amazon-pricing-sync | `*/30 * * * *` | Cloud Function | UTC | 600s | Keepa API budget-spread, ~57 ASINs/call, in-stock prioritised |
| spapi-buybox-refresh | `*/30 * * * *` | `/api/cron/spapi-buybox-refresh` | UTC | default | Lightweight refresh for ASINs flagged `spapi_refresh_needed` |

### Medium-Frequency (Every 15 min)

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| ebay-auction-sniper | `*/15 * * * *` | `/api/cron/ebay-auctions` | UTC | default | Find LEGO auctions ending soon with arbitrage potential, Discord alerts |
| minifig-poll-ebay-orders | `*/15 * * * *` | `/api/cron/minifigs/poll-ebay-orders` | UTC | default | Detect eBay minifig sales for cross-platform delisting |

### Multi-Daily

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| full-sync | `45 3,7,11,15,19,23 * * *` | `/api/cron/full-sync` | UTC | default | Comprehensive sync: eBay, Amazon, BrickLink, Brick Owl, Shopify batch, Discord report (6x daily) |
| ebay-negotiation-sync | `0 8,12,16,20 * * *` | `/api/cron/negotiation` | UTC | default | Automated eBay offers: sync statuses + send new offers (4x daily) |
| minifig-poll-bricqer-orders | `*/30 * * * *` | `/api/cron/minifigs/poll-bricqer-orders` | UTC | default | Detect Bricqer minifig sales for removal queue |

### Daily — Overnight (00:00–06:00 UTC)

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| ~~vinted-cleanup~~ | ~~`0 0 * * *`~~ | ~~`/api/cron/vinted-cleanup`~~ | ~~UTC~~ | ~~default~~ | **DELETED** — Server-side scanner replaced by Chrome extension |
| ebay-pricing-sync | `0 2 * * *` | Cloud Function | UTC | 3600s | Cursor-based eBay pricing, up to 1,000 items/day (resumable) |
| email-purchases | `17 2 * * *` | `/api/cron/email-purchases` | UTC | default | Gmail scan for Vinted/eBay purchase confirmations, batch import |
| bricklink-pricing-sync | `30 2 * * *` | Cloud Function | UTC | 3600s | Cursor-based BrickLink pricing, up to 1,000 items/day (resumable) |
| ebay-fp-cleanup | `0 4 * * *` | `/api/cron/ebay-fp-cleanup` | UTC | default | False-positive detection with 22 weighted signals (threshold 50) |
| ebay-promotions | `0 5 * * *` | `/api/cron/ebay-promotions` | UTC | 300s | Apply promotion schedules: bid percentages based on listing age |
| investment-sync | `0 5 * * *` | `/api/cron/investment-sync` | UTC | default | ASIN linkage, auto-classification, price movement alerts |
| retirement-sync | `0 6 * * *` | `/api/cron/retirement-sync` | UTC | 300s | Sync retirement status from Brickset + Brick Tap (Google Sheet) |
| spapi-buybox-overlay | `0 6 * * *` | `/api/cron/spapi-buybox-overlay` | UTC | 300s | SP-API buy box data for ~232 in-stock ASINs (resumable with cursor) |
| minifig-daily-inventory | `0 6 * * *` | `/api/cron/minifigs/daily-inventory` | UTC | default | Crash recovery + inventory pull + order polling + repricing (Mon only) |

### Daily — Daytime (07:00+ UTC)

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| vercel-usage-report | `0 7 * * *` | `/api/cron/vercel-usage` | Europe/London | default | Vercel metrics, RAG status, email + Discord summary |
| vinted-collections | `0 8 * * *` | `/api/cron/vinted-collections` | Europe/London | default | Gmail parsing for Vinted collection-ready + Royal Mail pickup |
| ebay-listing-refresh | `0 19 * * *` | `/api/cron/ebay-listing-refresh` | Europe/London | 300s | End stale listings (90+ days), recreate with engagement-based pricing |
| cost-allocation | `15 21 * * *` | `/api/cron/cost-allocation` | Europe/London | 300s | Distribute purchase costs proportionally across items |

### Weekly

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| refresh-watchlist | `0 3 * * 0` | `/api/cron/refresh-watchlist` | UTC | default | Populate `arbitrage_watchlist` with newly sold items (Sunday 3am) |
| rebrickable-sync | `0 4 * * 0` | `/api/cron/rebrickable-sync` | UTC | default | Sync LEGO set data from Rebrickable (Sunday 4am) |
| ebay-category-audit | `0 7 * * 1` | `/api/cron/ebay-category-audit` | UTC | default | eBay category audit report (Monday 7am) |

### Monthly

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| investment-retrain | `0 6 1 * *` | `/api/cron/investment-retrain` | UTC | 300s | Retrain TensorFlow.js ML model on historical appreciation data |

### Non-HB

| Job Name | Schedule | Endpoint | TZ | Timeout | Description |
|----------|----------|----------|----|---------|-------------|
| verify-punditry-daily | daily | external | UTC | default | Football Prediction Game verification — cleanup candidate |

---

## GCP Cloud Run (1 Job)

### delivery-report-daily
- **Schedule:** 7am UK time daily
- **Pipeline:** 10-step (orders → tracking → report → email)
- **Output:** HTML email to chris@hadleybricks.co.uk
- **Steps:** Fetch recent orders → scrape Royal Mail tracking → build delivery status → generate HTML report → send email

---

## GCP Cloud Function (1)

### pricing-sync-driver
- **Runtime:** Gen2, Node.js 20, europe-west2
- **Entry point:** `pricingSyncDriver`
- **Trigger:** HTTP (authenticated via OIDC)
- **Timeout:** 3600s (1 hour)
- **Memory:** 256MB
- **Purpose:** Resumable retry driver — calls Vercel pricing endpoints in a loop until `{complete: true}`
- **Handles 3 jobs:** amazon-pricing, ebay-pricing, bricklink-pricing
- **Service account:** `hadley-scheduler-sa@gen-lang-client-0823893317.iam.gserviceaccount.com`

---

## Supabase pg_cron (1 Job)

### cleanup-stale-job-executions
- **Schedule:** `*/5 * * * *` (every 5 minutes)
- **Function:** `cleanup_stale_job_executions()`
- **Purpose:** Auto-mark jobs stuck in "running" for >10 minutes as "timeout"
- **History:** Fixed 195 zombie entries on 2026-03-11 (183 amazon-pricing, 2 spapi-buybox-overlay, 1 investment-retrain, 9 others)
- **Migration:** `supabase/migrations/20260311000001_job_execution_zombie_cleanup.sql`

---

## Peter Bot HB-Related Jobs (~8)

These run via APScheduler on the Peter Bot (WSL), timezone Europe/London.

| Job Name | Schedule | Description | Channel |
|----------|----------|-------------|---------|
| hb-full-sync-print | 09:35 daily | Triggers full-sync + pick list PDFs | #peterbot |
| daily-instagram-prep | 21:05 daily | Instagram content preparation | #peterbot |
| amazon-purchases | 09:30 daily | Personal Amazon order sync (CDP) | #peterbot |
| email-summary | 08:02 daily | Gmail summary (may surface HB emails) | #peterbot |
| schedule-today | 08:04 daily | Today's schedule (may include HB tasks) | #peterbot |
| incremental-seed | 01:00 daily | Second Brain import (includes HB email source) | #alerts |
| school-integration | 07:00 daily | School data sync (not HB but shared infra) | #alerts |
| octopus-energy | 10:00 daily | Energy usage sync (shared infra) | #energy |

### Previously Active, Now Removed
- Arbitrage FP Cleanup (6am daily) — removed from SCHEDULE.md
- HB Cron Health Check (7:30am daily) — removed
- HB Morning Sync (8am daily) — removed
- HB Afternoon Sync (2pm daily) — removed

---

## Notification Map

### Discord (Hadley Bricks Server)

| Channel | What Posts There |
|---------|-----------------|
| **#alerts** | Job failures, CAPTCHA blocks, cron errors, critical issues |
| **#opportunities** | Vinted/eBay arbitrage finds (colour-coded by COG%) |
| **#sync-status** | Sync started/complete, pricing updates, offer outcomes |
| **#daily-summary** | End-of-day summary reports |
| **#peter-chat** | Peter bot actionable notifications |

### Email (chris@hadleybricks.co.uk)

| Report | Frequency | Source |
|--------|-----------|--------|
| Delivery Report | Daily 7am | Cloud Run (delivery-report-daily) |
| eBay Listing Refresh Report | Daily 7pm | ebay-listing-refresh cron |
| Vercel Usage Report | Daily 7am | vercel-usage cron |
| Amazon Feed Failures | On failure | amazon-sync two-phase |

### WhatsApp (via Peter Bot / Evolution API)
- HB-related alerts routed through Peter Bot
- Group messages for daily briefings
- Chris-only for sports/financial alerts

### Pushover
- Configured but minimal use — school term date PDF change alerts

---

## Broken / Disabled Jobs

### 1. `markdown` cron route — NOT SCHEDULED
- **Route:** `apps/web/src/app/api/cron/markdown/route.ts`
- **Issue:** Route exists but NO GCP Cloud Scheduler job fires it
- **Impact:** Smart auto-markdown (evaluate LISTED items, generate proposals, auto-apply OVERPRICED markdowns) never runs
- **Fix:** Create GCP scheduler job, suggested schedule: daily 8pm UK

### 2. `minifigs/research-refresh` — DISABLED IN CODE
- **Route:** `apps/web/src/app/api/cron/minifigs/research-refresh/route.ts`
- **Issue:** Terapeak research requires local Playwright, not available on Vercel
- **Impact:** Minifig market research data goes stale
- **Fix:** No path on Vercel. Would need a local scheduled task or Cloud Run container with Playwright

### 3. Royal Mail Backfill — TASK NOT REGISTERED
- **Script:** `rm_backfill.py`
- **Issue:** Windows Task Scheduler task `HadleyBricks-RM-Backfill` is NOT registered. `register_task_scheduler.ps1` does NOT exist.
- **Impact:** RM tracking backfill doesn't run automatically
- **Fix:** Create PowerShell script to register Windows scheduled task, daily 6am

### 4. GCP README — STALE
- **File:** `gcp/README.md`
- **Issue:** Documents only original 17 jobs. Missing 11+ jobs added post-migration: full-sync, email-purchases, ebay-auctions, ebay-fp-cleanup, minifig-daily-inventory, minifig-poll-ebay-orders, minifig-poll-bricqer-orders, minifigs-reprice, spapi-buybox-refresh, ebay-category-audit, verify-punditry-daily
- **Fix:** Update README or replace with this audit as source of truth

---

## Optimisation Opportunities

### 1. 6am UTC Collision
**Problem:** Three jobs fire simultaneously at `0 6 * * *` UTC:
- `retirement-sync` (300s timeout, external API calls)
- `spapi-buybox-overlay` (300s timeout, ~232 ASINs)
- `minifig-daily-inventory` (inventory pull + repricing)

**Risk:** Vercel concurrent function limits, API rate limits, higher cold start latency.
**Fix:** Stagger by 10 minutes: retirement-sync at 06:00, spapi-buybox-overlay at 06:10, minifig-daily-inventory at 06:20.

### 2. 5am UTC Collision
**Problem:** `ebay-promotions` and `investment-sync` both fire at `0 5 * * *` UTC.
**Fix:** Move investment-sync to 05:15 UTC.

### 3. Consolidation Candidates
- **minifig-poll-ebay-orders** (every 15 min) and **minifig-poll-bricqer-orders** (every 30 min) could potentially be consolidated into minifig-daily-inventory if real-time detection isn't critical
- **spapi-buybox-refresh** (every 30 min) overlaps with **spapi-buybox-overlay** (daily full scan) — the refresh handles flagged items between daily runs, which is intentional

### 4. Non-HB Job Cleanup
- `verify-punditry-daily` is a Football Prediction Game job running in HB's GCP project
- Should be moved to a separate project or at minimum documented as non-HB

### 5. Cost Awareness
- GCP Cloud Scheduler: ~$0.40/month (3 free jobs, 25 at $0.10/month)
- Cloud Function: Free tier (well within limits)
- Cloud Run: Minimal cost for 1 daily job
- Vercel: Pro plan with 300s maxDuration — the real cost is here

---

## Automation Gaps

### Missing Jobs
1. **Markdown auto-pricer** — route exists, no scheduler job
2. **Minifigs/reprice** — route exists, unclear if scheduled (not in setup.ps1 or README)
3. **eBay listing refresh resume** — sub-route for interrupted refreshes, may need its own scheduler entry
4. **Stock count reconciliation** — no automated check that inventory counts match live listings

### Manual Tasks That Could Be Automated
1. **Bricqer inventory audit** — manual spot-check that Bricqer stock matches Supabase
2. **eBay returns processing** — currently handled manually
3. **Shopify product updates** — batch archive/create in full-sync, but new product creation is manual
4. **Purchase cost entry** — email-purchases handles Vinted/eBay, but BrickLink/other purchases entered manually
5. **Royal Mail backfill** — script ready, just needs task scheduler registration

---

## Manual Tasks Checklist

Daily human tasks that wrap around the automation:

- [ ] **Morning:** Check #alerts Discord for overnight failures
- [ ] **Morning:** Review pick list PDF (generated by hb-full-sync-print at 09:35)
- [ ] **Morning:** Check delivery report email (7am) for stuck parcels
- [ ] **Ongoing:** Process Vinted collection notifications (vinted-collections alerts)
- [ ] **Ongoing:** Accept/reject eBay negotiation offers flagged for review
- [ ] **Evening:** Review eBay listing refresh report email (7pm) for issues
- [ ] **Weekly:** Review eBay category audit report (Monday)
- [ ] **Weekly:** Check Vercel usage trends
- [ ] **Monthly:** Review investment retrain results (1st of month)
- [ ] **Ad-hoc:** Manually enter BrickLink/other platform purchases
- [ ] **Ad-hoc:** Process eBay returns and refunds
- [ ] **Ad-hoc:** Update Shopify product listings

---

## 24-Hour Schedule Overview (UTC)

```
00:00  ~~vinted-cleanup~~ (DELETED)
01:00  [Peter] incremental-seed
02:00  ebay-pricing-sync (resumable, up to 1hr)
02:17  email-purchases
02:30  bricklink-pricing-sync (resumable, up to 1hr)
03:00  refresh-watchlist (Sun only)
03:45  full-sync [1/6]
04:00  rebrickable-sync (Sun only), ebay-fp-cleanup
05:00  ebay-promotions, investment-sync
05:00  investment-retrain (1st of month only)
06:00  retirement-sync, spapi-buybox-overlay, minifig-daily-inventory ⚠️ COLLISION
07:00  vercel-usage-report (UK), ebay-category-audit (Mon), [Peter] school-integration
07:45  full-sync [2/6]
08:00  ebay-negotiation-sync [1/4], vinted-collections (UK)
08:02  [Peter] email-summary
08:04  [Peter] schedule-today
09:30  [Peter] amazon-purchases
09:35  [Peter] hb-full-sync-print
10:00  [Peter] octopus-energy
11:45  full-sync [3/6]
12:00  ebay-negotiation-sync [2/4]
15:45  full-sync [4/6]
16:00  ebay-negotiation-sync [3/4]
19:00  ebay-listing-refresh (UK)
19:45  full-sync [5/6]
20:00  ebay-negotiation-sync [4/4]
21:05  [Peter] daily-instagram-prep
21:15  cost-allocation (UK)
23:45  full-sync [6/6]

CONTINUOUS:
  */5   amazon-two-phase-sync
  */15  ebay-auction-sniper, minifig-poll-ebay-orders
  */30  amazon-pricing-sync (Cloud Function), spapi-buybox-refresh, minifig-poll-bricqer-orders
  */5   pg_cron: cleanup-stale-job-executions (Supabase)
```

---

## Appendix: Cron Route Inventory (32 routes)

All routes at `apps/web/src/app/api/cron/`:

| Route | Method | Has GCP Job | Notes |
|-------|--------|-------------|-------|
| amazon-pricing | POST | Yes (via Cloud Function) | Budget-spread, resumable |
| amazon-sync | POST | Yes | Two-phase feed processor |
| bricklink-pricing | POST | Yes (via Cloud Function) | Cursor-based, resumable |
| cost-allocation | POST | Yes | Proportional cost distribution |
| ebay-auctions | POST | Yes | Auction sniper |
| ebay-category-audit | POST | Yes | Weekly Monday audit |
| ebay-fp-cleanup | POST | Yes | False positive detection |
| ebay-listing-refresh | POST | Yes | Stale listing refresh |
| ebay-listing-refresh/reprice | POST | Sub-route | Called by parent |
| ebay-listing-refresh/resume | POST | Sub-route | Called by parent |
| ebay-pricing | POST | Yes (via Cloud Function) | Cursor-based, resumable |
| ebay-promotions | POST | Yes | Promotion schedules |
| email-purchases | POST | Yes | Gmail purchase import |
| full-sync | POST | Yes | 6x daily platform sync |
| investment-retrain | POST | Yes | Monthly ML retrain |
| investment-sync | POST | Yes | Daily classification |
| **markdown** | **POST** | **NO** | **Not scheduled** |
| minifigs/daily-inventory | POST | Yes | Daily inventory + repricing |
| minifigs/poll-bricqer-orders | POST | Yes | Bricqer sale detection |
| minifigs/poll-ebay-orders | POST | Yes | eBay sale detection |
| minifigs/reprice | POST | Unclear | May be called by daily-inventory |
| **minifigs/research-refresh** | **GET** | **N/A** | **Disabled in code** |
| negotiation | POST | Yes | eBay automated offers |
| rebrickable-sync | POST | Yes | Weekly set data sync |
| refresh-watchlist | POST | Yes | Weekly arbitrage watchlist |
| retirement-sync | POST | Yes | Daily retirement status |
| spapi-buybox-overlay | POST | Yes | Daily buy box full scan |
| spapi-buybox-refresh | POST | Yes | Flagged ASIN refresh |
| vercel-usage | POST | Yes | Daily usage report |
| ~~vinted-cleanup~~ | ~~POST~~ | **DELETED** | Server-side scanner removed, Chrome extension in use |
| vinted-collections | POST | Yes | Collection notifications |

---

*Source: GCP Cloud Scheduler, `gcp/setup.ps1`, `gcp/README.md`, Peter Bot SCHEDULE.md, codebase route analysis*
*Last verified: 2026-03-18*
