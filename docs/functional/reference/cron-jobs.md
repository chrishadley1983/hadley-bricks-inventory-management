# Cron Jobs Reference

## Overview
26 automated cron job endpoints that form the operational backbone of Hadley Bricks. All jobs verify a `CRON_SECRET` header and log execution history via `jobExecutionService`.

## Authentication
All cron routes require `Authorization: Bearer {CRON_SECRET}` header. Vercel Cloud Scheduler adds this automatically.

## Job Catalogue

### Arbitrage & Pricing Syncs

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/amazon-pricing` | POST | Every 30 min | Keepa API pricing sync. ~57 ASINs per call, budget-spread strategy prioritising in-stock items |
| `/api/cron/bricklink-pricing` | POST | Daily 2:30am UTC | BrickLink pricing sync. Cursor-based, up to 1,000 items/day |
| `/api/cron/ebay-pricing` | POST | Daily 2am UTC | eBay pricing sync. Cursor-based, up to 1,000 items/day |
| `/api/cron/ebay-fp-cleanup` | POST | Daily 4am UTC | eBay false-positive detection. 22 weighted signals (threshold 50) |
| `/api/cron/spapi-buybox-overlay` | POST | Daily 6am UTC | SP-API buy box data for ~232 in-stock ASINs. Resumable with cursor |
| `/api/cron/spapi-buybox-refresh` | POST | Every 30 min | Lightweight refresh for ASINs flagged with `spapi_refresh_needed=true` |
| `/api/cron/refresh-watchlist` | POST | Weekly | Populate `arbitrage_watchlist` with newly sold items |

### Amazon Sync

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/amazon-sync` | POST | Every 1-2 min | Two-phase feed processor (price → quantity). Manages 6 intermediate states |

### Investment & Retirement

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/investment-retrain` | POST | Monthly | Retrain TensorFlow.js ML model on historical appreciation data |
| `/api/cron/investment-sync` | POST | After pricing cron | ASIN linkage, auto-classification, price movement alerts |
| `/api/cron/retirement-sync` | POST | Daily 6am UTC | Sync retirement status from Brickset + Brick Tap (Google Sheet) |

### Full Platform Sync

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/full-sync` | POST | 6x daily (every 4h) | Comprehensive platform sync: eBay, Amazon, BrickLink, Brick Owl orders; ASIN tracking; stuck job detection; Shopify batch; Discord status report |

### Purchase & Email Processing

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/email-purchases` | POST | Daily 2:17am UTC | Scan Gmail for Vinted/eBay purchase confirmations, enrich with Brickset/ASIN/Amazon pricing, batch-import |
| `/api/cron/vinted-collections` | POST | Daily 8am UTC | Parse Gmail for Vinted collection-ready + Royal Mail pickup emails, post Discord notifications |

### eBay Features

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/ebay-auctions` | POST | Every 15 min | Auction Sniper: find LEGO auctions ending soon with arbitrage potential, send Discord alerts |
| `/api/cron/negotiation` | POST | Every 4h (8/12/16/20 UK) | Automated eBay negotiation: sync offer statuses, send new offers to eligible listings |
| `/api/cron/ebay-promotions` | POST | Daily 5am UTC | Apply promotion schedules: add/update/remove bid percentages based on listing age |

### Marketplace Maintenance

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/vinted-cleanup` | POST | Daily midnight UTC | Expire old opportunities (>7d), delete old scan logs (>30d), delete dismissed/expired (>14d) |

### Minifigs

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/minifigs/daily-inventory` | POST | Daily | Crash recovery, inventory pull, order polling, research refresh, repricing (Mondays) |
| `/api/cron/minifigs/poll-bricqer-orders` | POST | Periodic | Detect Bricqer sales for removal queue |
| `/api/cron/minifigs/poll-ebay-orders` | POST | Periodic | Detect eBay sales for removal queue |
| `/api/cron/minifigs/reprice` | POST | Periodic | Reprice stale minifig listings |
| `/api/cron/minifigs/research-refresh` | GET | **DISABLED** | Terapeak research (requires local Playwright). Returns 0 items |

### Data Synchronisation

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/rebrickable-sync` | POST | Weekly Sun 3am UTC | Sync LEGO set data from Rebrickable. Inserts new sets, updates without overwriting Brickset fields |
| `/api/cron/cost-allocation` | POST | Daily 9:15pm UK | Distribute purchase costs proportionally across linked inventory items and BrickLink uploads |
| `/api/cron/markdown` | POST | Daily | Smart auto-markdown: evaluate LISTED items, generate proposals, auto-apply OVERPRICED markdowns |

### Monitoring

| Endpoint | Method | Schedule | Purpose |
|----------|--------|----------|---------|
| `/api/cron/vercel-usage` | POST | Daily 7am UK | Fetch Vercel metrics, calculate RAG status, email report, Discord summary |

## Resumable Patterns

Two patterns used for long-running jobs:

### Budget-Spread
Used by: `amazon-pricing`, `spapi-buybox-overlay`
- Fixed item count per call
- Cursor tracked in `cron_progress` table
- Returns `{complete: true}` when finished so GCP driver knows when to stop

### Cursor-Based
Used by: `ebay-pricing`, `bricklink-pricing`
- Daily limit with cursor tracking
- Resumable across multiple invocations in same day

## Error Handling
- All jobs wrapped in try-catch with Discord notifications for critical failures
- Graceful degradation: individual source failures don't block other sources (e.g., retirement-sync)
- Job execution service posts to #alerts Discord webhook on any failure

---
*Generated: 2026-03-13*
*Source files: 26 API routes*
