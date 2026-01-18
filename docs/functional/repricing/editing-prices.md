# Editing Prices

> Change listing prices inline and push updates to Amazon.

## Overview

The repricing table allows you to edit prices directly and push them to Amazon with a single click.

## Editing Your Price

### Start Editing
1. Click the pencil icon next to any price in the "Your Price" column
2. The price displays as an editable input field

### Enter New Price
1. Type the new price (supports decimal values)
2. Press **Enter** to confirm or **Escape** to cancel
3. Click outside the field to confirm

### Visual Feedback
- Row highlights with blue tint when price is changed
- Price displays in blue bold text
- Push button becomes enabled

## Pushing Price Updates

### Push Button States

| State | Icon | Description |
|-------|------|-------------|
| **Idle** | Upload arrow | No pending changes |
| **Ready** | Upload arrow (enabled) | Price changed, ready to push |
| **Pushing** | Spinning loader | Update in progress |
| **Success** | Green checkmark | Price updated successfully |
| **Error** | Red X | Update failed (hover for details) |

### Push Process
1. Edit the price to a new value
2. Click the push button (upload icon)
3. Wait for confirmation (green checkmark)
4. Success state auto-clears after 3 seconds

### Error Handling
- On error, hover over the red X to see error message
- Click again to retry
- Common errors:
  - Validation issues (price too low/high)
  - API rate limits
  - Authentication expired

## Cost Override

### Using Inventory Cost
- By default, cost comes from your inventory system
- Displays as grey text with pencil icon

### Manual Cost Entry
1. Click the pencil icon next to the cost
2. Enter a manual cost value
3. Profit recalculates immediately
4. Click the package icon to revert to inventory cost

### When to Use Manual Cost
- Testing profit at different cost points
- Inventory cost not yet synced
- Temporary cost adjustments

## Pending Changes

### Behaviour
- Changes are "pending" until pushed
- Multiple price edits before pushing keep the latest value
- Navigating away loses pending changes
- Row stays highlighted while changes are pending

### Resetting Changes
- Edit the price back to the original value
- Row highlighting disappears
- Push button becomes disabled

## Source Files

- [RepricingRow.tsx](../../../apps/web/src/components/features/repricing/RepricingRow.tsx:25-364) - Row editing logic
- [PushPriceButton.tsx](../../../apps/web/src/components/features/repricing/PushPriceButton.tsx:21-120) - Push button states
- [use-repricing.ts](../../../apps/web/src/hooks/use-repricing.ts:197-228) - Push price mutation

## API Endpoint

```
PATCH /api/repricing/{sku}
Content-Type: application/json

{
  "newPrice": 29.99,
  "productType": "TOY" // optional
}
```

### Response
```json
{
  "data": {
    "success": true,
    "feedId": "123456789",
    "sku": "LEGO-75192-NEW"
  }
}
```
