# Profit & Loss Report - Implementation Specification

## Overview

A configurable monthly Profit & Loss report that aggregates financial data across all platforms (eBay, BrickLink, Amazon) and expense categories. The report displays rows grouped by Category/Transaction Type with columns for each month from the earliest data to the current month, plus a TOTAL column.

---

## Report Structure

### Output Format

```typescript
interface ProfitLossReportRow {
  category: string;           // 'Income' | 'Selling Fees' | 'Stock Purchase' | 'Packing & Postage' | 'Bills'
  transactionType: string;    // e.g., 'eBay Gross Sales', 'Amazon Fees'
  monthlyValues: Record<string, number>;  // { '2024-01': 1234.56, '2024-02': 2345.67, ... }
  total: number;              // Sum of all monthly values
}

interface ProfitLossReport {
  generatedAt: string;
  dateRange: {
    startMonth: string;       // '2024-01'
    endMonth: string;         // '2026-01'
  };
  rows: ProfitLossReportRow[];
  categoryTotals: Record<string, Record<string, number>>;  // Category -> Month -> Total
  grandTotal: Record<string, number>;  // Month -> Grand Total
}
```

---

## Row Definitions (26 Total)

### INCOME (5 rows)

| # | Transaction Type | Database Source | Query Logic |
|---|-----------------|-----------------|-------------|
| 1 | **eBay Gross Sales** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='SALE' AND booking_entry='CREDIT'` grouped by `DATE_TRUNC('month', transaction_date)` |
| 2 | **eBay Refunds** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='REFUND' AND booking_entry='DEBIT'` - displayed as **negative** |
| 3 | **BrickLink Gross Sales** | `bricklink_transactions` | `SUM(base_grand_total) WHERE order_status IN ('Completed', 'Received', 'Shipped', 'Packed', 'Ready', 'Paid')` grouped by `DATE_TRUNC('month', order_date)` |
| 4 | **Amazon Sales** | `amazon_transactions` | `SUM(total_amount) WHERE transaction_type='Shipment'` grouped by `DATE_TRUNC('month', posted_date)` |
| 5 | **Amazon Refunds** | `amazon_transactions` | `SUM(total_amount) WHERE transaction_type IN ('Refund', 'GuaranteeClaimRefund')` - displayed as **negative** |

---

### SELLING FEES (12 rows)

All values displayed as **negative** (expenses).

| # | Transaction Type | Database Source | Query Logic |
|---|-----------------|-----------------|-------------|
| 6 | **BrickLink / Brick Owl / Bricqer Fees** | `monzo_transactions` | `SUM(ABS(amount))/100` WHERE `local_category='Selling Fees'` - platform subscription fees for BrickLink, Brick Owl, and Bricqer |
| 7 | **Amazon Fees** | `amazon_transactions` | `SUM(COALESCE(referral_fee, 0) + COALESCE(fba_fulfillment_fee, 0) + COALESCE(fba_per_unit_fee, 0) + COALESCE(fba_weight_fee, 0) + COALESCE(fba_inventory_storage_fee, 0) + COALESCE(other_fees, 0)) WHERE transaction_type = 'Shipment'` |
| 8 | **eBay Insertion Fees** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'feeType'='INSERTION_FEE'` |
| 9 | **eBay Ad Fees - Standard** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'feeType'='AD_FEE'` |
| 10 | **eBay Ad Fees - Advanced** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'feeType'='PREMIUM_AD_FEES'` |
| 11 | **eBay Fixed Fees** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'feeType'='FINAL_VALUE_FEE_FIXED_PER_ORDER'` |
| 12 | **eBay Variable Fees** | `ebay_transactions` | Sum of FINAL_VALUE_FEE from `raw_response.orderLineItems[].marketplaceFees` WHERE `feeType='FINAL_VALUE_FEE'` for SALE transactions |
| 13 | **eBay Regulatory Fees** | `ebay_transactions` | Sum of REGULATORY_OPERATING_FEE from `raw_response.orderLineItems[].marketplaceFees` WHERE `feeType='REGULATORY_OPERATING_FEE'` for SALE transactions |
| 14 | **eBay Ad Hoc Selling Fee Refund** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='CREDIT'` - displayed as **positive** (credit/refund) |
| 15 | **eBay Shop Fee** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'feeType'='OTHER_FEES' AND raw_response->>'transactionMemo' LIKE '____-__-__ - ____-__-__'` (date range pattern for monthly subscription) |
| 16 | **eBay Promotional Fees** | `ebay_transactions` | `SUM(amount) WHERE transaction_type='NON_SALE_CHARGE' AND booking_entry='DEBIT' AND raw_response->>'transactionMemo'='Promoted Offsite fee'` |

---

### STOCK PURCHASE (2 rows)

All values displayed as **negative** (expenses).

| # | Transaction Type | Database Source | Query Logic |
|---|-----------------|-----------------|-------------|
| 17 | **Lego Stock Purchases** | `purchases` | `SUM(cost) WHERE short_description NOT ILIKE '%part%' AND short_description NOT ILIKE '%parts%'` grouped by `DATE_TRUNC('month', purchase_date)` |
| 18 | **Lego Parts** | `purchases` | `SUM(cost) WHERE short_description ILIKE '%part%' OR short_description ILIKE '%parts%'` grouped by `DATE_TRUNC('month', purchase_date)` |

---

### PACKING & POSTAGE (2 rows)

All values displayed as **negative** (expenses). Monzo amounts are in pence (minor units) and negative for spending.

| # | Transaction Type | Database Source | Query Logic |
|---|-----------------|-----------------|-------------|
| 19 | **Postage** | `monzo_transactions` | `SUM(ABS(amount)) / 100 WHERE local_category='Postage' AND amount < 0` grouped by `DATE_TRUNC('month', created)` |
| 20 | **Packing Materials** | `monzo_transactions` | `SUM(ABS(amount)) / 100 WHERE local_category='Packing Materials' AND amount < 0` grouped by `DATE_TRUNC('month', created)` |

---

### BILLS (5 rows)

All values displayed as **negative** (expenses).

| # | Transaction Type | Database Source | Query Logic |
|---|-----------------|-----------------|-------------|
| 21 | **Amazon Subscription** | `amazon_transactions` | `SUM(ABS(total_amount)) WHERE transaction_type='ServiceFee'` grouped by `DATE_TRUNC('month', posted_date)` |
| 22 | **Banking Fees / Subscriptions** | `monzo_transactions` | `SUM(ABS(amount)) / 100 WHERE local_category='Services' AND amount < 0` grouped by `DATE_TRUNC('month', created)` |
| 23 | **Website** | `monzo_transactions` | `SUM(ABS(amount)) / 100 WHERE local_category='Software' AND amount < 0` grouped by `DATE_TRUNC('month', created)` |
| 24 | **Office** | `monzo_transactions` | `SUM(ABS(amount)) / 100 WHERE local_category='Office Space' AND amount < 0` grouped by `DATE_TRUNC('month', created)` |
| 25 | **Mileage** | `mileage_tracking` | `SUM(amount_claimed)` grouped by `DATE_TRUNC('month', tracking_date)` |

---

## SQL Query Examples

### eBay Gross Sales

```sql
SELECT
  DATE_TRUNC('month', transaction_date)::date AS month,
  SUM(amount::numeric) AS total
FROM ebay_transactions
WHERE user_id = $1
  AND transaction_type = 'SALE'
  AND booking_entry = 'CREDIT'
GROUP BY DATE_TRUNC('month', transaction_date)
ORDER BY month;
```

### eBay Variable Fees (extracted from JSON)

```sql
SELECT
  DATE_TRUNC('month', transaction_date)::date AS month,
  SUM(
    (SELECT SUM((fee->>'amount')::jsonb->>'value')::numeric
     FROM jsonb_array_elements(raw_response->'orderLineItems') AS item,
          jsonb_array_elements(item->'marketplaceFees') AS fee
     WHERE fee->>'feeType' = 'FINAL_VALUE_FEE')
  ) AS total
FROM ebay_transactions
WHERE user_id = $1
  AND transaction_type = 'SALE'
GROUP BY DATE_TRUNC('month', transaction_date)
ORDER BY month;
```

### Monzo Expenses (with pence conversion)

```sql
SELECT
  DATE_TRUNC('month', created)::date AS month,
  SUM(ABS(amount)) / 100.0 AS total
FROM monzo_transactions
WHERE user_id = $1
  AND local_category = 'Postage'
  AND amount < 0
GROUP BY DATE_TRUNC('month', created)
ORDER BY month;
```

---

## Implementation Architecture

### Service Layer

```
apps/web/src/lib/services/
├── profit-loss-report.service.ts    # Main report generation service
└── reporting.service.ts             # Existing reporting service (extend)
```

### API Endpoint

```
apps/web/src/app/api/reports/profit-loss-detailed/route.ts
```

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `startMonth` | string | (earliest data) | Format: YYYY-MM |
| `endMonth` | string | (current month) | Format: YYYY-MM |
| `includeZeroRows` | boolean | false | Include rows with all zero values |

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         API Request                                  │
│                    GET /api/reports/profit-loss-detailed             │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    ProfitLossReportService                          │
│                                                                      │
│  1. Determine date range (earliest to current or specified)          │
│  2. Execute parallel queries for each row definition                 │
│  3. Aggregate results into monthly buckets                           │
│  4. Calculate category subtotals                                     │
│  5. Calculate grand totals                                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │ ebay_         │       │ amazon_       │       │ monzo_        │
    │ transactions  │       │ transactions  │       │ transactions  │
    └───────────────┘       └───────────────┘       └───────────────┘
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │ bricklink_    │       │ paypal_       │       │ mileage_      │
    │ transactions  │       │ transactions  │       │ tracking      │
    └───────────────┘       └───────────────┘       └───────────────┘
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                                    ▼
                        ┌───────────────────────┐
                        │   purchases table     │
                        └───────────────────────┘
```

---

## Sign Conventions

| Category | Default Sign | Notes |
|----------|-------------|-------|
| Income (Sales) | Positive (+) | Money coming in |
| Income (Refunds) | Negative (−) | Reduces income |
| Selling Fees | Negative (−) | Costs/expenses |
| Selling Fee Refunds | Positive (+) | Credits back |
| Stock Purchase | Negative (−) | Costs/expenses |
| Packing & Postage | Negative (−) | Costs/expenses |
| Bills | Negative (−) | Costs/expenses |

---

## Performance Considerations

1. **Parallel Query Execution**: Execute all 26 row queries in parallel using `Promise.all()`
2. **Date Range Filtering**: Always filter by date range to limit data scanned
3. **Pagination for Supabase**: Handle 1000-row limit for large datasets
4. **Caching**: Consider caching historical months (data won't change)
5. **Indexes Used**:
   - `idx_ebay_transactions_date` (user_id, transaction_date DESC)
   - `idx_amazon_transactions_posted_date` (user_id, posted_date DESC)
   - `idx_bricklink_transactions_date` (user_id, order_date DESC)
   - `idx_paypal_transactions_date` (user_id, transaction_date DESC)
   - `idx_monzo_transactions_created` (user_id, created DESC)
   - `idx_mileage_tracking_user_date` (user_id, tracking_date)
   - `idx_purchases_user_date` (user_id, purchase_date DESC)

---

## Future Enhancements

1. **Export to Excel/CSV**: Generate downloadable spreadsheet
2. **Comparison Mode**: Compare to previous year/period
3. **Drill-down**: Click on a cell to see underlying transactions
4. **Custom Row Definitions**: Allow users to define custom rows
5. **Budget vs Actual**: Add budget column for variance analysis
6. **Charts**: Visual representation of trends

---

## Related Files

- `apps/web/src/lib/services/reporting.service.ts` - Existing reporting service
- `supabase/migrations/20241224000001_ebay_integration.sql` - eBay tables
- `supabase/migrations/20250111000001_amazon_transaction_integration.sql` - Amazon tables
- `supabase/migrations/20250109000001_bricklink_transaction_staging.sql` - BrickLink tables
- `supabase/migrations/20250108000001_paypal_integration.sql` - PayPal tables
- `supabase/migrations/20250106000003_monzo_integration.sql` - Monzo tables
- `supabase/migrations/20250106000001_mileage_tracking.sql` - Mileage table

---

*Last Updated: January 2026*
