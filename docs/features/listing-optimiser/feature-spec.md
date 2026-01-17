# Feature Specification: listing-optimiser

**Generated:** 2026-01-17
**Based on:** done-criteria.md (v1.0 - APPROVED)
**Status:** READY_FOR_BUILD

---

## 1. Summary

The Listing Optimiser is a comprehensive eBay listing review and improvement tool that enables users to analyse their active eBay listings for quality issues, receive AI-powered improvement suggestions based on the eBay listing specification, view pricing analysis with profit calculations, and apply approved changes directly to live listings. The feature builds on existing infrastructure including the eBay Trading/Finding API clients, Gemini 3 Pro quality review service, and the Listing Refresh UI patterns for table display and multi-select functionality.

---

## 2. Criteria Mapping

### Core UI (F1-F7)

| Criterion | Implementation Approach |
|-----------|------------------------|
| F1: Listings page at `/listing-optimiser` | New page in `app/(dashboard)/listing-optimiser/page.tsx` using existing `EbayListingRefreshService.getEligibleListings()` pattern |
| F2: Table columns (Title, Price, Age, Views, Watchers, Last Reviewed, Quality Score) | New `OptimiserListingColumns.tsx` extending `EligibleListingsTable` pattern |
| F3: Filter functionality (age, views, watchers, grade, reviewed) | `OptimiserFilters` component with debounced inputs, similar to `RepricingFilters` |
| F4: Sort functionality | Built-in DataTable sorting via @tanstack/react-table |
| F5: Multi-select with checkboxes | Reuse existing row selection pattern from `EligibleListingsTable` |
| F6: Analyse button state | Conditional `disabled` prop based on `selectedRows.length > 0` |
| F7: Empty selection error | Sonner toast with message "Select at least one listing" |

### Analysis (A1-A6)

| Criterion | Implementation Approach |
|-----------|------------------------|
| A1: Fetch listing data via GetItem | Extend `EbayTradingClient` with existing `getItem()` method |
| A2: Gemini 3 Pro model | Use existing `ListingQualityReviewService` with `gemini-3-pro-preview` |
| A3: 5-category scoring (Title 25, Specifics 20, Description 25, Condition 15, SEO 15) | Modify `createQualityReviewPrompt` to include existing listing analysis |
| A4: eBay listing specification alignment | Extend prompt to reference `docs/ebay-listing-specification.md` rules |
| A5: Overall score and grade | Existing `QualityReviewResponse` interface already provides these |
| A6: Improvement suggestions per category | Extend AI response to include `suggestedChanges` with field-level replacements |

### Suggestions Display (S1-S4)

| Criterion | Implementation Approach |
|-----------|------------------------|
| S1: Title suggestion format (replacement + explanation) | New `SuggestionCard` component showing both values |
| S2: Side-by-side view (current vs suggested) | Two-column layout using grid/flex within suggestion card |
| S3: Approve/Skip buttons | Button pair per suggestion with onClick handlers |
| S4: One-by-one approval flow | State-driven wizard stepping through suggestions array |

### Pricing Analysis (PR1-PR7)

| Criterion | Implementation Approach |
|-----------|------------------------|
| PR1: Competitor data via Finding API | Extend `EbayFindingClient` with `findActiveItems()` for live competition |
| PR2: Sold data via Finding API | Use existing `findCompletedItems()` method |
| PR3: Display 4 pricing metrics | `PricingAnalysisCard` component showing current/avg competitor/avg sold/suggested |
| PR4: Profit estimate using `calculateEbayProfit()` | Create new eBay-specific profit calculation function |
| PR5: Profit margin percentage | Simple calculation: `(profit / price) * 100` |
| PR6: Cost from linked inventory | Query `inventory_items` via `ebay_listing_id` relationship |
| PR7: No cost fallback | Conditional rendering: "No cost data" message when unlinked |

### Apply Changes (AP1-AP4)

| Criterion | Implementation Approach |
|-----------|------------------------|
| AP1: ReviseItem API | Add `reviseItem()` method to `EbayTradingClient` |
| AP2: Success confirmation toast | Sonner toast after successful API response |
| AP3: Auto re-analysis after changes | Trigger `analyseListings()` after last approved change applied |
| AP4: Score comparison (old → new) | Store previous score in state, display delta in results UI |

### Dashboard/Summary (D1-D5)

| Criterion | Implementation Approach |
|-----------|------------------------|
| D1: Total listings count | Summary bar stat from `listings.length` |
| D2: Reviewed count | Filter by `quality_score IS NOT NULL` or `last_reviewed_at IS NOT NULL` |
| D3: Average score | Calculate from reviewed listings array |
| D4: Low score count (< 70) | Filter by `quality_score < 70` |
| D5: Dynamic updates after analysis | React Query invalidation triggers re-render |

### Data Persistence (DP1-DP5)

| Criterion | Implementation Approach |
|-----------|------------------------|
| DP1: `last_reviewed_at` timestamp | Store on `ebay_listing_cache` or new cache table |
| DP2: `last_updated_at` timestamp | Store when ReviseItem succeeds |
| DP3: `quality_score` (0-100) | Store numeric score from analysis |
| DP4: `quality_grade` (A+/A/B/C/D/F) | Store grade string from analysis |
| DP5: Historical reviews in `listing_quality_reviews` | Insert new row per analysis (see migration) |

### Error Handling (E1-E4)

| Criterion | Implementation Approach |
|-----------|------------------------|
| E1: Listing fetch error with retry | Toast with "Retry" action button triggering refetch |
| E2: ReviseItem error with eBay message | Toast showing eBay error message, listing unchanged |
| E3: AI analysis error with retry | Toast with "Retry" action, error state in UI |
| E4: Pricing API error with retry | Fallback message in pricing section, retry button |

### Performance (P1-P3)

| Criterion | Implementation Approach |
|-----------|------------------------|
| P1: Listing fetch < 30s for 500 listings | Use existing paginated `getAllActiveListings()` |
| P2: Analysis < 90s per listing | Gemini 3 Pro with ThinkingLevel.HIGH typically 30-60s |
| P3: Apply changes < 10s per change | Single ReviseItem API call ~2-5s |

### Integration (I1-I3)

| Criterion | Implementation Approach |
|-----------|------------------------|
| I1: Existing eBay OAuth | Use `ebayAuthService.getAccessToken()` |
| I2: Connection required | Check connection status, show connect prompt if missing |
| I3: Inventory linking via `ebay_listing_id` | Join query on inventory_items table |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UI Layer                                        │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ /listing-optimiser/page.tsx                                            │ │
│  │                                                                        │ │
│  │  ┌────────────────┐ ┌─────────────────────────────────────────────┐   │ │
│  │  │ OptimiserStats │ │ OptimiserListingsTable                      │   │ │
│  │  │ (Summary bar)  │ │                                             │   │ │
│  │  │ Total|Reviewed │ │ [Title][Price][Age][Views][Watch][Rev][Scr] │   │ │
│  │  │ Avg|Low        │ │ [x] Listing 1...                            │   │ │
│  │  └────────────────┘ │ [x] Listing 2...                            │   │ │
│  │                     │ [ ] Listing 3...                            │   │ │
│  │  ┌────────────────┐ │                                             │   │ │
│  │  │ OptimiserFilters│ │ [Analyse Selected (2)]                     │   │ │
│  │  │ Age|Views|etc  │ └─────────────────────────────────────────────┘   │ │
│  │  └────────────────┘                                                    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    │ onClick: handleAnalyse()                │
│                                    ▼                                         │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │ AnalysisModal / AnalysisPanel                                         │ │
│  │                                                                        │ │
│  │  ┌────────────────────┐  ┌──────────────────────────────────────┐    │ │
│  │  │ SuggestionFlow     │  │ PricingAnalysisCard                  │    │ │
│  │  │                    │  │                                      │    │ │
│  │  │ Current | Suggested│  │ Current: £99.99                      │    │ │
│  │  │ ───────────────────│  │ Avg Competitor: £89.99               │    │ │
│  │  │ "LEGO..."│"NEW LE.."│  │ Avg Sold: £85.00                     │    │ │
│  │  │         │          │  │ Suggested: £87.99                     │    │ │
│  │  │ [Skip] [Approve]   │  │ Est. Profit: £22.34 (25.4%)          │    │ │
│  │  └────────────────────┘  └──────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ GET /api/listing-optimiser                                           │   │
│  │ - Fetch all active eBay listings with quality metrics                │   │
│  │ - Join inventory data for cost info                                  │   │
│  │ - Return with cached quality scores                                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ POST /api/listing-optimiser/analyse                                  │   │
│  │ - Fetch full listing details via GetItem                             │   │
│  │ - Run Gemini analysis with specification rules                       │   │
│  │ - Fetch pricing data via Finding API                                 │   │
│  │ - Store review in listing_quality_reviews                            │   │
│  │ - Return analysis with suggestions                                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ POST /api/listing-optimiser/apply                                    │   │
│  │ - Apply approved changes via ReviseItem                              │   │
│  │ - Update last_updated_at timestamp                                   │   │
│  │ - Return success/failure                                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Service Layer                                      │
│                                                                             │
│  ┌──────────────────────────┐  ┌────────────────────────────────────────┐  │
│  │ ListingOptimiserService  │  │ ListingQualityReviewService (existing) │  │
│  │                          │  │                                        │  │
│  │ - getListingsWithMetrics │  │ - reviewListing()                      │  │
│  │ - analyseListings()      │  │ - quickValidate()                      │  │
│  │ - applyChanges()         │  └────────────────────────────────────────┘  │
│  │ - getPricingAnalysis()   │                                              │
│  └──────────────────────────┘  ┌────────────────────────────────────────┐  │
│                                │ EbayTradingClient (extended)            │  │
│  ┌──────────────────────────┐  │                                        │  │
│  │ EbayFindingClient        │  │ + reviseItem()                         │  │
│  │ (existing)               │  │ + getSellerList() (for all listings)   │  │
│  │                          │  └────────────────────────────────────────┘  │
│  │ - findCompletedItems()   │                                              │
│  │ + findActiveCompetitors()│                                              │
│  └──────────────────────────┘                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Data Layer                                         │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ listing_quality_reviews (NEW TABLE)                                    ││
│  │                                                                        ││
│  │ id | user_id | ebay_listing_id | quality_score | quality_grade |       ││
│  │ breakdown (JSONB) | suggestions (JSONB) | pricing_analysis (JSONB) |   ││
│  │ reviewed_at | created_at                                               ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ ebay_listing_cache (NEW TABLE - optional, could use reviews latest)    ││
│  │                                                                        ││
│  │ id | user_id | ebay_listing_id | title | price | listing_start_date |  ││
│  │ views | watchers | quality_score | quality_grade | last_reviewed_at |  ││
│  │ last_updated_at | inventory_item_id (FK) | synced_at                   ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐│
│  │ inventory_items (EXISTING)                                             ││
│  │                                                                        ││
│  │ - ebay_listing_id (for linking)                                        ││
│  │ - cost (for profit calculation)                                        ││
│  └────────────────────────────────────────────────────────────────────────┘│
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Technology Decisions

#### AI Analysis Model

**Decision:** Use existing `gemini-3-pro-preview` with `ThinkingLevel.HIGH`

**Rationale:**
- Already proven for quality review in `ListingQualityReviewService`
- Extended thinking produces more nuanced analysis
- Consistent with existing listing creation workflow
- 30-60 second response time acceptable for single listing analysis

#### Suggestion Generation

**Decision:** Extend AI prompt to return structured `suggestedChanges` array

```typescript
interface SuggestedChange {
  field: 'title' | 'description' | 'itemSpecifics' | 'price';
  currentValue: string;
  suggestedValue: string;
  reason: string;
  category: 'title' | 'itemSpecifics' | 'description' | 'conditionAccuracy' | 'seoOptimization';
  impactScore: number; // 1-10, how much this change would improve score
}
```

**Rationale:**
- Structured output allows one-by-one approval flow
- Field-level changes map directly to ReviseItem API fields
- Reason text satisfies S1 requirement for explanation
- Impact score helps prioritize most valuable changes

#### Pricing Data Source

**Decision:** Use Finding API for both competitors and sold data

| Data Type | API Method | Notes |
|-----------|------------|-------|
| Active Competitors | `findItemsAdvanced` | Filter by same category/keywords |
| Sold History | `findCompletedItems` (existing) | Last 90 days sold prices |

**Rationale:**
- Finding API is already integrated
- Same client can handle both queries
- No additional API credentials needed
- Browse API requires different OAuth scope

#### Profit Calculation

**Decision:** Create eBay-specific fee calculation function extending Amazon pattern

```typescript
function calculateEbayProfit(
  salePrice: number,
  costPrice: number,
  categoryId: string
): EbayProfitBreakdown {
  // eBay fees (typical for LEGO category):
  // - Final Value Fee: 12.8% (varies by category)
  // - Per-order fee: £0.30
  // - Promoted listings (optional): 2-5%
}
```

**Rationale:**
- Follows established pattern from `calculations.ts`
- eBay fees differ from Amazon, need separate function
- Can expand to handle promoted listings if needed

#### Listing Data Caching

**Decision:** Create `ebay_listing_cache` table rather than re-fetching every time

**Rationale:**
- eBay GetMyeBaySelling API is slow (paginated, rate limited)
- Cache enables summary stats without API calls
- Quality scores persist across sessions
- Manual sync button for fresh data when needed

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/app/(dashboard)/listing-optimiser/page.tsx` | Main page component | 150-200 |
| `apps/web/app/(dashboard)/listing-optimiser/loading.tsx` | Loading skeleton | 20-30 |
| `apps/web/app/api/listing-optimiser/route.ts` | GET listings API | 80-100 |
| `apps/web/app/api/listing-optimiser/analyse/route.ts` | POST analyse API | 120-150 |
| `apps/web/app/api/listing-optimiser/apply/route.ts` | POST apply changes API | 80-100 |
| `apps/web/src/components/features/listing-optimiser/OptimiserListingsTable.tsx` | Data table with columns | 200-250 |
| `apps/web/src/components/features/listing-optimiser/OptimiserColumns.tsx` | Column definitions | 150-180 |
| `apps/web/src/components/features/listing-optimiser/OptimiserFilters.tsx` | Filter controls | 120-150 |
| `apps/web/src/components/features/listing-optimiser/OptimiserStats.tsx` | Summary bar | 80-100 |
| `apps/web/src/components/features/listing-optimiser/AnalysisPanel.tsx` | Analysis results display | 200-250 |
| `apps/web/src/components/features/listing-optimiser/SuggestionFlow.tsx` | One-by-one approval wizard | 150-180 |
| `apps/web/src/components/features/listing-optimiser/SuggestionCard.tsx` | Single suggestion display | 100-120 |
| `apps/web/src/components/features/listing-optimiser/PricingAnalysisCard.tsx` | Pricing display | 100-120 |
| `apps/web/src/components/features/listing-optimiser/ScoreComparison.tsx` | Before/after scores | 50-60 |
| `apps/web/src/components/features/listing-optimiser/index.ts` | Barrel exports | 15-20 |
| `apps/web/src/lib/ebay/listing-optimiser.service.ts` | Main service class | 300-400 |
| `apps/web/src/lib/ebay/listing-optimiser.types.ts` | TypeScript types | 100-120 |
| `apps/web/src/lib/ebay/ebay-profit.ts` | eBay fee calculation | 80-100 |
| `apps/web/src/lib/ai/prompts/analyse-existing-listing.ts` | New AI prompt | 150-180 |
| `apps/web/src/hooks/use-listing-optimiser.ts` | React Query hooks | 150-180 |
| `supabase/migrations/YYYYMMDD_add_listing_quality_reviews.sql` | New table migration | 50-60 |
| `supabase/migrations/YYYYMMDD_add_ebay_listing_cache.sql` | Cache table migration | 60-80 |

**Total new files:** 22
**Estimated new lines:** ~2,400-3,000

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/lib/ebay/ebay-trading.client.ts` | Add `reviseItem()` method | 50-70 |
| `apps/web/src/lib/ebay/ebay-finding.client.ts` | Add `findActiveItems()` for competitors | 40-50 |
| `apps/web/src/lib/ebay/types.ts` | Add ReviseItem types | 30-40 |
| `apps/web/src/lib/ai/prompts/review-listing-quality.ts` | Extend for existing listing analysis | 50-80 |
| `apps/web/src/lib/ebay/listing-quality-review.service.ts` | Add `analyseExistingListing()` method | 60-80 |
| `apps/web/app/(dashboard)/layout.tsx` | Add navigation link (if sidebar) | 5-10 |
| `packages/database/src/types.ts` | Regenerate types after migration | Auto-generated |

**Total modified files:** 7
**Estimated lines changed:** ~235-330

### 4.3 No Changes Needed

| File | Reason |
|------|--------|
| `ebay-api.adapter.ts` | Using Trading Client, not REST Inventory API |
| `ebay-auth.service.ts` | Existing auth flow sufficient |
| `ebay-listing-refresh.service.ts` | Separate feature, no shared logic needed |
| `inventory.repository.ts` | Query via API route, not direct repository use |

---

## 5. Implementation Details

### 5.1 Components

#### OptimiserListingsTable

**Location:** `apps/web/src/components/features/listing-optimiser/OptimiserListingsTable.tsx`

**Props:**
```typescript
interface OptimiserListingsTableProps {
  listings: OptimiserListing[];
  isLoading: boolean;
  onAnalyse: (selectedIds: string[]) => void;
  selectedRows: Record<string, boolean>;
  onSelectionChange: (selection: Record<string, boolean>) => void;
}
```

**Behavior:**
- Renders DataTable with 7 columns per F2
- Supports multi-select via checkboxes
- Analyse button in toolbar, disabled when no selection
- Empty state shows "No listings found" message

**UI Pattern:**
- Reuse `EligibleListingsTable` column structure
- Add new columns for Last Reviewed, Quality Score
- Quality Score shows colored badge (green A/B, yellow C, red D/F)

#### SuggestionFlow

**Location:** `apps/web/src/components/features/listing-optimiser/SuggestionFlow.tsx`

**Props:**
```typescript
interface SuggestionFlowProps {
  suggestions: SuggestedChange[];
  onApprove: (suggestion: SuggestedChange) => Promise<void>;
  onSkip: (suggestion: SuggestedChange) => void;
  onComplete: () => void;
}
```

**Behavior:**
- Shows one suggestion at a time (per S4)
- Tracks current index in local state
- "Approve" calls API, shows loading, advances on success
- "Skip" advances immediately without API call
- Shows progress indicator (1 of 5, etc.)
- Calls `onComplete` when all suggestions processed

#### PricingAnalysisCard

**Location:** `apps/web/src/components/features/listing-optimiser/PricingAnalysisCard.tsx`

**Props:**
```typescript
interface PricingAnalysisCardProps {
  currentPrice: number;
  avgCompetitorPrice: number | null;
  avgSoldPrice: number | null;
  suggestedPrice: number | null;
  costPrice: number | null;
  profitBreakdown: EbayProfitBreakdown | null;
  onPriceChange?: (newPrice: number) => void;
}
```

**Behavior:**
- Displays 4 pricing metrics per PR3
- Shows profit and margin when costPrice available (PR4, PR5)
- Shows "No cost data" fallback when costPrice is null (PR7)
- Optional price adjustment slider/input

### 5.2 API Endpoints

#### GET /api/listing-optimiser

**Purpose:** Fetch all active listings with quality metrics

**Authentication:** Required (Supabase auth)

**Request:**
```
GET /api/listing-optimiser?minAge=0&hasWatchers=true&grade=C,D,F
```

**Query Parameters:**
- `minAge`: number (days)
- `maxViews`: number
- `minViews`: number
- `hasWatchers`: boolean
- `grade`: comma-separated grades (A+,A,B,C,D,F)
- `reviewed`: 'reviewed' | 'not_reviewed'

**Response (Success):**
```json
{
  "listings": [
    {
      "itemId": "123456789012",
      "title": "LEGO Star Wars...",
      "price": 99.99,
      "currency": "GBP",
      "listingStartDate": "2025-10-01T00:00:00Z",
      "ageDays": 108,
      "views": 234,
      "watchers": 5,
      "qualityScore": 72,
      "qualityGrade": "C",
      "lastReviewedAt": "2026-01-10T14:30:00Z",
      "lastUpdatedAt": null,
      "inventoryItemId": "uuid-123",
      "costPrice": 45.00,
      "viewItemUrl": "https://www.ebay.co.uk/itm/123456789012"
    }
  ],
  "summary": {
    "total": 125,
    "reviewed": 45,
    "averageScore": 68.5,
    "lowScoreCount": 28
  }
}
```

#### POST /api/listing-optimiser/analyse

**Purpose:** Run AI analysis on selected listings

**Request:**
```json
{
  "listingIds": ["123456789012", "123456789013"]
}
```

**Response (Success):**
```json
{
  "results": [
    {
      "listingId": "123456789012",
      "analysis": {
        "score": 72,
        "grade": "C",
        "breakdown": {
          "title": { "score": 18, "maxScore": 25, "feedback": "Title is 65 chars..." },
          "itemSpecifics": { "score": 15, "maxScore": 20, "feedback": "Missing recommended..." },
          "description": { "score": 20, "maxScore": 25, "feedback": "Good structure..." },
          "conditionAccuracy": { "score": 12, "maxScore": 15, "feedback": "Accurate mapping..." },
          "seoOptimization": { "score": 7, "maxScore": 15, "feedback": "Could improve..." }
        },
        "suggestedChanges": [
          {
            "field": "title",
            "currentValue": "LEGO Star Wars Set 75192",
            "suggestedValue": "NEW LEGO Star Wars Millennium Falcon 75192 UCS 7541 Pieces Factory Sealed",
            "reason": "Added set name, piece count, condition status",
            "category": "title",
            "impactScore": 8
          }
        ]
      },
      "pricing": {
        "currentPrice": 99.99,
        "avgCompetitorPrice": 89.99,
        "avgSoldPrice": 85.00,
        "suggestedPrice": 87.99,
        "competitorCount": 12,
        "soldCount": 28
      }
    }
  ]
}
```

#### POST /api/listing-optimiser/apply

**Purpose:** Apply approved change to eBay listing

**Request:**
```json
{
  "listingId": "123456789012",
  "changes": {
    "title": "NEW LEGO Star Wars Millennium Falcon 75192 UCS 7541 Pieces Factory Sealed"
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "listingId": "123456789012",
  "updatedFields": ["title"],
  "updatedAt": "2026-01-17T15:30:00Z"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "eBay error: Title exceeds 80 characters",
  "errorCode": "21916664"
}
```

### 5.3 Data Flow

#### Analysis Flow

```
1. User selects listings in table
2. User clicks "Analyse" button
   └─► Check selection count (F7: toast if 0)

3. POST /api/listing-optimiser/analyse with listing IDs
   └─► Show loading state in UI

4. API Route processing:
   4a. For each listing ID:
       - GetItem via Trading API (A1)
       - Build analysis prompt with specification rules (A4)
       - Call Gemini 3 Pro (A2)
       - Parse scoring breakdown (A3)
       - Generate suggestions (A6)

   4b. Fetch pricing data:
       - findActiveItems for competitors (PR1)
       - findCompletedItems for sold (PR2)
       - Calculate averages

   4c. If inventory linked:
       - Get cost_price from inventory (PR6)
       - Calculate profit with calculateEbayProfit (PR4)

   4d. Store in listing_quality_reviews (DP5)
   4e. Update cache table (DP1-DP4)

5. Return analysis results to UI
   └─► Display AnalysisPanel with suggestions

6. User reviews suggestions one-by-one (S4):
   - View side-by-side (S2)
   - Click Approve or Skip (S3)

7. On Approve:
   - POST /api/listing-optimiser/apply
   - ReviseItem API call (AP1)
   - Toast success (AP2)
   - Update last_updated_at (DP2)

8. After all suggestions:
   - Auto re-analyse (AP3)
   - Show score comparison (AP4)
```

---

## 6. Build Order

Given criteria dependencies, build in this order:

### Step 1: Database Schema
Create migrations for `listing_quality_reviews` and optional `ebay_listing_cache` tables.
- Run: `npx supabase migration new add_listing_quality_reviews`
- Push: `npm run db:push`
- Generate types: `npm run db:types`

**Validates:** DP1-DP5

### Step 2: eBay Client Extensions
Add `reviseItem()` to Trading Client and extend Finding Client.
- Extend `EbayTradingClient` with ReviseItem Trading API call
- Add `findActiveItems()` for competitor lookup

**Validates:** AP1, PR1

### Step 3: AI Prompt Extension
Create new prompt for analysing existing listings.
- Extend quality review prompt for live listing context
- Include eBay specification rules
- Add structured suggestion output

**Validates:** A2, A3, A4, A6

### Step 4: Service Layer
Create `ListingOptimiserService` orchestrating all operations.
- Implement `getListingsWithMetrics()`
- Implement `analyseListings()`
- Implement `applyChanges()`
- Create eBay profit calculation

**Validates:** A1, A5, PR2, PR4, PR5, PR6, PR7

### Step 5: API Routes
Create all three API endpoints.
- GET /api/listing-optimiser
- POST /api/listing-optimiser/analyse
- POST /api/listing-optimiser/apply

**Validates:** E1, E2, E3, E4, P1, P2, P3

### Step 6: UI Components
Build components bottom-up.
1. `OptimiserColumns.tsx` - column definitions
2. `OptimiserFilters.tsx` - filter controls
3. `OptimiserStats.tsx` - summary bar
4. `SuggestionCard.tsx` - individual suggestion
5. `PricingAnalysisCard.tsx` - pricing display
6. `ScoreComparison.tsx` - before/after
7. `SuggestionFlow.tsx` - approval wizard
8. `AnalysisPanel.tsx` - full analysis view
9. `OptimiserListingsTable.tsx` - main table

**Validates:** F2, F3, F4, F5, S1, S2, S3, S4, PR3

### Step 7: Page Integration
Wire everything together in the main page.
- Create `page.tsx` with layout
- Create `loading.tsx` skeleton
- Add React Query hooks
- Handle auth/connection state

**Validates:** F1, F6, F7, D1-D5, I1, I2, I3

### Step 8: Polish & Error Handling
Final refinements and error states.
- Add toast notifications
- Add retry buttons on errors
- Test empty states
- Verify all criteria

**Validates:** E1-E4, AP2, AP3, AP4

---

## 7. Risk Assessment

### Technical Risks

#### Risk 1: GetItem API Rate Limiting
**Criteria affected:** A1, P2
**Risk:** Analysing many listings may hit eBay rate limits
**Probability:** Medium
**Mitigation:**
- Process listings sequentially with 150ms delay
- Show progress indicator during analysis
- Allow cancellation of batch analysis
**Fallback:** Limit batch size to 10 listings at a time

#### Risk 2: Gemini Response Time Variability
**Criteria affected:** P2
**Risk:** ThinkingLevel.HIGH can take 30-90 seconds, may exceed 90s for complex listings
**Probability:** Medium
**Mitigation:**
- Show "This may take up to 90 seconds" message
- Use streaming response if available
- Cache analysis results to avoid re-running
**Fallback:** Reduce ThinkingLevel to MEDIUM if consistently slow

#### Risk 3: ReviseItem Field Validation
**Criteria affected:** AP1, E2
**Risk:** eBay may reject changes that AI suggests (title length, invalid characters, etc.)
**Probability:** Medium
**Mitigation:**
- Validate title length < 80 chars before sending
- Strip prohibited characters in prompt
- Show specific eBay error messages to user
**Fallback:** Manual review option for rejected changes

#### Risk 4: Stale Listing Data
**Criteria affected:** F1, A1
**Risk:** Cached listings may be out of sync with eBay
**Probability:** Low (listings don't change frequently)
**Mitigation:**
- Show "Last synced" timestamp
- Add "Refresh" button for manual sync
- Auto-refresh before analysis
**Fallback:** Always fetch fresh data during analysis

#### Risk 5: Finding API Rate Limits for Pricing
**Criteria affected:** PR1, PR2, E4
**Risk:** Rate limited during batch pricing analysis
**Probability:** High (Finding API has strict limits)
**Mitigation:**
- Existing `rateLimited: true` response handling
- Cache pricing data for 24 hours
- Show "pricing unavailable" gracefully
**Fallback:** Skip pricing for rate-limited items, retry later

### Scope Risks

#### Risk 6: Feature Creep - Image Analysis
**Risk:** Temptation to add image quality analysis
**Mitigation:** Out of scope per done-criteria. Image count only, no AI quality check.
**Notes:** Can be added in future iteration.

#### Risk 7: Feature Creep - Batch Approval
**Risk:** Users may want "Approve All" button
**Mitigation:** Out of scope per S4 (one-by-one approval only).
**Notes:** Deliberate design choice for careful review.

### Integration Risks

#### Risk 8: Inventory Linking Gaps
**Criteria affected:** I3, PR6, PR7
**Risk:** Many listings may not be linked to inventory
**Probability:** High (depends on user's workflow)
**Mitigation:**
- Graceful fallback to "No cost data" message
- Still show competitor/sold pricing
- Suggest linking in UI
**Fallback:** Feature works without inventory link, just no profit calc

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Page exists | ✅ Yes | High | Standard Next.js route |
| F2: Table columns | ✅ Yes | High | Extend existing pattern |
| F3: Filter functionality | ✅ Yes | High | Existing pattern in repricing |
| F4: Sort functionality | ✅ Yes | High | Built-in DataTable feature |
| F5: Multi-select | ✅ Yes | High | Existing pattern |
| F6: Analyse button state | ✅ Yes | High | Simple conditional |
| F7: Empty selection error | ✅ Yes | High | Sonner toast |
| A1: GetItem fetch | ✅ Yes | High | Existing Trading Client |
| A2: Gemini 3 Pro | ✅ Yes | High | Already integrated |
| A3: 5-category scoring | ✅ Yes | High | Existing prompt structure |
| A4: Specification alignment | ✅ Yes | High | Prompt can include spec |
| A5: Overall score/grade | ✅ Yes | High | Existing response format |
| A6: Improvement suggestions | ✅ Yes | High | Extend prompt output |
| S1: Title suggestion format | ✅ Yes | High | UI display of two fields |
| S2: Side-by-side view | ✅ Yes | High | CSS grid/flex layout |
| S3: Approve/Skip buttons | ✅ Yes | High | Standard buttons |
| S4: One-by-one approval | ✅ Yes | High | State-driven wizard |
| PR1: Competitor data | ✅ Yes | Medium | Need to add findActiveItems |
| PR2: Sold data | ✅ Yes | High | Existing method |
| PR3: 4 pricing metrics | ✅ Yes | High | UI display |
| PR4: Profit estimate | ✅ Yes | High | Create eBay fee function |
| PR5: Profit margin | ✅ Yes | High | Simple calculation |
| PR6: Cost from inventory | ✅ Yes | Medium | Requires working inventory linking |
| PR7: No cost fallback | ✅ Yes | High | Conditional render |
| AP1: ReviseItem API | ✅ Yes | Medium | Need to add method |
| AP2: Success confirmation | ✅ Yes | High | Sonner toast |
| AP3: Auto re-analysis | ✅ Yes | High | Trigger after apply |
| AP4: Score comparison | ✅ Yes | High | Store previous in state |
| D1-D5: Summary stats | ✅ Yes | High | Calculated from data |
| DP1-DP5: Data persistence | ✅ Yes | High | Standard Supabase tables |
| E1-E4: Error handling | ✅ Yes | High | Toast + retry pattern |
| P1: < 30s for 500 listings | ✅ Yes | Medium | Depends on eBay API speed |
| P2: < 90s per analysis | ✅ Yes | Medium | Gemini typically 30-60s |
| P3: < 10s per apply | ✅ Yes | High | Single API call |
| I1-I3: Integration | ✅ Yes | High | Existing services |

**Issues:** None - all criteria are feasible with planned approach.

---

## 9. Notes for Build Agent

### Key Patterns to Follow

1. **Use existing EligibleListingsTable** as the foundation for OptimiserListingsTable - it already handles multi-select, column sorting, and eBay listing display.

2. **Extend ListingQualityReviewService** rather than creating new AI service - the existing service has proper Gemini client initialization and error handling.

3. **Follow RepricingFilters pattern** for the filter component - it already handles debounced search and filter state.

4. **Use Sonner toasts** (not shadcn toast) - that's the established pattern in this codebase.

5. **React Query key pattern**: Use `['listing-optimiser', 'listings']` for list, `['listing-optimiser', 'analysis', listingId]` for individual analysis.

### Trading API Note

The `reviseItem()` method needs to call the eBay Trading API `ReviseFixedPriceItem` endpoint (not the REST Inventory API). Follow the pattern in `EbayTradingClient.addFixedPriceItem()` for XML request building.

### Database Considerations

- The `listing_quality_reviews` table should have RLS policies allowing users to only access their own reviews
- Index on `(user_id, ebay_listing_id)` for efficient lookups
- Index on `reviewed_at DESC` for chronological queries

### API Route Auth Pattern

```typescript
// Standard pattern for all routes
const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

### Performance Tips

- Don't fetch all listings in one query - use the same pagination as `EbayListingRefreshService.getEligibleListings()`
- Cache pricing data to avoid repeated Finding API calls
- Consider SSE streaming for batch analysis progress (like listing creation uses)

---

**End of Feature Specification**
