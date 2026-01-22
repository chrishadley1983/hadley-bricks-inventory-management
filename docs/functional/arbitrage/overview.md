# Feature: Arbitrage Tracker

> **Category:** Analysis & Sourcing
> **Primary Entry Point:** `/arbitrage/amazon`, `/arbitrage/ebay`, `/arbitrage/seeded`, `/arbitrage/vinted`
> **Complexity:** High

## Overview

The Arbitrage Tracker is a sophisticated price comparison system that helps identify profitable buying opportunities by comparing your Amazon selling prices against BrickLink, eBay, and Vinted sourcing prices. It tracks ASINs from your Amazon inventory, maps them to BrickLink set numbers, and calculates potential profit margins.

**Key Value Proposition:**
- Find sets selling on Amazon for more than they can be sourced on BrickLink, eBay, or Vinted
- Track your Amazon inventory alongside "seeded" ASINs from the Brickset database
- Scan Vinted listings in real-time to identify immediate buying opportunities
- Calculate accurate profit margins accounting for Amazon fees (18.36% effective rate)
- Manage ASIN-to-BrickLink mappings with automated and manual matching

## Data Model

### Core Entities

```
┌────────────────────┐     ┌────────────────────────┐     ┌────────────────────────┐
│   tracked_asins    │     │  asin_bricklink_mapping│     │ amazon_arbitrage_pricing│
├────────────────────┤     ├────────────────────────┤     ├────────────────────────┤
│ asin (PK)          │────▶│ asin (PK)              │     │ id (PK)                │
│ user_id            │     │ user_id                │     │ user_id                │
│ source             │     │ bricklink_set_number   │     │ asin                   │
│ status             │     │ match_confidence       │     │ snapshot_date          │
│ name               │     │ match_method           │     │ your_price             │
│ image_url          │     │ verified_at            │     │ your_qty               │
│ sku                │     └────────────────────────┘     │ buy_box_price          │
│ excluded_at        │                                     │ lowest_offer_price     │
│ exclusion_reason   │     ┌────────────────────────┐     │ sales_rank             │
└────────────────────┘     │bricklink_arbitrage_    │     │ offers_json            │
                           │        pricing         │     └────────────────────────┘
┌────────────────────┐     ├────────────────────────┤
│   seeded_asins     │     │ id (PK)                │     ┌────────────────────────┐
├────────────────────┤     │ user_id                │     │  ebay_arbitrage_pricing│
│ id (PK)            │     │ bricklink_set_number   │     ├────────────────────────┤
│ brickset_set_id    │     │ snapshot_date          │     │ id (PK)                │
│ asin               │     │ condition (N/U)        │     │ user_id                │
│ discovery_status   │     │ country_code           │     │ bricklink_set_number   │
│ match_method       │     │ min_price              │     │ snapshot_date          │
│ match_confidence   │     │ avg_price              │     │ min_price              │
│ amazon_title       │     │ total_lots             │     │ avg_price              │
│ alternative_asins  │     │ price_detail_json      │     │ listings_json          │
└────────────────────┘     └────────────────────────┘     └────────────────────────┘
```

### ASIN Sources

| Source | Description |
|--------|-------------|
| `inventory` | Discovered from your Amazon inventory via SP-API |
| `seeded` | Pre-populated from Brickset database |
| `manual` | Manually added by user |
| `discovery` | Found via automated discovery process |

### ASIN Statuses

| Status | Description |
|--------|-------------|
| `active` | Actively tracked, included in sync |
| `excluded` | Excluded from tracking by user |
| `pending_review` | Needs manual review (multiple matches) |

### Match Confidence Levels

| Level | Confidence | Method |
|-------|------------|--------|
| Exact | 100% | EAN barcode lookup |
| High | 95% | UPC barcode lookup |
| Good | 85% | Exact set number in title |
| Fair | 60-80% | Fuzzy title matching |
| Manual | User | User manually verified |

---

## Arbitrage Calculation

### Margin Calculation (BrickLink)

```
Margin % = (Amazon Price - BrickLink Min Price) / Amazon Price × 100
```

Where:
- Amazon Price = Your Price (if listed) or Buy Box Price or Lowest Offer Price
- BrickLink Min Price = Minimum "New" condition price from UK sellers

### Margin Calculation (eBay)

```
Margin % = (Amazon Price - eBay Min Price) / Amazon Price × 100
```

Where:
- eBay Min Price = Total price (item + shipping) of cheapest eBay listing

### COG% Calculation (Vinted)

Cost of Goods percentage (COG%) is the inverse metric used for Vinted arbitrage:

```
COG% = (Vinted Price + £2.30 shipping) / Amazon Buy Box Price × 100
```

Where:
- Vinted Price = Listed item price
- £2.30 = Standard Vinted shipping cost
- Amazon Buy Box Price = Current Buy Box price (or RRP if unavailable)

**COG% Interpretation:**

| COG% | Rating | Description |
|------|--------|-------------|
| < 30% | Excellent | Very high profit potential |
| 30-40% | Good | Target zone for purchases |
| 40-50% | Marginal | Limited profit after fees |
| 50-60% | Poor | Minimal or no profit |
| > 60% | Not Viable | Would result in a loss |

At 40% COG, approximately 30% profit remains after Amazon FBM fees (~18%) and customer shipping (~12%).

### Amazon FBM Profit Calculation

For UK non-VAT registered sellers (2026 rates):

| Component | Rate | Formula |
|-----------|------|---------|
| Referral Fee | 15% | Sale Price × 0.15 |
| DST Surcharge | 2% | Referral Fee × 0.02 |
| VAT on Fees | 20% | (Referral + DST) × 0.20 |
| **Effective Total** | **18.36%** | Sale Price × 0.1836 |
| Shipping | £3-£4 | £3 if < £14, £4 if ≥ £14 |

**Net Payout** = Sale Price - Amazon Fee - Shipping
**Profit** = Net Payout - Product Cost

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARBITRAGE TRACKER                               │
├─────────────────┬─────────────────┬─────────────────┬───────────────────────┤
│     Amazon      │     BrickLink   │      eBay       │      Seeded           │
│   Arbitrage     │    Arbitrage    │   Arbitrage     │    Discovery          │
├─────────────────┴─────────────────┴─────────────────┴───────────────────────┤
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │ ArbitrageService   │  │  MappingService    │  │ SeededDiscovery    │    │
│  │ - getArbitrageData │  │  - extractSetNumber│  │ - initializeFromBS │    │
│  │ - excludeAsin      │  │  - createMapping   │  │ - runDiscovery     │    │
│  │ - getSummaryStats  │  │  - validateMapping │  │ - tryEAN/UPC/Title │    │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                              SYNC SERVICES                                    │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐    │
│  │ AmazonSyncService  │  │ BricklinkSyncSvc   │  │ EbaySyncService    │    │
│  │ - syncInventory    │  │  - syncPricing     │  │ - syncPricing      │    │
│  │ - syncPricing      │  │  - fetchFromAPI    │  │ - searchEbay       │    │
│  └────────────────────┘  └────────────────────┘  └────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                            DATABASE VIEW                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     arbitrage_current_view                            │   │
│  │  Denormalized view combining:                                         │   │
│  │  - tracked_asins + seeded_asins (union)                              │   │
│  │  - Latest amazon_arbitrage_pricing                                    │   │
│  │  - Latest bricklink_arbitrage_pricing (condition='N', country='UK')  │   │
│  │  - Latest ebay_arbitrage_pricing                                      │   │
│  │  - Calculated margins                                                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Sync Jobs

### Job Types

| Job Type | Frequency | Description |
|----------|-----------|-------------|
| `inventory_asins` | 24 hours | Sync ASINs from Amazon inventory |
| `amazon_pricing` | 6 hours | Fetch current Amazon prices |
| `bricklink_pricing` | 12 hours | Fetch BrickLink price guide data |
| `ebay_pricing` | 24 hours | Search eBay for comparable listings |
| `asin_mapping` | On demand | Automatically map ASINs to BrickLink sets |
| `seeded_discovery` | On demand | Discover ASINs for Brickset sets |

### Sync Status States

| State | Description |
|-------|-------------|
| `idle` | Not running, ready to start |
| `running` | Currently executing |
| `completed` | Finished successfully |
| `failed` | Finished with error |

---

## User Journeys

| Journey | Description | Entry Point |
|---------|-------------|-------------|
| [Amazon Arbitrage](./amazon-arbitrage.md) | Compare Amazon vs BrickLink prices | `/arbitrage/amazon` |
| [eBay Arbitrage](./ebay-arbitrage.md) | Compare Amazon vs eBay prices | `/arbitrage/ebay` |
| [Seeded ASINs](./seeded-asins.md) | Discover ASINs from Brickset database | `/arbitrage/seeded` |
| [Vinted Arbitrage (Manual)](./vinted-arbitrage.md) | Scan Vinted for deals vs Amazon | `/arbitrage/vinted` |
| [Vinted Automation](./vinted-automation.md) | Automated scanner with Windows tray app | `/arbitrage/vinted/automation` |

---

## Key Features

### Multi-Source Tracking
- Track ASINs from your Amazon inventory
- Add "seeded" ASINs from Brickset for sets you don't own
- Manual ASIN entry for specific sets
- Real-time Vinted scanning for immediate opportunities

### Intelligent Mapping
- Automatic ASIN-to-BrickLink mapping via:
  - EAN/UPC barcode lookup (100%/95% confidence)
  - Set number extraction from title (85% confidence)
  - Fuzzy title matching (60-80% confidence)
- Manual mapping for unmatched ASINs
- Validation against BrickLink catalog

### Opportunity Detection
- Configurable margin threshold (default 30%)
- Filter by:
  - Opportunities only (margin ≥ threshold)
  - In stock (Amazon qty > 0)
  - Zero quantity only
  - Pending review
- Sort by margin, price, sales rank

### eBay Listing Management
- Exclude irrelevant eBay listings per set
- Recalculate stats excluding excluded listings
- View individual listing details

---

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/arbitrage` | GET | List arbitrage items with filters |
| `/api/arbitrage/[asin]` | GET | Get single item details |
| `/api/arbitrage/[asin]` | PATCH | Exclude/restore ASIN |
| `/api/arbitrage/mapping` | POST | Create manual mapping |
| `/api/arbitrage/mapping` | DELETE | Delete mapping |
| `/api/arbitrage/sync` | GET | Get sync status |
| `/api/arbitrage/sync` | POST | Trigger sync job |
| `/api/arbitrage/sync/ebay` | POST | Trigger eBay sync (streaming) |
| `/api/arbitrage/excluded` | GET | List excluded ASINs |
| `/api/arbitrage/unmapped` | GET | List unmapped ASINs |
| `/api/arbitrage/summary` | GET | Get summary statistics |
| `/api/arbitrage/seeded` | GET | List seeded ASINs |
| `/api/arbitrage/seeded` | POST | Update seeded ASIN preferences |
| `/api/arbitrage/discovery` | GET | Get discovery status |
| `/api/arbitrage/discovery` | POST | Run discovery |
| `/api/arbitrage/ebay-exclusions` | GET/POST/DELETE | Manage eBay exclusions |
| `/api/arbitrage/vinted` | GET | Scan Vinted URL for opportunities |
| `/api/arbitrage/vinted` | POST | Parse provided HTML for listings |

---

## Source Files

| File | Purpose |
|------|---------|
| [arbitrage.service.ts](../../../apps/web/src/lib/arbitrage/arbitrage.service.ts) | Main service class |
| [calculations.ts](../../../apps/web/src/lib/arbitrage/calculations.ts) | Margin/profit calculations |
| [mapping.service.ts](../../../apps/web/src/lib/arbitrage/mapping.service.ts) | ASIN mapping logic |
| [seeded-discovery.service.ts](../../../apps/web/src/lib/arbitrage/seeded-discovery.service.ts) | Seeded ASIN discovery |
| [amazon-sync.service.ts](../../../apps/web/src/lib/arbitrage/amazon-sync.service.ts) | Amazon pricing sync |
| [bricklink-sync.service.ts](../../../apps/web/src/lib/arbitrage/bricklink-sync.service.ts) | BrickLink pricing sync |
| [ebay-sync.service.ts](../../../apps/web/src/lib/arbitrage/ebay-sync.service.ts) | eBay pricing sync |
| [types.ts](../../../apps/web/src/lib/arbitrage/types.ts) | Type definitions |
| [use-arbitrage.ts](../../../apps/web/src/hooks/use-arbitrage.ts) | React Query hooks |
| [amazon/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/amazon/page.tsx) | Amazon arbitrage page |
| [ebay/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/ebay/page.tsx) | eBay arbitrage page |
| [seeded/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/seeded/page.tsx) | Seeded ASINs page |
| [vinted/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx) | Vinted arbitrage page |
| [vinted/route.ts](../../../apps/web/src/app/api/arbitrage/vinted/route.ts) | Vinted API endpoint |

---

## Related Features

- [Amazon Integration](../amazon/overview.md) - Amazon SP-API for pricing data
- [eBay Integration](../ebay/overview.md) - eBay search for sourcing
- [Inventory](../inventory/overview.md) - Source of tracked ASINs
