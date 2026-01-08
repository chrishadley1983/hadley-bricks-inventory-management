# eBay Inventory Linking Refactor - Implementation Plan

## Overview

Refactor the eBay order fulfillment process to automatically link sold items to inventory when orders are marked as shipped/fulfilled, with a fallback manual resolution queue for ambiguous matches.

**Key Architectural Change:** This refactor consolidates the data model so that **inventory items are the single source of truth for sales**. The order-to-inventory link provides all sale data directly on the inventory record, eliminating the need for separate sales tables/screens.

**Simplified Flow:**
```
Inventory Added → Order Received (from eBay/Amazon) → Inventory Updated with Sale Data & Marked SOLD
```

This means we can **deprecate and remove**:
- `sales` table (if exists)
- `sale_items` table
- Sales recording screens/forms
- Manual "record a sale" functionality

The order IS the sale - linking order to inventory completes the sale record.

---

## Current State vs Target State

### Current State (Broken)

```
eBay Order Synced → ebay_orders + ebay_order_line_items created
                           ↓
              fulfilment_status updated to FULFILLED
                           ↓
                    ❌ NOTHING HAPPENS
                           ↓
         Inventory items remain IN STOCK / LISTED
         No link between order and inventory
         229+ historical orders unlinked
```

**Problems:**
1. `ebay_order_line_items` has NO `inventory_item_id` foreign key
2. `ebay_sku_mappings` requires manual population (never done)
3. The "Unmatched SKUs" page only shows `NOT_STARTED` orders - fulfilled orders disappear
4. No automatic inventory status update when eBay order ships
5. No net sale price calculation (fees stored separately in `ebay_transactions`)

### Target State

```
eBay Order Synced → ebay_orders + ebay_order_line_items created
                           ↓
              fulfilment_status updated to FULFILLED
                           ↓
              🔄 AUTO-LINKING TRIGGERED
                           ↓
         ┌─────────────────┴─────────────────┐
         ↓                                   ↓
    SKU Match Found                    No/Multiple Match
    (unique match)                     (ambiguous)
         ↓                                   ↓
    ✅ inventory_item.status = 'SOLD'   📋 Added to Resolution Queue
    ✅ sold_date = order creation_date   📋 User sees match candidates
    ✅ sold_price = net sale amount      📋 User selects correct item
    ✅ FK created: line_item → inventory      ↓
                                        ✅ Same updates applied
```

---

## Database Schema Changes

### 1. Add `inventory_item_id` to `ebay_order_line_items`

```sql
ALTER TABLE ebay_order_line_items
  ADD COLUMN inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  ADD COLUMN inventory_linked_at TIMESTAMPTZ,
  ADD COLUMN inventory_link_method TEXT CHECK (inventory_link_method IN ('auto_sku', 'auto_fuzzy', 'manual'));

CREATE INDEX idx_ebay_line_items_inventory
  ON ebay_order_line_items(inventory_item_id)
  WHERE inventory_item_id IS NOT NULL;
```

### 2. Create Resolution Queue Table

Replace `ebay_sku_mappings` concept with a resolution queue for unresolved line items:

```sql
CREATE TABLE ebay_inventory_resolution_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- The line item that needs resolution
  ebay_line_item_id UUID NOT NULL REFERENCES ebay_order_line_items(id) ON DELETE CASCADE,
  ebay_order_id UUID NOT NULL REFERENCES ebay_orders(id) ON DELETE CASCADE,

  -- Snapshot of line item data for display
  sku TEXT,
  title TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  order_date TIMESTAMPTZ NOT NULL,

  -- Resolution status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'skipped', 'no_inventory')),
  resolution_reason TEXT, -- 'no_sku', 'multiple_matches', 'no_matches'

  -- Match candidates (JSON array of inventory item IDs with confidence scores)
  match_candidates JSONB,

  -- Resolution outcome
  resolved_inventory_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(ebay_line_item_id)
);
```

### 3. Add Net Sale Fields to `inventory_items`

```sql
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS sold_gross_amount DECIMAL(12,2),      -- What buyer paid
  ADD COLUMN IF NOT EXISTS sold_fees_amount DECIMAL(12,2),       -- Total eBay fees
  ADD COLUMN IF NOT EXISTS sold_shipping_cost DECIMAL(12,2),     -- Actual shipping cost
  ADD COLUMN IF NOT EXISTS sold_net_amount DECIMAL(12,2),        -- Net after fees
  ADD COLUMN IF NOT EXISTS ebay_line_item_id UUID REFERENCES ebay_order_line_items(id) ON DELETE SET NULL;
```

### 4. Add Tracking Fields to `ebay_orders`

```sql
ALTER TABLE ebay_orders
  ADD COLUMN IF NOT EXISTS inventory_linked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inventory_link_status TEXT CHECK (inventory_link_status IN ('pending', 'partial', 'complete', 'skipped'));
```

---

## Service Layer Changes

### 1. New Service: `EbayInventoryLinkingService`

**Location:** `apps/web/src/lib/ebay/ebay-inventory-linking.service.ts`

**Responsibilities:**
- Triggered when order sync detects `fulfilment_status = 'FULFILLED'`
- Attempts automatic SKU matching
- Calculates net sale amount from transaction data
- Updates inventory items
- Creates resolution queue entries for failures

**Core Methods:**

```typescript
class EbayInventoryLinkingService {
  // Main entry point - called after order sync
  async processFullfilledOrder(orderId: string): Promise<LinkingResult>

  // Match single line item to inventory
  async matchLineItemToInventory(lineItem: EbayOrderLineItem): Promise<MatchResult>

  // Calculate net sale from transactions
  async calculateNetSale(orderId: string, lineItemId: string): Promise<NetSaleCalculation>

  // Update inventory item as sold
  async markInventoryAsSold(inventoryId: string, saleData: SaleData): Promise<void>

  // Add to resolution queue
  async addToResolutionQueue(lineItem: EbayOrderLineItem, reason: string, candidates: InventoryCandidate[]): Promise<void>

  // Bulk process historical orders
  async processHistoricalOrders(fromDate?: Date): Promise<BulkLinkingResult>
}
```

### 2. Matching Algorithm

```typescript
async matchLineItemToInventory(lineItem: EbayOrderLineItem): Promise<MatchResult> {
  const { sku, title, quantity } = lineItem;

  // Step 0: Multi-quantity always goes to manual resolution
  if (quantity > 1) {
    const candidates = await this.findCandidates(sku, title);
    return {
      status: 'manual_required',
      reason: 'multi_quantity',
      candidates: this.rankCandidates(candidates, lineItem),
      quantityNeeded: quantity
    };
  }

  // Step 1: Exact SKU match (ONLY auto-link scenario)
  if (sku) {
    const matches = await this.findBySku(sku);
    if (matches.length === 1) {
      // ✅ AUTO-LINK: Single exact SKU match
      return { status: 'matched', method: 'auto_sku', inventoryId: matches[0].id, confidence: 1.0 };
    }
    if (matches.length > 1) {
      // Multiple SKU matches - user must choose (FIFO ranking applied)
      return { status: 'manual_required', reason: 'multiple_sku_matches', candidates: this.rankCandidates(matches, lineItem) };
    }
  }

  // Step 2: Fuzzy match by set number extracted from title (suggest only, no auto-link)
  const setNumber = this.extractSetNumber(title);
  if (setNumber) {
    const matches = await this.findBySetNumber(setNumber);
    if (matches.length > 0) {
      return { status: 'manual_required', reason: 'fuzzy_set_number', candidates: this.rankCandidates(matches, lineItem) };
    }
  }

  // Step 3: Title keyword search (suggest only, no auto-link)
  const titleMatches = await this.searchByTitle(title);
  if (titleMatches.length > 0) {
    return { status: 'manual_required', reason: 'fuzzy_title', candidates: this.rankCandidates(titleMatches, lineItem) };
  }

  // No matches found at all
  return { status: 'unmatched', reason: 'no_matches', candidates: [] };
}
```

### 3. Candidate Ranking Logic

When multiple inventory items match, rank them by:

1. **Status priority:** `LISTED` > `IN STOCK` (listed items are more likely what sold)
2. **Condition match:** Extract "New"/"Used" from eBay title, match to inventory condition
3. **Price proximity:** Compare list_price to sale price
4. **Purchase date:** Older items first (FIFO)
5. **Storage location:** Items with location set ranked higher (easier to find)

```typescript
rankCandidates(candidates: InventoryItem[], lineItem: EbayOrderLineItem): RankedCandidate[] {
  return candidates.map(item => ({
    ...item,
    score: this.calculateScore(item, lineItem),
    reasons: this.explainScore(item, lineItem)
  })).sort((a, b) => b.score - a.score);
}

calculateScore(item: InventoryItem, lineItem: EbayOrderLineItem): number {
  let score = 0;

  // Status (30 points)
  if (item.status === 'LISTED') score += 30;
  else if (item.status === 'IN STOCK') score += 20;

  // Condition match (25 points)
  const lineItemCondition = this.extractCondition(lineItem.title);
  if (lineItemCondition && item.condition === lineItemCondition) score += 25;

  // Price proximity (20 points)
  if (item.list_price) {
    const priceDiff = Math.abs(item.list_price - lineItem.total_amount);
    const priceScore = Math.max(0, 20 - (priceDiff / lineItem.total_amount) * 20);
    score += priceScore;
  }

  // Has location (15 points)
  if (item.storage_location) score += 15;

  // FIFO - older purchase date (10 points)
  // Normalize based on date range
  score += this.calculateFifoScore(item.purchase_date);

  return score;
}
```

### 4. Net Sale Calculation

```typescript
async calculateNetSale(orderId: string, lineItemId: string): Promise<NetSaleCalculation> {
  // Get order for total amounts
  const order = await this.getOrder(orderId);

  // Get transaction for this order (contains fees)
  const transaction = await this.getTransactionByOrderId(order.ebay_order_id);

  if (!transaction) {
    // No transaction yet - fees not available
    return {
      grossAmount: lineItem.total_amount,
      feesAmount: null,
      shippingCost: null,
      netAmount: null,
      status: 'pending_transaction'
    };
  }

  // Calculate fees (proportional if multi-item order)
  const orderLineItems = await this.getOrderLineItems(orderId);
  const itemProportion = lineItem.total_amount / order.pricing_summary.total;

  const totalFees = (transaction.final_value_fee_fixed || 0) +
                    (transaction.final_value_fee_variable || 0) +
                    (transaction.regulatory_operating_fee || 0) +
                    (transaction.international_fee || 0) +
                    (transaction.ad_fee || 0);

  const itemFees = totalFees * itemProportion;
  const postage = (transaction.postage_and_packaging || 0) * itemProportion;

  return {
    grossAmount: lineItem.total_amount,
    feesAmount: itemFees,
    postageReceived: postage,
    netAmount: lineItem.total_amount - itemFees,
    status: 'calculated'
  };
}
```

---

## Modify Order Sync to Trigger Linking

### In `ebay-order-sync.service.ts`

After upserting orders, check for newly fulfilled orders:

```typescript
async syncOrders(): Promise<SyncResult> {
  // ... existing sync logic ...

  // After upsert, process newly fulfilled orders
  const newlyFulfilled = orders.filter(o =>
    o.order_fulfilment_status === 'FULFILLED' &&
    !o.inventory_linked_at
  );

  for (const order of newlyFulfilled) {
    await this.inventoryLinkingService.processFullfilledOrder(order.id);
  }

  return result;
}
```

---

## UI Changes

### 1. Rename/Repurpose "eBay SKU Matching" Page

**New Name:** "eBay Inventory Resolution"
**Location:** `/settings/ebay-inventory-resolution` (or `/orders/ebay/resolution`)

**Displays:**
- Pending resolution queue items (not the SKU mapping table)
- Grouped by order for context
- Shows match candidates with confidence scores and ranking reasons
- One-click resolution for high-confidence matches
- Search for manual matching

### 2. Resolution Queue UI

```
┌─────────────────────────────────────────────────────────────────┐
│ eBay Inventory Resolution                           12 pending  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ Order #280182635621 - 5 Jan 2025                               │
│ ├─ LEGO Star Wars Millennium Falcon 75192 (NEW)                │
│ │   SKU: MF-75192-NEW                                          │
│ │   Sold for: £629.99                                          │
│ │   Reason: Multiple matches found                             │
│ │                                                               │
│ │   Suggested Matches:                                          │
│ │   ┌──────────────────────────────────────────────────────┐   │
│ │   │ ⭐ 95% Match - 75192 Millennium Falcon                │   │
│ │   │    Location: Loft - S12  |  Cost: £449.99            │   │
│ │   │    Status: LISTED  |  Purchased: 10 Oct 2024         │   │
│ │   │    [Select This Item]                                 │   │
│ │   ├──────────────────────────────────────────────────────┤   │
│ │   │ 72% Match - 75192 Millennium Falcon                   │   │
│ │   │    Location: Loft - S45  |  Cost: £479.99            │   │
│ │   │    Status: IN STOCK  |  Purchased: 2 Dec 2024        │   │
│ │   │    [Select This Item]                                 │   │
│ │   └──────────────────────────────────────────────────────┘   │
│ │   [Search Inventory...] [Skip - No Inventory]                │
│                                                                 │
│ Order #280182112456 - 4 Jan 2025                               │
│ └─ ...                                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 3. API Endpoints

```
GET  /api/ebay/resolution-queue          - List pending items with candidates
POST /api/ebay/resolution-queue/:id/resolve  - Resolve with selected inventory
POST /api/ebay/resolution-queue/:id/skip     - Mark as skipped/no inventory
POST /api/ebay/inventory-linking/reprocess   - Reprocess historical orders
GET  /api/ebay/inventory-linking/stats       - Linking statistics
```

---

## Historical Order Processing

### One-Time Migration Script

Process all historical eBay orders that have `fulfilment_status = 'FULFILLED'` but no inventory link:

```typescript
// apps/web/scripts/link-historical-ebay-orders.ts

async function linkHistoricalOrders() {
  const unlinkedOrders = await supabase
    .from('ebay_orders')
    .select('id, ebay_order_id, creation_date')
    .eq('order_fulfilment_status', 'FULFILLED')
    .is('inventory_linked_at', null)
    .order('creation_date', { ascending: false });

  console.log(`Found ${unlinkedOrders.data?.length} unlinked orders`);

  for (const order of unlinkedOrders.data || []) {
    const result = await linkingService.processFullfilledOrder(order.id);
    console.log(`Order ${order.ebay_order_id}: ${result.status}`);
  }
}
```

### API Endpoint for Manual Trigger

Allow user to trigger historical processing from UI:

```
POST /api/ebay/inventory-linking/process-historical
Body: { fromDate?: string, dryRun?: boolean }
```

---

## Implementation Phases

### Phase 1: Database Schema (Migration)
1. Create migration file with all schema changes
2. Add columns to `ebay_order_line_items`
3. Create `ebay_inventory_resolution_queue` table
4. Add sold detail columns to `inventory_items`
5. Add tracking columns to `ebay_orders`

### Phase 2: Core Service
1. Create `EbayInventoryLinkingService`
2. Implement SKU matching algorithm
3. Implement candidate ranking
4. Implement net sale calculation
5. Implement resolution queue management

### Phase 3: Integrate with Sync
1. Modify `ebay-order-sync.service.ts` to call linking service
2. Add linking trigger after order upsert
3. Handle errors gracefully (don't fail sync)

### Phase 4: Resolution Queue UI
1. Create new page `/settings/ebay-inventory-resolution`
2. Build resolution queue component
3. Implement candidate selection
4. Add manual search fallback
5. Add skip/no-inventory option

### Phase 5: Historical Processing
1. Create migration script
2. Add API endpoint for manual trigger
3. Add progress tracking UI
4. Run historical processing

### Phase 6: Deprecate Old eBay SKU Matching
1. Remove/redirect old SKU matching page
2. Drop `ebay_sku_mappings` table (or keep for reference)
3. Update documentation

### Phase 7: Deprecate Sales Tables & Screens
Since orders now directly update inventory with sale data, the separate sales system is redundant.

**Tables to deprecate:**
- `sales` table (created in `20241219000006_order_status_and_sales.sql`)
- `sale_items` table

**Pages to remove:**
- `/sales/page.tsx` - Sales list
- `/sales/new/page.tsx` - New sale form

**API routes to remove:**
- `/api/sales/*` routes

**Components to remove:**
- Sales-related form components
- Sales service files

**Migration approach:**
1. Ensure all historical sales data is represented in inventory items (sold_* fields)
2. Verify reporting still works from inventory_items + platform_orders
3. Remove UI pages and routes
4. Keep tables initially (soft deprecation) then drop in future migration

---

## Testing Strategy

### Unit Tests
- Matching algorithm with various scenarios
- Candidate ranking logic
- Net sale calculation

### Integration Tests
- Full order sync → linking flow
- Resolution queue creation
- Manual resolution workflow

### Test Scenarios
1. Single SKU match → auto-linked
2. Multiple SKU matches → queue with ranked candidates
3. No SKU, title match → queue with fuzzy matches
4. No matches at all → queue with empty candidates
5. Multi-item order → each line item processed independently
6. Order without transaction → partial net sale data

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Wrong inventory item auto-linked | Only auto-link when confidence = 1.0 (exact unique SKU match) |
| Historical linking creates false positives | Run in dry-run mode first, review results |
| Performance impact on sync | Process linking async, don't block sync |
| Transaction data not available yet | Mark net sale as pending, recalculate when transaction syncs |
| Multiple orders for same inventory item | Check inventory status before linking, add to queue if already SOLD |

---

## Success Metrics

- **Auto-link rate:** % of fulfilled orders auto-linked without manual intervention
- **Resolution queue size:** Number of items requiring manual resolution
- **Time to resolution:** Average time items spend in queue
- **Accuracy:** % of auto-links that are correct (sample audit)

---

## Files to Create/Modify

### New Files
- `supabase/migrations/YYYYMMDD_ebay_inventory_linking.sql`
- `apps/web/src/lib/ebay/ebay-inventory-linking.service.ts`
- `apps/web/src/app/api/ebay/resolution-queue/route.ts`
- `apps/web/src/app/api/ebay/resolution-queue/[id]/resolve/route.ts`
- `apps/web/src/app/api/ebay/resolution-queue/[id]/skip/route.ts`
- `apps/web/src/app/api/ebay/inventory-linking/process-historical/route.ts`
- `apps/web/src/app/(dashboard)/settings/ebay-inventory-resolution/page.tsx`
- `apps/web/src/components/features/ebay/ResolutionQueue.tsx`
- `apps/web/src/hooks/use-ebay-resolution-queue.ts`
- `apps/web/scripts/link-historical-ebay-orders.ts`

### Modified Files
- `apps/web/src/lib/ebay/ebay-order-sync.service.ts` - Add linking trigger
- `apps/web/src/components/layout/Sidebar.tsx` - Update navigation
- `packages/database/src/types.ts` - Add new types after migration

### Deprecated Files (Phase 6 - eBay SKU Matching)
- `apps/web/src/app/(dashboard)/settings/ebay-sku-matching/page.tsx` - Redirect to new page
- `apps/web/src/app/api/ebay/sku-mapping/route.ts` - Deprecate
- `apps/web/src/app/api/ebay/unmatched-skus/route.ts` - Deprecate

### Deprecated Files (Phase 7 - Sales System)
- `apps/web/src/app/(dashboard)/sales/page.tsx` - Remove
- `apps/web/src/app/(dashboard)/sales/new/page.tsx` - Remove
- `apps/web/src/app/api/sales/route.ts` - Remove (if exists)
- `apps/web/src/lib/services/sales.service.ts` - Remove (if exists)
- `supabase/migrations/20241219000006_order_status_and_sales.sql` - Tables deprecated (drop in future)

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Phase 1: Database Schema | Small |
| Phase 2: Core Service | Medium-Large |
| Phase 3: Sync Integration | Small |
| Phase 4: Resolution Queue UI | Medium |
| Phase 5: Historical Processing | Small |
| Phase 6: Deprecate eBay SKU Matching | Small |
| Phase 7: Deprecate Sales System | Small-Medium |

**Total:** Medium-Large project

---

## Design Decisions (Confirmed)

1. **FIFO vs LIFO:** ✅ **FIFO** - Prefer older inventory items first (by purchase date)

2. **Auto-link threshold:** ✅ **Exact SKU only** - Only auto-link when exact unique SKU match. Fuzzy matches are suggested to user in resolution queue, not auto-linked.

3. **Historical orders:** ✅ **ALL** - Process all historical eBay orders regardless of date

4. **Shipping cost tracking:** ✅ **Use eBay postage** - Use postage received from eBay transaction data (no separate shipping cost tracking needed)

5. **Multi-quantity line items:** ✅ **Flag for manual** - If quantity > 1, always add to resolution queue for manual selection of multiple inventory items
