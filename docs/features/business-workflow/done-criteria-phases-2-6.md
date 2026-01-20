# Done Criteria: business-workflow (Phases 2-6)

**Created:** 2026-01-18
**Author:** Define Done Agent + Chris
**Status:** APPROVED
**Depends On:** Phase 1 (done-criteria.md)

## Feature Summary

Phases 2-6 complete the Daily Workflow Page by adding: time tracking with category allocation and editable time log (Phase 2), pomodoro timer with work/break phases and streaks (Phase 3), weekly targets panel with platform listing inventory levels and daily flow metrics (Phase 4), stock pickup calendar with scheduling and completion flow (Phase 5), and insights panel with settings screen and push notifications (Phase 6). All phases ship together as a single release building on Phase 1.

---

## Phase 2: Time Tracking

### Functional - Time Tracking Panel

#### T1: Time Tracking Panel Exists in Header
- **Tag:** AUTO_VERIFY
- **Criterion:** Time tracking panel renders in the workflow page header bar with Start button and category selector
- **Evidence:** DOM query finds time tracking panel with data-testid="time-tracking-panel"
- **Test:** `document.querySelector('[data-testid="time-tracking-panel"]')` exists with Start button

#### T2: Category Dropdown Shows Six Options
- **Tag:** AUTO_VERIFY
- **Criterion:** Category dropdown contains: Development, Listing, Shipping, Sourcing, Admin, Other
- **Evidence:** Dropdown options match expected list
- **Test:** Open dropdown; verify 6 options with correct labels

#### T3: Start Button Begins Tracking
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Start with category selected creates time entry and shows elapsed time
- **Evidence:** Timer display shows incrementing time; API creates time_entries record
- **Test:** Click Start; verify timer shows 00:00:01 after 1 second; verify DB record created

#### T4: Running State Shows Pause and Stop Buttons
- **Tag:** AUTO_VERIFY
- **Criterion:** While tracking, panel shows Pause and Stop buttons instead of Start
- **Evidence:** Button state changes when timer is running
- **Test:** Start timer; verify Pause and Stop buttons visible; Start button hidden

#### T5: Pause Button Pauses Timer
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Pause freezes the elapsed time display; Resume continues from paused time
- **Evidence:** Timer stops incrementing; Resume restores incrementing
- **Test:** Start timer; wait 5s; Pause; wait 3s; verify display still shows ~5s; Resume; verify continues

#### T6: Stop Button Ends Session
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Stop ends the time entry, calculates duration, and returns to idle state
- **Evidence:** time_entries record updated with ended_at and duration_seconds
- **Test:** Start; wait; Stop; verify DB record has ended_at and correct duration

#### T7: Today's Total Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Panel shows "Today: Xh Ym" aggregating all completed entries for today
- **Evidence:** Displayed total matches sum of today's time_entries.duration_seconds
- **Test:** Complete 2 entries (30m, 45m); verify display shows "Today: 1h 15m"

#### T8: Week's Total Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Panel shows "Week: Xh Ym" aggregating all completed entries for current week
- **Evidence:** Displayed total matches sum of this week's time_entries.duration_seconds
- **Test:** Query week's entries; verify displayed total matches

### Functional - Time Entries Database

#### T9: time_entries Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table time_entries exists with columns: id, user_id, category, started_at, ended_at, duration_seconds, task_instance_id, notes, is_manual_entry
- **Evidence:** Schema introspection returns all columns
- **Test:** `SELECT column_name FROM information_schema.columns WHERE table_name = 'time_entries'`

#### T10: time_daily_summaries Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table time_daily_summaries exists with columns for per-category daily totals
- **Evidence:** Schema includes total_seconds, development_seconds, listing_seconds, etc.
- **Test:** Schema introspection returns expected columns

### Functional - Time Tracking API

#### T11: GET /api/time-tracking/current Returns Active Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint returns the currently running time entry, or null if none active
- **Evidence:** Response contains entry with started_at but no ended_at when active
- **Test:** Start timer; GET endpoint; verify response has active entry

#### T12: POST /api/time-tracking/start Creates Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint creates time entry with category and started_at timestamp
- **Evidence:** 201 response; database record created
- **Test:** POST with category="Listing"; verify 201 and DB record

#### T13: POST /api/time-tracking/stop Ends Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API endpoint sets ended_at, calculates duration_seconds, updates daily summary
- **Evidence:** Entry updated; daily summary incremented
- **Test:** Stop active entry; verify duration calculated; daily summary updated

#### T14: GET /api/time-tracking/entries Returns Paginated List
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns paginated time entries with optional date_from, date_to, category filters
- **Evidence:** Response includes entries array, total count, pagination info
- **Test:** Create 25 entries; GET with limit=10; verify pagination works

#### T15: POST /api/time-tracking/entries Creates Manual Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API creates manual time entry with is_manual_entry=true
- **Evidence:** Entry created with specified start/end times
- **Test:** POST with started_at, ended_at, category; verify is_manual_entry=true

#### T16: PATCH /api/time-tracking/entries/:id Updates Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API allows editing category, notes, started_at, ended_at of existing entry
- **Evidence:** Entry updated; duration recalculated if times changed
- **Test:** PATCH entry; verify changes saved

#### T17: DELETE /api/time-tracking/entries/:id Removes Entry
- **Tag:** AUTO_VERIFY
- **Criterion:** API soft-deletes or removes time entry; daily summary updated
- **Evidence:** Entry no longer returned in list; summary decremented
- **Test:** DELETE entry; verify removed from list

#### T18: GET /api/time-tracking/summary Returns Aggregates
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns daily and weekly totals per category
- **Evidence:** Response includes today_total, week_total, per-category breakdowns
- **Test:** Fetch summary; verify totals match time_daily_summaries

### Functional - Time Log Page

#### T19: Time Log Page Accessible at /time-tracking
- **Tag:** AUTO_VERIFY
- **Criterion:** Navigating to /time-tracking renders the time log page
- **Evidence:** HTTP 200; page component mounts
- **Test:** Visit /time-tracking; verify page renders

#### T20: Time Log Shows Entries Table
- **Tag:** AUTO_VERIFY
- **Criterion:** Page displays table with columns: Date, Start, End, Duration, Category, Notes, Actions
- **Evidence:** Table headers present; rows populated from API
- **Test:** Verify table structure and data

#### T21: Time Log Entries Are Editable
- **Tag:** AUTO_VERIFY
- **Criterion:** Each entry has Edit action that opens inline edit or modal; changes persist
- **Evidence:** Edit button visible; clicking opens edit UI; save updates record
- **Test:** Click Edit; change category; Save; verify DB updated

#### T22: Manual Entry Form Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** "Add Manual Entry" button opens form with date, start time, end time, category, notes
- **Evidence:** Form dialog opens; all fields present
- **Test:** Click Add Manual Entry; verify form fields

#### T23: Date Range Filter Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Date range picker filters entries to selected range
- **Evidence:** Changing dates updates displayed entries
- **Test:** Set date range; verify only entries within range shown

#### T24: Category Filter Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Category dropdown filters entries to selected category
- **Evidence:** Selecting category updates displayed entries
- **Test:** Filter by "Listing"; verify only Listing entries shown

### Functional - Time Breakdown Section

#### T25: Time Breakdown Section Renders on Workflow Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Time Breakdown section shows at bottom of workflow page with today vs this week comparison
- **Evidence:** Section visible with data-testid="time-breakdown"
- **Test:** `document.querySelector('[data-testid="time-breakdown"]')` exists

#### T26: Bar Chart Shows Time Per Category
- **Tag:** AUTO_VERIFY
- **Criterion:** Horizontal bar chart displays time allocation per category for today and this week
- **Evidence:** Chart renders with category labels and proportional bars
- **Test:** Verify chart element exists; verify category data displayed

#### T27: Category Legend With Totals
- **Tag:** AUTO_VERIFY
- **Criterion:** Legend shows each category with colour and total time
- **Evidence:** Legend items match categories with formatted durations
- **Test:** Verify legend displays all categories with times

#### T28: Link to Full Time Log
- **Tag:** AUTO_VERIFY
- **Criterion:** "View full log" link navigates to /time-tracking
- **Evidence:** Link href="/time-tracking"
- **Test:** Click link; verify navigation to time log page

### Error Handling - Time Tracking

#### T29: Starting Timer While One Running Shows Message
- **Tag:** AUTO_VERIFY
- **Criterion:** Attempting to start when already tracking shows "Already tracking time" toast
- **Evidence:** Toast appears; no duplicate entry created
- **Test:** Start timer; click Start again; verify toast shown

#### T30: Stopping With No Active Entry Shows Error
- **Tag:** AUTO_VERIFY
- **Criterion:** POST /api/time-tracking/stop with no active entry returns 400 error
- **Evidence:** API returns error response
- **Test:** With no active entry, POST stop; verify 400 response

### Performance - Time Tracking

#### T31: Timer UI Updates Every Second
- **Tag:** AUTO_VERIFY
- **Criterion:** Running timer display updates every second without UI jank or memory leaks
- **Evidence:** Timer increments smoothly; no performance warnings
- **Test:** Run timer for 60 seconds; verify smooth updates; check memory stable

### UI/UX - Time Tracking

#### T32: Time Tracking Uses shadcn/ui Components
- **Tag:** AUTO_VERIFY
- **Criterion:** Panel uses shadcn/ui Button, Select, Card components
- **Evidence:** Components have shadcn class patterns
- **Test:** Inspect DOM for shadcn component classes

#### T33: Time Log Responsive at Mobile (375px)
- **Tag:** AUTO_VERIFY
- **Criterion:** Time log page layout adapts at 375px viewport
- **Evidence:** Table scrolls horizontally or cards stack; content readable
- **Test:** Set viewport to 375px; verify usable layout

---

## Phase 3: Pomodoro Timer

### Functional - Pomodoro Panel

#### P1: Pomodoro Panel Exists in Header
- **Tag:** AUTO_VERIFY
- **Criterion:** Pomodoro panel renders in header bar next to time tracking panel
- **Evidence:** DOM query finds panel with data-testid="pomodoro-panel"
- **Test:** `document.querySelector('[data-testid="pomodoro-panel"]')` exists

#### P2: Mode Selector Shows Three Options
- **Tag:** AUTO_VERIFY
- **Criterion:** Mode selector offers: Classic (25/5), Long (50/10), Custom
- **Evidence:** Three mode options visible in selector
- **Test:** Open mode selector; verify 3 options with correct labels

#### P3: Start Button Begins Work Phase
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Start begins countdown from work duration (default 25:00 for Classic)
- **Evidence:** Timer shows countdown; session created in database
- **Test:** Click Start; verify countdown begins at 25:00; verify DB record

#### P4: Visual Progress Indicator Shows Time Remaining
- **Tag:** AUTO_VERIFY
- **Criterion:** Circular or bar progress indicator shows percentage/time remaining
- **Evidence:** Progress element visible and updates with countdown
- **Test:** Verify progress indicator shows decreasing value

#### P5: Pause Button Pauses Countdown
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Pause freezes countdown; Resume continues
- **Evidence:** Countdown stops; resume restores countdown
- **Test:** Start; Pause at 24:00; wait 5s; verify still shows 24:00; Resume

#### P6: Work Phase Complete Transitions to Break
- **Tag:** AUTO_VERIFY
- **Criterion:** When work countdown reaches 0, automatically transitions to break phase
- **Evidence:** Status changes to 'break'; countdown resets to break duration
- **Test:** Start short custom session (5s work); verify transitions to break

#### P7: Break Phase Shows Skip Break Option
- **Tag:** AUTO_VERIFY
- **Criterion:** During break phase, "Skip Break" button is visible
- **Evidence:** Skip Break button appears only during break phase
- **Test:** Enter break phase; verify Skip Break button visible

#### P8: Skip Break Completes Session
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking Skip Break marks session complete and returns to idle
- **Evidence:** Session status='completed'; UI returns to idle state
- **Test:** Enter break; click Skip Break; verify session completed

#### P9: Session Counter Shows Progress
- **Tag:** AUTO_VERIFY
- **Criterion:** Display shows "Session X of Y" (Y from daily target in config)
- **Evidence:** Counter visible showing completed sessions vs target
- **Test:** Complete 2 sessions; verify shows "Session 2 of 8" (default target)

#### P10: Daily Streak Tracking Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Streak count shows consecutive days with at least 1 completed session
- **Evidence:** Streak number visible; updates daily
- **Test:** Complete sessions on consecutive days; verify streak increments

#### P11: Audio Notification on Work Complete
- **Tag:** AUTO_VERIFY
- **Criterion:** Configurable audio plays when work phase completes
- **Evidence:** Audio element triggered; respects user preference
- **Test:** Enable audio in settings; complete work phase; verify sound plays

#### P12: Audio Notification on Break Complete
- **Tag:** AUTO_VERIFY
- **Criterion:** Configurable audio plays when break phase completes
- **Evidence:** Audio element triggered for break completion
- **Test:** Enable audio; complete break phase; verify sound plays

### Functional - Pomodoro Database & API

#### P13: pomodoro_sessions Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table pomodoro_sessions exists with: id, user_id, session_date, session_number, mode, work_minutes, break_minutes, started_at, work_completed_at, break_completed_at, status
- **Evidence:** Schema introspection returns all columns
- **Test:** Query information_schema for table columns

#### P14: POST /api/pomodoro/start Creates Session
- **Tag:** AUTO_VERIFY
- **Criterion:** API creates pomodoro session with mode and durations
- **Evidence:** 201 response; database record with status='work'
- **Test:** POST with mode='classic'; verify session created

#### P15: POST /api/pomodoro/complete-phase Transitions Phase
- **Tag:** AUTO_VERIFY
- **Criterion:** API transitions work→break (sets work_completed_at) or break→complete (sets break_completed_at, status='completed')
- **Evidence:** Session record updated with timestamps
- **Test:** Complete work phase; verify work_completed_at set; status='break'

#### P16: POST /api/pomodoro/cancel Ends Session
- **Tag:** AUTO_VERIFY
- **Criterion:** API sets status='cancelled' and returns to idle
- **Evidence:** Session status updated to cancelled
- **Test:** Start session; cancel; verify status='cancelled'

#### P17: GET /api/pomodoro/stats Returns Daily and Streak
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns today's completed count, daily target, and current streak
- **Evidence:** Response includes sessions_today, daily_target, streak_days
- **Test:** Complete 3 sessions; verify stats show 3 today

#### P18: GET /api/pomodoro/current Returns Active Session
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns currently active pomodoro session or null
- **Evidence:** Response contains session with status='work' or 'break' when active
- **Test:** Start session; GET current; verify active session returned

### Error Handling - Pomodoro

#### P19: Starting While Active Shows Message
- **Tag:** AUTO_VERIFY
- **Criterion:** Starting pomodoro while one is active shows "Session already in progress" toast
- **Evidence:** Toast appears; no duplicate session created
- **Test:** Start session; click Start again; verify toast

### Performance - Pomodoro

#### P20: Countdown Updates Smoothly
- **Tag:** AUTO_VERIFY
- **Criterion:** Timer countdown updates every second without jank
- **Evidence:** Visual countdown decrements smoothly
- **Test:** Observe countdown for 30 seconds; verify smooth updates

### UI/UX - Pomodoro

#### P21: Progress Indicator Visible
- **Tag:** AUTO_VERIFY
- **Criterion:** Circular or bar progress indicator shows visual completion percentage
- **Evidence:** Progress element visible during active session
- **Test:** Verify progress indicator renders and updates

#### P22: End Session Button Visible During Active
- **Tag:** AUTO_VERIFY
- **Criterion:** End/Cancel button visible during active session to abort early
- **Evidence:** End button present during work and break phases
- **Test:** Start session; verify End button visible

---

## Phase 4: Weekly Targets & Metrics

### Functional - Targets Panel

#### M1: Weekly Targets Panel Renders on Workflow Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Weekly Targets & Metrics panel renders between header and Critical Actions
- **Evidence:** Panel visible with data-testid="weekly-targets-panel"
- **Test:** `document.querySelector('[data-testid="weekly-targets-panel"]')` exists

#### M2: eBay Active Listings Shows Current vs Target
- **Tag:** AUTO_VERIFY
- **Criterion:** eBay metric shows current active listing count and target (default 500)
- **Evidence:** Display shows "X / 500" or similar format
- **Test:** Verify eBay listing count displayed against target

#### M3: Amazon Active Listings Shows Current vs Target
- **Tag:** AUTO_VERIFY
- **Criterion:** Amazon metric shows current active listing count and target (default 250)
- **Evidence:** Display shows "X / 250" or similar format
- **Test:** Verify Amazon listing count displayed against target

#### M4: BrickLink Weekly Value Shows Progress
- **Tag:** AUTO_VERIFY
- **Criterion:** BrickLink metric shows value uploaded this week vs target (default £1,000)
- **Evidence:** Display shows "£X / £1,000" with progress
- **Test:** Verify BrickLink weekly value displayed

#### M5: Daily Listing Value Shows Today's Progress
- **Tag:** AUTO_VERIFY
- **Criterion:** Daily Listing metric shows today's listed value vs target (default £300)
- **Evidence:** Display shows "£X / £300" for today
- **Test:** Verify daily listing value displayed

#### M6: Daily Sold Value Shows Today's Progress
- **Tag:** AUTO_VERIFY
- **Criterion:** Daily Sold metric shows today's sold value vs target (default £250)
- **Evidence:** Display shows "£X / £250" for today
- **Test:** Verify daily sold value displayed

#### M7: Progress Bars Show Percentage
- **Tag:** AUTO_VERIFY
- **Criterion:** Each metric has a progress bar showing percentage toward target
- **Evidence:** Progress bar elements visible with width proportional to completion
- **Test:** Metric at 50% shows progress bar at ~50% width

#### M8: Sparkline Charts Show 7-Day Trend
- **Tag:** AUTO_VERIFY
- **Criterion:** Each metric displays a sparkline showing last 7 days of data
- **Evidence:** Sparkline SVG/canvas elements render with 7 data points
- **Test:** Verify sparkline elements present with trend data

#### M9: Week-to-Date Aggregates Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Panel shows week totals: total listed value, total sold value this week
- **Evidence:** WTD summary section visible with aggregated values
- **Test:** Verify week totals displayed

#### M10: Gap to Target Clearly Displayed
- **Tag:** AUTO_VERIFY
- **Criterion:** Each metric shows gap (e.g., "50 to go" or "+25 ahead")
- **Evidence:** Gap text visible next to each metric
- **Test:** Verify gap calculation displayed for each target

### Functional - Metrics API

#### M11: GET /api/inventory/listing-counts Returns Platform Counts
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns active listing counts per platform (eBay, Amazon, BrickLink)
- **Evidence:** Response includes counts for each platform
- **Test:** Fetch endpoint; verify platform counts in response

#### M12: GET /api/workflow/metrics Returns All Target Data
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns current values, targets, and historical data for all metrics
- **Evidence:** Response includes ebay_listings, amazon_listings, bricklink_weekly, daily_listed, daily_sold with actuals, targets, and history
- **Test:** Fetch endpoint; verify complete metrics response

#### M13: workflow_config Stores Configurable Targets
- **Tag:** AUTO_VERIFY
- **Criterion:** User's custom targets stored in workflow_config table (target_ebay_listings, target_amazon_listings, etc.)
- **Evidence:** Targets can be updated and retrieved from config
- **Test:** Update target via API; verify stored in workflow_config

### Error Handling - Metrics

#### M14: Missing Platform Data Shows Error State
- **Tag:** AUTO_VERIFY
- **Criterion:** If platform data unavailable, metric shows placeholder with "Unable to load" message
- **Evidence:** Error state visible instead of metric value
- **Test:** Mock platform API failure; verify error state shown

### Performance - Metrics

#### M15: Metrics Load Within 3 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** All metrics populated within 3 seconds of page load
- **Evidence:** Metrics visible without skeleton within 3 seconds
- **Test:** Measure time to metrics display; verify < 3000ms

### UI/UX - Metrics

#### M16: Colour Coding Indicates Status
- **Tag:** AUTO_VERIFY
- **Criterion:** Metrics use colour: green (on track ≥80%), amber (behind 50-79%), red (significantly behind <50%)
- **Evidence:** Progress bars and text use appropriate colour classes
- **Test:** Metric at 90% has green styling; at 60% has amber; at 30% has red

#### M17: Metrics Panel Responsive
- **Tag:** AUTO_VERIFY
- **Criterion:** Panel layout adapts at mobile (375px) - metrics stack or scroll
- **Evidence:** Content usable at mobile viewport
- **Test:** Set viewport to 375px; verify metrics accessible

---

## Phase 5: Stock Pickups & Off-System Tasks

### Functional - Pickup Calendar Panel

#### K1: Pickup Calendar Panel Renders on Workflow Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Pickup Calendar panel renders alongside Task Queue
- **Evidence:** Panel visible with data-testid="pickup-calendar"
- **Test:** `document.querySelector('[data-testid="pickup-calendar"]')` exists

#### K2: Mini Calendar Shows Current Month
- **Tag:** AUTO_VERIFY
- **Criterion:** Calendar displays current month with day grid and navigation arrows
- **Evidence:** Month name, day numbers, and prev/next buttons visible
- **Test:** Verify calendar renders current month; navigation works

#### K3: Today Highlighted in Calendar
- **Tag:** AUTO_VERIFY
- **Criterion:** Today's date has distinct visual highlighting
- **Evidence:** Today's cell has highlight class
- **Test:** Verify today's date cell has distinct styling

#### K4: Days With Pickups Show Icon
- **Tag:** AUTO_VERIFY
- **Criterion:** Days with scheduled pickups display car icon (🚗) or indicator dot
- **Evidence:** Calendar day cells with pickups have icon element
- **Test:** Schedule pickup; verify day shows icon in calendar

#### K5: Clicking Day Shows Pickups or Opens Add Dialog
- **Tag:** AUTO_VERIFY
- **Criterion:** Clicking a day with pickups shows details; clicking empty day opens scheduling
- **Evidence:** Day click triggers appropriate modal/panel
- **Test:** Click day with pickup; verify details shown. Click empty day; verify add dialog opens

#### K6: Upcoming Pickups List Shows Next 7 Days
- **Tag:** AUTO_VERIFY
- **Criterion:** List below calendar shows pickups scheduled within next 7 days
- **Evidence:** List displays pickups with dates within range
- **Test:** Schedule pickups for next 3 days; verify all appear in list

#### K7: GET /api/pickups/calendar Returns Month Data
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns pickups for specified month grouped by date
- **Evidence:** Response includes pickups array with scheduled_date grouping
- **Test:** Fetch /api/pickups/calendar?month=2026-01; verify response structure

### Functional - Pickup Scheduling

#### K8: Schedule Pickup Opens from Add Task Dropdown
- **Tag:** AUTO_VERIFY
- **Criterion:** "Schedule Pickup" option in Add Task dropdown opens scheduling dialog
- **Evidence:** Clicking option opens SchedulePickupDialog component
- **Test:** Open dropdown; click Schedule Pickup; verify dialog opens

#### K9: Dialog Has Two-Panel Layout
- **Tag:** AUTO_VERIFY
- **Criterion:** Schedule dialog shows details form (left) and calendar preview (right)
- **Evidence:** Two-panel layout visible in dialog
- **Test:** Verify dialog contains form panel and calendar panel

#### K10: Required Fields Validated
- **Tag:** AUTO_VERIFY
- **Criterion:** Title/Seller, Address Line 1, City, Postcode, Scheduled Date are required
- **Evidence:** Form shows validation errors if required fields empty
- **Test:** Submit empty form; verify validation errors on required fields

#### K11: Optional Fields Available
- **Tag:** AUTO_VERIFY
- **Criterion:** Source Platform, Address Line 2, Description, Agreed Price, Estimated Value, Time, Duration, Notes fields available
- **Evidence:** All optional fields present in form
- **Test:** Verify all optional fields render

#### K12: Source Platform Dropdown Options
- **Tag:** AUTO_VERIFY
- **Criterion:** Source Platform dropdown includes: FB Marketplace, Gumtree, eBay, Car Boot, Auction, Private, Other
- **Evidence:** Dropdown contains all platform options
- **Test:** Open dropdown; verify 7 source platform options

#### K13: Reminder Checkbox Works
- **Tag:** AUTO_VERIFY
- **Criterion:** "Create reminder 1 day before" checkbox creates reminder when checked
- **Evidence:** Pickup saved with reminder_day_before=true when checked
- **Test:** Check reminder; save; verify reminder_day_before=true in DB

#### K14: Save Draft Creates Draft Pickup
- **Tag:** AUTO_VERIFY
- **Criterion:** "Save Draft" button creates pickup with status='draft'
- **Evidence:** Pickup record created with draft status
- **Test:** Fill form; click Save Draft; verify status='draft'

#### K15: Schedule Creates Confirmed Pickup
- **Tag:** AUTO_VERIFY
- **Criterion:** "Schedule" button creates pickup with status='scheduled'
- **Evidence:** Pickup record created with scheduled status; appears in calendar
- **Test:** Fill form; click Schedule; verify status='scheduled'; appears in calendar

#### K16: stock_pickups Table Exists
- **Tag:** AUTO_VERIFY
- **Criterion:** Table stock_pickups exists with all required columns (id, user_id, title, source_platform, address fields, scheduled_date, status, completion fields, etc.)
- **Evidence:** Schema introspection returns all columns
- **Test:** Query information_schema for stock_pickups columns

#### K17: POST /api/pickups Creates Pickup
- **Tag:** AUTO_VERIFY
- **Criterion:** API creates pickup record and returns created pickup
- **Evidence:** 201 response; database record created
- **Test:** POST with pickup data; verify 201 and DB record

#### K18: Pickup Appears in Task Queue on Scheduled Date
- **Tag:** AUTO_VERIFY
- **Criterion:** Scheduled pickup creates task instance for its scheduled date
- **Evidence:** Task queue on scheduled date includes pickup task
- **Test:** Schedule pickup for today; verify appears in task queue

### Functional - Pickup Completion

#### K19: Complete Pickup Dialog Opens from Task Actions
- **Tag:** AUTO_VERIFY
- **Criterion:** Task action "Complete" on pickup task opens completion dialog
- **Evidence:** CompletedPickupDialog component opens
- **Test:** Click Complete on pickup task; verify dialog opens

#### K20: Outcome Selector Shows Three Options
- **Tag:** AUTO_VERIFY
- **Criterion:** Outcome selector: Completed successfully, Partially completed, Cancelled/No-show
- **Evidence:** Three outcome options in selector
- **Test:** Verify three outcome options available

#### K21: Completed Outcome Prompts for Details
- **Tag:** AUTO_VERIFY
- **Criterion:** Selecting "Completed" shows: Final amount paid, Mileage (miles), Notes fields
- **Evidence:** Additional fields appear for completed outcome
- **Test:** Select Completed; verify final amount, mileage, notes fields appear

#### K22: Mileage Auto-Calculates Cost
- **Tag:** AUTO_VERIFY
- **Criterion:** Entering mileage calculates cost at 45p/mile (displayed as £X.XX)
- **Evidence:** Mileage cost updates as mileage entered
- **Test:** Enter 20 miles; verify cost shows £9.00

#### K23: Create Purchase Option Available
- **Tag:** AUTO_VERIFY
- **Criterion:** "Create Purchase record" checkbox/option pre-fills purchase from pickup data
- **Evidence:** Option visible; selecting navigates to purchase creation with pre-filled data
- **Test:** Check option; complete; verify redirect to purchase creation with data

#### K24: POST /api/pickups/:id/complete Updates Status
- **Tag:** AUTO_VERIFY
- **Criterion:** API updates pickup with outcome, final_amount_paid, mileage, mileage_cost, completed_at
- **Evidence:** Pickup record updated with completion data
- **Test:** POST complete with outcome data; verify DB updated

#### K25: Cancelled/No-show Updates Status Only
- **Tag:** AUTO_VERIFY
- **Criterion:** Cancelled outcome sets status without requiring amount/mileage
- **Evidence:** Pickup status='cancelled' or 'no_show'; no amount required
- **Test:** Complete as no-show; verify status updated; no amount required

### Functional - Recurring Pickups

#### K26: Recurring Option Available in Schedule Dialog
- **Tag:** AUTO_VERIFY
- **Criterion:** "Make recurring" toggle with pattern selector (Weekly, Biweekly, Monthly)
- **Evidence:** Recurring toggle and pattern dropdown visible
- **Test:** Verify recurring options in schedule dialog

#### K27: Recurring Pickups Generate Future Instances
- **Tag:** AUTO_VERIFY
- **Criterion:** Creating weekly recurring pickup generates instances for future weeks
- **Evidence:** Multiple pickup records created with parent_pickup_id reference
- **Test:** Create weekly recurring; verify 4+ future instances created

### Functional - Off-System Tasks Enhanced

#### K28: Quick Add Task Dialog Enhanced
- **Tag:** AUTO_VERIFY
- **Criterion:** Quick Add dialog includes: name, category, due date, time, duration, priority, notes
- **Evidence:** All fields present in dialog form
- **Test:** Verify Quick Add form has all specified fields

#### K29: Due Date Options Available
- **Tag:** AUTO_VERIFY
- **Criterion:** Due date selector includes: Today, Tomorrow, This week, Next week, Specific date
- **Evidence:** Date selector with quick options and calendar
- **Test:** Verify due date options available

#### K30: Quick-Add Preset Buttons Shown
- **Tag:** AUTO_VERIFY
- **Criterion:** Preset buttons (Manifest parcels, Post parcels, etc.) visible in Add Task dropdown or dialog
- **Evidence:** Preset buttons render from off_system_task_presets
- **Test:** Verify preset buttons visible; clicking creates task

### Error Handling - Pickups

#### K31: Missing Required Fields Shows Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Submitting schedule form with missing required fields shows field-level errors
- **Evidence:** Validation errors appear on empty required fields
- **Test:** Submit incomplete form; verify validation errors

#### K32: Pickup Not Found Returns 404
- **Tag:** AUTO_VERIFY
- **Criterion:** GET /api/pickups/:id with invalid ID returns 404
- **Evidence:** API returns 404 status
- **Test:** GET non-existent pickup ID; verify 404

### Performance - Pickups

#### K33: Calendar Renders Within 2 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Pickup calendar component renders within 2 seconds
- **Evidence:** Calendar visible within 2 seconds of page load
- **Test:** Measure time to calendar render; verify < 2000ms

### UI/UX - Pickups

#### K34: Open in Google Maps Link Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Pickup card/details has "Open in Maps" link that opens Google Maps with address
- **Evidence:** Link opens maps.google.com with encoded address
- **Test:** Click link; verify Google Maps opens with pickup address

#### K35: Pickup Cards Show Key Info
- **Tag:** AUTO_VERIFY
- **Criterion:** Pickup list items show: title, location (city/postcode), agreed price, estimated value, potential profit
- **Evidence:** All info visible on pickup cards
- **Test:** Verify pickup card displays all key information

---

## Phase 6: Insights, Settings & Notifications

### Functional - Insights Panel

#### I1: Insights Panel Renders on Workflow Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Insights & Opportunities panel renders between Pickup Calendar and Completed Today
- **Evidence:** Panel visible with data-testid="insights-panel"
- **Test:** `document.querySelector('[data-testid="insights-panel"]')` exists

#### I2: Inventory Health Section Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Section shows: items hitting 90 days today (count + link), items over 91 days (count + value + link), items in Not Yet Received status
- **Evidence:** Three inventory health metrics visible
- **Test:** Verify inventory health section with all three metrics

#### I3: Pricing & Competition Section Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Section shows: Buy Box lost count, listings below target margin count, arbitrage opportunities above threshold count
- **Evidence:** Three pricing metrics visible with links
- **Test:** Verify pricing section with all metrics

#### I4: Listing Engagement Section Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Section shows: eBay listings with watchers count, refresh-eligible count, low-score listings count
- **Evidence:** Three engagement metrics visible
- **Test:** Verify engagement section with all metrics

#### I5: Financial Snapshot Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Section shows: MTD Revenue (vs last month), MTD Profit (vs last month), profit margin vs target
- **Evidence:** Financial metrics with month comparison
- **Test:** Verify financial snapshot with comparisons

#### I6: Platform Health Section Displays
- **Tag:** AUTO_VERIFY
- **Criterion:** Section shows: connection status per platform, stale sync warnings, token expiry warnings (within 7 days)
- **Evidence:** Platform health indicators visible
- **Test:** Verify platform health section with all indicators

#### I7: Each Insight Links to Relevant Page
- **Tag:** AUTO_VERIFY
- **Criterion:** Each insight/alert has clickable link navigating to the relevant feature page
- **Evidence:** Links have correct hrefs to feature pages
- **Test:** Verify insight links navigate to correct pages

#### I8: GET /api/workflow/insights Returns Aggregated Data
- **Tag:** AUTO_VERIFY
- **Criterion:** API returns all insight metrics in single response
- **Evidence:** Response includes inventory_health, pricing, engagement, financial, platform_health objects
- **Test:** Fetch endpoint; verify complete insights response

### Functional - Settings Screen

#### S1: Settings Accessible via Header Icon
- **Tag:** AUTO_VERIFY
- **Criterion:** Gear icon (⚙) in header opens settings screen/modal
- **Evidence:** Clicking gear icon opens settings UI
- **Test:** Click gear icon; verify settings opens

#### S2: Settings Has Tabbed Interface
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings screen has tabs: Targets, Tasks, Time Tracking, Notifications
- **Evidence:** Four tabs visible and navigable
- **Test:** Verify four tabs; clicking each shows correct content

#### S3: Targets Tab - Listing Targets Editable
- **Tag:** AUTO_VERIFY
- **Criterion:** Can edit: eBay Active Listings target, Amazon Active Listings target, BrickLink Weekly Value target
- **Evidence:** Input fields for each target; changes persist
- **Test:** Edit eBay target to 600; save; verify persisted

#### S4: Targets Tab - Flow Targets Editable
- **Tag:** AUTO_VERIFY
- **Criterion:** Can edit: Daily Listing Value target, Daily Sold Value target
- **Evidence:** Input fields for flow targets
- **Test:** Edit daily listing target; save; verify persisted

#### S5: Targets Tab - Working Days Editable
- **Tag:** AUTO_VERIFY
- **Criterion:** Checkboxes for Mon-Sun to configure working days
- **Evidence:** 7 checkboxes; changes saved to working_days bitmask
- **Test:** Uncheck Sunday; save; verify working_days updated

#### S6: Tasks Tab - Definitions Table Shows All Tasks
- **Tag:** AUTO_VERIFY
- **Criterion:** Table displays all workflow_task_definitions with columns: Task, Category, Frequency, Priority, Actions
- **Evidence:** Table populated with task definitions
- **Test:** Verify table shows all seeded system tasks

#### S7: Tasks Tab - Add Task Definition Works
- **Tag:** AUTO_VERIFY
- **Criterion:** "Add Task" button opens form; completing form creates new definition
- **Evidence:** New task appears in table after creation
- **Test:** Add new task via form; verify appears in table

#### S8: Tasks Tab - Edit Task Definition Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Edit action opens form with existing values; changes persist
- **Evidence:** Edit form pre-filled; updates save correctly
- **Test:** Edit task name; save; verify name updated

#### S9: Tasks Tab - Delete Task Definition Works
- **Tag:** AUTO_VERIFY
- **Criterion:** Delete action removes task definition (with confirmation)
- **Evidence:** Task removed from table after deletion
- **Test:** Delete task; verify removed from table

#### S10: Tasks Tab - Task Edit Modal Fields
- **Tag:** AUTO_VERIFY
- **Criterion:** Edit modal includes: name, description, category, icon, frequency, frequency_days, ideal_time, priority, estimated_minutes, deep_link_url, deep_link_params
- **Evidence:** All fields present in edit modal
- **Test:** Open edit modal; verify all fields present

#### S11: Tasks Tab - Off-System Presets Management
- **Tag:** AUTO_VERIFY
- **Criterion:** Section to manage off-system task presets (add, edit, delete, reorder)
- **Evidence:** Presets list with CRUD actions
- **Test:** Add new preset; verify appears in list

#### S12: Time Tracking Tab - Category Management
- **Tag:** AUTO_VERIFY
- **Criterion:** Can enable/disable default categories; can add custom categories
- **Evidence:** Category toggles and add custom form
- **Test:** Disable "Other" category; add "Research" custom; verify saved

#### S13: Time Tracking Tab - Pomodoro Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** Can configure: Classic work/break minutes, Long work/break minutes, sessions before long break, daily session target
- **Evidence:** All pomodoro config fields present
- **Test:** Edit classic work to 30 minutes; save; verify persisted

#### S14: PUT /api/workflow/config Updates Configuration
- **Tag:** AUTO_VERIFY
- **Criterion:** API updates workflow_config with new values
- **Evidence:** PUT request updates database; returns updated config
- **Test:** PUT with new targets; verify DB updated

#### S15: Task Definition CRUD Endpoints Work
- **Tag:** AUTO_VERIFY
- **Criterion:** GET/POST/PUT/DELETE /api/workflow/tasks/definitions work correctly
- **Evidence:** All CRUD operations function
- **Test:** Create, read, update, delete task definition via API

### Functional - Notifications

#### N1: Notifications Tab in Settings
- **Tag:** AUTO_VERIFY
- **Criterion:** Notifications tab shows all notification preferences
- **Evidence:** Tab content displays notification options
- **Test:** Navigate to Notifications tab; verify options visible

#### N2: Push Notifications Toggle
- **Tag:** AUTO_VERIFY
- **Criterion:** Master toggle to enable/disable push notifications
- **Evidence:** Toggle saves notifications_enabled to workflow_config
- **Test:** Toggle off; verify notifications_enabled=false

#### N3: Dispatch Warning Threshold Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Input to set hours before deadline for dispatch warning (default 2)
- **Evidence:** Threshold value saved to notification_dispatch_hours
- **Test:** Set to 4 hours; verify saved

#### N4: Overdue Order Notifications Toggle
- **Tag:** AUTO_VERIFY
- **Criterion:** Toggle to enable/disable overdue order notifications
- **Evidence:** Preference saved to config
- **Test:** Toggle; verify saved

#### N5: Resolution Backlog Threshold Configurable
- **Tag:** AUTO_VERIFY
- **Criterion:** Input to set backlog threshold for resolution notifications (default 10)
- **Evidence:** Threshold saved to notification_resolution_threshold
- **Test:** Set to 15; verify saved

#### N6: Sync Failure Notifications Toggle
- **Tag:** AUTO_VERIFY
- **Criterion:** Toggle to enable/disable platform sync failure notifications
- **Evidence:** Preference saved to config
- **Test:** Toggle; verify saved

#### N7: Audio Settings with Preview
- **Tag:** AUTO_VERIFY
- **Criterion:** Sound selector for pomodoro phases with preview play button
- **Evidence:** Dropdown with sound options; preview button plays sound
- **Test:** Select sound; click preview; verify sound plays

#### N8: Browser Push Permission Requested
- **Tag:** AUTO_VERIFY
- **Criterion:** Enabling push notifications requests browser permission
- **Evidence:** Browser permission dialog shown when notifications enabled
- **Test:** Enable notifications; verify permission prompt appears

#### N9: Push Notifications Delivered
- **Tag:** AUTO_VERIFY
- **Criterion:** Configured notification events trigger browser push notifications
- **Evidence:** Push notification appears for configured events
- **Test:** Trigger event (e.g., order approaching deadline); verify push received

#### N10: Notification Bell Shows Unread Count
- **Tag:** AUTO_VERIFY
- **Criterion:** Bell icon in header shows badge with unread notification count
- **Evidence:** Badge displays count > 0 when unread notifications exist
- **Test:** Trigger notification; verify badge shows count

### Error Handling - Settings & Notifications

#### S16: Invalid Config Values Show Validation
- **Tag:** AUTO_VERIFY
- **Criterion:** Invalid values (negative numbers, empty required fields) show validation errors
- **Evidence:** Form validation prevents invalid saves
- **Test:** Enter -1 for target; verify validation error

#### N11: Permission Denied Shows Fallback
- **Tag:** AUTO_VERIFY
- **Criterion:** If push permission denied, shows message explaining in-app notifications only
- **Evidence:** Fallback message displayed; in-app notifications still work
- **Test:** Deny permission; verify fallback message shown

### Performance - Insights & Settings

#### I9: Insights Panel Loads Progressively
- **Tag:** AUTO_VERIFY
- **Criterion:** Insights sections load independently; one slow section doesn't block others
- **Evidence:** Sections render as their data arrives
- **Test:** Mock slow API for one section; verify others render first

#### S17: Settings Page Loads Within 2 Seconds
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings screen renders with data within 2 seconds
- **Evidence:** Settings content visible within 2 seconds
- **Test:** Measure time to settings render; verify < 2000ms

### UI/UX - Insights & Settings

#### S18: Settings Uses shadcn/ui Form Components
- **Tag:** AUTO_VERIFY
- **Criterion:** Settings forms use shadcn/ui Input, Select, Switch, Tabs components
- **Evidence:** Form elements have shadcn class patterns
- **Test:** Inspect DOM for shadcn component classes

#### I10: Insights Panel Collapsible
- **Tag:** AUTO_VERIFY
- **Criterion:** Insights panel can be collapsed/expanded to save space
- **Evidence:** Collapse toggle persists state
- **Test:** Collapse panel; refresh; verify remains collapsed

---

## Database Schema (New Tables for Phases 2-6)

### Phase 2
- `time_entries` - Individual time tracking records
- `time_daily_summaries` - Aggregated daily totals by category

### Phase 3
- `pomodoro_sessions` - Pomodoro session records

### Phase 5
- `stock_pickups` - Stock pickup scheduling and completion

### Phase 6
- Extends `workflow_config` with notification preferences

---

## API Endpoints (New for Phases 2-6)

### Phase 2 - Time Tracking
- `GET /api/time-tracking/current`
- `POST /api/time-tracking/start`
- `POST /api/time-tracking/stop`
- `GET /api/time-tracking/entries`
- `POST /api/time-tracking/entries`
- `PATCH /api/time-tracking/entries/:id`
- `DELETE /api/time-tracking/entries/:id`
- `GET /api/time-tracking/summary`

### Phase 3 - Pomodoro
- `GET /api/pomodoro/current`
- `POST /api/pomodoro/start`
- `POST /api/pomodoro/complete-phase`
- `POST /api/pomodoro/cancel`
- `GET /api/pomodoro/stats`

### Phase 4 - Metrics
- `GET /api/inventory/listing-counts`
- `GET /api/workflow/metrics`

### Phase 5 - Pickups
- `GET /api/pickups`
- `POST /api/pickups`
- `GET /api/pickups/:id`
- `PUT /api/pickups/:id`
- `DELETE /api/pickups/:id`
- `POST /api/pickups/:id/complete`
- `GET /api/pickups/calendar`

### Phase 6 - Insights & Settings
- `GET /api/workflow/insights`
- `GET /api/workflow/tasks/definitions`
- `POST /api/workflow/tasks/definitions`
- `PUT /api/workflow/tasks/definitions/:id`
- `DELETE /api/workflow/tasks/definitions/:id`

---

## Out of Scope

- Mobile native app (web responsive only)
- Calendar sync (Google Calendar, Outlook)
- Team/multi-user workflow
- AI-powered task suggestions
- External integrations beyond existing platforms

---

## Dependencies

- Phase 1 complete (core workflow page, task queue, critical actions)
- Existing platform sync infrastructure
- Existing reports (Daily Activity, P&L, Inventory Aging)
- Existing Listing Optimiser and Arbitrage features
- Browser notification API support

---

## Iteration Budget

| Phase | Budget | Rationale |
|-------|--------|-----------|
| Phase 2 (Time Tracking) | 5 | Well-defined scope, standard patterns |
| Phase 3 (Pomodoro) | 4 | Simple timer logic, minimal integrations |
| Phase 4 (Targets & Metrics) | 4 | Data aggregation from existing sources |
| Phase 5 (Pickups) | 6 | Calendar UI complexity, completion flow |
| Phase 6 (Insights & Settings) | 7 | Most integrations, settings complexity |

**Total combined budget:** 26 iterations across all phases

---

## Criteria Summary

| Phase | Criteria Count | AUTO_VERIFY |
|-------|----------------|-------------|
| Phase 2 (Time Tracking) | 33 | 33 |
| Phase 3 (Pomodoro) | 22 | 22 |
| Phase 4 (Targets & Metrics) | 17 | 17 |
| Phase 5 (Pickups) | 35 | 35 |
| Phase 6 (Insights & Settings) | 35 | 35 |
| **Total** | **142** | **142** |

All criteria are AUTO_VERIFY - no human verification required.
