# Daily Workflow Page - Feature Specification

## Epic Summary

**Epic: Daily Workflow Page**

As a LEGO reseller running Hadley Bricks, I want a single daily workflow page that:

- Shows me critical tasks with deadlines (orders to ship, inventory to resolve)
- Tracks my platform listing inventory levels (maintain ~500 eBay / ~250 Amazon active listings)
- Tracks my daily flow targets (list ~£300/day, sell ~£250/day across all platforms)
- Tracks weekly BrickLink upload value target (£1,000/week)
- Queues recurring and ad-hoc tasks by priority so I can self-schedule my fluid workday
- Lets me add off-system tasks (manifesting, posting parcels, photography, etc.)
- Lets me schedule and track stock pickups with a mini calendar
- Tracks my time across categories (Development, Listing, Shipping, Sourcing, Admin)
- Provides a pomodoro timer for focused work sessions
- Surfaces insights and opportunities from across the platform
- Reduces the cognitive overhead of planning my day so I can focus on value-add activities

---

## Business Context

### User Profile
- Operates 7 days a week (including weekends)
- Starts work at 8am
- Prefers a fluid, self-scheduled day rather than rigid time blocks
- Processes ~100 orders per week across platforms
- Currently has ~265 eBay listings, ~130 Amazon listings (targeting 500/250)
- Daily listing value target: ~£300, Daily sold value target: ~£250
- Values efficiency and automation of planning overhead
- Spending significant time on platform development (tracked as "Development" category)

### Key Business Rhythms
- **Daily**: Process orders (ship by platform SLA), sync platforms, list from backlog
- **Twice daily**: Arbitrage checks (AM/PM - opportunities get snapped up quickly)
- **Twice weekly**: Categorise Monzo transactions, send buyer offers
- **Weekly**: Review slow-moving inventory, refresh old eBay listings, Amazon repricing
- **Monthly**: P&L review, inventory valuation
- **Ad-hoc**: Stock pickups (often multiple per week, scheduled days in advance)

---

## Page Layout Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                                     │
│  ┌───────────────────────────────────────────────────────────────────────────┐ │
│  │ Daily Workflow          [Date]              [⚙ Settings] [🔔 Notifications]│ │
│  │                                                                           │ │
│  │ ┌─────────────────────────────────────────────────────────────────────┐   │ │
│  │ │ ⏱ TIME TRACKING                              🍅 POMODORO            │   │ │
│  │ │ [▶ Start] Category: [Listing ▼]              [▶ Start 25:00]        │   │ │
│  │ │ Today: 3h 42m | Week: 18h 15m                Session: 3/8 | Streak: 5│   │ │
│  │ └─────────────────────────────────────────────────────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────────┤
│  MAIN CONTENT (Scrollable)                                                      │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  📊 WEEKLY TARGETS & METRICS                                            │   │
│  │  - Platform inventory levels (eBay/Amazon active listings)              │   │
│  │  - Daily flow (listed/sold today and this week)                         │   │
│  │  - BrickLink weekly upload value                                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  🔴 CRITICAL ACTIONS (Deadline-driven)                                  │   │
│  │  - Orders to dispatch (with platform SLA countdowns)                    │   │
│  │  - Overdue orders                                                       │   │
│  │  - Inventory resolution required                                        │   │
│  │  - Platform sync status                                                 │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌────────────────────────────────────┐ ┌──────────────────────────────────┐   │
│  │  📋 TASK QUEUE                     │ │  🚗 PICKUP CALENDAR              │   │
│  │  (Prioritised, self-scheduled)     │ │  (Mini calendar + upcoming)      │   │
│  │  - System tasks                    │ │                                  │   │
│  │  - Off-system tasks                │ │                                  │   │
│  │  - Scheduled pickups               │ │                                  │   │
│  └────────────────────────────────────┘ └──────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  💡 INSIGHTS & OPPORTUNITIES                                            │   │
│  │  - Inventory health alerts                                              │   │
│  │  - Pricing/competition alerts                                           │   │
│  │  - Listing engagement                                                   │   │
│  │  - Financial snapshot                                                   │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  ✅ COMPLETED TODAY                                                     │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  ⏱️ TIME BREAKDOWN (Today / This Week)                                  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Section Specifications

### 1. Header Bar - Time Tracking & Pomodoro

#### Time Tracking Panel

**Features:**
- Start/stop timer with category selection
- Categories: Development, Listing, Shipping, Sourcing, Admin, Other
- Display: Current session duration, today's total, week's total
- Link to full time log view

**States:**
- Idle: Shows "Start" button with category dropdown
- Running: Shows elapsed time, current category, Pause and Stop buttons

**Time Log View (separate page/modal):**
- Date range filter
- Category filter
- Paginated transaction list with columns: Date, Start, End, Duration, Category, Notes, Actions
- Edit capability for manual corrections
- Manual entry for forgotten time
- Daily/weekly summary charts

#### Pomodoro Panel

**Features:**
- Mode selector: Classic (25/5), Long (50/10), Custom
- Start/pause/stop controls
- Visual progress indicator (circular or bar)
- Session counter (e.g., "Session 4 of 8")
- Daily streak tracking
- Audio notifications for phase transitions

**States:**
- Idle: Mode selector, Start button
- Work phase: Countdown timer, progress bar, Pause/End buttons
- Break phase: Countdown timer, "Skip Break" option

**Configuration (in Settings):**
- Classic mode durations
- Long mode durations
- Custom durations
- Sessions before long break
- Daily session target
- Sound selection and preview

---

### 2. Weekly Targets & Metrics

**Listing Inventory Levels (maintain stock on platform):**

| Metric | Target | Display |
|--------|--------|---------|
| eBay Active Listings | 500 | Current count, progress bar, gap to target |
| Amazon Active Listings | 250 | Current count, progress bar, gap to target |
| BrickLink Weekly Value | £1,000 | Value uploaded this week, progress bar |

**Daily Flow (throughput - value based):**

| Metric | Target | Display |
|--------|--------|---------|
| Daily Listing Value | £300 | Today's value, weekly total, daily average |
| Daily Sold Value | £250 | Today's value, weekly total, daily average |
| Sourcing | No target | Lots acquired, value |

**Visual Elements:**
- Progress bars with percentage
- Sparkline charts showing last 7 days trend
- Week-to-date aggregates

**Data Sources:**
- eBay/Amazon listing counts: Platform APIs or `platform_listings` table
- BrickLink value: Inventory items with `listing_platform = 'bricklink'` and `listed_date` this week
- Daily flow: Existing Daily Activity report data

---

### 3. Critical Actions (Deadline-Driven)

#### Orders to Dispatch

**Display:**
- Grouped by platform (eBay, Amazon, BrickLink, Brick Owl)
- Each order shows: Order ID, item description, dispatch deadline countdown
- Sorted by urgency (soonest deadline first)
- Platform totals with earliest deadline
- Deep-link to picking list generation (existing feature)

**Dispatch Deadline Logic:**
- Pull from platform order APIs:
  - eBay: `ShippingServiceOptions.ShippingTimeMax` from Trading API
  - Amazon: `LatestShipDate` from SP-API Orders
- Calculate time remaining from now
- Highlight orders within 2 hours in amber, overdue in red

**Actions:**
- "Generate Picking List" button per platform (uses existing picking list feature)
- Individual order links to order detail page

#### Overdue Orders

**Display:**
- Separate section with red highlighting
- Shows how long overdue
- Actions: View Order, Mark Dispatched

#### Inventory Resolution Required

**Display:**
- Count of items needing manual SKU/ASIN matching
- Breakdown by platform and reason (no_sku, no_matches, multiple_matches, etc.)
- Deep-link to `/settings/inventory-resolution`

#### Platform Sync Status

**Display:**
- Grid showing all platforms with last sync time
- Status indicators: ✓ Recent (green), ⚠ Stale (amber), ✗ Error (red)
- "Sync All Platforms" master button with progress indicator

**Platforms:**
- eBay, Amazon, BrickLink, Brick Owl, Monzo, PayPal

---

### 4. Task Queue

**Purpose:** Prioritised list of all tasks (system-generated, recurring, ad-hoc, off-system) that the user works through in their preferred order.

#### Task Display

Each task shows:
- Priority indicator (🔴 Critical, 🟡 Important, 🟢 Regular, 🔵 Low)
- Task icon (📋 System, 📦 Off-system, 🚗 Pickup, 📷 Photography)
- Task name and description
- Dynamic count where applicable (e.g., "7 orders", "12 uncategorised")
- Estimated duration
- Due date/time or schedule (Today, Tomorrow, Wed, Weekly, etc.)
- Action buttons: Start, Defer, Skip, Complete

#### Task Types

**System Tasks (auto-generated from platform data):**

| Task | Category | Frequency | Priority | Est. Duration | Deep-Link |
|------|----------|-----------|----------|---------------|-----------|
| Process orders / Ship | Shipping | Daily | 🔴 Critical | 30-60m | `/orders?status=paid` |
| Resolve inventory matches | Admin | Daily | 🔴 Critical | 10-20m | `/settings/inventory-resolution` |
| Sync all platforms | Admin | Daily | 🔴 Critical | 2-5m | Trigger sync |
| Arbitrage check (AM) | Sourcing | Daily | 🟡 Important | 15-30m | `/arbitrage/amazon` |
| Arbitrage check (PM) | Sourcing | Daily | 🟡 Important | 15-30m | `/arbitrage/amazon` |
| List from backlog | Listing | Daily | 🟡 Important | 2-4h | `/inventory?status=BACKLOG` |
| Categorise Monzo transactions | Admin | 2x/week | 🟢 Regular | 10-15m | `/transactions?tab=monzo&filter=uncategorised` |
| Review slow-moving inventory | Listing | Weekly | 🟢 Regular | 20-30m | `/reports/inventory-aging` |
| Send buyer discount offers | Listing | 2x/week | 🟢 Regular | 10-15m | `/listing-optimiser?tab=offers` |
| Refresh old eBay listings | Listing | Weekly | 🟢 Regular | 20-30m | `/listing-assistant?tab=refresh` |
| Review Amazon repricing | Listing | Weekly | 🟢 Regular | 15-20m | `/repricing` |
| Push Amazon price changes | Listing | As needed | 🟢 Regular | 5-10m | `/amazon-sync` |
| Analyse low-score listings | Listing | Weekly | 🟢 Regular | 20-30m | `/listing-optimiser` |
| Review platform performance | Admin | Weekly | 🔵 Low | 15-20m | `/reports/platform-performance` |
| Monthly P&L review | Admin | Monthly | 🔵 Low | 30-45m | `/reports/profit-loss?period=lastMonth` |
| Inventory valuation check | Admin | Monthly | 🔵 Low | 15-20m | `/reports/inventory-valuation` |
| Review purchase ROI | Admin | Monthly | 🔵 Low | 20-30m | `/reports/purchase-analysis` |
| Discover new ASINs (seeded) | Sourcing | Monthly | 🔵 Low | 30-45m | `/arbitrage/amazon?tab=seeded` |
| Re-analyse listing scores | Listing | Quarterly | 🔵 Low | 30-45m | `/listing-optimiser?reanalyse=stale` |
| Review Amazon stock discrepancies | Admin | Biannual | 🔵 Low | 45-60m | `/platform-stock?compare=true` |
| Review eBay stock discrepancies | Admin | Biannual | 🔵 Low | 45-60m | `/ebay-stock?compare=true` |

**Off-System Task Presets:**

| Preset | Icon | Category | Default Duration |
|--------|------|----------|------------------|
| Manifest parcels | 📦 | Shipping | 15m |
| Post parcels | 📮 | Shipping | 30m |
| Photography session | 📷 | Listing | 120m |
| Returns processing | 🔄 | Shipping | 30m |
| Returns inspection | 🔍 | Shipping | 20m |
| Packing supplies run | 🛒 | Admin | 45m |
| Storage organisation | 🗄️ | Admin | 60m |
| Bank deposit | 🏦 | Admin | 20m |
| Auction attendance | 🔨 | Sourcing | 180m |
| Car boot sale | 🚗 | Sourcing | 180m |

**Stock Pickups:** (see Pickup Calendar section)

#### Task Actions

| Action | Behaviour |
|--------|-----------|
| **Start** | Deep-links to relevant page with filters pre-applied, optionally starts time tracking |
| **Defer** | Reschedule to another day (opens date picker) |
| **Skip** | Mark as skipped for today (returns tomorrow if recurring) |
| **Complete** | Mark done, moves to Completed Today section, stops time tracking if active |

#### Add Task Options

Dropdown menu with:
- **Quick Add Task**: Simple form for ad-hoc tasks
- **Schedule Pickup**: Opens pickup scheduling dialog with calendar
- **Add Recurring Task**: Opens task definition form (for Settings)

#### Quick Add Task Dialog

Fields:
- Task name (required)
- Category dropdown (Development, Listing, Shipping, Sourcing, Admin, Other)
- Due date (Today, Tomorrow, This week, Next week, Specific date)
- Time (optional)
- Estimated duration (minutes)
- Priority (Critical, Important, Regular, Low)
- Notes (optional)

Quick-add preset buttons for common off-system tasks.

---

### 5. Pickup Calendar

**Purpose:** Schedule and track stock pickup trips, often multiple per week and scheduled days in advance.

#### Mini Calendar View

- Month view with navigation (previous/next month)
- Today highlighted
- Days with scheduled pickups show 🚗 icon and brief label
- Click on day to see pickups or add new

#### Upcoming Pickups List

Shows next 7 days of pickups:
- Date and time
- Title/seller name
- Location (address, postcode)
- Stock description
- Agreed price and estimated value
- Potential profit calculation
- Actions: View details, Open in Google Maps, Edit, Complete

#### Schedule Pickup Dialog

**Left Panel - Pickup Details:**

| Field | Required | Notes |
|-------|----------|-------|
| Title/Seller | Yes | e.g., "John - FB Marketplace" |
| Source Platform | No | FB Marketplace, Gumtree, eBay, Car Boot, Auction, Private, Other |
| Address Line 1 | Yes | |
| Address Line 2 | No | |
| City | Yes | |
| Postcode | Yes | |
| Stock Description | No | Items being picked up |
| Agreed Price | No | What you're paying |
| Estimated Value | No | Expected resale value |
| Scheduled Date | Yes | Date picker |
| Scheduled Time | No | Time picker |
| Est. Duration | No | Including travel time |
| Notes | No | |
| Reminder checkbox | No | "Create reminder 1 day before" |
| Auto-create evaluation | No | "Auto-create purchase evaluation" |

**Right Panel - Calendar:**
- Mini calendar showing current/next month
- Today and scheduled pickups highlighted
- List of upcoming pickups below calendar

**Actions:**
- Cancel
- Save Draft (for unconfirmed pickups)
- Schedule (confirmed pickup)

#### Complete Pickup Flow

When completing a pickup:

1. Select outcome: Completed successfully, Partially completed, Cancelled/No-show

2. If completed:
   - Enter final amount paid
   - Enter mileage (round trip) - auto-calculates cost at 45p/mile
   - Add completion notes

3. Next steps options:
   - Create Purchase record (pre-filled with pickup details)
   - Create Purchase Evaluation (for detailed item breakdown)
   - Just mark complete (add to inventory later)

#### Recurring Pickups

Support for regular pickups (e.g., weekly car boot):
- Recurrence pattern: Weekly, Biweekly, Monthly
- Day of week or day of month
- Auto-generates future instances

---

### 6. Insights & Opportunities Panel

**Purpose:** Proactive alerts surfaced from across the platform to highlight items needing attention or opportunities.

#### Inventory Health
- Items hitting 90-day mark today (with link to view)
- Items over 91 days old (count, value, link to Inventory Aging)
- Items in "Not Yet Received" status (count, link to filtered inventory)

#### Pricing & Competition
- Buy Box lost on Amazon listings (count, link to Repricing)
- Listings below target margin (count, link to review)
- Arbitrage opportunities above threshold (count, link to Arbitrage)

#### Listing Engagement
- eBay listings with watchers (count, link to send offers)
- Listings eligible for refresh (count, link to Listing Refresh)
- Listings scored below C grade (count, link to Listing Optimiser)

#### Financial Snapshot
- MTD Revenue with comparison to last month
- MTD Profit with comparison to last month
- Current profit margin vs target

#### Platform Health
- Connection status for all platforms
- Stale sync warnings
- Token expiry warnings (tokens expiring within 7 days)

**Data Sources:**

| Insight | Query/Source |
|---------|--------------|
| Items at 90 days | `inventory_items WHERE DATEDIFF(NOW(), purchase_date) = 90` |
| Items over 91 days | Inventory Aging report data |
| Not Yet Received | `inventory_items WHERE status = 'NOT YET RECEIVED'` |
| Buy Box lost | Repricing data `WHERE buyBoxIsYours = false` |
| Arbitrage opportunities | Arbitrage data `WHERE margin >= threshold` |
| Watchers | eBay Stock data `WHERE watchers > 0` |
| Eligible for refresh | eBay listings `WHERE age > 90 days` |
| Low score listings | Listing Optimiser `WHERE grade IN ('C', 'D', 'F')` |
| Listings needing re-analysis | Listing Optimiser `WHERE last_analysed_at < NOW() - INTERVAL '90 days'` |
| Financial metrics | P&L Report current month vs previous |
| Token expiry warnings | Integration credentials `WHERE expires_at < NOW() + INTERVAL '7 days'` |

---

### 7. Completed Today Section

**Display:**
- Collapsible section showing tasks completed today
- Each item shows: Task name, completion time, duration, category, items processed (if applicable)
- Summary line: Total tasks, total time tracked, pomodoro count

---

### 8. Time Breakdown Section

**Display:**
- Side-by-side today vs this week
- Bar chart showing time per category
- Category legend with totals
- Link to full time log

---

## Settings / Configuration Screen

Accessed via ⚙ icon in header. Tabbed interface:

### Targets Tab

**Listing Inventory Targets:**
- eBay Active Listings Target (default: 500)
- Amazon Active Listings Target (default: 250)
- BrickLink Weekly Value Target (default: £1,000)

**Daily Flow Targets:**
- Daily Listing Value - all platforms (default: £300)
- Daily Sold Value - target (default: £250)

**Working Days:**
- Checkboxes for Mon-Sun (default: all checked)

### Tasks Tab

**Recurring Tasks Management:**
- Table of all recurring task definitions
- Columns: Task, Category, Frequency, Days, Actions
- Add/Edit/Delete tasks

**Task Edit Modal:**
- Task name
- Category dropdown
- Frequency dropdown (Daily, Twice daily, Twice weekly, Weekly, Monthly, Quarterly, Biannual, Annual, Ad-hoc)
- Days selection (depends on frequency)
- Ideal time (AM, PM, Any)
- Priority dropdown
- Estimated duration
- Deep link URL and params

**Off-System Presets:**
- Manage quick-add presets
- Add custom presets

### Time Tracking Tab

**Categories:**
- Enable/disable categories
- Add custom categories

**Pomodoro Settings:**
- Classic mode: Work duration, Break duration
- Long mode: Work duration, Break duration
- Sessions before long break
- Long break duration
- Daily session target

### Notifications Tab

**Push Notifications:**
- Enable/disable push notifications
- Order dispatch warnings (within X hours of deadline)
- Overdue orders
- Inventory resolution backlog threshold
- Platform sync failures

**Audio:**
- Pomodoro work phase complete
- Pomodoro break phase complete
- Hourly time tracking chime (optional)
- Sound selection with preview

---

## Data Model

### workflow_config

```sql
CREATE TABLE workflow_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) UNIQUE,
  
  -- Listing inventory targets
  target_ebay_listings INTEGER DEFAULT 500,
  target_amazon_listings INTEGER DEFAULT 250,
  target_bricklink_weekly_value DECIMAL DEFAULT 1000,
  
  -- Daily flow targets (£ value)
  target_daily_listed_value DECIMAL DEFAULT 300,
  target_daily_sold_value DECIMAL DEFAULT 250,
  
  -- Working days (bitmask: 1=Mon, 2=Tue, 4=Wed, 8=Thu, 16=Fri, 32=Sat, 64=Sun)
  working_days INTEGER DEFAULT 127,
  
  -- Notification preferences
  notifications_enabled BOOLEAN DEFAULT TRUE,
  notification_dispatch_hours INTEGER DEFAULT 2,
  notification_resolution_threshold INTEGER DEFAULT 10,
  notification_sound VARCHAR(50) DEFAULT 'gentle_bell',
  
  -- Pomodoro defaults
  pomodoro_work_minutes INTEGER DEFAULT 25,
  pomodoro_break_minutes INTEGER DEFAULT 5,
  pomodoro_long_work_minutes INTEGER DEFAULT 50,
  pomodoro_long_break_minutes INTEGER DEFAULT 10,
  pomodoro_sessions_before_long_break INTEGER DEFAULT 4,
  pomodoro_daily_target INTEGER DEFAULT 8,
  
  -- Audio preferences
  audio_pomodoro_work_complete BOOLEAN DEFAULT TRUE,
  audio_pomodoro_break_complete BOOLEAN DEFAULT TRUE,
  audio_hourly_chime BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### workflow_task_definitions

```sql
CREATE TABLE workflow_task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL,
  icon VARCHAR(10),
  
  -- Scheduling
  frequency VARCHAR(50) NOT NULL, -- daily, twice_daily, twice_weekly, weekly, monthly, quarterly, biannual, annual, adhoc
  frequency_days INTEGER[], -- For twice_weekly: [1,4] = Mon/Thu; For monthly: [1] = 1st; For biannual: [6,12] = June/Dec
  ideal_time VARCHAR(10), -- 'AM', 'PM', 'ANY'
  
  -- For long-cycle tasks (quarterly, biannual, annual)
  last_completed_at TIMESTAMPTZ,
  
  -- Priority & effort
  priority INTEGER DEFAULT 3, -- 1=Critical, 2=Important, 3=Regular, 4=Low
  estimated_minutes INTEGER,
  
  -- Deep link
  deep_link_url VARCHAR(255),
  deep_link_params JSONB,
  
  -- Dynamic count source
  count_source VARCHAR(100), -- e.g., 'orders.paid', 'inventory.backlog'
  
  -- Task type
  task_type VARCHAR(20) DEFAULT 'system', -- system, off_system
  
  -- State
  is_active BOOLEAN DEFAULT TRUE,
  is_system BOOLEAN DEFAULT FALSE,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### workflow_task_instances

```sql
CREATE TABLE workflow_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  task_definition_id UUID REFERENCES workflow_task_definitions(id),
  
  -- For ad-hoc tasks without definition
  name VARCHAR(255),
  description TEXT,
  category VARCHAR(50),
  icon VARCHAR(10),
  priority INTEGER,
  estimated_minutes INTEGER,
  
  -- Task type
  task_type VARCHAR(20) DEFAULT 'system', -- system, off_system, pickup
  pickup_id UUID REFERENCES stock_pickups(id),
  
  -- Scheduling
  scheduled_date DATE NOT NULL,
  due_time TIME,
  
  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, skipped, deferred
  
  -- Completion tracking
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,
  items_processed INTEGER,
  notes TEXT,
  
  -- For deferred tasks
  deferred_from_date DATE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_task_instances_user_date ON workflow_task_instances(user_id, scheduled_date);
CREATE INDEX idx_task_instances_status ON workflow_task_instances(status);
```

### time_entries

```sql
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  category VARCHAR(50) NOT NULL,
  
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  
  task_instance_id UUID REFERENCES workflow_task_instances(id),
  notes TEXT,
  
  is_manual_entry BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_entries_user_date ON time_entries(user_id, started_at);
```

### pomodoro_sessions

```sql
CREATE TABLE pomodoro_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  session_date DATE NOT NULL,
  session_number INTEGER NOT NULL,
  
  mode VARCHAR(20) NOT NULL, -- classic, long, custom
  work_minutes INTEGER NOT NULL,
  break_minutes INTEGER NOT NULL,
  
  started_at TIMESTAMPTZ NOT NULL,
  work_completed_at TIMESTAMPTZ,
  break_completed_at TIMESTAMPTZ,
  
  status VARCHAR(20) DEFAULT 'work', -- work, break, completed, cancelled
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pomodoro_user_date ON pomodoro_sessions(user_id, session_date);
```

### time_daily_summaries

```sql
CREATE TABLE time_daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  summary_date DATE NOT NULL,
  
  total_seconds INTEGER DEFAULT 0,
  development_seconds INTEGER DEFAULT 0,
  listing_seconds INTEGER DEFAULT 0,
  shipping_seconds INTEGER DEFAULT 0,
  sourcing_seconds INTEGER DEFAULT 0,
  admin_seconds INTEGER DEFAULT 0,
  other_seconds INTEGER DEFAULT 0,
  
  pomodoro_count INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, summary_date)
);
```

### stock_pickups

```sql
CREATE TABLE stock_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  -- Basic info
  title VARCHAR(255) NOT NULL,
  source_platform VARCHAR(50),
  
  -- Location
  address_line_1 VARCHAR(255),
  address_line_2 VARCHAR(255),
  city VARCHAR(100),
  postcode VARCHAR(20),
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  
  -- Stock details
  description TEXT,
  agreed_price DECIMAL(10, 2),
  estimated_value DECIMAL(10, 2),
  
  -- Scheduling
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  estimated_duration_minutes INTEGER DEFAULT 60,
  
  -- Recurrence
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_pattern VARCHAR(50), -- weekly, biweekly, monthly
  recurrence_day INTEGER,
  parent_pickup_id UUID REFERENCES stock_pickups(id),
  
  -- Status
  status VARCHAR(20) DEFAULT 'scheduled', -- draft, scheduled, completed, cancelled, no_show
  
  -- Completion details
  completed_at TIMESTAMPTZ,
  final_amount_paid DECIMAL(10, 2),
  mileage_miles DECIMAL(6, 1),
  mileage_cost DECIMAL(10, 2),
  completion_notes TEXT,
  
  -- Links
  purchase_id UUID REFERENCES purchases(id),
  evaluation_id UUID, -- References purchase_evaluations if exists
  
  -- Reminders
  reminder_day_before BOOLEAN DEFAULT TRUE,
  reminder_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pickups_user_date ON stock_pickups(user_id, scheduled_date);
CREATE INDEX idx_pickups_status ON stock_pickups(status);
```

### off_system_task_presets

```sql
CREATE TABLE off_system_task_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(10),
  category VARCHAR(50) NOT NULL,
  default_duration_minutes INTEGER,
  default_priority INTEGER DEFAULT 3,
  
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## API Endpoints Required

### Workflow Configuration
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workflow/config` | GET | Get user's workflow configuration |
| `/api/workflow/config` | PUT | Update workflow configuration |

### Tasks
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workflow/tasks/definitions` | GET | List task definitions |
| `/api/workflow/tasks/definitions` | POST | Create task definition |
| `/api/workflow/tasks/definitions/:id` | PUT | Update task definition |
| `/api/workflow/tasks/definitions/:id` | DELETE | Delete task definition |
| `/api/workflow/tasks/today` | GET | Get today's task queue with dynamic counts |
| `/api/workflow/tasks` | POST | Create ad-hoc task instance |
| `/api/workflow/tasks/:id` | PATCH | Update task (complete, defer, skip) |
| `/api/workflow/tasks/:id/start` | POST | Start task (optional time tracking) |

### Time Tracking
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/time-tracking/current` | GET | Get active time entry |
| `/api/time-tracking/start` | POST | Start time entry |
| `/api/time-tracking/stop` | POST | Stop time entry |
| `/api/time-tracking/entries` | GET | List time entries (paginated, filterable) |
| `/api/time-tracking/entries` | POST | Create manual time entry |
| `/api/time-tracking/entries/:id` | PATCH | Update time entry |
| `/api/time-tracking/entries/:id` | DELETE | Delete time entry |
| `/api/time-tracking/summary` | GET | Get daily/weekly summaries |

### Pomodoro
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pomodoro/current` | GET | Get active pomodoro session |
| `/api/pomodoro/start` | POST | Start pomodoro session |
| `/api/pomodoro/complete-phase` | POST | Complete current phase (work→break or break→done) |
| `/api/pomodoro/cancel` | POST | Cancel current session |
| `/api/pomodoro/stats` | GET | Get daily/streak stats |

### Stock Pickups
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/pickups` | GET | List pickups (filterable by date range, status) |
| `/api/pickups` | POST | Create pickup |
| `/api/pickups/:id` | GET | Get pickup details |
| `/api/pickups/:id` | PUT | Update pickup |
| `/api/pickups/:id` | DELETE | Delete pickup |
| `/api/pickups/:id/complete` | POST | Complete pickup with outcome |
| `/api/pickups/calendar` | GET | Get pickups for calendar view (month) |

### Insights
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/workflow/insights` | GET | Aggregated insights for the insights panel |

### Platform Data (new or extended)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orders/dispatch-deadlines` | GET | Orders with platform-specific dispatch SLAs |
| `/api/inventory/listing-counts` | GET | Active listing counts per platform |

---

## Implementation Phases

### Phase 1: Core Workflow Page (MVP)
- Task queue with static/recurring tasks
- Critical actions panel (orders, resolution, sync status)
- Master sync button
- Deep-links to existing pages
- Completed today section
- Basic task actions (start, complete, skip, defer)

### Phase 2: Time Tracking
- Start/stop timer with categories
- Daily/weekly summaries on workflow page
- Time log page with edit capability
- Manual entry support

### Phase 3: Pomodoro
- Timer with work/break phases
- Classic and Long modes
- Audio notifications
- Session tracking and streaks

### Phase 4: Targets & Metrics
- Weekly targets panel
- Integration with Daily Activity report
- Platform listing count APIs
- Sparkline charts

### Phase 5: Pickups & Off-System Tasks
- Pickup calendar with scheduling
- Quick-add task dialog
- Off-system task presets
- Pickup completion flow with purchase integration

### Phase 6: Insights & Configuration
- Full insights panel with all data sources
- Push notifications
- Dispatch deadline integration from platform APIs
- Complete settings screen

---

## Integration Points with Existing Features

| Feature | Integration |
|---------|-------------|
| Orders | Dispatch deadlines, picking lists, order counts |
| Inventory | Backlog counts, aging data, listing counts |
| Inventory Resolution | Pending resolution counts |
| Reports (Daily Activity) | Listed/sold counts, existing report data |
| Reports (P&L) | Financial snapshot metrics |
| Reports (Inventory Aging) | Slow-moving inventory alerts |
| Arbitrage | Opportunity counts |
| Repricing | Buy Box status, price change counts |
| Listing Optimiser | Low-score listing counts, watcher counts |
| Listing Assistant | Refresh-eligible listing counts |
| Transactions (Monzo) | Uncategorised transaction counts |
| Platform Sync | Sync status, last sync times |
| Purchases | Link from completed pickups |
| Purchase Evaluator | Link from completed pickups |

---

## Notes for Define Done Agent

1. **Dispatch deadlines require platform API extensions** - eBay Trading API and Amazon SP-API need to be queried for shipping method SLAs per order.

2. **Task queue is self-scheduled** - Unlike a calendar, tasks are presented as a prioritised list. User decides when to do each task.

3. **Time tracking is independent of pomodoro** - They can run simultaneously. Time tracking is about category allocation; pomodoro is about focus sessions.

4. **Pickup calendar is lightweight** - Not a full calendar system, just a focused view for stock pickups with scheduling capability.

5. **Insights are read-only** - They surface data from existing features; clicking links navigates to those features for action.

6. **Off-system tasks are first-class citizens** - Physical tasks like manifesting, posting, photography are tracked alongside system tasks.

7. **Weekly targets for eBay/Amazon are inventory levels** (stock to maintain), not throughput. Daily list/sell targets are **£ value**, not item counts.

8. **Biannual tasks** (stock discrepancy reviews) are scheduled for June (Summer prep) and December (Christmas prep). The system should auto-generate these task instances at appropriate times.

9. **Quarterly tasks** (listing re-analysis) appear at the start of each quarter. The system should track last completion date and surface the task when 90+ days have passed.
