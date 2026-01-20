# Done Criteria: business-workflow (Phase 1)

**Created:** 2026-01-18
**Author:** Define Done Agent + Chris
**Status:** APPROVED

## Feature Summary

A daily workflow page that serves as the central operations hub for the LEGO resale business. Phase 1 delivers a prioritised task queue (system-generated and off-system tasks), critical actions panel showing orders with real dispatch SLA deadlines, inventory resolution status, and platform sync status. Tasks support start/complete/skip/defer actions with deep-links to relevant pages. The page follows the spec layout with Critical Actions at top, Task Queue below, and Completed Today section at bottom.

## Success Criteria

### Functional - Page & Navigation

#### F1: Workflow Page Exists at /workflow
- **Tag:** AUTO_VERIFY
- **Criterion:** Navigating to `/workflow` renders the workflow page without errors
- **Evidence:** HTTP 200 response, page component mounts successfully
- **Test:** `cy.visit('/workflow').should('have.status', 200)` and no console errors

#### F2: Workflow Page Accessible from Sidebar
- **Tag:** AUTO_VERIFY
- **Criterion:** Sidebar navigation includes a "Workflow" link that navigates to `/workflow`
- **Evidence:** DOM query finds sidebar link with href="/workflow"
- **Test:** `document.querySelector('nav a[href="/workflow"]') !== null`

#### F3: Page Layout Matches Spec Structure
- **Tag:** AUTO_VERIFY
- **Criterion:** Page renders three main sections in order: Critical Actions panel (top), Task Queue (middle), Completed Today (bottom)
- **Evidence:** DOM structure shows sections with data-testid attributes in correct order
- **Test:** `document.querySelectorAll('[data-testid="critical-actions"], [data-testid="task-queue"], [data-testid="completed-today"]')` returns 3 elements in correct document order

### Functional - Critical Actions Panel

#### F4: Orders to Dispatch Section Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical Actions panel includes "Orders to Dispatch" section showing pending orders grouped by platform
- **Evidence:** Section visible with platform groupings (eBay, Amazon, BrickLink, Brick Owl)
- **Test:** `document.querySelector('[data-testid="orders-to-dispatch"]')` exists with platform group elements

#### F5: Orders Show Dispatch Deadline Countdown
- **Tag:** AUTO_VERIFY
- **Criterion:** Each order displays a countdown timer showing time remaining until dispatch SLA deadline
- **Evidence:** Order cards include countdown element showing hours/minutes remaining
- **Test:** Order element contains `[data-testid="dispatch-countdown"]` with numeric time value

#### F6: eBay Orders Include Trading API SLA Deadline
- **Tag:** AUTO_VERIFY
- **Criterion:** eBay orders have `dispatch_by` timestamp populated from Trading API ShippingServiceOptions.ShippingTimeMax
- **Evidence:** Database `orders` table has `dispatch_by` column; eBay orders have non-null value
- **Test:** Query `SELECT dispatch_by FROM orders WHERE platform = 'ebay' AND status = 'paid'` returns non-null timestamps

#### F7: Amazon Orders Include SP-API SLA Deadline
- **Tag:** AUTO_VERIFY
- **Criterion:** Amazon orders have `dispatch_by` timestamp populated from SP-API LatestShipDate
- **Evidence:** Database `orders` table has `dispatch_by` column; Amazon orders have non-null value
- **Test:** Query `SELECT dispatch_by FROM orders WHERE platform = 'amazon' AND status = 'paid'` returns non-null timestamps

#### F8: Overdue Orders Highlighted in Red
- **Tag:** AUTO_VERIFY
- **Criterion:** Orders past their dispatch deadline are displayed in a separate "Overdue" section with red highlighting
- **Evidence:** Overdue orders have distinct visual treatment (red background/border)
- **Test:** Overdue order elements have CSS class indicating danger/error state

#### F9: Urgent Orders Highlighted in Amber
- **Tag:** AUTO_VERIFY
- **Criterion:** Orders within 2 hours of dispatch deadline are highlighted in amber
- **Evidence:** Urgent orders have amber/warning visual treatment
- **Test:** Orders with countdown < 2 hours have CSS class indicating warning state

#### F10: Generate Picking List Button Per Platform
- **Tag:** AUTO_VERIFY
- **Criterion:** Each platform group has a "Generate Picking List" button that links to existing picking list feature
- **Evidence:** Button visible in each platform group section
- **Test:** `document.querySelectorAll('[data-testid="generate-picking-list"]').length` equals number of platforms with orders

#### F11: Inventory Resolution Section Shows Pending Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical Actions panel shows count of items needing manual SKU/ASIN matching with link to resolution page
- **Evidence:** Section displays count and links to `/settings/inventory-resolution`
- **Test:** Element exists with count > 0 when unresolved items exist; link href is correct

#### F12: Platform Sync Status Grid Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Critical Actions panel shows sync status for all platforms (eBay, Amazon, BrickLink, Brick Owl, Monzo, PayPal) with last sync time
- **Evidence:** Grid shows 6 platforms with status indicators and timestamps
- **Test:** `document.querySelectorAll('[data-testid="platform-sync-status"] [data-platform]').length === 6`

#### F13: Sync Status Indicators Colour-Coded
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status shows green (recent <1hr), amber (stale 1-24hr), red (error or >24hr)
- **Evidence:** Status indicator colour matches sync age threshold
- **Test:** Platform with sync_at < 1 hour ago has green indicator class

#### F14: Sync All Platforms Button Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** A "Sync All Platforms" button triggers sync for all connected platforms with progress indicator
- **Evidence:** Button visible; clicking shows loading state; API calls fire for each platform
- **Test:** Click button, verify loading state appears and `/api/sync/*` endpoints called

### Functional - Task Queue

#### F15: Task Queue Displays Prioritised Tasks
- **Tag:** AUTO_VERIFY
- **Criterion:** Task queue shows tasks sorted by priority (Critical > Important > Regular > Low), then by due time within priority
- **Evidence:** Task list order matches priority sort algorithm
- **Test:** Extract task priorities from DOM; verify order is descending priority then ascending due time

#### F16: Tasks Show Dynamic Live Counts
- **Tag:** AUTO_VERIFY
- **Criterion:** Tasks with count_source display live count from database (e.g., "Process orders (7)")
- **Evidence:** Tasks with count_source have parenthetical count matching live data
- **Test:** Task "Process orders" shows count matching `SELECT COUNT(*) FROM orders WHERE status = 'paid'`

#### F17: All 20+ Spec System Tasks Seeded
- **Tag:** AUTO_VERIFY
- **Criterion:** workflow_task_definitions table is seeded with all system tasks from specification (Process orders, Sync platforms, Arbitrage AM, Arbitrage PM, List from backlog, Categorise Monzo, etc.)
- **Evidence:** Query returns at least 20 system task definitions
- **Test:** `SELECT COUNT(*) FROM workflow_task_definitions WHERE is_system = true` >= 20

#### F18: Task Card Shows Required Information
- **Tag:** AUTO_VERIFY
- **Criterion:** Each task card displays: priority indicator (coloured), icon, name, description, dynamic count (if applicable), estimated duration, due date/schedule
- **Evidence:** Task card contains all required data-testid elements with content
- **Test:** Task card contains `[data-testid="task-priority"]`, `[data-testid="task-name"]`, `[data-testid="task-duration"]`, `[data-testid="task-schedule"]`

#### F19: Task Start Action Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Start" on a task navigates to the deep-link URL with pre-applied filters
- **Evidence:** Navigation occurs to correct URL with query params from task definition
- **Test:** Click Start on "List from backlog" task; URL changes to `/inventory?status=BACKLOG`

#### F20: Task Complete Action Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Complete" marks task as completed, moves it to Completed Today section
- **Evidence:** Task status changes to 'completed' in database; task appears in Completed Today section
- **Test:** Click Complete; task disappears from queue; appears in Completed Today; database status = 'completed'

#### F21: Task Skip Action Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Skip" marks task as skipped for today; recurring tasks return tomorrow
- **Evidence:** Task status = 'skipped'; task removed from today's queue
- **Test:** Click Skip; task no longer visible in today's queue; status in DB is 'skipped'

#### F22: Task Defer Action Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking "Defer" opens date picker; selecting date reschedules task to that date
- **Evidence:** Date picker modal appears; after selection, task scheduled_date updates
- **Test:** Click Defer; select tomorrow; task scheduled_date in DB equals tomorrow

#### F23: Task Actions Buttons Visible on Each Task
- **Tag:** AUTO_VERIFY
- **Criterion:** Each task in queue shows Start, Complete, Skip, Defer action buttons
- **Evidence:** All four buttons visible on task card
- **Test:** Task card contains `button[data-action="start"]`, `button[data-action="complete"]`, `button[data-action="skip"]`, `button[data-action="defer"]`

### Functional - Off-System Tasks

#### F24: Add Task Dropdown Menu Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Task queue header has "Add Task" dropdown with options: Quick Add Task, Off-System Presets
- **Evidence:** Dropdown button visible with menu options
- **Test:** Click "Add Task" button; menu shows "Quick Add Task" and preset options

#### F25: Quick Add Task Dialog Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Quick Add Task opens dialog with fields: name, category, due date, time (optional), duration, priority, notes
- **Evidence:** Dialog form contains all required fields
- **Test:** All form fields present with correct input types

#### F26: Quick Add Task Creates Ad-Hoc Task
- **Tag:** AUTO_VERIFY
- **Criterion:** Submitting Quick Add form creates task instance in workflow_task_instances with task_type='off_system'
- **Evidence:** Database record created; task appears in queue
- **Test:** Submit form; query DB for new task; verify appears in queue

#### F27: Off-System Presets Seeded
- **Tag:** AUTO_VERIFY
- **Criterion:** off_system_task_presets table contains presets from spec: Manifest parcels, Post parcels, Photography session, Returns processing, Returns inspection, Packing supplies run, Storage organisation, Bank deposit, Auction attendance, Car boot sale
- **Evidence:** Query returns all 10 presets
- **Test:** `SELECT COUNT(*) FROM off_system_task_presets` = 10; all names match spec

#### F28: Preset Button Creates Task Instantly
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking a preset button (e.g., "Post parcels") immediately creates a task with preset values for today
- **Evidence:** Task created with preset name, category, duration, priority; scheduled for today
- **Test:** Click "Post parcels" preset; task appears in queue with correct values

### Functional - Completed Today Section

#### F29: Completed Today Section Shows Today's Completed Tasks
- **Tag:** AUTO_VERIFY
- **Criterion:** Completed Today section lists all tasks completed today with completion time and duration
- **Evidence:** Section shows tasks where completed_at is today
- **Test:** Complete a task; verify it appears in Completed Today section with timestamp

#### F30: Completed Today Shows Summary Line
- **Tag:** AUTO_VERIFY
- **Criterion:** Section header shows summary: total tasks completed, total time spent
- **Evidence:** Summary displays e.g., "5 tasks completed | 2h 45m total"
- **Test:** Summary element contains task count and time aggregation

#### F31: Completed Today Section is Collapsible
- **Tag:** AUTO_VERIFY
- **Criterion:** Completed Today section can be collapsed/expanded to save screen space
- **Evidence:** Toggle button collapses section; state persists
- **Test:** Click collapse; section content hidden; click expand; content visible

### Functional - Database Schema

#### F32: workflow_config Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table workflow_config exists with columns matching specification
- **Evidence:** Table exists with user_id, targets, notification preferences, working_days columns
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'workflow_config'` returns expected columns

#### F33: workflow_task_definitions Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table workflow_task_definitions exists with columns: id, user_id, name, description, category, icon, frequency, frequency_days, ideal_time, priority, estimated_minutes, deep_link_url, deep_link_params, count_source, task_type, is_active, is_system
- **Evidence:** Table exists with all required columns
- **Test:** Schema introspection returns all columns

#### F34: workflow_task_instances Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table workflow_task_instances exists with columns for tracking task execution: scheduled_date, status, started_at, completed_at, time_spent_seconds
- **Evidence:** Table exists with all required columns
- **Test:** Schema introspection returns all columns

#### F35: off_system_task_presets Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table off_system_task_presets exists with columns: id, user_id, name, icon, category, default_duration_minutes, default_priority
- **Evidence:** Table exists with required columns
- **Test:** Schema introspection returns all columns

#### F36: Orders Table Has dispatch_by Column
- **Tag:** AUTO_VERIFY
- **Criterion:** Orders table has dispatch_by TIMESTAMPTZ column for storing platform SLA deadlines
- **Evidence:** Column exists and accepts timestamp values
- **Test:** `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'dispatch_by'`

### Functional - API Endpoints

#### F37: GET /api/workflow/tasks/today Returns Today's Tasks
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint returns today's task queue with dynamic counts, sorted by priority then due time
- **Evidence:** Response contains array of tasks with all required fields including live counts
- **Test:** Fetch endpoint; verify response shape and sort order

#### F38: PATCH /api/workflow/tasks/:id Updates Task Status
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint updates task status (complete, skip, defer) and related timestamps
- **Evidence:** PATCH request updates database; returns updated task
- **Test:** PATCH with status='completed'; verify DB updated and response correct

#### F39: POST /api/workflow/tasks Creates Ad-Hoc Task
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint creates new task instance for off-system tasks
- **Evidence:** POST creates record; returns new task with ID
- **Test:** POST with task data; verify 201 response and DB record

#### F40: GET /api/orders/dispatch-deadlines Returns Orders with SLAs
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint returns pending orders with dispatch_by deadline, grouped by platform
- **Evidence:** Response contains orders with countdown-relevant data
- **Test:** Fetch endpoint; verify orders have dispatch_by and are grouped

#### F41: POST /api/sync/all Triggers Full Platform Sync
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint triggers sync for all platforms, returns progress/status
- **Evidence:** Endpoint calls individual platform sync services
- **Test:** POST to endpoint; verify sync jobs initiated for each platform

### Functional - Order Sync Integration

#### F42: eBay Order Sync Fetches ShippingTimeMax
- **Tag:** AUTO_VERIFY
- **Criterion:** eBay order sync extended to fetch ShippingServiceOptions.ShippingTimeMax from Trading API and store in dispatch_by
- **Evidence:** eBay sync service code queries shipping SLA; stores calculated deadline
- **Test:** After eBay sync, orders have dispatch_by populated from API response

#### F43: Amazon Order Sync Fetches LatestShipDate
- **Tag:** AUTO_VERIFY
- **Criterion:** Amazon order sync extended to fetch LatestShipDate from SP-API and store in dispatch_by
- **Evidence:** Amazon sync service code extracts LatestShipDate; stores in dispatch_by
- **Test:** After Amazon sync, orders have dispatch_by populated from API response

### Error Handling

#### E1: Partial Load on API Failure
- **Tag:** AUTO_VERIFY
- **Criterion:** If one section's API fails, other sections still load; failed section shows error with retry button
- **Evidence:** Page renders successfully even when one API errors; error state visible on failed section
- **Test:** Mock one API to fail; verify other sections render; failed section shows retry button

#### E2: Error Badge on Failed Section
- **Tag:** AUTO_VERIFY
- **Criterion:** Failed section displays error badge/icon with message explaining the failure
- **Evidence:** Error element visible with appropriate message
- **Test:** Force API error; verify error UI appears with message

#### E3: Retry Button Reloads Failed Section
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking retry on failed section re-fetches data without full page reload
- **Evidence:** Only affected section reloads; other sections maintain state
- **Test:** Click retry; verify only that section's API called; data loads

#### E4: Empty Task Queue Shows Helpful Message
- **Tag:** AUTO_VERIFY
- **Criterion:** If no tasks scheduled for today, queue shows "All caught up!" message with suggestion
- **Evidence:** Empty state message visible when task count is 0
- **Test:** With no tasks, verify empty state message appears

#### E5: Empty Orders Shows No Action Needed Message
- **Tag:** AUTO_VERIFY
- **Criterion:** If no orders pending dispatch, section shows "No orders awaiting dispatch" message
- **Evidence:** Empty state visible when order count is 0
- **Test:** With no pending orders, verify empty state message

#### E6: Sync Failure Shows Error Toast
- **Tag:** AUTO_VERIFY
- **Criterion:** If platform sync fails, toast notification shows which platform failed with error details
- **Evidence:** Toast appears with platform name and error message
- **Test:** Force sync failure; verify toast appears with correct content

### Performance

#### P1: Page Initial Load Under 10 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Workflow page reaches interactive state within 10 seconds on standard connection
- **Evidence:** Performance timing shows interactive < 10000ms
- **Test:** Measure time to interactive; verify < 10 seconds

#### P2: Task Queue Renders Within 3 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Task queue section renders with data within 3 seconds of page load
- **Evidence:** Task queue visible with tasks within 3 seconds
- **Test:** Measure time from navigation to task queue visible

#### P3: Dynamic Counts Load Progressively
- **Tag:** AUTO_VERIFY
- **Criterion:** Task list renders immediately; dynamic counts populate as APIs respond (progressive enhancement)
- **Evidence:** Tasks visible before all counts loaded; counts appear as fetched
- **Test:** Verify tasks render first; counts populate without blocking initial render

#### P4: Complete Action Response Under 1 Second
- **Tag:** AUTO_VERIFY
- **Criterion:** Marking task complete updates UI within 1 second (optimistic update)
- **Evidence:** Task moves to Completed Today within 1 second of click
- **Test:** Time from click to UI update < 1000ms

### UI/UX

#### U1: Uses shadcn/ui Components
- **Tag:** AUTO_VERIFY
- **Criterion:** Page uses shadcn/ui Button, Card, Badge, DropdownMenu, Dialog components
- **Evidence:** Components have shadcn/ui class patterns
- **Test:** Inspect DOM for shadcn/ui component classes

#### U2: Responsive at Mobile (375px)
- **Tag:** AUTO_VERIFY
- **Criterion:** Page layout adjusts appropriately at 375px viewport width
- **Evidence:** Content readable; no horizontal scroll; touch targets adequate
- **Test:** Set viewport to 375px; verify no overflow; elements accessible

#### U3: Responsive at Tablet (768px)
- **Tag:** AUTO_VERIFY
- **Criterion:** Page layout adjusts appropriately at 768px viewport width
- **Evidence:** Content uses available space; sections stack appropriately
- **Test:** Set viewport to 768px; verify layout adapts

#### U4: Responsive at Desktop (1024px+)
- **Tag:** AUTO_VERIFY
- **Criterion:** Page layout utilises full width at 1024px+ viewport
- **Evidence:** Layout uses available space efficiently
- **Test:** Set viewport to 1024px; verify layout expands

#### U5: Loading Skeletons on Initial Load
- **Tag:** AUTO_VERIFY
- **Criterion:** Each section shows loading skeleton while data fetches
- **Evidence:** Skeleton components visible before data loads
- **Test:** Verify skeleton elements present during loading state

#### U6: Priority Indicators Are Colour-Coded
- **Tag:** AUTO_VERIFY
- **Criterion:** Task priority indicators use consistent colours: Critical (red), Important (amber), Regular (green), Low (blue)
- **Evidence:** Priority badges have correct colour classes
- **Test:** Verify Critical tasks have red indicator; Important amber; etc.

#### U7: Deep Links Open in Same Tab
- **Tag:** AUTO_VERIFY
- **Criterion:** Task "Start" action navigates in same tab (not new tab)
- **Evidence:** Navigation uses router.push, not window.open
- **Test:** Click Start; verify no new tab opened; same tab navigates

#### U8: Keyboard Navigation Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Can navigate task queue and trigger actions using keyboard only
- **Evidence:** Tab navigation moves between tasks; Enter/Space triggers focused action
- **Test:** Tab through tasks; verify focus visible; Enter completes focused task

### Integration

#### I1: Task Deep Links Navigate to Correct Pages
- **Tag:** AUTO_VERIFY
- **Criterion:** Each system task's deep_link_url navigates to correct page with correct params
- **Evidence:** All 20+ task deep links resolve to valid routes
- **Test:** Iterate through task definitions; verify each deep_link_url is valid route

#### I2: Order Counts Match Orders Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Order count displayed in workflow matches count on Orders page with same filter
- **Evidence:** Workflow "Process orders (N)" count equals Orders page filtered count
- **Test:** Compare workflow order count to `/api/orders?status=paid` count

#### I3: Inventory Resolution Count Matches Settings Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Resolution count in workflow matches count on inventory resolution page
- **Evidence:** Counts are identical
- **Test:** Compare workflow resolution count to resolution page count

#### I4: Sync Status Reflects Actual Platform Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Sync status timestamps and indicators match actual last_synced_at from platform_sync_status
- **Evidence:** Displayed times match database records
- **Test:** Query platform_sync_status; compare to displayed values

## Out of Scope (Phase 1)

- Time tracking panel (Phase 2)
- Pomodoro timer (Phase 3)
- Weekly targets and metrics panel (Phase 4)
- Stock pickup calendar (Phase 5)
- Insights and opportunities panel (Phase 6)
- Settings/configuration screen (Phase 6)
- Push notifications (Phase 6)
- Time breakdown section (Phase 2)

## Dependencies

- Existing orders page and API
- Existing inventory resolution page
- Existing platform sync infrastructure
- eBay Trading API access (for ShippingServiceOptions)
- Amazon SP-API access (for LatestShipDate)
- Existing picking list feature

## Iteration Budget

- **Max iterations:** 7 (larger feature scope)
- **Escalation:** If not converged after 7 iterations, pause for human review

## Technical Notes

1. **SLA data fetched on order sync** - dispatch_by is populated when orders sync, not on page load
2. **Task instances generated daily** - Background job or on-demand generation of task instances from definitions
3. **Dynamic counts are read-only** - Live counts fetched from respective APIs; not editable
4. **Recurring task regeneration** - Skipped/completed recurring tasks regenerate for next scheduled occurrence
