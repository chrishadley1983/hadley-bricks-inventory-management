# Feature Specification: ebay-minifig-sync

**Generated:** 2026-02-19
**Based on:** done-criteria.md (91 criteria)
**Spec:** `docs/bricqer-ebay-minifig-sync-spec.md`
**Status:** READY_FOR_BUILD

---

## 1. Summary

A 5-phase automated pipeline for cross-listing used LEGO minifigures from Bricqer onto eBay, bypassing Bricqer's native eBay integration (saving 3.5% fees). The system pulls minifig inventory from Bricqer, researches market data via Terapeak (Playwright) and BrickLink Price Guide (fallback), sources images from multiple web sources, generates AI listing descriptions via Claude, stages listings as unpublished eBay offers for human review, and syncs sales across platforms with an approval-based removal queue. All thresholds are configurable via a database config table.

**Key architectural principle:** Hadley Bricks is the orchestrator. Bricqer is inventory source only. eBay is managed entirely by direct API calls. Everything stages before publishing. Every removal requires explicit approval.

---

## 2. Criteria Mapping

### Phase 1: Database & Inventory (F1-F11, E1-E2)

| Criterion | Implementation |
|-----------|---------------|
| F1: Tables exist | Single migration creating all 5 tables |
| F2: Correct schema | Column definitions from spec DDL |
| F3: Indexes | Created in same migration |
| F4: Config seeded | INSERT statements in migration |
| F5: RLS policies | Policies in migration (user_id match) |
| F6: Pull route | `POST /api/minifigs/sync/pull-inventory` |
| F7: Pull filters | BricqerClient.getAllInventoryItems() + post-filter for type=M, condition=U, price >= config |
| F8: Data stored | Upsert into minifig_sync_items |
| F9: Duplicate handling | ON CONFLICT (bricqer_item_id) DO UPDATE |
| F10: Pagination | Existing BricqerClient.getAllInventoryItems() handles pagination |
| F11: Job recorded | Insert into minifig_sync_jobs with counts |
| E1: API failure | Try/catch wrapping Bricqer calls → FAILED status |
| E2: Partial failure | Per-page try/catch, accumulate errors |

### Phase 2: Market Research (F12-F25, E3-E4)

| Criterion | Implementation |
|-----------|---------------|
| F12: Terapeak scraper | New file: `lib/minifig-sync/terapeak-scraper.ts` |
| F13: Session auth | Load eBay cookies from CredentialsRepository |
| F14: Extract sold data | Playwright DOM selectors on Terapeak results page |
| F15: Rate limits | `await sleep(3000)` between Terapeak calls |
| F16: BrickLink fallback | Existing BrickLinkClient.getPriceGuide('MINIFIG', id) |
| F17: Research route | `POST /api/minifigs/sync/research` |
| F18: Force-refresh | `POST /api/minifigs/sync/research/refresh` with `?force=true` |
| F19: Cache storage | Upsert into minifig_price_cache with 6-month TTL |
| F20: Cache hit | SELECT WHERE bricklink_id AND expires_at > NOW() |
| F21: Cache expiry | WHERE expires_at < NOW() triggers re-research |
| F22: Threshold eval | PricingEngine.evaluateThreshold() using config values |
| F23: Profit calc | PricingEngine.calculateProfit() |
| F24: Price calc | PricingEngine.calculateRecommendedPrice() with floor/ceiling |
| F25: Best Offer | 95% auto-accept, 75% auto-decline |
| E3: Session expiry | Detect login redirect URL, abort batch |
| E4: Rate limit | Exponential backoff via BrickLinkClient retry logic |

### Phase 3: Listing Creation (F26-F47, E5-E7)

| Criterion | Implementation |
|-----------|---------------|
| F26-F32: Image sourcing | New file: `lib/minifig-sync/image-sourcer.ts` |
| F33: Image processing | Sharp: resize → white bg → sharpen → JPEG 85 |
| F34-F35: Description | Claude API via existing `sendMessageForJSON` pattern |
| F36-F39: eBay staging | Reuse EbayApiAdapter: createOrReplaceInventoryItem + createOffer (no publish) |
| F40-F47: Review queue UI | New page: `/minifigs/review` with card-based layout |
| E5: Image fallback | Try/catch per source, continue to next |
| E6: eBay error | Log to job error_log, skip to next item |
| E7: Claude fallback | Template string with name + BrickLink ID |

### Phase 4: Cross-Platform Sync (F48-F60, E8-E11)

| Criterion | Implementation |
|-----------|---------------|
| F48-F50: eBay poll | Cron route polls eBay Orders API, filters HB-MF- SKUs |
| F51-F53: Bricqer poll | Cron route polls Bricqer orders, matches sync items |
| F54-F60: Removal queue | New page: `/minifigs/removals` with approve/dismiss |
| E8-E9: Race conditions | 404/already-ended → mark EXECUTED with note |
| E10: Real failures | Mark FAILED with error_message |
| E11: Cursor persistence | last_poll_cursor in minifig_sync_jobs |

### Phase 5: Ongoing Operations (F61-F69)

| Criterion | Implementation |
|-----------|---------------|
| F61-F64: Cron routes | 4 cron routes in `/api/cron/minifigs/` |
| F65-F66: Repricing | Stale listing detection + research refresh + price update |
| F67-F69: Dashboard | New page: `/minifigs` with aggregate metrics API |

### Integration & Performance (I1-I7, P1-P4)

| Criterion | Implementation |
|-----------|---------------|
| I1: SKU prefix | `HB-MF-${bricqerItemId}` constant construction |
| I2: No auto-publish | publish only in review/publish route |
| I3: No auto-remove | delete only in removals/approve route |
| I4: Config from DB | MinifigConfigService reads minifig_sync_config |
| I5: Price floor | PricingEngine.clamp() with bricqer_price + 1.00 |
| I6: Encrypted cookies | CredentialsRepository with platform='ebay-terapeak' |
| I7: Types generated | npm run db:types after migration |
| P1-P4: Performance | Pagination, rate limiting, cursor-based resumption |

---

## 3. Architecture

### 3.1 System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        HADLEY BRICKS UI                              │
│                                                                      │
│  /minifigs           /minifigs/review         /minifigs/removals     │
│  (Dashboard)         (Staging Queue)          (Removal Queue)        │
│  ┌──────────┐        ┌──────────────┐         ┌──────────────┐      │
│  │ Metrics  │        │ MinifigCard  │         │ RemovalCard  │      │
│  │ Widgets  │        │ ×N staged    │         │ ×N pending   │      │
│  └──────────┘        │ [Pub][Rej]   │         │ [Approve]    │      │
│                      │ [Edit][Bulk] │         │ [Dismiss]    │      │
│                      └──────────────┘         └──────────────┘      │
├─────────────────────────────────────────────────────────────────────┤
│                        API ROUTES                                    │
│                                                                      │
│  /api/minifigs/sync/           /api/minifigs/           /api/cron/  │
│    pull-inventory              review (GET)              minifigs/   │
│    research                    removals (GET)            daily-inv   │
│    research/refresh            removals/approve          poll-ebay   │
│    create-listings             removals/dismiss          poll-bricqer│
│    publish                     dashboard (GET)           research    │
│    reject                                                            │
├─────────────────────────────────────────────────────────────────────┤
│                      SERVICE LAYER                                   │
│                                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ SyncOrchest- │  │ Pricing      │  │ RemovalQueue │              │
│  │ rator        │  │ Engine       │  │ Service      │              │
│  └──────┬───────┘  └──────────────┘  └──────────────┘              │
│         │                                                            │
│  ┌──────┴───────┐  ┌──────────────┐  ┌──────────────┐              │
│  │ Terapeak     │  │ Image        │  │ Listing      │              │
│  │ Scraper      │  │ Sourcer      │  │ Generator    │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│         │                   │                 │                      │
├─────────┼───────────────────┼─────────────────┼─────────────────────┤
│         │         EXTERNAL APIS               │                      │
│         │                                     │                      │
│  ┌──────┴───────┐  ┌──────────┐  ┌──────────┐│  ┌──────────┐      │
│  │ Terapeak     │  │ Google   │  │ Rebrick- ││  │ Claude   │      │
│  │ (Playwright) │  │ Images   │  │ able API ││  │ API      │      │
│  └──────────────┘  └──────────┘  └──────────┘│  └──────────┘      │
│                                               │                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐│                     │
│  │ Bricqer  │  │ eBay     │  │ BrickLink   ││                     │
│  │ API      │  │ API      │  │ Price Guide ││                     │
│  │(existing)│  │(existing)│  │ (existing)  ││                     │
│  └──────────┘  └──────────┘  └─────────────┘│                     │
├──────────────────────────────────────────────┼─────────────────────┤
│                    DATABASE                   │                      │
│                                               │                      │
│  minifig_sync_items    minifig_price_cache    │                     │
│  minifig_removal_queue minifig_sync_jobs      │                     │
│  minifig_sync_config                          │                     │
└───────────────────────────────────────────────┘                     │
```

### 3.2 Integration Points

| System | Method | Existing? | Notes |
|--------|--------|-----------|-------|
| **BricqerClient** | `getAllInventoryItems()` | Yes | Filter condition='U' + post-filter type=M |
| **BricqerClient** | `getOrders()` | Yes | For Bricqer sale detection |
| **EbayApiAdapter** | `createOrReplaceInventoryItem()` | Yes | For staging inventory items |
| **EbayApiAdapter** | `createOffer()` | Yes | For creating unpublished offers |
| **EbayApiAdapter** | `publishOffer()` | Yes | For publishing from review queue |
| **EbayApiAdapter** | `withdrawOffer()` | Yes | For ending listings on Bricqer sale |
| **EbayApiAdapter** | `deleteInventoryItem()` | Yes | For cleanup after withdrawal |
| **EbayApiAdapter** | `getOrders()` | Yes | For eBay sale detection |
| **BrickLinkClient** | `getPriceGuide('MINIFIG', id)` | Yes | Fallback pricing |
| **CredentialsRepository** | `getCredentials()` | Yes | For Terapeak cookies |
| **EbayAuthService** | `getValidAccessToken()` | Yes | For eBay API calls |
| **EbayBusinessPoliciesService** | `getPolicies()` | Yes | For listing policies |
| **discordService** | `sendAlert()` | Yes | For removal notifications |
| **jobExecutionService** | `start()/complete()/fail()` | Yes | For cron tracking |
| **Terapeak** | Playwright scraping | **New** | New scraper module |
| **Google Images** | Playwright scraping | **New** | New image sourcer |
| **Rebrickable API** | HTTP client | **New** | Minifig + sets lookup |
| **Sharp** | Image processing | **New** | npm dependency to add |
| **Claude API** | `sendMessageForJSON()` | Yes | For description generation |

### 3.3 Key Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Terapeak scraping** | Playwright headless | Only way to get true Best Offer Accepted prices; Terapeak has no API |
| **Session management** | eBay cookies in CredentialsRepository | Encrypted, same pattern as all other platform creds |
| **Image processing** | Sharp (server-side) | Handles resize, white bg fill, sharpen, JPEG compression in one pipeline |
| **Price cache TTL** | 6 months in DB | Minifig market data doesn't change rapidly; avoids excessive Terapeak scraping |
| **Staging mechanism** | eBay unpublished offer | Native eBay workflow — offer exists as draft until publish is called |
| **Removal approach** | Review queue, never auto-delete | Prevents accidental deletions; double-sale risk managed by prompt notifications |
| **Cron scheduling** | Vercel cron via `vercel.json` | Consistent with existing cron jobs; 15-min poll interval |
| **Config storage** | `minifig_sync_config` KV table | All thresholds adjustable without code changes |
| **SKU format** | `HB-MF-{bricqer_item_id}` | Namespaced prefix ensures Bricqer never touches these listings |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| **Database Migration** | | |
| `supabase/migrations/YYYYMMDD_minifig_sync_tables.sql` | All 5 tables, indexes, RLS, config seed | 180 |
| **Service Layer** | | |
| `apps/web/src/lib/minifig-sync/types.ts` | TypeScript interfaces for all minifig sync types | 120 |
| `apps/web/src/lib/minifig-sync/config.service.ts` | Read configurable thresholds from DB | 60 |
| `apps/web/src/lib/minifig-sync/pricing-engine.ts` | Threshold eval, profit calc, price calc, Best Offer | 120 |
| `apps/web/src/lib/minifig-sync/price-cache.ts` | 6-month cache lookup/upsert/expiry logic | 80 |
| `apps/web/src/lib/minifig-sync/terapeak-scraper.ts` | Playwright-based Terapeak research | 200 |
| `apps/web/src/lib/minifig-sync/image-sourcer.ts` | Multi-source image hunting + Playwright | 250 |
| `apps/web/src/lib/minifig-sync/image-processor.ts` | Sharp pipeline: resize, bg fill, sharpen, JPEG | 80 |
| `apps/web/src/lib/minifig-sync/listing-generator.ts` | Claude API description generation + fallback | 120 |
| `apps/web/src/lib/minifig-sync/rebrickable-client.ts` | Rebrickable API: minifig details + set appearances | 80 |
| `apps/web/src/lib/minifig-sync/inventory-pull.service.ts` | Bricqer pull + filter + upsert logic | 150 |
| `apps/web/src/lib/minifig-sync/listing-staging.service.ts` | Create eBay inventory item + offer (staged) | 180 |
| `apps/web/src/lib/minifig-sync/removal-queue.service.ts` | Removal queue CRUD + execution | 150 |
| `apps/web/src/lib/minifig-sync/sync-orchestrator.ts` | Coordinates full pipeline phases | 120 |
| `apps/web/src/lib/minifig-sync/job-tracker.ts` | minifig_sync_jobs CRUD helper | 80 |
| **API Routes** | | |
| `apps/web/src/app/api/minifigs/sync/pull-inventory/route.ts` | Pull from Bricqer | 60 |
| `apps/web/src/app/api/minifigs/sync/research/route.ts` | Run market research | 70 |
| `apps/web/src/app/api/minifigs/sync/research/refresh/route.ts` | Force-refresh pricing | 40 |
| `apps/web/src/app/api/minifigs/sync/create-listings/route.ts` | Stage eBay listings | 70 |
| `apps/web/src/app/api/minifigs/sync/publish/route.ts` | Publish staged listings | 60 |
| `apps/web/src/app/api/minifigs/sync/reject/route.ts` | Reject staged listings | 50 |
| `apps/web/src/app/api/minifigs/review/route.ts` | GET staged items for review | 40 |
| `apps/web/src/app/api/minifigs/removals/route.ts` | GET pending removals | 40 |
| `apps/web/src/app/api/minifigs/removals/approve/route.ts` | Approve removals | 80 |
| `apps/web/src/app/api/minifigs/removals/dismiss/route.ts` | Dismiss removals | 30 |
| `apps/web/src/app/api/minifigs/dashboard/route.ts` | Aggregated metrics | 60 |
| `apps/web/src/app/api/cron/minifigs/poll-ebay-orders/route.ts` | Poll eBay orders | 80 |
| `apps/web/src/app/api/cron/minifigs/poll-bricqer-orders/route.ts` | Poll Bricqer orders | 80 |
| `apps/web/src/app/api/cron/minifigs/daily-inventory/route.ts` | Daily inventory pull | 40 |
| `apps/web/src/app/api/cron/minifigs/research-refresh/route.ts` | Refresh expired cache | 60 |
| **UI Pages & Components** | | |
| `apps/web/src/app/(dashboard)/minifigs/page.tsx` | Dashboard page | 80 |
| `apps/web/src/app/(dashboard)/minifigs/loading.tsx` | Dashboard skeleton | 15 |
| `apps/web/src/app/(dashboard)/minifigs/review/page.tsx` | Review queue page | 100 |
| `apps/web/src/app/(dashboard)/minifigs/review/loading.tsx` | Review skeleton | 15 |
| `apps/web/src/app/(dashboard)/minifigs/removals/page.tsx` | Removal queue page | 80 |
| `apps/web/src/app/(dashboard)/minifigs/removals/loading.tsx` | Removal skeleton | 15 |
| `apps/web/src/components/minifigs/MinifigCard.tsx` | Review card with images, data, actions | 180 |
| `apps/web/src/components/minifigs/RemovalCard.tsx` | Removal card with sale details, actions | 120 |
| `apps/web/src/components/minifigs/ImageGallery.tsx` | Image preview with source labels | 80 |
| `apps/web/src/components/minifigs/MarketDataPanel.tsx` | Pricing comparison display | 60 |
| `apps/web/src/components/minifigs/SyncDashboard.tsx` | Overview metric widgets | 100 |
| `apps/web/src/hooks/use-minifig-sync.ts` | TanStack Query hooks for all minifig APIs | 120 |
| **Estimated Total** | | **~3,700 lines** |

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `vercel.json` | Add cron schedules for 4 minifig cron routes | +20 |
| `apps/web/package.json` | Add `sharp` dependency | +1 |
| `packages/database/src/types.ts` | Regenerated (npm run db:types) | Auto |

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `lib/bricqer/client.ts` | Existing `getAllInventoryItems()` sufficient |
| `lib/bricqer/adapter.ts` | Existing `normalizeInventoryItem()` has type mapping |
| `lib/ebay/ebay-api.adapter.ts` | All needed methods exist |
| `lib/bricklink/client.ts` | Existing `getPriceGuide()` works for MINIFIG type |
| `lib/repositories/credentials.repository.ts` | Standard pattern, reuse as-is |
| `lib/notifications/discord.service.ts` | Existing `sendAlert()` sufficient |
| `lib/services/job-execution.service.ts` | Existing service, reuse as-is |

---

## 5. Implementation Details

### 5.1 Database Migration

Single migration file containing all DDL:

```sql
-- 1. minifig_sync_items (main tracking table)
-- 2. minifig_price_cache (6-month TTL pricing cache)
-- 3. minifig_removal_queue (sale removal approval queue)
-- 4. minifig_sync_jobs (job execution tracking)
-- 5. minifig_sync_config (configurable thresholds)
-- Plus: indexes, RLS policies, config seed data
```

**RLS Strategy:** Single-user system. Policies use `auth.uid()` match against a user_id column. The config table uses a simpler "authenticated users can read" policy since it's global config.

### 5.2 Config Service

```typescript
// lib/minifig-sync/config.service.ts
export class MinifigConfigService {
  async getConfig(): Promise<MinifigSyncConfig> {
    // SELECT key, value FROM minifig_sync_config
    // Returns typed object with all threshold values
  }
  async updateConfig(key: string, value: unknown): Promise<void> {
    // UPDATE minifig_sync_config SET value = $1 WHERE key = $2
  }
}
```

All business logic services receive config via this service rather than hardcoding values.

### 5.3 Bricqer Inventory Pull

```typescript
// lib/minifig-sync/inventory-pull.service.ts
export class InventoryPullService {
  async pull(): Promise<PullResult> {
    // 1. Load config for min_bricqer_listing_price
    // 2. Create BricqerClient from credentials
    // 3. Call getAllInventoryItems({ condition: 'U' })
    // 4. Post-filter: normalizeInventoryItem() then filter type === 'Minifig'
    // 5. Post-filter: price >= min_bricqer_listing_price
    // 6. Upsert each into minifig_sync_items (ON CONFLICT bricqer_item_id)
    // 7. Record job in minifig_sync_jobs
  }
}
```

**Key insight:** The Bricqer API's `condition` param accepts `'U'` for used items, which the existing client supports. However, there's no server-side filter for item type (minifig vs part vs set) — that's done by the `legoType` field in the response's `definition` object, so we post-filter using the adapter's `mapLegoType()` which maps `'M'` → `'Minifig'`.

**Bricqer BrickLink ID:** The `definition.legoId` field contains the BrickLink catalog ID (e.g., `sw0001a`). This is the `bricklink_id` we store.

### 5.4 Terapeak Scraper

```typescript
// lib/minifig-sync/terapeak-scraper.ts
export class TerapeakScraper {
  private browser: Browser | null = null;

  async research(name: string, bricklinkId: string): Promise<TerapeakResult | null> {
    // 1. Launch Playwright chromium (headless)
    // 2. Load eBay session cookies from CredentialsRepository
    // 3. Navigate to https://www.ebay.co.uk/sh/research
    // 4. Enter search: `LEGO ${name} ${bricklinkId}`
    // 5. Set filters: Condition=Used, Item type=Sold items
    // 6. Extract: avg sold price, min/max, sold count, active count, avg shipping
    // 7. Calculate sell-through rate
    // 8. Return structured result
  }

  async researchBatch(items: MinifigSyncItem[]): Promise<Map<string, TerapeakResult>> {
    // Sequential processing with 3s minimum delay between calls
    // Detect session expiry (redirect to login page)
    // Abort batch on session expiry
  }
}
```

**Session storage:** eBay session cookies stored under platform `'ebay-terapeak'` in `platform_credentials`. Separate from the OAuth credentials used for API calls.

### 5.5 Pricing Engine

```typescript
// lib/minifig-sync/pricing-engine.ts
export class PricingEngine {
  evaluateThreshold(item: MinifigSyncItem, config: MinifigSyncConfig): boolean {
    // All 4 must pass:
    // 1. sold_count >= config.min_sold_count
    // 2. sell_through_rate >= config.min_sell_through_rate
    // 3. avg_sold_price >= config.min_avg_sold_price
    // 4. calculateProfit() >= config.min_estimated_profit
  }

  calculateProfit(avgSold: number, config: MinifigSyncConfig): number {
    return avgSold - (avgSold * config.ebay_fvf_rate) - avgShipping - config.packaging_cost;
  }

  calculateRecommendedPrice(avgSold: number, maxSold: number, bricqerPrice: number): number {
    const base = Math.round(avgSold * 1.05 * 100) / 100;
    const floor = bricqerPrice + 1.00;
    const ceiling = maxSold;
    return Math.min(Math.max(base, floor), ceiling);
  }

  calculateBestOfferThresholds(price: number): { autoAccept: number; autoDecline: number } {
    return {
      autoAccept: Math.round(price * 0.95 * 100) / 100,
      autoDecline: Math.round(price * 0.75 * 100) / 100,
    };
  }
}
```

### 5.6 Image Sourcing

```typescript
// lib/minifig-sync/image-sourcer.ts
export class ImageSourcer {
  async sourceImages(name: string, bricklinkId: string, bricqerImageUrl?: string): Promise<SourcedImage[]> {
    const images: SourcedImage[] = [];
    const TARGET = 3;

    // 1. Non-stock via Google Images (Playwright)
    if (images.length < TARGET) {
      try {
        const sourced = await this.searchGoogleImages(name, bricklinkId);
        images.push(...sourced.slice(0, TARGET - images.length));
      } catch { /* continue to fallback */ }
    }

    // 2. Rebrickable catalogue
    if (images.length < TARGET) {
      try {
        const rebrickable = await this.getRebrickableImage(bricklinkId);
        if (rebrickable) images.push(rebrickable);
      } catch { /* continue */ }
    }

    // 3. BrickLink catalogue
    if (images.length < TARGET) {
      images.push({
        url: `https://img.bricklink.com/ItemImage/MN/0/${bricklinkId}.png`,
        source: 'bricklink',
        type: 'stock',
      });
    }

    // 4. Bricqer stored image
    if (images.length < TARGET && bricqerImageUrl) {
      images.push({ url: bricqerImageUrl, source: 'bricqer', type: 'original' });
    }

    return images.slice(0, TARGET);
  }
}
```

### 5.7 Image Processing (Sharp)

```typescript
// lib/minifig-sync/image-processor.ts
import sharp from 'sharp';

export async function processImageForEbay(imageBuffer: Buffer): Promise<Buffer> {
  return sharp(imageBuffer)
    .flatten({ background: { r: 255, g: 255, b: 255 } }) // White background for transparent PNGs
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .sharpen({ sigma: 0.5 })
    .jpeg({ quality: 85 })
    .toBuffer();
}
```

### 5.8 Listing Generation (Claude API)

```typescript
// lib/minifig-sync/listing-generator.ts
export class ListingGenerator {
  async generateDescription(item: MinifigSyncItem, sets: RebrickableSet[]): Promise<string> {
    try {
      const response = await sendMessageForJSON({
        model: 'claude-sonnet-4-20250514',
        temperature: 0.3,
        messages: [{ role: 'user', content: buildPrompt(item, sets) }],
      });
      return response.description; // HTML string
    } catch {
      return this.fallbackDescription(item);
    }
  }

  private fallbackDescription(item: MinifigSyncItem): string {
    return `<p>LEGO Minifigure: ${item.name} (${item.bricklink_id})</p>
            <p>Condition: Used - ${item.condition_notes || 'Good condition'}</p>
            <p>Figure only. See photos for actual condition.</p>`;
  }
}
```

### 5.9 eBay Listing Staging

```typescript
// lib/minifig-sync/listing-staging.service.ts
export class ListingStagingService {
  async stageListings(items: MinifigSyncItem[]): Promise<StagingResult> {
    for (const item of items) {
      try {
        // 1. Source and process images
        const images = await imageSourcer.sourceImages(item.name, item.bricklink_id);
        const processedImages = await Promise.all(images.map(processForEbay));

        // 2. Upload images to eBay
        const imageUrls = await uploadToEbay(processedImages);

        // 3. Generate description
        const description = await generator.generateDescription(item, sets);

        // 4. Create eBay inventory item (PUT /inventory_item/{sku})
        const sku = `HB-MF-${item.bricqer_item_id}`;
        await ebayApi.createOrReplaceInventoryItem(sku, { ... });

        // 5. Create offer (POST /offer) — NOT published
        const { offerId } = await ebayApi.createOffer({ sku, ... });

        // 6. Update sync item → STAGED
        await updateSyncItem(item.id, { listing_status: 'STAGED', ebay_sku: sku, ebay_offer_id: offerId });
      } catch (error) {
        // Log error, continue to next item
      }
    }
  }
}
```

### 5.10 Removal Queue Service

```typescript
// lib/minifig-sync/removal-queue.service.ts
export class RemovalQueueService {
  async approveRemoval(removalId: string): Promise<void> {
    const removal = await this.getRemoval(removalId);

    if (removal.remove_from === 'BRICQER') {
      // eBay sale → remove from Bricqer
      try {
        await bricqerClient.deleteInventoryItem(removal.removal_details.bricqer_item_id);
      } catch (error) {
        if (is404(error)) {
          // Race condition: already sold on Bricqer too — mark executed with note
          await this.markExecuted(removalId, 'Item already removed from Bricqer');
          return;
        }
        throw error;
      }
      await this.markExecuted(removalId);
      await this.updateSyncStatus(removal.minifig_sync_id, 'SOLD_EBAY');
    } else {
      // Bricqer sale → end eBay listing
      try {
        await ebayApi.withdrawOffer(removal.removal_details.offer_id);
        await ebayApi.deleteInventoryItem(removal.removal_details.sku);
      } catch (error) {
        if (isAlreadyEnded(error)) {
          await this.markExecuted(removalId, 'eBay listing already ended');
          return;
        }
        throw error;
      }
      await this.markExecuted(removalId);
      await this.updateSyncStatus(removal.minifig_sync_id, 'SOLD_BRICQER');
    }
  }
}
```

### 5.11 Cron Route Pattern

Following the established pattern from `api/cron/bricklink-pricing/route.ts`:

```typescript
// api/cron/minifigs/poll-ebay-orders/route.ts
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // 1. Verify cron secret
  // 2. Start job execution tracking
  // 3. Get last poll cursor from minifig_sync_jobs
  // 4. Poll eBay orders since cursor
  // 5. Filter for HB-MF- SKUs
  // 6. Create removal queue entries
  // 7. Send Discord notification for each new removal
  // 8. Update poll cursor
  // 9. Complete job execution
}
```

### 5.12 Review Queue UI

The review queue page uses a card-based layout (not a table) since each minifig needs images, editable fields, and market data:

```tsx
// app/(dashboard)/minifigs/review/page.tsx
// Server component fetching staged items
// Client components for interactive cards

// MinifigCard.tsx
// - 3 images with source labels in ImageGallery
// - Editable title (contentEditable or input)
// - Editable description (textarea)
// - Price comparison: recommended vs Bricqer vs avg eBay
// - Market data: sold count, sell-through %, avg shipping
// - Actions: [Publish] [Edit] [Reject] [Refresh Pricing]
```

---

## 6. Build Order

Implementation is phased to allow verification checkpoints.

### Step 1: Database Foundation (F1-F5, I7)
1. Create migration with all 5 tables, indexes, RLS policies, config seed
2. Push migration: `npm run db:push`
3. Regenerate types: `npm run db:types`
4. **Verify:** Run SQL queries to confirm tables, columns, indexes, config data

### Step 2: Types & Config Service (I4)
1. Create `types.ts` with all TypeScript interfaces
2. Create `config.service.ts` for reading minifig_sync_config
3. **Verify:** Config service returns all 10 config values

### Step 3: Pricing Engine (F22-F25, I5)
1. Create `pricing-engine.ts` with threshold eval, profit calc, price calc
2. Unit test: profit calculation, price floor/ceiling, Best Offer thresholds
3. **Verify:** All pricing unit tests pass

### Step 4: Bricqer Inventory Pull (F6-F11, E1-E2, P1)
1. Create `inventory-pull.service.ts`
2. Create `job-tracker.ts` for minifig_sync_jobs
3. Create `POST /api/minifigs/sync/pull-inventory` route
4. **Verify:** Pull from Bricqer populates minifig_sync_items; job tracked

### Step 5: Price Cache (F19-F21)
1. Create `price-cache.ts` for cache lookup/upsert/expiry
2. **Verify:** Cache hit prevents re-research; expiry triggers refresh

### Step 6: BrickLink Research (F16)
1. Integrate existing `BrickLinkClient.getPriceGuide('MINIFIG', id)`
2. Populate minifig_sync_items pricing fields from BrickLink data
3. **Verify:** BrickLink data populates cache and sync items

### Step 7: Terapeak Scraper (F12-F15, E3, I6)
1. Create `terapeak-scraper.ts` with Playwright-based research
2. Session cookie management via CredentialsRepository
3. Rate limiting (3s delay between calls)
4. Session expiry detection
5. **Verify:** Terapeak extracts data; falls back to BrickLink on failure

### Step 8: Research API Routes (F17-F18)
1. Create `POST /api/minifigs/sync/research` route
2. Create `POST /api/minifigs/sync/research/refresh` route
3. Wire up: Terapeak primary → BrickLink fallback → cache → threshold eval
4. **Verify:** Research populates all pricing fields; threshold boolean set

### Step 9: Rebrickable Client (F29, F35)
1. Create `rebrickable-client.ts` for minifig lookup + set appearances
2. **Verify:** Returns minifig image URL and set list

### Step 10: Image Sourcing & Processing (F26-F33, E5)
1. Install `sharp` dependency
2. Create `image-sourcer.ts` with multi-source strategy
3. Create `image-processor.ts` with Sharp pipeline
4. **Verify:** 3 images sourced with fallback chain; processed to JPEG 1600px

### Step 11: Listing Generation (F34, E7)
1. Create `listing-generator.ts` with Claude prompt + fallback
2. **Verify:** Generated description is HTML < 300 words

### Step 12: eBay Staging (F36-F39, E6, I1, I2)
1. Create `listing-staging.service.ts`
2. Create `POST /api/minifigs/sync/create-listings` route
3. Wire: image sourcing → processing → description → eBay inventory item → offer (NO publish)
4. **Verify:** Items staged with HB-MF- SKU; publish NOT called; DB status = STAGED

### Step 13: Review Queue UI (F40-F47, P3)
1. Create page at `/minifigs/review`
2. Create components: MinifigCard, ImageGallery, MarketDataPanel
3. Create API routes: review (GET), publish (POST), reject (POST)
4. Implement edit, bulk publish, quality check, refresh pricing
5. **Verify:** All review actions work; quality check enforced

### Step 14: Order Polling (F48-F53, E11, P4)
1. Create eBay order polling cron route
2. Create Bricqer order polling cron route
3. Implement cursor-based incremental polling
4. Create removal queue entries on sale detection
5. **Verify:** Sales detected; removal queue populated; cursor persists

### Step 15: Removal Queue UI (F54-F60, E8-E10, I3)
1. Create page at `/minifigs/removals`
2. Create RemovalCard component
3. Create API routes: removals (GET), approve (POST), dismiss (POST)
4. Implement race condition handling
5. Wire Discord notification on new removal
6. **Verify:** Approve executes cross-platform removal; dismiss does nothing

### Step 16: Cron Schedules (F61-F64)
1. Create daily inventory pull cron route
2. Create research refresh cron route
3. Update `vercel.json` with cron schedules
4. **Verify:** All 4 cron routes respond correctly

### Step 17: Repricing (F65-F66)
1. Add stale listing detection logic
2. Wire repricing to research refresh + price update
3. **Verify:** Listings older than 85 days get repriced

### Step 18: Dashboard (F67-F69)
1. Create page at `/minifigs`
2. Create SyncDashboard component
3. Create dashboard API route with aggregate queries
4. **Verify:** All 6 metrics displayed with correct calculations

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Terapeak HTML structure changes | Medium | High - breaks scraper | Version selectors; detect breakage and alert; BrickLink fallback covers pricing |
| eBay session cookies expire frequently | Medium | Medium - blocks Terapeak | Detect and alert via Discord; manual cookie refresh; BrickLink fallback |
| Google Images blocks Playwright scraping | Medium | Low - images only | Fall back to catalogue images (Rebrickable/BrickLink always available) |
| Sharp build issues on Vercel | Low | High - blocks image processing | Sharp is well-supported on Vercel; fallback to unprocessed images if needed |
| Playwright not available in Vercel serverless | High | High - blocks Terapeak + Google Images | **Run Playwright scrapers locally or via GCP function, not in Vercel** |
| Bricqer API doesn't support DELETE on inventory items | Medium | Low | Fall back to PATCH quantity=0 (spec notes this) |
| Double-sale race condition | Low | Medium | Discord alerts for prompt approval; 404 handling on both sides |

### Critical Risk: Playwright on Vercel

Playwright requires a full Chromium binary (~200MB) which exceeds Vercel's serverless function size limit. The Terapeak scraper and Google Images scraper **cannot run directly in Vercel API routes**.

**Recommended approach:**
- **Option A (Recommended):** Run Playwright-dependent operations (Terapeak research, image sourcing) as standalone Node.js scripts invoked locally or via a GCP Cloud Function (same pattern as `gcp/functions/pricing-sync-driver/`). The API routes trigger the job and the script posts results back.
- **Option B:** Run Playwright on a lightweight VPS/Docker container with an API endpoint.
- **Option C:** Use a headless browser service (Browserless.io, BrowserBase) instead of local Playwright.

**Impact on build order:** Steps 7 (Terapeak) and 10 (image sourcing) need the Playwright runtime solution decided first. The BrickLink fallback (Step 6) provides pricing coverage while Playwright infra is sorted.

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Feature is very large (91 criteria) | Phased build order with checkpoint verification |
| Terapeak scraping is fragile | BrickLink fallback ensures pricing data availability |
| Image sourcing is complex | Catalogue images (Rebrickable + BrickLink) provide reliable baseline |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1-F5: Database | Yes | High | Standard Supabase migration |
| F6-F11: Bricqer pull | Yes | High | Existing client handles pagination and type mapping |
| F12-F15: Terapeak | Yes | Medium | Playwright works but can't run on Vercel — needs separate runtime |
| F16: BrickLink fallback | Yes | High | Existing client has getPriceGuide for MINIFIG type |
| F17-F21: Research + cache | Yes | High | Standard DB operations |
| F22-F25: Pricing | Yes | High | Pure calculation logic |
| F26-F32: Image sourcing | Yes | Medium | Same Playwright constraint as Terapeak |
| F33: Sharp processing | Yes | High | Sharp works on Vercel Node.js runtime |
| F34-F35: Claude descriptions | Yes | High | Existing Claude integration pattern |
| F36-F39: eBay staging | Yes | High | All eBay Inventory API methods exist |
| F40-F47: Review queue | Yes | High | Standard Next.js page + components |
| F48-F53: Order polling | Yes | High | Both eBay and Bricqer order APIs integrated |
| F54-F60: Removal queue | Yes | High | CRUD + API calls |
| F61-F64: Cron routes | Yes | High | Established cron pattern |
| F65-F66: Repricing | Yes | High | Combination of existing capabilities |
| F67-F69: Dashboard | Yes | High | Aggregate SQL queries |
| I1-I7: Integration | Yes | High | Conventions + grep verification |
| P1-P4: Performance | Yes | High | Pagination, rate limiting, cursor-based |
| E1-E11: Error handling | Yes | High | Try/catch + status tracking |

**Issues:** None blocking. The Playwright runtime constraint (F12-F15, F26-F28) requires an architectural decision on where to run browser-dependent operations, but doesn't prevent implementation — BrickLink fallback and catalogue images provide full coverage while Playwright infra is set up.

---

## 9. Notes for Build Agent

### Critical Implementation Notes

1. **Playwright runtime:** Terapeak scraping and Google Images search require Playwright with Chromium. This CANNOT run in Vercel serverless functions due to binary size limits. Implement as a separate Node.js script (like the GCP pricing-sync-driver pattern) or defer Playwright features until runtime infra is ready. Start with BrickLink pricing and catalogue images — they cover all criteria functionality.

2. **Bricqer inventory filtering:** The Bricqer API supports `condition: 'U'` as a query parameter, but there is NO server-side filter for item type (minifig). Use `getAllInventoryItems({ condition: 'U' })` then post-filter using `definition.legoType === 'M'`. The adapter's `mapLegoType()` function already handles this mapping.

3. **Bricqer BrickLink ID:** The field `definition.legoId` on `BricqerInventoryItem` contains the BrickLink catalog ID (e.g., `sw0001a`). Store this as `bricklink_id` in `minifig_sync_items`.

4. **eBay API language headers:** All eBay Inventory API calls MUST use `Accept-Language: en-US` (not en-GB) due to a known eBay API bug. The existing `EbayApiAdapter` already handles this.

5. **SKU format:** Always `HB-MF-${bricqer_item_id}` — the Bricqer item ID is numeric, so SKUs will look like `HB-MF-12345`.

6. **Bricqer delete vs patch:** The spec notes uncertainty about whether Bricqer supports DELETE on inventory items. Verify first; fall back to PATCH with quantity=0 if DELETE returns 405/404.

7. **vercel.json cron syntax:** Vercel requires `crons` array in vercel.json. The existing config has no crons defined (uses GitHub Actions for scheduling). Either add Vercel crons or use the existing GCP/GitHub Actions pattern.

8. **DEFAULT_USER_ID:** Follow the existing cron pattern that uses a hardcoded `DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b'` for service-role operations (single user system).

9. **Image upload to eBay:** Use the existing `EbayImageUploadService` pattern. eBay accepts externally hosted image URLs in inventory items, so if images are publicly accessible (Rebrickable, BrickLink), they can be passed as URLs directly without re-hosting.

10. **Error handling pattern:** All batch operations should use per-item try/catch so one failure doesn't abort the entire batch. Accumulate errors in the job's `error_log` JSONB column.

---

## Feature Spec → Build Feature Handoff

**Feature:** ebay-minifig-sync
**Spec:** `docs/features/ebay-minifig-sync/feature-spec.md`
**Criteria:** `docs/features/ebay-minifig-sync/done-criteria.md` (91 criteria)
**Status:** READY_FOR_BUILD

**Summary:**
- ~44 new files across service layer, API routes, UI pages/components
- ~3,700 lines of new code
- 1 database migration (5 tables)
- 1 new npm dependency (sharp)
- 18-step build order with phased verification

**Key risk:** Playwright cannot run on Vercel — start with BrickLink + catalogue images, add Playwright when runtime is resolved.

**Ready for:** `/build-feature ebay-minifig-sync`
