# Feature Specification: ebay-negotiation-automation-engine

**Generated:** 2026-01-17
**Based on:** done-criteria.md (v1.0)
**Status:** READY_FOR_BUILD

---

## 1. Summary

This feature implements an automated negotiation engine that uses the eBay Negotiation API to send targeted discount offers to high-intent buyers (watchers and cart abandoners). The system calculates a weighted score based on listing age (50%+), stock level, item value, category/theme, and watcher count to determine discount percentages from a configurable grid. It integrates as a new tab within the existing Listing Optimiser page, supports both manual and scheduled (4-hourly) offer sending with Pushover notifications, and maintains a comprehensive audit log for tracking offer performance metrics (sent count, acceptance rate, average discount conversion).

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1: API Client Exists** | Create `ebay-negotiation.client.ts` with `findEligibleItems()` and `sendOfferToInterestedBuyers()` methods |
| **F2: findEligibleItems** | REST GET to eBay Negotiation API with pagination, returns `{ eligibleItems, total }` |
| **F3: sendOfferToInterestedBuyers** | REST POST with listingId, discountPercentage, returns offer details |
| **F4: Score Calculation** | Create `negotiation-scoring.service.ts` with weighted formula |
| **F5: Listing Age 50%+** | Score formula: `0.5 * ageScore + 0.15 * stockScore + 0.15 * valueScore + 0.1 * categoryScore + 0.1 * watcherScore` |
| **F6: All Factors** | Query inventory_items for listing_date, join with platform_listings for watchers |
| **F7: Original Listing Date** | Use `inventory_items.listing_date` field, not eBay API start date |
| **F8: Discount Grid** | Database table with score ranges and discount percentages |
| **F9: Score to Discount** | Query `negotiation_discount_rules` for matching range |
| **F10: Min 10% Discount** | Validation in service + database CHECK constraint |
| **F11: Eligibility Threshold** | Config setting `min_days_before_offer` checked before processing |
| **F12: Manual Send Button** | Button in UI calls POST `/api/negotiation/send-offers` |
| **F13: Automated Schedule** | Vercel cron job at 8am/12pm/4pm/8pm UK calling `/api/cron/negotiation` |
| **F14: Automation Toggle** | Config setting `automation_enabled` checked by cron endpoint |
| **F15: Audit Log** | Insert into `negotiation_offers` table for each offer sent |
| **F16: Pushover Notification** | Reuse `PushoverService` with summary message after automated run |
| **F17: Re-offer Escalation** | Check expired offers past cooldown, apply escalation increment |
| **F18: Cooldown Period** | Config setting `re_offer_cooldown_days` |
| **F19: Escalation Increment** | Config setting `re_offer_escalation_percent` |
| **F20: Offers Sent Count** | Aggregate query on `negotiation_offers` with date filters |
| **F21: Acceptance Rate** | `COUNT(status='ACCEPTED') / COUNT(*) * 100` |
| **F22: Status Sync** | Poll eBay API to update offer statuses periodically |
| **F23: Avg Discount Metrics** | `AVG(discount_percentage)` with filter for converted offers |
| **U1-U8: UI Components** | New tab in Listing Optimiser with dashboard, table, config modal |
| **E1-E5: Error Handling** | Toast notifications, validation, partial failure handling |
| **P1-P3: Performance** | Batch processing, indexed queries, response time targets |
| **I1-I3: Integrations** | Reuse eBay OAuth, link to inventory_items, reuse Pushover |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                        │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ ListingOptimiserPage                                                    │ │
│  │                                                                         │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────────┐ │ │
│  │  │ Optimiser   │  │ Offers Tab  │  │ (future tabs)                   │ │ │
│  │  │ Tab         │  │ [NEW]       │  │                                 │ │ │
│  │  └─────────────┘  └──────┬──────┘  └─────────────────────────────────┘ │ │
│  │                          │                                              │ │
│  │                          ▼                                              │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │ OffersTab                                                         │  │ │
│  │  │                                                                   │  │ │
│  │  │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │  │ │
│  │  │  │ MetricsDashboard│  │ RecentOffersTable│  │ ConfigModal      │ │  │ │
│  │  │  │ - Sent count    │  │ - Listing        │  │ - Automation     │ │  │ │
│  │  │  │ - Accept rate   │  │ - Buyer          │  │ - Threshold      │ │  │ │
│  │  │  │ - Avg discount  │  │ - Discount %     │  │ - Discount grid  │ │  │ │
│  │  │  │ - Avg converted │  │ - Status         │  │ - Cooldown       │ │  │ │
│  │  │  └─────────────────┘  │ - Date           │  │ - Escalation     │ │  │ │
│  │  │                       └──────────────────┘  └──────────────────┘ │  │ │
│  │  │  ┌─────────────────────────────────────────────────────────────┐ │  │ │
│  │  │  │ [Send Offers Now] button  +  [Settings] button              │ │  │ │
│  │  │  └─────────────────────────────────────────────────────────────┘ │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                              API Layer                                       │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ /api/negotiation/*                                                    │   │
│  │                                                                       │   │
│  │ GET  /eligible      → Fetch eligible listings with scores            │   │
│  │ POST /send-offers   → Trigger offer send (manual)                    │   │
│  │ GET  /offers        → List sent offers with filters                  │   │
│  │ GET  /metrics       → Dashboard metrics                              │   │
│  │ GET  /config        → Read configuration                             │   │
│  │ PUT  /config        → Update configuration                           │   │
│  │ GET  /rules         → List discount rules                            │   │
│  │ POST /rules         → Create discount rule                           │   │
│  │ PUT  /rules/:id     → Update discount rule                           │   │
│  │ DELETE /rules/:id   → Delete discount rule                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ /api/cron/negotiation                                                 │   │
│  │                                                                       │   │
│  │ POST (Vercel cron) → Check automation_enabled, run offer engine      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                             Service Layer                                    │
│                                                                              │
│  ┌────────────────────────┐  ┌────────────────────────┐                     │
│  │ NegotiationService     │  │ NegotiationScoringService│                    │
│  │                        │  │                        │                     │
│  │ - processOffers()      │  │ - calculateScore()     │                     │
│  │ - sendOffer()          │  │ - getFactors()         │                     │
│  │ - syncOfferStatuses()  │  │ - getDiscountForScore()│                     │
│  │ - getMetrics()         │  └────────────────────────┘                     │
│  │ - getConfig()          │                                                 │
│  │ - updateConfig()       │  ┌────────────────────────┐                     │
│  └──────────┬─────────────┘  │ EbayNegotiationClient  │                     │
│             │                │                        │                     │
│             │                │ - findEligibleItems()  │                     │
│             └───────────────▶│ - sendOffer()          │                     │
│                              │ - getOfferStatus()     │                     │
│                              └───────────┬────────────┘                     │
│                                          │                                   │
├──────────────────────────────────────────┼───────────────────────────────────┤
│                             External     │                                   │
│                                          ▼                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ eBay Negotiation API (api.ebay.com/sell/negotiation/v1)             │    │
│  │                                                                      │    │
│  │ GET  /find_eligible_items         → Listings with interested buyers │    │
│  │ POST /send_offer_to_interested_buyers → Send discount offers        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                             Data Layer                                       │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Supabase PostgreSQL                                                  │    │
│  │                                                                      │    │
│  │ negotiation_config         │ User settings (toggle, thresholds)     │    │
│  │ negotiation_discount_rules │ Score → discount % mapping             │    │
│  │ negotiation_offers         │ Audit log of all offers sent           │    │
│  │ inventory_items            │ listing_date, ebay_listing_id (read)   │    │
│  │ platform_listings          │ watchers, views (read)                 │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technology Decisions

| Decision | Options Considered | Choice | Rationale |
|----------|-------------------|--------|-----------|
| **eBay API Client** | Add to existing adapter vs new client | New client (`ebay-negotiation.client.ts`) | Single responsibility, cleaner separation |
| **Scoring Engine** | In API route vs separate service | Separate service | Testable, reusable, configurable |
| **Scheduling** | Vercel cron vs external scheduler | Vercel cron | Built-in, no additional infrastructure |
| **Config Storage** | JSON file vs database | Database table | User-specific, UI-editable |
| **UI Integration** | New page vs tab in Optimiser | Tab in Listing Optimiser | Related functionality, user context |
| **Notifications** | Email vs Pushover | Pushover (existing) | Already integrated, instant delivery |
| **Status Sync** | Webhooks vs polling | Polling | eBay doesn't offer webhooks for offers |

### 3.3 OAuth Scope Requirements

The eBay Negotiation API requires the `sell.inventory` scope, which is already included in the existing OAuth flow (see [ebay-auth.service.ts](apps/web/src/lib/ebay/ebay-auth.service.ts#L66)). No additional scopes needed.

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/lib/ebay/ebay-negotiation.client.ts` | eBay Negotiation API client | 150-200 |
| `apps/web/src/lib/ebay/negotiation-scoring.service.ts` | Score calculation logic | 120-150 |
| `apps/web/src/lib/ebay/negotiation.service.ts` | Main negotiation orchestration | 250-300 |
| `apps/web/src/lib/ebay/negotiation.types.ts` | TypeScript types for negotiation | 80-100 |
| `apps/web/src/app/api/negotiation/eligible/route.ts` | GET eligible listings | 60-80 |
| `apps/web/src/app/api/negotiation/send-offers/route.ts` | POST trigger offers | 80-100 |
| `apps/web/src/app/api/negotiation/offers/route.ts` | GET sent offers list | 60-80 |
| `apps/web/src/app/api/negotiation/metrics/route.ts` | GET dashboard metrics | 50-70 |
| `apps/web/src/app/api/negotiation/config/route.ts` | GET/PUT configuration | 80-100 |
| `apps/web/src/app/api/negotiation/rules/route.ts` | CRUD discount rules | 120-150 |
| `apps/web/src/app/api/negotiation/rules/[id]/route.ts` | PUT/DELETE single rule | 60-80 |
| `apps/web/src/app/api/cron/negotiation/route.ts` | Cron endpoint | 80-100 |
| `apps/web/src/components/features/negotiation/OffersTab.tsx` | Main tab component | 150-200 |
| `apps/web/src/components/features/negotiation/MetricsDashboard.tsx` | Stats cards | 80-100 |
| `apps/web/src/components/features/negotiation/RecentOffersTable.tsx` | Offers data table | 120-150 |
| `apps/web/src/components/features/negotiation/ConfigModal.tsx` | Settings modal | 200-250 |
| `apps/web/src/components/features/negotiation/DiscountRulesEditor.tsx` | Grid editor | 150-180 |
| `apps/web/src/components/features/negotiation/index.ts` | Barrel export | 10 |
| `apps/web/src/hooks/useNegotiation.ts` | React Query hooks | 100-120 |
| `supabase/migrations/YYYYMMDDHHMMSS_negotiation_engine.sql` | Database schema | 150-200 |
| `vercel.json` | Cron configuration | 15-20 |

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/listing-optimiser/page.tsx` | Add tabs, integrate OffersTab | 50-70 |
| `apps/web/src/lib/notifications/pushover.service.ts` | Add `sendNegotiationSummary()` method | 20-30 |
| `packages/database/src/types.ts` | Regenerate after migration | Auto-generated |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `ebay-auth.service.ts` | Already has required `sell.inventory` scope |
| `ebay-api.adapter.ts` | Keep separate, Negotiation API is distinct |
| `inventory_items` table | Has `listing_date`, `ebay_listing_id` already |

---

## 5. Implementation Details

### 5.1 Database Schema

```sql
-- Migration: YYYYMMDDHHMMSS_negotiation_engine.sql

-- ============================================================================
-- 1. negotiation_config - User settings
-- ============================================================================

CREATE TABLE negotiation_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  automation_enabled BOOLEAN NOT NULL DEFAULT false,
  min_days_before_offer INTEGER NOT NULL DEFAULT 14,
  re_offer_cooldown_days INTEGER NOT NULL DEFAULT 7,
  re_offer_escalation_percent INTEGER NOT NULL DEFAULT 5 CHECK (re_offer_escalation_percent >= 0 AND re_offer_escalation_percent <= 20),
  -- Scoring weights (must sum to 100)
  weight_listing_age INTEGER NOT NULL DEFAULT 50 CHECK (weight_listing_age >= 0 AND weight_listing_age <= 100),
  weight_stock_level INTEGER NOT NULL DEFAULT 15,
  weight_item_value INTEGER NOT NULL DEFAULT 15,
  weight_category INTEGER NOT NULL DEFAULT 10,
  weight_watchers INTEGER NOT NULL DEFAULT 10,
  last_auto_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. negotiation_discount_rules - Score to discount mapping
-- ============================================================================

CREATE TABLE negotiation_discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  min_score INTEGER NOT NULL CHECK (min_score >= 0 AND min_score <= 100),
  max_score INTEGER NOT NULL CHECK (max_score >= 0 AND max_score <= 100),
  discount_percentage INTEGER NOT NULL CHECK (discount_percentage >= 10 AND discount_percentage <= 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_score_range CHECK (min_score <= max_score)
);

-- ============================================================================
-- 3. negotiation_offers - Audit log
-- ============================================================================

CREATE TABLE negotiation_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ebay_listing_id TEXT NOT NULL,
  inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ebay_offer_id TEXT,
  buyer_masked_username TEXT,
  discount_percentage INTEGER NOT NULL,
  score INTEGER NOT NULL,
  score_factors JSONB NOT NULL,
  offer_message TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'FAILED')),
  is_re_offer BOOLEAN NOT NULL DEFAULT false,
  previous_offer_id UUID REFERENCES negotiation_offers(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  status_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_negotiation_config_user ON negotiation_config(user_id);
CREATE INDEX idx_negotiation_rules_user ON negotiation_discount_rules(user_id);
CREATE INDEX idx_negotiation_offers_user ON negotiation_offers(user_id);
CREATE INDEX idx_negotiation_offers_listing ON negotiation_offers(ebay_listing_id);
CREATE INDEX idx_negotiation_offers_status ON negotiation_offers(user_id, status);
CREATE INDEX idx_negotiation_offers_sent ON negotiation_offers(user_id, sent_at DESC);

-- RLS Policies (for all three tables - users can only access their own data)
ALTER TABLE negotiation_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_discount_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE negotiation_offers ENABLE ROW LEVEL SECURITY;

-- (Create SELECT/INSERT/UPDATE/DELETE policies for each table)
```

### 5.2 eBay Negotiation API Client

```typescript
// apps/web/src/lib/ebay/ebay-negotiation.client.ts

interface EligibleItem {
  listingId: string;
}

interface EligibleItemsResponse {
  eligibleItems: EligibleItem[];
  href: string;
  limit: number;
  offset: number;
  total: number;
  next?: string;
  prev?: string;
}

interface SendOfferRequest {
  allowCounterOffer: boolean;
  message?: string;
  offeredItems: Array<{
    listingId: string;
    quantity: number;
    discountPercentage: string;
  }>;
  offerDuration: {
    unit: 'DAY';
    value: number;
  };
}

interface SentOffer {
  offerId: string;
  offerStatus: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';
  buyer: { maskedUsername: string };
  creationDate: string;
  offeredItems: Array<{ listingId: string; discountPercentage: string }>;
}

export class EbayNegotiationClient {
  private baseUrl = 'https://api.ebay.com/sell/negotiation/v1';
  private accessToken: string;
  private marketplaceId: string;

  constructor(accessToken: string, marketplaceId: string = 'EBAY_GB') {
    this.accessToken = accessToken;
    this.marketplaceId = marketplaceId;
  }

  async findEligibleItems(limit = 200, offset = 0): Promise<EligibleItemsResponse> {
    const url = `${this.baseUrl}/find_eligible_items?limit=${limit}&offset=${offset}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`findEligibleItems failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  async sendOfferToInterestedBuyers(
    listingId: string,
    discountPercentage: number,
    message?: string
  ): Promise<{ offers: SentOffer[] }> {
    const url = `${this.baseUrl}/send_offer_to_interested_buyers`;

    const body: SendOfferRequest = {
      allowCounterOffer: false,
      offeredItems: [{
        listingId,
        quantity: 1,
        discountPercentage: discountPercentage.toString(),
      }],
      offerDuration: { unit: 'DAY', value: 4 }, // 4 days for EBAY_GB
      ...(message && { message }),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'X-EBAY-C-MARKETPLACE-ID': this.marketplaceId,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`sendOffer failed: ${response.status} - ${error}`);
    }

    return response.json();
  }

  // Paginate through all eligible items
  async findAllEligibleItems(): Promise<EligibleItem[]> {
    const allItems: EligibleItem[] = [];
    let offset = 0;
    const limit = 200;

    while (true) {
      const response = await this.findEligibleItems(limit, offset);
      allItems.push(...response.eligibleItems);

      if (!response.next || response.eligibleItems.length < limit) {
        break;
      }
      offset += limit;
    }

    return allItems;
  }
}
```

### 5.3 Scoring Service

```typescript
// apps/web/src/lib/ebay/negotiation-scoring.service.ts

interface ScoringWeights {
  listingAge: number;  // Default 50
  stockLevel: number;  // Default 15
  itemValue: number;   // Default 15
  category: number;    // Default 10
  watchers: number;    // Default 10
}

interface ScoringInput {
  originalListingDate: Date;
  stockLevel: number;
  itemCost: number;
  category?: string;
  watcherCount: number;
}

interface ScoreResult {
  score: number;  // 0-100
  factors: {
    listing_age: number;
    stock_level: number;
    item_value: number;
    category: number;
    watchers: number;
  };
}

export class NegotiationScoringService {
  private weights: ScoringWeights;

  constructor(weights?: Partial<ScoringWeights>) {
    this.weights = {
      listingAge: weights?.listingAge ?? 50,
      stockLevel: weights?.stockLevel ?? 15,
      itemValue: weights?.itemValue ?? 15,
      category: weights?.category ?? 10,
      watchers: weights?.watchers ?? 10,
    };
  }

  calculateScore(input: ScoringInput): ScoreResult {
    const factors = {
      listing_age: this.calculateAgeScore(input.originalListingDate),
      stock_level: this.calculateStockScore(input.stockLevel),
      item_value: this.calculateValueScore(input.itemCost),
      category: this.calculateCategoryScore(input.category),
      watchers: this.calculateWatcherScore(input.watcherCount),
    };

    // Weighted sum (each factor is 0-100, weights sum to 100)
    const score = Math.round(
      (factors.listing_age * this.weights.listingAge +
       factors.stock_level * this.weights.stockLevel +
       factors.item_value * this.weights.itemValue +
       factors.category * this.weights.category +
       factors.watchers * this.weights.watchers) / 100
    );

    return { score: Math.min(100, Math.max(0, score)), factors };
  }

  private calculateAgeScore(listingDate: Date): number {
    const daysSinceListing = Math.floor(
      (Date.now() - listingDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    // Score increases with age: 0 days = 0, 30 days = 50, 90+ days = 100
    if (daysSinceListing <= 0) return 0;
    if (daysSinceListing >= 90) return 100;
    return Math.round((daysSinceListing / 90) * 100);
  }

  private calculateStockScore(stockLevel: number): number {
    // Higher stock = higher urgency to clear = higher score
    if (stockLevel <= 1) return 20;
    if (stockLevel <= 3) return 50;
    if (stockLevel <= 5) return 70;
    return 100; // 6+ items
  }

  private calculateValueScore(cost: number): number {
    // Lower value items get higher scores (more aggressive discounting OK)
    // Higher value items get lower scores (protect margin)
    if (cost >= 100) return 20;
    if (cost >= 50) return 40;
    if (cost >= 25) return 60;
    return 80; // < £25
  }

  private calculateCategoryScore(category?: string): number {
    // Default neutral score; can be enhanced with category-specific rules
    // Future: Learn from historical data which categories need bigger discounts
    return 50;
  }

  private calculateWatcherScore(watcherCount: number): number {
    // More watchers = more interest = lower discount needed
    // Inverse: fewer watchers = higher score = bigger discount
    if (watcherCount >= 10) return 20;
    if (watcherCount >= 5) return 40;
    if (watcherCount >= 2) return 60;
    return 80; // 0-1 watchers
  }

  async getDiscountForScore(
    userId: string,
    score: number,
    supabase: SupabaseClient
  ): Promise<number> {
    const { data, error } = await supabase
      .from('negotiation_discount_rules')
      .select('discount_percentage')
      .eq('user_id', userId)
      .lte('min_score', score)
      .gte('max_score', score)
      .single();

    if (error || !data) {
      // Default: 10% for low scores, up to 25% for high scores
      if (score >= 80) return 25;
      if (score >= 60) return 20;
      if (score >= 40) return 15;
      return 10;
    }

    return data.discount_percentage;
  }
}
```

### 5.4 Cron Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/negotiation",
      "schedule": "0 8,12,16,20 * * *"
    }
  ]
}
```

Note: This runs at 8:00, 12:00, 16:00, 20:00 UTC. For UK time, adjust to account for BST/GMT.

### 5.5 Cron Endpoint

```typescript
// apps/web/src/app/api/cron/negotiation/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getNegotiationService } from '@/lib/ebay/negotiation.service';
import { pushoverService } from '@/lib/notifications/pushover.service';

export async function POST(request: NextRequest) {
  // Verify cron secret (Vercel adds Authorization header)
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const supabase = await createClient();

    // Get all users with automation enabled
    const { data: configs } = await supabase
      .from('negotiation_config')
      .select('user_id')
      .eq('automation_enabled', true);

    if (!configs || configs.length === 0) {
      return NextResponse.json({ message: 'No users with automation enabled' });
    }

    let totalOffersSent = 0;

    for (const config of configs) {
      const service = getNegotiationService();
      const result = await service.processOffers(config.user_id);
      totalOffersSent += result.offersSent;

      // Send notification for this user
      if (result.offersSent > 0) {
        await pushoverService.send({
          title: 'eBay Offers Sent',
          message: `${result.offersSent} offer(s) sent to interested buyers`,
          priority: 0,
        });
      }
    }

    return NextResponse.json({
      success: true,
      usersProcessed: configs.length,
      totalOffersSent
    });
  } catch (error) {
    console.error('[Cron Negotiation] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
```

### 5.6 UI Component Structure

```typescript
// apps/web/src/components/features/negotiation/OffersTab.tsx

export function OffersTab() {
  const { data: metrics, isLoading: metricsLoading } = useNegotiationMetrics();
  const { data: offers, isLoading: offersLoading } = useNegotiationOffers();
  const sendOffersMutation = useSendOffers();
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Buyer Negotiation</h2>
        <div className="flex gap-2">
          <Button
            onClick={() => sendOffersMutation.mutate()}
            disabled={sendOffersMutation.isPending}
            data-testid="send-offers-button"
          >
            {sendOffersMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Offers Now
          </Button>
          <Button
            variant="outline"
            onClick={() => setConfigOpen(true)}
            data-testid="negotiation-settings-button"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Metrics Dashboard */}
      <MetricsDashboard metrics={metrics} isLoading={metricsLoading} />

      {/* Recent Offers Table */}
      <RecentOffersTable offers={offers} isLoading={offersLoading} />

      {/* Config Modal */}
      <ConfigModal open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
```

---

## 6. Build Order

### Phase 1: Database & Core Infrastructure
1. Create database migration for `negotiation_config`, `negotiation_discount_rules`, `negotiation_offers`
2. Push migration to cloud Supabase (`npm run db:push`)
3. Regenerate types (`npm run db:types`)

### Phase 2: eBay API Integration (F1-F3)
4. Create `ebay-negotiation.client.ts` with API methods
5. Create `negotiation.types.ts` with TypeScript types
6. Write unit tests for API client with mocked responses

### Phase 3: Scoring Engine (F4-F7, F8-F11)
7. Create `negotiation-scoring.service.ts`
8. Implement score calculation with all factors
9. Implement discount rule lookup
10. Write unit tests for scoring logic

### Phase 4: Orchestration Service (F12-F19)
11. Create `negotiation.service.ts` main orchestration
12. Implement `processOffers()` for batch processing
13. Implement re-offer logic with escalation
14. Implement metrics calculation

### Phase 5: API Routes
15. Create `/api/negotiation/eligible` route
16. Create `/api/negotiation/send-offers` route
17. Create `/api/negotiation/offers` route
18. Create `/api/negotiation/metrics` route
19. Create `/api/negotiation/config` route
20. Create `/api/negotiation/rules` routes (CRUD)

### Phase 6: Cron & Notifications (F13, F14, F16)
21. Create `vercel.json` with cron configuration
22. Create `/api/cron/negotiation` endpoint
23. Add `sendNegotiationSummary()` to Pushover service

### Phase 7: UI Components (U1-U8)
24. Create `OffersTab.tsx` main component
25. Create `MetricsDashboard.tsx` with stat cards
26. Create `RecentOffersTable.tsx` with DataTable
27. Create `ConfigModal.tsx` with form
28. Create `DiscountRulesEditor.tsx` for grid
29. Create `useNegotiation.ts` hooks

### Phase 8: Integration (U1, I1-I3)
30. Add tab navigation to Listing Optimiser page
31. Integrate OffersTab component
32. Test full flow end-to-end

### Phase 9: Error Handling & Polish (E1-E5, P1-P3)
33. Add empty state handling
34. Add error toasts and validation
35. Add loading states
36. Performance testing and optimization

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| eBay rate limiting | Medium | High | Implement exponential backoff; batch requests; monitor usage |
| OAuth token expiry during batch | Low | Medium | Token auto-refresh already implemented; check before batch |
| Score calculation accuracy | Medium | Medium | Start with conservative weights; tune based on conversion data |
| Cron timing (BST/GMT) | Low | Low | Use UTC times; document for clarity |
| Large number of eligible listings | Low | Medium | Pagination in API client; batch processing in service |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Feature creep (counter-offers, AI suggestions) | Clearly documented as out of scope |
| Complexity in discount rules UI | Start with simple grid; iterate based on feedback |
| Performance with many historical offers | Indexed queries; paginated responses |

### Integration Risks

| Risk | Mitigation |
|------|------------|
| eBay API changes | Use typed client; version-lock API calls |
| Pushover service unavailable | Graceful degradation (log only) |
| Missing inventory_items link | Fallback to eBay data only |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: API Client Exists | Yes | High | Standard REST client pattern |
| F2: findEligibleItems | Yes | High | eBay API documented and available |
| F3: sendOfferToInterestedBuyers | Yes | High | eBay API documented and available |
| F4: Score Calculation | Yes | High | Pure function, well-defined inputs |
| F5: Listing Age 50%+ | Yes | High | Configurable weights in database |
| F6: All Factors | Yes | High | Data available in existing tables |
| F7: Original Listing Date | Yes | High | `inventory_items.listing_date` exists |
| F8: Discount Grid | Yes | High | Standard database table |
| F9: Score to Discount | Yes | High | Range query |
| F10: Min 10% Discount | Yes | High | CHECK constraint + validation |
| F11: Eligibility Threshold | Yes | High | Config setting + filter |
| F12: Manual Send Button | Yes | High | Button → API → Service |
| F13: Automated Schedule | Yes | High | Vercel cron supported |
| F14: Automation Toggle | Yes | High | Config flag check |
| F15: Audit Log | Yes | High | Insert to table |
| F16: Pushover Notification | Yes | High | Reuse existing service |
| F17: Re-offer Escalation | Yes | High | Query expired offers, increment |
| F18: Cooldown Period | Yes | High | Config setting |
| F19: Escalation Increment | Yes | High | Config setting |
| F20: Offers Sent Count | Yes | High | COUNT query |
| F21: Acceptance Rate | Yes | High | Aggregate calculation |
| F22: Status Sync | Yes | Medium | Need to implement polling |
| F23: Avg Discount Metrics | Yes | High | AVG query with filters |
| U1-U8: UI Components | Yes | High | Standard React/shadcn patterns |
| E1-E5: Error Handling | Yes | High | Toast + validation patterns exist |
| P1: < 5s fetch | Yes | High | eBay API typically fast |
| P2: 50+ batch | Yes | High | Sequential with rate limiting |
| P3: < 3s dashboard | Yes | High | Indexed queries |
| I1-I3: Integrations | Yes | High | Existing patterns to follow |

**Overall:** All 42 criteria are feasible with the planned approach.

**Issues:** None identified.

---

## 9. Notes for Build Agent

### Key Implementation Hints

1. **eBay Marketplace ID**: Always use `EBAY_GB` for UK marketplace. This affects offer duration (4 days for GB).

2. **Token Management**: Use existing `ebayAuthService.getAccessToken(userId)` - it handles refresh automatically.

3. **Database Queries**: Remember Supabase 1000-row limit. Use pagination for `negotiation_offers` queries.

4. **Scoring Weights**: Store in config table so users can tune. Default to 50/15/15/10/10 split.

5. **Error Codes**: eBay returns specific error codes (150020 = no interested buyers, 150022 = max offers reached). Handle these gracefully.

6. **Cron Secret**: Add `CRON_SECRET` to Vercel environment variables. Vercel passes this in Authorization header.

7. **Test Data**: For testing, may need to wait for actual watchers/cart abandoners. Consider mocking in tests.

8. **UI Tab Pattern**: Follow existing tab pattern in the codebase if one exists, otherwise use shadcn Tabs component.

9. **Pushover Integration**: The service silently succeeds if not configured - no error handling needed for missing config.

10. **Re-offer Logic**: When checking for expired offers to re-send, ensure we're not exceeding eBay's maximum offer limit per listing.

### Files to Reference

- OAuth pattern: [ebay-auth.service.ts](apps/web/src/lib/ebay/ebay-auth.service.ts)
- API route pattern: [listing-optimiser/route.ts](apps/web/src/app/api/listing-optimiser/route.ts)
- Pushover service: [pushover.service.ts](apps/web/src/lib/notifications/pushover.service.ts)
- Migration pattern: [20260124000001_listing_optimiser.sql](supabase/migrations/20260124000001_listing_optimiser.sql)
- UI component pattern: [listing-optimiser components](apps/web/src/components/features/listing-optimiser/)

---

## Feature Spec → Build Feature Handoff

**Feature:** ebay-negotiation-automation-engine
**Spec:** docs/features/ebay-negotiation-automation-engine/feature-spec.md
**Status:** READY_FOR_BUILD

**Summary:**
- ~21 new files to create
- ~2 files to modify
- ~2,500-3,000 lines of code
- 1 database migration (3 tables)
- 1 new config file (vercel.json)

**Build order:**
1. Database schema (Phase 1)
2. eBay API client (Phase 2)
3. Scoring service (Phase 3)
4. Orchestration service (Phase 4)
5. API routes (Phase 5)
6. Cron & notifications (Phase 6)
7. UI components (Phase 7)
8. Integration (Phase 8)
9. Polish (Phase 9)

**Risks flagged:** 1 medium (eBay rate limiting - mitigated with backoff)

**Ready for:** `/build-feature ebay-negotiation-automation-engine`
