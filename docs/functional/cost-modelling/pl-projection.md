# Journey: P&L Projection

> **Entry Point:** `/cost-modelling`
> **Prerequisites:** At least one scenario
> **Complexity:** Medium

## Purpose

Project your annual Profit & Loss based on sales assumptions. Edit inputs across six categories and see calculations update in real-time. Understand the financial impact of changes to sales volume, fees, costs, and tax.

---

## Key Concepts

### Input Categories

| Category | Section | Key Inputs |
|----------|---------|------------|
| **Sales** | Sales Volume & Pricing | Monthly sales, avg value, postage |
| **Fees** | Platform Fee Rates | Platform commission percentages |
| **COG** | Cost of Goods | Stock cost as % of sale value |
| **Fixed** | Fixed Costs | Monthly and annual overheads |
| **VAT** | VAT Settings | Registration toggle, flat rate |
| **Tax** | Tax Settings | Allowance, tax rates |

### Output Metrics

| Metric | Description |
|--------|-------------|
| **Turnover** | Total annual revenue |
| **Gross Profit** | After fees, VAT, and other costs |
| **Net Profit** | After cost of goods |
| **Take-Home** | After tax |
| **Weekly** | Take-home divided by 52 |

---

## User Flow

### Step 1: Load Scenario

1. Navigate to `/cost-modelling`
2. Select scenario from dropdown
3. All inputs load with saved values
4. Calculations display immediately

### Step 2: Edit Sales Assumptions

1. Expand **Sales Volume & Pricing** accordion
2. For each platform (BrickLink, Amazon, eBay):
   - **Sales per Month**: Number of orders
   - **Avg Sale Value**: Average order value in £
   - **Avg Postage Cost**: Shipping cost per order
3. Calculations update as you type

### Step 3: Adjust Fee Rates

1. Expand **Platform Fee Rates** accordion
2. Enter percentage for each platform:
   - BrickLink: ~10%
   - Amazon: ~18.3%
   - eBay: ~20%
3. Fees include commission, payment processing, FBA

### Step 4: Set COG Percentages

1. Expand **Cost of Goods** accordion
2. Enter COG % per platform (cost as % of sale):
   - BrickLink: ~20% (lower margin)
   - Amazon: ~35% (higher margin)
   - eBay: ~30%
3. Optionally set Lego Parts % (spent on replacement parts)

### Step 5: Configure Fixed Costs

1. Expand **Fixed Costs** accordion
2. **Monthly costs:**
   - Shopify subscription
   - eBay Store subscription
   - Seller tools (Bricqer, etc.)
   - Amazon Pro account
   - Storage rental
3. **Annual costs:**
   - Accountant fees
   - Miscellaneous

### Step 6: VAT Settings

1. Expand **VAT Settings** accordion
2. Toggle **Over VAT threshold** if applicable
3. If VAT registered:
   - Set **VAT Flat Rate** (typically 7.5% for retail)
   - Set **Accountant Cost (VAT)** (higher due to VAT returns)

### Step 7: Tax Settings

1. Expand **Tax Settings** accordion
2. Configure:
   - **Target Annual Profit**: Your goal (for comparison)
   - **Personal Allowance**: Tax-free amount (£12,570)
   - **Income Tax Rate**: Basic rate (20%)
   - **NI Rate**: National Insurance (6%)

### Step 8: Review Results

1. **Profit Summary Cards** at top show key metrics
2. **P&L Breakdown** shows detailed line-by-line
3. Toggle between **Yearly** and **Monthly** views
4. Expand/collapse sections in breakdown

### Step 9: Save Changes

1. Click **Save** button
2. Changes persisted to database
3. Draft cleared
4. Success notification shown

---

## P&L Breakdown Sections

### Revenue (Turnover)

Shows total and per-platform annual revenue.

```
Total Revenue: £50,400
├── BrickLink: £15,000 (50 × £25 × 12)
├── Amazon: £14,400 (30 × £40 × 12)
└── eBay: £14,400 (40 × £30 × 12)
```

### Platform Fees

Percentage-based fees deducted from revenue.

```
Total Fees: -£7,608
├── BrickLink (10%): -£1,500
├── Amazon (18.3%): -£2,635
└── eBay (20%): -£2,880
```

### VAT (if registered)

Flat Rate VAT payable to HMRC.

```
VAT (7.5% Flat Rate): -£3,780
```

### Other Costs

Fixed and variable operating costs.

```
Total Other Costs: -£5,040
├── Fixed Costs: -£1,200
├── Postage: -£5,040
├── Packaging Materials: -£800
├── Lego Parts: -£500
└── Accountant: -£500
```

### Gross Profit

Revenue minus fees, VAT, and other costs.

### Cost of Goods

Stock purchase cost as percentage of sales.

```
Total COG: -£14,040
├── BrickLink (20%): -£3,000
├── Amazon (35%): -£5,040
└── eBay (30%): -£4,320
```

### Net Profit

Gross profit minus cost of goods.

### Tax

Income tax and National Insurance on taxable income.

```
Total Tax: -£4,500
├── Taxable Income: £22,500 (after £12,570 allowance)
├── Income Tax (20%): -£4,500
└── NI (6%): -£1,350
```

### Take-Home

Final amount after all costs and tax.

---

## Validation Rules

| Field | Rule |
|-------|------|
| All numeric inputs | Must be ≥ 0 |
| Percentages | 0-100 (displayed), 0-1 (stored) |
| Fee rates | Max 100% |
| COG percentages | Max 100% |
| Tax rates | Max 100% |

---

## Package Cost Matrix

For detailed shipping cost analysis:

1. Scroll to **Package Costs** section
2. Enter per-package costs by type
3. Components: Postage, Cardboard, Bubble wrap, Cards
4. Total calculated per package type
5. Helps optimise packaging choices

---

## Export Options

1. Click **Export** dropdown
2. Choose format:
   - **Copy to Clipboard**: Markdown table
   - **Download CSV**: Spreadsheet format
3. Includes all calculations and assumptions

---

## API Reference

### GET /api/cost-modelling/scenarios/[id]

Load full scenario with form data.

### PUT /api/cost-modelling/scenarios/[id]

Save all form changes.

**Request Body** includes all input fields:
```json
{
  "blSalesPerMonth": 60,
  "blAvgSaleValue": 28,
  "blFeeRate": 0.10,
  "isVatRegistered": true,
  "vatFlatRate": 0.075,
  "packageCosts": [...]
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Calculations not updating | Check for red validation borders on inputs |
| Negative profit showing red | Adjust assumptions; costs exceed revenue |
| VAT fields hidden | Enable "Over VAT threshold" toggle |
| Changes not saving | Check for conflict error; refresh if needed |

---

## Source Files

| File | Purpose |
|------|---------|
| [AssumptionsPanel.tsx](../../../apps/web/src/components/features/cost-modelling/AssumptionsPanel.tsx) | All input sections |
| [PLBreakdown.tsx](../../../apps/web/src/components/features/cost-modelling/PLBreakdown.tsx) | Detailed P&L view |
| [ProfitSummaryCards.tsx](../../../apps/web/src/components/features/cost-modelling/ProfitSummaryCards.tsx) | Summary metrics |
| [PackageCostMatrix.tsx](../../../apps/web/src/components/features/cost-modelling/PackageCostMatrix.tsx) | Packaging costs |
| [cost-calculations.ts](../../../apps/web/src/lib/services/cost-calculations.ts) | All formulas |

---

## Related Journeys

- [Scenario Management](./scenario-management.md) - Create and manage scenarios
- [Compare Scenarios](./compare-scenarios.md) - Side-by-side comparison
