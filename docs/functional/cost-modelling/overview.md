# Cost Modelling

> **Entry Point:** `/cost-modelling`
> **Status:** Complete
> **Complexity:** High

## Purpose

Model your business profitability with what-if scenarios. Project annual P&L based on sales volumes, platform fees, cost of goods, fixed costs, VAT, and tax. Compare scenarios side-by-side to understand how changes affect your take-home profit.

---

## Key Concepts

### Scenarios

A scenario is a saved set of assumptions used for P&L projection. Each user can have multiple scenarios (minimum 1). Scenarios are named and can be duplicated for quick variations.

| Field | Description |
|-------|-------------|
| **Name** | Unique identifier (e.g., "Baseline 2026", "High Volume") |
| **Description** | Optional notes about the scenario |
| **is_default** | First scenario created automatically |

### Platforms

The tool models three sales platforms separately:

| Platform | Fee Rate | COG % | Notes |
|----------|----------|-------|-------|
| **BrickLink** | 10% | 20% | Lower fees, lower margins |
| **Amazon** | 18.3% | 35% | Higher fees, higher volumes |
| **eBay** | 20% | 30% | Highest fees |

### P&L Components

| Component | Calculation |
|-----------|-------------|
| **Turnover** | Sales per month × Avg sale value × 12 |
| **Platform Fees** | Turnover × Platform fee rate |
| **VAT** | Turnover × VAT flat rate (when registered) |
| **Other Costs** | Fixed costs + Postage + Packaging + Lego parts |
| **Gross Profit** | Turnover - Fees - VAT - Other Costs |
| **COG** | Turnover × COG percentage |
| **Net Profit** | Gross Profit - COG |
| **Tax** | (Net Profit - Personal Allowance) × Tax rates |
| **Take-Home** | Net Profit - Total Tax |

---

## User Journeys

| Journey | Description | File |
|---------|-------------|------|
| [Scenario Management](./scenario-management.md) | Create, edit, delete scenarios | |
| [P&L Projection](./pl-projection.md) | View and interpret calculations | |
| [Compare Scenarios](./compare-scenarios.md) | Side-by-side comparison | |

---

## Features

### Scenario Management (F1-F8)

- Create new scenarios with custom names
- Duplicate existing scenarios
- Rename and add descriptions
- Delete scenarios (minimum 1 must remain)
- Auto-create default scenario for new users
- Save As functionality for variations

### Assumptions Input (F9-F14)

Collapsible accordion sections for:

1. **Sales Volume & Pricing** - Per-platform monthly sales and avg values
2. **Platform Fee Rates** - Percentage fees per platform
3. **Cost of Goods (COG)** - Stock cost as percentage of sale value
4. **Fixed Costs** - Monthly (Shopify, eBay store, tools) and annual (accountant, misc)
5. **VAT Settings** - Toggle for VAT registration, flat rate scheme
6. **Tax Settings** - Personal allowance, income tax rate, NI rate

### Calculations (F15-F22)

Real-time calculations as inputs change:

- Total and per-platform turnover
- Platform fees breakdown
- VAT under Flat Rate Scheme
- All cost categories
- Gross and net profit
- Income tax and National Insurance
- Annual and weekly take-home

### Results Display (F23-F34)

- **Profit Summary Cards** - Key metrics at a glance
- **P&L Breakdown** - Collapsible detailed view
- **Yearly/Monthly Toggle** - Switch between periods
- **Package Cost Matrix** - Detailed shipping costs
- **Export** - Copy or download results

### Compare Mode (F35-F43)

- Side-by-side scenario comparison
- Delta indicators showing differences
- Changes >10% highlighted
- Compact accordion view for each scenario
- Scenario B selector dropdown

### Data Persistence (F44-F48)

- Auto-save draft every 30 seconds
- Draft restoration on return
- Conflict detection for concurrent edits
- Unsaved changes warning

---

## Package Cost Matrix

Track packaging costs per shipment type:

| Package Type | Typical Use |
|--------------|-------------|
| Large Parcel (Amazon) | Large sets via FBA |
| Small Parcel (Amazon) | Standard sets via FBA |
| Large Letter (Amazon) | Minifigures, small items |
| Large Parcel (eBay) | Large sets self-fulfilled |
| Small Parcel (eBay) | Standard sets self-fulfilled |
| Large Letter (eBay) | Minifigures, polybags |

Cost components per package:
- Postage
- Cardboard
- Bubble wrap
- Lego card (thank you cards)
- Business card

---

## API Reference

### GET /api/cost-modelling/scenarios

List all scenarios for the current user.

**Response:**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Baseline 2026",
      "description": "Current business model",
      "updated_at": "2026-01-21T10:00:00Z",
      "is_default": true
    }
  ]
}
```

### POST /api/cost-modelling/scenarios

Create a new scenario with default values.

**Request:**
```json
{
  "name": "High Volume Scenario",
  "description": "What if we double sales?"
}
```

**Response:** `201 Created` with scenario data.

### GET /api/cost-modelling/scenarios/[id]

Get full scenario with all form data and package costs.

**Response:**
```json
{
  "data": {
    "id": "uuid",
    "name": "Baseline 2026",
    "formData": {
      "blSalesPerMonth": 50,
      "blAvgSaleValue": 25,
      "blFeeRate": 0.10,
      "blCogPercent": 0.20,
      "isVatRegistered": false,
      "packageCosts": [...]
    }
  }
}
```

### PUT /api/cost-modelling/scenarios/[id]

Update scenario with all form fields.

**Request:**
```json
{
  "name": "Updated Name",
  "blSalesPerMonth": 60,
  "knownUpdatedAt": "2026-01-21T10:00:00Z"
}
```

**Response:** `200 OK` or `409 Conflict` if concurrent edit detected.

### DELETE /api/cost-modelling/scenarios/[id]

Delete a scenario (must have at least 1 remaining).

**Response:** `200 OK` or `400 Bad Request` if last scenario.

### POST /api/cost-modelling/scenarios/[id]/duplicate

Duplicate an existing scenario.

**Request:**
```json
{
  "name": "Copy of Baseline"
}
```

### PUT /api/cost-modelling/scenarios/[id]/draft

Save draft data for auto-restore.

### DELETE /api/cost-modelling/scenarios/[id]/draft

Clear draft after successful save.

---

## Calculations Reference

### Turnover Formula

```
platformTurnover = salesPerMonth × avgSaleValue × 12
totalTurnover = blTurnover + amazonTurnover + ebayTurnover
```

### Fee Formula

```
platformFees = platformTurnover × feeRate
totalFees = blFees + amazonFees + ebayFees
```

### VAT Formula (Flat Rate Scheme)

```
vatAmount = (isVatRegistered) ? totalTurnover × vatFlatRate : 0
```

### COG Formula

```
platformCog = platformTurnover × cogPercent
totalCog = blCog + amazonCog + ebayCog
```

### Fixed Costs

```
monthlyFixed = shopify + ebayStore + sellerTools + amazon + storage
annualFixed = (monthlyFixed × 12) + accountant + miscCosts
```

### Tax Formula

```
taxableIncome = max(0, netProfit - personalAllowance)
incomeTax = taxableIncome × incomeTaxRate
nationalInsurance = taxableIncome × niRate
totalTax = incomeTax + nationalInsurance
takeHome = netProfit - totalTax
weeklyTakeHome = takeHome / 52
```

---

## Source Files

| File | Purpose |
|------|---------|
| [CostModellingPage.tsx](../../../apps/web/src/components/features/cost-modelling/CostModellingPage.tsx) | Main page orchestrator |
| [AssumptionsPanel.tsx](../../../apps/web/src/components/features/cost-modelling/AssumptionsPanel.tsx) | Input form sections |
| [PLBreakdown.tsx](../../../apps/web/src/components/features/cost-modelling/PLBreakdown.tsx) | P&L display |
| [CompareMode.tsx](../../../apps/web/src/components/features/cost-modelling/CompareMode.tsx) | Side-by-side comparison |
| [ProfitSummaryCards.tsx](../../../apps/web/src/components/features/cost-modelling/ProfitSummaryCards.tsx) | Summary metrics |
| [PackageCostMatrix.tsx](../../../apps/web/src/components/features/cost-modelling/PackageCostMatrix.tsx) | Packaging costs table |
| [cost-calculations.ts](../../../apps/web/src/lib/services/cost-calculations.ts) | Calculation logic |
| [cost-modelling.repository.ts](../../../apps/web/src/lib/repositories/cost-modelling.repository.ts) | Data access |
| [cost-modelling.ts](../../../apps/web/src/types/cost-modelling.ts) | TypeScript types |

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Calculations not updating | Check for validation errors in inputs |
| Draft not restoring | Browser may have cleared localStorage |
| Compare mode not loading | Ensure Scenario B is selected |
| Conflict error on save | Another session modified the scenario; refresh and retry |
| Cannot delete scenario | Must have at least one scenario |

---

## Related Features

- [Weekly Targets](../workflow/weekly-targets.md) - Track actual sales performance
- [Purchase Profitability](../purchases/profitability.md) - Actual COG analysis
