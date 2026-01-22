# Journey: Vinted Automation Dashboard

> **Entry Point:** `/arbitrage/vinted/automation`
> **Prerequisites:** Scanner configuration, Windows tray application installed
> **Complexity:** Medium

## Purpose

The Vinted Automation Dashboard is the central control panel for managing the automated Vinted LEGO arbitrage scanner. It connects to a Windows tray application that runs locally on your PC, performing scheduled scans of Vinted listings and alerting you when profitable arbitrage opportunities are found.

Unlike the manual [Vinted Arbitrage](./vinted-arbitrage.md) page which requires you to click "Scan", this automation system runs continuously throughout the day according to a smart schedule.

## Key Concepts

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        WINDOWS TRAY APPLICATION                           │
│   HadleyBricksScanner.exe (.NET 8)                                       │
│                                                                           │
│   ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│   │SchedulerEngine  │───►│ ClaudeExecutor  │───►│ Claude CLI      │     │
│   │ - Main loop     │    │ - Prompt loader │    │ --chrome mode   │     │
│   │ - Config poll   │    │ - JSON parser   │    │ (Claude Browser)│     │
│   │ - Heartbeat     │    │ - Timeout mgmt  │    └────────┬────────┘     │
│   └────────┬────────┘    └─────────────────┘             │               │
│            │                                              ▼               │
│            │                                    ┌─────────────────┐     │
│            │                                    │ Chrome Browser  │     │
│            │                                    │ (Claude Browser │     │
│            │                                    │  built-in)      │     │
│            │                                    └────────┬────────┘     │
└────────────┼─────────────────────────────────────────────┼───────────────┘
             │                                              │
             │ Heartbeats/Results                          │ Scan Vinted
             ▼                                              ▼
┌──────────────────────┐                         ┌──────────────────────┐
│  Supabase Backend    │                         │   Vinted.co.uk       │
│  (API + Database)    │                         │   (LEGO listings)    │
└──────────────────────┘                         └──────────────────────┘
             ▲
             │ Dashboard queries
┌────────────┴─────────────────────────────────────────────────────────────┐
│  Web Dashboard  (/arbitrage/vinted/automation)                           │
│  - Scanner control     - Schedule viewer      - Opportunities            │
│  - Connection status   - History             - Watchlist                 │
└──────────────────────────────────────────────────────────────────────────┘
```

### How Scans Work: Claude CLI + Claude Browser

The Windows application uses **Claude CLI** with **Claude Browser** (the `--chrome` flag) to perform browser-based scraping:

```
1. SchedulerEngine triggers scan at scheduled time
2. ClaudeExecutor loads the appropriate prompt file (broad-sweep.md or watchlist.md)
3. Claude CLI is invoked with: --chrome --print --output-format json
4. Claude Browser launches Chrome and navigates to Vinted
5. Claude extracts listings from the page, returns structured JSON
6. ClaudeExecutor parses the JSON result
7. Results are POSTed to /api/arbitrage/vinted/automation/process
8. Server calculates COG%, stores opportunities, sends notifications
```

### Claude CLI Invocation

The scanner executes Claude with these flags:

```powershell
claude --chrome --print --output-format json --dangerously-skip-permissions
```

| Flag | Purpose |
|------|---------|
| `--chrome` | Enables Claude Browser - Claude's built-in browser automation |
| `--print` | Non-interactive mode, outputs result only |
| `--output-format json` | Returns JSON wrapper: `{"type":"result","result":"..."}` |
| `--dangerously-skip-permissions` | Skips confirmation prompts for automation |

The prompt is passed via **stdin**, and the expected output is a JSON `ScanResult` object.

### Prompt Files

Located in `apps/windows-scanner/prompts/`:

| File | Purpose |
|------|---------|
| `broad-sweep.md` | Scans all new LEGO listings on Vinted |
| `watchlist.md` | Scans for a specific set number (template: `{SET_NUMBER}`) |

**Example broad-sweep.md instructions:**
1. Navigate to Vinted LEGO catalog
2. Check for CAPTCHA (detect DataDome iframe, challenge URLs)
3. Extract listing cards: title, price, URL, listing ID
4. Return structured JSON with `success`, `captchaDetected`, `listings[]`

### Scan Types

| Type | Description | Frequency |
|------|-------------|-----------|
| **Broad Sweep** | Scans all new LEGO listings on Vinted | Once per hour during operating hours |
| **Watchlist Scan** | Scans for specific high-demand sets | Multiple times per day, 2-8 minute gaps |

### Windows Scheduler Engine

The `SchedulerEngine` class is the core of the Windows application:

**Main Loop (30-second interval):**
1. Check if within operating hours
2. Check if paused or disabled
3. Find next due scan from schedule
4. Execute scan if one is due
5. Mark scan as executed

**Config Polling (5-minute interval):**
- Fetches latest config from API
- Compares `configVersion` and `scheduleVersion`
- Refreshes schedule if version changed

**Heartbeat (5-minute interval):**
- Sends machine status to API
- Reports: machineId, machineName, status, scansToday, opportunitiesToday
- Receives: configVersion, scheduleVersion (for change detection)

**Missed Scan Policy:**
- Scans are only executed within 5 minutes of scheduled time
- Missed scans are **skipped entirely** (no catch-up)
- Prevents scan bunching after PC wake from sleep

### Operating Hours

The scanner only runs during configured operating hours (default 08:00-22:00). Outside these hours:
- No scans are executed
- The tray app reports status as "Outside Hours"
- Battery and bandwidth are conserved

### COG% Thresholds

Different thresholds can be configured for different scan types:

| Scan Type | Default Threshold | Purpose |
|-----------|-------------------|---------|
| Broad Sweep | 40% | General opportunity detection |
| Watchlist | 45% | Slightly higher tolerance for high-demand sets |
| Near Miss | 50% | Record close misses for analytics |

---

## Dashboard Layout

The automation dashboard is divided into four main sections:

### 1. Scanner Control Panel

Shows overall scanner status and provides controls:

**Status Indicators:**
- 🟢 **Running** — Scanner is active and executing scans
- 🟡 **Paused** — Scanner is temporarily paused (manual or CAPTCHA)
- ⚪ **Disabled** — Scanner is completely disabled

**Controls:**
- **Enable/Disable Toggle** — Master switch for the scanner
- **Pause/Resume Button** — Temporarily halt scanning
- **Regenerate Schedule** — Create a new schedule starting in 2 minutes

**Today's Stats:**
- Broad Sweeps executed
- Watchlist Scans executed
- Opportunities found
- Last scan time

### 2. Connection Status Card

Displays the connection status of the Windows tray application:

**When Connected:**
- Machine name (e.g., "CHRIS-DESKTOP")
- Last heartbeat time
- Current status (Running/Paused/Error)
- Scans and opportunities today

**When Disconnected:**
- Warning banner with troubleshooting tips:
  - Check PC is powered on
  - Verify scanner is running (tray icon)
  - Check internet connection
  - Try restarting the application

**Disconnection Detection:**
- Threshold: 10 minutes without heartbeat
- Heartbeats sent every 60 seconds

### 3. Tabbed Content Area

#### Opportunities Tab (Default)

Displays found arbitrage opportunities:

| Column | Description |
|--------|-------------|
| Set | LEGO set number |
| Name | Set name with Vinted link |
| Vinted | Price on Vinted |
| Amazon | Buy Box price with Amazon link |
| COG% | Cost of Goods percentage (color-coded) |
| Profit | Estimated profit |
| Status | Active/Purchased/Dismissed/Expired |
| Found | Time since discovery |
| Actions | Mark as Purchased or Dismiss |

**Status Filter Options:**
- All
- Active (default)
- Purchased
- Dismissed
- Expired

**Opportunity Actions:**
- 🛒 **Mark as Purchased** — Record that you bought this item
- ✕ **Dismiss** — Remove from active opportunities

#### Schedule Tab

Shows today's scan schedule in a timeline view:

**Visual Elements:**
- Scans grouped by hour
- Timeline with vertical connector
- Status badges: Completed/Running/Upcoming/Missed

**Summary Stats:**
- Total broad sweeps scheduled
- Total watchlist scans scheduled
- Completed vs total scans

**Scan Row Information:**
- Scheduled time (HH:MM)
- Scan type icon (🔍 Broad / 🎯 Watchlist)
- Set number (for watchlist scans)
- Results (if completed): listings found, opportunities found
- Status badge

#### History Tab

Shows historical scan results:

| Column | Description |
|--------|-------------|
| Type | Broad Sweep or Watchlist |
| Set | Set number (for watchlist scans) |
| Status | Success/Failed/Partial/CAPTCHA |
| Listings | Number of listings found |
| Opportunities | Viable opportunities detected |
| Duration | Scan execution time |
| Time | When scan completed |
| Error | Error message if failed |

**Filters:**
- Scan Type: All/Broad Sweep/Watchlist
- Status: All/Success/Failed/CAPTCHA/Partial

**Click any row** to view detailed scan information in a dialog.

#### Watchlist Tab

Shows the 200 tracked sets and their effectiveness:

| Column | Description |
|--------|-------------|
| Set | LEGO set number |
| ASIN | Amazon ASIN (if linked) |
| Source | Best Seller 👑 or Retired 📦 |
| Sales Rank | Amazon sales rank |
| Scans | Total times scanned |
| Listings | Total listings ever found |
| Viable | Opportunities found |
| Last Viable | When last opportunity was found |

**Sorted by:** Most opportunities found, then most recent opportunity

**Filters:**
- Search by set number or ASIN
- Filter by source (Best Seller / Retired)

**Refresh Button:** Repopulate watchlist from Amazon best sellers

---

## Schedule System

### How Schedules are Generated

The schedule is generated daily using a seeded random algorithm:

1. **Seed Creation** — Based on date + user ID + salt
2. **Reproducibility** — Same date produces same schedule
3. **Broad Sweep Slots** — One per operating hour, random minute (0-55)
4. **Watchlist Distribution** — 2-8 minute gaps between scans
5. **Conflict Avoidance** — Watchlist scans stay 5+ minutes from broad sweeps

### Schedule Parameters

| Parameter | Value |
|-----------|-------|
| Broad sweeps per hour | 1 |
| Min watchlist gap | 2 minutes |
| Max watchlist gap | 8 minutes |
| Min gap from broad sweep | 5 minutes |

### Mid-Day Schedule Regeneration

If you need to restart the scanner mid-day:

1. Click **Regenerate Schedule**
2. A new schedule is created starting in 2 minutes
3. Uses a new seed (different from morning schedule)
4. Schedule version is bumped to notify the scanner

---

## User Flows

### Starting the Scanner

1. Install the Windows tray application
2. Navigate to `/arbitrage/vinted/automation`
3. Verify the connection status shows "Connected"
4. Toggle the **Enable** switch to ON
5. The scanner will begin following the daily schedule

### Reviewing Opportunities

1. Navigate to the **Opportunities** tab
2. Review active opportunities (sorted by profit potential)
3. Click the Vinted link to view the listing
4. If interested, purchase on Vinted
5. Return and click 🛒 to mark as purchased
6. Alternatively, click ✕ to dismiss if not interested

### Handling CAPTCHA

When Vinted requires CAPTCHA verification:

1. Scanner automatically pauses
2. Warning banner appears on dashboard
3. Open Vinted in your browser
4. Complete the CAPTCHA challenge
5. Return to dashboard and click **Resume**

### Troubleshooting Connection Issues

If the scanner shows as disconnected:

1. Check if your PC is on and not sleeping
2. Look for the tray icon (H logo) in system tray
3. Right-click tray icon → check status
4. If "Paused", click "Resume"
5. Verify internet connection
6. Try restarting the scanner application

---

## Configuration

Access configuration via the **Configuration** button (⚙️) in the header.

### Available Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Operating Hours Start | 08:00 | When scanning begins |
| Operating Hours End | 22:00 | When scanning stops |
| Broad Sweep COG% | 40% | Threshold for broad sweep opportunities |
| Watchlist COG% | 45% | Threshold for watchlist opportunities |
| Near Miss Threshold | 50% | Record items just above threshold |

---

## API Reference

### GET /api/arbitrage/vinted/automation

Get scanner status and configuration.

**Response:**
```json
{
  "config": {
    "enabled": true,
    "paused": false,
    "pause_reason": null,
    "operating_hours_start": "08:00",
    "operating_hours_end": "22:00",
    "broad_sweep_cog_threshold": 40,
    "watchlist_cog_threshold": 45,
    "schedule_version": 5,
    "last_heartbeat_at": "2026-01-21T14:30:00.000Z",
    "machine_name": "CHRIS-DESKTOP",
    "heartbeat_status": "running"
  },
  "todayStats": {
    "broadSweeps": 8,
    "watchlistScans": 120,
    "opportunitiesFound": 3
  },
  "lastScan": {
    "scan_type": "watchlist",
    "status": "success",
    "listings_found": 5,
    "completed_at": "2026-01-21T14:28:00.000Z"
  }
}
```

### PATCH /api/arbitrage/vinted/automation

Update scanner configuration.

**Request Body:**
```json
{
  "enabled": true,
  "paused": false,
  "broad_sweep_cog_threshold": 40
}
```

### POST /api/arbitrage/vinted/automation/pause

Pause the scanner.

**Request Body:**
```json
{
  "reason": "Manually paused"
}
```

### POST /api/arbitrage/vinted/automation/resume

Resume the scanner.

### POST /api/arbitrage/vinted/automation/schedule/regenerate

Regenerate the schedule starting from now.

**Request Body:**
```json
{
  "startInMinutes": 2
}
```

**Response:**
```json
{
  "date": "2026-01-21",
  "generatedAt": "2026-01-21T14:00:00.000Z",
  "scheduleVersion": 6,
  "operatingHours": { "start": "08:00", "end": "22:00" },
  "scans": [
    {
      "id": "bs-2026-01-21-14-regen",
      "scheduledTime": "14:02:00",
      "type": "broad_sweep"
    },
    {
      "id": "wl-2026-01-21-000-regen",
      "scheduledTime": "14:07:00",
      "type": "watchlist",
      "setNumber": "75192"
    }
  ]
}
```

### GET /api/arbitrage/vinted/automation/schedule

Get today's schedule.

**Query Parameters:**
- `date` (optional) — Date in YYYY-MM-DD format

### GET /api/arbitrage/vinted/automation/opportunities

Get opportunities.

**Query Parameters:**
- `status` — Filter by: active, purchased, dismissed, expired
- `limit` — Max results (default 50)

### PATCH /api/arbitrage/vinted/automation/opportunities/:id

Update opportunity status.

**Request Body:**
```json
{
  "status": "purchased"
}
```

### GET /api/arbitrage/vinted/automation/history

Get scan history.

**Query Parameters:**
- `scanType` — Filter by: broad_sweep, watchlist
- `status` — Filter by: success, failed, captcha, partial
- `limit` — Max results (default 50)

### GET /api/arbitrage/vinted/automation/watchlist

Get watchlist items with stats.

### POST /api/arbitrage/vinted/automation/watchlist/refresh

Refresh watchlist from Amazon best sellers.

---

## Data Model

### vinted_scanner_config

| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | Owner |
| enabled | boolean | Master switch |
| paused | boolean | Temporarily paused |
| pause_reason | text | Why paused |
| operating_hours_start | text | Start time (HH:MM) |
| operating_hours_end | text | End time (HH:MM) |
| broad_sweep_cog_threshold | integer | COG% for broad sweeps |
| watchlist_cog_threshold | integer | COG% for watchlist |
| schedule_version | integer | Incremented on changes |
| last_heartbeat_at | timestamp | Last heartbeat from app |
| machine_name | text | Connected machine name |
| heartbeat_status | text | Current app status |
| consecutive_failures | integer | Error tracking |

### vinted_scan_log

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Scan ID |
| user_id | uuid | Owner |
| scan_type | text | broad_sweep or watchlist |
| set_number | text | For watchlist scans |
| status | text | success/failed/captcha/partial |
| listings_found | integer | Listings discovered |
| opportunities_found | integer | Viable opportunities |
| timing_delay_ms | integer | Execution duration |
| error_message | text | Error details |
| completed_at | timestamp | When finished |

### vinted_opportunities

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Opportunity ID |
| user_id | uuid | Owner |
| scan_log_id | uuid | Source scan |
| set_number | text | LEGO set number |
| set_name | text | Set name |
| asin | text | Amazon ASIN |
| vinted_url | text | Vinted listing URL |
| vinted_price | decimal | Vinted price |
| amazon_price | decimal | Amazon price |
| cog_percent | decimal | COG percentage |
| estimated_profit | decimal | Profit estimate |
| status | text | active/purchased/dismissed/expired |
| found_at | timestamp | When discovered |

### vinted_watchlist

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Item ID |
| user_id | uuid | Owner |
| set_number | text | LEGO set number |
| asin | text | Amazon ASIN |
| source | text | best_seller or popular_retired |
| sales_rank | integer | Amazon sales rank |
| total_scans | integer | Times scanned |
| listings_found | integer | Cumulative listings |
| viable_found | integer | Cumulative opportunities |
| last_viable_at | timestamp | Last opportunity found |

---

## Source Files

### Web Dashboard

| File | Purpose |
|------|---------|
| [automation/page.tsx](../../../apps/web/src/app/(dashboard)/arbitrage/vinted/automation/page.tsx) | Main page |
| [ScannerControlPanel.tsx](../../../apps/web/src/components/features/vinted-automation/ScannerControlPanel.tsx) | Status and controls |
| [ConnectionStatusCard.tsx](../../../apps/web/src/components/features/vinted-automation/ConnectionStatusCard.tsx) | Connection display |
| [OpportunitiesTable.tsx](../../../apps/web/src/components/features/vinted-automation/OpportunitiesTable.tsx) | Opportunities list |
| [ScheduleViewer.tsx](../../../apps/web/src/components/features/vinted-automation/ScheduleViewer.tsx) | Schedule timeline |
| [ScanHistoryTable.tsx](../../../apps/web/src/components/features/vinted-automation/ScanHistoryTable.tsx) | History table |
| [WatchlistPanel.tsx](../../../apps/web/src/components/features/vinted-automation/WatchlistPanel.tsx) | Watchlist management |
| [ScannerConfigDialog.tsx](../../../apps/web/src/components/features/vinted-automation/ScannerConfigDialog.tsx) | Configuration |
| [vinted-schedule.service.ts](../../../apps/web/src/lib/services/vinted-schedule.service.ts) | Schedule generation |
| [vinted-automation.ts](../../../apps/web/src/types/vinted-automation.ts) | Type definitions |
| [use-vinted-automation.ts](../../../apps/web/src/hooks/use-vinted-automation.ts) | React hooks |

### Windows Tray Application

| File | Purpose |
|------|---------|
| [Program.cs](../../../apps/windows-scanner/HadleyBricksScanner/Program.cs) | Entry point |
| [TrayApplicationContext.cs](../../../apps/windows-scanner/HadleyBricksScanner/TrayApplicationContext.cs) | System tray icon and menu |
| [SchedulerEngine.cs](../../../apps/windows-scanner/HadleyBricksScanner/SchedulerEngine.cs) | Core scheduling logic |
| [ClaudeExecutor.cs](../../../apps/windows-scanner/HadleyBricksScanner/ClaudeExecutor.cs) | Claude CLI invocation |
| [ApiClient.cs](../../../apps/windows-scanner/HadleyBricksScanner/ApiClient.cs) | API communication |
| [ConfigManager.cs](../../../apps/windows-scanner/HadleyBricksScanner/ConfigManager.cs) | Local config and caching |
| [prompts/broad-sweep.md](../../../apps/windows-scanner/prompts/broad-sweep.md) | Broad sweep prompt |
| [prompts/watchlist.md](../../../apps/windows-scanner/prompts/watchlist.md) | Watchlist scan prompt |

### Prerequisites for Windows Application

1. **.NET 8 Runtime** — Windows desktop runtime
2. **Claude CLI** — Installed globally via npm (`npm install -g @anthropic-ai/claude-code`)
3. **Chrome Browser** — For Claude Browser automation (uses system Chrome)
4. **API Key** — Configured in the tray application settings

---

## Related Journeys

- [Vinted Arbitrage (Manual)](./vinted-arbitrage.md) — Manual scanning interface
- [Amazon Arbitrage](./amazon-arbitrage.md) — Compare vs BrickLink prices
- [Seeded ASINs](./seeded-asins.md) — Manage tracked ASINs
