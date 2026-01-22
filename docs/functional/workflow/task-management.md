# Journey: Task Management

> **Entry Point:** `/workflow`
> **Prerequisites:** None
> **Complexity:** Low

## Purpose

Process your daily task queue efficiently. Tasks are automatically generated from definitions based on their frequency, with dynamic counts showing pending work for each area. Complete, skip, or defer tasks to stay on top of daily operations.

---

## Key Concepts

### Task Types

| Type | Description | Generation |
|------|-------------|------------|
| **System** | Auto-generated from task definitions | Created daily based on frequency rules |
| **Off-System** | Manually created ad-hoc tasks | Created via Quick Add or presets |

### Task Statuses

| Status | Description | Actions Available |
|--------|-------------|-------------------|
| `pending` | Not yet started | Start, Complete, Skip, Defer |
| `in_progress` | Currently working on | Complete, Skip, Defer |
| `completed` | Successfully finished | None (moves to Completed section) |
| `skipped` | Intentionally skipped | None (moves to Completed section) |
| `deferred` | Postponed to future date | None (creates new instance) |

### Task Priorities

| Priority | Label | Color | Use Case |
|----------|-------|-------|----------|
| 1 | Critical | Red | Must complete today |
| 2 | Important | Amber | Should complete if possible |
| 3 | Regular | Blue | Standard daily task |
| 4 | Low | Gray | Nice to have |

### Task Frequencies

| Frequency | Description | Example |
|-----------|-------------|---------|
| daily | Every day | "Process paid orders" |
| twice_daily | Morning and afternoon | "Check eBay messages" |
| twice_weekly | Specific days (e.g., Mon/Thu) | "Reprice slow movers" |
| weekly | Once per week | "Bulk BrickLink upload" |
| monthly | First day of month | "Monthly reconciliation" |
| quarterly | Jan, Apr, Jul, Oct | "Quarterly tax prep" |
| biannual | Jan and Jul | "Storage audit" |
| adhoc | Manual trigger only | "Custom projects" |

---

## User Flow

### Step 1: View Today's Tasks

1. Navigate to `/workflow`
2. The **Task Queue** shows all pending tasks for today
3. Tasks are sorted by priority (Critical first)
4. Dynamic counts appear next to relevant tasks (e.g., "Process Orders (5)")

### Step 2: Start a Task

1. Click the **Play** button on a pending task
2. Task status changes to `in_progress`
3. Task card gets highlighted with a ring indicator
4. Timer starts tracking time spent
5. If task has a deep link, click the link icon to navigate to the relevant page

### Step 3: Complete a Task

1. When finished, click the **Checkmark** button
2. Task moves to the **Completed Today** section
3. Time spent is calculated and recorded
4. Summary updates with completion count and total time

### Step 4: Skip a Task

1. Click the **More** menu (three dots)
2. Select **Skip**
3. Task is marked as skipped (doesn't count toward completion metrics)
4. Use for tasks not applicable today

### Step 5: Defer a Task

1. Click the **More** menu (three dots)
2. Select **Defer to...**
3. Calendar popup appears
4. Select a future date
5. Original task is marked as deferred
6. New task instance is created for the selected date

---

## Adding Tasks

### Quick Add from Preset

1. Click **Add Task** button in header
2. Select from list of off-system presets
3. Task is immediately added to today's queue

### Create Custom Task

1. Click **Add Task** > **Custom Task**
2. Fill in the dialog:
   - **Name** (required): Task description
   - **Category**: Select from dropdown
   - **Priority**: 1-4 scale
   - **Estimated Time**: Optional duration
   - **Scheduled Date**: Today or future date
   - **Description**: Optional details
3. Click **Create Task**
4. Task appears in queue (or future tasks if scheduled ahead)

### Schedule Future Task

1. Click **Add Task** > **Custom Task**
2. Set **Scheduled Date** to a future date
3. Task appears in the **Upcoming Tasks** panel (if visible)
4. Task will automatically appear in queue on that date

---

## Managing Definitions

### Access Task Definitions

1. Click the **Settings** icon in the workflow header
2. Select **Task Definitions**
3. Dialog shows all task definitions

### Edit a Definition

1. In Task Definitions dialog, click on a definition
2. Modify fields:
   - Name, Description, Category
   - Frequency and frequency days
   - Priority, Estimated time
   - Deep link URL
   - Active status
3. Click **Save**
4. Future instances will use updated settings

### Create New Definition

1. In Task Definitions dialog, click **Add Definition**
2. Configure all fields
3. Set frequency schedule
4. Click **Create**
5. Instances will be generated according to frequency

### Disable a Definition

1. In Task Definitions dialog, find the definition
2. Toggle **Active** off
3. No new instances will be generated
4. Existing instances are not affected

---

## Dynamic Counts

Some tasks display live counts from the database:

| Task | Count Source | What It Shows |
|------|--------------|---------------|
| Process Orders | `orders.paid` | Paid orders awaiting fulfillment |
| List Backlog | `inventory.backlog` | Items in BACKLOG status |
| Resolve Inventory | `resolution.pending` | Order items needing inventory links |
| Categorise Transactions | `transactions.uncategorised` | Untagged Monzo transactions |
| Review Stale Listings | `inventory.stale` | Items listed > 90 days |

Counts refresh automatically when you return to the workflow page.

---

## Resolution Stats

The Inventory Resolution task shows detailed stats:

| Metric | Description |
|--------|-------------|
| **Pending Review** | Items in eBay/Amazon resolution queues |
| **Unlinked since Jan 2026** | Order items without inventory links (since app became primary) |
| **Total Unlinked** | All unlinked order items historically |

Click the task's deep link to go to the resolution page.

---

## Completed Today Section

The right sidebar shows today's completed tasks:

- Task name and category
- Completion time
- Time spent on task
- Scrollable list if many completed

---

## API Reference

### GET /api/workflow/tasks/today

Get today's tasks with dynamic counts.

**Response:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "name": "Process Orders",
      "description": "Ship all paid orders",
      "category": "Orders",
      "icon": "📦",
      "priority": 1,
      "estimatedMinutes": 30,
      "scheduledDate": "2026-01-21",
      "status": "pending",
      "deepLinkUrl": "/orders",
      "taskType": "system",
      "countSource": "orders.paid",
      "count": 5
    }
  ],
  "completedToday": [
    {
      "id": "uuid",
      "name": "Check Messages",
      "category": "Communication",
      "completedAt": "2026-01-21T09:30:00Z",
      "timeSpentSeconds": 600
    }
  ],
  "summary": {
    "tasksCompleted": 3,
    "totalTimeSeconds": 2400
  }
}
```

### PATCH /api/workflow/tasks/[id]

Update task status.

**Request Body:**
```json
{
  "status": "completed"
}
```

Or for deferring:
```json
{
  "status": "deferred",
  "deferredToDate": "2026-01-25"
}
```

### POST /api/workflow/tasks

Create ad-hoc task.

**Request Body:**
```json
{
  "name": "Call supplier",
  "category": "Sourcing",
  "priority": 2,
  "estimatedMinutes": 15,
  "scheduledDate": "2026-01-21"
}
```

Or from preset:
```json
{
  "presetId": "uuid"
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Tasks not appearing | Check task definitions are active and frequency matches today |
| Counts not updating | Refresh the page; counts are fetched on page load |
| Deferred task not showing | Check the scheduled date; it will appear on that day |
| Can't delete system task | System tasks can only be completed/skipped, not deleted |

---

## Source Files

| File | Purpose |
|------|---------|
| [TaskQueue.tsx](../../../apps/web/src/components/features/workflow/TaskQueue.tsx) | Task list component |
| [TaskCard.tsx](../../../apps/web/src/components/features/workflow/TaskCard.tsx) | Individual task card |
| [use-workflow.ts](../../../apps/web/src/hooks/use-workflow.ts) | Task data hooks |
| [workflow.service.ts](../../../apps/web/src/lib/services/workflow.service.ts) | Task business logic |

---

## Related Journeys

- [Time Tracking](./time-tracking.md) - Track time alongside tasks
- [Weekly Targets](./weekly-targets.md) - Monitor completion metrics

