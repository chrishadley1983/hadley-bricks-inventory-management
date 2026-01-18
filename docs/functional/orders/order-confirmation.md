# User Journey: Order Confirmation

> **Journey:** Bulk confirm processed orders and link to inventory items
> **Entry Point:** "Confirm Orders Processed" button on Orders page
> **Complexity:** High

## Overview

The Order Confirmation flow allows users to mark orders as processed/completed and link order items to specific inventory items. It supports both eBay and Amazon orders with platform-specific features, including FIFO inventory recommendations and automatic archive location assignment.

## User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Confirm Orders Processed                                    [X]    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Review and confirm orders that have been processed                 │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ Order #12-34567-890                              Status: Paid  │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │                                                                │ │
│  │ LEGO Star Wars Millennium Falcon (75192)                      │ │
│  │ SKU: HB-75192-N                                               │ │
│  │                                                                │ │
│  │ Recommended: [75192 - New Sealed - A-01]        ✓ Matched     │ │
│  │                                                                │ │
│  │ [Approve] [Skip]                                              │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Progress: 1 of 3 orders                                            │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                              [Cancel]  [Confirm All Approved]       │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Concepts

### Order Item Matching

Each order item is matched to inventory using:

| Match Type | Description |
|------------|-------------|
| **matched** | SKU/ASIN found, inventory item available |
| **unmatched** | SKU/ASIN exists but no inventory match |
| **multiple** | Multiple inventory candidates found |
| **no_sku/no_asin** | Item has no identifier |

### FIFO Recommendation

The system recommends inventory items using **First In, First Out** (FIFO):
- Oldest inventory items (by `created_at`) recommended first
- Ensures proper stock rotation
- Shows storage location for easy picking

### Archive Location (Amazon)

When confirming Amazon orders:
- Items moved to archive location: `SOLD-YYYY-MM`
- Example: `SOLD-2026-01` for January 2026
- Tracks when items were sold

---

## Steps

### 1. Open Confirmation Dialog

**Action:** Click "Confirm Orders Processed" button on eBay or Amazon card

**Platform Selection:**
- Button on eBay card → eBay orders
- Button on Amazon card → Amazon orders

### 2. Review First Order

**Dialog Shows:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Order #12-34567-890                                                │
│  Buyer: buyer123                                                    │
│  Date: January 18, 2026                                             │
│  Total: £45.99                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Order Items:                                                       │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ LEGO Star Wars Millennium Falcon                              │ │
│  │ SKU: HB-75192-N                                               │ │
│  │ Qty: 1                                                        │ │
│  │                                                                │ │
│  │ Match Status: ✓ Matched                                       │ │
│  │                                                                │ │
│  │ Recommended Inventory Item (FIFO):                            │ │
│  │ ┌─────────────────────────────────────────────────────────┐   │ │
│  │ │ 75192 Millennium Falcon                                 │   │ │
│  │ │ Condition: New Sealed                                   │   │ │
│  │ │ Location: A-01                                          │   │ │
│  │ │ Added: January 5, 2026                                  │   │ │
│  │ └─────────────────────────────────────────────────────────┘   │ │
│  │                                                                │ │
│  │ [✓ Use Recommended]  [Select Different]                       │ │
│  │                                                                │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3. Handle Matched Items

**For Matched Items:**
1. FIFO recommendation displayed
2. Shows storage location for picking
3. Options:
   - **Use Recommended** - Accept FIFO suggestion
   - **Select Different** - Choose from other candidates

### 4. Handle Unmatched Items

**For Unmatched Items:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Unknown Item - No matching inventory                               │
│  SKU: CUSTOM-123                                                    │
│                                                                     │
│  Match Status: ⚠ Unmatched                                         │
│                                                                     │
│  Search inventory to link:                                          │
│  ┌─────────────────────────────────────────────────────────────────┐
│  │ [Search inventory...]                                           │
│  └─────────────────────────────────────────────────────────────────┘
│                                                                     │
│  Or skip this item:                                                 │
│  [Skip Item]                                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5. Handle Multiple Candidates

**For Multiple Matches:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  LEGO Star Wars Millennium Falcon                                   │
│  SKU: HB-75192-N                                                   │
│                                                                     │
│  Match Status: ⚠ Multiple matches found                            │
│                                                                     │
│  Select inventory item:                                             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ ○ 75192 - New Sealed - £599.99 - A-01 (oldest, recommended)   │ │
│  │ ○ 75192 - New Sealed - £589.99 - B-03                         │ │
│  │ ○ 75192 - New Sealed - £609.99 - C-12                         │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  [Use Selected]                                                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6. Approve or Skip Order

**Actions:**
| Button | Effect |
|--------|--------|
| **Approve** | Mark order for confirmation with linked items |
| **Skip** | Move to next order without confirming |

### 7. Navigate Between Orders

**Progress Indicator:**
```
Progress: 2 of 5 orders
[◀ Previous]  [Next ▶]
```

### 8. Confirm All Approved Orders

**Action:** Click "Confirm All Approved" button

**What Happens:**
1. All approved orders processed
2. Order items linked to inventory items
3. Inventory items marked as Sold
4. **For Amazon:** Items moved to archive location (e.g., `SOLD-2026-01`)
5. Order status updated to Completed
6. Dialog closes
7. Orders list refreshed

---

## Platform-Specific Behaviour

### eBay Orders

**Confirmation Flow:**
1. Fetches unfulfilled eBay orders (Paid + Packed)
2. Matches by SKU field
3. Links to inventory via `ebay_sku_mappings`
4. Updates eBay order status

**UI Differences:**
- Shows eBay order ID format
- SKU displayed (not ASIN)
- No archive location

### Amazon Orders

**Confirmation Flow:**
1. Fetches Paid/Shipped Amazon orders
2. Matches by ASIN via `amazon_asin_mappings`
3. Links to specific inventory item
4. Moves item to archive location

**UI Differences:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Archive Location: SOLD-2026-01                                     │
│  Items will be moved to this location on confirmation               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Details

### Component Structure

```
ConfirmOrdersDialog
├── EbayConfirmContent (platform === 'ebay')
│   ├── Order list with SKU matching
│   ├── FIFO inventory recommendations
│   └── Approval/skip controls
│
└── AmazonConfirmContent (platform === 'amazon')
    ├── Order list with ASIN matching
    ├── FIFO inventory recommendations
    ├── Archive location assignment
    └── Approval/skip controls
```

### Data Structures

```typescript
interface OrderItemMatch {
  orderItemId: string;
  itemNumber: string;        // SKU or ASIN
  itemName: string;
  quantity: number;
  matchedInventoryId: string | null;
  matchedInventory: InventoryCandidate | null;
  matchStatus: 'matched' | 'unmatched' | 'multiple';
  matchCandidates?: InventoryCandidate[];
}

interface InventoryCandidate {
  id: string;
  set_number: string;
  name: string;
  condition: string;
  storage_location: string | null;
  created_at: string;
  listing_price: number | null;
}
```

### FIFO Selection Logic

```typescript
// Sort candidates by created_at (oldest first)
const sortedCandidates = candidates.sort(
  (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
);

// First item is FIFO recommendation
const fifoRecommendation = sortedCandidates[0];
```

### Archive Location Generation

```typescript
// Generate archive location from current date
function getArchiveLocation(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `SOLD-${year}-${month}`;
}
// Example: "SOLD-2026-01"
```

### API Calls on Confirmation

```typescript
// For each approved order:
async function confirmOrder(order: Order, matches: OrderItemMatch[]) {
  // 1. Link order items to inventory
  await linkOrderItemsToInventory(order.id, matches);

  // 2. Update inventory items status
  for (const match of matches) {
    if (match.matchedInventoryId) {
      await updateInventoryItem(match.matchedInventoryId, {
        status: 'Sold',
        storage_location: archiveLocation, // Amazon only
      });
    }
  }

  // 3. Update order status
  await updateOrderStatus(order.id, 'Completed');
}
```

---

## Business Rules

### Confirmation Requirements

| Rule | Description |
|------|-------------|
| At least one linked | Must link at least one item per order to confirm |
| Skip unmatched | Unmatched items can be skipped with warning |
| No duplicates | Same inventory item cannot be linked to multiple orders |

### Status Transitions

| From Status | To Status |
|-------------|-----------|
| Paid | Completed |
| Packed | Completed |
| Shipped | Completed |

### Inventory Item Updates

On confirmation:
- `status` → `Sold`
- `sold_at` → Current timestamp
- `storage_location` → Archive location (Amazon only)
- `ebay_order_id` / `amazon_order_id` → Linked

---

## Error Handling

### No Unfulfilled Orders

```
┌─────────────────────────────────────────────────────────────────────┐
│  No orders to confirm                                               │
│  All orders have been processed or there are no unfulfilled orders.│
│                                                    [Close]          │
└─────────────────────────────────────────────────────────────────────┘
```

### Inventory Already Sold

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Inventory item already sold                                     │
│  This item has been linked to another order.                       │
│  Please select a different inventory item.                         │
└─────────────────────────────────────────────────────────────────────┘
```

### Confirmation Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ❌ Failed to confirm orders                                        │
│  Some orders could not be confirmed. Please try again.             │
│                                                                     │
│  Failed orders:                                                     │
│  - Order #123-456-789: Database error                              │
│                                                                     │
│                                        [Retry]  [Close]             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [ConfirmOrdersDialog.tsx](apps/web/src/components/features/orders/ConfirmOrdersDialog.tsx) | Main confirmation dialog |
| [EbaySkuMatcherDialog.tsx](apps/web/src/components/features/orders/EbaySkuMatcherDialog.tsx) | eBay SKU linking |
| [AmazonAsinMatcherDialog.tsx](apps/web/src/components/features/orders/AmazonAsinMatcherDialog.tsx) | Amazon ASIN linking |

## Related Journeys

- [Viewing Orders](./viewing-orders.md) - Access confirmation from orders page
- [eBay Orders](./ebay-orders.md) - eBay-specific order management
- [Amazon Orders](./amazon-orders.md) - Amazon-specific order management
