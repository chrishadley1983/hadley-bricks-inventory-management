# Feature Specification: business-workflow (Phases 2-6)

**Generated:** 2026-01-18
**Based on:** done-criteria-phases-2-6.md (142 criteria)
**Status:** READY_FOR_BUILD
**Depends on:** Phase 1 (complete - 46 criteria verified)

---

## 1. Summary

Phases 2-6 complete the Daily Workflow Page by layering additional functionality onto the solid Phase 1 foundation. Phase 2 adds time tracking with a header panel (start/stop timer with categories), time log page with CRUD, and a time breakdown chart on the workflow page. Phase 3 adds a pomodoro timer with work/break phases, session tracking, streaks, and audio notifications. Phase 4 adds a weekly targets panel displaying platform listing counts and daily listing/sold values with progress bars and sparklines. Phase 5 adds a stock pickup calendar with scheduling dialogs, completion flow with mileage tracking, and enhanced off-system task creation. Phase 6 adds an insights panel aggregating alerts from across the system, a comprehensive settings screen with four tabs (Targets, Tasks, Time Tracking, Notifications), and browser push notification support. All phases ship together as a unified release.

---

## 2. Criteria Mapping

### Phase 2: Time Tracking (33 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| **T1-T8:** Time tracking panel | New `TimeTrackingPanel` in workflow header with category selector, start/pause/stop, today/week totals |
| **T9-T10:** Database tables | New `time_entries` and `time_daily_summaries` tables |
| **T11-T18:** Time tracking API | 8 new endpoints under `/api/time-tracking/` |
| **T19-T24:** Time log page | New page at `/time-tracking` with DataTable, filters, edit modal |
| **T25-T28:** Time breakdown section | New `TimeBreakdownSection` component with bar chart |
| **T29-T30:** Error handling | Toast messages for duplicate timers, API errors |
| **T31:** Performance | `useInterval` hook with 1s update, memoized renders |
| **T32-T33:** UI/UX | shadcn/ui components, responsive table/cards |

### Phase 3: Pomodoro Timer (22 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| **P1-P12:** Pomodoro panel | New `PomodoroPanel` adjacent to time tracking with mode selector, countdown, progress ring |
| **P13-P18:** Database & API | New `pomodoro_sessions` table, 5 endpoints under `/api/pomodoro/` |
| **P19:** Error handling | Toast for active session conflict |
| **P20:** Performance | RAF-based countdown for smooth updates |
| **P21-P22:** UI/UX | Circular progress indicator, end session button |

### Phase 4: Weekly Targets & Metrics (17 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| **M1-M10:** Targets panel | New `WeeklyTargetsPanel` with 5 metric cards (eBay, Amazon, BrickLink, daily listed, daily sold) |
| **M11-M13:** Metrics API | New endpoints for listing counts and workflow metrics |
| **M14:** Error handling | Per-metric error states with "Unable to load" placeholders |
| **M15:** Performance | Parallel API calls, <3s load time |
| **M16-M17:** UI/UX | Colour-coded progress (green/amber/red), responsive grid |

### Phase 5: Stock Pickups (35 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| **K1-K7:** Calendar panel | New `PickupCalendarPanel` with mini-calendar and upcoming list |
| **K8-K18:** Scheduling | New `SchedulePickupDialog` with two-panel layout, `stock_pickups` table |
| **K19-K25:** Completion flow | New `CompletePickupDialog` with outcome selector, mileage calculator |
| **K26-K27:** Recurring | Recurring pattern support with auto-generation |
| **K28-K30:** Enhanced off-system | Expanded `QuickAddTaskDialog` with all fields |
| **K31-K32:** Error handling | Validation errors, 404 handling |
| **K33:** Performance | Calendar renders <2s |
| **K34-K35:** UI/UX | Google Maps link, info-rich pickup cards |

### Phase 6: Insights & Settings (35 criteria)

| Criterion | Implementation Approach |
|-----------|------------------------|
| **I1-I8:** Insights panel | New `InsightsPanel` with 5 sections (inventory health, pricing, engagement, financial, platform) |
| **S1-S15:** Settings screen | New `/workflow/settings` route or modal with 4 tabs |
| **N1-N10:** Notifications | Browser push notifications, notification bell, preferences UI |
| **S16, N11:** Error handling | Validation errors, permission denied fallback |
| **I9, S17:** Performance | Progressive insights loading, settings <2s |
| **S18, I10:** UI/UX | shadcn/ui forms, collapsible insights |

---

## 3. Architecture

### 3.1 Integration Points

| Integration Point | Phase 1 State | Extension Plan |
|-------------------|---------------|----------------|
| **Workflow Page** | 3 sections: Critical Actions, Task Queue, Completed Today | Add: Weekly Targets (top), Time Breakdown (bottom), Pickup Calendar (sidebar), Insights Panel (sidebar) |
| **Header Bar** | AddTaskDropdown only | Add: Time Tracking Panel, Pomodoro Panel, Settings gear icon, Notification bell |
| **Workflow Service** | Task management, counts | Extend: Time tracking methods, pomodoro methods, metrics aggregation, insights queries |
| **Workflow Repository** | Task CRUD | Add: Time entry CRUD, pomodoro CRUD, pickup CRUD |
| **workflow_config** | Targets columns exist but unused | Fully utilise all target columns, add notification preferences |
| **Hooks** | `useTodaysTasks`, `usePresets` | Add: `useTimeTracking`, `usePomodoro`, `useMetrics`, `usePickups`, `useInsights`, `useWorkflowConfig` |

### 3.2 Page Layout Evolution

```
Phase 1 Layout:                        Phases 2-6 Layout:
┌──────────────────────────┐           ┌──────────────────────────────────────────────┐
│ Workflow    [+ Add Task] │           │ Workflow [⏱ 1:23:45] [🍅 24:30] [⚙] [🔔] [+] │
├──────────────────────────┤           ├──────────────────────────────────────────────┤
│                          │           │ ┌──────────────────────────────────────────┐ │
│ Critical Actions         │           │ │ Weekly Targets Panel (NEW)               │ │
│                          │           │ │ eBay: 450/500  Amazon: 200/250  ...      │ │
│                          │           │ └──────────────────────────────────────────┘ │
├──────────────────────────┤           ├──────────────────────────────────────────────┤
│                          │           │                          │ Pickup Calendar  │
│ Task Queue               │           │ Critical Actions         │ (NEW)            │
│                          │           │                          │                  │
│                          │           │ Task Queue               │ Insights Panel   │
│                          │           │                          │ (NEW)            │
│                          │           │                          │                  │
├────────────┬─────────────┤           │                          │ Completed Today  │
│ Completed  │             │           ├──────────────────────────┼──────────────────┤
│ Today      │             │           │ Time Breakdown (NEW)     │                  │
└────────────┴─────────────┘           └──────────────────────────┴──────────────────┘
```

### 3.3 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              /workflow Page (Extended)                               │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │ Header Bar                                                                   │   │
│  │                                                                              │   │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌───┐ ┌───┐ ┌─────────────────┐   │   │
│  │  │ TimeTracking    │ │ Pomodoro        │ │ ⚙ │ │ 🔔│ │ AddTaskDropdown │   │   │
│  │  │ Panel (Phase 2) │ │ Panel (Phase 3) │ │   │ │ 3 │ │                 │   │   │
│  │  │ [Dev ▼] 1:23:45 │ │ 🍅 24:30 ⏸     │ │   │ │   │ │ [+ Add Task ▼]  │   │   │
│  │  │ [▶] [⏸] [⏹]    │ │ Session 2/8    │ └───┘ └───┘ │                 │   │   │
│  │  │ Today: 3h 45m   │ │ 🔥 5 day streak│             │                 │   │   │
│  │  └─────────────────┘ └─────────────────┘             └─────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────────────┐   │
│  │ Weekly Targets Panel (Phase 4)                                               │   │
│  │                                                                              │   │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │   │
│  │  │ eBay       │ │ Amazon     │ │ BrickLink  │ │ Daily List │ │ Daily Sold │ │   │
│  │  │ 450/500    │ │ 200/250    │ │ £750/£1000 │ │ £180/£300  │ │ £195/£250  │ │   │
│  │  │ ████████░░ │ │ ████████░░ │ │ ███████░░░ │ │ ██████░░░░ │ │ ████████░░ │ │   │
│  │  │ 50 to go   │ │ 50 to go   │ │ £250 to go │ │ £120 to go │ │ £55 to go  │ │   │
│  │  │ ∿∿∿∿∿∿∿    │ │ ∿∿∿∿∿∿∿    │ │ ∿∿∿∿∿∿∿    │ │ ∿∿∿∿∿∿∿    │ │ ∿∿∿∿∿∿∿    │ │   │
│  │  └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
│  ┌──────────────────────────────────────────────┐ ┌────────────────────────────┐   │
│  │ Critical Actions Panel (existing)            │ │ Pickup Calendar (Phase 5)  │   │
│  │ [Orders] [Resolution] [Sync Status]          │ │  ◀ January 2026 ▶          │   │
│  └──────────────────────────────────────────────┘ │  Mo Tu We Th Fr Sa Su      │   │
│                                                    │     1  2  3  4  5  6       │   │
│  ┌──────────────────────────────────────────────┐ │   7  8  9 10 11 12 13      │   │
│  │ Task Queue (existing)                        │ │  14 15🚗16 17 18 19 20     │   │
│  │ ● Process orders (7)       [Start]...       │ │  21 22 23 24 25 26 27      │   │
│  │ ● Arbitrage check (AM)     [Start]...       │ │                            │   │
│  │ ● List from backlog (12)   [Start]...       │ │  Upcoming:                 │   │
│  └──────────────────────────────────────────────┘ │  15 Jan - FB Marketplace   │   │
│                                                    │  20 Jan - Car Boot (rec)   │   │
│  ┌──────────────────────────────────────────────┐ └────────────────────────────┘   │
│  │ Time Breakdown (Phase 2)                     │                                   │
│  │                                              │ ┌────────────────────────────┐   │
│  │  Today                This Week             │ │ Insights Panel (Phase 6)   │   │
│  │  ████ Dev (1h 30m)    ██████ Dev (8h 15m)   │ │                            │   │
│  │  ███ List (1h 00m)    █████ List (6h 30m)   │ │ 📦 Inventory Health        │   │
│  │  ██ Ship (45m)        ████ Ship (4h 00m)    │ │   • 5 items hit 90 days   │   │
│  │  █ Admin (30m)        ███ Admin (3h 15m)    │ │   • 12 items overdue      │   │
│  │                                              │ │                            │   │
│  │  [View full log →]                          │ │ 💰 Pricing Alerts          │   │
│  └──────────────────────────────────────────────┘ │   • 3 Buy Box lost        │   │
│                                                    │   • 8 below margin        │   │
│                                                    │                            │   │
│                                                    │ 📊 Financial Snapshot      │   │
│                                                    │   • MTD: £4,250 (+12%)    │   │
│                                                    │                            │   │
│                                                    │ [Collapse ▲]              │   │
│                                                    └────────────────────────────┘   │
│                                                                                      │
│                                                    ┌────────────────────────────┐   │
│                                                    │ Completed Today (existing) │   │
│                                                    │ 3 tasks | 1h 45m           │   │
│                                                    │ ✓ Process orders - 10:30am │   │
│                                                    │ ✓ Sync platforms - 11:15am │   │
│                                                    └────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────┘

Data Flow (Phases 2-6):

┌────────────┐     ┌─────────────────────────────────────────────────────────────────┐
│  /workflow │────▶│ Parallel API calls (extended):                                  │
│   page     │     │  - GET /api/workflow/tasks/today        → Task queue (P1)       │
│            │     │  - GET /api/time-tracking/current       → Timer panel (P2)      │
│            │     │  - GET /api/time-tracking/summary       → Today/week totals (P2)│
│            │     │  - GET /api/pomodoro/current            → Pomodoro state (P3)   │
│            │     │  - GET /api/pomodoro/stats              → Session/streak (P3)   │
│            │     │  - GET /api/workflow/metrics            → Targets panel (P4)    │
│            │     │  - GET /api/pickups/calendar            → Calendar (P5)         │
│            │     │  - GET /api/workflow/insights           → Insights panel (P6)   │
│            │     │  - GET /api/workflow/config             → User settings (P6)    │
└────────────┘     └─────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Supabase Database (Extended)                            │
│                                                                                      │
│  Phase 1 (existing):                    Phases 2-6 (new):                           │
│  ┌─────────────────┐                    ┌─────────────────┐  ┌─────────────────┐   │
│  │ workflow_config │───────────────────▶│ time_entries    │  │ pomodoro_       │   │
│  │ (targets, days) │                    │ (category, dur) │  │ sessions        │   │
│  └─────────────────┘                    └─────────────────┘  └─────────────────┘   │
│                                                                                      │
│  ┌─────────────────┐                    ┌─────────────────┐  ┌─────────────────┐   │
│  │ workflow_task_  │                    │ time_daily_     │  │ stock_pickups   │   │
│  │ definitions     │                    │ summaries       │  │                 │   │
│  └─────────────────┘                    └─────────────────┘  └─────────────────┘   │
│                                                                                      │
│  ┌─────────────────┐                    Extended workflow_config:                   │
│  │ workflow_task_  │                    - notification_enabled                      │
│  │ instances       │                    - notification_dispatch_hours               │
│  └─────────────────┘                    - notification_overdue_orders               │
│                                          - notification_resolution_threshold         │
│  ┌─────────────────┐                    - notification_sync_failure                 │
│  │ off_system_     │                    - pomodoro_classic_work/break               │
│  │ task_presets    │                    - pomodoro_long_work/break                  │
│  └─────────────────┘                    - pomodoro_daily_target                     │
│                                          - time_categories (JSONB)                   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Timer implementation** | `useInterval` with 1s interval + `useRef` for start time | Accurate elapsed calculation without drift |
| **Pomodoro countdown** | `requestAnimationFrame` for display, `setInterval` for phase transitions | Smooth visual updates, reliable phase changes |
| **Sparkline charts** | Recharts `<Sparkline>` or custom SVG | Lightweight, consistent with potential future charts |
| **Calendar component** | Custom mini-calendar using date-fns | Full control over pickup integration, no heavy dependency |
| **Progress indicators** | shadcn/ui `<Progress>` + custom circular for pomodoro | Consistent styling, circular for visual distinction |
| **Audio notifications** | HTML5 `<audio>` element with user-selectable sounds | Browser-native, no dependencies |
| **Push notifications** | Browser Notifications API + Service Worker | Standard web push, no external service needed |
| **Settings storage** | Extend `workflow_config` table | Single source of truth, already has user_id FK |

---

## 4. File Changes

### 4.1 New Files

#### Phase 2: Time Tracking

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/time-tracking/page.tsx` | Time log page | 200 |
| `apps/web/src/app/(dashboard)/time-tracking/loading.tsx` | Loading skeleton | 30 |
| `apps/web/src/components/features/workflow/TimeTrackingPanel.tsx` | Header timer panel | 180 |
| `apps/web/src/components/features/workflow/TimeBreakdownSection.tsx` | Bar chart section | 120 |
| `apps/web/src/components/features/workflow/TimeEntryEditDialog.tsx` | Edit entry modal | 150 |
| `apps/web/src/components/features/workflow/ManualTimeEntryDialog.tsx` | Add manual entry | 150 |
| `apps/web/src/app/api/time-tracking/current/route.ts` | Get active entry | 40 |
| `apps/web/src/app/api/time-tracking/start/route.ts` | Start timer | 60 |
| `apps/web/src/app/api/time-tracking/stop/route.ts` | Stop timer | 80 |
| `apps/web/src/app/api/time-tracking/entries/route.ts` | List/create entries | 120 |
| `apps/web/src/app/api/time-tracking/entries/[id]/route.ts` | Update/delete entry | 100 |
| `apps/web/src/app/api/time-tracking/summary/route.ts` | Daily/weekly summary | 80 |
| `apps/web/src/hooks/use-time-tracking.ts` | TanStack Query hooks | 200 |
| `supabase/migrations/2026XXXX_time_tracking_tables.sql` | time_entries, time_daily_summaries | 100 |

**Phase 2 subtotal:** 14 files, ~1,610 lines

#### Phase 3: Pomodoro

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/components/features/workflow/PomodoroPanel.tsx` | Header pomodoro panel | 250 |
| `apps/web/src/components/features/workflow/PomodoroProgress.tsx` | Circular progress ring | 80 |
| `apps/web/src/app/api/pomodoro/current/route.ts` | Get active session | 40 |
| `apps/web/src/app/api/pomodoro/start/route.ts` | Start session | 60 |
| `apps/web/src/app/api/pomodoro/complete-phase/route.ts` | Transition phase | 80 |
| `apps/web/src/app/api/pomodoro/cancel/route.ts` | Cancel session | 50 |
| `apps/web/src/app/api/pomodoro/stats/route.ts` | Daily count + streak | 80 |
| `apps/web/src/hooks/use-pomodoro.ts` | TanStack Query hooks | 180 |
| `supabase/migrations/2026XXXX_pomodoro_sessions.sql` | pomodoro_sessions table | 60 |

**Phase 3 subtotal:** 9 files, ~880 lines

#### Phase 4: Weekly Targets

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/components/features/workflow/WeeklyTargetsPanel.tsx` | Targets container | 150 |
| `apps/web/src/components/features/workflow/MetricCard.tsx` | Individual metric card | 100 |
| `apps/web/src/components/features/workflow/Sparkline.tsx` | Sparkline chart component | 80 |
| `apps/web/src/app/api/inventory/listing-counts/route.ts` | Platform listing counts | 80 |
| `apps/web/src/app/api/workflow/metrics/route.ts` | All metrics + history | 150 |
| `apps/web/src/hooks/use-metrics.ts` | TanStack Query hooks | 100 |

**Phase 4 subtotal:** 6 files, ~660 lines

#### Phase 5: Stock Pickups

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/components/features/workflow/PickupCalendarPanel.tsx` | Calendar + upcoming list | 200 |
| `apps/web/src/components/features/workflow/MiniCalendar.tsx` | Month grid calendar | 150 |
| `apps/web/src/components/features/workflow/SchedulePickupDialog.tsx` | Two-panel scheduling | 300 |
| `apps/web/src/components/features/workflow/CompletePickupDialog.tsx` | Completion flow | 200 |
| `apps/web/src/components/features/workflow/PickupCard.tsx` | Pickup list item | 80 |
| `apps/web/src/app/api/pickups/route.ts` | List/create pickups | 120 |
| `apps/web/src/app/api/pickups/[id]/route.ts` | Get/update/delete pickup | 100 |
| `apps/web/src/app/api/pickups/[id]/complete/route.ts` | Complete pickup | 100 |
| `apps/web/src/app/api/pickups/calendar/route.ts` | Month calendar data | 80 |
| `apps/web/src/lib/repositories/pickup.repository.ts` | Pickup data access | 150 |
| `apps/web/src/hooks/use-pickups.ts` | TanStack Query hooks | 150 |
| `supabase/migrations/2026XXXX_stock_pickups.sql` | stock_pickups table | 100 |

**Phase 5 subtotal:** 12 files, ~1,730 lines

#### Phase 6: Insights & Settings

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/components/features/workflow/InsightsPanel.tsx` | Insights container | 200 |
| `apps/web/src/components/features/workflow/InsightSection.tsx` | Individual insight category | 80 |
| `apps/web/src/components/features/workflow/WorkflowSettingsDialog.tsx` | Settings modal/sheet | 400 |
| `apps/web/src/components/features/workflow/SettingsTargetsTab.tsx` | Targets tab content | 150 |
| `apps/web/src/components/features/workflow/SettingsTasksTab.tsx` | Task definitions tab | 200 |
| `apps/web/src/components/features/workflow/SettingsTimeTrackingTab.tsx` | Time/pomodoro settings | 150 |
| `apps/web/src/components/features/workflow/SettingsNotificationsTab.tsx` | Notification prefs | 150 |
| `apps/web/src/components/features/workflow/TaskDefinitionEditDialog.tsx` | Edit task definition | 200 |
| `apps/web/src/components/features/workflow/NotificationBell.tsx` | Header bell with badge | 80 |
| `apps/web/src/app/api/workflow/insights/route.ts` | Aggregated insights | 200 |
| `apps/web/src/app/api/workflow/config/route.ts` | Get/update config | 100 |
| `apps/web/src/app/api/workflow/tasks/definitions/route.ts` | List/create definitions | 100 |
| `apps/web/src/app/api/workflow/tasks/definitions/[id]/route.ts` | Update/delete definition | 80 |
| `apps/web/src/hooks/use-insights.ts` | TanStack Query hooks | 80 |
| `apps/web/src/hooks/use-workflow-config.ts` | Config hooks | 120 |
| `apps/web/src/lib/notifications.ts` | Push notification helpers | 100 |
| `supabase/migrations/2026XXXX_workflow_config_notifications.sql` | Extend workflow_config | 50 |

**Phase 6 subtotal:** 17 files, ~2,440 lines

### 4.2 Modified Files

| File | Changes | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/workflow/page.tsx` | Add new panels, header components | 100 |
| `apps/web/src/components/features/workflow/index.ts` | Export new components | 30 |
| `apps/web/src/components/features/workflow/QuickAddTaskDialog.tsx` | Enhanced fields (K28-K30) | 50 |
| `apps/web/src/lib/services/workflow.service.ts` | Add time, pomodoro, metrics, insights methods | 300 |
| `apps/web/src/lib/repositories/workflow.repository.ts` | Add time, pomodoro, config methods | 200 |
| `apps/web/src/hooks/use-workflow.ts` | Export combined hooks | 30 |
| `packages/database/src/types.ts` | Regenerate after migrations | Auto |

**Modified files subtotal:** ~710 lines changed

### 4.3 Summary

| Category | Files | Lines |
|----------|-------|-------|
| Phase 2 (Time Tracking) | 14 | ~1,610 |
| Phase 3 (Pomodoro) | 9 | ~880 |
| Phase 4 (Targets) | 6 | ~660 |
| Phase 5 (Pickups) | 12 | ~1,730 |
| Phase 6 (Insights/Settings) | 17 | ~2,440 |
| Modified files | 7 | ~710 |
| **Total** | **65 files** | **~8,030 lines** |

---

## 5. Implementation Details

### 5.1 Database Schema

#### time_entries (Phase 2)
```sql
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  category VARCHAR(50) NOT NULL, -- Development, Listing, Shipping, Sourcing, Admin, Other
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER, -- Calculated on stop

  -- Optional link to task
  task_instance_id UUID REFERENCES workflow_task_instances(id) ON DELETE SET NULL,

  notes TEXT,
  is_manual_entry BOOLEAN DEFAULT FALSE,
  is_paused BOOLEAN DEFAULT FALSE,
  paused_duration_seconds INTEGER DEFAULT 0, -- Accumulated pause time

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_time_entries_user_date ON time_entries(user_id, started_at::date);
CREATE INDEX idx_time_entries_active ON time_entries(user_id)
  WHERE ended_at IS NULL;
```

#### time_daily_summaries (Phase 2)
```sql
CREATE TABLE time_daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  summary_date DATE NOT NULL,

  total_seconds INTEGER DEFAULT 0,
  development_seconds INTEGER DEFAULT 0,
  listing_seconds INTEGER DEFAULT 0,
  shipping_seconds INTEGER DEFAULT 0,
  sourcing_seconds INTEGER DEFAULT 0,
  admin_seconds INTEGER DEFAULT 0,
  other_seconds INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(user_id, summary_date)
);
```

#### pomodoro_sessions (Phase 3)
```sql
CREATE TABLE pomodoro_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  session_date DATE NOT NULL,
  session_number INTEGER NOT NULL, -- 1, 2, 3... for the day

  mode VARCHAR(20) NOT NULL, -- classic, long, custom
  work_minutes INTEGER NOT NULL,
  break_minutes INTEGER NOT NULL,

  started_at TIMESTAMPTZ NOT NULL,
  work_completed_at TIMESTAMPTZ,
  break_completed_at TIMESTAMPTZ,

  status VARCHAR(20) DEFAULT 'work', -- work, break, completed, cancelled

  -- Optional link to time entry for automatic time tracking
  time_entry_id UUID REFERENCES time_entries(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pomodoro_sessions_user_date ON pomodoro_sessions(user_id, session_date);
CREATE INDEX idx_pomodoro_sessions_active ON pomodoro_sessions(user_id)
  WHERE status IN ('work', 'break');
```

#### stock_pickups (Phase 5)
```sql
CREATE TABLE stock_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  -- Basic info
  title VARCHAR(255) NOT NULL,
  description TEXT,
  source_platform VARCHAR(50), -- FB Marketplace, Gumtree, eBay, Car Boot, Auction, Private, Other

  -- Address
  address_line1 VARCHAR(255) NOT NULL,
  address_line2 VARCHAR(255),
  city VARCHAR(100) NOT NULL,
  postcode VARCHAR(20) NOT NULL,

  -- Scheduling
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,
  estimated_duration_minutes INTEGER,

  -- Financial
  agreed_price DECIMAL(10,2),
  estimated_value DECIMAL(10,2),

  -- Status
  status VARCHAR(20) DEFAULT 'draft', -- draft, scheduled, completed, cancelled, no_show

  -- Completion
  outcome VARCHAR(20), -- completed, partial, cancelled, no_show
  final_amount_paid DECIMAL(10,2),
  mileage DECIMAL(10,2),
  mileage_cost DECIMAL(10,2), -- Calculated at 45p/mile
  completion_notes TEXT,
  completed_at TIMESTAMPTZ,

  -- Linking
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  task_instance_id UUID REFERENCES workflow_task_instances(id) ON DELETE SET NULL,

  -- Recurring
  is_recurring BOOLEAN DEFAULT FALSE,
  recurrence_pattern VARCHAR(20), -- weekly, biweekly, monthly
  parent_pickup_id UUID REFERENCES stock_pickups(id) ON DELETE SET NULL,

  -- Reminder
  reminder_day_before BOOLEAN DEFAULT FALSE,

  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_stock_pickups_user_date ON stock_pickups(user_id, scheduled_date);
CREATE INDEX idx_stock_pickups_status ON stock_pickups(user_id, status);
```

#### workflow_config extensions (Phase 6)
```sql
ALTER TABLE workflow_config ADD COLUMN IF NOT EXISTS
  -- Notification preferences
  notifications_enabled BOOLEAN DEFAULT FALSE,
  notification_dispatch_hours INTEGER DEFAULT 2,
  notification_overdue_orders BOOLEAN DEFAULT TRUE,
  notification_resolution_threshold INTEGER DEFAULT 10,
  notification_sync_failure BOOLEAN DEFAULT TRUE,

  -- Pomodoro settings
  pomodoro_classic_work INTEGER DEFAULT 25,
  pomodoro_classic_break INTEGER DEFAULT 5,
  pomodoro_long_work INTEGER DEFAULT 50,
  pomodoro_long_break INTEGER DEFAULT 10,
  pomodoro_sessions_before_long_break INTEGER DEFAULT 4,
  pomodoro_daily_target INTEGER DEFAULT 8,

  -- Time tracking
  time_categories JSONB DEFAULT '["Development","Listing","Shipping","Sourcing","Admin","Other"]',

  -- Audio
  audio_work_complete VARCHAR(50) DEFAULT 'bell',
  audio_break_complete VARCHAR(50) DEFAULT 'chime';
```

### 5.2 API Specifications

#### Phase 2: Time Tracking APIs

**GET /api/time-tracking/current**
```typescript
interface CurrentEntryResponse {
  entry: {
    id: string;
    category: string;
    startedAt: string;
    elapsedSeconds: number;
    isPaused: boolean;
    pausedDurationSeconds: number;
  } | null;
}
```

**POST /api/time-tracking/start**
```typescript
interface StartRequest {
  category: string;
}
interface StartResponse {
  entry: TimeEntry;
}
```

**POST /api/time-tracking/stop**
```typescript
interface StopResponse {
  entry: TimeEntry;
  dailySummary: DailySummary;
}
```

**GET /api/time-tracking/entries**
```typescript
interface EntriesRequest {
  dateFrom?: string;
  dateTo?: string;
  category?: string;
  page?: number;
  limit?: number;
}
interface EntriesResponse {
  entries: TimeEntry[];
  total: number;
  page: number;
  limit: number;
}
```

**GET /api/time-tracking/summary**
```typescript
interface SummaryResponse {
  today: {
    total: number;
    byCategory: Record<string, number>;
  };
  week: {
    total: number;
    byCategory: Record<string, number>;
  };
}
```

#### Phase 3: Pomodoro APIs

**GET /api/pomodoro/current**
```typescript
interface CurrentSessionResponse {
  session: {
    id: string;
    mode: 'classic' | 'long' | 'custom';
    status: 'work' | 'break';
    workMinutes: number;
    breakMinutes: number;
    startedAt: string;
    workCompletedAt?: string;
    remainingSeconds: number;
  } | null;
}
```

**POST /api/pomodoro/start**
```typescript
interface StartPomodoroRequest {
  mode: 'classic' | 'long' | 'custom';
  workMinutes?: number;  // Required for custom
  breakMinutes?: number; // Required for custom
}
```

**POST /api/pomodoro/complete-phase**
```typescript
// Transitions work→break or break→completed
interface CompletePhaseResponse {
  session: PomodoroSession;
  nextPhase: 'break' | 'completed';
}
```

**GET /api/pomodoro/stats**
```typescript
interface PomodoroStatsResponse {
  sessionsToday: number;
  dailyTarget: number;
  streakDays: number;
  lastSessionDate?: string;
}
```

#### Phase 4: Metrics APIs

**GET /api/inventory/listing-counts**
```typescript
interface ListingCountsResponse {
  ebay: number;
  amazon: number;
  bricklink: number;
  brickowl: number;
}
```

**GET /api/workflow/metrics**
```typescript
interface MetricsResponse {
  ebayListings: MetricData;
  amazonListings: MetricData;
  bricklinkWeeklyValue: MetricData;
  dailyListedValue: MetricData;
  dailySoldValue: MetricData;
  weekToDate: {
    listedValue: number;
    soldValue: number;
    ordersShipped: number;
  };
}

interface MetricData {
  current: number;
  target: number;
  gap: number;
  percentage: number;
  history: Array<{ date: string; value: number }>; // Last 7 days
}
```

#### Phase 5: Pickups APIs

**GET /api/pickups/calendar**
```typescript
interface CalendarRequest {
  month: string; // 2026-01
}
interface CalendarResponse {
  month: string;
  pickupsByDate: Record<string, PickupSummary[]>;
  upcoming: PickupSummary[]; // Next 7 days
}
```

**POST /api/pickups**
```typescript
interface CreatePickupRequest {
  title: string;
  description?: string;
  sourcePlatform?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  postcode: string;
  scheduledDate: string;
  scheduledTime?: string;
  estimatedDurationMinutes?: number;
  agreedPrice?: number;
  estimatedValue?: number;
  reminderDayBefore?: boolean;
  isRecurring?: boolean;
  recurrencePattern?: 'weekly' | 'biweekly' | 'monthly';
  status: 'draft' | 'scheduled';
}
```

**POST /api/pickups/:id/complete**
```typescript
interface CompletePickupRequest {
  outcome: 'completed' | 'partial' | 'cancelled' | 'no_show';
  finalAmountPaid?: number;
  mileage?: number;
  completionNotes?: string;
  createPurchase?: boolean;
}
```

#### Phase 6: Insights & Config APIs

**GET /api/workflow/insights**
```typescript
interface InsightsResponse {
  inventoryHealth: {
    hitting90Days: number;
    over91Days: { count: number; value: number };
    notYetReceived: number;
  };
  pricing: {
    buyBoxLost: number;
    belowMargin: number;
    arbitrageOpportunities: number;
  };
  engagement: {
    ebayWatchers: number;
    refreshEligible: number;
    lowScoreListings: number;
  };
  financial: {
    mtdRevenue: number;
    mtdRevenueChange: number; // vs last month
    mtdProfit: number;
    mtdProfitChange: number;
    profitMargin: number;
    profitMarginTarget: number;
  };
  platformHealth: Array<{
    platform: string;
    connected: boolean;
    lastSync?: string;
    isStale: boolean;
    tokenExpiresAt?: string;
    tokenExpiresSoon: boolean;
  }>;
}
```

**GET/PUT /api/workflow/config**
```typescript
interface WorkflowConfig {
  // Targets (existing)
  targetEbayListings: number;
  targetAmazonListings: number;
  targetBricklinkWeeklyValue: number;
  targetDailyListedValue: number;
  targetDailySoldValue: number;
  workingDays: number;

  // Notifications (new)
  notificationsEnabled: boolean;
  notificationDispatchHours: number;
  notificationOverdueOrders: boolean;
  notificationResolutionThreshold: number;
  notificationSyncFailure: boolean;

  // Pomodoro (new)
  pomodoroClassicWork: number;
  pomodoroClassicBreak: number;
  pomodoroLongWork: number;
  pomodoroLongBreak: number;
  pomodoroSessionsBeforeLongBreak: number;
  pomodoroDailyTarget: number;

  // Time tracking (new)
  timeCategories: string[];

  // Audio (new)
  audioWorkComplete: string;
  audioBreakComplete: string;
}
```

### 5.3 Component Specifications

#### TimeTrackingPanel (Phase 2)
```tsx
interface TimeTrackingPanelProps {
  className?: string;
}

// State: idle | tracking | paused
// UI Elements:
// - Category selector (Select dropdown)
// - Timer display (HH:MM:SS)
// - Start button (idle state)
// - Pause/Resume button (tracking state)
// - Stop button (tracking/paused state)
// - Today total badge
// - Week total badge (collapsible on mobile)
```

#### PomodoroPanel (Phase 3)
```tsx
interface PomodoroPanelProps {
  className?: string;
}

// State: idle | work | break
// UI Elements:
// - Mode selector (Classic/Long/Custom)
// - Circular progress with time
// - Start button (idle)
// - Pause/End buttons (active)
// - Skip Break button (break phase)
// - Session counter (X of Y)
// - Streak badge
```

#### WeeklyTargetsPanel (Phase 4)
```tsx
interface WeeklyTargetsPanelProps {
  className?: string;
}

// 5 MetricCards in responsive grid
// Each MetricCard shows:
// - Label
// - Current / Target
// - Progress bar (colour-coded)
// - Gap text ("50 to go" or "+25 ahead")
// - Sparkline (last 7 days)
```

#### PickupCalendarPanel (Phase 5)
```tsx
interface PickupCalendarPanelProps {
  className?: string;
}

// Components:
// - MiniCalendar (month grid)
// - Upcoming pickups list
// - "Schedule Pickup" button

// MiniCalendar:
// - Month/year header with nav arrows
// - Day grid with today highlighted
// - Days with pickups show car icon
// - Click day → show pickups or open scheduler
```

#### InsightsPanel (Phase 6)
```tsx
interface InsightsPanelProps {
  className?: string;
}

// Collapsible panel with sections:
// - Inventory Health
// - Pricing & Competition
// - Listing Engagement
// - Financial Snapshot
// - Platform Health

// Each section shows:
// - Section header with icon
// - 2-3 insight items
// - Each item has count/value + link to relevant page
```

---

## 6. Build Order

### Step 1: Database Migrations
1. Create `time_tracking_tables.sql` migration (time_entries, time_daily_summaries)
2. Create `pomodoro_sessions.sql` migration
3. Create `stock_pickups.sql` migration
4. Create `workflow_config_notifications.sql` migration (extend workflow_config)
5. Push migrations: `npm run db:push`
6. Regenerate types: `npm run db:types`

**Verification:** All tables exist; types regenerated

### Step 2: Time Tracking (Phase 2)
1. Create time tracking repository methods
2. Create time tracking service methods
3. Create API routes (current, start, stop, entries, summary)
4. Create `use-time-tracking.ts` hooks
5. Build `TimeTrackingPanel` component
6. Build `TimeBreakdownSection` component
7. Build time log page at `/time-tracking`
8. Build `TimeEntryEditDialog` and `ManualTimeEntryDialog`
9. Integrate TimeTrackingPanel into workflow header
10. Integrate TimeBreakdownSection into workflow page

**Verification:** Timer starts/stops; entries saved; summary accurate; log page works

### Step 3: Pomodoro Timer (Phase 3)
1. Create pomodoro repository methods
2. Create pomodoro service methods (start, complete-phase, cancel, stats)
3. Create API routes
4. Create `use-pomodoro.ts` hooks
5. Build `PomodoroProgress` circular indicator
6. Build `PomodoroPanel` component
7. Integrate into workflow header

**Verification:** Sessions work through full cycle; stats track correctly

### Step 4: Weekly Targets (Phase 4)
1. Create metrics aggregation queries in workflow service
2. Create `listing-counts` API route
3. Create `metrics` API route with history
4. Create `use-metrics.ts` hooks
5. Build `Sparkline` component
6. Build `MetricCard` component
7. Build `WeeklyTargetsPanel` component
8. Integrate into workflow page (between header and critical actions)

**Verification:** Metrics load; progress bars accurate; sparklines render

### Step 5: Stock Pickups (Phase 5)
1. Create pickup repository
2. Create pickup service methods
3. Create API routes (CRUD, calendar, complete)
4. Create `use-pickups.ts` hooks
5. Build `MiniCalendar` component
6. Build `PickupCard` component
7. Build `PickupCalendarPanel` component
8. Build `SchedulePickupDialog` with two-panel layout
9. Build `CompletePickupDialog` with outcome flow
10. Add "Schedule Pickup" to AddTaskDropdown
11. Integrate calendar panel into workflow sidebar
12. Enhance `QuickAddTaskDialog` with all fields (K28-K30)

**Verification:** Calendar shows pickups; scheduling works; completion flow works

### Step 6: Insights & Settings (Phase 6)
1. Create insights aggregation queries
2. Create `/api/workflow/insights` route
3. Create `/api/workflow/config` route
4. Create task definitions CRUD routes
5. Create `use-insights.ts` and `use-workflow-config.ts` hooks
6. Build `InsightSection` component
7. Build `InsightsPanel` component
8. Build settings tabs: Targets, Tasks, Time Tracking, Notifications
9. Build `WorkflowSettingsDialog`
10. Build `TaskDefinitionEditDialog`
11. Build `NotificationBell` component
12. Implement push notification helpers
13. Add settings gear icon to header
14. Add notification bell to header
15. Integrate InsightsPanel into workflow sidebar

**Verification:** Insights load progressively; settings save; notifications work

### Step 7: Integration & Polish
1. Update workflow page layout with all new sections
2. Test responsive layouts at 375px, 768px, 1024px
3. Add loading skeletons for all new sections
4. Add error boundaries
5. Performance profiling
6. Cross-browser testing

**Verification:** Full page works; responsive; performant

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Timer drift over long sessions** | Medium | Low | Use `Date.now()` reference for elapsed calculation, not interval accumulation |
| **Pomodoro phase transition timing** | Medium | Medium | Server-side verification of phase duration; client syncs on reconnect |
| **Sparkline performance with many data points** | Low | Low | Limit to 7 days; use memoization |
| **Push notification permission denied** | High | Low | Graceful fallback to in-app only; clear messaging |
| **Calendar date timezone issues** | Medium | Medium | Use date-fns-tz; store dates in UTC; display in local |
| **Large insights query performance** | Medium | Medium | Parallel queries; consider caching; progressive loading |

### Scope Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| **Scope creep to add analytics dashboards** | Medium | Insights panel is read-only; defer drill-down analytics |
| **Complex recurring pickup logic** | Medium | Start with simple weekly/biweekly/monthly; no custom patterns |
| **Audio file hosting** | Low | Use simple built-in sounds; no custom uploads in Phase 6 |

### Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **Time tracking conflicts with existing task timing** | Low | Low | Separate systems; optional linking via task_instance_id |
| **Metrics accuracy depends on platform sync** | Medium | Medium | Show "last synced" time; handle stale data gracefully |
| **Pickup-to-purchase linking** | Low | Low | Optional; pre-fill data only; user creates purchase manually |

---

## 8. Feasibility Validation

| Criterion Group | Feasible | Confidence | Notes |
|-----------------|----------|------------|-------|
| T1-T33: Time Tracking | ✅ Yes | High | Standard timer patterns; CRUD APIs |
| P1-P22: Pomodoro | ✅ Yes | High | Well-defined state machine |
| M1-M17: Metrics | ✅ Yes | High | Aggregation queries on existing data |
| K1-K35: Pickups | ✅ Yes | High | Calendar UI + CRUD; Google Maps linking trivial |
| I1-I10: Insights | ✅ Yes | Medium | Many source queries; may need optimisation |
| S1-S18: Settings | ✅ Yes | High | Form CRUD; shadcn/ui components |
| N1-N11: Notifications | ✅ Yes | Medium | Browser API support varies; permission handling critical |

**Overall:** All 142 criteria feasible with planned approach. ✅

**Medium Confidence Items:**
- I1-I8: Insights aggregation may need query optimization or caching
- N8-N9: Push notifications depend on browser support and user permission

---

## 9. Notes for Build Agent

### Hints

1. **Build database migrations first** - All other work depends on types being generated

2. **Timer implementation pattern:**
   ```tsx
   const startTimeRef = useRef<number>(Date.now());
   const [elapsed, setElapsed] = useState(0);

   useInterval(() => {
     setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
   }, isRunning ? 1000 : null);
   ```

3. **Pomodoro state machine:**
   - idle → (start) → work → (complete-phase) → break → (complete-phase) → idle
   - Any state can → (cancel) → idle

4. **Metrics aggregation strategy:**
   - eBay listings: `ebay_listings WHERE status = 'active'`
   - Amazon listings: `amazon_listings WHERE status = 'active'`
   - Daily listed: `inventory_items WHERE listing_date = today`
   - Daily sold: `platform_orders WHERE order_date = today AND status IN ('Shipped', 'Completed')`

5. **Insights query optimization:**
   - Run all queries in parallel with `Promise.all`
   - Consider caching with 5-minute TTL for less critical metrics
   - Show loading state per section, not whole panel

6. **Pickup calendar implementation:**
   - Use date-fns for date manipulation
   - Store `scheduled_date` as DATE type (not TIMESTAMPTZ)
   - Group pickups by date for calendar display

7. **Push notifications setup:**
   ```typescript
   // Request permission
   const permission = await Notification.requestPermission();

   // Show notification
   if (permission === 'granted') {
     new Notification('Pomodoro Complete', {
       body: 'Time for a break!',
       icon: '/icons/pomodoro.png'
     });
   }
   ```

8. **Mileage calculation:**
   ```typescript
   const MILEAGE_RATE = 0.45; // 45p per mile
   const cost = mileage * MILEAGE_RATE;
   ```

9. **Time breakdown bar chart:**
   - Horizontal stacked bars work best
   - Use Recharts `<BarChart>` with `<Bar stackId="a">`
   - Colours per category should match throughout app

10. **Settings tab persistence:**
    - Use URL hash for tab state (#targets, #tasks, #time, #notifications)
    - Or use controlled Tabs component with local state

### Common Gotchas

- **Time entries without ended_at** are "active" - only one allowed per user
- **Pomodoro sessions with status 'work' or 'break'** are active
- **Pickup status transitions:** draft → scheduled → completed/cancelled/no_show
- **Daily summaries** should be updated atomically with time entry stop
- **Streak calculation** needs to handle timezone boundaries
- **Working days bitmask** uses Mon=1, not Sun=0

### Reusable Components from Phase 1

- `TaskCard` patterns for PickupCard styling
- `TaskQueue` loading states for other panels
- Toast patterns from existing mutations
- Dropdown menu patterns from AddTaskDropdown

---

## 10. Handoff Summary

**Feature:** business-workflow (Phases 2-6)
**Spec:** docs/features/business-workflow/feature-spec-phases-2-6.md
**Criteria:** docs/features/business-workflow/done-criteria-phases-2-6.md (142 criteria)
**Status:** READY_FOR_BUILD

**Summary:**
- 65 files (~8,030 lines)
- 4 new database tables + 1 table extension
- 142 criteria (all AUTO_VERIFY)
- Iteration budgets: P2=5, P3=4, P4=4, P5=6, P6=7 (total: 26)

**Build order:**
1. Database migrations (4 migrations)
2. Phase 2: Time Tracking (timer, log, breakdown)
3. Phase 3: Pomodoro Timer (panel, progress, audio)
4. Phase 4: Weekly Targets (metrics, sparklines)
5. Phase 5: Stock Pickups (calendar, scheduling, completion)
6. Phase 6: Insights & Settings (aggregation, config, notifications)
7. Integration & Polish

**Risks flagged:**
- Medium: Insights query performance (mitigated with parallel + progressive)
- Medium: Push notification permission (mitigated with in-app fallback)

**Dependencies:**
- Phase 1 complete (verified)
- Existing platform sync infrastructure
- Existing reports for insights data sources

**Ready for:** `/build-feature business-workflow-phases-2-6`
