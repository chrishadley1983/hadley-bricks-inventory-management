# Done Criteria: QuickFile MTD Export

**Created:** 2026-01-22
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

Add QuickFile export capability to the Profit & Loss report, enabling monthly financial data to be exported for MTD (Making Tax Digital) compliance. Supports both CSV download (for manual QuickFile import) and direct QuickFile API integration. Monthly data is consolidated into ~14 ledger entries per month, mapping to QuickFile nominal codes.

## Success Criteria

### Functional - UI

#### F1: Export Dropdown Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** An "Export for MTD" dropdown button is visible in the P&L report page header toolbar
- **Evidence:** DOM query finds dropdown trigger with data-testid="mtd-export-dropdown"
- **Test:** `document.querySelector('[data-testid="mtd-export-dropdown"]') !== null`

#### F2: Dropdown Contains Export Options
- **Tag:** AUTO_VERIFY
- **Criterion:** The dropdown menu contains two options: "Download CSV" and "Push to QuickFile"
- **Evidence:** Dropdown menu items exist with expected text
- **Test:** Open dropdown, verify menu items with text "Download CSV" and "Push to QuickFile" exist

#### F3: Month Selector Integration
- **Tag:** AUTO_VERIFY
- **Criterion:** Export uses the currently selected month from the P&L view preset or custom month selector
- **Evidence:** Exported data matches the displayed month in the P&L table
- **Test:** Select January 2026, export CSV, verify CSV date references match January 2026

### Functional - CSV Export

#### F4: CSV Download Triggers
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Download CSV" triggers download of two CSV files (sales.csv, expenses.csv) or a single ZIP containing both
- **Evidence:** Browser download triggered with correct filenames
- **Test:** Click download, verify file(s) downloaded with pattern `quickfile-{YYYY-MM}-sales.csv` and `quickfile-{YYYY-MM}-expenses.csv`

#### F5: Sales CSV Format
- **Tag:** AUTO_VERIFY
- **Criterion:** Sales CSV contains columns: Date, Reference, Description, Net Amount, VAT, Gross Amount, Nominal Code
- **Evidence:** Parse CSV header row, validate all required columns present
- **Test:** Parse downloaded sales.csv, verify header matches expected columns exactly

#### F6: Sales CSV Data - Platform Rows
- **Tag:** AUTO_VERIFY
- **Criterion:** Sales CSV contains one row per platform with sales > £0 (eBay, Amazon, BrickLink, BrickOwl)
- **Evidence:** Each row has Reference pattern `{PLATFORM}-{YYYY}-{MM}`, Description `{Platform} Sales - {Month Year}`, Nominal Code `4000`
- **Test:** Parse CSV rows, verify structure matches spec for each platform with sales

#### F7: Expenses CSV Format
- **Tag:** AUTO_VERIFY
- **Criterion:** Expenses CSV contains columns: Date, Reference, Supplier, Description, Net Amount, VAT, Gross Amount, Nominal Code
- **Evidence:** Parse CSV header row, validate all required columns present
- **Test:** Parse downloaded expenses.csv, verify header matches expected columns exactly

#### F8: Expenses CSV Data - Category Mapping
- **Tag:** AUTO_VERIFY
- **Criterion:** Expenses CSV maps P&L categories to correct QuickFile nominal codes:
  - Stock Purchase → 5000 (Cost of Goods Sold)
  - Selling Fees → 7502 (Selling Fees)
  - Packing & Postage → 7503 (Postage & Carriage)
  - Mileage → 7300 (Travel - Motor)
  - Home Costs → 7008 (Use of Home)
  - Software/Services → 7600 (Software & IT)
- **Evidence:** Parse expenses.csv, verify nominal codes match spec for each category
- **Test:** Export month with known expenses, verify nominal code mapping

#### F9: CSV Date Format
- **Tag:** AUTO_VERIFY
- **Criterion:** All dates in CSV use format YYYY-MM-DD (last day of the selected month)
- **Evidence:** Date column values match pattern `\d{4}-\d{2}-\d{2}` and are last day of month
- **Test:** Regex validation on Date column, verify date is last day of selected month

#### F10: CSV Amount Format
- **Tag:** AUTO_VERIFY
- **Criterion:** All amounts in CSV are numeric with 2 decimal places, no currency symbols
- **Evidence:** Amount columns contain values like `1234.56` not `£1,234.56`
- **Test:** Parse amount columns, verify numeric format without symbols

### Functional - QuickFile API

#### F11: QuickFile Credentials Form
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Push to QuickFile" opens a form/modal to enter QuickFile Account Number and API Key if not already configured
- **Evidence:** Modal/dialog appears with input fields for account number and API key
- **Test:** Click "Push to QuickFile" without stored credentials, verify form appears with required fields

#### F12: Credentials Storage
- **Tag:** AUTO_VERIFY
- **Criterion:** QuickFile credentials are stored encrypted in platform_credentials table with platform='quickfile'
- **Evidence:** Database query returns encrypted credential row for quickfile platform
- **Test:** Save credentials, query platform_credentials where platform='quickfile', verify row exists

#### F13: Credentials Persistence
- **Tag:** AUTO_VERIFY
- **Criterion:** Once credentials are saved, subsequent exports do not prompt for credentials
- **Evidence:** "Push to QuickFile" proceeds directly to confirmation without credential form
- **Test:** Save credentials, click "Push to QuickFile" again, verify no credential prompt appears

#### F14: QuickFile API - Create Sales Invoices
- **Tag:** AUTO_VERIFY
- **Criterion:** API push creates sales invoices in QuickFile for each platform with sales > £0
- **Evidence:** QuickFile API response confirms invoice creation OR mock API receives correct payload
- **Test:** Push to QuickFile, verify API called with correct invoice structure per spec

#### F15: QuickFile API - Create Purchase Entries
- **Tag:** AUTO_VERIFY
- **Criterion:** API push creates purchase/expense entries in QuickFile for each expense category with amount > £0
- **Evidence:** QuickFile API response confirms purchase creation OR mock API receives correct payload
- **Test:** Push to QuickFile, verify API called with correct purchase structure per spec

#### F16: API Success Confirmation
- **Tag:** AUTO_VERIFY
- **Criterion:** After successful API push, a success toast/notification displays: "Exported {N} invoices and {M} purchases to QuickFile"
- **Evidence:** Toast component appears with expected message pattern
- **Test:** Complete successful API push, verify toast message matches pattern

### Functional - Export History & Audit

#### F17: Export History Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A database table `mtd_export_history` exists with columns: id, user_id, month, export_type, created_at, entries_count, quickfile_response (nullable)
- **Evidence:** Table schema inspection confirms columns
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'mtd_export_history'`

#### F18: Export Logged on CSV Download
- **Tag:** AUTO_VERIFY
- **Criterion:** Each CSV download creates a record in mtd_export_history with export_type='csv'
- **Evidence:** Database query finds export history row after CSV download
- **Test:** Download CSV, query mtd_export_history, verify row exists with export_type='csv'

#### F19: Export Logged on API Push
- **Tag:** AUTO_VERIFY
- **Criterion:** Each QuickFile API push creates a record in mtd_export_history with export_type='quickfile' and stores the API response
- **Evidence:** Database query finds export history row with quickfile_response populated
- **Test:** Push to QuickFile, query mtd_export_history, verify row exists with response data

#### F20: Duplicate Warning on Re-export
- **Tag:** AUTO_VERIFY
- **Criterion:** If attempting to export a month that was already pushed to QuickFile, a confirmation dialog warns: "January 2026 was already exported to QuickFile on {date}. Export again?"
- **Evidence:** Confirmation dialog appears with expected warning message
- **Test:** Export month to QuickFile, attempt again, verify warning dialog appears with correct date

### Functional - Data Accuracy

#### F21: Sales Total Matches P&L Income
- **Tag:** AUTO_VERIFY
- **Criterion:** Sum of Net Amount in sales CSV equals the Income category total displayed on P&L for the selected month
- **Evidence:** CSV total calculation matches P&L UI value
- **Test:** Export month, sum sales CSV amounts, compare to P&L Income total

#### F22: Expenses Total Matches P&L Expenses
- **Tag:** AUTO_VERIFY
- **Criterion:** Sum of Net Amount in expenses CSV equals the sum of (Selling Fees + Stock Purchase + Packing & Postage + Bills + Home Costs) displayed on P&L
- **Evidence:** CSV total calculation matches P&L expense categories sum
- **Test:** Export month, sum expenses CSV amounts, compare to P&L expense categories

#### F23: Refunds Handled as Negative Sales
- **Tag:** AUTO_VERIFY
- **Criterion:** Platform refunds (eBay Refunds, Amazon Refunds) are included in sales CSV as negative amounts or separate credit entries
- **Evidence:** Refund values appear as negative in sales CSV OR separate deduction rows exist
- **Test:** Export month with refunds, verify refund handling in CSV

### Error Handling

#### E1: Empty Month Message
- **Tag:** AUTO_VERIFY
- **Criterion:** If selected month has no sales and no expenses, clicking export shows toast "No data to export for {Month Year}"
- **Evidence:** Toast component appears with expected message
- **Test:** Select future month with no data, attempt export, verify toast message

#### E2: QuickFile API Error Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If QuickFile API returns an error, display error toast with message: "QuickFile error: {error_message}" and do not log as successful export
- **Evidence:** Error toast appears, mtd_export_history not created or marked as failed
- **Test:** Simulate API error (mock or invalid credentials), verify error handling

#### E3: Invalid Credentials Error
- **Tag:** AUTO_VERIFY
- **Criterion:** If QuickFile credentials are invalid (401 response), display error "Invalid QuickFile credentials. Please check your Account Number and API Key."
- **Evidence:** Error message appears prompting credential correction
- **Test:** Enter invalid credentials, attempt push, verify error message

#### E4: Network Timeout Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** If QuickFile API times out (>30s), display error "QuickFile connection timed out. Please try again."
- **Evidence:** Timeout error message displayed after 30 seconds
- **Test:** Mock API with delayed response >30s, verify timeout handling

### Performance

#### P1: CSV Generation Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** CSV generation completes in under 2 seconds for a single month
- **Evidence:** Time from click to download complete < 2000ms
- **Test:** Measure time from "Download CSV" click to file download complete

#### P2: API Push Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** QuickFile API push completes in under 10 seconds for typical monthly data (~14 entries)
- **Evidence:** Time from click to success toast < 10000ms (excluding credential entry)
- **Test:** Measure time from "Push to QuickFile" confirmation to success toast

### UI/UX

#### U1: Loading State During Export
- **Tag:** AUTO_VERIFY
- **Criterion:** During CSV generation or API push, the dropdown button shows a loading spinner
- **Evidence:** Spinner/loading indicator visible during operation
- **Test:** Trigger export, verify loading state appears

#### U2: Dropdown Disabled During Export
- **Tag:** AUTO_VERIFY
- **Criterion:** Export dropdown is disabled while an export operation is in progress
- **Evidence:** Dropdown trigger has disabled attribute during operation
- **Test:** Start export, verify dropdown is not clickable during operation

#### U3: Export Preview Summary
- **Tag:** AUTO_VERIFY
- **Criterion:** Before API push, a confirmation dialog shows export summary: "Export January 2026 to QuickFile? Sales: {N} entries (£X), Expenses: {M} entries (£Y)"
- **Evidence:** Confirmation dialog displays with correct entry counts and totals
- **Test:** Click "Push to QuickFile", verify confirmation shows accurate summary

### Integration

#### I1: Reuses P&L Service Data
- **Tag:** AUTO_VERIFY
- **Criterion:** Export uses the same ProfitLossReportService that generates the P&L table, ensuring data consistency
- **Evidence:** Export service imports and calls ProfitLossReportService.generateReport()
- **Test:** Code inspection confirms shared service usage

#### I2: API Route Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** API route `/api/reports/mtd-export` exists and accepts POST requests
- **Evidence:** Route file exists at expected path and handles POST
- **Test:** `POST /api/reports/mtd-export` returns 200/400/401 (not 404)

#### I3: Credentials API Route
- **Tag:** AUTO_VERIFY
- **Criterion:** API routes exist for QuickFile credentials CRUD: GET/POST/DELETE `/api/integrations/quickfile/credentials`
- **Evidence:** Routes handle credential storage and retrieval
- **Test:** API routes respond appropriately to requests

## Out of Scope

- Multi-month/quarterly batch export (single month only for MVP)
- Automated scheduled exports (manual trigger only)
- QuickFile nominal code customization (fixed mapping)
- Import from QuickFile (export only)
- VAT calculations (all exports use VAT=0 for now, business is below VAT threshold)
- Reconciliation reports comparing Hadley Bricks vs QuickFile

## Dependencies

- P&L report page must be functional (`/reports/profit-loss`)
- ProfitLossReportService must return accurate monthly data
- platform_credentials table must exist for credential storage

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review
