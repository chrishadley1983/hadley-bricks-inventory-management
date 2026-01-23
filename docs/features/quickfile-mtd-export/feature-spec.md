# Feature Specification: QuickFile MTD Export

**Generated:** 2026-01-22
**Based on:** done-criteria.md (27 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

Add QuickFile MTD (Making Tax Digital) export capability to the Profit & Loss report page. Users can export monthly financial data in two formats: (1) downloadable CSV files formatted for QuickFile import, and (2) direct push to QuickFile via API. The export consolidates P&L data into ~14 ledger entries per month, mapping categories to QuickFile nominal codes (4000 for sales, 5000-7600 for expenses). An audit trail tracks all exports to warn about duplicate submissions.

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1:** Export dropdown exists | Add `DropdownMenu` with `DropdownMenuTrigger` button to P&L page toolbar |
| **F2:** Dropdown options | Two `DropdownMenuItem`s: "Download CSV" and "Push to QuickFile" |
| **F3:** Month selector integration | Read selected month from existing P&L page state (view preset or custom) |
| **F4:** CSV download triggers | API returns 2 files zipped, browser handles Content-Disposition |
| **F5-F10:** CSV format | Build CSV strings with proper headers, escaping, and QuickFile format |
| **F11-F13:** QuickFile credentials | Modal form + CredentialsRepository with platform='quickfile' |
| **F14-F16:** QuickFile API push | New `QuickFileService` calls QuickFile JSON API |
| **F17-F20:** Export history | New `mtd_export_history` table + duplicate warning dialog |
| **F21-F23:** Data accuracy | Reuse `ProfitLossReportService.generateReport()` for single month |
| **E1-E4:** Error handling | Toast notifications for all error states |
| **P1-P2:** Performance | Simple data transformation, no streaming needed for ~14 entries |
| **U1-U3:** Loading states | Button spinner, disabled during operation, confirmation preview |
| **I1-I3:** Integration | Shared service, new API routes |

---

## 3. Architecture

### 3.1 Integration Points

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              P&L Report Page                                 │
│  apps/web/src/app/(dashboard)/reports/profit-loss/page.tsx                  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ Toolbar                                                               │   │
│  │  [CSV ▼] [PDF ▼] [MTD Export ▼]  ← NEW dropdown                      │   │
│  │                        │                                              │   │
│  │                        ├─ Download CSV                                │   │
│  │                        └─ Push to QuickFile                           │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Selected month: props.viewPreset / custom month selector                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ onClick
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API Layer                                       │
│                                                                              │
│  POST /api/reports/mtd-export                                               │
│    Body: { month: "2026-01", action: "csv" | "quickfile" }                  │
│    Response: CSV blob | JSON { success, invoicesCreated, purchasesCreated } │
│                                                                              │
│  GET/POST/DELETE /api/integrations/quickfile/credentials                    │
│    Manage QuickFile API credentials                                         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Service Layer                                    │
│                                                                              │
│  MtdExportService                                                           │
│    - generateCsvData(month)   → { sales: CsvRow[], expenses: CsvRow[] }     │
│    - pushToQuickFile(month)   → { invoices: n, purchases: m }               │
│    - logExport(month, type)   → void                                        │
│    - getExportHistory(month)  → ExportHistoryEntry[]                        │
│                                                                              │
│  QuickFileService                                                           │
│    - createSalesInvoice(data) → QuickFileResponse                           │
│    - createPurchase(data)     → QuickFileResponse                           │
│    - testConnection()         → boolean                                     │
│                                                                              │
│  ┌─ Uses ─────────────────────────────────────────────────────────────┐     │
│  │ ProfitLossReportService.generateReport(userId, { month, month })   │     │
│  │   → Returns category totals for the single month                   │     │
│  └────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                             Data Layer                                       │
│                                                                              │
│  Tables:                                                                     │
│    mtd_export_history (NEW)                                                 │
│      - id: uuid                                                             │
│      - user_id: uuid (FK → auth.users)                                      │
│      - month: text (YYYY-MM)                                                │
│      - export_type: text ('csv' | 'quickfile')                              │
│      - entries_count: int                                                   │
│      - quickfile_response: jsonb (nullable)                                 │
│      - created_at: timestamptz                                              │
│                                                                              │
│    platform_credentials (existing)                                          │
│      - platform='quickfile' for QuickFile API credentials                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 QuickFile CSV Format

**Sales CSV (quickfile-2026-01-sales.csv):**
```csv
Date,Reference,Description,Net Amount,VAT,Gross Amount,Nominal Code
2026-01-31,EBAY-2026-01,eBay Sales - January 2026,1234.56,0.00,1234.56,4000
2026-01-31,AMAZON-2026-01,Amazon Sales - January 2026,567.89,0.00,567.89,4000
2026-01-31,BRICKLINK-2026-01,BrickLink Sales - January 2026,234.56,0.00,234.56,4000
```

**Expenses CSV (quickfile-2026-01-expenses.csv):**
```csv
Date,Reference,Supplier,Description,Net Amount,VAT,Gross Amount,Nominal Code
2026-01-31,STOCK-2026-01,Various,Stock Purchase - January 2026,456.78,0.00,456.78,5000
2026-01-31,FEES-2026-01,Various,Selling Fees - January 2026,123.45,0.00,123.45,7502
2026-01-31,POSTAGE-2026-01,Various,Packing & Postage - January 2026,89.12,0.00,89.12,7503
2026-01-31,MILEAGE-2026-01,HMRC,Travel - Motor - January 2026,45.00,0.00,45.00,7300
2026-01-31,HOME-2026-01,HMRC,Use of Home - January 2026,26.00,0.00,26.00,7008
```

### 3.3 Nominal Code Mapping

| P&L Category | QuickFile Code | Description |
|--------------|----------------|-------------|
| Income (all platforms) | 4000 | Sales |
| Stock Purchase | 5000 | Cost of Goods Sold |
| Selling Fees | 7502 | Selling Fees |
| Packing & Postage | 7503 | Postage & Carriage |
| Bills > Mileage | 7300 | Travel - Motor |
| Home Costs | 7008 | Use of Home |
| Bills > Software | 7600 | Software & IT |
| Bills > Other | 7901 | Sundry Expenses |

### 3.4 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CSV generation | Manual string building | Simple, no deps, ~14 rows max |
| ZIP for CSV download | JSZip library | Already available in project |
| QuickFile API | JSON API v1 | Well-documented, simple auth |
| Credential storage | platform_credentials table | Existing encrypted storage pattern |
| Export history | New table | Clean audit trail, duplicate detection |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/lib/services/mtd-export.service.ts` | MTD export logic, CSV generation, QuickFile push | 200 |
| `apps/web/src/lib/services/quickfile.service.ts` | QuickFile API client | 150 |
| `apps/web/src/app/api/reports/mtd-export/route.ts` | Export API endpoint | 80 |
| `apps/web/src/app/api/integrations/quickfile/credentials/route.ts` | Credentials CRUD | 90 |
| `apps/web/src/components/features/mtd-export/MtdExportDropdown.tsx` | Dropdown component | 120 |
| `apps/web/src/components/features/mtd-export/QuickFileCredentialsModal.tsx` | Credentials form modal | 100 |
| `apps/web/src/components/features/mtd-export/ExportConfirmDialog.tsx` | Confirmation + preview dialog | 80 |
| `apps/web/src/hooks/use-quickfile-credentials.ts` | Credentials query hook | 40 |
| `apps/web/src/hooks/use-mtd-export.ts` | Export mutation hooks | 60 |
| `apps/web/src/types/mtd-export.ts` | TypeScript types | 50 |
| `supabase/migrations/XXXXXX_mtd_export_history.sql` | History table + RLS | 40 |

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/reports/profit-loss/page.tsx` | Add MTD export dropdown to toolbar | 20 |
| `packages/database/src/platforms.ts` | Add 'quickfile' to integration platforms | 5 |
| `packages/database/src/types.ts` | Add mtd_export_history types | 15 |

---

## 5. Implementation Details

### 5.1 MtdExportService

```typescript
// apps/web/src/lib/services/mtd-export.service.ts

interface MtdSalesRow {
  date: string;           // YYYY-MM-DD (last day of month)
  reference: string;      // PLATFORM-YYYY-MM
  description: string;    // Platform Sales - Month Year
  netAmount: number;      // 2 decimal places
  vat: number;            // Always 0.00
  grossAmount: number;    // Same as netAmount
  nominalCode: string;    // 4000
}

interface MtdExpenseRow {
  date: string;
  reference: string;      // CATEGORY-YYYY-MM
  supplier: string;       // 'Various' or 'HMRC'
  description: string;
  netAmount: number;
  vat: number;
  grossAmount: number;
  nominalCode: string;    // 5000, 7008, 7300, 7502, 7503, 7600
}

export class MtdExportService {
  constructor(
    private supabase: SupabaseClient<Database>,
    private profitLossService: ProfitLossReportService
  ) {}

  /**
   * Generate CSV data for a single month
   */
  async generateCsvData(
    userId: string,
    month: string // YYYY-MM
  ): Promise<{ sales: MtdSalesRow[]; expenses: MtdExpenseRow[] }> {
    // Get P&L data for single month
    const report = await this.profitLossService.generateReport(userId, {
      startMonth: month,
      endMonth: month,
    });

    // Transform to MTD format
    // ...
  }

  /**
   * Push data to QuickFile API
   */
  async pushToQuickFile(
    userId: string,
    month: string
  ): Promise<{ invoicesCreated: number; purchasesCreated: number }> {
    // Get credentials
    // Get CSV data
    // Create invoices/purchases via QuickFile API
    // Log export
  }

  /**
   * Log an export to history
   */
  async logExport(
    userId: string,
    month: string,
    exportType: 'csv' | 'quickfile',
    entriesCount: number,
    quickfileResponse?: object
  ): Promise<void> {
    // Insert into mtd_export_history
  }

  /**
   * Check if month was already exported to QuickFile
   */
  async getQuickFileExportHistory(
    userId: string,
    month: string
  ): Promise<{ exported: boolean; exportedAt?: string }> {
    // Query mtd_export_history
  }
}
```

### 5.2 QuickFileService

```typescript
// apps/web/src/lib/services/quickfile.service.ts

interface QuickFileCredentials {
  accountNumber: string;
  apiKey: string;
}

export class QuickFileService {
  private baseUrl = 'https://api.quickfile.co.uk/1_2';

  constructor(
    private credentials: QuickFileCredentials
  ) {}

  /**
   * Test connection with credentials
   */
  async testConnection(): Promise<boolean> {
    // Call QuickFile API system/authenticate
  }

  /**
   * Create a sales invoice
   */
  async createInvoice(data: QuickFileInvoice): Promise<QuickFileResponse> {
    // POST to Invoice_Create
  }

  /**
   * Create a purchase entry
   */
  async createPurchase(data: QuickFilePurchase): Promise<QuickFileResponse> {
    // POST to Purchase_Create
  }
}
```

### 5.3 API Routes

**POST /api/reports/mtd-export**
```typescript
// Request
{
  month: "2026-01",      // Required: YYYY-MM format
  action: "csv" | "quickfile"
}

// Response (CSV action)
// Content-Type: application/zip
// Content-Disposition: attachment; filename="quickfile-2026-01.zip"
// Body: ZIP file containing sales.csv and expenses.csv

// Response (QuickFile action - success)
{
  success: true,
  invoicesCreated: 4,
  purchasesCreated: 6,
  message: "Exported 4 invoices and 6 purchases to QuickFile"
}

// Response (error)
{
  success: false,
  error: "QuickFile error: Invalid credentials"
}
```

**GET /api/integrations/quickfile/credentials**
```typescript
// Response
{
  configured: boolean
}
```

**POST /api/integrations/quickfile/credentials**
```typescript
// Request
{
  accountNumber: "QB00000000",
  apiKey: "xxx-xxx-xxx"
}

// Response (success after connection test)
{
  success: true,
  message: "QuickFile credentials saved and verified"
}
```

### 5.4 Database Migration

```sql
-- supabase/migrations/XXXXXX_mtd_export_history.sql

CREATE TABLE mtd_export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month TEXT NOT NULL, -- YYYY-MM format
  export_type TEXT NOT NULL CHECK (export_type IN ('csv', 'quickfile')),
  entries_count INTEGER NOT NULL DEFAULT 0,
  quickfile_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX idx_mtd_export_history_user_month
  ON mtd_export_history(user_id, month, export_type);

-- RLS
ALTER TABLE mtd_export_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own export history"
  ON mtd_export_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own export history"
  ON mtd_export_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

### 5.5 Component: MtdExportDropdown

```tsx
// apps/web/src/components/features/mtd-export/MtdExportDropdown.tsx

interface MtdExportDropdownProps {
  selectedMonth: string; // YYYY-MM
  disabled?: boolean;
}

export function MtdExportDropdown({ selectedMonth, disabled }: MtdExportDropdownProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [showCredentialsModal, setShowCredentialsModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const { data: credentials } = useQuickFileCredentials();
  const { mutateAsync: exportCsv } = useMtdExportCsv();
  const { mutateAsync: pushToQuickFile } = useMtdExportQuickFile();

  const handleCsvDownload = async () => {
    setIsExporting(true);
    try {
      await exportCsv({ month: selectedMonth });
      toast.success('CSV downloaded successfully');
    } catch (error) {
      toast.error('Failed to download CSV');
    } finally {
      setIsExporting(false);
    }
  };

  const handleQuickFilePush = async () => {
    if (!credentials?.configured) {
      setShowCredentialsModal(true);
      return;
    }
    setShowConfirmDialog(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled || isExporting}
            data-testid="mtd-export-dropdown"
          >
            {isExporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
            Export for MTD
            <ChevronDown className="h-4 w-4 ml-2" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onClick={handleCsvDownload}>
            <Download className="h-4 w-4 mr-2" />
            Download CSV
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleQuickFilePush}>
            <Upload className="h-4 w-4 mr-2" />
            Push to QuickFile
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <QuickFileCredentialsModal
        open={showCredentialsModal}
        onOpenChange={setShowCredentialsModal}
        onSuccess={() => setShowConfirmDialog(true)}
      />

      <ExportConfirmDialog
        open={showConfirmDialog}
        onOpenChange={setShowConfirmDialog}
        month={selectedMonth}
        onConfirm={async () => {
          await pushToQuickFile({ month: selectedMonth });
          setShowConfirmDialog(false);
        }}
      />
    </>
  );
}
```

---

## 6. Build Order

### Step 1: Database Migration (F17)
- Create `mtd_export_history` table with RLS
- Push to cloud Supabase
- Regenerate types

### Step 2: Platform Type Update (F12)
- Add 'quickfile' to integration platforms in `platforms.ts`
- Update Database types

### Step 3: Service Layer (F4-F10, F14-F15, F21-F23)
- Create `MtdExportService` with CSV generation
- Create `QuickFileService` with API client
- Unit test the nominal code mapping

### Step 4: API Routes (I2, I3)
- Create `/api/reports/mtd-export` route
- Create `/api/integrations/quickfile/credentials` routes
- Test with curl/Postman

### Step 5: React Query Hooks
- Create `use-quickfile-credentials.ts`
- Create `use-mtd-export.ts` with mutations

### Step 6: UI Components (F1-F3, F11, U1-U3)
- Create `MtdExportDropdown` component
- Create `QuickFileCredentialsModal` component
- Create `ExportConfirmDialog` component

### Step 7: Page Integration
- Add dropdown to P&L page toolbar
- Wire up month selection

### Step 8: Error Handling (E1-E4)
- Add toast notifications for all error states
- Test empty month, invalid credentials, timeout

### Step 9: Export History & Duplicate Warning (F18-F20)
- Implement export logging
- Add duplicate warning dialog
- Test re-export flow

### Step 10: Verification & Polish
- Verify all 27 criteria
- Fix any issues

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| QuickFile API rate limits | Low | Medium | Single export = ~14 API calls, well under limits |
| CSV special character escaping | Medium | Low | Use proper CSV escaping (quotes, double-quotes) |
| QuickFile API changes | Low | High | Version lock to 1_2 API, document expected responses |
| Month boundary edge cases | Medium | Medium | Use `date-fns` for reliable last-day-of-month calculation |

### Scope Risks

| Risk | Mitigation |
|------|------------|
| Scope creep (add multi-month) | done-criteria.md specifies single month only |
| Scope creep (add custom nominal codes) | Fixed mapping per spec |

### Integration Risks

| Risk | Mitigation |
|------|------------|
| P&L service data mismatch | Reuse exact same service, single source of truth |
| Credential encryption issues | Existing pattern from BrickLink/eBay credentials |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1: Dropdown exists | Yes | High | Standard shadcn/ui component |
| F2: Dropdown options | Yes | High | DropdownMenuItem |
| F3: Month integration | Yes | High | Already have month state in page |
| F4: CSV download | Yes | High | JSZip + Content-Disposition |
| F5-F10: CSV format | Yes | High | String building, simple |
| F11-F13: Credentials | Yes | High | Existing pattern from other integrations |
| F14-F15: QuickFile API | Yes | Medium | Need to verify API structure |
| F16: Success toast | Yes | High | Sonner toast |
| F17: History table | Yes | High | Simple schema |
| F18-F20: Export logging | Yes | High | INSERT after export |
| F21-F23: Data accuracy | Yes | High | Same service, same data |
| E1-E4: Error handling | Yes | High | Try/catch + toast |
| P1: CSV < 2s | Yes | High | ~14 rows, trivial |
| P2: API < 10s | Yes | Medium | Depends on QuickFile response time |
| U1-U3: Loading states | Yes | High | React state |
| I1-I3: Integration | Yes | High | Standard patterns |

**Overall:** All 27 criteria feasible with planned approach.

---

## 9. Notes for Build Agent

### Key Considerations

1. **QuickFile API Authentication**: Uses Account Number + API Key in request body, not headers. Each request includes `authentication` object.

2. **Refund Handling**: F23 requires refunds as negative. Check P&L service - eBay/Amazon refunds already have `signMultiplier: -1`, so they appear as negative values in the report.

3. **Platform Credentials Type**: The `platform_credentials` table has a `platform` enum. May need migration to add 'quickfile' as valid value, OR use existing pattern where credentials repo accepts any string.

4. **Month Extraction**: P&L page uses view presets like "lastYear", "thisQuarter". Need to extract the actual month being displayed for export. May need to add `getSelectedMonth()` utility.

5. **ZIP Library**: Check if JSZip is already installed. If not, consider returning two separate downloads or inline both CSVs in single response.

### Testing Hints

- Create a test month with known values to verify CSV totals match P&L display
- Test QuickFile credentials with invalid values to verify E3 error message
- Test empty future month to verify E1 toast
- Test re-export of same month to verify F20 warning dialog

### Code Patterns to Follow

- Credentials routes: Follow `apps/web/src/app/api/integrations/bricklink/credentials/route.ts`
- Toast notifications: Use `sonner` toast from existing components
- Modal dialogs: Follow existing patterns in `components/features/`
- Service injection: ProfitLossReportService in `lib/services/`

---

## 10. QuickFile API Reference

**Base URL:** `https://api.quickfile.co.uk/1_2`

**Authentication (in request body):**
```json
{
  "payload": {
    "Header": {
      "MessageType": "Request",
      "SubmissionNumber": "unique-id",
      "Authentication": {
        "AccNumber": "QB00000000",
        "MD5Value": "md5(accNumber + apiKey + submissionNumber)",
        "ApplicationID": "hadley-bricks"
      }
    },
    "Body": { /* method-specific */ }
  }
}
```

**Invoice_Create** (for sales):
- Creates sales invoices with line items
- Nominal code in each line item

**Purchase_Create** (for expenses):
- Creates purchase entries
- Supplier, date, nominal code, amount

---

**End of Feature Specification**
