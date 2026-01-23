# QuickFile MTD Export Specification

## Overview

Add a QuickFile export capability to the Profit & Loss report, enabling monthly financial data to be exported in a format compatible with QuickFile's API or CSV import. This supports Making Tax Digital (MTD) compliance requirements from April 2026.

---

## Background

### MTD Requirements

From **April 2026**, sole traders with income exceeding **£50,000** must:
- Use MTD-compatible software
- Submit quarterly updates to HMRC
- Maintain digital records

### Why QuickFile?

- Free tier available for sole traders
- MTD-compatible and HMRC-recognised
- API available for automation
- Supports CSV import as fallback

---

## Data Model

### Sales Consolidation

Monthly sales grouped by platform:

| Platform | Nominal Code | Description |
|----------|--------------|-------------|
| eBay | 4000 | eBay Sales |
| Amazon | 4000 | Amazon Sales |
| BrickLink | 4000 | BrickLink Sales |
| BrickOwl | 4000 | BrickOwl Sales |

### Expense Categories

Monthly expenses mapped to QuickFile nominal codes:

| Category | Nominal Code | Description |
|----------|--------------|-------------|
| Stock Purchases | 5000 | Cost of Goods Sold |
| eBay Fees | 7502 | Selling Fees |
| Amazon Fees | 7502 | Selling Fees |
| PayPal Fees | 7502 | Payment Processing |
| Postage | 7503 | Postage & Carriage |
| Packaging | 7504 | Packaging Materials |
| Mileage | 7300 | Travel - Motor |
| Software/Subscriptions | 7600 | Software & IT |
| Office Supplies | 7501 | Office Costs |
| Use of Home | 7008 | Use of Home |
| Bank Charges | 7900 | Bank Charges |
| Professional Fees | 7600 | Accountancy Fees |

---

## Monthly Consolidation Strategy

Rather than syncing individual transactions (which would exceed QuickFile limits), consolidate to monthly summaries:

### Estimated Ledger Entries Per Month

| Item | Entries |
|------|---------|
| Platform sales (4 platforms) | 4 |
| Platform fees (eBay, Amazon) | 2 |
| Payment fees (PayPal) | 1 |
| Stock purchases | 1 |
| Postage | 1 |
| Packaging | 1 |
| Mileage | 1 |
| Software/subscriptions | 1 |
| Other expenses | 2 |
| **Total** | **~14 entries/month** |

**Annual estimate**: ~168 entries/year - well within QuickFile's free tier limits.

---

## Export Options

### Option A: CSV Export (Manual)

Generate downloadable CSV files compatible with QuickFile import:

**Sales CSV Format:**
```csv
Date,Reference,Description,Net Amount,VAT,Gross Amount,Nominal Code
2025-01-31,EBAY-2025-01,eBay Sales - January 2025,1234.56,0.00,1234.56,4000
2025-01-31,AMZN-2025-01,Amazon Sales - January 2025,567.89,0.00,567.89,4000
```

**Expenses CSV Format:**
```csv
Date,Reference,Supplier,Description,Net Amount,VAT,Gross Amount,Nominal Code
2025-01-31,STOCK-2025-01,Various,Stock Purchases - January 2025,456.78,0.00,456.78,5000
2025-01-31,EBAY-FEES-2025-01,eBay,eBay Fees - January 2025,123.45,0.00,123.45,7502
```

### Option B: API Integration (Automated)

Direct integration with QuickFile API for one-click export.

**Prerequisites:**
- QuickFile account with API access
- Pre-created clients (eBay, Amazon, BrickLink, BrickOwl)
- Pre-created suppliers (eBay, Amazon, PayPal, Royal Mail, etc.)

---

## API Specification

### Endpoint

```
POST /api/reports/mtd-export
```

### Request Body

```typescript
interface MTDExportRequest {
  year: number;           // e.g. 2025
  month: number;          // 1-12
  format: 'csv' | 'quickfile';
  quickfileCredentials?: {
    accountNumber: string;
    apiKey: string;
  };
}
```

### Response

**CSV Format:**
```typescript
interface MTDExportResponseCSV {
  success: true;
  format: 'csv';
  files: {
    sales: string;      // Base64 encoded CSV
    expenses: string;   // Base64 encoded CSV
  };
  summary: ExportSummary;
}
```

**QuickFile Format:**
```typescript
interface MTDExportResponseQuickFile {
  success: true;
  format: 'quickfile';
  created: {
    invoices: number;
    purchases: number;
  };
  summary: ExportSummary;
}
```

### Export Summary

```typescript
interface ExportSummary {
  period: string;           // "January 2025"
  totalSales: number;
  totalExpenses: number;
  netProfit: number;
  breakdown: {
    sales: PlatformSummary[];
    expenses: CategorySummary[];
  };
}

interface PlatformSummary {
  platform: string;
  total: number;
  orderCount: number;
}

interface CategorySummary {
  category: string;
  nominalCode: string;
  total: number;
}
```

---

## Database Queries

### Monthly Sales by Platform

```sql
SELECT 
  platform,
  SUM(sale_price) as total_sales,
  COUNT(*) as order_count
FROM orders
WHERE 
  order_date >= :start_date
  AND order_date < :end_date
  AND status = 'completed'
GROUP BY platform;
```

### Monthly Expenses by Category

```sql
-- From purchases table
SELECT 
  'Stock Purchases' as category,
  '5000' as nominal_code,
  SUM(cost) as total
FROM purchases
WHERE 
  purchase_date >= :start_date
  AND purchase_date < :end_date

UNION ALL

-- Mileage expenses
SELECT 
  'Mileage' as category,
  '7300' as nominal_code,
  SUM(distance_miles * 0.45) as total
FROM mileage_entries
WHERE 
  entry_date >= :start_date
  AND entry_date < :end_date

UNION ALL

-- Platform fees from transactions
SELECT 
  CASE 
    WHEN platform = 'ebay' THEN 'eBay Fees'
    WHEN platform = 'amazon' THEN 'Amazon Fees'
    WHEN platform = 'paypal' THEN 'PayPal Fees'
  END as category,
  '7502' as nominal_code,
  SUM(ABS(fee_amount)) as total
FROM transactions
WHERE 
  transaction_date >= :start_date
  AND transaction_date < :end_date
  AND transaction_type = 'fee'
GROUP BY platform;
```

---

## Service Implementation

```typescript
// services/mtd-export.ts

interface MonthlyExportData {
  year: number;
  month: number;
  sales: PlatformSales[];
  expenses: CategoryExpense[];
}

export class MTDExportService {
  
  async getMonthlyData(year: number, month: number): Promise<MonthlyExportData> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 1);
    
    const [sales, expenses] = await Promise.all([
      this.getSalesByPlatform(startDate, endDate),
      this.getExpensesByCategory(startDate, endDate)
    ]);
    
    return { year, month, sales, expenses };
  }
  
  async exportToCSV(data: MonthlyExportData): Promise<ExportFiles> {
    const salesCSV = this.generateSalesCSV(data);
    const expensesCSV = this.generateExpensesCSV(data);
    
    return { sales: salesCSV, expenses: expensesCSV };
  }
  
  async exportToQuickFile(
    data: MonthlyExportData, 
    credentials: QuickFileCredentials
  ): Promise<QuickFileResult> {
    const client = new QuickFileClient(credentials);
    
    // Create sales invoices
    for (const platform of data.sales) {
      await client.createInvoice({
        ClientID: this.getClientId(platform.name),
        InvoiceDescription: `${platform.name} Sales - ${this.formatPeriod(data)}`,
        IssueDate: this.getLastDayOfMonth(data.year, data.month),
        InvoiceLines: [{
          ItemNominalCode: '4000',
          ItemDescription: 'LEGO Set Sales',
          SubTotal: platform.total,
          VatRate: 0
        }]
      });
    }
    
    // Create expense purchases
    for (const expense of data.expenses) {
      await client.createPurchase({
        SupplierID: this.getSupplierId(expense.category),
        ReceiptDate: this.getLastDayOfMonth(data.year, data.month),
        InvoiceDescription: `${expense.category} - ${this.formatPeriod(data)}`,
        InvoiceLines: [{
          ItemNominalCode: expense.nominalCode,
          ItemDescription: expense.category,
          SubTotal: expense.amount,
          VatRate: 0
        }]
      });
    }
    
    return { invoicesCreated: data.sales.length, purchasesCreated: data.expenses.length };
  }
}
```

---

## UI Integration

### Location

Add export button to the **Profit & Loss** report page.

### Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  Profit & Loss Report                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Date Range: [January 2025 ▼]        [Export for MTD ▼]        │
│                                       ├─────────────────┤       │
│                                       │ Download CSV    │       │
│                                       │ Push to QuickFile│      │
│                                       └─────────────────┘       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Income                                                   │   │
│  │   eBay Sales                              £1,234.56     │   │
│  │   Amazon Sales                              £567.89     │   │
│  │   BrickLink Sales                           £234.56     │   │
│  │   BrickOwl Sales                             £89.12     │   │
│  │                                           ──────────    │   │
│  │   Total Income                            £2,126.13     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Expenses                                                 │   │
│  │   Stock Purchases                           £456.78     │   │
│  │   eBay Fees                                 £123.45     │   │
│  │   Amazon Fees                                £67.89     │   │
│  │   Postage                                    £89.00     │   │
│  │   Mileage                                    £45.00     │   │
│  │                                           ──────────    │   │
│  │   Total Expenses                            £782.12     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Net Profit                                £1,344.01     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Export Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  Export for MTD - January 2025                            [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Summary                                                        │
│  ───────────────────────────────────────────────────────────   │
│  Total Sales:        £2,126.13                                 │
│  Total Expenses:       £782.12                                 │
│  Net Profit:         £1,344.01                                 │
│                                                                 │
│  Export Format                                                  │
│  ○ CSV Download (for manual import)                            │
│  ○ Push to QuickFile (automatic)                               │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ QuickFile Settings                                       │   │
│  │                                                          │   │
│  │ Account Number: [________________]                       │   │
│  │ API Key:        [________________]                       │   │
│  │                                                          │   │
│  │ □ Save credentials for future exports                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│                              [Cancel]  [Export]                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## QuickFile Setup (One-Time)

### Clients to Create

| Client Name | Purpose |
|-------------|---------|
| eBay Sales | Sales invoices from eBay |
| Amazon Sales | Sales invoices from Amazon |
| BrickLink Sales | Sales invoices from BrickLink |
| BrickOwl Sales | Sales invoices from BrickOwl |

### Suppliers to Create

| Supplier Name | Purpose |
|---------------|---------|
| Various Stock | Stock purchases |
| eBay | eBay fees |
| Amazon | Amazon fees |
| PayPal | PayPal fees |
| Royal Mail | Postage costs |
| Packaging Supplier | Packaging materials |

---

## Quarterly MTD Submission

Once data is in QuickFile, the quarterly MTD submission flow:

1. **End of quarter**: Export all 3 months to QuickFile
2. **Review in QuickFile**: Check all entries are correct
3. **Submit via QuickFile**: Use their MTD submission feature
4. **Confirmation**: Store HMRC receipt reference

### Quarterly Deadlines

| Quarter | Period | Deadline |
|---------|--------|----------|
| Q1 | Apr - Jun | 7 August |
| Q2 | Jul - Sep | 7 November |
| Q3 | Oct - Dec | 7 February |
| Q4 | Jan - Mar | 7 May |

---

## Future Enhancements

### Phase 2: Automation

- Cron job to auto-export on 1st of each month
- Email notification on successful export
- Reconciliation report comparing Hadley Bricks vs QuickFile

### Phase 3: Self Assessment Export

- Annual summary for SA103S boxes
- Direct mapping to Self Assessment fields
- PDF generation for records

---

## Implementation Checklist

- [ ] Create MTD export service
- [ ] Add `/api/reports/mtd-export` endpoint
- [ ] Build CSV generation logic
- [ ] Implement QuickFile API client
- [ ] Add export button to P&L report
- [ ] Create export modal component
- [ ] Store QuickFile credentials securely
- [ ] Add export history/audit log
- [ ] Write tests for export calculations
- [ ] Documentation for QuickFile setup
