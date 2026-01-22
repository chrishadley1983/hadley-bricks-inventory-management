# Vinted Purchase Import - Implementation Plan

## Overview

Add an "Import from Vinted" feature to the Purchases page that allows users to:
1. Upload a screenshot of their Vinted purchases
2. Have AI extract purchase details (price, description)
3. Match purchases to Monzo transactions to get purchase dates
4. Review and validate proposed purchases before creation
5. Create linked inventory items for each purchase
6. Filter out duplicates

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Purchases Page                                                      │
│  [Add Purchase] [Import from Vinted]                                │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼ Click "Import from Vinted"
┌─────────────────────────────────────────────────────────────────────┐
│  Step 1: Upload Screenshot                                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Drag & drop or click to upload Vinted screenshot           │   │
│  │  [Browse Files]                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  [Cancel]                              [Analyse Screenshot]          │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼ AI Analysis + Monzo Matching
┌─────────────────────────────────────────────────────────────────────┐
│  Step 2: Review Purchases                                            │
│                                                                      │
│  Found 5 purchases from screenshot:                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [✓] 40448 Lego - £15.55                                     │   │
│  │     Status: Package delivered                                │   │
│  │     Date: 22 Jan 2026 (matched from Monzo)                  │   │
│  │     ⚠️ Duplicate warning: Similar purchase exists           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [✓] LEGO Star Wars Advent Calendar - £17.69                 │   │
│  │     Status: Package delivered                                │   │
│  │     Date: 16 Jan 2026 (matched from Monzo)                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ... more items                                                      │
│                                                                      │
│  [Cancel]    [Back]                    [Next: Review Inventory]      │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Step 3: Review Inventory Items                                      │
│                                                                      │
│  Configure inventory items to create for 4 selected purchases:       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Purchase: 40448 Lego - £15.55                               │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ Set Number: [SetNumberLookup: 40448 ▾]                  │ │   │
│  │ │ Name:       Easter Bunny (auto-filled from Brickset)    │ │   │
│  │ │ Condition:  [New ▾]                                     │ │   │
│  │ │ Status:     [IN_STOCK ▾] (auto: Package delivered)      │ │   │
│  │ │ [ ] Skip inventory item creation                        │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Purchase: LEGO Star Wars Advent Calendar - £17.69           │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ Set Number: [SetNumberLookup: _______ ▾]                │ │   │
│  │ │             ⚠️ Required - search for set number          │ │   │
│  │ │ Name:       (enter set number to auto-fill)             │ │   │
│  │ │ Condition:  [New ▾]                                     │ │   │
│  │ │ Status:     [IN_STOCK ▾]                                │ │   │
│  │ │ [ ] Skip inventory item creation                        │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ... more items                                                      │
│                                                                      │
│  Summary: 4 purchases, 3 inventory items (1 skipped)                 │
│                                                                      │
│  [Cancel]    [Back]                    [Import All]                  │
└─────────────────────────────────────────────────────────────────────┘
                          │
                          ▼ Create Purchases + Inventory Items
┌─────────────────────────────────────────────────────────────────────┐
│  Step 4: Import Complete!                                            │
│                                                                      │
│  ✓ Created 4 purchases                                               │
│  ✓ Created 3 inventory items                                         │
│  ✓ 1 inventory item skipped                                          │
│                                                                      │
│  [View Purchases]    [View Inventory]    [Import More]               │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Model

### Extracted from Vinted Screenshot (AI)

```typescript
interface VintedPurchaseExtracted {
  title: string;              // "40448 Lego", "LEGO Star Wars Advent Calendar"
  price: number;              // 15.55
  status: string;             // "Package delivered", "Shipping label sent to seller"
  setNumber?: string;         // Extracted if visible (e.g., "40448", "40670")
  confidence: number;         // 0-1 for extraction quality
}
```

### After Monzo Matching

```typescript
interface VintedPurchaseMatched extends VintedPurchaseExtracted {
  purchaseDate?: string;      // Matched from Monzo transaction
  monzoTransactionId?: string;// ID of matched Monzo transaction
  matchConfidence: 'exact' | 'likely' | 'none';
  isDuplicate: boolean;       // True if similar purchase exists
  duplicatePurchaseId?: string;// ID of existing duplicate
}
```

### User-Editable Fields (Purchase Review - Step 2)

```typescript
interface VintedPurchaseReview extends VintedPurchaseMatched {
  selected: boolean;          // User checkbox to include/exclude
}
```

### Inventory Item Review (Step 3)

```typescript
interface VintedInventoryItemReview {
  purchaseIndex: number;      // Reference to parent purchase
  purchaseTitle: string;      // For display
  purchaseCost: number;       // For display

  // User-editable fields
  setNumber: string;          // User can edit/enter via SetNumberLookup
  itemName: string;           // Auto-populated from Brickset, editable
  condition: 'New' | 'Used';  // User selection
  status: string;             // IN_STOCK, NOT YET RECEIVED, etc.
  skipCreation: boolean;      // User can skip inventory item creation

  // Brickset data (auto-filled when set selected)
  theme?: string;
  pieces?: number;
  imageUrl?: string;
}
```

## Implementation Components

### 1. AI Prompt: Parse Vinted Screenshot

Create new prompt file: `apps/web/src/lib/ai/prompts/parse-vinted-screenshot.ts`

```typescript
export const PARSE_VINTED_SCREENSHOT_PROMPT = `You are an AI assistant that extracts LEGO purchase information from Vinted app screenshots.

Analyze the screenshot and extract ALL visible purchases. Each purchase typically shows:
- Product title/name (may include LEGO set numbers like "40448", "75192")
- Price (in £ GBP format)
- Status (e.g., "Package delivered", "Shipping label sent to seller", "Order sent and on its way!")

IMPORTANT RULES:
1. Return valid JSON array
2. Extract prices as numbers (e.g., "£15.55" → 15.55)
3. Look for LEGO set numbers (4-6 digit numbers) in titles
4. Extract ALL visible purchases, even partial ones
5. Include confidence score per item (0-1)

RESPONSE FORMAT:
{
  "purchases": [
    {
      "title": "40448 Lego",
      "price": 15.55,
      "status": "Shipping label sent to seller",
      "setNumber": "40448",
      "confidence": 0.95
    },
    {
      "title": "LEGO Star Wars advent calendar",
      "price": 17.69,
      "status": "Package delivered",
      "setNumber": null,
      "confidence": 0.85
    }
  ],
  "totalFound": 5,
  "analysisNotes": "Found 5 purchases, 3 with identifiable set numbers"
}`;
```

### 2. API Endpoint: Parse Screenshot

Create: `apps/web/src/app/api/purchases/parse-vinted-screenshot/route.ts`

**Responsibilities:**
- Receive base64 image
- Send to Claude with vision capability
- Return extracted purchases

### 3. API Endpoint: Match with Monzo

Create: `apps/web/src/app/api/purchases/match-monzo/route.ts`

**Responsibilities:**
- Receive list of purchases with prices
- Query Monzo transactions for Vinted payments
- Match by: `merchant_name ILIKE '%vinted%'` AND `amount = -price * 100` (pence)
- Return matched dates and transaction IDs

**Matching Logic:**
```sql
SELECT * FROM monzo_transactions
WHERE user_id = $userId
  AND (merchant_name ILIKE '%vinted%' OR description ILIKE '%vinted%')
  AND amount = $amountInPence  -- Negative for expenses
  AND created >= NOW() - INTERVAL '90 days'
ORDER BY created DESC
LIMIT 1
```

### 4. API Endpoint: Check Duplicates

Create: `apps/web/src/app/api/purchases/check-duplicates/route.ts`

**Responsibilities:**
- Receive list of proposed purchases
- Check for existing purchases with:
  - Same source ('Vinted')
  - Same cost (exact match)
  - Same date (if matched)
  - Similar description (fuzzy match)
- Return duplicate warnings

### 5. API Endpoint: Bulk Import

Create: `apps/web/src/app/api/purchases/import-vinted/route.ts`

**Responsibilities:**
- Receive validated purchases array
- For each purchase:
  1. Create purchase record (source='Vinted')
  2. Create inventory item with FK to purchase
  3. Link Monzo transaction if matched
- Return created IDs

### 6. Frontend Component: VintedImportModal

Create: `apps/web/src/components/features/purchases/VintedImportModal.tsx`

**Multi-step modal (4 steps):**
1. **Upload Step**: Image upload with preview (reuse PhotoUploadInline pattern)
2. **Purchase Review Step**: Select which purchases to import, show duplicate warnings
3. **Inventory Review Step**: Configure inventory items for each selected purchase
4. **Complete Step**: Success message with navigation options

### 7. Frontend Component: VintedPurchaseReviewRow

Create: `apps/web/src/components/features/purchases/VintedPurchaseReviewRow.tsx`

**Row component for purchase review (Step 2):**
- Checkbox for selection
- Title (read-only)
- Price (read-only)
- Status (read-only, e.g., "Package delivered")
- Date (read-only, shows Monzo match status)
- Duplicate warning badge if applicable

### 8. Frontend Component: VintedInventoryReviewCard

Create: `apps/web/src/components/features/purchases/VintedInventoryReviewCard.tsx`

**Card component for inventory review (Step 3):**
- Parent purchase info header (title, price)
- SetNumberLookup input (with Brickset autocomplete)
- Item name field (auto-filled from Brickset, editable)
- Condition dropdown (New/Used)
- Status dropdown (IN_STOCK for delivered, NOT YET RECEIVED for in-transit)
- Brickset preview (image, theme, pieces) when set selected
- "Skip inventory item creation" checkbox
- Validation: Warn if no set number entered (but allow skip)

### 9. React Query Hooks

Create: `apps/web/src/hooks/use-vinted-import.ts`

```typescript
export function useParseVintedScreenshot() { ... }
export function useMatchMonzoTransactions() { ... }
export function useCheckDuplicates() { ... }
export function useImportVintedPurchases() { ... }
```

## File Structure

```
apps/web/src/
├── app/api/purchases/
│   ├── parse-vinted-screenshot/
│   │   └── route.ts               # NEW: AI image analysis
│   ├── match-monzo/
│   │   └── route.ts               # NEW: Monzo transaction matching
│   ├── check-duplicates/
│   │   └── route.ts               # NEW: Duplicate detection
│   └── import-vinted/
│       └── route.ts               # NEW: Bulk import
├── components/features/purchases/
│   ├── VintedImportModal.tsx      # NEW: Main 4-step modal
│   ├── VintedImportButton.tsx     # NEW: Button for purchases page
│   ├── VintedPurchaseReviewRow.tsx    # NEW: Step 2 row component
│   ├── VintedInventoryReviewCard.tsx  # NEW: Step 3 card component
│   └── index.ts                   # UPDATE: Export new components
├── hooks/
│   ├── use-vinted-import.ts       # NEW: React Query hooks
│   └── index.ts                   # UPDATE: Export new hooks
└── lib/ai/prompts/
    └── parse-vinted-screenshot.ts # NEW: AI prompt
```

## Implementation Order

### Phase 1: Backend Foundation
1. Create AI prompt for Vinted screenshot parsing
2. Create `/api/purchases/parse-vinted-screenshot` endpoint
3. Create `/api/purchases/match-monzo` endpoint
4. Create `/api/purchases/check-duplicates` endpoint
5. Create `/api/purchases/import-vinted` endpoint (creates purchases + inventory items)

### Phase 2: Frontend Components
6. Create React Query hooks (`use-vinted-import.ts`)
7. Create `VintedImportButton` component
8. Create `VintedPurchaseReviewRow` component (Step 2)
9. Create `VintedInventoryReviewCard` component (Step 3)
10. Create `VintedImportModal` component (orchestrates all steps)

### Phase 3: Integration
11. Add "Import from Vinted" button to purchases page
12. Wire up complete 4-step flow
13. Add loading states and error handling

### Phase 4: Polish
14. Add duplicate detection warnings in UI
15. Handle edge cases (no Monzo match, missing set number)
16. Add validation (require set number OR explicit skip)
17. Auto-derive status from Vinted status (delivered → IN_STOCK)

## Technical Considerations

### Claude Vision API
- Use `claude-sonnet-4-20250514` with vision capability
- Send image as base64 in message content
- Existing pattern in `evaluate-photo-lot.ts` can be referenced

### Monzo Transaction Matching
- Vinted charges appear as "Vinted" in merchant_name
- Amount is in pence (multiply price by 100)
- Expenses are negative amounts
- Search within 90 days to limit scope
- May have multiple transactions if buyer protection fees separate

### Duplicate Detection Strategy
1. **Exact Match**: Same source + same cost + same date = definite duplicate
2. **Likely Match**: Same source + same cost + date within 3 days = warn
3. **Possible Match**: Same source + similar description = warn

### Purchase Creation
When creating purchase:
- `short_description`: From Vinted title
- `cost`: From Vinted price
- `source`: 'Vinted'
- `payment_method`: 'Monzo Card' (default for all Vinted imports)
- `purchase_date`: From Monzo match or today's date

### Inventory Item Creation
When creating inventory item:
- `purchase_id`: FK to new purchase
- `set_number`: From user input/detection (required unless skipped)
- `item_name`: From Brickset lookup or user input
- `condition`: From user selection (default: New)
- `status`: Auto-derived from Vinted status:
  - "Package delivered" → 'IN_STOCK'
  - "Shipping label sent to seller" → 'NOT YET RECEIVED'
  - "Order sent and on its way!" → 'NOT YET RECEIVED'
  - Other → 'NOT YET RECEIVED'
- `source`: 'Vinted'
- `purchase_date`: From Monzo match or today's date
- `cost`: From Vinted price

### Status Mapping Logic
```typescript
function deriveInventoryStatus(vintedStatus: string): string {
  const deliveredStatuses = ['package delivered', 'delivered'];
  const normalized = vintedStatus.toLowerCase();

  if (deliveredStatuses.some(s => normalized.includes(s))) {
    return 'IN_STOCK';
  }
  return 'NOT YET RECEIVED';
}
```

## Success Criteria

1. User can upload Vinted screenshot and see extracted purchases
2. Purchases are matched to Monzo transactions for accurate dates
3. Duplicates are detected and warned (user can still proceed)
4. User can review and select which purchases to import (Step 2)
5. User can configure each inventory item before creation (Step 3):
   - Edit/enter set numbers with Brickset autocomplete
   - Adjust condition and status
   - Skip inventory creation for individual items
6. Selected purchases create both purchase and inventory records
7. Created records are properly linked via FK (`inventory_items.purchase_id`)
8. Process handles partial data gracefully:
   - No Monzo match → use today's date, show warning
   - No set number detected → require user input or explicit skip
   - Partial screenshot → import what's visible
9. Summary screen shows what was created (purchases count, inventory count, skipped count)
