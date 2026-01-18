# Amazon Sync Queue Management

## Overview

The sync queue allows you to batch inventory items for price and quantity updates to Amazon. Items are validated, aggregated by ASIN, and submitted as a JSON Listings Feed.

## Accessing the Sync Queue

**Navigation**: Dashboard sidebar → Amazon Sync

The page has two tabs:
- **Queue**: Items waiting to be submitted
- **History**: Previously submitted feeds and their results

## Adding Items to the Queue

### From Inventory List

1. Navigate to **Inventory**
2. Find items with Amazon ASIN and Backlog status
3. Click the cloud upload icon (☁️) on the row
4. If successful, toast notification appears

### Bulk Add

1. Select multiple items using checkboxes
2. Click **Add to Amazon Queue** button in bulk actions
3. Items are added in a single API call

### Requirements for Queue Eligibility

| Requirement | Reason |
|-------------|--------|
| Has ASIN | Amazon identifier required |
| Has listing price | Price to sync |
| Status = Backlog | Only unlisted items can be added |

## Queue Item Details

Each queued item shows:

| Column | Description |
|--------|-------------|
| Set Number | LEGO set number |
| Name | Item name |
| ASIN | Amazon Standard Identification Number |
| Amazon SKU | Seller-assigned SKU (auto-generated if new) |
| Local Price | Your price from inventory |
| Amazon Price | Current live price on Amazon (fetched via API) |
| Price Diff | Difference (green = you're lowering, red = raising) |
| Local Qty | Quantity to sync (always 1 per item) |
| Amazon Qty | Current quantity on Amazon |

## Price Conflict Detection

When adding an item, the system:

1. Queries Amazon Listings API for current live price
2. Compares with your local listing_value
3. If different, shows **Price Conflict Dialog**

### Conflict Resolution Options

- **Use Local Price**: Proceed with your price (will update Amazon)
- **Use Amazon Price**: Cancel and update your inventory price first
- **Skip**: Don't add this item to the queue

## Queue Summary

Above the table, summary cards show:

| Metric | Description |
|--------|-------------|
| Total Items | Number of inventory items queued |
| Unique ASINs | Distinct products (items with same ASIN aggregated) |
| Total Quantity | Sum of quantities to sync |

## Submitting the Queue

### Dry Run (Validation Only)

1. Ensure **Dry Run** toggle is ON
2. Click **Validate (N)**
3. System sends payload to Amazon for validation
4. Returns validation errors without making changes

### Standard Submit

1. Turn **Dry Run** toggle OFF
2. Click **Sync to Amazon (N)**
3. Feed is submitted to Amazon Feeds API
4. You're switched to History tab to track progress

### Two-Phase Sync

Critical when **raising prices** to avoid selling at old price:

1. Turn on **Two-Phase Sync** toggle
2. Click **2-Phase Sync (N)**
3. System:
   - Submits price update first
   - Waits for Amazon to confirm (up to 30 min)
   - Verifies price is live via Listings API
   - Only then submits quantity update
4. You receive email/push notification when complete

**Safe to navigate away** - sync continues server-side.

## Feed Processing

After submission, the feed goes through states:

| Status | Description |
|--------|-------------|
| `submitted` | Sent to Amazon, waiting for processing |
| `processing` | Amazon is processing the feed |
| `completed` | All items processed successfully |
| `completed_with_errors` | Some items failed |
| `failed` | Feed-level failure |

### Viewing Results

1. Go to **History** tab
2. Click on a feed row
3. See per-item results with any error messages

## Clearing the Queue

1. Click **Clear Queue** button
2. Confirm in dialog
3. All items removed (does not affect Amazon)

## Technical Details

### Feed Format

Uses `JSON_LISTINGS_FEED` type with patches:

```json
{
  "productType": "TOY",
  "patches": [
    {
      "op": "replace",
      "path": "/attributes/purchasable_offer",
      "value": [{
        "marketplace_id": "A1F83G8C2ARO7P",
        "currency": "GBP",
        "our_price": [{ "schedule": [{ "value_with_tax": 29.99 }] }]
      }]
    },
    {
      "op": "replace",
      "path": "/attributes/fulfillment_availability",
      "value": [{ "fulfillment_channel_code": "DEFAULT", "quantity": 1 }]
    }
  ]
}
```

### Product Type Detection

The system caches product types from Amazon Catalog API:
- Stored in `amazon_product_cache` table
- TTL: 90 days
- Falls back to "TOY" if lookup fails

### SKU Generation

For new listings without existing SKU:
- Format: `HB-{ASIN}-{timestamp}`
- Example: `HB-B07X6LFDHK-1705678901`

## Related Files

| File | Purpose |
|------|---------|
| `apps/web/src/app/(dashboard)/amazon-sync/page.tsx` | Main page component |
| `apps/web/src/components/features/amazon-sync/SyncQueueTable.tsx` | Queue table with columns |
| `apps/web/src/components/features/amazon-sync/SyncSubmitControls.tsx` | Submit controls with toggles |
| `apps/web/src/hooks/use-amazon-sync.ts` | TanStack Query hooks |
| `apps/web/src/lib/amazon/amazon-sync.service.ts` | Queue and feed service |

## Troubleshooting

### "Item has no Amazon ASIN"
- Go to inventory item, add ASIN in edit form
- ASIN can be found on Amazon product page

### "Only Backlog items allowed"
- Item status must be "Backlog" (not yet listed)
- Change status in inventory edit

### "Price conflict detected"
- Your local price differs from Amazon's current price
- Decide which price to use before proceeding

### Feed stuck in "submitted"
- Amazon can take 5-15 minutes to process
- System auto-polls every 30 seconds
- Check back on History tab later

### Two-phase sync timeout
- Price verification times out after 30 minutes
- May need to check Amazon Seller Central directly
- Can retry with standard (single-phase) sync
