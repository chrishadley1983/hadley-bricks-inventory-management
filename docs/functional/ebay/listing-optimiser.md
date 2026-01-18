# User Journey: Listing Optimiser

> **Journey:** Analyse and improve existing eBay listings with AI
> **Entry Point:** `/listing-optimiser`
> **Complexity:** High

## Overview

The Listing Optimiser provides AI-powered analysis of existing eBay listings using Gemini 3 Pro. It scores listings across multiple categories, generates actionable improvement suggestions, and allows one-click application of changes directly to eBay.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Listing Optimiser                              │
├─────────────────────────────────────────────────────────────────────┤
│  [Optimiser]  [Offers]                                              │
├─────────────────────────────────────────────────────────────────────┤
│  Review and optimize your eBay listings to improve quality scores  │
│  and visibility. Select listings and click Analyse.                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Summary: 523 listings | 156 reviewed | Avg: 72.3 | 23 low score   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ [Search...]  [Grade ▼]  [Reviewed ▼]  [Min Age ▼]            │  │
│  │                                                               │  │
│  │ 3 selected                              [Analyse Selected]    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ ☐ │ Title           │ Price  │ Age │ Views │ Score │ Grade  │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │ ☐ │ LEGO 75192 Mill │ £599.99│ 45d │ 1,234 │  85   │  A     │  │
│  │ ☑ │ LEGO 10281 Bons │ £45.99 │ 12d │   456 │  62   │  C     │  │
│  │ ☑ │ LEGO 42141 McLa │ £149.99│ 30d │   789 │  71   │  B     │  │
│  │ ☐ │ LEGO 60198 Frei │ £159.99│ 60d │ 2,100 │   -   │   -    │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Quality Grades

| Grade | Score | Description | Colour |
|-------|-------|-------------|--------|
| A+ | 95-100 | Excellent | Green |
| A | 85-94 | Very Good | Green |
| B | 75-84 | Good | Yellow |
| C | 60-74 | Needs Work | Orange |
| D | 40-59 | Poor | Red |
| F | 0-39 | Critical | Red |

### Scoring Categories

| Category | Weight | What's Assessed |
|----------|--------|-----------------|
| Title | 25% | Keywords, length, readability |
| Item Specifics | 25% | Completeness, accuracy |
| Description | 20% | Content quality, formatting |
| Condition Accuracy | 15% | Matches actual condition |
| SEO Optimization | 15% | Search visibility factors |

### Suggestion Categories

| Category | Examples |
|----------|----------|
| title | Keyword additions, length optimisation |
| description | Content improvements, formatting |
| itemSpecifics | Missing or incorrect specifics |
| condition | Condition description updates |
| seo | Category changes, visibility improvements |

---

## Steps

### 1. View Listings Table

**Action:** Navigate to `/listing-optimiser`

**What's Shown:**
- Listings from `platform_listings` with eBay data
- Quality scores and grades (if reviewed)
- Listing age, views, watchers
- Checkbox selection for bulk analysis

### 2. Filter Listings

**Action:** Use filter controls

**Available Filters:**
| Filter | Options |
|--------|---------|
| Search | Title, SKU, Item ID |
| Grade | All, A+, A, B, C, D, F |
| Reviewed | All, Reviewed, Not Reviewed |
| Min Age | Days since listing started |
| Min/Max Views | View count range |
| Has Watchers | Yes / No |

### 3. Select and Analyse

**Action:** Check listings and click "Analyse Selected"

**Analysis Process:**
1. Fetch full listing data from eBay Trading API
2. Get inventory data if linked via SKU
3. Fetch recently applied suggestions (to avoid re-suggesting)
4. Get appropriate description template
5. Send to Gemini 3 Pro for analysis
6. Parse response and save review
7. Display results in side panel

**Progress States:**
```
Starting analysis...
Fetching listing details from eBay...
Listing fetched: LEGO 10281 Bonsai Tree
Sending to Gemini 2.5 Pro...
Parsing response...
Fetching pricing data...
Saving review to database...
Analysis complete
```

### 4. View Analysis Panel

**Action:** Panel opens showing results

**Analysis Panel:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Analysis Results                                           [✕]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LEGO 10281 Bonsai Tree                                            │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │         Score                  Previous                       │ │
│  │         ┌────┐                                                │ │
│  │         │ 62 │                    -                           │ │
│  │         │  C │                                                │ │
│  │         └────┘                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Breakdown:                                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Title            ████████████░░░░░░░░  60%                   │ │
│  │ Item Specifics   ██████████████░░░░░░  70%                   │ │
│  │ Description      ████████████████░░░░  80%                   │ │
│  │ Condition        ██████████░░░░░░░░░░  50%                   │ │
│  │ SEO              ████████████░░░░░░░░  60%                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Pricing Analysis:                                                  │
│  Current: £45.99 | Market Avg: £42.50 | Suggested: £44.99         │
│  Competitors: 12 active | 45 sold                                  │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Suggestions (3)                              [1/3]                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. Title Improvement                                              │
│     Category: title                                                 │
│     Impact: High                                                    │
│                                                                     │
│     Current:                                                        │
│     "LEGO 10281 Bonsai Tree"                                       │
│                                                                     │
│     Suggested:                                                      │
│     "LEGO 10281 Bonsai Tree Botanical Collection 878 Pieces       │
│     Complete with Box & Instructions"                              │
│                                                                     │
│     Reason: Add key search terms and completeness info             │
│                                                                     │
│                              [Skip]  [Approve & Apply]              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5. Review Suggestions

**Action:** Navigate through suggestions with Skip/Approve

**For Each Suggestion:**
| Field | Description |
|-------|-------------|
| Category | title, description, itemSpecifics, condition, seo |
| Field | Specific field being changed |
| Impact | High, Medium, Low |
| Current Value | What's on eBay now |
| Suggested Value | Recommended change |
| Reason | Why this improves the listing |

### 6. Apply Changes

**Action:** Click "Approve & Apply"

**What Happens:**
1. Calls eBay ReviseFixedPriceItem API
2. For item specifics: fetches current values, merges change, sends all
3. Records applied suggestion in `listing_applied_suggestions`
4. Shows success/error toast
5. Moves to next suggestion

**After All Reviewed:**
```
┌───────────────────────────────────────────────────────────────┐
│  All Suggestions Reviewed                                     │
│                                                               │
│  Applied: 2 | Skipped: 1                                     │
│                                                               │
│  Changes have been applied to eBay.                          │
│                                                               │
│                              [Re-analyse]  [Close]            │
└───────────────────────────────────────────────────────────────┘
```

### 7. Re-analyse After Changes

**Action:** Click "Re-analyse" to see updated score

**What Happens:**
1. Fetches fresh listing data from eBay
2. Runs new analysis
3. Shows score comparison
4. Applied suggestions excluded from new recommendations

**Score Comparison:**
```
Score: 78 (+16)
Grade: B (was C)
```

---

## Technical Details

### Query Keys

```typescript
// Listing optimiser data
['listing-optimiser', 'listings', filters]

// Single listing analysis
['listing-optimiser', 'listing', itemId]

// Analysis history
['listing-optimiser', 'reviews', itemId]
```

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/listing-optimiser` | GET | List listings with scores |
| `/api/listing-optimiser/analyse` | POST | Analyse selected listings |
| `/api/listing-optimiser/[itemId]` | GET | Get latest review |
| `/api/listing-optimiser/apply` | POST | Apply suggestion to eBay |

### Analysis Request

```typescript
interface AnalyseRequest {
  itemIds: string[];  // eBay Item IDs
}

interface AnalyseResponse {
  results: FullAnalysisResult[];
  errors: { itemId: string; error: string }[];
}
```

### Full Analysis Result

```typescript
interface FullAnalysisResult {
  listingId: string;
  analysis: {
    score: number;           // 0-100
    grade: QualityGrade;     // A+, A, B, C, D, F
    breakdown: {
      title: CategoryBreakdown;
      itemSpecifics: CategoryBreakdown;
      description: CategoryBreakdown;
      conditionAccuracy: CategoryBreakdown;
      seoOptimization: CategoryBreakdown;
    };
    suggestions: ListingSuggestion[];
    highlights: string[];
    criticalIssues: string[];
  };
  pricing: {
    currentPrice: number;
    competitorAvgPrice: number | null;
    competitorMinPrice: number | null;
    competitorMaxPrice: number | null;
    competitorCount: number;
    soldAvgPrice: number | null;
    soldCount: number;
    suggestedPrice: number | null;
    profitEstimate: number | null;
    profitMargin: number | null;
  };
  reviewId: string;
}
```

### Apply Suggestion

```typescript
interface ApplyRequest {
  itemId: string;
  suggestion: ListingSuggestion;
}

interface ApplyResponse {
  success: boolean;
  itemId: string;
  errorMessage?: string;
  warnings?: string[];
}
```

### Applied Suggestions Tracking

```sql
CREATE TABLE listing_applied_suggestions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  ebay_listing_id VARCHAR NOT NULL,
  category VARCHAR NOT NULL,
  field VARCHAR NOT NULL,
  original_value TEXT,
  applied_value TEXT NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding recent suggestions
CREATE INDEX idx_applied_suggestions_recent
ON listing_applied_suggestions (user_id, ebay_listing_id, applied_at DESC);
```

---

## Error Handling

### Category Changes Not Supported

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Cannot Apply Change                                             │
│                                                                     │
│  Category changes are not supported via the eBay API.              │
│  Please update the category manually on eBay.                      │
│                                                                     │
│                                                    [OK]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Product Catalog Override

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Change Not Applied                                              │
│                                                                     │
│  Cannot update "Brand" - this listing is linked to an eBay         │
│  product catalog entry that defines this value.                    │
│                                                                     │
│  To change it, you would need to remove the product link on        │
│  eBay first, which may affect listing visibility.                  │
│                                                                     │
│                                                    [OK]             │
└─────────────────────────────────────────────────────────────────────┘
```

### API Rate Limited

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Rate Limited                                                    │
│                                                                     │
│  eBay API rate limit reached. Please wait a few minutes and        │
│  try again.                                                         │
│                                                                     │
│                                                    [OK]             │
└─────────────────────────────────────────────────────────────────────┘
```

### Gemini Empty Response

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Analysis Failed                                                 │
│                                                                     │
│  Gemini API returned empty response after 3 attempts.              │
│  Please try again later.                                           │
│                                                                     │
│                                                    [Retry]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [listing-optimiser/page.tsx](apps/web/src/app/(dashboard)/listing-optimiser/page.tsx) | Main page component |
| [listing-optimiser.service.ts](apps/web/src/lib/ebay/listing-optimiser.service.ts) | Analysis service |
| [OptimiserFilters.tsx](apps/web/src/components/features/listing-optimiser/OptimiserFilters.tsx) | Filter controls |
| [OptimiserTable.tsx](apps/web/src/components/features/listing-optimiser/OptimiserTable.tsx) | Listings table |
| [AnalysisPanel.tsx](apps/web/src/components/features/listing-optimiser/AnalysisPanel.tsx) | Results panel |
| [analyse-listing.ts](apps/web/src/lib/ai/prompts/analyse-listing.ts) | Gemini prompts |
| [useListingOptimiser.ts](apps/web/src/hooks/useListingOptimiser.ts) | React Query hooks |

## Related Journeys

- [eBay Authentication](./ebay-authentication.md) - Required connection
- [eBay Stock Management](./ebay-stock-management.md) - Source listings
- [Listing Creation](./listing-creation.md) - Create new listings
