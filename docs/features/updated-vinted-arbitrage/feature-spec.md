# Feature Specification: Updated Vinted Arbitrage (v2)

**Generated:** 2026-01-21
**Based on:** done-criteria.md (214 criteria)
**Status:** READY_FOR_BUILD
**Version:** 2.0

---

## 1. Summary

This feature replaces the manual Vinted arbitrage scanning functionality with a fully automated system. The v2 architecture introduces a **split design**: the server generates randomised daily schedules with seeded reproducibility, while a **native Windows tray application** executes scans using Claude Code with the Chrome extension.

The system operates in two modes: broad sweep (hourly generic LEGO searches) and watchlist (continuous monitoring of 200 tracked sets). It includes comprehensive safety controls (CAPTCHA detection, randomised timing, automatic pause), push notifications via Pushover, a full-featured dashboard UI with local service connection status, and watchlist effectiveness tracking.

**Key Changes in v2:**
- **Server-side schedule generation** with seeded randomisation for reproducibility
- **Native Windows tray application** (.NET 8/C#) replacing PowerShell cron scripts
- **Heartbeat communication** for real-time connection status
- **Config/schedule polling** for dynamic updates without restart
- **Dashboard connection status** showing local service state

---

## 2. Criteria Mapping

### Phase 0: Deprecation Prep (5 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| DP1: extractSetNumber utility | Extract from existing route.ts to `lib/utils/set-number-extraction.ts` |
| DP2: Unit tests for extraction | Create test file with 8+ test cases covering all patterns |
| DP3: ASIN matching utility | Extract to `lib/services/asin-matching.service.ts` |
| DP4: COG% calculation utility | Extract to `lib/utils/arbitrage-calculations.ts` with constants |
| DP5: Brickset format conversion | Add to ASIN matching service (append "-1") |

### Phase 1: Database (10 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| DB1-DB7, DB10: New tables | Single migration file with 8 tables |
| DB8: RLS policies | Add policies in same migration |
| DB9: Indexes | Add FK indexes in migration |

### Phase 1: Sales Rank (6 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| SR1-SR6: Bootstrap endpoint | `/api/admin/sales-rank/bootstrap` with batching |

### Phase 1: Watchlist (6 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| WL1-WL6: Refresh endpoint | `/api/arbitrage/vinted/watchlist/refresh` |

### Phase 2: Scanner Core (23 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| BS1-BS12: Broad Sweep | Claude prompt + processing API |
| WS1-WS5: Watchlist Scan | Parameterised prompt file |
| CD1-CD6: CAPTCHA Detection | Instructions in Claude prompts + API handling |

### Phase 2: Scheduling - Server-Side (10 criteria) **NEW v2**

| Criterion | Implementation Approach |
|-----------|------------------------|
| SCHED1-SCHED10: Schedule API | `/api/arbitrage/vinted/automation/schedule` with seeded random |

### Phase 2: Config API (3 criteria) **NEW v2**

| Criterion | Implementation Approach |
|-----------|------------------------|
| CFG1-CFG3: Config endpoint | `/api/arbitrage/vinted/automation/config` with version tracking |

### Phase 2: Heartbeat API (5 criteria) **NEW v2**

| Criterion | Implementation Approach |
|-----------|------------------------|
| HB1-HB5: Heartbeat endpoint | `/api/arbitrage/vinted/automation/heartbeat` with status storage |

### Phase 3: Alerts (9 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| AL1-AL9: Pushover methods | Extend existing `pushover.service.ts` |

### Phase 4: UI (47 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| UI1-UI41: Dashboard | `/arbitrage/vinted/automation` with all sections |
| DCS1-DCS5: Connection Status | Local service status card with troubleshooting |

### Phase 5: Polish (7 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| EH1-EH4: Error handling | Standard patterns across routes |
| DL1-DL3: Cleanup job | Cron job for opportunity lifecycle |

### Phase 6: Deprecation (8 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| DEP1-DEP5: Remove old feature | Delete files, update navigation |
| MIG1-MIG3: Migration verification | Tests for calculation parity |

### Windows Tray Application (43 criteria) **NEW v2**

| Category | Implementation Approach |
|----------|------------------------|
| TRAY1-TRAY3: Project Structure | .NET 8 WinForms project with NotifyIcon |
| INST1-INST6: Installation | MSI installer with prerequisites |
| TUI1-TUI7: Tray Interface | System tray with 4 color states, context menu |
| LOOP1-LOOP9: Main Loop | 30-second polling, scan execution |
| POLL1-POLL4: Config Polling | 5-minute polling with version detection |
| THB1-THB3: Heartbeat | 5-minute heartbeat with machine ID |
| TERR1-TERR4: Error Handling | Retry logic, cached schedule fallback |
| MISS1-MISS3: Missed Scans | Skip policy, no catch-up |
| LOG1-LOG4: Logging | Daily log files with 30-day retention |

### Cross-cutting (28 criteria)

| Category | Implementation Approach |
|----------|------------------------|
| Safety (5) | Safety protocol documentation + test periods |
| Randomisation (6) | Seeded random in schedule generation |
| Operating Hours (3) | Hour checks in schedule + local service |
| Your Data Popup (5) | HoverCard component with data fetching |
| Cleanup Jobs (4) | Scheduled cron for opportunity lifecycle |
| Code Quality (3) | TypeScript, ESLint, Zod validation |

---

## 3. Architecture

### 3.1 System Overview (v2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SERVER (Vercel/Next.js)                              │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    Schedule Generation Engine                         │    │
│  │                                                                       │    │
│  │  GET /api/arbitrage/vinted/automation/schedule                        │    │
│  │  ├── Fetch watchlist (200 sets)                                       │    │
│  │  ├── Shuffle with seeded random (date-based)                          │    │
│  │  ├── Assign broad sweep slots (1/hour, random 0-55 min)               │    │
│  │  ├── Distribute watchlist (2-8 min gaps)                              │    │
│  │  ├── Ensure 5+ min separation broad/watchlist                         │    │
│  │  └── Return sorted ScheduledScan[]                                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         API Endpoints                                 │    │
│  │                                                                       │    │
│  │  GET  /config      ── Return config + versions                        │    │
│  │  POST /heartbeat   ── Receive status, return versions                 │    │
│  │  POST /process     ── Receive scan results, calculate COG%, alert     │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │ HTTPS (polling every 5 min)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              WINDOWS TRAY APPLICATION (.NET 8 / C#)                          │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────────┐   │
│  │ System Tray  │  │  Scheduler   │  │      Claude Code CLI             │   │
│  │    Icon      │  │   Engine     │  │      + Chrome Browser            │   │
│  │              │  │              │  │                                  │   │
│  │ 🟢 Running   │  │ • Load sched │  │ • Execute scan prompts           │   │
│  │ 🟡 Paused    │  │ • Check due  │  │ • Extract DOM data               │   │
│  │ 🔴 Error     │  │ • Execute    │  │ • Detect CAPTCHA                 │   │
│  │ ⚪ Off-hours │  │ • Post result│  │ • Return JSON results            │   │
│  └──────────────┘  └──────────────┘  └──────────────────────────────────┘   │
│         │                 │                         │                        │
│         │                 │                         ▼                        │
│         │                 │                ┌──────────────────┐              │
│         │                 └───────────────▶│  Vinted.co.uk    │              │
│         │                                  │  (real browser)  │              │
│         │                                  └──────────────────┘              │
│         │                                                                    │
│         └─── Context Menu:                                                   │
│              • Resume/Pause                                                  │
│              • Refresh Schedule                                              │
│              • Open Dashboard                                                │
│              • Settings                                                      │
│              • View Logs                                                     │
│              • Exit                                                          │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         Background Workers                            │    │
│  │                                                                       │    │
│  │  Main Loop (30s)    │ Config Poll (5min) │ Heartbeat (5min)          │    │
│  │  ├── Check due scan │ ├── GET /config    │ ├── POST /heartbeat       │    │
│  │  ├── Execute Claude │ ├── Compare version│ └── Update local state    │    │
│  │  ├── POST /process  │ └── Refresh if new │                           │    │
│  │  └── Mark executed  │                    │                           │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  Logs: %LOCALAPPDATA%\HadleyBricks\Scanner\logs\scanner-YYYY-MM-DD.log      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                      │
│                                                                              │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐   │
│  │vinted_scanner_   │  │vinted_watchlist  │  │vinted_opportunities      │   │
│  │config            │  │                  │  │                          │   │
│  │                  │  │ - 200 tracked    │  │ - Viable items found     │   │
│  │ - enabled        │  │   sets           │  │ - status: active/        │   │
│  │ - paused         │  │ - source: best/  │  │   purchased/dismissed    │   │
│  │ - thresholds     │  │   retired        │  │ - COG%, profit           │   │
│  │ - config_version │  │ - schedule_ver   │  │ - Visual aging           │   │
│  │ - schedule_ver   │  │                  │  │                          │   │
│  │ - last_heartbeat │  │                  │  │                          │   │
│  │ - machine_id     │  │                  │  │                          │   │
│  │ - machine_status │  │                  │  │                          │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Communication Flow (v2)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         STARTUP SEQUENCE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Windows Tray App                           Server                           │
│       │                                        │                             │
│       │──── GET /config ──────────────────────▶│                             │
│       │◀─── { enabled, paused, versions } ────│                             │
│       │                                        │                             │
│       │──── GET /schedule ────────────────────▶│                             │
│       │◀─── { scans: ScheduledScan[] } ───────│                             │
│       │                                        │                             │
│       ├── Store schedule locally               │                             │
│       ├── Show tray icon (green/grey)          │                             │
│       └── Start main loop                      │                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         MAIN LOOP (every 30 seconds)                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  if (outside operating hours) → sleep, set icon grey                         │
│  if (config.paused) → sleep, set icon yellow                                 │
│                                                                              │
│  for (scan in schedule where scheduledTime <= now AND !executed):            │
│      │                                                                       │
│      ├── Execute Claude CLI with scan prompt                                 │
│      │   └── claude --chrome -p "broad-sweep.md" --output-format json        │
│      │                                                                       │
│      ├── Parse JSON result                                                   │
│      │   └── { listings: [...], captchaDetected: bool, pagesScanned: n }     │
│      │                                                                       │
│      ├── POST /process ───────────────────────▶ Server                       │
│      │   └── { scanType, setNumber?, listings, captchaDetected }             │
│      │                                                                       │
│      ├◀── { opportunities: [...], alertsSent: n } ─────────────────────────  │
│      │                                                                       │
│      └── Mark scan as executed locally                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         HEARTBEAT (every 5 minutes)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Windows Tray App                           Server                           │
│       │                                        │                             │
│       │──── POST /heartbeat ──────────────────▶│                             │
│       │     { machineId, status, scansToday,   │                             │
│       │       opportunitiesToday, lastScanAt } │                             │
│       │                                        │                             │
│       │◀─── { configVersion, scheduleVersion,  │                             │
│       │       serverTime } ───────────────────│                             │
│       │                                        │                             │
│       ├── if (configVersion changed):          │                             │
│       │   └── GET /config                      │                             │
│       │                                        │                             │
│       ├── if (scheduleVersion changed):        │                             │
│       │   └── GET /schedule                    │                             │
│       │                                        │                             │
│       └── Update dashboard connection status   │                             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Integration Points

| Integration | Location | Purpose | Risk Level |
|-------------|----------|---------|------------|
| Existing `PushoverService` | `lib/notifications/pushover.service.ts` | Alerts | Low - extend existing |
| Existing `AmazonPricingClient` | `lib/amazon/amazon-pricing.client.ts` | Price lookup | Low - reuse |
| Existing `seeded_asins` table | Database | ASIN→Set mapping | Low - query only |
| Existing `brickset_sets` table | Database | Set metadata | Low - query only |
| New Claude Code integration | Windows app + prompts | Vinted scanning | Medium - new pattern |
| New Windows tray application | Separate .NET project | Local execution | Medium - new technology |
| Existing cron patterns | `vercel.json` + routes | Cleanup jobs | Low - follow pattern |

### 3.4 Technology Decisions

#### Decision 1: Server-Side Schedule Generation (NEW v2)

**Options:**
A) Client-side randomisation (v1 approach)
B) Server-side generation with seeded random (v2)
C) Hybrid (client generates, server validates)

**Decision:** Option B

**Rationale:**
- **Reproducibility:** Same date + same watchlist = same schedule (for debugging)
- **Auditability:** Server can log/review what was scheduled
- **Versioning:** `scheduleVersion` enables dynamic updates
- **Simplicity:** Local service just follows schedule, no randomisation logic

#### Decision 2: Native Windows Tray App (NEW v2)

**Options:**
A) PowerShell scheduled tasks (v1 approach)
B) Node.js background service
C) .NET 8 Windows Forms tray app (v2)

**Decision:** Option C

**Rationale:**
- **Reliability:** Native Windows integration, proper auto-start
- **UX:** System tray icon with status, context menu, tooltips
- **Maintainability:** C# is more maintainable than PowerShell scripts
- **Features:** Better process management, logging, error handling
- **User control:** Easy pause/resume without touching terminal

#### Decision 3: Heartbeat Communication (NEW v2)

**Options:**
A) No heartbeat (v1 - fire and forget)
B) Heartbeat with polling (v2)
C) WebSocket real-time connection

**Decision:** Option B

**Rationale:**
- **Connection visibility:** Dashboard knows if local service is running
- **Dynamic updates:** Config/schedule changes propagate without restart
- **Simplicity:** Polling is simpler than WebSocket for this use case
- **Resilience:** Works across network interruptions

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| **Database** | | |
| `supabase/migrations/20260121_vinted_automation_v2.sql` | Add version columns, heartbeat fields | 50 |
| **API Routes (v2)** | | |
| `apps/web/src/app/api/arbitrage/vinted/automation/schedule/route.ts` | Schedule generation | 200 |
| `apps/web/src/app/api/arbitrage/vinted/automation/config/route.ts` | Config with versions | 100 |
| `apps/web/src/app/api/arbitrage/vinted/automation/heartbeat/route.ts` | Heartbeat handler | 80 |
| **Schedule Generation** | | |
| `apps/web/src/lib/services/vinted-schedule.service.ts` | Schedule generation logic | 250 |
| `apps/web/src/lib/utils/seeded-random.ts` | cyrb53 hash + seeded random | 50 |
| **UI Components (v2)** | | |
| `apps/web/src/components/features/vinted-automation/ConnectionStatusCard.tsx` | Local service status | 120 |
| **Windows Tray App** | | |
| `apps/windows-scanner/HadleyBricksScanner.sln` | Visual Studio solution | - |
| `apps/windows-scanner/HadleyBricksScanner/HadleyBricksScanner.csproj` | .NET 8 project | 30 |
| `apps/windows-scanner/HadleyBricksScanner/Program.cs` | Entry point | 30 |
| `apps/windows-scanner/HadleyBricksScanner/TrayIcon.cs` | System tray integration | 150 |
| `apps/windows-scanner/HadleyBricksScanner/SchedulerEngine.cs` | Main loop + scheduling | 300 |
| `apps/windows-scanner/HadleyBricksScanner/ApiClient.cs` | HTTP client for server | 200 |
| `apps/windows-scanner/HadleyBricksScanner/ClaudeExecutor.cs` | Claude CLI execution | 150 |
| `apps/windows-scanner/HadleyBricksScanner/ConfigManager.cs` | Local config + caching | 100 |
| `apps/windows-scanner/HadleyBricksScanner/LogManager.cs` | Daily log files | 80 |
| `apps/windows-scanner/HadleyBricksScanner/Models/` | Data models | 100 |
| `apps/windows-scanner/HadleyBricksScanner/Resources/` | Icons (green/yellow/red/grey) | - |
| `apps/windows-scanner/Installer/installer.wxs` | WiX installer config | 150 |
| **Claude Prompts (unchanged)** | | |
| `scripts/vinted-scanner/broad-sweep.md` | Claude prompt for broad sweep | 80 |
| `scripts/vinted-scanner/watchlist-scan.md` | Claude prompt for watchlist | 80 |

**Total New Files:** ~25 (server) + ~15 (Windows app) = ~40
**Total Estimated Lines:** ~2,500 (server) + ~1,500 (Windows app) = ~4,000

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/lib/notifications/pushover.service.ts` | Add 4 new methods | 80 |
| `apps/web/src/components/layout/Sidebar.tsx` | Update Vinted nav link | 5 |
| `apps/web/src/app/(dashboard)/arbitrage/vinted/automation/page.tsx` | Add connection status section | 50 |
| `apps/web/src/hooks/use-vinted-automation.ts` | Add connection status hook | 40 |
| `vercel.json` | Add cleanup cron | 5 |
| `supabase/migrations/20260121200001_vinted_automation.sql` | Add version columns | 20 |

**Total Modified:** 6 files
**Total Lines Changed:** ~200

### 4.3 Deleted Files

| File | Reason |
|------|--------|
| `apps/web/src/app/(dashboard)/arbitrage/vinted/page.tsx` | Replaced by automation page |
| `apps/web/src/app/api/arbitrage/vinted/route.ts` | Logic extracted to shared utilities |
| `scripts/vinted-scanner/*.ps1` | Replaced by Windows tray app |

---

## 5. Implementation Details

### 5.1 Schedule Generation API

```typescript
// GET /api/arbitrage/vinted/automation/schedule

interface ScheduleResponse {
  date: string;                    // "2026-01-21"
  generatedAt: string;             // ISO timestamp
  scheduleVersion: number;         // Increments on watchlist change
  operatingHours: {
    start: string;                 // "08:00"
    end: string;                   // "22:00"
  };
  scans: ScheduledScan[];
}

interface ScheduledScan {
  id: string;                      // Unique ID for tracking
  scheduledTime: string;           // "08:17:00" (local time)
  type: 'broad_sweep' | 'watchlist';
  setNumber?: string;              // Only for watchlist
  setName?: string;                // "Millennium Falcon"
}
```

**Schedule Generation Rules:**
1. **Broad sweeps:** 14 per day (once per hour, 08:00-22:00), random minute 0-55
2. **Watchlist:** 200 sets distributed with 2-8 minute random gaps
3. **Separation:** Minimum 5 minutes between broad sweep and nearest watchlist
4. **Seeded random:** `cyrb53(date + salt)` for reproducibility
5. **Shuffle:** Watchlist order randomised daily

### 5.2 Config API

```typescript
// GET /api/arbitrage/vinted/automation/config

interface ConfigResponse {
  enabled: boolean;
  paused: boolean;
  pauseReason?: string;
  broadSweepCogThreshold: number;
  watchlistCogThreshold: number;
  nearMissThreshold: number;
  operatingHoursStart: string;
  operatingHoursEnd: string;
  configVersion: number;           // Increments on config change
  scheduleVersion: number;         // Increments on watchlist change
}
```

### 5.3 Heartbeat API

```typescript
// POST /api/arbitrage/vinted/automation/heartbeat

interface HeartbeatRequest {
  machineId: string;               // Unique installation ID
  status: 'running' | 'paused' | 'error' | 'outside_hours';
  lastScanAt?: string;             // ISO timestamp
  scansToday: number;
  opportunitiesToday: number;
  errorMessage?: string;
}

interface HeartbeatResponse {
  configVersion: number;           // Client compares to detect changes
  scheduleVersion: number;         // Client compares to detect changes
  serverTime: string;              // For clock sync validation
}
```

### 5.4 Database Schema Updates (v2)

```sql
-- Add to vinted_scanner_config table
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  config_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  schedule_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  last_heartbeat_at TIMESTAMPTZ;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  machine_id TEXT;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  machine_status TEXT CHECK (machine_status IN ('running', 'paused', 'error', 'outside_hours', 'disconnected'));
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  machine_name TEXT;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  scans_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vinted_scanner_config ADD COLUMN IF NOT EXISTS
  opportunities_today INTEGER NOT NULL DEFAULT 0;

-- Create trigger to increment config_version on update
CREATE OR REPLACE FUNCTION increment_config_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.config_version := OLD.config_version + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vinted_config_version_trigger
BEFORE UPDATE OF enabled, paused, broad_sweep_cog_threshold,
                watchlist_cog_threshold, near_miss_threshold,
                operating_hours_start, operating_hours_end
ON vinted_scanner_config
FOR EACH ROW
EXECUTE FUNCTION increment_config_version();
```

### 5.5 Windows Tray Application Structure

```
apps/windows-scanner/
├── HadleyBricksScanner.sln
├── HadleyBricksScanner/
│   ├── HadleyBricksScanner.csproj
│   ├── Program.cs                    # Entry point, single instance check
│   ├── TrayIcon.cs                   # NotifyIcon, context menu, icon states
│   ├── SchedulerEngine.cs            # Main loop, scan execution
│   ├── ApiClient.cs                  # HTTP client (config, schedule, heartbeat, process)
│   ├── ClaudeExecutor.cs             # Claude CLI invocation, JSON parsing
│   ├── ConfigManager.cs              # Local config cache, version tracking
│   ├── LogManager.cs                 # Daily log files, 30-day cleanup
│   ├── Models/
│   │   ├── ScheduledScan.cs
│   │   ├── ScanResult.cs
│   │   ├── ConfigResponse.cs
│   │   └── HeartbeatRequest.cs
│   └── Resources/
│       ├── icon-green.ico            # Running
│       ├── icon-yellow.ico           # Paused
│       ├── icon-red.ico              # Error
│       └── icon-grey.ico             # Outside hours
├── Installer/
│   ├── installer.wxs                 # WiX installer definition
│   └── assets/                       # Installer graphics
└── README.md                         # Build and installation instructions
```

### 5.6 Tray Application Main Loop (Pseudocode)

```csharp
// SchedulerEngine.cs
public class SchedulerEngine
{
    private List<ScheduledScan> _schedule;
    private HashSet<string> _executedScans;
    private ConfigResponse _config;

    public async Task RunAsync(CancellationToken ct)
    {
        // Startup
        _config = await _apiClient.GetConfigAsync();
        _schedule = await _apiClient.GetScheduleAsync();

        // Start background workers
        _ = Task.Run(() => HeartbeatLoopAsync(ct));
        _ = Task.Run(() => ConfigPollLoopAsync(ct));

        // Main loop
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(30_000, ct); // 30 seconds

            if (!IsWithinOperatingHours())
            {
                _trayIcon.SetState(TrayState.OutsideHours);
                continue;
            }

            if (_config.Paused)
            {
                _trayIcon.SetState(TrayState.Paused);
                continue;
            }

            _trayIcon.SetState(TrayState.Running);

            var dueScan = GetNextDueScan();
            if (dueScan != null && !_executedScans.Contains(dueScan.Id))
            {
                await ExecuteScanAsync(dueScan);
                _executedScans.Add(dueScan.Id);
            }
        }
    }

    private async Task ExecuteScanAsync(ScheduledScan scan)
    {
        try
        {
            var result = await _claudeExecutor.RunScanAsync(scan);

            if (result.CaptchaDetected)
            {
                await _apiClient.PauseScannerAsync("CAPTCHA detected");
                _trayIcon.ShowBalloon("CAPTCHA Detected", "Scanner paused");
                return;
            }

            await _apiClient.PostProcessAsync(scan, result);
            _log.Info($"Scan completed: {scan.Type} - {scan.SetNumber ?? "generic"}");
        }
        catch (Exception ex)
        {
            _log.Error($"Scan failed: {ex.Message}");
            // Don't pause on transient errors - just skip and continue
        }
    }
}
```

### 5.7 Connection Status UI Component

```tsx
// ConnectionStatusCard.tsx
interface ConnectionStatus {
  connected: boolean;
  lastSeenAt?: Date;
  machineId?: string;
  machineName?: string;
  status?: 'running' | 'paused' | 'error' | 'outside_hours';
  scansToday?: number;
  opportunitiesToday?: number;
}

export function ConnectionStatusCard() {
  const { data: status } = useConnectionStatus();

  const isDisconnected = !status?.lastSeenAt ||
    differenceInMinutes(new Date(), status.lastSeenAt) > 10;

  if (isDisconnected) {
    return (
      <Card className="border-yellow-500">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="text-yellow-500" />
            Local Service Not Connected
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground mb-4">
            Last seen: {status?.lastSeenAt ? formatDistanceToNow(status.lastSeenAt) : 'Never'}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-sm">
            <li>Ensure your PC is powered on</li>
            <li>Check Hadley Bricks Scanner is running (system tray)</li>
            <li>Verify internet connectivity</li>
          </ul>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CheckCircle className="text-green-500" />
          Local Service Connected
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-muted-foreground">Machine</dt>
            <dd>{status.machineName || status.machineId}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Status</dt>
            <dd className="capitalize">{status.status}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Scans Today</dt>
            <dd>{status.scansToday}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Opportunities</dt>
            <dd>{status.opportunitiesToday}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
```

---

## 6. Build Order (v2)

### Phase 1: Foundation (Shared Utilities)
1. Extract `set-number-extraction.ts` with unit tests
2. Extract `arbitrage-calculations.ts` with unit tests
3. Create `seeded-random.ts` utility (cyrb53 hash)
4. Create `vinted-schedule.service.ts`

### Phase 2: Database Updates
1. Add version columns to `vinted_scanner_config`
2. Add heartbeat/machine fields
3. Create version increment trigger
4. Run migration, regenerate types

### Phase 3: Server-Side APIs (v2)
1. Create `/schedule` endpoint with seeded generation
2. Create `/config` endpoint with version tracking
3. Create `/heartbeat` endpoint with status storage
4. Update existing `/process` endpoint
5. Test all endpoints with curl/Postman

### Phase 4: UI Updates
1. Create `ConnectionStatusCard` component
2. Add to automation dashboard page
3. Add `useConnectionStatus` hook
4. Test connection status display

### Phase 5: Windows Tray Application
1. Create .NET 8 WinForms project
2. Implement `TrayIcon.cs` with 4 states
3. Implement `ApiClient.cs` for HTTP calls
4. Implement `SchedulerEngine.cs` main loop
5. Implement `ClaudeExecutor.cs` CLI wrapper
6. Implement `ConfigManager.cs` with caching
7. Implement `LogManager.cs` with daily files
8. Test locally without installer

### Phase 6: Installer
1. Create WiX installer project
2. Add prerequisite checks (Claude CLI, Chrome)
3. Add API key prompt
4. Add auto-start option
5. Build MSI installer
6. Test installation on clean machine

### Phase 7: Integration Testing
1. End-to-end: Install app → connect → scan → alert
2. Test pause/resume from web dashboard
3. Test schedule regeneration on watchlist change
4. Test CAPTCHA detection and pause
5. Test missed scan handling (skip, no catch-up)

### Phase 8: Safety & Deprecation
1. Create safety documentation
2. Run single test scan
3. Run 1-week low-frequency test
4. Remove old Vinted page and API
5. Update navigation

---

## 7. Risk Assessment

### 7.1 Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| CAPTCHA triggers frequently | Medium | High | Conservative timing, detection, auto-pause |
| Claude Code Chrome fails | Low | High | Error handling, retry logic, skip & continue |
| Vinted changes DOM structure | Medium | Medium | Configurable selectors in DB |
| Windows app installation issues | Medium | Medium | Thorough installer testing, clear error messages |
| Heartbeat false disconnections | Low | Low | 10-minute threshold, graceful handling |

### 7.2 New v2 Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| .NET 8 not installed | Low | Medium | Installer bundles runtime |
| Schedule version drift | Low | Medium | Heartbeat syncs versions every 5 min |
| Clock sync issues | Low | Low | Server time in heartbeat response |
| Large schedule file | Low | Low | ~214 scans = ~20KB JSON |

### 7.3 Integration Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Pushover not configured | Low | Graceful degradation (AL9) |
| Amazon credentials expired | Low | Existing refresh logic |
| User forgets to start tray app | Medium | Auto-start option, dashboard warning |

---

## 8. Feasibility Validation

| Category | Feasible | Confidence | Notes |
|----------|----------|------------|-------|
| Server-side schedule (SCHED1-10) | ✅ Yes | High | Standard seeded random |
| Config API (CFG1-3) | ✅ Yes | High | Simple CRUD with versions |
| Heartbeat API (HB1-5) | ✅ Yes | High | Standard polling pattern |
| Dashboard connection (DCS1-5) | ✅ Yes | High | Existing UI patterns |
| Windows tray app (TRAY1-3) | ✅ Yes | Medium | .NET 8 is mature |
| Installer (INST1-6) | ✅ Yes | Medium | WiX is well-documented |
| Main loop (LOOP1-9) | ✅ Yes | High | Standard background worker |
| Config polling (POLL1-4) | ✅ Yes | High | Timer + HTTP |
| Heartbeat sending (THB1-3) | ✅ Yes | High | Timer + HTTP |
| Error handling (TERR1-4) | ✅ Yes | High | Standard patterns |
| Missed scans (MISS1-3) | ✅ Yes | High | Time comparison logic |
| Logging (LOG1-4) | ✅ Yes | High | Serilog or similar |
| All existing criteria | ✅ Yes | High | Already validated in v1 |

**Overall:** All 214 criteria are feasible with the planned approach.

---

## 9. Notes for Build Agent

### Key Patterns to Follow

1. **API Routes:** Use Next.js 15 async params pattern per CLAUDE.md
2. **Database:** Use Supabase client with RLS, regenerate types after migration
3. **UI:** Use shadcn/ui components, follow existing patterns
4. **Windows App:** Use .NET 8 with Windows Forms, NotifyIcon for tray
5. **Seeded Random:** Use cyrb53 hash with date + salt for reproducibility

### Gotchas

1. **PowerShell removed:** v2 uses Windows app, not PowerShell scripts
2. **Version sync:** Client must check configVersion + scheduleVersion on every heartbeat
3. **Time zones:** Schedule times are local; use consistent time zone handling
4. **Single instance:** Windows app must prevent multiple instances
5. **Graceful shutdown:** Handle Windows shutdown events properly

### Testing Strategy

1. Test schedule generation produces consistent output for same date
2. Test heartbeat updates dashboard within 1 minute
3. Test pause from dashboard propagates to local app within 5 minutes
4. Test CAPTCHA detection pauses immediately
5. Test missed scans are skipped, not caught up

### Dependencies

- .NET 8 SDK for Windows app development
- WiX Toolset for installer
- Claude Code CLI with Chrome extension
- Windows 10/11 for tray app

---

**Status:** READY_FOR_BUILD

**Next step:** `/build-feature updated-vinted-automation`
