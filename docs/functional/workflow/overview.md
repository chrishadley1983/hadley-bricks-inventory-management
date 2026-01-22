# Workflow

> **Entry Points:** `/workflow`
> **Primary Use:** Daily operations hub - task management, time tracking, pickups, and performance targets

## Purpose

The Workflow feature is the daily operations hub for managing business tasks, tracking time spent on activities, scheduling stock pickups, and monitoring performance against weekly targets. It centralises all operational activities into a single dashboard for efficient daily workflow management.

---

## Key Capabilities

| Capability | Description |
|------------|-------------|
| **Task Queue** | View and manage today's tasks with dynamic counts showing pending work |
| **Time Tracking** | Track time spent on categories: Development, Listing, Shipping, Sourcing, Admin, Other |
| **Pomodoro Timer** | Focus timer with work/break intervals for productivity |
| **Weekly Targets** | Monitor progress on listing counts and value targets with sparklines |
| **Pickup Calendar** | Schedule and manage stock collection appointments |
| **Critical Actions** | Surface urgent items requiring immediate attention |

---

## Data Model

### Task Definition

Recurring task templates that generate daily instances:

| Field | Type | Description |
|-------|------|-------------|
| name | string | Task display name |
| description | string | Optional task description |
| category | string | Task category (e.g., Operations, Orders, Inventory) |
| icon | string | Emoji icon for visual identification |
| frequency | enum | daily, twice_daily, twice_weekly, weekly, monthly, quarterly, biannual, adhoc |
| frequency_days | number[] | Days of week for weekly tasks (1=Mon, 7=Sun) |
| priority | number | 1=Critical, 2=Important, 3=Regular, 4=Low |
| estimated_minutes | number | Expected time to complete |
| deep_link_url | string | Navigation link to relevant page |
| count_source | string | Dynamic count data source |
| is_active | boolean | Whether definition generates instances |
| is_system | boolean | Whether definition is system-defined |

### Task Instance

Individual task occurrences for a specific day:

| Field | Type | Description |
|-------|------|-------------|
| scheduled_date | date | Date task is scheduled for |
| status | enum | pending, in_progress, completed, skipped, deferred |
| task_type | enum | system (auto-generated) or off_system (manual) |
| started_at | timestamp | When task was started |
| completed_at | timestamp | When task was completed |
| time_spent_seconds | number | Duration from start to completion |
| deferred_from_date | date | Original date if deferred |

### Dynamic Count Sources

Tasks can display live counts from various data sources:

| Source | Description |
|--------|-------------|
| `orders.paid` | Paid orders awaiting fulfillment |
| `inventory.backlog` | Items in BACKLOG status |
| `resolution.pending` | Order items needing inventory linking |
| `transactions.uncategorised` | Monzo transactions without category |
| `inventory.stale` | Items listed > 90 days |
| `amazon_sync.pending` | Pending Amazon sync queue items |
| `ebay.refresh_eligible` | eBay listings eligible for refresh |

### Time Entry

Time tracking records:

| Field | Type | Description |
|-------|------|-------------|
| category | enum | Development, Listing, Shipping, Sourcing, Admin, Other |
| started_at | timestamp | Entry start time |
| ended_at | timestamp | Entry end time (null if active) |
| duration_seconds | number | Calculated duration |
| is_paused | boolean | Whether currently paused |
| paused_duration_seconds | number | Total paused time |
| is_manual_entry | boolean | Whether manually added |
| notes | string | Optional notes |

### Stock Pickup

Scheduled collection appointments:

| Field | Type | Description |
|-------|------|-------------|
| title | string | Pickup description |
| scheduled_date | date | Collection date |
| scheduled_time | time | Start time |
| scheduled_end_time | time | End time |
| address_* | string | Location fields |
| estimated_value | number | Expected stock value |
| agreed_price | number | Negotiated purchase price |
| status | enum | scheduled, in_progress, completed, cancelled |
| outcome | enum | successful, partial, unsuccessful, rescheduled |
| final_amount_paid | number | Actual amount spent |
| mileage | number | Trip distance |
| google_calendar_event_id | string | Linked calendar event |

---

## User Journeys

| Journey | Description | Documentation |
|---------|-------------|---------------|
| Task Management | Process daily task queue | [task-management.md](./task-management.md) |
| Time Tracking | Track and categorise work time | [time-tracking.md](./time-tracking.md) |
| Pickup Scheduling | Schedule stock collection trips | [pickup-scheduling.md](./pickup-scheduling.md) |
| Weekly Targets | Monitor performance metrics | [weekly-targets.md](./weekly-targets.md) |

---

## Page Layout

The workflow page is organised into sections:

```
┌─────────────────────────────────────────────────────────────┐
│  Header: "Workflow" + Settings + Add Task                   │
├─────────────────────────────────────────────────────────────┤
│  Timer Row: Time Tracking Panel | Pomodoro Panel            │
├─────────────────────────────────────────────────────────────┤
│  Weekly Targets: 5 metric cards with sparklines             │
├─────────────────────────────────────────────────────────────┤
│  Critical Actions Panel (resolution stats, urgent items)    │
├─────────────────────────────────────────────────────────────┤
│  Main Grid:                                                 │
│  ┌─────────────────────┬──────────────────┐                │
│  │  Task Queue         │ Completed Today  │                │
│  │  (pending tasks)    ├──────────────────┤                │
│  │                     │ Pickup Calendar  │                │
│  └─────────────────────┴──────────────────┘                │
├─────────────────────────────────────────────────────────────┤
│  Time Breakdown: Category breakdown with progress bars      │
├─────────────────────────────────────────────────────────────┤
│  Weekly Insights: Historical analysis charts                │
└─────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflow/tasks/today` | Get today's tasks with dynamic counts |
| GET | `/api/workflow/tasks/future` | Get future scheduled custom tasks |
| POST | `/api/workflow/tasks` | Create ad-hoc task or from preset |
| PATCH | `/api/workflow/tasks/[id]` | Update task status |
| PUT | `/api/workflow/tasks/[id]` | Update task details |
| DELETE | `/api/workflow/tasks/[id]` | Delete custom task |

### Definitions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflow/definitions` | Get all task definitions |
| POST | `/api/workflow/definitions` | Create new definition |
| PATCH | `/api/workflow/definitions/[id]` | Update definition |
| DELETE | `/api/workflow/definitions/[id]` | Delete definition |

### Presets

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflow/presets` | Get off-system task presets |

### Time Tracking

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/time-tracking/current` | Get active time entry |
| GET | `/api/time-tracking/summary` | Get today/week summaries |
| GET | `/api/time-tracking/entries` | Get paginated entries |
| POST | `/api/time-tracking/start` | Start new time entry |
| POST | `/api/time-tracking/stop` | Stop current entry |
| POST | `/api/time-tracking/pause` | Pause current entry |
| POST | `/api/time-tracking/resume` | Resume paused entry |
| POST | `/api/time-tracking/entries` | Create manual entry |
| PATCH | `/api/time-tracking/entries/[id]` | Update entry |
| DELETE | `/api/time-tracking/entries/[id]` | Delete entry |

### Metrics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/workflow/metrics` | Get weekly metrics and targets |

### Pickups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pickups` | Get pickups for month |
| GET | `/api/pickups/upcoming` | Get next 7 days pickups |
| GET | `/api/pickups/stats` | Get pickup statistics |
| POST | `/api/pickups` | Create pickup |
| PATCH | `/api/pickups/[id]` | Update pickup |
| POST | `/api/pickups/[id]/complete` | Mark pickup complete |
| POST | `/api/pickups/[id]/cancel` | Cancel pickup |
| DELETE | `/api/pickups/[id]` | Delete pickup |
| POST | `/api/pickups/[id]/calendar` | Add to Google Calendar |

---

## Source Files

### Page & Layout

| File | Purpose |
|------|---------|
| [workflow/page.tsx](../../../apps/web/src/app/(dashboard)/workflow/page.tsx) | Main workflow page |
| [workflow/loading.tsx](../../../apps/web/src/app/(dashboard)/workflow/loading.tsx) | Loading skeleton |

### Components

| File | Purpose |
|------|---------|
| [TaskQueue.tsx](../../../apps/web/src/components/features/workflow/TaskQueue.tsx) | Pending task list |
| [TaskCard.tsx](../../../apps/web/src/components/features/workflow/TaskCard.tsx) | Individual task card |
| [AddTaskDropdown.tsx](../../../apps/web/src/components/features/workflow/AddTaskDropdown.tsx) | Quick add task menu |
| [QuickAddTaskDialog.tsx](../../../apps/web/src/components/features/workflow/QuickAddTaskDialog.tsx) | Custom task form |
| [CompletedTodaySection.tsx](../../../apps/web/src/components/features/workflow/CompletedTodaySection.tsx) | Completed tasks list |
| [TimeTrackingPanel.tsx](../../../apps/web/src/components/features/workflow/TimeTrackingPanel.tsx) | Time tracker widget |
| [PomodoroPanel.tsx](../../../apps/web/src/components/features/workflow/PomodoroPanel.tsx) | Focus timer |
| [TimeBreakdownSection.tsx](../../../apps/web/src/components/features/workflow/TimeBreakdownSection.tsx) | Category breakdown |
| [WeeklyTargetsPanel.tsx](../../../apps/web/src/components/features/workflow/WeeklyTargetsPanel.tsx) | Metric cards |
| [MetricCard.tsx](../../../apps/web/src/components/features/workflow/MetricCard.tsx) | Individual metric |
| [PickupCalendarPanel.tsx](../../../apps/web/src/components/features/workflow/PickupCalendarPanel.tsx) | Pickup calendar |
| [SchedulePickupDialog.tsx](../../../apps/web/src/components/features/workflow/SchedulePickupDialog.tsx) | Pickup form |
| [CriticalActionsPanel.tsx](../../../apps/web/src/components/features/workflow/CriticalActionsPanel.tsx) | Urgent items |
| [InventoryResolutionCard.tsx](../../../apps/web/src/components/features/workflow/InventoryResolutionCard.tsx) | Resolution stats |
| [WorkflowSettingsPanel.tsx](../../../apps/web/src/components/features/workflow/WorkflowSettingsPanel.tsx) | Settings dialog |
| [TaskDefinitionsDialog.tsx](../../../apps/web/src/components/features/workflow/TaskDefinitionsDialog.tsx) | Manage definitions |
| [WeeklyInsightsPanel.tsx](../../../apps/web/src/components/features/workflow/WeeklyInsightsPanel.tsx) | Historical charts |

### Hooks

| File | Purpose |
|------|---------|
| [use-workflow.ts](../../../apps/web/src/hooks/use-workflow.ts) | Task data hooks |
| [use-time-tracking.ts](../../../apps/web/src/hooks/use-time-tracking.ts) | Time tracking hooks |
| [use-pickups.ts](../../../apps/web/src/hooks/use-pickups.ts) | Pickup data hooks |
| [use-metrics.ts](../../../apps/web/src/hooks/use-metrics.ts) | Metrics data hooks |

### Services

| File | Purpose |
|------|---------|
| [workflow.service.ts](../../../apps/web/src/lib/services/workflow.service.ts) | Task business logic |

---

## Related Features

- [Inventory Resolution](../inventory/inventory-resolution.md) - Linked from critical actions
- [Orders](../orders/overview.md) - Order counts shown in task queue
- [Purchases](../purchases/overview.md) - Pickups can link to purchases

