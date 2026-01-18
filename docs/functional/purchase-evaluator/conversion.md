# Converting to Purchase

## Overview

Once you've completed a purchase evaluation and decided to proceed with the purchase, you can convert it into:

1. A **Purchase** record - tracking the acquisition
2. **Inventory Items** - one per item for tracking and listing

This creates a direct link between the evaluation, purchase, and resulting inventory.

## Prerequisites

To convert an evaluation:

1. Evaluation must be in `completed` or `saved` status
2. Evaluation must have at least one item
3. Evaluation must not already be converted

## Starting the Conversion

### From the Review Step

1. Complete the evaluation review
2. Click **Convert to Purchase** button
3. Conversion dialog opens

### From the Saved Step

1. After saving an evaluation
2. Click **Convert to Purchase** button
3. Conversion dialog opens

### From the Evaluations List

1. Navigate to Purchase Evaluator
2. Find the saved evaluation
3. Click the **Convert** action button
4. Conversion dialog opens

## Conversion Dialog

The conversion is a two-step process:

### Step 1: Purchase Details

Fill in the purchase record details:

| Field | Required | Description |
|-------|----------|-------------|
| **Description** | Yes | Auto-filled from evaluation name |
| **Total Cost** | Yes | Auto-filled from evaluation total |
| **Purchase Date** | Yes | Defaults to today |
| **Source** | No | Where purchased (dropdown) |
| **Payment Method** | No | How you paid (dropdown) |
| **Reference** | No | Order number, receipt number, etc. |
| **Notes** | No | Additional notes |

**Source Options:**
- eBay
- FB Marketplace
- BrickLink
- Amazon
- Car Boot
- Gumtree
- Retail
- Private
- Auction
- Other

**Payment Options:**
- Cash
- Card
- PayPal
- Bank Transfer

Click **Next: Review Items** to proceed.

### Step 2: Review Inventory Items

Review and edit the inventory items to be created:

| Field | Description |
|-------|-------------|
| **Set Number** | LEGO set number |
| **Item Name** | Set name |
| **Condition** | New or Used |
| **Status** | Defaults to "NOT YET RECEIVED" |
| **Source** | Inherited from purchase source |
| **Cost** | Allocated cost from evaluation |
| **Listing Value** | Expected sell price |
| **Listing Platform** | Target platform (Amazon/eBay) |
| **Storage Location** | Where you'll store it |
| **Amazon ASIN** | ASIN from evaluation |
| **SKU** | Auto-generated on creation |
| **Notes** | Any notes from evaluation |

**Quantity Expansion:**
- If an evaluation item has quantity > 1
- It's expanded into multiple inventory items
- Each can be edited individually

**Edit any field** before conversion:
- Click into a cell to edit
- Changes apply to the conversion

Click **Convert to Purchase** to complete.

## What Gets Created

### Purchase Record

A new purchase in the `purchases` table:

```
Purchase
├── short_description: "Evaluation [date]" or custom name
├── cost: Total evaluation cost
├── purchase_date: Selected date
├── source: Selected source
├── payment_method: Selected method
├── reference: Optional reference
└── description: Optional notes
```

### Inventory Items

Multiple inventory items in the `inventory_items` table:

```
Inventory Item (per evaluation item × quantity)
├── set_number: LEGO set number
├── item_name: Set name
├── condition: New/Used
├── status: NOT YET RECEIVED
├── purchase_id: → Linked to new purchase
├── purchase_date: Same as purchase
├── cost: Allocated cost
├── listing_value: Expected sell price
├── listing_platform: Amazon/eBay
├── storage_location: If specified
├── amazon_asin: If available
├── sku: Auto-generated
└── notes: From evaluation
```

### Evaluation Update

The evaluation record is updated:

```
Evaluation
├── status: "converted"
├── converted_at: Timestamp
└── converted_purchase_id: → Purchase ID
```

## After Conversion

### Automatic Navigation

After successful conversion:
- Toast notification confirms success
- You're redirected to the new purchase detail page
- "Created purchase with X inventory items"

### Viewing Linked Data

**From Purchase:**
- View all linked inventory items
- See total value and status

**From Inventory:**
- Each item shows purchase link
- Click to view source purchase

**From Evaluation:**
- Shows "Converted" status
- Link to resulting purchase

## Conversion Validation

The system validates before conversion:

| Check | Error |
|-------|-------|
| Already converted | "This evaluation has already been converted" |
| Invalid status | "Evaluation must be completed or saved" |
| No items | "Cannot convert an evaluation with no items" |
| Not found | "Evaluation not found" |

## Use Cases

### Standard Purchase Flow

1. Find potential lot online
2. Create evaluation (photo or text)
3. Run price lookups
4. Review profitability
5. If profitable → Convert to purchase
6. Receive items → Update status to Backlog
7. List items → Update status to Listed

### Auction Winning Flow

1. Create evaluation before auction (Max Bid mode)
2. Use calculated max bid
3. If you win → Convert to purchase
4. Enter actual winning bid as cost
5. Update with auction fees if different
6. Proceed with receiving and listing

### Declined Purchase

If evaluation shows poor profitability:
- Don't convert
- Save for reference
- Re-evaluate if price drops

## Technical Details

### Service

The conversion is handled by `EvaluationConversionService`:

```typescript
class EvaluationConversionService {
  validateConversion(evaluationId: string): Promise<ValidationError | null>
  convert(evaluationId: string, request: ConvertRequest): Promise<ConversionResult>
}
```

### API Endpoint

```
POST /api/purchase-evaluator/[id]/convert
```

**Request Body:**
```json
{
  "purchase": {
    "purchase_date": "2026-01-18",
    "short_description": "Car boot lot",
    "cost": 150.00,
    "source": "Car Boot",
    "payment_method": "Cash"
  },
  "inventoryItems": [
    {
      "set_number": "75192",
      "item_name": "Millennium Falcon",
      "condition": "Used",
      "cost": 50.00,
      "listing_value": 120.00,
      "listing_platform": "ebay"
    }
  ]
}
```

**Response:**
```json
{
  "purchase": {
    "id": "uuid",
    "short_description": "Car boot lot",
    "cost": 150.00
  },
  "inventoryItemCount": 5,
  "evaluation": { ... }
}
```

### Database Transaction

The conversion runs as a single transaction:
1. Create purchase
2. Create all inventory items
3. Update evaluation status

If any step fails, all changes are rolled back.

## Troubleshooting

### "Already converted" error

- Each evaluation can only be converted once
- Check if you converted it previously
- View the linked purchase from evaluation

### Items not appearing in inventory

- Verify conversion completed successfully
- Check inventory filters (status, platform)
- Items default to "NOT YET RECEIVED" status

### Wrong cost allocated

- Edit costs in Step 2 before converting
- Or edit inventory items after conversion
- Purchase cost is separate from item costs

## Related Documentation

- [Creating an Evaluation](./creating-evaluation.md) - Before conversion
- [Purchases](../purchases/overview.md) - Purchase record details
- [Inventory Management](../inventory/overview.md) - Managing inventory items
