# Done Criteria: cost-modelling

**Created:** 2026-01-18
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

A comprehensive cost modelling and P&L projection tool that enables "what-if" scenario planning for the LEGO resale business. Users can create, save, and compare multiple financial scenarios with different assumptions about sales volumes, pricing, platform fees, and costs. The tool calculates annual profit, take-home pay after tax, and provides detailed breakdowns by platform and time period.

**Problem:** Cannot model "what-if" P&L scenarios to understand the financial impact of different business decisions (sales volumes, pricing, platform mix, costs)
**User:** Business owner (Chris)
**Trigger:** Navigate to /cost-modelling page, create/load/edit scenarios
**Outcome:** Saved scenarios with full P&L calculations; comparison of two scenarios; daily/weekly/monthly breakdowns; PDF and CSV exports

---

## Success Criteria

### Phase 1: Core Model & Single Scenario

#### F1: Page Route Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** The route `/cost-modelling` renders a page without errors
- **Evidence:** HTTP 200 response, no React error boundary triggered
- **Test:** Navigate to `/cost-modelling`, verify page renders with expected layout

#### F2: Database Tables Created
- **Tag:** AUTO_VERIFY
- **Criterion:** The `cost_model_scenarios` and `cost_model_package_costs` tables exist in the database with correct schema
- **Evidence:** SQL query returns table definitions matching spec
- **Test:** `SELECT * FROM information_schema.tables WHERE table_name IN ('cost_model_scenarios', 'cost_model_package_costs')`

#### F3: Create New Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "+ New" button creates a new scenario with default values and saves to database
- **Evidence:** POST to `/api/cost-modelling/scenarios` returns 201 with scenario ID; scenario visible in dropdown
- **Test:** Click "+ New", verify API call succeeds, verify scenario appears in dropdown

#### F4: Load Existing Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** Selecting a scenario from dropdown loads all its data into the form fields
- **Evidence:** GET `/api/cost-modelling/scenarios/:id` returns scenario data; form fields populated with returned values
- **Test:** Create scenario, reload page, select from dropdown, verify fields match saved values

#### F5: Save Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Save" button persists current form values to the database for the selected scenario
- **Evidence:** PUT to `/api/cost-modelling/scenarios/:id` returns 200; subsequent GET returns updated values
- **Test:** Modify a field, click Save, reload page, verify field retained new value

#### F6: Save As New Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Save As" prompts for a name and creates a new scenario with current values
- **Evidence:** Dialog appears with name input; POST creates new scenario; new scenario appears in dropdown
- **Test:** Click "Save As", enter name, verify new scenario created with current values

#### F7: Delete Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Delete" shows confirmation dialog; confirming deletes the scenario from database
- **Evidence:** DELETE to `/api/cost-modelling/scenarios/:id` returns 200; scenario no longer in dropdown
- **Test:** Delete scenario, verify confirmation shown, verify scenario removed from list

#### F8: Default Scenario on First Visit
- **Tag:** AUTO_VERIFY
- **Criterion:** When user has no scenarios, a default scenario with spec-defined default values is auto-created
- **Evidence:** First page load creates scenario with `is_default: true`; all numeric fields match spec defaults
- **Test:** Clear all scenarios, visit page, verify default scenario created with correct defaults

#### F9: Assumptions Panel - Sales Volume Inputs
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains editable inputs for BrickLink, Amazon, and eBay sales per month, average sale value, and average postage cost (9 fields total)
- **Evidence:** 9 input elements exist with correct `name` attributes; values are editable and trigger recalculation
- **Test:** Query for inputs matching `bl_sales_per_month`, `bl_avg_sale_value`, `bl_avg_postage_cost`, `amazon_sales_per_month`, etc.

#### F10: Assumptions Panel - Fee Rate Inputs
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains editable inputs for BrickLink (10%), Amazon (18.3%), and eBay (20%) fee rates
- **Evidence:** 3 input elements for fee rates; values displayed as percentages; default values match spec
- **Test:** Query for fee rate inputs, verify defaults are 0.10, 0.183, 0.20

#### F11: Assumptions Panel - COG Percentage Inputs
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains editable inputs for BrickLink (20%), Amazon (35%), and eBay (30%) COG percentages
- **Evidence:** 3 input elements for COG%; values displayed as percentages; default values match spec
- **Test:** Query for COG inputs, verify defaults are 0.20, 0.35, 0.30

#### F12: Assumptions Panel - Fixed Costs Inputs
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains editable inputs for monthly fixed costs: Shopify (£25), eBay Store (£35), Seller Tools (£50), Amazon (£30), Storage (£110), plus annual Accountant (£200) and Misc (£1000)
- **Evidence:** 7 input elements for fixed costs; default values match spec
- **Test:** Query for fixed cost inputs, verify defaults match spec

#### F13: Assumptions Panel - VAT Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains a toggle for "Over VAT threshold" and input for VAT flat rate (7.5%)
- **Evidence:** Toggle element exists; rate input appears when toggle is on; accountant cost auto-updates to £1,650 when VAT enabled
- **Test:** Toggle VAT on, verify rate input visible, verify accountant cost changes

#### F14: Assumptions Panel - Tax Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** The assumptions panel contains inputs for target annual profit (£26,000), personal allowance (£12,570), income tax rate (20%), and NI rate (6%)
- **Evidence:** 4 input elements exist with correct defaults
- **Test:** Query for tax setting inputs, verify defaults match spec

#### F15: P&L Calculation - Turnover
- **Tag:** AUTO_VERIFY
- **Criterion:** Total turnover is calculated as sum of (sales_per_month × avg_sale_value × 12) for each platform
- **Evidence:** With default values: BL £29,700 + Amazon £36,000 + eBay £24,000 = £89,700 total
- **Test:** Set default values, verify displayed turnover equals £89,700

#### F16: P&L Calculation - Platform Fees
- **Tag:** AUTO_VERIFY
- **Criterion:** Platform fees are calculated as turnover × fee_rate for each platform
- **Evidence:** With defaults: BL £2,970 + Amazon £6,588 + eBay £4,800 = £14,358 total fees
- **Test:** Set default values, verify displayed total fees equals £14,358

#### F17: P&L Calculation - VAT
- **Tag:** AUTO_VERIFY
- **Criterion:** When VAT registered, VAT is calculated as total_turnover × vat_flat_rate; when not registered, VAT is £0
- **Evidence:** VAT off: £0; VAT on with 7.5%: £89,700 × 0.075 = £6,728
- **Test:** Toggle VAT, verify VAT amount changes from £0 to £6,728

#### F18: P&L Calculation - COG
- **Tag:** AUTO_VERIFY
- **Criterion:** COG is calculated as turnover × cog_percent for each platform
- **Evidence:** With defaults: BL £5,940 + Amazon £12,600 + eBay £7,200 = £25,740 total COG
- **Test:** Set default values, verify displayed total COG equals £25,740

#### F19: P&L Calculation - Net Profit
- **Tag:** AUTO_VERIFY
- **Criterion:** Net profit is calculated as: Turnover - Fees - VAT - Other Costs - COG
- **Evidence:** Calculation follows spec formula; result matches expected value for given inputs
- **Test:** Set known inputs, verify net profit calculation is correct

#### F20: P&L Calculation - Tax
- **Tag:** AUTO_VERIFY
- **Criterion:** Income tax is (net_profit - personal_allowance) × income_tax_rate; NI is same taxable amount × ni_rate
- **Evidence:** With £29,995 profit: taxable = £17,425; tax = £3,485; NI = £1,046
- **Test:** Set inputs to produce known profit, verify tax calculations match

#### F21: P&L Calculation - Take-Home
- **Tag:** AUTO_VERIFY
- **Criterion:** Take-home is calculated as net_profit - total_tax; weekly is take_home / 52
- **Evidence:** Take-home = £29,995 - £4,531 = £25,465; weekly = £489.71
- **Test:** Verify take-home and weekly calculations are correct

#### F22: Hero Metrics Display
- **Tag:** AUTO_VERIFY
- **Criterion:** Four hero metrics are displayed: Annual Profit, Take-Home, Weekly Take-Home, Profit vs Target
- **Evidence:** 4 stat cards exist in DOM with correct labels and calculated values
- **Test:** Query for hero metric elements, verify all 4 present with correct values

#### F23: P&L Breakdown Display
- **Tag:** AUTO_VERIFY
- **Criterion:** The P&L breakdown section shows: Revenue by platform, Fees by platform, VAT (if applicable), Other costs breakdown, COG by platform, Tax breakdown
- **Evidence:** All breakdown sections render with correct line items
- **Test:** Verify DOM contains all P&L breakdown sections with expected values

#### F24: Live Calculation on Input Change
- **Tag:** AUTO_VERIFY
- **Criterion:** When any assumption input changes, all calculated values update immediately (client-side calculation)
- **Evidence:** Changing an input updates hero metrics and P&L breakdown without API call
- **Test:** Modify sales volume, verify hero metrics update within 100ms, no network request made

---

### Phase 2: Package Cost Matrix

#### F25: Package Cost Matrix UI
- **Tag:** AUTO_VERIFY
- **Criterion:** A 6-column matrix is displayed for package costs: Large/Small/Letter × Amazon/eBay
- **Evidence:** Table with 6 package type columns exists; each column has rows for: postage, cardboard, bubble_wrap, lego_card, business_card, total
- **Test:** Query for package cost matrix table, verify 6 columns and 6 rows

#### F26: Package Cost Default Values
- **Tag:** AUTO_VERIFY
- **Criterion:** New scenarios are seeded with default package costs matching the spec
- **Evidence:** `cost_model_package_costs` table has 6 rows per scenario with values matching spec defaults
- **Test:** Create new scenario, query package costs, verify values match spec

#### F27: Package Cost Editing
- **Tag:** AUTO_VERIFY
- **Criterion:** Each package cost cell (except Total row) is editable; changes persist when scenario is saved
- **Evidence:** Input elements in matrix cells; save + reload retains changed values
- **Test:** Edit a package cost, save, reload, verify value persisted

#### F28: Package Cost Total Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** The Total row auto-calculates as sum of all cost components plus fixed_cost_per_sale
- **Evidence:** Total row values update when individual costs change; formula matches spec
- **Test:** Modify a cost component, verify total row updates correctly

#### F29: Fixed Cost Per Sale Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** Fixed cost per sale is auto-calculated as (monthly_fixed_costs / total_monthly_sales) and displayed read-only in matrix
- **Evidence:** With defaults: £350 / 320 = £1.09 per sale
- **Test:** Verify fixed cost per sale displays as £1.09 with default values; verify it updates when fixed costs or sales change

#### F30: Package Costs Feed P&L Calculations
- **Tag:** AUTO_VERIFY
- **Criterion:** Changes to package costs affect the "Packaging Materials" section in P&L breakdown
- **Evidence:** Modifying cardboard costs updates annual_cardboard in P&L
- **Test:** Change cardboard cost, verify Packaging Materials section updates

---

### Phase 3: Summary Views

#### F31: Summary View Tabs
- **Tag:** AUTO_VERIFY
- **Criterion:** Three tabs/views exist: Daily, Weekly, Monthly
- **Evidence:** Tab navigation with 3 options; clicking each shows different breakdown
- **Test:** Query for 3 tab elements; click each, verify content changes

#### F32: Daily View Calculations
- **Tag:** AUTO_VERIFY
- **Criterion:** Daily view shows per-platform: Sales/Day, COG per item, Sale Price, Sale Price exc postage, Turnover/Day, COG Budget/Day
- **Evidence:** Table with 6 columns × 4 rows (3 platforms + total); values calculated as annual ÷ 365
- **Test:** Verify daily calculations: 320×12÷365 = 10.52 sales/day; £89,700÷365 = £245.75 turnover/day

#### F33: Weekly View Calculations
- **Tag:** AUTO_VERIFY
- **Criterion:** Weekly view shows per-platform: COG Budget, Sales Target, Sales Volume
- **Evidence:** Table with values calculated as annual ÷ 52
- **Test:** Verify weekly calculations: total COG budget £25,740÷52 = £494.62/week

#### F34: Monthly View Calculations
- **Tag:** AUTO_VERIFY
- **Criterion:** Monthly view shows per-platform: COG Budget, Sales Target, Sales Volume (matching assumption inputs)
- **Evidence:** Values match monthly assumptions directly
- **Test:** Verify monthly values match: 165 BL sales, 75 Amazon sales, 80 eBay sales

---

### Phase 4: Compare Mode

#### F35: Compare Mode Toggle
- **Tag:** AUTO_VERIFY
- **Criterion:** A toggle exists to enable/disable Compare Mode
- **Evidence:** Toggle element with "Compare Mode" label; clicking toggles between single and comparison views
- **Test:** Query for compare mode toggle, click it, verify layout changes

#### F36: Compare Mode Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** When Compare Mode is enabled, the page shows two scenario columns side-by-side
- **Evidence:** Two scenario selector dropdowns visible; two sets of assumption panels and P&L breakdowns
- **Test:** Enable compare mode, verify 2 scenario dropdowns and 2 P&L panels visible

#### F37: Scenario B Selection
- **Tag:** AUTO_VERIFY
- **Criterion:** In Compare Mode, a second dropdown allows selecting a different scenario (Scenario B)
- **Evidence:** Second dropdown populated with all scenarios except currently selected Scenario A
- **Test:** Enable compare mode, verify second dropdown shows available scenarios

#### F38: Independent Editing in Compare Mode
- **Tag:** AUTO_VERIFY
- **Criterion:** Both scenarios can be edited independently in Compare Mode; changes to one don't affect the other
- **Evidence:** Modify Scenario A input, verify Scenario B values unchanged
- **Test:** Edit sales volume in Scenario A, verify Scenario B sales volume unchanged

#### F39: Comparison Summary Section
- **Tag:** AUTO_VERIFY
- **Criterion:** A comparison summary table shows deltas between Scenario A and B for key metrics
- **Evidence:** Table with columns: Metric, Scenario A, Scenario B, Delta, % Change
- **Test:** Query for comparison summary table, verify 5 columns present

#### F40: Comparison Metrics
- **Tag:** AUTO_VERIFY
- **Criterion:** Comparison summary includes: Annual Turnover, Total Fees, Total COG, Net Profit, Take-Home
- **Evidence:** 5 rows in comparison table with correct metrics
- **Test:** Verify comparison table has 5 metric rows

#### F41: Delta Calculations
- **Tag:** AUTO_VERIFY
- **Criterion:** Delta column shows (Scenario B value - Scenario A value); % Change shows ((B-A)/A × 100)
- **Evidence:** With known values, delta and % change calculations are correct
- **Test:** Set two scenarios with known values, verify delta and % calculations

#### F42: Comparison Highlighting
- **Tag:** AUTO_VERIFY
- **Criterion:** Rows with >10% change are visually highlighted (different background colour or border)
- **Evidence:** CSS class or style applied to rows where abs(% change) > 10
- **Test:** Create scenarios with >10% difference, verify row has highlight styling

#### F43: Hero Metrics Delta Indicators
- **Tag:** AUTO_VERIFY
- **Criterion:** In Compare Mode, hero metrics show delta indicators (green up arrow if B better, red down arrow if worse)
- **Evidence:** Arrow icons visible next to hero metrics; colour matches direction
- **Test:** Set Scenario B with higher profit, verify green up arrow on profit metric

#### F44: Duplicate Scenario
- **Tag:** AUTO_VERIFY
- **Criterion:** A "Duplicate" action creates a copy of the current scenario with "Copy of [name]" as the name
- **Evidence:** POST to `/api/cost-modelling/scenarios/:id/duplicate` returns new scenario; name prefixed with "Copy of"
- **Test:** Duplicate scenario, verify new scenario created with correct name and values

---

### Phase 5: Polish & UX

#### F45: Unsaved Changes Warning
- **Tag:** AUTO_VERIFY
- **Criterion:** If user has unsaved changes and attempts to navigate away or close tab, a warning dialog appears
- **Evidence:** `beforeunload` event handler triggers confirmation; in-app navigation shows modal
- **Test:** Make changes, attempt navigation, verify warning appears

#### F46: Dirty State Indicator
- **Tag:** AUTO_VERIFY
- **Criterion:** When changes are unsaved, a visual indicator (e.g., asterisk on save button, "Unsaved changes" text) is visible
- **Evidence:** DOM element appears when form is dirty; disappears after save
- **Test:** Make change, verify dirty indicator visible; save, verify indicator hidden

#### F47: Auto-Save Draft to Server
- **Tag:** AUTO_VERIFY
- **Criterion:** Unsaved changes are auto-saved as a draft to the server every 30 seconds
- **Evidence:** Database has draft field or separate draft table; PUT request made automatically
- **Test:** Make change, wait 30s, verify draft saved; close browser, reopen, verify draft restored

#### F48: Draft Restoration
- **Tag:** AUTO_VERIFY
- **Criterion:** When loading a scenario with an unsaved draft, user is prompted to restore draft or discard
- **Evidence:** Modal appears with "Restore draft" and "Discard" options
- **Test:** Create draft, reload page, verify restoration prompt appears

#### F49: Collapsible Assumption Sections
- **Tag:** AUTO_VERIFY
- **Criterion:** Each assumption category (Sales, Fees, COG, Fixed Costs, VAT, Tax) is a collapsible section
- **Evidence:** Accordion or collapsible components; sections can be expanded/collapsed; state persists
- **Test:** Collapse a section, verify it stays collapsed; expand, verify it expands

#### F50: Mobile Responsive Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** The page is usable at 375px width (mobile); Compare Mode stacks vertically on mobile
- **Evidence:** No horizontal scroll at 375px; all inputs accessible; compare mode shows scenarios stacked
- **Test:** Set viewport to 375px, verify layout adapts correctly

#### F51: Export to PDF
- **Tag:** AUTO_VERIFY
- **Criterion:** An "Export PDF" button generates a PDF document containing the P&L summary
- **Evidence:** Button click triggers file download with `.pdf` extension; file is valid PDF
- **Test:** Click Export PDF, verify file downloads, verify PDF opens correctly

#### F52: Export to CSV
- **Tag:** AUTO_VERIFY
- **Criterion:** An "Export CSV" button generates a CSV file containing all scenario assumptions and calculated values
- **Evidence:** Button click triggers file download with `.csv` extension; file contains headers and data rows
- **Test:** Click Export CSV, verify file downloads, verify CSV parses correctly with expected columns

#### F53: PDF Contains P&L Summary
- **Tag:** AUTO_VERIFY
- **Criterion:** The exported PDF includes: scenario name, hero metrics, full P&L breakdown, summary views
- **Evidence:** PDF text extraction finds all expected sections
- **Test:** Export PDF, parse content, verify all sections present

#### F54: CSV Contains All Data
- **Tag:** AUTO_VERIFY
- **Criterion:** The exported CSV includes all assumption inputs and all calculated outputs
- **Evidence:** CSV headers include all field names; values match displayed values
- **Test:** Export CSV, compare values to on-screen values

#### F55: Loading Skeleton on Page Load
- **Tag:** AUTO_VERIFY
- **Criterion:** While scenarios are loading, a skeleton loader is displayed
- **Evidence:** Skeleton component visible during initial load; replaced by actual content when data arrives
- **Test:** Throttle network, verify skeleton visible during load

#### F56: Scenario Dropdown Shows Last Modified
- **Tag:** AUTO_VERIFY
- **Criterion:** Each scenario in the dropdown shows name and last modified date
- **Evidence:** Dropdown items have two-line format: name + "Modified: [date]"
- **Test:** Query dropdown items, verify both name and date visible

---

### Error Handling

#### E1: API Error on Save
- **Tag:** AUTO_VERIFY
- **Criterion:** If save fails (network error or server error), a toast notification displays the error message
- **Evidence:** Toast component appears with error variant; message describes the failure
- **Test:** Mock API failure, click save, verify error toast appears

#### E2: API Error on Load
- **Tag:** AUTO_VERIFY
- **Criterion:** If loading a scenario fails, an error message is displayed in place of the form
- **Evidence:** Error state component renders with retry button
- **Test:** Mock GET failure, verify error state shown with retry button

#### E3: Validation Error on Invalid Input
- **Tag:** AUTO_VERIFY
- **Criterion:** Numeric inputs reject non-numeric values; invalid inputs show inline error message
- **Evidence:** Input validation prevents letters; red border and error text on invalid
- **Test:** Type letters in numeric field, verify validation error shown

#### E4: Negative Value Prevention
- **Tag:** AUTO_VERIFY
- **Criterion:** Numeric inputs for costs, sales, and rates do not accept negative values
- **Evidence:** Input min attribute set to 0; negative values rejected or converted to 0
- **Test:** Attempt to enter -10, verify value is rejected or becomes 0

#### E5: Delete Last Scenario Prevention
- **Tag:** AUTO_VERIFY
- **Criterion:** User cannot delete their last remaining scenario; delete button disabled or shows warning
- **Evidence:** When only 1 scenario exists, delete is disabled with tooltip explaining why
- **Test:** Delete scenarios until 1 remains, verify delete is disabled

#### E6: Network Offline Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** When offline, save attempts show "You are offline" message; draft continues to be stored locally
- **Evidence:** Offline detection shows banner; save queued for when online
- **Test:** Disconnect network, attempt save, verify offline message shown

#### E7: Concurrent Edit Warning
- **Tag:** AUTO_VERIFY
- **Criterion:** If scenario was modified elsewhere since loading, save shows conflict warning
- **Evidence:** Optimistic locking via `updated_at` field; conflict modal with options to overwrite or reload
- **Test:** Open scenario in two tabs, modify and save in one, attempt save in other, verify conflict warning

---

### Performance

#### P1: Initial Page Load
- **Tag:** AUTO_VERIFY
- **Criterion:** The cost-modelling page reaches interactive state in under 3 seconds on 3G connection
- **Evidence:** Lighthouse performance score or manual timing measurement
- **Test:** Load page on throttled network, measure time to interactive

#### P2: Calculation Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** All P&L calculations complete within 50ms of input change
- **Evidence:** No perceptible delay when typing; performance timing shows <50ms
- **Test:** Measure time from input change to UI update

#### P3: Scenario List Load
- **Tag:** AUTO_VERIFY
- **Criterion:** Loading list of up to 50 scenarios completes in under 500ms
- **Evidence:** API response time <500ms; dropdown populates quickly
- **Test:** Create 50 scenarios, measure dropdown population time

#### P4: Compare Mode Render
- **Tag:** AUTO_VERIFY
- **Criterion:** Switching to Compare Mode renders the dual layout within 200ms
- **Evidence:** No visible lag when toggling; render time <200ms
- **Test:** Toggle compare mode, measure render time

#### P5: Export PDF Generation
- **Tag:** AUTO_VERIFY
- **Criterion:** PDF export generates and downloads within 5 seconds
- **Evidence:** Time from click to download complete <5000ms
- **Test:** Click export, measure time to download

#### P6: Export CSV Generation
- **Tag:** AUTO_VERIFY
- **Criterion:** CSV export generates and downloads within 1 second
- **Evidence:** Time from click to download complete <1000ms
- **Test:** Click export, measure time to download

---

### UI/UX

#### U1: Shadcn UI Components
- **Tag:** AUTO_VERIFY
- **Criterion:** All form inputs, buttons, cards, and dialogs use shadcn/ui components
- **Evidence:** Component classes include shadcn patterns (e.g., `bg-background`, `border-input`)
- **Test:** Inspect DOM classes, verify shadcn styling applied

#### U2: Consistent Currency Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** All monetary values are displayed with £ symbol and 2 decimal places
- **Evidence:** Values formatted as "£X,XXX.XX" with thousands separator
- **Test:** Verify all currency displays match format pattern

#### U3: Consistent Percentage Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** All percentage inputs accept decimal values and display with % symbol
- **Evidence:** Fee rate "18.3%" displayed; input accepts 0.183 or 18.3
- **Test:** Enter percentage values, verify display format

#### U4: Input Labels and Help Text
- **Tag:** AUTO_VERIFY
- **Criterion:** Each input has a visible label; complex inputs have help text or tooltip
- **Evidence:** Label elements associated with inputs; tooltips on hover for fee rates, COG, VAT
- **Test:** Query for labels on all inputs; hover complex fields, verify tooltips

#### U5: Read-Only Calculated Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Calculated values (totals, P&L figures) are visually distinct and not editable
- **Evidence:** Different background colour or styling; no cursor on hover; not focusable
- **Test:** Attempt to click/focus calculated fields, verify they're not editable

#### U6: Section Headings
- **Tag:** AUTO_VERIFY
- **Criterion:** Each major section (Assumptions, P&L Breakdown, Package Matrix, Summary Views) has a clear heading
- **Evidence:** H2 or H3 elements with descriptive text
- **Test:** Query for section headings, verify all sections labelled

#### U7: Positive/Negative Value Colouring
- **Tag:** AUTO_VERIFY
- **Criterion:** Positive profit/delta values are green; negative values are red
- **Evidence:** CSS classes or inline styles apply green to positive, red to negative
- **Test:** Set profit above target (green), below target (red), verify colours

#### U8: Responsive 768px Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** At tablet width (768px), layout adjusts appropriately (2-column becomes 1-column where needed)
- **Evidence:** Layout test at 768px shows readable, usable interface
- **Test:** Set viewport to 768px, verify layout adapts

#### U9: Focus States
- **Tag:** AUTO_VERIFY
- **Criterion:** All interactive elements have visible focus states for keyboard navigation
- **Evidence:** Tab through page, each focusable element shows visible focus ring
- **Test:** Tab through all inputs and buttons, verify focus indicators visible

#### U10: Button Loading States
- **Tag:** AUTO_VERIFY
- **Criterion:** Save, Export, and Delete buttons show loading spinner during operation
- **Evidence:** Button shows spinner; button disabled during operation
- **Test:** Click save, verify spinner shown until operation completes

---

### Integration

#### I1: RLS Policies
- **Tag:** AUTO_VERIFY
- **Criterion:** Row Level Security policies restrict scenarios to the owning user only
- **Evidence:** User A cannot read/write User B's scenarios via direct SQL or API
- **Test:** Create scenario as User A, attempt to access as User B, verify 403

#### I2: API Authentication
- **Tag:** AUTO_VERIFY
- **Criterion:** All `/api/cost-modelling/*` endpoints require authentication
- **Evidence:** Unauthenticated requests return 401
- **Test:** Call API without auth token, verify 401 response

#### I3: Sidebar Navigation
- **Tag:** AUTO_VERIFY
- **Criterion:** "Cost Modelling" link appears in the sidebar navigation under appropriate section
- **Evidence:** Sidebar contains link with href="/cost-modelling"
- **Test:** Query sidebar for cost-modelling link

#### I4: Page Title and Meta
- **Tag:** AUTO_VERIFY
- **Criterion:** Page has appropriate title ("Cost Modelling | Hadley Bricks") and meta description
- **Evidence:** `<title>` tag and meta description set correctly
- **Test:** Check document.title on page load

---

## Out of Scope

- **Actuals comparison**: Comparing projections against actual sales/profit data from the system (planned for future phase)
- **Multi-currency support**: All values in GBP only
- **Shared scenarios**: Scenarios are user-specific, no sharing between users
- **Scenario templates**: No pre-built templates beyond the single default
- **Historical versioning**: No version history of scenario changes
- **Scheduled reports**: No automated email/PDF reports
- **Keyboard shortcuts**: Deferred from Phase 5 per user request
- **BrickLink column in package matrix**: Uses simple postage cost assumption as per spec

---

## Dependencies

- Supabase database connection (cloud instance)
- User authentication working
- Sidebar navigation component exists
- shadcn/ui components installed
- PDF generation library (e.g., react-pdf or jsPDF)

---

## Iteration Budget

- **Max iterations:** 7 (due to scope including all 5 phases)
- **Escalation:** If not converged after 7 iterations, pause for human review

---

## Verification Summary

| ID | Criterion | Tag | Status |
|----|-----------|-----|--------|
| F1 | Page route exists | AUTO_VERIFY | PENDING |
| F2 | Database tables created | AUTO_VERIFY | PENDING |
| F3 | Create new scenario | AUTO_VERIFY | PENDING |
| F4 | Load existing scenario | AUTO_VERIFY | PENDING |
| F5 | Save scenario | AUTO_VERIFY | PENDING |
| F6 | Save As new scenario | AUTO_VERIFY | PENDING |
| F7 | Delete scenario | AUTO_VERIFY | PENDING |
| F8 | Default scenario on first visit | AUTO_VERIFY | PENDING |
| F9 | Sales volume inputs | AUTO_VERIFY | PENDING |
| F10 | Fee rate inputs | AUTO_VERIFY | PENDING |
| F11 | COG percentage inputs | AUTO_VERIFY | PENDING |
| F12 | Fixed costs inputs | AUTO_VERIFY | PENDING |
| F13 | VAT settings | AUTO_VERIFY | PENDING |
| F14 | Tax settings | AUTO_VERIFY | PENDING |
| F15 | Turnover calculation | AUTO_VERIFY | PENDING |
| F16 | Platform fees calculation | AUTO_VERIFY | PENDING |
| F17 | VAT calculation | AUTO_VERIFY | PENDING |
| F18 | COG calculation | AUTO_VERIFY | PENDING |
| F19 | Net profit calculation | AUTO_VERIFY | PENDING |
| F20 | Tax calculation | AUTO_VERIFY | PENDING |
| F21 | Take-home calculation | AUTO_VERIFY | PENDING |
| F22 | Hero metrics display | AUTO_VERIFY | PENDING |
| F23 | P&L breakdown display | AUTO_VERIFY | PENDING |
| F24 | Live calculation on change | AUTO_VERIFY | PENDING |
| F25 | Package cost matrix UI | AUTO_VERIFY | PENDING |
| F26 | Package cost defaults | AUTO_VERIFY | PENDING |
| F27 | Package cost editing | AUTO_VERIFY | PENDING |
| F28 | Package cost total calc | AUTO_VERIFY | PENDING |
| F29 | Fixed cost per sale calc | AUTO_VERIFY | PENDING |
| F30 | Package costs feed P&L | AUTO_VERIFY | PENDING |
| F31 | Summary view tabs | AUTO_VERIFY | PENDING |
| F32 | Daily view calculations | AUTO_VERIFY | PENDING |
| F33 | Weekly view calculations | AUTO_VERIFY | PENDING |
| F34 | Monthly view calculations | AUTO_VERIFY | PENDING |
| F35 | Compare mode toggle | AUTO_VERIFY | PENDING |
| F36 | Compare mode layout | AUTO_VERIFY | PENDING |
| F37 | Scenario B selection | AUTO_VERIFY | PENDING |
| F38 | Independent editing | AUTO_VERIFY | PENDING |
| F39 | Comparison summary section | AUTO_VERIFY | PENDING |
| F40 | Comparison metrics | AUTO_VERIFY | PENDING |
| F41 | Delta calculations | AUTO_VERIFY | PENDING |
| F42 | Comparison highlighting | AUTO_VERIFY | PENDING |
| F43 | Hero metrics delta indicators | AUTO_VERIFY | PENDING |
| F44 | Duplicate scenario | AUTO_VERIFY | PENDING |
| F45 | Unsaved changes warning | AUTO_VERIFY | PENDING |
| F46 | Dirty state indicator | AUTO_VERIFY | PENDING |
| F47 | Auto-save draft to server | AUTO_VERIFY | PENDING |
| F48 | Draft restoration | AUTO_VERIFY | PENDING |
| F49 | Collapsible sections | AUTO_VERIFY | PENDING |
| F50 | Mobile responsive | AUTO_VERIFY | PENDING |
| F51 | Export to PDF | AUTO_VERIFY | PENDING |
| F52 | Export to CSV | AUTO_VERIFY | PENDING |
| F53 | PDF contains P&L | AUTO_VERIFY | PENDING |
| F54 | CSV contains all data | AUTO_VERIFY | PENDING |
| F55 | Loading skeleton | AUTO_VERIFY | PENDING |
| F56 | Dropdown shows modified date | AUTO_VERIFY | PENDING |
| E1 | API error on save | AUTO_VERIFY | PENDING |
| E2 | API error on load | AUTO_VERIFY | PENDING |
| E3 | Validation error | AUTO_VERIFY | PENDING |
| E4 | Negative value prevention | AUTO_VERIFY | PENDING |
| E5 | Delete last scenario prevention | AUTO_VERIFY | PENDING |
| E6 | Network offline handling | AUTO_VERIFY | PENDING |
| E7 | Concurrent edit warning | AUTO_VERIFY | PENDING |
| P1 | Initial page load | AUTO_VERIFY | PENDING |
| P2 | Calculation speed | AUTO_VERIFY | PENDING |
| P3 | Scenario list load | AUTO_VERIFY | PENDING |
| P4 | Compare mode render | AUTO_VERIFY | PENDING |
| P5 | PDF generation time | AUTO_VERIFY | PENDING |
| P6 | CSV generation time | AUTO_VERIFY | PENDING |
| U1 | Shadcn UI components | AUTO_VERIFY | PENDING |
| U2 | Currency formatting | AUTO_VERIFY | PENDING |
| U3 | Percentage formatting | AUTO_VERIFY | PENDING |
| U4 | Input labels and help | AUTO_VERIFY | PENDING |
| U5 | Read-only calculated fields | AUTO_VERIFY | PENDING |
| U6 | Section headings | AUTO_VERIFY | PENDING |
| U7 | Positive/negative colouring | AUTO_VERIFY | PENDING |
| U8 | 768px layout | AUTO_VERIFY | PENDING |
| U9 | Focus states | AUTO_VERIFY | PENDING |
| U10 | Button loading states | AUTO_VERIFY | PENDING |
| I1 | RLS policies | AUTO_VERIFY | PENDING |
| I2 | API authentication | AUTO_VERIFY | PENDING |
| I3 | Sidebar navigation | AUTO_VERIFY | PENDING |
| I4 | Page title and meta | AUTO_VERIFY | PENDING |

**Total:** 77 criteria (77 AUTO_VERIFY, 0 HUMAN_VERIFY, 0 TOOL_VERIFY)

---

## Handoff

Ready for: `/build-feature cost-modelling`

**Key files to be created:**
- `apps/web/app/(dashboard)/cost-modelling/page.tsx` (new)
- `apps/web/app/(dashboard)/cost-modelling/loading.tsx` (new)
- `apps/web/app/api/cost-modelling/scenarios/route.ts` (new)
- `apps/web/app/api/cost-modelling/scenarios/[id]/route.ts` (new)
- `apps/web/app/api/cost-modelling/scenarios/[id]/duplicate/route.ts` (new)
- `apps/web/components/features/cost-modelling/` (new directory)
- `apps/web/lib/services/cost-modelling.service.ts` (new)
- `apps/web/lib/repositories/cost-modelling.repository.ts` (new)
- `apps/web/hooks/use-cost-modelling.ts` (new)
- `supabase/migrations/[timestamp]_cost_modelling_tables.sql` (new)
