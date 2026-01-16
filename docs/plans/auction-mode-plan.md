# Plan: Auction Mode for Purchase Evaluator

## Overview

Add an "Auction Mode" toggle to the photo-based purchase evaluator that accounts for auction house commission and shipping costs when calculating maximum bids. This mode will:

1. Calculate maximum bid amounts (pre-commission)
2. Show the total amount paid after commission and shipping
3. Allow adjustment of commission % and shipping on review screens

---

## Current Understanding

### Existing Architecture

**Settings Location:** PhotoInputStep.tsx (Lines 300-348)
- Target Margin slider (20-50%)
- Default Platform dropdown (Amazon/eBay)

**Calculation Logic:** reverse-calculations.ts
- `calculateMaxPurchasePriceEbay()` → Returns max purchase price
- `calculateMaxPurchasePriceAmazon()` → Returns max purchase price
- Formula: `Max Purchase Price = Sell Price - Platform Fees - Shipping - Target Profit`

**Review Display:** ReviewStep.tsx
- Shows max bid per item
- Shows total max purchase price
- Has "Recalculate" functionality for updated prices

### Key Insight

Currently, "Max Purchase Price" = what you pay at auction
In Auction Mode: "Max Purchase Price" = Max Bid + Commission + Shipping

---

## Implementation Plan

### Phase 1: State & Types

**1.1 Add Auction Mode Types**

File: `apps/web/src/lib/purchase-evaluator/photo-types.ts`

```typescript
export interface AuctionSettings {
  enabled: boolean;
  commissionPercent: number;  // Default: 32.94 (from screenshot)
  shippingCost: number;       // Default: 0 (user enters)
}
```

**1.2 Add State to Wizard**

File: `apps/web/src/components/features/purchase-evaluator/PurchaseEvaluatorWizard.tsx`

Add state:
```typescript
const [auctionSettings, setAuctionSettings] = React.useState<AuctionSettings>({
  enabled: false,
  commissionPercent: 32.94,
  shippingCost: 0,
});
```

Pass through props to PhotoInputStep and ReviewStep.

---

### Phase 2: Calculation Updates

**2.1 Add Auction Calculation Functions**

File: `apps/web/src/lib/purchase-evaluator/reverse-calculations.ts`

New functions:
```typescript
/**
 * Calculate max bid for auction, accounting for commission
 *
 * Max Purchase Price (what you actually pay) = Max Bid × (1 + Commission%) + Shipping
 * Therefore: Max Bid = (Max Purchase Price - Shipping) / (1 + Commission%)
 */
export function calculateMaxBidForAuction(
  maxPurchasePrice: number,
  commissionPercent: number,
  shippingCost: number
): { maxBid: number; commission: number; totalPaid: number }

/**
 * Calculate total paid from a given bid
 */
export function calculateTotalPaidFromBid(
  bidAmount: number,
  commissionPercent: number,
  shippingCost: number
): { commission: number; totalPaid: number }
```

---

### Phase 3: UI - PhotoInputStep

**3.1 Add Auction Mode Toggle**

File: `apps/web/src/components/features/purchase-evaluator/steps/PhotoInputStep.tsx`

Add a new card after the Target Profit Margin card:
- Toggle switch to enable/disable auction mode
- Commission % input (default 32.94%)
- Shipping cost input (default £0)
- Helper text explaining these are costs from auction house to you

---

### Phase 4: UI - ReviewStep

**4.1 Update Summary Display**

In max_bid mode with auction enabled, show:
- **Maximum Bid** (what to enter in auction) - highlighted as primary
- **Total Paid** (bid + commission + shipping) - shown in amber/warning style
- **Expected Revenue** (existing)
- **Items count** (existing)

**4.2 Add Editable Auction Settings**

Add an editable card on the review screen allowing adjustment of:
- Commission %
- Shipping cost
- Recalculate button that respects these changes

**4.3 Update Items Table**

When auction mode is enabled, show columns:
- **Max Bid** (per item, what to bid)
- **Total Paid** (per item, after commission allocation)

**4.4 Update Tooltip Breakdown**

Enhance tooltips to show full breakdown including:
- Expected sell price
- Platform fees
- Target margin
- Max purchase price
- Then for auction: commission deduction, shipping allocation, final max bid

---

### Phase 5: SavedStep Updates

Display auction settings and breakdown on the saved confirmation screen.

---

### Phase 6: Database Considerations

Store auction settings in existing `photoAnalysisJson` column - no migration needed:
```typescript
{
  ...existingData,
  auctionSettings: {
    enabled: boolean,
    commissionPercent: number,
    shippingCost: number
  }
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `photo-types.ts` | Add `AuctionSettings` and `AuctionBreakdown` types |
| `reverse-calculations.ts` | Add auction calculation functions |
| `PurchaseEvaluatorWizard.tsx` | Add auction state, pass as props |
| `PhotoInputStep.tsx` | Add Auction Mode toggle card |
| `ReviewStep.tsx` | Update summary, add editable settings, update table |
| `SavedStep.tsx` | Display auction breakdown |

---

## Confirmed Requirements

1. **Shipping Allocation**: Entire lot (one shipping cost covers all items)
2. **Default Commission**: 32.94% (from UK auction screenshot)
3. **Persist Settings**: Yes, save to database for historical reference

---

## Success Criteria

- [ ] Toggle enables/disables auction mode on PhotoInputStep
- [ ] Commission % is editable (default 32.94%)
- [ ] Shipping cost is editable (default £0)
- [ ] Review screen shows Max Bid separately from Total Paid
- [ ] Tooltips show full breakdown including auction fees
- [ ] Commission and shipping are editable on Review screen
- [ ] Recalculate button updates all values
- [ ] Saved evaluation includes auction settings
