# Journey: Pickup Scheduling

> **Entry Point:** `/workflow` (Pickup Calendar Panel)
> **Prerequisites:** None
> **Complexity:** Medium

## Purpose

Schedule and manage stock collection trips. Track upcoming pickups, record outcomes, and optionally sync appointments to Google Calendar for reminders and navigation.

---

## Key Concepts

### Pickup Statuses

| Status | Description |
|--------|-------------|
| `scheduled` | Appointment is booked, awaiting collection |
| `in_progress` | Currently at the pickup location |
| `completed` | Pickup finished (see outcome) |
| `cancelled` | Pickup was cancelled |

### Pickup Outcomes

| Outcome | Description |
|---------|-------------|
| `successful` | Collected all expected stock |
| `partial` | Collected some items |
| `unsuccessful` | No stock collected |
| `rescheduled` | Moved to new date |

### Google Calendar Integration

Pickups can be synced to Google Calendar:
- Creates calendar event with location
- Includes estimated value and notes
- Provides navigation link
- Sends reminder notifications

---

## User Flow

### Step 1: View Pickup Calendar

1. Navigate to `/workflow`
2. Locate **Pickup Calendar Panel** in right sidebar
3. Mini calendar shows days with scheduled pickups (highlighted)
4. List below shows upcoming pickups

### Step 2: Schedule a Pickup

1. Click **Schedule Pickup** button
2. Fill in the dialog:
   - **Title** (required): "Collection from John - Harry Potter sets"
   - **Date** (required): Select from calendar
   - **Time**: Start time (e.g., 10:00)
   - **End Time**: Expected finish time
   - **Address**: Full collection address
     - Address Line 1
     - Address Line 2 (optional)
     - City
     - Postcode
   - **Estimated Value**: Expected stock value
   - **Agreed Price**: Negotiated purchase price
   - **Source Platform**: Where you found the seller (Facebook, Gumtree, etc.)
   - **Notes**: Additional details
3. Click **Create Pickup**
4. Pickup appears on calendar and in list

### Step 3: View Pickup Details

1. Click on a pickup in the list
2. Detail view shows:
   - Full address with map link
   - Date and time
   - Estimated vs agreed value
   - Status and notes
3. Quick actions available from this view

### Step 4: Add to Google Calendar

1. Open pickup details
2. Click **Add to Calendar** button
3. Authenticates with Google (first time only)
4. Event created in your calendar
5. Calendar event ID stored for reference

### Step 5: Start a Pickup

1. On the day of pickup, find it in the list
2. Click **Start** or change status to `in_progress`
3. Use the address to navigate

### Step 6: Complete a Pickup

1. After collection, click **Complete**
2. Record outcome dialog appears:
   - **Outcome**: successful, partial, unsuccessful, rescheduled
   - **Final Amount Paid**: Actual purchase amount
   - **Mileage**: Round-trip distance
   - **Completion Notes**: What happened
3. Click **Save**
4. Pickup moves to completed status

---

## Calendar Panel Features

### Mini Calendar

- Current month displayed
- Days with pickups are highlighted
- Click a day to filter the list
- Navigate months with arrows

### Upcoming List

Shows pickups for the next 7 days:
- Title and date/time
- Status badge
- Quick complete button
- Click to expand details

### Stats Summary

Above the calendar:
- Upcoming pickups count
- This week's pickups
- Completed this month
- Total value collected

---

## Managing Pickups

### Edit a Pickup

1. Click on the pickup to open details
2. Click **Edit**
3. Modify any field
4. Save changes
5. Google Calendar event updates if linked

### Cancel a Pickup

1. Open pickup details
2. Click **Cancel**
3. Confirm cancellation
4. Status changes to `cancelled`
5. Google Calendar event is removed if linked

### Delete a Pickup

1. Open pickup details
2. Click **Delete**
3. Confirm deletion
4. Pickup is permanently removed

### Reschedule a Pickup

1. Complete pickup with outcome `rescheduled`
2. Create a new pickup for the new date
3. Reference the original in notes

---

## Recurring Pickups

For regular collection routes:

1. Create the pickup as normal
2. Toggle **Is Recurring** on
3. Set **Recurrence Pattern** (weekly, monthly)
4. System can generate future instances

Note: Recurring pickup feature may be partially implemented.

---

## Linking to Purchases

Pickups can be linked to purchase records:

1. After completing a pickup
2. Go to Purchases page
3. Create purchase with pickup reference
4. Or link existing purchase to pickup ID

This connects cost/value data for profitability analysis.

---

## API Reference

### GET /api/pickups

Get pickups for a specific month.

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| year | number | Year (e.g., 2026) |
| month | number | Month (1-12) |

**Response:**
```json
{
  "pickups": [
    {
      "id": "uuid",
      "title": "Collection from John",
      "scheduled_date": "2026-01-25",
      "scheduled_time": "10:00",
      "scheduled_end_time": "11:00",
      "address_line1": "123 Main Street",
      "city": "Manchester",
      "postcode": "M1 1AA",
      "estimated_value": 500,
      "agreed_price": 400,
      "status": "scheduled",
      "source_platform": "Facebook"
    }
  ],
  "month": 1,
  "year": 2026
}
```

### GET /api/pickups/upcoming

Get pickups for the next 7 days.

### GET /api/pickups/stats

Get pickup statistics.

**Response:**
```json
{
  "upcoming": 3,
  "thisWeek": 2,
  "completedThisMonth": 5,
  "totalValueThisMonth": 2500
}
```

### POST /api/pickups

Create a new pickup.

**Request Body:**
```json
{
  "title": "Collection from John",
  "scheduled_date": "2026-01-25",
  "scheduled_time": "10:00",
  "scheduled_end_time": "11:00",
  "address_line1": "123 Main Street",
  "address_line2": "Flat 4",
  "city": "Manchester",
  "postcode": "M1 1AA",
  "estimated_value": 500,
  "agreed_price": 400,
  "source_platform": "Facebook",
  "notes": "Call on arrival"
}
```

### PATCH /api/pickups/[id]

Update a pickup.

**Request Body:**
```json
{
  "scheduled_time": "11:00",
  "notes": "Rescheduled to later"
}
```

### POST /api/pickups/[id]/complete

Mark a pickup as complete.

**Request Body:**
```json
{
  "outcome": "successful",
  "final_amount_paid": 380,
  "mileage": 45,
  "completion_notes": "Collected 12 sets in excellent condition"
}
```

### POST /api/pickups/[id]/cancel

Cancel a pickup.

### DELETE /api/pickups/[id]

Delete a pickup.

### POST /api/pickups/[id]/calendar

Add pickup to Google Calendar.

**Response:**
```json
{
  "eventId": "google-calendar-event-id",
  "eventUrl": "https://calendar.google.com/..."
}
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Calendar not showing pickups | Ensure correct month is selected |
| Google Calendar not syncing | Re-authenticate with Google; check permissions |
| Address not showing on map | Verify postcode is correct format |
| Mileage not calculating | Feature may require manual entry |

---

## Source Files

| File | Purpose |
|------|---------|
| [PickupCalendarPanel.tsx](../../../apps/web/src/components/features/workflow/PickupCalendarPanel.tsx) | Calendar widget |
| [SchedulePickupDialog.tsx](../../../apps/web/src/components/features/workflow/SchedulePickupDialog.tsx) | Pickup form |
| [use-pickups.ts](../../../apps/web/src/hooks/use-pickups.ts) | Pickup data hooks |
| [use-google-calendar.ts](../../../apps/web/src/hooks/use-google-calendar.ts) | Calendar integration |

---

## Related Journeys

- [Task Management](./task-management.md) - Pickups can create tasks
- [Purchases](../purchases/overview.md) - Link pickups to purchases

