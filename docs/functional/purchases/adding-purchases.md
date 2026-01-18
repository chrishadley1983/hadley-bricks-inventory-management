# User Journey: Adding Purchases

> **Journey:** Add new purchase records using multiple input methods
> **Entry Point:** `/purchases` (Quick Add tab) or `/purchases/new`
> **Complexity:** Medium

## Overview

The Add Purchase feature provides multiple methods for recording purchases, from quick AI-powered entry to detailed forms with full control over all fields.

## Input Methods

| Method | Best For | Entry Point |
|--------|----------|-------------|
| **Quick Add (AI)** | Fast entry from natural language | `/purchases` → Quick Add tab |
| **Full Form** | Complete control over all fields | `/purchases/new` |

---

## Method 1: Quick Add (AI-Powered)

**Use Case:** Quickly record a purchase by describing it in plain English

### User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         /purchases                                  │
├─────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ [All Purchases]  [Quick Add ●]                                 │ │
│  └────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Quick Add Purchase                                                 │
│  Describe your purchase in natural language                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Bought 3 sets from car boot for £45 cash - 75192, 10294, 42100 ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│                                            [Parse with AI]          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Steps

1. **Navigate to Quick Add**
   - Go to `/purchases`
   - Click "Quick Add" tab

2. **Enter Natural Language Description**

   Example inputs:
   ```
   Bought 3 sets from car boot for £45 cash
   ```
   ```
   eBay bundle £120 PayPal - Star Wars sets
   ```
   ```
   75192, 10294 from Facebook Marketplace, £200 bank transfer
   ```

3. **Click "Parse with AI"**
   - AI processes the description
   - Loading state shown during parsing

4. **Review Parsed Result**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Parsed Purchase                                    Confidence: 92% │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Description: Car boot purchase - Star Wars sets                    │
│  Cost: £45.00                                                       │
│  Source: Car Boot                                                   │
│  Payment: Cash                                                      │
│  Date: 18 January 2026                                              │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ ⚡ Set Numbers Detected                                         ││
│  │ 75192, 10294, 42100                                             ││
│  │ Would you like to create inventory items for these sets?        ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│           [Edit Before Saving]  [Create Purchase]                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

5. **Save or Edit**
   - **Create Purchase:** Saves with parsed values
   - **Edit Before Saving:** Opens full form with pre-filled values
   - **Create Inventory Items:** If set numbers detected, option to auto-create

### AI Parsing Capabilities

The AI extracts:

| Field | Example Triggers |
|-------|------------------|
| **Description** | Inferred from context |
| **Cost** | "£45", "45 pounds", "for 45" |
| **Source** | "car boot", "eBay", "Amazon", "charity shop" |
| **Payment Method** | "cash", "PayPal", "card", "bank transfer" |
| **Date** | "today", "yesterday", "last week", specific dates |
| **Set Numbers** | "75192", "set 10294", five-digit numbers |

### Confidence Scores

| Score | Display | Meaning |
|-------|---------|---------|
| ≥ 80% | Green badge | High confidence, likely correct |
| 50-79% | Yellow badge | Medium confidence, review recommended |
| < 50% | Red badge | Low confidence, likely needs correction |

### Inventory Item Creation

When set numbers are detected:
1. User prompted to create inventory items
2. Each set number becomes an inventory item
3. Cost split equally across items (or specify per-item)
4. Items linked to the purchase record
5. Redirects to inventory page after creation

---

## Method 2: Full Form

**Use Case:** Complete control over all purchase fields

### User Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      /purchases/new                                 │
├─────────────────────────────────────────────────────────────────────┤
│  ← Back to Purchases                                                │
│                                                                     │
│  Add Purchase                                                       │
│  Record a new purchase with full details                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Description *                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Car boot sale haul                                              ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Cost (GBP) *                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 45.00                                                           ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Source                          Payment Method                     │
│  ┌──────────────────────┐       ┌──────────────────────┐           │
│  │ Car Boot         ▼   │       │ Cash             ▼   │           │
│  └──────────────────────┘       └──────────────────────┘           │
│                                                                     │
│  Purchase Date                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 18/01/2026                                                   📅 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Notes                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Local car boot sale, 3 sealed sets                              ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ▶ Mileage & Expenses (optional)                                   │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                      [Cancel]  [Create Purchase]    │
└─────────────────────────────────────────────────────────────────────┘
```

### Steps

1. **Navigate to Add Purchase**
   - Click "Add Purchase" button from purchases page
   - Or navigate directly to `/purchases/new`

2. **Fill Required Fields**
   - **Description:** Brief description of the purchase
   - **Cost:** Total purchase cost in GBP

3. **Fill Optional Fields**
   - **Source:** Where the purchase was made
   - **Payment Method:** How you paid
   - **Purchase Date:** When the purchase occurred (defaults to today)
   - **Notes:** Additional details

4. **Add Mileage & Expenses** (Optional)
   - Expand the Mileage & Expenses section
   - See [Mileage Tracking](./mileage-tracking.md) for details

5. **Click "Create Purchase"**
   - Validation runs on required fields
   - Purchase created in database
   - Redirected to purchases list

---

## Fields Reference

### Required Fields

| Field | Type | Validation |
|-------|------|------------|
| Description | Text | Required, non-empty |
| Cost | Number | Required, ≥ 0 |

### Optional Fields

| Field | Type | Options/Format |
|-------|------|----------------|
| Source | Select | eBay, Amazon, Car Boot, Charity Shop, Facebook, Gumtree, Retail, Other |
| Payment Method | Select | Cash, PayPal, Card, Bank Transfer |
| Purchase Date | Date | Date picker, defaults to today |
| Notes | Textarea | Free text |

---

## Post-Creation Actions

After creating a purchase:

### Link to Inventory Items

1. Navigate to the purchase detail page
2. Click "Link Inventory Items"
3. Search for existing items or create new ones
4. Selected items now linked to this purchase

### Add Images

1. Navigate to the purchase detail page
2. Click "Add Images"
3. Upload receipt photos or documentation
4. Images stored and associated with purchase

### Add Mileage

1. Navigate to the purchase detail page
2. Expand "Mileage & Expenses" section
3. Add travel entries with distance calculation
4. See [Mileage Tracking](./mileage-tracking.md) for details

---

## Technical Details

### Create Purchase API

**POST /api/purchases**

```typescript
// Request
{
  "short_description": "Car boot sale haul",
  "cost": 45.00,
  "source": "Car Boot",
  "payment_method": "Cash",
  "purchase_date": "2026-01-18",
  "notes": "Local car boot sale, 3 sealed sets"
}

// Response
{
  "data": {
    "id": "uuid-123",
    "short_description": "Car boot sale haul",
    "cost": 45.00,
    "source": "Car Boot",
    "payment_method": "Cash",
    "purchase_date": "2026-01-18",
    "notes": "Local car boot sale, 3 sealed sets",
    "created_at": "2026-01-18T10:30:00Z",
    "updated_at": "2026-01-18T10:30:00Z"
  }
}
```

### AI Parse API

**POST /api/ai/parse-purchase**

```typescript
// Request
{
  "text": "Bought 3 sets from car boot for £45 cash"
}

// Response
{
  "data": {
    "short_description": "Car boot purchase",
    "cost": 45.00,
    "source": "Car Boot",
    "payment_method": "Cash",
    "purchase_date": "2026-01-18",
    "set_numbers": ["75192", "10294", "42100"],
    "confidence": 0.92
  }
}
```

### React Query Mutations

```typescript
// Create purchase hook
const createMutation = useMutation({
  mutationFn: (input: CreatePurchaseInput) => purchaseService.create(input),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
    router.push('/purchases');
  },
});

// AI parse hook
const parseMutation = useMutation({
  mutationFn: (text: string) => aiService.parsePurchase(text),
  onSuccess: (result) => {
    setPreviewData(result);
  },
});
```

---

## Error Handling

### Validation Errors

```
┌─────────────────────────────────────────────────────────────────────┐
│  Description                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ⚠️ Description is required                                        │
│                                                                     │
│  Cost (GBP)                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ -50                                                             ││
│  └─────────────────────────────────────────────────────────────────┘│
│  ⚠️ Cost must be a positive number                                 │
└─────────────────────────────────────────────────────────────────────┘
```

### AI Parsing Errors

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Could not parse purchase                                       │
│  Please provide more details or use the full form.                  │
│                                                                     │
│  [Try Again]  [Use Full Form]                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [purchases/new/page.tsx](apps/web/src/app/(dashboard)/purchases/new/page.tsx) | Full form page |
| [QuickAddPurchase.tsx](apps/web/src/components/features/purchases/QuickAddPurchase.tsx) | AI quick add component |
| [PurchaseForm.tsx](apps/web/src/components/features/purchases/PurchaseForm.tsx) | Purchase form component |
| [use-purchases.ts](apps/web/src/hooks/use-purchases.ts#L89-110) | Create mutation hook |
| [use-purchases.ts](apps/web/src/hooks/use-purchases.ts#L145-165) | AI parse hook |
| [purchase.service.ts](apps/web/src/lib/services/purchase.service.ts#L30-45) | Create logic |

## Related Journeys

- [Viewing Purchases](./viewing-purchases.md) - See created purchases
- [Mileage Tracking](./mileage-tracking.md) - Add travel costs
