# Journey: Time Tracking

> **Entry Point:** `/workflow` (Time Tracking Panel)
> **Prerequisites:** None
> **Complexity:** Low

## Purpose

Track time spent on different business activities throughout the day. Categorise work into Development, Listing, Shipping, Sourcing, Admin, or Other to understand where time goes and optimise workflow efficiency.

---

## Key Concepts

### Time Categories

| Category | Color | Description |
|----------|-------|-------------|
| **Development** | Blue | Building/improving the app |
| **Listing** | Green | Creating and managing listings |
| **Shipping** | Amber | Packing and dispatching orders |
| **Sourcing** | Purple | Finding and purchasing stock |
| **Admin** | Gray | Bookkeeping, emails, planning |
| **Other** | Pink | Miscellaneous activities |

### Entry Types

| Type | Description |
|------|-------------|
| **Active** | Currently running timer |
| **Manual** | Retrospectively added entry |
| **Completed** | Finished time block |

### Timer States

| State | Description |
|-------|-------------|
| Running | Timer actively counting |
| Paused | Timer stopped, can be resumed |
| Stopped | Entry complete, duration recorded |

---

## User Flow

### Step 1: Start Tracking

1. Locate the **Time Tracking Panel** at the top of the workflow page
2. Click the **Category** dropdown
3. Select the activity category (e.g., "Listing")
4. Timer starts immediately
5. Elapsed time displays in HH:MM:SS format

### Step 2: Monitor Progress

While tracking:
- Current elapsed time shows prominently
- Category badge indicates what you're tracking
- Today's total time updates in real-time

### Step 3: Pause/Resume

If you need to take a break:
1. Click the **Pause** button
2. Timer stops but entry remains active
3. "Paused" indicator appears
4. Click **Resume** to continue
5. Paused duration is tracked separately

### Step 4: Stop Tracking

When finished with the activity:
1. Click the **Stop** button
2. Entry is saved with final duration
3. Today's summary updates
4. You can start a new entry immediately

---

## Time Summaries

### Today's Summary

Shows in the Time Tracking Panel:
- Total time tracked today across all categories
- Current category if timer is running

### Time Breakdown Section

Located below the main content:
- Bar chart showing time per category
- Percentage breakdown
- Toggle between Today and Week view

### Weekly Summary

Aggregates time across the current week:
- Total hours worked
- Distribution by category
- Comparison to previous weeks

---

## Managing Entries

### View Entry History

1. Scroll to **Time Breakdown Section**
2. Click **View All Entries** (if available)
3. See paginated list of past entries

### Add Manual Entry

If you forgot to track time:
1. Access entry form (if available in UI)
2. Select category
3. Set start time and end time
4. Add optional notes
5. Save entry

### Edit an Entry

1. Find the entry in history
2. Click to edit
3. Modify category, times, or notes
4. Save changes

### Delete an Entry

1. Find the entry in history
2. Click delete
3. Confirm deletion
4. Entry is removed from totals

---

## Pomodoro Timer

The workflow page includes a separate **Pomodoro Panel** for focused work:

### How It Works

1. Click **Start** on the Pomodoro Panel
2. Work for 25 minutes (configurable)
3. Take a 5-minute break
4. After 4 pomodoros, take a longer break (15-30 minutes)

### Integration

- Pomodoro timer is separate from time tracking
- Use alongside category tracking for focused productivity
- Visible completion count shows daily progress

---

## API Reference

### GET /api/time-tracking/current

Get the currently active time entry.

**Response:**
```json
{
  "entry": {
    "id": "uuid",
    "category": "Listing",
    "startedAt": "2026-01-21T10:30:00Z",
    "elapsedSeconds": 1847,
    "isPaused": false,
    "pausedDurationSeconds": 0
  }
}
```

Returns `{ "entry": null }` if no active entry.

### GET /api/time-tracking/summary

Get today and week summaries.

**Response:**
```json
{
  "today": {
    "total": 14400,
    "byCategory": {
      "Development": 3600,
      "Listing": 7200,
      "Shipping": 1800,
      "Sourcing": 0,
      "Admin": 1800,
      "Other": 0
    }
  },
  "week": {
    "total": 72000,
    "byCategory": {
      "Development": 18000,
      "Listing": 28800,
      "Shipping": 10800,
      "Sourcing": 7200,
      "Admin": 5400,
      "Other": 1800
    }
  }
}
```

### POST /api/time-tracking/start

Start a new time entry.

**Request Body:**
```json
{
  "category": "Listing"
}
```

**Response:**
```json
{
  "entry": {
    "id": "uuid",
    "category": "Listing",
    "startedAt": "2026-01-21T10:30:00Z"
  }
}
```

### POST /api/time-tracking/stop

Stop the current time entry.

**Response:**
```json
{
  "entry": {
    "id": "uuid",
    "category": "Listing",
    "startedAt": "2026-01-21T10:30:00Z",
    "endedAt": "2026-01-21T11:30:00Z",
    "durationSeconds": 3600
  }
}
```

### POST /api/time-tracking/pause

Pause the current time entry.

### POST /api/time-tracking/resume

Resume a paused time entry.

### GET /api/time-tracking/entries

Get paginated time entries.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| dateFrom | string | Start date filter (YYYY-MM-DD) |
| dateTo | string | End date filter (YYYY-MM-DD) |
| category | string | Filter by category |
| page | number | Page number (1-indexed) |
| limit | number | Items per page (default 20) |

### POST /api/time-tracking/entries

Create a manual time entry.

**Request Body:**
```json
{
  "category": "Admin",
  "startedAt": "2026-01-21T09:00:00Z",
  "endedAt": "2026-01-21T10:00:00Z",
  "notes": "Morning planning session"
}
```

---

## Utility Functions

The `use-time-tracking.ts` hook provides formatting utilities:

### formatDuration(seconds)

Formats seconds to human-readable duration.

```typescript
formatDuration(3661) // "1h 1m"
formatDuration(125)  // "2m 5s"
formatDuration(45)   // "45s"
```

### formatTimer(seconds)

Formats seconds to timer display.

```typescript
formatTimer(3661)  // "01:01:01"
formatTimer(125)   // "02:05"
formatTimer(45)    // "00:45"
```

### getCategoryColor(category)

Returns the hex color for a category.

```typescript
getCategoryColor('Listing')     // "#10b981" (green)
getCategoryColor('Development') // "#3b82f6" (blue)
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Timer not updating | Check network connection; timer updates every second |
| Entry not saving | Ensure you clicked Stop; check for errors |
| Wrong category | Edit the entry after stopping |
| Paused time wrong | Paused duration is tracked separately from active time |

---

## Source Files

| File | Purpose |
|------|---------|
| [TimeTrackingPanel.tsx](../../../apps/web/src/components/features/workflow/TimeTrackingPanel.tsx) | Timer widget |
| [PomodoroPanel.tsx](../../../apps/web/src/components/features/workflow/PomodoroPanel.tsx) | Pomodoro timer |
| [TimeBreakdownSection.tsx](../../../apps/web/src/components/features/workflow/TimeBreakdownSection.tsx) | Category charts |
| [use-time-tracking.ts](../../../apps/web/src/hooks/use-time-tracking.ts) | Time tracking hooks |

---

## Related Journeys

- [Task Management](./task-management.md) - Tasks also track time when started/completed
- [Weekly Targets](./weekly-targets.md) - Time contributes to productivity metrics

