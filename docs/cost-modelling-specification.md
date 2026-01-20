# Cost Modelling Page - Feature Specification

## Epic Summary

**Epic: Cost Modelling & P&L Projection Tool**

As a LEGO reseller running Hadley Bricks, I want a cost modelling tool that:

- Lets me create "what-if" P&L projections based on assumptions about sales volumes, pricing, fees, and costs
- Calculates annual profit, take-home pay after tax, and key metrics across all platforms
- Allows me to save multiple scenario versions for future reference
- Lets me compare two scenarios side-by-side to understand the impact of changes
- Provides detailed breakdowns of costs per package type, platform fees, and COG budgets
- Helps me make informed business decisions about pricing, platform focus, and cost management

**Future Phase:** Compare projections against actual performance data from the system.

---

## Business Context

### Purpose

This is a **planning and projection tool** for understanding the financial dynamics of the business. It answers questions like:

- "What's my projected annual profit if I hit my sales targets?"
- "What happens to my take-home if I go over the VAT threshold?"
- "How much COG budget do I have per platform?"
- "What if I increase Amazon volume by 50%?"

### Current State

Currently modelled in Excel spreadsheet with two variants (Sub 90 / Over 90 referring to VAT threshold scenarios). The model has been refined over time and captures the real cost structure of the business.

### Key Business Rules

1. **VAT Flat Rate Scheme**: When over threshold, VAT is charged at 7.5% of turnover (not standard 20%)
2. **Fixed Cost Allocation**: Monthly fixed costs are spread across all sales as a per-item cost
3. **Platform Fee Rates**: Each platform has different fee structures (BrickLink 10%, Amazon 18.3%, eBay 20%)
4. **COG Percentages**: Target COG varies by platform based on sourcing strategy
5. **Tax Calculation**: Income tax at 20% and NI at 6% above personal allowance (£12,570)

---

## Page Layout Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HEADER                                                                         │
│  Cost Modelling                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │ Scenario: [Dropdown: My Scenarios ▼] [+ New] [Save] [Save As] [Delete]  │   │
│  │ Compare Mode: [Toggle Off/On]                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  MAIN CONTENT                                                                   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  📊 PROFIT SUMMARY (Hero metrics)                                       │   │
│  │  Annual Profit | Take-Home | Weekly Take-Home | Profit vs Target        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌──────────────────────────────┐ ┌────────────────────────────────────────┐   │
│  │  💰 ASSUMPTIONS              │ │  📈 ANNUAL P&L BREAKDOWN               │   │
│  │  (Editable inputs)           │ │  (Calculated outputs)                  │   │
│  │  - Sales volumes             │ │  - Revenue by platform                 │   │
│  │  - Sale prices               │ │  - Fees by platform                    │   │
│  │  - Fee rates                 │ │  - Costs breakdown                     │   │
│  │  - COG percentages           │ │  - COG by platform                     │   │
│  │  - Fixed costs               │ │  - Tax calculation                     │   │
│  │  - VAT settings              │ │                                        │   │
│  └──────────────────────────────┘ └────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  📦 PER-PACKAGE COST MATRIX                                             │   │
│  │  6 columns: Large/Small/Letter × Amazon/eBay                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  📅 SUMMARY VIEWS                                                       │   │
│  │  Daily | Weekly | Monthly breakdowns by platform                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Compare Mode Layout

When Compare Mode is enabled, the page splits into two columns:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  Compare Mode: [Toggle ON]                                                      │
│  Scenario A: [Dropdown ▼]              Scenario B: [Dropdown ▼]                 │
├────────────────────────────────────────┬────────────────────────────────────────┤
│  SCENARIO A                            │  SCENARIO B                            │
│                                        │                                        │
│  📊 Profit Summary                     │  📊 Profit Summary                     │
│  [metrics]                             │  [metrics]                             │
│                                        │                                        │
│  💰 Assumptions                        │  💰 Assumptions                        │
│  [inputs - editable]                   │  [inputs - editable]                   │
│                                        │                                        │
│  📈 P&L Breakdown                      │  📈 P&L Breakdown                      │
│  [outputs]                             │  [outputs]                             │
│                                        │                                        │
├────────────────────────────────────────┴────────────────────────────────────────┤
│  📊 COMPARISON SUMMARY                                                          │
│  Delta: Profit A vs B | Take-Home A vs B | Key differences highlighted         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Detailed Section Specifications

### 1. Header & Scenario Management

**Scenario Dropdown:**
- Lists all saved scenarios for the user
- Shows scenario name and last modified date
- Default: Most recently modified scenario (or "New Scenario" if none)

**Actions:**
- **+ New**: Create a new scenario with default values
- **Save**: Save current scenario (updates existing)
- **Save As**: Save as new scenario (prompts for name)
- **Delete**: Delete current scenario (with confirmation)

**Compare Mode Toggle:**
- Off: Single scenario view (default)
- On: Side-by-side comparison of two scenarios

---

### 2. Profit Summary (Hero Metrics)

Four key metrics displayed prominently:

| Metric | Calculation | Format |
|--------|-------------|--------|
| **Annual Profit** | Turnover - Fees - VAT - Costs - COG | £XX,XXX |
| **Take-Home** | Profit - Income Tax - NI | £XX,XXX |
| **Weekly Take-Home** | Take-Home / 52 | £XXX |
| **Profit vs Target** | Profit - Target Profit | +£X,XXX or -£X,XXX |

In Compare Mode, show delta between scenarios:
- Green up arrow if Scenario B is better
- Red down arrow if Scenario B is worse

---

### 3. Assumptions Panel (Editable Inputs)

Organised into collapsible sections:

#### 3.1 Sales Volume & Pricing

| Input | Default | Notes |
|-------|---------|-------|
| **BrickLink** | | |
| Sales per month | 165 | Number of orders |
| Average sale value (inc. postage) | £15.00 | |
| Average postage cost | £2.70 | Your cost to ship |
| **Amazon** | | |
| Sales per month | 75 | |
| Average sale value (free postage) | £40.00 | Customer pays nothing |
| Average postage cost | £3.95 | Your cost to ship |
| **eBay** | | |
| Sales per month | 80 | |
| Average sale value (inc. postage) | £25.00 | |
| Average postage cost | £3.20 | Your cost to ship |

**Calculated displays (read-only):**
- Total sales per month: 320
- Annual turnover: £89,700

#### 3.2 Platform Fee Rates

| Input | Default | Notes |
|-------|---------|-------|
| BrickLink fee rate | 10% | PayPal + BL + Bricqer |
| Amazon fee rate | 18.3% | Including referral + FBA/shipping |
| eBay fee rate | 20% | Including promoted listings |

#### 3.3 Cost of Goods (COG)

| Input | Default | Notes |
|-------|---------|-------|
| BrickLink COG % | 20% | Target COG as % of sale price |
| Amazon COG % | 35% | |
| eBay COG % | 30% | |

**Calculated displays (read-only):**
- BrickLink COG per item: £3.00
- Amazon COG per item: £14.00
- eBay COG per item: £7.50

#### 3.4 Fixed Costs (Monthly)

| Input | Default | Notes |
|-------|---------|-------|
| Shopify | £25 | |
| eBay Store | £35 | |
| Seller Amp + Swoopa | £50 | |
| Amazon | £30 | |
| Storage Unit | £110 | |
| Accountant (monthly) | £16.67 | Derived from annual |
| Banking + Misc (monthly) | £83.33 | Derived from annual |
| **Total Monthly Fixed** | **£350** | Calculated |

**Yearly inputs (feeds into monthly):**
- Annual accountant cost: £200
- Annual misc costs: £1,000

#### 3.5 VAT Settings

| Input | Default | Notes |
|-------|---------|-------|
| Over VAT threshold? | No | Toggle |
| VAT flat rate | 7.5% | Only applies if over threshold |

When "Over VAT threshold" is Yes:
- Accountant cost increases (default: £200 → £1,650)
- VAT is calculated on turnover

#### 3.6 Tax Settings

| Input | Default | Notes |
|-------|---------|-------|
| Target annual profit | £26,000 | For comparison |
| Personal allowance | £12,570 | Tax-free amount |
| Income tax rate | 20% | Basic rate |
| NI rate | 6% | Class 4 NI |

---

### 4. Annual P&L Breakdown (Calculated Outputs)

Read-only section showing the full P&L calculation:

```
REVENUE
├── BrickLink Turnover                    £29,700
├── Amazon Turnover                       £36,000
├── eBay Turnover                         £24,000
└── TOTAL TURNOVER                        £89,700

PLATFORM FEES
├── BrickLink Fees (10%)                  -£2,970
├── Amazon Fees (18.3%)                   -£6,588
├── eBay Fees (20%)                       -£4,800
└── TOTAL FEES                           -£14,358

VAT (if applicable)
└── VAT @ 7.5%                            £0 (or -£6,728)

OTHER COSTS
├── Fixed Costs (annual)                  -£4,200
├── Packaging Materials                   -£1,504
│   ├── Cardboard                         -£1,222
│   └── Bubble Wrap                       -£282
├── Platform Postage
│   ├── BrickLink Postage                 -£5,346
│   ├── Amazon Postage                    -£3,555
│   └── eBay Postage                      -£3,072
├── Lego Parts (2% eBay)                  -£480
├── Lego Cards                            -£38
├── Business Cards                        -£211
├── Accountant                            -£200
└── Misc Costs                            -£1,000
TOTAL OTHER COSTS                        -£19,607

GROSS PROFIT (before COG)                 £55,735

COST OF GOODS
├── BrickLink COG (20%)                   -£5,940
├── Amazon COG (35%)                     -£12,600
├── eBay COG (30%)                        -£7,200
└── TOTAL COG                            -£25,740

NET PROFIT                                £29,995
├── vs Target (£26,000)                   +£3,995

TAX
├── Income Tax (20% above £12,570)        -£3,485
├── National Insurance (6%)               -£1,046
└── TOTAL TAX                             -£4,531

TAKE-HOME PAY                             £25,465
├── Per Week                              £490
```

---

### 5. Per-Package Cost Matrix

Editable 6-column matrix for packaging costs:

| Cost Item | Large Parcel Amazon | Small Parcel Amazon | Large Letter Amazon | Large Parcel eBay | Small Parcel eBay | Large Letter eBay |
|-----------|---------------------|---------------------|---------------------|-------------------|-------------------|-------------------|
| Postage | £3.95 | £3.95 | £3.10 | £3.29 | £3.29 | £2.56 |
| Cardboard | £0.90 | £0.35 | £0.08 | £0.30 | £0.20 | £0.08 |
| Bubble Wrap | £0.12 | £0.12 | £0.02 | £0.08 | £0.08 | £0.02 |
| Lego Card | £0.00 | £0.00 | £0.00 | £0.02 | £0.02 | £0.02 |
| Business Card | £0.00 | £0.00 | £0.00 | £0.11 | £0.11 | £0.11 |
| Fixed Cost/Sale | £1.09 | £1.09 | £1.09 | £1.09 | £1.09 | £1.09 |
| **TOTAL** | **£6.06** | **£5.51** | **£4.29** | **£4.89** | **£4.79** | **£3.88** |

**Notes:**
- Fixed Cost/Sale is auto-calculated from total fixed costs / total sales
- TOTAL row is auto-calculated
- BrickLink column not needed (uses simple postage cost assumption)

---

### 6. Summary Views

Tabbed or accordion views showing different time breakdowns:

#### Daily View

| Platform | Sales/Day | COG | Sale Price | Sale Price (exc. postage) | Turnover/Day | COG Budget/Day |
|----------|-----------|-----|------------|---------------------------|--------------|----------------|
| BrickLink | 5.42 | £3.00 | £15.00 | £12.30 | £81.37 | £16.27 |
| Amazon | 2.47 | £14.00 | £40.00 | £40.00 | £98.63 | £34.52 |
| eBay | 2.63 | £7.50 | £25.00 | £21.80 | £65.75 | £19.73 |
| **TOTAL** | **10.52** | **£24.50** | | | **£245.75** | **£70.52** |

#### Weekly View

| Platform | COG Budget | Sales Target | Sales Volume |
|----------|------------|--------------|--------------|
| BrickLink | £113.92 | £569.59 | 37.97 |
| Amazon | £241.64 | £690.41 | 17.26 |
| eBay | £138.08 | £460.27 | 18.41 |
| **TOTAL** | **£493.64** | **£1,720.27** | **73.64** |

#### Monthly View

| Platform | COG Budget | Sales Target | Sales Volume |
|----------|------------|--------------|--------------|
| BrickLink | £495 | £2,475 | 165 |
| Amazon | £1,050 | £3,000 | 75 |
| eBay | £600 | £2,000 | 80 |
| **TOTAL** | **£2,145** | **£7,475** | **320** |

---

### 7. Comparison Summary (Compare Mode Only)

When comparing two scenarios, show a summary table of key differences:

| Metric | Scenario A | Scenario B | Delta | % Change |
|--------|------------|------------|-------|----------|
| Annual Turnover | £89,700 | £120,000 | +£30,300 | +33.8% |
| Total Fees | £14,358 | £19,200 | +£4,842 | +33.7% |
| Total COG | £25,740 | £34,500 | +£8,760 | +34.0% |
| Net Profit | £29,995 | £38,000 | +£8,005 | +26.7% |
| Take-Home | £25,465 | £31,200 | +£5,735 | +22.5% |

Highlight rows where delta is significant (>10% change).

---

## Data Model

### cost_model_scenarios

```sql
CREATE TABLE cost_model_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Sales Volume & Pricing
  bl_sales_per_month INTEGER DEFAULT 165,
  bl_avg_sale_value DECIMAL(10,2) DEFAULT 15.00,
  bl_avg_postage_cost DECIMAL(10,2) DEFAULT 2.70,
  
  amazon_sales_per_month INTEGER DEFAULT 75,
  amazon_avg_sale_value DECIMAL(10,2) DEFAULT 40.00,
  amazon_avg_postage_cost DECIMAL(10,2) DEFAULT 3.95,
  
  ebay_sales_per_month INTEGER DEFAULT 80,
  ebay_avg_sale_value DECIMAL(10,2) DEFAULT 25.00,
  ebay_avg_postage_cost DECIMAL(10,2) DEFAULT 3.20,
  
  -- Fee Rates
  bl_fee_rate DECIMAL(5,4) DEFAULT 0.10,
  amazon_fee_rate DECIMAL(5,4) DEFAULT 0.183,
  ebay_fee_rate DECIMAL(5,4) DEFAULT 0.20,
  
  -- COG Percentages
  bl_cog_percent DECIMAL(5,4) DEFAULT 0.20,
  amazon_cog_percent DECIMAL(5,4) DEFAULT 0.35,
  ebay_cog_percent DECIMAL(5,4) DEFAULT 0.30,
  
  -- Fixed Costs (Monthly)
  fixed_shopify DECIMAL(10,2) DEFAULT 25.00,
  fixed_ebay_store DECIMAL(10,2) DEFAULT 35.00,
  fixed_seller_tools DECIMAL(10,2) DEFAULT 50.00,
  fixed_amazon DECIMAL(10,2) DEFAULT 30.00,
  fixed_storage DECIMAL(10,2) DEFAULT 110.00,
  
  -- Annual Costs (converted to monthly in calculations)
  annual_accountant_cost DECIMAL(10,2) DEFAULT 200.00,
  annual_misc_costs DECIMAL(10,2) DEFAULT 1000.00,
  
  -- VAT Settings
  is_vat_registered BOOLEAN DEFAULT FALSE,
  vat_flat_rate DECIMAL(5,4) DEFAULT 0.075,
  accountant_cost_if_vat DECIMAL(10,2) DEFAULT 1650.00,
  
  -- Tax Settings
  target_annual_profit DECIMAL(10,2) DEFAULT 26000.00,
  personal_allowance DECIMAL(10,2) DEFAULT 12570.00,
  income_tax_rate DECIMAL(5,4) DEFAULT 0.20,
  ni_rate DECIMAL(5,4) DEFAULT 0.06,
  
  -- Lego Parts (% of eBay turnover)
  lego_parts_percent DECIMAL(5,4) DEFAULT 0.02,
  
  -- Metadata
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cost_scenarios_user ON cost_model_scenarios(user_id);
```

### cost_model_package_costs

```sql
CREATE TABLE cost_model_package_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES cost_model_scenarios(id) ON DELETE CASCADE,
  
  -- Package type identifier
  package_type VARCHAR(50) NOT NULL, -- 'large_parcel_amazon', 'small_parcel_amazon', 'large_letter_amazon', 'large_parcel_ebay', 'small_parcel_ebay', 'large_letter_ebay'
  
  -- Cost components
  postage DECIMAL(10,2) NOT NULL,
  cardboard DECIMAL(10,2) NOT NULL,
  bubble_wrap DECIMAL(10,2) NOT NULL,
  lego_card DECIMAL(10,2) DEFAULT 0.00,
  business_card DECIMAL(10,2) DEFAULT 0.00,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(scenario_id, package_type)
);
```

### Default Package Cost Values

When creating a new scenario, seed with these defaults:

| package_type | postage | cardboard | bubble_wrap | lego_card | business_card |
|--------------|---------|-----------|-------------|-----------|---------------|
| large_parcel_amazon | 3.95 | 0.90 | 0.12 | 0.00 | 0.00 |
| small_parcel_amazon | 3.95 | 0.35 | 0.12 | 0.00 | 0.00 |
| large_letter_amazon | 3.10 | 0.08 | 0.02 | 0.00 | 0.00 |
| large_parcel_ebay | 3.29 | 0.30 | 0.08 | 0.02 | 0.11 |
| small_parcel_ebay | 3.29 | 0.20 | 0.08 | 0.02 | 0.11 |
| large_letter_ebay | 2.56 | 0.08 | 0.02 | 0.02 | 0.11 |

---

## Calculation Logic

### Core Formulas

```typescript
// Helper: Total monthly sales
const totalMonthlySales = bl_sales + amazon_sales + ebay_sales;

// Helper: Total monthly fixed costs
const monthlyFixedCosts = 
  fixed_shopify + fixed_ebay_store + fixed_seller_tools + 
  fixed_amazon + fixed_storage + 
  (annual_accountant_cost / 12) + (annual_misc_costs / 12);

// Fixed cost per sale
const fixedCostPerSale = monthlyFixedCosts / totalMonthlySales;

// Turnover
const bl_turnover = bl_sales * bl_avg_sale_value * 12;
const amazon_turnover = amazon_sales * amazon_avg_sale_value * 12;
const ebay_turnover = ebay_sales * ebay_avg_sale_value * 12;
const total_turnover = bl_turnover + amazon_turnover + ebay_turnover;

// Platform fees
const bl_fees = bl_turnover * bl_fee_rate;
const amazon_fees = amazon_turnover * amazon_fee_rate;
const ebay_fees = ebay_turnover * ebay_fee_rate;
const total_fees = bl_fees + amazon_fees + ebay_fees;

// VAT (if registered)
const vat = is_vat_registered ? total_turnover * vat_flat_rate : 0;

// Annual fixed costs
const annual_fixed = monthlyFixedCosts * 12;

// Packaging costs (average across package types, weighted by sales)
const avg_cardboard = calculateWeightedAverage(packageCosts, 'cardboard');
const avg_bubble_wrap = calculateWeightedAverage(packageCosts, 'bubble_wrap');
const annual_cardboard = avg_cardboard * totalMonthlySales * 12;
const annual_bubble_wrap = avg_bubble_wrap * totalMonthlySales * 12;

// Postage costs
const bl_postage_annual = bl_avg_postage_cost * bl_sales * 12;
const amazon_postage_annual = amazon_avg_postage_cost * amazon_sales * 12;
const ebay_postage_annual = ebay_avg_postage_cost * ebay_sales * 12;

// Other costs
const lego_parts = ebay_turnover * lego_parts_percent;
const lego_cards = calculateLegoCardsCost(packageCosts, totalMonthlySales);
const business_cards = calculateBusinessCardsCost(packageCosts, totalMonthlySales);
const accountant = is_vat_registered ? accountant_cost_if_vat : annual_accountant_cost;

// Total other costs
const total_other_costs = 
  annual_fixed + annual_cardboard + annual_bubble_wrap +
  bl_postage_annual + amazon_postage_annual + ebay_postage_annual +
  lego_parts + lego_cards + business_cards + accountant + annual_misc_costs;

// Gross profit (before COG)
const gross_profit = total_turnover - total_fees - vat - total_other_costs;

// COG
const bl_cog = bl_turnover * bl_cog_percent;
const amazon_cog = amazon_turnover * amazon_cog_percent;
const ebay_cog = ebay_turnover * ebay_cog_percent;
const total_cog = bl_cog + amazon_cog + ebay_cog;

// Net profit
const net_profit = gross_profit - total_cog;

// Tax calculation
const taxable_income = Math.max(0, net_profit - personal_allowance);
const income_tax = taxable_income * income_tax_rate;
const national_insurance = taxable_income * ni_rate;
const total_tax = income_tax + national_insurance;

// Take-home
const take_home = net_profit - total_tax;
const weekly_take_home = take_home / 52;

// Profit vs target
const profit_vs_target = net_profit - target_annual_profit;
```

### Per-Item COG Calculations

```typescript
// COG per item (for summary views)
const bl_cog_per_item = bl_avg_sale_value * bl_cog_percent;
const amazon_cog_per_item = amazon_avg_sale_value * amazon_cog_percent;
const ebay_cog_per_item = ebay_avg_sale_value * ebay_cog_percent;

// Sale price excluding postage
const bl_sale_exc_postage = bl_avg_sale_value - bl_avg_postage_cost;
const ebay_sale_exc_postage = ebay_avg_sale_value - ebay_avg_postage_cost;
const amazon_sale_exc_postage = amazon_avg_sale_value; // Already excludes postage
```

### Daily/Weekly/Monthly Calculations

```typescript
// Daily
const sales_per_day = totalMonthlySales * 12 / 365;
const turnover_per_day = total_turnover / 365;
const cog_budget_per_day = total_cog / 365;

// Weekly
const sales_per_week = totalMonthlySales * 12 / 52;
const turnover_per_week = total_turnover / 52;
const cog_budget_per_week = total_cog / 52;

// Monthly (already have these)
```

---

## API Endpoints

### Scenarios

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cost-modelling/scenarios` | GET | List all scenarios for user |
| `/api/cost-modelling/scenarios` | POST | Create new scenario |
| `/api/cost-modelling/scenarios/:id` | GET | Get scenario with package costs |
| `/api/cost-modelling/scenarios/:id` | PUT | Update scenario |
| `/api/cost-modelling/scenarios/:id` | DELETE | Delete scenario |
| `/api/cost-modelling/scenarios/:id/duplicate` | POST | Duplicate scenario with new name |

### Calculations

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cost-modelling/calculate` | POST | Calculate P&L from scenario data (for live preview) |
| `/api/cost-modelling/compare` | POST | Compare two scenarios, return deltas |

### Request/Response Examples

**POST /api/cost-modelling/scenarios**
```json
{
  "name": "2025 Target - Conservative",
  "description": "Conservative estimates for 2025"
}
```

**GET /api/cost-modelling/scenarios/:id**
```json
{
  "id": "uuid",
  "name": "2025 Target - Conservative",
  "bl_sales_per_month": 165,
  "bl_avg_sale_value": 15.00,
  // ... all other fields
  "package_costs": [
    {
      "package_type": "large_parcel_amazon",
      "postage": 3.95,
      "cardboard": 0.90,
      "bubble_wrap": 0.12,
      "lego_card": 0.00,
      "business_card": 0.00
    }
    // ... other package types
  ],
  "calculated": {
    "total_turnover": 89700,
    "total_fees": 14358,
    "total_cog": 25740,
    "net_profit": 29995,
    "take_home": 25465,
    "weekly_take_home": 489.71
    // ... all calculated values
  }
}
```

---

## UI Components

### ScenarioSelector

Dropdown with scenario management actions:

```typescript
interface ScenarioSelectorProps {
  scenarios: Scenario[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onDelete: (id: string) => void;
  hasUnsavedChanges: boolean;
}
```

### ProfitSummaryCard

Hero metrics display:

```typescript
interface ProfitSummaryCardProps {
  annualProfit: number;
  takeHome: number;
  weeklyTakeHome: number;
  profitVsTarget: number;
  targetProfit: number;
  comparisonData?: {
    annualProfit: number;
    takeHome: number;
    weeklyTakeHome: number;
    profitVsTarget: number;
  };
}
```

### AssumptionsPanel

Collapsible sections with editable inputs:

```typescript
interface AssumptionsPanelProps {
  scenario: Scenario;
  onChange: (field: string, value: number | boolean) => void;
  onPackageCostChange: (packageType: string, field: string, value: number) => void;
}
```

### PLBreakdownPanel

Read-only P&L display with expandable sections:

```typescript
interface PLBreakdownPanelProps {
  calculated: CalculatedResults;
  showComparison?: boolean;
  comparisonData?: CalculatedResults;
}
```

### PackageCostMatrix

Editable 6-column cost matrix:

```typescript
interface PackageCostMatrixProps {
  packageCosts: PackageCost[];
  fixedCostPerSale: number;
  onChange: (packageType: string, field: string, value: number) => void;
}
```

### SummaryViewTabs

Daily/Weekly/Monthly breakdown tabs:

```typescript
interface SummaryViewTabsProps {
  calculated: CalculatedResults;
  scenario: Scenario;
}
```

### ComparisonSummary

Side-by-side comparison table:

```typescript
interface ComparisonSummaryProps {
  scenarioA: { name: string; calculated: CalculatedResults };
  scenarioB: { name: string; calculated: CalculatedResults };
}
```

---

## Implementation Phases

### Phase 1: Core Model & Single Scenario

- Database tables and API endpoints
- Scenario CRUD operations
- Assumptions panel with all inputs
- P&L breakdown calculation and display
- Profit summary hero metrics
- Save/load scenarios

### Phase 2: Package Cost Matrix

- Package costs table and UI
- Integration with main calculations
- Default seeding for new scenarios

### Phase 3: Summary Views

- Daily/Weekly/Monthly breakdown tabs
- COG budget displays
- Sales volume targets

### Phase 4: Compare Mode

- Side-by-side scenario comparison
- Comparison summary with deltas
- Duplicate scenario functionality

### Phase 5: Polish & UX

- Unsaved changes warning
- Auto-save draft
- Keyboard shortcuts
- Mobile responsive layout
- Export to PDF/Excel

---

## Future Phase: Actuals Comparison

**Not in scope for initial build, but planned for future:**

- Pull actual sales volumes from orders data
- Pull actual fees from transaction data
- Pull actual COG from purchase/inventory data
- Show "Projected vs Actual" variance
- Suggest assumption adjustments based on actuals

---

## Notes for Define Done Agent

1. **All calculations happen client-side** for instant feedback. The API just stores/retrieves scenario data.

2. **Package cost matrix is optional complexity** - if user doesn't edit it, defaults are fine. The main assumptions (postage costs in section 3.1) feed the primary calculations.

3. **VAT threshold toggle changes multiple things** - when enabled, accountant cost increases AND VAT is calculated on turnover.

4. **Fixed cost per sale is auto-calculated** - user cannot edit directly, it's derived from total fixed costs / total sales.

5. **Compare mode is a view toggle** - doesn't create new data, just displays two scenarios side-by-side.

6. **Scenarios are user-specific** - each user has their own set of saved scenarios.

7. **Default scenario** - when user first visits, create a default scenario with all the default values from this spec.
