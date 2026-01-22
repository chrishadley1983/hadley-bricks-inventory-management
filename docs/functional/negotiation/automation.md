# Journey: Automation

> **Entry Point:** `/orders` (Offers tab → Settings)
> **Prerequisites:** eBay OAuth connected
> **Complexity:** Low

## Purpose

Enable automatic sending of discount offers to interested buyers throughout the day. The system processes all eligible listings on a schedule without manual intervention.

---

## Key Concepts

### Automation Schedule

When enabled, offers are sent automatically at:
- 8:00 AM UK time
- 12:00 PM UK time
- 4:00 PM UK time
- 8:00 PM UK time

This catches buyers at different times of day.

### Cron Job

The automation runs via Vercel Cron:
- Endpoint: `/api/cron/negotiation`
- Protected by CRON_SECRET header
- Processes all eligible listings for the user

### Notifications

After each automated run:
- Pushover notification sent (if configured)
- Shows offers sent and any failures
- Priority elevated if errors occurred

---

## User Flow

### Step 1: Open Settings

1. Navigate to `/orders`
2. Click **Offers** tab
3. Click **Settings** button
4. Modal opens with configuration options

### Step 2: Enable Automation

1. Find **Enable Automation** toggle
2. Switch to ON
3. Alert changes to "Automation Enabled"
4. Shows schedule and last run time

### Step 3: Configure Settings

While automation is enabled, configure:
- **Min Days Before Offer** - How old listings must be
- **Re-Offer Cooldown** - Days between re-offers
- **Re-Offer Escalation** - Extra % on re-offers
- **Scoring Weights** - Factor importance
- **Discount Rules** - Score → discount mapping
- **Message Template** - Personalised offer text

### Step 4: Monitor Results

Check automation progress via:
1. **Status Alert** - Shows last run time
2. **Metrics Dashboard** - Running totals
3. **Recent Offers Table** - Individual offers
4. **Pushover Notifications** - Real-time alerts

---

## Cron Job Details

### Trigger

```
Schedule: 0 8,12,16,20 * * *
Timezone: Europe/London
```

### Process Flow

1. Verify CRON_SECRET header
2. Get user with automation enabled
3. Initialize negotiation service
4. Fetch eligible listings from eBay
5. Calculate scores and discounts
6. Send offers via eBay API
7. Record results in database
8. Update config with last run time
9. Send notification if offers sent

### Configuration

In `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/negotiation",
      "schedule": "0 8,12,16,20 * * *"
    }
  ]
}
```

---

## Status Indicators

### Automation Enabled Alert

When enabled:
```
ℹ️ Automation Enabled
Offers will be sent automatically at 8am, 12pm, 4pm, and 8pm UK time.
Last run: 21/01/2026, 12:00:00. Sent 5 offers.
```

### Manual Mode Alert

When disabled:
```
⚠️ Manual Mode
Automatic offer sending is disabled. Use the button above to send offers manually, or enable automation in settings.
```

---

## Notification Content

### Success

```
Title: eBay Offers Sent
Message: 12 offer(s) sent to interested buyers
Priority: Normal (0)
```

### With Failures

```
Title: eBay Offers Sent
Message: 8 offer(s) sent, 2 failed
Priority: High (1)
```

### Nothing to Send

No notification sent if 0 offers and 0 failures.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Automation not running | Check Vercel cron logs; verify CRON_SECRET |
| No offers being sent | Check eligible listings exist; review min days |
| Wrong time zone | Cron uses Europe/London; verify schedule |
| Missing notifications | Check Pushover credentials |
| Too many offers | Adjust minDaysBeforeOffer or discount rules |

### Check Cron Logs

1. Go to Vercel Dashboard
2. Select project
3. Click "Logs"
4. Filter by "Cron"
5. View execution history

---

## API Reference

### GET /api/cron/negotiation

Called by Vercel Cron scheduler.

**Headers Required:**
- `Authorization: Bearer <CRON_SECRET>`

**Response:**
```json
{
  "success": true,
  "data": {
    "offersSent": 12,
    "offersFailed": 0,
    "eligibleCount": 8
  }
}
```

---

## Source Files

| File | Purpose |
|------|---------|
| [negotiation/route.ts](../../../apps/web/src/app/api/cron/negotiation/route.ts) | Cron endpoint |
| [negotiation.service.ts](../../../apps/web/src/lib/ebay/negotiation.service.ts) | Automated processing |
| [pushover.service.ts](../../../apps/web/src/lib/notifications/pushover.service.ts) | Notifications |
| [vercel.json](../../../vercel.json) | Cron schedule |

---

## Related Journeys

- [Manual Offers](./manual-offers.md) - Send offers manually
- [Configuration](./configuration.md) - Adjust automation settings
