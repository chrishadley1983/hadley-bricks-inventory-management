# Keepa API Integration - Research Report

**Date:** 2026-02-07
**Status:** Research Complete - Awaiting Approval

---

## Executive Summary

The Hadley Bricks app currently relies on Amazon's SP-API for pricing data (buy box, was price, sales rank, offer counts). This works but has severe rate limiting (0.033 req/sec for competitive summary = ~33 ASINs/hour) and provides only point-in-time snapshots with no historical depth.

Keepa offers a transformative upgrade: **14+ years of historical pricing**, **34 price types**, **sales velocity data**, and **real-time webhooks** - all at a fraction of the rate-limit pain. At EUR 49/month (Basic plan, 1,200 lookups/hour), it would replace the slowest parts of the current pipeline and unlock features that are currently impossible.

---

## Part 1: Current Amazon Data Usage

### Where Buy Box & Was Price Are Used Today

| System | Data Used | Source | Pain Points |
|--------|-----------|--------|-------------|
| **Arbitrage Table** | `buy_box_price`, `was_price_90d`, `sales_rank`, `offer_count` | SP-API daily cron | Stale within hours; buy box changes intra-day |
| **Vinted Scanner** | `buy_box_price` (real-time fetch) | SP-API on-demand | 0.033 req/sec bottleneck; can't batch |
| **Purchase Evaluator** | `amazonBuyBoxPrice`, `amazonWasPrice`, `amazonSalesRank`, `amazonOfferCount` | SP-API via evaluator service | Slow lookups delay purchase decisions |
| **COG% Calculations** | `effective_amazon_price` = COALESCE(buy_box_price, lowest_offer_price) | `arbitrage_current_view` | No historical context for "is this a good price?" |
| **eBay FP Detector** | COG% thresholds (<5%, <10%, <15%) | Derived from Amazon price | Static thresholds; no seasonal awareness |
| **Repricing Service** | `buy_box_price`, `lowest_offer_price` | SP-API with 3-hour cache | Cache too aggressive for competitive categories |
| **Investment Model** | `price_snapshots` table (EMPTY) | Planned: Keepa | Phase 3 blocked - no historical data |
| **Amazon Offers Modal** | `was_price_90d`, all offers, FBA/FBM status | SP-API competitive summary | Slowest API (30s/request); often stale |

### Current Database Tables Storing Amazon Data

| Table | Key Columns | Populated | Refresh |
|-------|-------------|-----------|---------|
| `amazon_arbitrage_pricing` | buy_box_price, was_price_90d, sales_rank, offers_json | Yes (~365 rows/ASIN/yr) | Daily cron |
| `tracked_asins` | asin, sku, price (fallback), quantity | Yes (~1,500 ASINs) | Daily from merchant report |
| `price_snapshots` | price_gbp, date, source | **EMPTY** | Not implemented |
| `investment_historical` | rrp_gbp, appreciation values | **EMPTY** | Not implemented |
| `investment_predictions` | investment_score, predicted prices | **EMPTY** | Not implemented |

### Current Rate Limit Constraints

| SP-API Endpoint | Rate | Impact |
|-----------------|------|--------|
| Competitive Pricing (v0) | 0.5 req/sec | 10 ASINs/batch, 2s delay = reasonable |
| Competitive Summary (v2022) | 0.033 req/sec | 20 ASINs/batch, **35s delay** = 33 ASINs/hour |
| Featured Offer Expected Price | Requires special roles | Not available to most sellers |

The competitive summary API (which provides was_price and detailed offers) is the critical bottleneck. A full sync of 1,500 ASINs takes **~45 hours** at current rates, requiring the resumable cursor-based cron pattern already implemented.

---

## Part 2: What Keepa Provides

### 34 Price Types (vs SP-API's ~5)

| Index | Type | Currently Available via SP-API? | Value to Hadley Bricks |
|-------|------|--------------------------------|----------------------|
| 0 | Amazon's own price | Partially (via buy box) | **HIGH** - Know when Amazon is selling directly |
| 1 | Lowest 3rd party new | Yes (lowest_offer_price) | HIGH - Already tracked |
| 2 | Lowest used price | No | MEDIUM - Used market comparison |
| 3 | Sales rank history | Yes (point-in-time only) | **CRITICAL** - Trend analysis unlocked |
| 4 | **List price / "was" price** | Yes (was_price_90d) | **CRITICAL** - Historical RRP tracking |
| 7 | New FBM price + shipping | No | HIGH - FBM competitive analysis |
| 10 | **New FBA price** | No | **HIGH** - FBA vs FBM split pricing |
| 11 | Count of new offers | Yes (offer_count) | HIGH - Competition tracking |
| 18 | **Buy box price (incl. shipping)** | Yes (buy_box_price) | **CRITICAL** - Core pricing reference |
| 28 | **eBay new price + shipping** | Separate eBay sync | **HIGH** - Cross-platform in one call |
| 29 | eBay used price + shipping | No | MEDIUM - Used market |

### Data Keepa Has That SP-API Doesn't

| Data Point | Description | Impact |
|------------|-------------|--------|
| **Price history (14+ years)** | Full time-series for all 34 price types | Unlocks investment predictions, trend analysis, seasonal patterns |
| **Sales rank drops (30/90/180/365d)** | Count of rank improvements = proxy for units sold | Better demand estimation than point-in-time rank |
| **`monthlySold`** | Estimated units sold per month | Direct sales velocity - currently impossible to get |
| **Buy box seller history** | Who won the buy box and when | Competitive intelligence - how stable is your buy box? |
| **`isLowest` / `isLowest90`** | Is current price the all-time/90-day low? | Instant "good time to buy" signal |
| **30/90/180/365-day averages** | Pre-calculated weighted means | No computation needed - instant trend context |
| **Min/max in interval** | Lowest and highest price in any period | "What's the realistic price range for this set?" |
| **FBA fees data** | Storage, pick/pack fees per ASIN | Accurate profit calculations (vs hardcoded 18.36%) |
| **Coupon & promotion history** | Current and historical coupons | Know when competitors are running promotions |
| **Referral fee percentage** | Actual Amazon fee per category | Replace hardcoded AMAZON_FEE_RATE = 0.1836 |
| **Stock levels** | `stockAmazon`, `stockBuyBox` | Anticipate stock-outs and price spikes |
| **EAN/UPC lookup** | Find ASIN from barcode | Faster ASIN discovery for new inventory |

### Keepa vs SP-API Comparison

| Aspect | SP-API (Current) | Keepa |
|--------|-------------------|-------|
| Rate limit | 0.033-0.5 req/sec | 20 tokens/min = 1,200 ASINs/hour |
| Batch size | 20 ASINs | 100 ASINs |
| Historical data | None (point-in-time only) | 14+ years |
| Sales velocity | Sales rank (meaningless alone) | `monthlySold` + rank drops |
| Price types | ~5 (buy box, lowest, was price) | 34 types |
| Buy box history | Current winner only | Full winner history with timestamps |
| FBA/FBM split | Limited | Full breakdown |
| Cross-platform | Amazon only | Amazon + eBay pricing |
| Webhooks | No | Yes - price alerts, stock changes |
| Cost | Free (SP-API) | EUR 49/month (Basic) |
| Freshness control | Take what you get | `update` parameter (force refresh) |
| Pre-calculated stats | None | 30/90/180/365-day avg, min, max |

---

## Part 3: Opportunity Analysis

### Opportunity 1: Replace SP-API Competitive Summary (HIGH PRIORITY)

**Problem:** The competitive summary API (was_price, detailed offers) runs at 0.033 req/sec. A full sync of 1,500 ASINs takes ~45 hours. The resumable cron pattern was built specifically to work around this.

**Keepa Solution:** Batch 100 ASINs per request at 20 tokens/min. Full sync of 1,500 ASINs = 15 requests = **under 1 minute**. Include `stats=180` for free pre-calculated averages.

**Impact:**
- Daily pricing sync drops from 45 hours to <2 minutes
- Remove the complex cursor-based resumable sync pattern
- Get richer data (history, averages, trends) in the same call
- Free up SP-API quota for real-time operations

**Effort:** Medium (replace `amazon-pricing.client.ts` data source, keep same database schema)

---

### Opportunity 2: Populate Investment Model Historical Data (HIGH PRIORITY)

**Problem:** `price_snapshots`, `investment_historical`, and `investment_predictions` tables are all EMPTY. Phase 3 of the investment model is completely blocked because there's no historical pricing data.

**Keepa Solution:** For any ASIN, request `days=1825` (5 years) of history. Keepa returns the full time-series. Backfill `price_snapshots` with one API call per set. For 1,500 tracked ASINs = 15 batch requests = **~1 minute**.

**Impact:**
- Unblocks Phase 3-4 of the investment model entirely
- Enables ML prediction training with real historical data
- "What did this set cost 1/3/5 years ago?" answerable instantly
- Theme performance metrics calculable from real data

**Effort:** Medium (Keepa client + backfill script + investment model Phase 3 can proceed)

---

### Opportunity 3: Real-Time Buy Box Intelligence (MEDIUM PRIORITY)

**Problem:** Buy box data is refreshed daily. In competitive categories, buy box ownership changes hourly. The repricing service uses a 3-hour cache which may be too stale.

**Keepa Solution:** Use Keepa tracking API with webhooks. Set price thresholds on your ASINs. When the buy box price changes, Keepa POSTs to your webhook endpoint. React in near-real-time.

**Impact:**
- Know within minutes when you lose/win the buy box
- Automated repricing triggers (not just daily batch)
- Competitive response time drops from 24 hours to minutes
- Discord alerts for buy box changes

**Effort:** Medium-High (new webhook endpoint, tracking management, repricing integration)

---

### Opportunity 4: Sales Velocity for Purchase Decisions (HIGH PRIORITY)

**Problem:** The Vinted scanner calculates COG% but doesn't consider demand. A set with 40% COG and 500 sales/month is far better than 30% COG with 2 sales/month. Currently, `sales_rank` is displayed but it's a meaningless number without context.

**Keepa Solution:** `monthlySold` gives estimated monthly units sold. `salesRankDrops30/90` gives sales velocity trends. Both are included in the standard product response.

**Impact:**
- Add "Monthly Sales" column to arbitrage table
- Weight COG% by demand: `Adjusted Score = COG% × (1 - demand_factor)`
- Filter out dead stock from Vinted opportunities
- Investment model can use actual demand data

**Effort:** Low-Medium (add fields to database, update arbitrage view, display in UI)

---

### Opportunity 5: Accurate Fee Calculations (MEDIUM PRIORITY)

**Problem:** Amazon fee rate is hardcoded at 18.36% (`AMAZON_FEE_RATE = 0.1836`). Actual referral fees range from 8% to 45% depending on category. This means profit calculations are wrong for many sets.

**Keepa Solution:** `referralFeePercentage` is returned per product. `fbaFees` includes storage and fulfillment costs. Use actual fees instead of a flat rate.

**Impact:**
- Accurate profit calculations for every ASIN
- COG% thresholds become more meaningful
- Investment ROI predictions improve significantly
- Could reveal currently-hidden profitable opportunities (low-fee categories)

**Effort:** Low (store fee data, update `arbitrage-calculations.ts` to use per-ASIN fee)

---

### Opportunity 6: "Good Time to Buy" Signals (MEDIUM PRIORITY)

**Problem:** When the Vinted scanner finds a set, there's no context for "is the Amazon price currently high or low?" A set at £50 Amazon might be a steal if it's usually £70, or a trap if it's usually £40.

**Keepa Solution:** `isLowest` (all-time low), `isLowest90` (90-day low), plus `avg90`, `avg180`, `avg365` give instant context. `min[interval]` and `max[interval]` show the realistic range.

**Impact:**
- Add "Price Context" badge to arbitrage items: "Near All-Time Low", "Above 90d Average", etc.
- Better purchase timing decisions
- Avoid buying when Amazon price is temporarily inflated
- Investment model gets price volatility data

**Effort:** Low (store stats, add badges to UI)

---

### Opportunity 7: EAN/UPC-Based ASIN Discovery (LOW PRIORITY)

**Problem:** Mapping LEGO set numbers to ASINs currently relies on `seeded_asins` table and manual discovery. New sets need manual ASIN lookup.

**Keepa Solution:** Look up by EAN barcode (LEGO EANs are well-known: 5702016XXXXXX pattern). Keepa returns the ASIN, all cross-references, and full product data.

**Impact:**
- Automated ASIN discovery for new inventory
- Reduce manual data entry
- Catch ASIN changes (Amazon sometimes changes ASINs)

**Effort:** Low (add EAN lookup to discovery pipeline)

---

### Opportunity 8: eBay Cross-Platform Pricing (LOW PRIORITY)

**Problem:** eBay pricing is currently fetched via a separate eBay Browse API cron job. This is another API to maintain and rate-limit around.

**Keepa Solution:** CsvType 28 (`EBAY_NEW_SHIPPING`) and 29 (`EBAY_USED_SHIPPING`) provide eBay pricing in the same Keepa product response. One API call = Amazon + eBay pricing together.

**Impact:**
- Potentially eliminate the eBay pricing cron entirely
- Single source of truth for cross-platform comparison
- Historical eBay pricing (not just today's snapshot)

**Caveat:** Need to verify Keepa's eBay data coverage for UK LEGO specifically. May not match the eBay Browse API's specificity for condition filtering.

**Effort:** Low-Medium (validate data quality, update eBay pricing pipeline)

---

### Opportunity 9: Stock-Out Prediction for Retirement Investing (MEDIUM PRIORITY)

**Problem:** The investment model tracks `retirement_status` but can't predict when Amazon will run out of stock. The biggest price jumps happen at stock-out.

**Keepa Solution:** `stockAmazon` shows Amazon's current stock level. Track this over time to predict stock-out dates. Combine with `monthlySold` for depletion rate calculation.

**Impact:**
- "Amazon has ~50 units left, selling 30/month = stock-out in ~7 weeks"
- Trigger purchase recommendations before retirement price spike
- Investment timing becomes data-driven, not guesswork

**Effort:** Medium (new tracking, depletion rate calculation, alert system)

---

### Opportunity 10: Webhook-Driven Alerts (MEDIUM PRIORITY)

**Problem:** The daily summary Discord channel (`DISCORD_WEBHOOK_DAILY_SUMMARY`) only fires from the Vinted cleanup cron. There's no mechanism for price-change alerts on tracked inventory.

**Keepa Solution:** Keepa tracking API supports webhooks. Set thresholds on your ASINs and get HTTP POST notifications for:
- Buy box price drops (buying opportunity)
- Buy box price increases (good time to list)
- Stock-outs (retirement investing trigger)
- Competitor entering/leaving

**Impact:**
- Real-time Discord alerts for pricing events
- Proactive rather than reactive inventory management
- Populate the empty `daily-summary` channel with useful data
- Reduce manual price monitoring

**Effort:** Medium (webhook endpoint, tracking management, Discord routing)

---

## Part 4: Prioritised Implementation Plan

### Phase 1: Foundation (Week 1-2) - EUR 49/month

**Goal:** Replace SP-API's slowest endpoint with Keepa, populate historical data.

| Task | Description | Effort |
|------|-------------|--------|
| 1.1 | Create Keepa API client (`/lib/keepa/keepa.client.ts`) | 1 day |
| 1.2 | Add `KEEPA_API_KEY` env var, Basic plan subscription | 30 min |
| 1.3 | Replace daily pricing cron data source (SP-API competitive summary → Keepa batch) | 2 days |
| 1.4 | Extend `amazon_arbitrage_pricing` with new columns: `avg_90d`, `avg_180d`, `is_lowest_90d`, `monthly_sold`, `sales_rank_drops_30d`, `referral_fee_pct` | 1 day |
| 1.5 | Backfill `price_snapshots` table from Keepa historical data (1,500 ASINs) | 1 day |
| 1.6 | Update `arbitrage-calculations.ts` to use per-ASIN `referral_fee_pct` instead of hardcoded 0.1836 | 0.5 day |

**Outcome:** Daily sync drops from 45 hours to <2 minutes. Historical data populated. Accurate fee calculations.

### Phase 2: Intelligence Layer (Week 3-4)

**Goal:** Add demand data and price context to the arbitrage workflow.

| Task | Description | Effort |
|------|-------------|--------|
| 2.1 | Add `monthly_sold`, `sales_rank_drops_30d` to arbitrage table UI | 1 day |
| 2.2 | Add "Price Context" badges: "All-Time Low", "Below 90d Avg", "Above 180d Avg" | 1 day |
| 2.3 | Update Vinted COG% scoring to weight by demand (`monthlySold`) | 1 day |
| 2.4 | Add buy box stability indicator (from `buyBoxSellerIdHistory`) | 1 day |
| 2.5 | Unblock Investment Model Phase 3 (historical data now available) | Ongoing |

**Outcome:** Purchase decisions informed by demand + price context. Investment model can proceed.

### Phase 3: Real-Time Alerts (Week 5-6)

**Goal:** Proactive notifications via Keepa webhooks.

| Task | Description | Effort |
|------|-------------|--------|
| 3.1 | Create webhook endpoint (`/api/webhooks/keepa`) | 1 day |
| 3.2 | Implement Keepa tracking management (add/remove ASINs from tracking) | 2 days |
| 3.3 | Route webhook events to Discord channels (buy box changes → alerts, price drops → opportunities) | 1 day |
| 3.4 | Add stock-out tracking for retirement candidates | 1 day |
| 3.5 | Build depletion rate calculator (`stockAmazon / monthlySold = weeks_remaining`) | 1 day |

**Outcome:** Real-time price alerts. Stock-out predictions for investment timing. Active Discord daily-summary channel.

### Phase 4: Optimisation (Week 7-8)

**Goal:** Reduce complexity, improve accuracy.

| Task | Description | Effort |
|------|-------------|--------|
| 4.1 | Evaluate replacing eBay pricing cron with Keepa eBay data (CsvType 28/29) | 1 day |
| 4.2 | Add EAN-based ASIN discovery to inventory pipeline | 1 day |
| 4.3 | Remove SP-API competitive summary dependency entirely (keep v0 for real-time operations only) | 1 day |
| 4.4 | Build seasonal pricing pattern detection from Keepa historical data | 2 days |

**Outcome:** Simplified architecture. Single pricing data source. Seasonal intelligence.

---

## Part 5: Cost Analysis

### Keepa API Plans

| Plan | Tokens/Min | Monthly Cost | ASINs/Hour | Fits Hadley Bricks? |
|------|-----------|-------------|------------|---------------------|
| **Basic** | 20 | **EUR 49 (~£42)** | 1,200 | **Yes** - 1,500 ASINs synced in <2 min |
| Standard | 60 | EUR 129 (~£110) | 3,600 | Overkill unless scaling significantly |

### Token Budget (Basic Plan: 20 tokens/min)

| Operation | Frequency | Tokens/Run | Monthly Tokens |
|-----------|-----------|------------|----------------|
| Daily full sync (1,500 ASINs, batches of 100) | Daily | 1,500 | 45,000 |
| Vinted scanner ASIN lookups (~200/day) | Daily | 200 | 6,000 |
| On-demand lookups (purchase evaluator) | ~50/day | 50 | 1,500 |
| New ASIN discovery (EAN lookups) | ~20/week | 80 | 320 |
| **Total monthly** | | | **~53,000** |
| **Budget available** (20/min × 60 × 24 × 30) | | | **864,000** |

Usage is ~6% of the Basic plan capacity. Plenty of headroom.

### ROI Justification

| Benefit | Value |
|---------|-------|
| Daily sync time savings | 45 hours → 2 minutes |
| Accurate fee calculations | Eliminates profit calculation errors (8-45% variance) |
| Sales velocity data | Avoid buying dead stock (estimated 5-10 bad purchases/month saved) |
| Historical data for investment model | Unlocks Phase 3-4 (predicted ROI on LEGO investing) |
| Buy box alerts | Faster repricing response = more buy box ownership |
| Stock-out predictions | Earlier investment entry = higher returns |

At £42/month, a single avoided bad purchase or one additional buy box win likely pays for the subscription.

---

## Part 6: Technical Architecture

### Proposed New Files

```
apps/web/src/
├── lib/
│   └── keepa/
│       ├── keepa.client.ts          # API client (batch product, tracking, search)
│       ├── keepa.types.ts           # TypeScript types for Keepa responses
│       ├── keepa-sync.service.ts    # Daily sync orchestration
│       ├── keepa-time.utils.ts      # Keepa timestamp conversion utilities
│       └── keepa-tracking.service.ts # Webhook tracking management
├── app/api/
│   ├── webhooks/
│   │   └── keepa/route.ts           # Webhook receiver endpoint
│   └── cron/
│       └── keepa-sync/route.ts      # Daily sync cron (replaces amazon-pricing complexity)
```

### Database Changes

```sql
-- Extend amazon_arbitrage_pricing
ALTER TABLE amazon_arbitrage_pricing ADD COLUMN
  avg_90d DECIMAL(10,2),
  avg_180d DECIMAL(10,2),
  avg_365d DECIMAL(10,2),
  is_lowest_90d BOOLEAN DEFAULT false,
  is_all_time_low BOOLEAN DEFAULT false,
  monthly_sold INTEGER,
  sales_rank_drops_30d INTEGER,
  sales_rank_drops_90d INTEGER,
  referral_fee_pct DECIMAL(5,2),
  fba_fee DECIMAL(10,2),
  amazon_stock_level INTEGER,
  buy_box_seller_id VARCHAR(50),
  new_fba_price DECIMAL(10,2),
  new_fbm_price DECIMAL(10,2),
  data_source VARCHAR(10) DEFAULT 'sp-api'; -- 'sp-api' or 'keepa'

-- Populate price_snapshots from Keepa historical data
-- (table already exists, just needs data)
```

### Migration Path

1. **Parallel operation first:** Run Keepa alongside SP-API for 1 week, compare data
2. **Switch daily cron:** Point `amazon-pricing` cron to Keepa client
3. **Keep SP-API for real-time:** Use SP-API for immediate buy box checks (Vinted scanner)
4. **Gradually retire SP-API pricing:** Once Keepa tracking webhooks handle real-time needs

---

## Summary: Top 5 Quick Wins

| # | Opportunity | Impact | Effort | Monthly Value |
|---|-------------|--------|--------|---------------|
| 1 | Replace daily pricing sync (SP-API → Keepa) | 45hr → 2min, richer data | Medium | Infrastructure unlock |
| 2 | Populate investment historical data | Unblocks Phase 3-4 | Medium | Investment decisions |
| 3 | Add `monthlySold` to arbitrage scoring | Avoid dead stock purchases | Low | ~£50-100 saved/month |
| 4 | Accurate per-ASIN fee calculations | Fix profit calculation errors | Low | Accuracy improvement |
| 5 | Price context badges ("All-Time Low" etc.) | Better purchase timing | Low | Better buy decisions |

**Recommended next step:** Subscribe to Keepa Basic (EUR 49/month), run `/define-done keepa-integration` to create machine-verifiable criteria, then `/build-feature keepa-integration` for autonomous implementation.
