# Done Criteria: home-costs

**Created:** 2026-01-22
**Author:** Define Done Agent + Chris
**Status:** APPROVED

---

## Feature Summary

A "Home Costs" configuration UI accessible from the Profit & Loss report (`/reports/profit-loss`) that allows users to capture allowable home working expenses. Users can configure Use of Home (HMRC simplified flat rate), Phone & Broadband costs with business use percentages, and Insurance (business proportion of home contents). Costs are entered with date ranges and automatically applied to each month's P&L calculation.

**Problem:** Allowable home working expenses are not being tracked in P&L calculations
**User:** Business owner (Chris)
**Trigger:** Click "Home Costs" button on P&L report page
**Outcome:** Configured home costs automatically included in monthly P&L calculations

---

## Success Criteria

### Phase 1: Database & API Foundation

#### F1: Database Tables Created
- **Tag:** AUTO_VERIFY
- **Criterion:** The `home_costs` and `home_costs_settings` tables exist in the database with correct schema
- **Evidence:** SQL query returns table definitions matching spec
- **Test:** `SELECT * FROM information_schema.tables WHERE table_name IN ('home_costs', 'home_costs_settings')`

#### F2: Home Costs Table Schema
- **Tag:** AUTO_VERIFY
- **Criterion:** The `home_costs` table has columns: id, user_id, cost_type, description, start_date, end_date, hours_per_month, monthly_cost, business_percent, annual_premium, business_stock_value, total_contents_value, created_at, updated_at
- **Evidence:** Column names and types match spec
- **Test:** Query information_schema.columns for home_costs table

#### F3: Home Costs Settings Table Schema
- **Tag:** AUTO_VERIFY
- **Criterion:** The `home_costs_settings` table has columns: user_id (PK), display_mode, updated_at
- **Evidence:** Column names and types match spec
- **Test:** Query information_schema.columns for home_costs_settings table

#### F4: RLS Policies on Home Costs
- **Tag:** AUTO_VERIFY
- **Criterion:** Row Level Security policies restrict home_costs to the owning user only
- **Evidence:** User A cannot read/write User B's home costs
- **Test:** Create cost as User A, attempt to access as User B, verify rejection

#### F5: RLS Policies on Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** Row Level Security policies restrict home_costs_settings to the owning user only
- **Evidence:** User A cannot read/write User B's settings
- **Test:** Create settings as User A, attempt to access as User B, verify rejection

#### F6: GET /api/home-costs Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** GET `/api/home-costs` returns all home costs and settings for authenticated user
- **Evidence:** HTTP 200 with JSON body containing `costs` array and `settings` object
- **Test:** Call API with auth, verify response shape matches spec

#### F7: POST /api/home-costs Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** POST `/api/home-costs` creates a new home cost entry
- **Evidence:** HTTP 201 with created cost; subsequent GET includes new cost
- **Test:** POST valid cost, verify 201 response, verify appears in GET

#### F8: PATCH /api/home-costs/:id Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** PATCH `/api/home-costs/:id` updates an existing home cost entry
- **Evidence:** HTTP 200 with updated cost; subsequent GET shows updated values
- **Test:** PATCH existing cost, verify 200 response, verify changes persisted

#### F9: DELETE /api/home-costs/:id Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** DELETE `/api/home-costs/:id` removes a home cost entry
- **Evidence:** HTTP 200; subsequent GET does not include deleted cost
- **Test:** DELETE existing cost, verify 200 response, verify removed from GET

#### F10: PATCH /api/home-costs/settings Endpoint
- **Tag:** AUTO_VERIFY
- **Criterion:** PATCH `/api/home-costs/settings` updates display_mode setting
- **Evidence:** HTTP 200 with updated settings; subsequent GET shows updated value
- **Test:** PATCH settings, verify 200 response, verify changes persisted

#### F11: API Authentication Required
- **Tag:** AUTO_VERIFY
- **Criterion:** All `/api/home-costs/*` endpoints require authentication
- **Evidence:** Unauthenticated requests return 401
- **Test:** Call each endpoint without auth token, verify 401 response

---

### Phase 2: Modal UI Structure

#### F12: Home Costs Button on P&L Page
- **Tag:** AUTO_VERIFY
- **Criterion:** A "Home Costs" primary button is visible on the `/reports/profit-loss` page toolbar
- **Evidence:** DOM query finds button with text "Home Costs" and primary styling
- **Test:** Navigate to `/reports/profit-loss`, query for Home Costs button

#### F13: Modal Opens on Button Click
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking the "Home Costs" button opens a modal dialog
- **Evidence:** Modal element appears in DOM with visible state
- **Test:** Click button, verify modal is visible

#### F14: Modal Has Four Tabs
- **Tag:** AUTO_VERIFY
- **Criterion:** The modal contains four tabs: "Use of Home", "Phone & Broadband", "Insurance", "Settings"
- **Evidence:** 4 tab elements with correct labels
- **Test:** Query for tab elements, verify 4 tabs with expected labels

#### F15: Modal Opens on First Tab
- **Tag:** AUTO_VERIFY
- **Criterion:** When modal opens, the "Use of Home" tab is active by default
- **Evidence:** First tab has active styling; first tab content is visible
- **Test:** Open modal, verify first tab is selected

#### F16: Modal Closes via X Button
- **Tag:** AUTO_VERIFY
- **Criterion:** Modal has an X button that closes the modal when clicked
- **Evidence:** X button exists; clicking it removes modal from visible state
- **Test:** Open modal, click X button, verify modal closed

#### F17: Modal Does Not Close on Backdrop Click
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking outside the modal (on backdrop) does not close it
- **Evidence:** Click backdrop, modal remains visible
- **Test:** Open modal, click backdrop, verify modal still visible

#### F18: Tab Navigation Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking each tab shows the corresponding tab content
- **Evidence:** Tab content changes when different tabs clicked
- **Test:** Click each tab, verify content changes appropriately

#### F19: Per-Tab Save Buttons
- **Tag:** AUTO_VERIFY
- **Criterion:** Each tab has its own Save button (not a shared modal-level save)
- **Evidence:** Save button exists within each tab content area
- **Test:** Inspect each tab, verify Save button present in each

#### F20: Modal Stays Open After Save
- **Tag:** AUTO_VERIFY
- **Criterion:** After saving a tab, the modal remains open
- **Evidence:** Save action completes, modal still visible
- **Test:** Configure and save a cost, verify modal still open

---

### Phase 3: Use of Home Tab

#### F21: Use of Home Radio Options
- **Tag:** AUTO_VERIFY
- **Criterion:** The Use of Home tab displays three radio button options: "25-50 hours → £10/month", "51-100 hours → £18/month", "101+ hours → £26/month"
- **Evidence:** 3 radio inputs with correct labels and values
- **Test:** Query for radio inputs, verify 3 options with HMRC rates

#### F22: Use of Home Month Picker - Start Date
- **Tag:** AUTO_VERIFY
- **Criterion:** The Use of Home tab has a month picker for Start Date
- **Evidence:** Month picker component exists for start date selection
- **Test:** Query for start date month picker element

#### F23: Use of Home Month Picker - End Date
- **Tag:** AUTO_VERIFY
- **Criterion:** The Use of Home tab has a month picker for End Date with "Ongoing" option
- **Evidence:** Month picker with ongoing toggle/option
- **Test:** Query for end date picker with ongoing option

#### F24: Use of Home Monthly/Annual Display
- **Tag:** AUTO_VERIFY
- **Criterion:** The tab displays calculated "Monthly Allowance" and "Annual Estimate" based on selected tier
- **Evidence:** Two read-only display fields showing £X.XX monthly and £X.XX annual
- **Test:** Select each tier, verify monthly and annual values update correctly

#### F25: Use of Home Calculation Accuracy
- **Tag:** AUTO_VERIFY
- **Criterion:** Monthly rates are: 25-50 hours = £10, 51-100 hours = £18, 101+ hours = £26; Annual = Monthly × 12
- **Evidence:** Selecting each tier shows correct calculated values
- **Test:** Select "101+ hours", verify £26.00 monthly and £312.00 annual

#### F26: Use of Home Save Creates Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Save creates a use_of_home entry in the database with selected values
- **Evidence:** POST request sent; database contains new row with cost_type='use_of_home'
- **Test:** Configure and save, verify database entry created

#### F27: Use of Home Prevents Overlapping Entries
- **Tag:** AUTO_VERIFY
- **Criterion:** System prevents creating a Use of Home entry that overlaps with an existing entry's date range
- **Evidence:** Validation error shown when dates overlap existing entry
- **Test:** Create entry for Apr-Dec 2024, attempt to create Jun-Aug 2024, verify error

#### F28: Use of Home Loads Existing Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** When user has existing Use of Home entry, tab loads with saved values pre-populated
- **Evidence:** Radio selection and dates match database values
- **Test:** Save entry, close modal, reopen, verify values loaded

#### F29: Use of Home Edit Existing Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** User can modify and re-save an existing Use of Home entry
- **Evidence:** Change tier, save, reload, verify new tier persisted
- **Test:** Load existing entry, change tier, save, verify update persisted

#### F30: Use of Home Delete Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** User can delete an existing Use of Home entry via Delete button
- **Evidence:** Delete button exists; clicking removes entry from database
- **Test:** Create entry, delete it, verify removed from database

#### F31: Use of Home Success Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** Successful save shows a success toast notification
- **Evidence:** Toast component appears with success variant
- **Test:** Save entry, verify success toast displayed

---

### Phase 4: Phone & Broadband Tab

#### F32: Phone & Broadband Cost List
- **Tag:** AUTO_VERIFY
- **Criterion:** The tab displays a table/list of existing Phone & Broadband costs with columns: Description, Monthly, Business %, Claimable
- **Evidence:** Table element with 4 data columns plus edit action
- **Test:** Query for table structure, verify columns present

#### F33: Phone & Broadband Add Button
- **Tag:** AUTO_VERIFY
- **Criterion:** An "+ Add Cost" button opens an add dialog
- **Evidence:** Button with "Add Cost" text; clicking opens dialog
- **Test:** Query for add button, click it, verify dialog opens

#### F34: Phone & Broadband Preset Dropdown
- **Tag:** AUTO_VERIFY
- **Criterion:** The add/edit dialog has a Description dropdown with exactly 3 options: "Mobile Phone", "Home Broadband", "Landline"
- **Evidence:** Select element with 3 options
- **Test:** Open dialog, query dropdown options, verify exactly 3 presets

#### F35: Phone & Broadband Monthly Cost Input
- **Tag:** AUTO_VERIFY
- **Criterion:** The dialog has a numeric input for Monthly Cost with £ prefix
- **Evidence:** Number input with currency formatting
- **Test:** Query for monthly cost input, verify accepts numeric values

#### F36: Phone & Broadband Business Percent Input
- **Tag:** AUTO_VERIFY
- **Criterion:** The dialog has a numeric input for Business Use % (1-100)
- **Evidence:** Number input with % suffix, min=1, max=100
- **Test:** Query for percentage input, verify range constraints

#### F37: Phone & Broadband Claimable Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** Dialog displays calculated "Claimable Amount" as monthlyCost × (businessPercent / 100)
- **Evidence:** Read-only display updates when inputs change
- **Test:** Enter £40 and 60%, verify £24.00 claimable shown

#### F38: Phone & Broadband Date Pickers
- **Tag:** AUTO_VERIFY
- **Criterion:** Dialog has month pickers for Start Date and End Date (with Ongoing option)
- **Evidence:** Two month picker components
- **Test:** Query for both date pickers

#### F39: Phone & Broadband Save Creates Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Save in dialog creates a phone_broadband entry in database
- **Evidence:** POST request; database contains row with cost_type='phone_broadband'
- **Test:** Fill dialog, save, verify database entry

#### F40: Phone & Broadband One Per Description
- **Tag:** AUTO_VERIFY
- **Criterion:** System prevents creating duplicate entries for same description with overlapping dates
- **Evidence:** Error when creating second "Mobile Phone" for overlapping period
- **Test:** Create Mobile Phone Apr-ongoing, attempt another Mobile Phone Jun-ongoing, verify error

#### F41: Phone & Broadband Edit Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking edit icon on a row opens dialog with that entry's values
- **Evidence:** Dialog populated with existing values; save updates entry
- **Test:** Create entry, click edit, verify values loaded, modify and save

#### F42: Phone & Broadband Delete Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** The edit dialog has a Delete button that removes the entry
- **Evidence:** Delete button in dialog; clicking removes entry
- **Test:** Open edit dialog, click delete, verify entry removed

#### F43: Phone & Broadband Total Display
- **Tag:** AUTO_VERIFY
- **Criterion:** Tab displays "Total Monthly Claimable" and "Annual Estimate" summing all active entries
- **Evidence:** Summary fields show sum of all claimable amounts
- **Test:** Add two entries, verify totals sum correctly

#### F44: Phone & Broadband Success Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** Successful save/delete shows a success toast notification
- **Evidence:** Toast component appears with success variant
- **Test:** Save entry, verify toast; delete entry, verify toast

---

### Phase 5: Insurance Tab

#### F45: Insurance Form Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Insurance tab has inputs for: Annual Premium, Business Stock Value, Total Contents Value
- **Evidence:** 3 numeric inputs with £ prefix and correct labels
- **Test:** Query for 3 input fields with expected names

#### F46: Insurance Business Proportion Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** "Business Proportion" displays as (businessStockValue / totalContentsValue × 100)%
- **Evidence:** Read-only percentage field auto-calculated
- **Test:** Enter £5,000 stock and £25,000 total, verify 20% shown

#### F47: Insurance Annual Claimable Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** "Annual Claimable" displays as annualPremium × businessPercent
- **Evidence:** Read-only field showing calculated value
- **Test:** Enter £240 premium, 20% proportion, verify £48.00 shown

#### F48: Insurance Monthly Equivalent Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** "Monthly Equivalent" displays as annualClaimable / 12
- **Evidence:** Read-only field showing monthly value
- **Test:** With £48 annual, verify £4.00 monthly shown

#### F49: Insurance Date Pickers
- **Tag:** AUTO_VERIFY
- **Criterion:** Insurance tab has month pickers for Start Date and End Date (with Ongoing option)
- **Evidence:** Two month picker components
- **Test:** Query for both date pickers

#### F50: Insurance Save Creates Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Save creates an insurance entry in database
- **Evidence:** POST request; database contains row with cost_type='insurance'
- **Test:** Fill form, save, verify database entry

#### F51: Insurance One Entry At A Time
- **Tag:** AUTO_VERIFY
- **Criterion:** System prevents creating insurance entry that overlaps with existing entry
- **Evidence:** Error when dates overlap existing insurance entry
- **Test:** Create Apr-Mar entry, attempt Jun-May entry, verify error

#### F52: Insurance Loads Existing Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** When user has existing Insurance entry, tab loads with saved values
- **Evidence:** All input fields populated with database values
- **Test:** Save entry, reopen modal, verify values loaded

#### F53: Insurance Edit Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** User can modify and re-save an existing Insurance entry
- **Evidence:** Change premium, save, reload, verify new value
- **Test:** Load existing, change value, save, verify persisted

#### F54: Insurance Delete Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** User can delete an existing Insurance entry via Delete button
- **Evidence:** Delete button exists; clicking removes entry
- **Test:** Create entry, delete it, verify removed

#### F55: Insurance Validation - Stock Less Than Total
- **Tag:** AUTO_VERIFY
- **Criterion:** Business Stock Value cannot exceed Total Contents Value
- **Evidence:** Validation error when stock > total
- **Test:** Enter £30,000 stock, £25,000 total, verify error

#### F56: Insurance Success Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** Successful save/delete shows a success toast notification
- **Evidence:** Toast component appears with success variant
- **Test:** Save entry, verify toast displayed

---

### Phase 6: Settings Tab

#### F57: Settings Display Mode Radio
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings tab has radio options: "Separate line items" and "Single consolidated line"
- **Evidence:** 2 radio inputs with correct labels
- **Test:** Query for radio inputs in Settings tab

#### F58: Settings Default Value
- **Tag:** AUTO_VERIFY
- **Criterion:** Default display_mode is "separate" for new users
- **Evidence:** First-time user sees "Separate line items" selected
- **Test:** Check settings for new user, verify separate is default

#### F59: Settings Save Persists Choice
- **Tag:** AUTO_VERIFY
- **Criterion:** Changing display mode and saving persists the choice
- **Evidence:** Change to consolidated, save, reload, verify consolidated still selected
- **Test:** Change setting, save, reopen modal, verify persisted

#### F60: Settings Success Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** Successful settings save shows a success toast notification
- **Evidence:** Toast component appears with success variant
- **Test:** Save settings, verify toast displayed

---

### Phase 7: P&L Integration

#### F61: Home Costs Included in P&L Calculation
- **Tag:** AUTO_VERIFY
- **Criterion:** Monthly P&L calculation includes applicable home costs based on date ranges
- **Evidence:** P&L expense total includes home costs for months within cost date ranges
- **Test:** Configure costs for Apr-Dec, verify Apr P&L includes them, Jan P&L excludes them

#### F62: Use of Home Monthly Amount Applied
- **Tag:** AUTO_VERIFY
- **Criterion:** P&L calculation applies the monthly rate (£10/£18/£26) for Use of Home
- **Evidence:** With 101+ hours selected, each month shows £26 for Use of Home
- **Test:** Configure 101+ hours, verify £26/month in P&L

#### F63: Phone & Broadband Claimable Applied
- **Tag:** AUTO_VERIFY
- **Criterion:** P&L calculation applies the calculated claimable amount for each active Phone & Broadband entry
- **Evidence:** £40 × 60% = £24/month appears in P&L
- **Test:** Configure cost, verify calculated amount in P&L

#### F64: Insurance Monthly Equivalent Applied
- **Tag:** AUTO_VERIFY
- **Criterion:** P&L calculation applies annualClaimable / 12 for Insurance
- **Evidence:** £48 annual = £4/month appears in P&L
- **Test:** Configure insurance, verify monthly equivalent in P&L

#### F65: Multiple Costs Sum Correctly
- **Tag:** AUTO_VERIFY
- **Criterion:** When multiple costs active, all are summed in P&L
- **Evidence:** Use of Home £26 + Phone £24 + Insurance £4 = £54 total
- **Test:** Configure all three types, verify sum in P&L

#### F66: Home Costs Section in P&L Report - Separate Mode
- **Tag:** AUTO_VERIFY
- **Criterion:** When display_mode='separate', P&L shows individual lines for Use of Home, Phone & Broadband, Insurance
- **Evidence:** 3 separate line items in Home Costs section
- **Test:** Set separate mode, verify 3 line items displayed

#### F67: Home Costs Section in P&L Report - Consolidated Mode
- **Tag:** AUTO_VERIFY
- **Criterion:** When display_mode='consolidated', P&L shows single "Home Costs" line with total
- **Evidence:** 1 line item showing combined total
- **Test:** Set consolidated mode, verify single line item

#### F68: Home Costs Section Position
- **Tag:** AUTO_VERIFY
- **Criterion:** Home Costs section appears at the end of the expenses section
- **Evidence:** Home Costs is the last expense category before totals
- **Test:** Check DOM order of expense sections

#### F69: P&L Shows Zero When No Costs
- **Tag:** AUTO_VERIFY
- **Criterion:** When no home costs configured, P&L still shows Home Costs section with £0.00
- **Evidence:** Section visible with zero values
- **Test:** Delete all costs, verify section shows with £0

#### F70: P&L Auto-Recalculates on Cost Change
- **Tag:** AUTO_VERIFY
- **Criterion:** Saving or deleting a home cost immediately updates the P&L display
- **Evidence:** P&L values update after modal save without page refresh
- **Test:** Change cost in modal, save, verify P&L updated

---

### Phase 8: Validation & Error Handling

#### E1: Validation Error Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** Validation errors (missing required fields, invalid values) show as toast notifications
- **Evidence:** Toast with error variant appears on validation failure
- **Test:** Submit form with missing required field, verify error toast

#### E2: Required Field Validation - Use of Home
- **Tag:** AUTO_VERIFY
- **Criterion:** Use of Home requires: hours tier selection, start date
- **Evidence:** Error toast when saving without required fields
- **Test:** Try to save without selecting tier, verify error

#### E3: Required Field Validation - Phone & Broadband
- **Tag:** AUTO_VERIFY
- **Criterion:** Phone & Broadband requires: description, monthly cost > 0, business percent 1-100, start date
- **Evidence:** Error toast when saving without required fields
- **Test:** Try to save with missing fields, verify error for each

#### E4: Required Field Validation - Insurance
- **Tag:** AUTO_VERIFY
- **Criterion:** Insurance requires: annual premium > 0, business stock value > 0, total contents value >= stock value, start date
- **Evidence:** Error toast when saving without required fields
- **Test:** Try to save with missing/invalid fields, verify errors

#### E5: API Error Handling
- **Tag:** AUTO_VERIFY
- **Criterion:** API errors (network failure, server error) show error toast with message
- **Evidence:** Toast with error variant on API failure
- **Test:** Mock API failure, verify error toast displayed

#### E6: Business Percent Range Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Business percent must be 1-100 for Phone & Broadband
- **Evidence:** Validation error for values outside range
- **Test:** Enter 0 and 101, verify both rejected

#### E7: Positive Number Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Monetary inputs (monthly cost, annual premium, stock values) must be positive
- **Evidence:** Validation error for zero or negative values
- **Test:** Enter 0 and -10, verify both rejected

#### E8: End Date After Start Date Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** End date must be >= start date when not "Ongoing"
- **Evidence:** Validation error when end date before start date
- **Test:** Set end date before start date, verify error

---

### Performance

#### P1: Modal Open Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** Modal opens and displays content within 200ms of button click
- **Evidence:** No perceptible delay when opening modal
- **Test:** Measure time from click to modal visible

#### P2: P&L Calculation Speed
- **Tag:** AUTO_VERIFY
- **Criterion:** P&L recalculation completes within 100ms after cost change
- **Evidence:** P&L updates immediately without visible delay
- **Test:** Save cost, measure time to P&L update

---

### UI/UX

#### U1: Shadcn UI Components
- **Tag:** AUTO_VERIFY
- **Criterion:** Modal, tabs, inputs, buttons, and toasts use shadcn/ui components
- **Evidence:** Component classes include shadcn patterns
- **Test:** Inspect DOM classes for shadcn styling

#### U2: Currency Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** All monetary values display with £ symbol and 2 decimal places
- **Evidence:** Values formatted as "£X.XX" or "£X,XXX.XX"
- **Test:** Verify all currency displays match format

#### U3: Percentage Formatting
- **Tag:** AUTO_VERIFY
- **Criterion:** Percentage values display with % symbol
- **Evidence:** Values show as "X%" or "X.X%"
- **Test:** Verify percentage displays include % symbol

#### U4: Month Picker Format
- **Tag:** AUTO_VERIFY
- **Criterion:** Month pickers display as "Month YYYY" format (e.g., "April 2024")
- **Evidence:** Picker shows month name and year
- **Test:** Open date picker, verify format

#### U5: Read-Only Calculated Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Calculated values (claimable amounts, percentages) are visually distinct and not editable
- **Evidence:** Different styling, not focusable
- **Test:** Attempt to edit calculated field, verify not editable

#### U6: Primary Button Styling
- **Tag:** AUTO_VERIFY
- **Criterion:** Home Costs button on P&L page uses primary button variant
- **Evidence:** Button has primary styling classes
- **Test:** Inspect button classes

---

## Out of Scope

- **QuickFile MTD Export integration** - separate future feature
- **Actual costs method** for Use of Home (mortgage interest, council tax, utilities)
- **Separate business insurance policies** (100% claimable)
- **Equipment / capital allowances**
- **Keyboard shortcuts** (Escape to close, Enter to save)
- **Loading skeleton** in modal (instantaneous load expected)
- **Backdrop click to close** modal

---

## Dependencies

- P&L report page exists at `/reports/profit-loss`
- Supabase database connection (cloud instance)
- User authentication working
- shadcn/ui components installed
- Toast notification system working

---

## Iteration Budget

- **Max iterations:** 5
- **Escalation:** If not converged after 5 iterations, pause for human review

---

## Verification Summary

| Category | Count |
|----------|-------|
| Functional | 70 |
| Error Handling | 8 |
| Performance | 2 |
| UI/UX | 6 |
| **Total** | **86** |

**All criteria are AUTO_VERIFY (86 AUTO_VERIFY, 0 HUMAN_VERIFY)**

---

## Handoff

Ready for: `/build-feature home-costs`

**Key files to be created:**
- `supabase/migrations/[timestamp]_home_costs_tables.sql` (new)
- `apps/web/app/api/home-costs/route.ts` (new)
- `apps/web/app/api/home-costs/[id]/route.ts` (new)
- `apps/web/app/api/home-costs/settings/route.ts` (new)
- `apps/web/components/features/home-costs/` (new directory)
  - `HomeCostsModal.tsx`
  - `UseOfHomeTab.tsx`
  - `PhoneBroadbandTab.tsx`
  - `InsuranceTab.tsx`
  - `SettingsTab.tsx`
- `apps/web/hooks/use-home-costs.ts` (new)
- Update: `apps/web/app/(dashboard)/reports/profit-loss/page.tsx`
- Update: P&L calculation logic to include home costs
