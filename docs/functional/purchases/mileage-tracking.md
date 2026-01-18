# User Journey: Mileage Tracking

> **Journey:** Track travel costs for purchases with automatic distance calculation
> **Entry Point:** Purchase detail page or Add Purchase form
> **Complexity:** Medium

## Overview

The Mileage Tracking feature allows users to record travel costs associated with purchases. It includes automatic distance calculation from home address, multiple expense types, and cost summaries for tax/accounting purposes.

## Key Concepts

### Mileage Rate

The default mileage rate is **£0.45 per mile** (45p), based on HMRC approved mileage allowance payments (AMAPs) for business use of a private vehicle.

### Expense Types

| Type | Description |
|------|-------------|
| **Mileage** | Distance-based travel cost (miles × rate) |
| **Parking** | Parking fees |
| **Toll** | Road tolls, congestion charges |
| **Other** | Any other travel-related expense |

### Journey Reasons

| Reason | Typical Use |
|--------|-------------|
| **Collection** | Picking up purchased items |
| **Delivery** | Delivering sold items |
| **Viewing** | Viewing items before purchase |
| **Car Boot** | Attending car boot sales |
| **Auction** | Attending auctions |
| **Other** | Any other reason |

---

## User Flow

### Accessing Mileage Section

From the Add Purchase form or Purchase Detail page:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Purchase Details                                                   │
│  ...                                                                │
├─────────────────────────────────────────────────────────────────────┤
│  ▼ Mileage & Expenses                                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                                                                 ││
│  │  Mileage Entries                                                ││
│  │  ┌───────────────────────────────────────────────────────────┐  ││
│  │  │ + Add Mileage Entry                                       │  ││
│  │  └───────────────────────────────────────────────────────────┘  ││
│  │                                                                 ││
│  │  Other Expenses                                                 ││
│  │  ┌───────────────────────────────────────────────────────────┐  ││
│  │  │ + Add Expense                                             │  ││
│  │  └───────────────────────────────────────────────────────────┘  ││
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

---

## Adding Mileage Entry

### Step 1: Click "Add Mileage Entry"

Opens the mileage entry form:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Add Mileage Entry                                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Reason                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Collection                                                   ▼  ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Destination Postcode                                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ B1 1AA                                                          ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                   [Calculate Distance]              │
│                                                                     │
│  Distance (miles)                     Rate (£/mile)                 │
│  ┌──────────────────────┐            ┌──────────────────────┐      │
│  │ 15.2                 │            │ 0.45                 │      │
│  └──────────────────────┘            └──────────────────────┘      │
│                                                                     │
│  Mileage Cost: £6.84 (one way) / £13.68 (return)                   │
│                                                                     │
│  ☑ Return journey (double the distance)                            │
│                                                                     │
│  Notes                                                              │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                                                                 ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                         [Cancel]  [Add Entry]       │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 2: Select Journey Reason

Choose the reason for travel from the dropdown.

### Step 3: Enter Destination Postcode

Enter the destination postcode for automatic distance calculation.

### Step 4: Calculate Distance

Click "Calculate Distance" to automatically calculate miles from your home address.

**How it works:**
1. Uses `useCalculateMileage` hook
2. Calls AI service with home postcode and destination
3. Returns distance in miles
4. Auto-fills the distance field

**Requirements:**
- Home address must be set in Settings
- Valid UK postcode format required

### Step 5: Adjust Distance/Rate (Optional)

- **Distance:** Can be manually adjusted if calculated value is incorrect
- **Rate:** Defaults to £0.45/mile, can be changed if needed

### Step 6: Select Return Journey

Check "Return journey" if you travelled there and back. This doubles the recorded distance.

### Step 7: Add Notes (Optional)

Any additional details about the journey.

### Step 8: Click "Add Entry"

Mileage entry is added to the purchase.

---

## Adding Other Expenses

### Step 1: Click "Add Expense"

Opens the expense form:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Add Expense                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Expense Type                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Parking                                                     ▼   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Amount (£)                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 3.50                                                            ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Description                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ NCP car park                                                    ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│                                         [Cancel]  [Add Expense]     │
└─────────────────────────────────────────────────────────────────────┘
```

### Step 2: Select Expense Type

- **Parking:** Car park fees
- **Toll:** Road tolls, congestion charges
- **Other:** Any other expense

### Step 3: Enter Amount

The cost in GBP.

### Step 4: Add Description (Optional)

Details about the expense.

### Step 5: Click "Add Expense"

Expense is added to the purchase.

---

## Viewing Expense Summary

After adding entries, the summary shows:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Mileage & Expenses Summary                                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Mileage Entries                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Collection to B1 1AA │ 30.4 miles │ £13.68 │ [Edit] [Delete]   ││
│  │ Car Boot to CV1 2AB  │ 12.0 miles │ £5.40  │ [Edit] [Delete]   ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  Other Expenses                                                     │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Parking │ NCP car park │ £3.50 │ [Edit] [Delete]               ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                     │
│  ──────────────────────────────────────────────────────────────────│
│                                                                     │
│  Total Mileage:        42.4 miles                                   │
│  Mileage Cost:         £19.08                                       │
│  Other Expenses:       £3.50                                        │
│  ──────────────────────────────────────────────────────────────────│
│  TOTAL EXPENSES:       £22.58                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Business Rules

### Cost Calculations

| Calculation | Formula |
|-------------|---------|
| **Mileage Cost** | `distance_miles × rate_per_mile` |
| **Return Mileage Cost** | `(distance_miles × 2) × rate_per_mile` |
| **Total Mileage Cost** | Sum of all mileage entries |
| **Total Other Expenses** | Sum of parking + tolls + other |
| **Total Expenses** | `total_mileage_cost + total_other_expenses` |

### True Purchase Cost

When calculating profitability:
```
true_purchase_cost = purchase_cost + total_expenses
profit = sale_price - true_purchase_cost - fees
```

### Validation Rules

| Field | Rule |
|-------|------|
| distance_miles | Required, must be > 0 |
| rate_per_mile | Required, must be > 0, default £0.45 |
| expense_amount | Required, must be > 0 |
| destination_postcode | Required for distance calculation |

---

## Technical Details

### Data Model

```typescript
interface MileageEntry {
  id: string;
  purchase_id: string;
  distance_miles: number;
  rate_per_mile: number;
  reason: MileageReason;
  destination_postcode: string | null;
  notes: string | null;
  created_at: string;
}

interface Expense {
  id: string;
  purchase_id: string;
  type: 'mileage' | 'parking' | 'toll' | 'other';
  amount: number;
  description: string | null;
  created_at: string;
}

type MileageReason =
  | 'Collection'
  | 'Delivery'
  | 'Viewing'
  | 'Car Boot'
  | 'Auction'
  | 'Other';
```

### Distance Calculation API

**POST /api/ai/calculate-distance**

```typescript
// Request
{
  "from_postcode": "CV1 2AA",  // Home address
  "to_postcode": "B1 1AA"       // Destination
}

// Response
{
  "data": {
    "distance_miles": 15.2,
    "route_description": "Via M6"
  }
}
```

### React Query Hooks

```typescript
// Calculate mileage hook
const { mutate: calculateMileage, isLoading } = useMutation({
  mutationFn: ({ from, to }: { from: string; to: string }) =>
    aiService.calculateDistance(from, to),
  onSuccess: (result) => {
    setDistance(result.distance_miles);
  },
});
```

### Constants

```typescript
// apps/web/src/components/features/purchases/MileageSection.tsx
const DEFAULT_MILEAGE_RATE = 0.45;

const REASON_OPTIONS = [
  'Collection',
  'Delivery',
  'Viewing',
  'Car Boot',
  'Auction',
  'Other',
];

const EXPENSE_TYPES = [
  { value: 'parking', label: 'Parking' },
  { value: 'toll', label: 'Toll' },
  { value: 'other', label: 'Other' },
];
```

---

## Error Handling

### Invalid Postcode

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Invalid postcode format                                        │
│  Please enter a valid UK postcode (e.g., B1 1AA)                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Distance Calculation Failed

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Could not calculate distance                                   │
│  Please enter the distance manually or check the postcodes.        │
│                                                                     │
│  [Enter Manually]                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Home Address Not Set

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Home address not configured                                    │
│  Set your home address in Settings to enable automatic distance    │
│  calculation.                                                       │
│                                                                     │
│  [Go to Settings]  [Enter Distance Manually]                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Source Files

| File | Purpose |
|------|---------|
| [MileageSection.tsx](apps/web/src/components/features/purchases/MileageSection.tsx) | Main mileage component |
| [MileageEntryForm.tsx](apps/web/src/components/features/purchases/MileageEntryForm.tsx) | Mileage entry form |
| [ExpenseForm.tsx](apps/web/src/components/features/purchases/ExpenseForm.tsx) | Expense entry form |
| [use-purchases.ts](apps/web/src/hooks/use-purchases.ts#L150-170) | Calculate mileage hook |
| [calculate-distance.ts](apps/web/src/lib/ai/prompts/calculate-distance.ts) | AI prompt for distance |

## Related Journeys

- [Adding Purchases](./adding-purchases.md) - Create purchase with mileage
- [Viewing Purchases](./viewing-purchases.md) - See expenses in list
