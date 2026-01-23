# Home Costs Specification

## Overview

Add a "Home Costs" configuration UI to the Profit & Loss report, allowing users to capture allowable home working expenses that are currently not being tracked. Costs are entered once with a date range and automatically applied to each month's P&L calculation.

---

## Scope

### In Scope

| Category | Description |
|----------|-------------|
| **Use of Home** | Simplified flat rate based on hours worked (£10/£18/£26 per month) |
| **Phone & Broadband** | Monthly costs with individual business use percentages |
| **Insurance** | Proportion of home contents insurance covering business stock |

### Out of Scope

- Actual costs method for Use of Home (mortgage interest, council tax, utilities)
- Separate business insurance policies (100% claimable)
- Equipment / capital allowances

---

## User Interface

### Entry Point

Add a "Home Costs" button to the Profit & Loss report toolbar, next to existing export options.

```
┌─────────────────────────────────────────────────────────────────┐
│  Profit & Loss Report                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Date Range: [This Year ▼]    [Home Costs]  [Export for MTD ▼] │
│                                                                 │
```

### Home Costs Modal

Clicking "Home Costs" opens a modal with three tabs.

```
┌─────────────────────────────────────────────────────────────────┐
│  Home Costs Configuration                                  [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Use of Home]  [Phone & Broadband]  [Insurance]  [Settings]   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  (Tab content here)                                     │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                                        [Cancel]  [Save]        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tab 1: Use of Home

Simplified expenses flat rate based on HMRC guidelines.

### UI

```
┌─────────────────────────────────────────────────────────────────┐
│  Use of Home (Simplified Method)                                │
│                                                                 │
│  Hours worked from home per month:                              │
│                                                                 │
│  ○ 25-50 hours     → £10/month                                 │
│  ○ 51-100 hours    → £18/month                                 │
│  ● 101+ hours      → £26/month                                 │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Effective Period                                               │
│                                                                 │
│  Start Date: [April 2024      ▼]                               │
│  End Date:   [Ongoing ▼] or [Select month...]                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Monthly Allowance:    £26.00                                  │
│  Annual Estimate:      £312.00 (12 months)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface UseOfHomeCost {
  id: string;
  type: 'use_of_home';
  hoursPerMonth: '25-50' | '51-100' | '101+';
  monthlyRate: number;        // £10, £18, or £26
  startDate: string;          // YYYY-MM format
  endDate: string | null;     // YYYY-MM format or null for ongoing
  createdAt: Date;
  updatedAt: Date;
}
```

### HMRC Rates (2024/25 & 2025/26)

| Hours Worked | Monthly Rate |
|--------------|--------------|
| 25-50 hours  | £10 |
| 51-100 hours | £18 |
| 101+ hours   | £26 |

---

## Tab 2: Phone & Broadband

Multiple cost entries with individual business use percentages.

### UI

```
┌─────────────────────────────────────────────────────────────────┐
│  Phone & Broadband                                              │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Description    │ Monthly │ Business % │ Claimable │     │   │
│  ├────────────────┼─────────┼────────────┼───────────┼─────┤   │
│  │ Mobile Phone   │ £40.00  │ 60%        │ £24.00    │ [✎] │   │
│  │ Home Broadband │ £35.00  │ 50%        │ £17.50    │ [✎] │   │
│  │ Landline       │ £15.00  │ 30%        │ £4.50     │ [✎] │   │
│  └────────────────┴─────────┴────────────┴───────────┴─────┘   │
│                                                                 │
│  [+ Add Cost]                                                   │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Total Monthly Claimable:   £46.00                             │
│  Annual Estimate:           £552.00                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Add/Edit Cost Dialog

```
┌─────────────────────────────────────────────────────────────────┐
│  Add Phone & Broadband Cost                                [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Description:     [Mobile Phone_______________]                │
│                                                                 │
│  Monthly Cost:    [£] [40.00_____]                             │
│                                                                 │
│  Business Use %:  [60__] %                                     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Effective Period                                               │
│                                                                 │
│  Start Date: [April 2024      ▼]                               │
│  End Date:   [Ongoing ▼] or [Select month...]                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Claimable Amount:  £24.00/month                               │
│                                                                 │
│                                   [Cancel]  [Delete]  [Save]   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface PhoneBroadbandCost {
  id: string;
  type: 'phone_broadband';
  description: string;        // e.g. "Mobile Phone", "Home Broadband"
  monthlyCost: number;        // Total monthly cost
  businessPercent: number;    // 0-100
  claimableAmount: number;    // Calculated: monthlyCost * businessPercent / 100
  startDate: string;          // YYYY-MM format
  endDate: string | null;     // YYYY-MM format or null for ongoing
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Tab 3: Insurance

Proportion of home contents insurance covering business stock.

### UI

```
┌─────────────────────────────────────────────────────────────────┐
│  Insurance                                                      │
│                                                                 │
│  Home Contents Insurance (Business Proportion)                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Annual Premium:        [£] [240.00____]                       │
│                                                                 │
│  Business Stock Value:  [£] [5,000_____]                       │
│  Total Contents Value:  [£] [25,000____]                       │
│                                                                 │
│  Business Proportion:   20%  (auto-calculated)                 │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Effective Period                                               │
│                                                                 │
│  Start Date: [April 2024      ▼]                               │
│  End Date:   [March 2025      ▼] or [Ongoing]                  │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Annual Claimable:     £48.00                                  │
│  Monthly Equivalent:   £4.00                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface InsuranceCost {
  id: string;
  type: 'insurance';
  annualPremium: number;
  businessStockValue: number;
  totalContentsValue: number;
  businessPercent: number;    // Calculated: businessStockValue / totalContentsValue * 100
  annualClaimable: number;    // Calculated: annualPremium * businessPercent / 100
  monthlyClaimable: number;   // Calculated: annualClaimable / 12
  startDate: string;          // YYYY-MM format
  endDate: string | null;     // YYYY-MM format or null for ongoing
  createdAt: Date;
  updatedAt: Date;
}
```

---

## Tab 4: Settings

Display preferences for the P&L report.

### UI

```
┌─────────────────────────────────────────────────────────────────┐
│  Settings                                                       │
│                                                                 │
│  P&L Report Display                                             │
│                                                                 │
│  How should home costs appear on the Profit & Loss report?     │
│                                                                 │
│  ● Separate line items                                         │
│      Use of Home             £26.00                            │
│      Phone & Broadband       £46.00                            │
│      Insurance               £4.00                             │
│                                                                 │
│  ○ Single consolidated line                                    │
│      Home Costs              £76.00                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Data Model

```typescript
interface HomeCostsSettings {
  displayMode: 'separate' | 'consolidated';
}
```

---

## Database Schema

### Table: `home_costs`

```sql
CREATE TABLE home_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Cost type discriminator
  cost_type TEXT NOT NULL CHECK (cost_type IN ('use_of_home', 'phone_broadband', 'insurance')),
  
  -- Common fields
  description TEXT,
  start_date DATE NOT NULL,           -- First day of start month
  end_date DATE,                      -- Last day of end month, NULL = ongoing
  
  -- Use of Home fields
  hours_per_month TEXT CHECK (hours_per_month IN ('25-50', '51-100', '101+')),
  
  -- Phone & Broadband fields
  monthly_cost DECIMAL(10,2),
  business_percent INTEGER CHECK (business_percent >= 0 AND business_percent <= 100),
  
  -- Insurance fields
  annual_premium DECIMAL(10,2),
  business_stock_value DECIMAL(10,2),
  total_contents_value DECIMAL(10,2),
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient monthly lookups
CREATE INDEX idx_home_costs_user_dates ON home_costs(user_id, start_date, end_date);
```

### Table: `home_costs_settings`

```sql
CREATE TABLE home_costs_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  display_mode TEXT NOT NULL DEFAULT 'separate' CHECK (display_mode IN ('separate', 'consolidated')),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints

### List Home Costs

```
GET /api/home-costs
```

**Response:**
```json
{
  "costs": [
    {
      "id": "uuid",
      "costType": "use_of_home",
      "hoursPerMonth": "101+",
      "monthlyRate": 26,
      "startDate": "2024-04",
      "endDate": null
    },
    {
      "id": "uuid",
      "costType": "phone_broadband",
      "description": "Mobile Phone",
      "monthlyCost": 40,
      "businessPercent": 60,
      "claimableAmount": 24,
      "startDate": "2024-04",
      "endDate": null
    }
  ],
  "settings": {
    "displayMode": "separate"
  }
}
```

### Create Home Cost

```
POST /api/home-costs
```

**Request Body (Use of Home):**
```json
{
  "costType": "use_of_home",
  "hoursPerMonth": "101+",
  "startDate": "2024-04",
  "endDate": null
}
```

**Request Body (Phone & Broadband):**
```json
{
  "costType": "phone_broadband",
  "description": "Mobile Phone",
  "monthlyCost": 40,
  "businessPercent": 60,
  "startDate": "2024-04",
  "endDate": null
}
```

**Request Body (Insurance):**
```json
{
  "costType": "insurance",
  "annualPremium": 240,
  "businessStockValue": 5000,
  "totalContentsValue": 25000,
  "startDate": "2024-04",
  "endDate": "2025-03"
}
```

### Update Home Cost

```
PATCH /api/home-costs/:id
```

### Delete Home Cost

```
DELETE /api/home-costs/:id
```

### Update Settings

```
PATCH /api/home-costs/settings
```

**Request Body:**
```json
{
  "displayMode": "consolidated"
}
```

---

## P&L Integration

### Monthly Calculation

For a given month, calculate applicable home costs:

```typescript
interface MonthlyHomeCosts {
  useOfHome: number;
  phoneBroadband: number;
  insurance: number;
  total: number;
}

function calculateHomeCostsForMonth(
  costs: HomeCost[],
  year: number,
  month: number
): MonthlyHomeCosts {
  const targetMonth = `${year}-${String(month).padStart(2, '0')}`;
  
  let useOfHome = 0;
  let phoneBroadband = 0;
  let insurance = 0;
  
  for (const cost of costs) {
    // Check if cost applies to this month
    if (!isActiveInMonth(cost, targetMonth)) continue;
    
    switch (cost.costType) {
      case 'use_of_home':
        useOfHome += getMonthlyRate(cost.hoursPerMonth);
        break;
        
      case 'phone_broadband':
        phoneBroadband += cost.monthlyCost * (cost.businessPercent / 100);
        break;
        
      case 'insurance':
        const annualClaimable = cost.annualPremium * 
          (cost.businessStockValue / cost.totalContentsValue);
        insurance += annualClaimable / 12;
        break;
    }
  }
  
  return {
    useOfHome,
    phoneBroadband,
    insurance,
    total: useOfHome + phoneBroadband + insurance
  };
}

function isActiveInMonth(cost: HomeCost, targetMonth: string): boolean {
  const start = cost.startDate;  // "2024-04"
  const end = cost.endDate;      // "2025-03" or null
  
  if (targetMonth < start) return false;
  if (end && targetMonth > end) return false;
  
  return true;
}

function getMonthlyRate(hours: string): number {
  switch (hours) {
    case '25-50': return 10;
    case '51-100': return 18;
    case '101+': return 26;
    default: return 0;
  }
}
```

### P&L Report Display

#### Separate Line Items (Default)

```
┌─────────────────────────────────────────────────────────────────┐
│ Expenses                                                        │
│                                                                 │
│   Selling Fees                                                  │
│     eBay Fees                                    £123.45       │
│     Amazon Fees                                   £67.89       │
│                                                                 │
│   Stock Purchase                                                │
│     Lego Stock Purchases                         £456.78       │
│                                                                 │
│   Packing & Postage                                             │
│     Postage                                       £89.00       │
│     Packing Materials                             £23.45       │
│                                                                 │
│   Home Costs                              ← New section         │
│     Use of Home                                   £26.00       │
│     Phone & Broadband                             £46.00       │
│     Insurance                                      £4.00       │
│                                                                 │
│   Bills                                                         │
│     Amazon Subscription                           £30.00       │
│     ...                                                        │
│                                                                 │
│                                              ──────────────    │
│   Total Expenses                                £866.57        │
└─────────────────────────────────────────────────────────────────┘
```

#### Consolidated Line Item

```
┌─────────────────────────────────────────────────────────────────┐
│ Expenses                                                        │
│                                                                 │
│   ...                                                           │
│                                                                 │
│   Home Costs                                      £76.00       │
│                                                                 │
│   ...                                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## QuickFile MTD Export Integration

Home costs should be included in the MTD export with appropriate nominal codes:

| Category | Nominal Code | Description |
|----------|--------------|-------------|
| Use of Home | 7500 | Use of Home |
| Phone & Broadband | 7502 | Telephone & Internet |
| Insurance | 7104 | Premises Insurance |

Update the export query to include home costs for the target month.

---

## Validation Rules

| Field | Rule |
|-------|------|
| `start_date` | Required, must be first of month |
| `end_date` | Optional, must be >= start_date if provided |
| `hours_per_month` | Required for use_of_home |
| `description` | Required for phone_broadband, max 100 chars |
| `monthly_cost` | Required for phone_broadband, must be > 0 |
| `business_percent` | Required for phone_broadband, 1-100 |
| `annual_premium` | Required for insurance, must be > 0 |
| `business_stock_value` | Required for insurance, must be > 0 |
| `total_contents_value` | Required for insurance, must be >= business_stock_value |

---

## Edge Cases

### Overlapping Date Ranges

Multiple costs of the same type with overlapping dates are allowed. For example:
- Mobile phone contract changes mid-year
- User adds both mobile and landline (both phone_broadband type)

All active costs for a month are summed.

### Mid-Month Changes

Costs are applied to whole months only. If a cost starts in April 2024, the full monthly amount is claimed for April regardless of the actual start day.

### Insurance Renewal

When insurance renews with a new premium:
1. Set end date on existing insurance cost
2. Create new insurance cost with new premium and start date

---

## Implementation Checklist

- [ ] Create `home_costs` database table
- [ ] Create `home_costs_settings` database table
- [ ] Implement API endpoints (CRUD)
- [ ] Build Home Costs modal component
- [ ] Build Use of Home tab
- [ ] Build Phone & Broadband tab with add/edit dialog
- [ ] Build Insurance tab
- [ ] Build Settings tab
- [ ] Integrate home costs into P&L calculation
- [ ] Update P&L report to display home costs
- [ ] Update QuickFile MTD export to include home costs
- [ ] Add validation and error handling
- [ ] Write tests for monthly calculation logic
