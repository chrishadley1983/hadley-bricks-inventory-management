# Feature Specification: business-workflow (Phase 1)

**Generated:** 2026-01-18
**Based on:** done-criteria.md (46 criteria)
**Status:** READY_FOR_BUILD

---

## 1. Summary

The Business Workflow feature creates a central operations hub at `/workflow` that displays a prioritised task queue, critical actions panel (orders with dispatch SLA deadlines, inventory resolution status, platform sync status), and completed today section. Phase 1 focuses on the core workflow page with task management (start/complete/skip/defer), 20+ pre-seeded system tasks with dynamic counts, off-system task quick-add with presets, and full integration with eBay Trading API and Amazon SP-API to fetch real dispatch deadlines. The page follows the spec layout with responsive design and uses existing UI patterns (shadcn/ui, skeletons, toasts).

---

## 2. Criteria Mapping

| Criterion | Implementation Approach |
|-----------|------------------------|
| **F1-F3:** Page & Navigation | New page at `apps/web/src/app/(dashboard)/workflow/page.tsx`, add to Sidebar navigation |
| **F4-F10:** Critical Actions - Orders | New `OrdersDispatchPanel` component, fetch from `/api/orders/dispatch-deadlines` |
| **F6-F7, F42-F43:** Dispatch SLAs | Add `dispatch_by` column to `platform_orders`, extend eBay/Amazon sync services |
| **F11:** Inventory Resolution | Reuse existing resolution queue API, display count with link |
| **F12-F14:** Platform Sync Status | New `PlatformSyncStatusGrid` component, reuse `SyncStatusProvider` |
| **F15-F23:** Task Queue | New `TaskQueue` component, task definitions table, instances table, CRUD APIs |
| **F24-F28:** Off-System Tasks | Quick-add dialog, presets table, preset buttons in dropdown |
| **F29-F31:** Completed Today | New `CompletedTodaySection` component with collapsible UI |
| **F32-F36:** Database Schema | 5 new tables + 1 column migration |
| **F37-F41:** API Endpoints | 5 new API routes for workflow, extend orders API |
| **E1-E6:** Error Handling | Per-section error boundaries, toast notifications, retry buttons |
| **P1-P4:** Performance | Progressive loading, optimistic updates, parallel API calls |
| **U1-U8:** UI/UX | shadcn/ui components, responsive layouts, loading skeletons |
| **I1-I4:** Integration | Deep-link validation, count consistency, sync status accuracy |

---

## 3. Architecture

### 3.1 Integration Points

| Integration Point | Current State | Integration Plan |
|-------------------|--------------|------------------|
| **Sidebar Navigation** | Has 5 nav groups | Add "Workflow" to top of Main group (before Dashboard) |
| **Orders System** | `platform_orders` table, sync services | Add `dispatch_by` column, extend sync to fetch SLAs |
| **Platform Sync** | `SyncStatusProvider`, per-platform sync routes | Reuse provider, create aggregate sync endpoint |
| **Inventory Resolution** | Resolution queue pages exist | Fetch unresolved count from existing API |
| **Picking List** | Feature exists at `/orders?picking=true` | Link via Generate Picking List buttons |

### 3.2 Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           /workflow Page                                     │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Critical Actions Panel                                               │   │
│  │                                                                      │   │
│  │  ┌────────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │   │
│  │  │ Orders to Dispatch │  │ Inventory        │  │ Platform Sync   │  │   │
│  │  │ (by platform)      │  │ Resolution       │  │ Status Grid     │  │   │
│  │  │ - eBay (5)         │  │ (12 items)       │  │ eBay ✓ Amazon ✓ │  │   │
│  │  │ - Amazon (2)       │  │ [View →]         │  │ BL ✓  BO ⚠     │  │   │
│  │  │ [Picking List]     │  │                  │  │ [Sync All]      │  │   │
│  │  └────────────────────┘  └──────────────────┘  └─────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Task Queue                                         [+ Add Task ▼]   │   │
│  │                                                                      │   │
│  │  ┌───────────────────────────────────────────────────────────────┐  │   │
│  │  │ 🔴 Process orders (7)           30m    Daily                  │  │   │
│  │  │    [Start] [Complete] [Skip] [Defer]                          │  │   │
│  │  ├───────────────────────────────────────────────────────────────┤  │   │
│  │  │ 🔴 Sync platforms                5m     Daily                 │  │   │
│  │  │    [Start] [Complete] [Skip] [Defer]                          │  │   │
│  │  ├───────────────────────────────────────────────────────────────┤  │   │
│  │  │ 🟡 Arbitrage check (AM)         15m    Daily                  │  │   │
│  │  │    [Start] [Complete] [Skip] [Defer]                          │  │   │
│  │  └───────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Completed Today (3 tasks | 1h 45m)                         [▼/▲]   │   │
│  │  ✓ Process orders - 10:30am (45m)                                   │   │
│  │  ✓ Sync platforms - 11:15am (5m)                                    │   │
│  │  ✓ Post parcels - 12:00pm (55m)                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Data Flow:

┌────────────┐     ┌─────────────────────────────────────────────────────────┐
│  /workflow │────▶│ Multiple parallel API calls:                            │
│   page     │     │  - GET /api/workflow/tasks/today     → Task queue       │
│            │     │  - GET /api/orders/dispatch-deadlines → Orders panel    │
│            │     │  - GET /api/ebay/resolution-queue    → Resolution count │
│            │     │  - GET /api/sync/status              → Sync grid        │
└────────────┘     └─────────────────────────────────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Supabase Database                               │
│                                                                              │
│  ┌─────────────────┐  ┌───────────────────────┐  ┌───────────────────────┐ │
│  │ workflow_config │  │ workflow_task_         │  │ workflow_task_        │ │
│  │ (user settings) │  │ definitions           │  │ instances             │ │
│  └─────────────────┘  │ (20+ system tasks)    │  │ (today's queue)       │ │
│                       └───────────────────────┘  └───────────────────────┘ │
│                                                                              │
│  ┌─────────────────┐  ┌───────────────────────┐                            │
│  │ off_system_     │  │ platform_orders       │                            │
│  │ task_presets    │  │ (with dispatch_by)    │                            │
│  └─────────────────┘  └───────────────────────┘                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Task instance generation** | On-demand on page load | Simpler than cron; generate missing instances when user views page |
| **Dynamic counts** | Separate queries per count source | Allows progressive loading; can cache per source |
| **Dispatch deadlines** | Stored in `platform_orders.dispatch_by` | Calculated once on sync, not recalculated on page load |
| **State management** | TanStack Query | Consistent with rest of app; enables optimistic updates |
| **Collapsible section** | Local state with localStorage persistence | Remembers user preference across sessions |

---

## 4. File Changes

### 4.1 New Files

| File | Purpose | Est. Lines |
|------|---------|------------|
| `apps/web/src/app/(dashboard)/workflow/page.tsx` | Main workflow page | 150-200 |
| `apps/web/src/app/(dashboard)/workflow/loading.tsx` | Loading skeleton | 30 |
| `apps/web/src/components/features/workflow/CriticalActionsPanel.tsx` | Critical actions container | 80 |
| `apps/web/src/components/features/workflow/OrdersDispatchPanel.tsx` | Orders with deadlines | 150 |
| `apps/web/src/components/features/workflow/InventoryResolutionCard.tsx` | Resolution count card | 50 |
| `apps/web/src/components/features/workflow/PlatformSyncStatusGrid.tsx` | Sync status grid | 100 |
| `apps/web/src/components/features/workflow/TaskQueue.tsx` | Task queue component | 200 |
| `apps/web/src/components/features/workflow/TaskCard.tsx` | Individual task card | 120 |
| `apps/web/src/components/features/workflow/TaskActionsMenu.tsx` | Task action buttons | 80 |
| `apps/web/src/components/features/workflow/AddTaskDropdown.tsx` | Add task dropdown menu | 100 |
| `apps/web/src/components/features/workflow/QuickAddTaskDialog.tsx` | Quick add form dialog | 150 |
| `apps/web/src/components/features/workflow/CompletedTodaySection.tsx` | Completed today section | 100 |
| `apps/web/src/components/features/workflow/index.ts` | Barrel exports | 20 |
| `apps/web/src/app/api/workflow/tasks/today/route.ts` | Get today's tasks API | 100 |
| `apps/web/src/app/api/workflow/tasks/route.ts` | Create ad-hoc task | 60 |
| `apps/web/src/app/api/workflow/tasks/[id]/route.ts` | Update task status | 80 |
| `apps/web/src/app/api/orders/dispatch-deadlines/route.ts` | Orders with SLAs | 80 |
| `apps/web/src/app/api/sync/all/route.ts` | Sync all platforms | 60 |
| `apps/web/src/app/api/sync/status/route.ts` | Get sync status | 50 |
| `apps/web/src/lib/services/workflow.service.ts` | Workflow business logic | 200 |
| `apps/web/src/lib/repositories/workflow.repository.ts` | Workflow data access | 150 |
| `apps/web/src/hooks/use-workflow.ts` | TanStack Query hooks | 150 |
| `supabase/migrations/2026XXXX_workflow_tables.sql` | Create workflow tables | 200 |
| `supabase/migrations/2026XXXX_workflow_seed.sql` | Seed system tasks | 150 |
| `supabase/migrations/2026XXXX_orders_dispatch_by.sql` | Add dispatch_by column | 30 |

**Total new files:** ~25 files, ~2,500 estimated lines

### 4.2 Modified Files

| File | Changes | Est. Lines Changed |
|------|---------|-------------------|
| `apps/web/src/components/layout/Sidebar.tsx` | Add Workflow nav item | 5 |
| `apps/web/src/lib/ebay/ebay-order-sync.service.ts` | Fetch shipping SLA from Trading API, store in dispatch_by | 50 |
| `apps/web/src/lib/services/amazon-order.service.ts` | Extract LatestShipDate from order data, store in dispatch_by | 30 |
| `packages/database/src/types/database.types.ts` | Regenerate types after migration | Auto-generated |

**Total modified files:** ~4 files, ~85 estimated lines changed

---

## 5. Implementation Details

### 5.1 Database Schema

#### workflow_config
```sql
CREATE TABLE workflow_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,

  -- Listing inventory targets (Phase 4)
  target_ebay_listings INTEGER DEFAULT 500,
  target_amazon_listings INTEGER DEFAULT 250,
  target_bricklink_weekly_value DECIMAL DEFAULT 1000,

  -- Daily flow targets (Phase 4)
  target_daily_listed_value DECIMAL DEFAULT 300,
  target_daily_sold_value DECIMAL DEFAULT 250,

  -- Working days (bitmask: Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64)
  working_days INTEGER DEFAULT 127, -- All days

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### workflow_task_definitions
```sql
CREATE TABLE workflow_task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(50) NOT NULL, -- Development, Listing, Shipping, Sourcing, Admin, Other
  icon VARCHAR(10),

  -- Scheduling
  frequency VARCHAR(50) NOT NULL, -- daily, twice_daily, twice_weekly, weekly, monthly, quarterly, biannual, adhoc
  frequency_days INTEGER[], -- For twice_weekly: [1,4] = Mon/Thu
  ideal_time VARCHAR(10), -- 'AM', 'PM', 'ANY'

  -- Priority & effort
  priority INTEGER DEFAULT 3, -- 1=Critical, 2=Important, 3=Regular, 4=Low
  estimated_minutes INTEGER,

  -- Deep link
  deep_link_url VARCHAR(255),
  deep_link_params JSONB,

  -- Dynamic count source (e.g., 'orders.paid', 'inventory.backlog')
  count_source VARCHAR(100),

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

#### workflow_task_instances
```sql
CREATE TABLE workflow_task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  task_definition_id UUID REFERENCES workflow_task_definitions(id) ON DELETE SET NULL,

  -- For ad-hoc tasks without definition
  name VARCHAR(255),
  description TEXT,
  category VARCHAR(50),
  icon VARCHAR(10),
  priority INTEGER,
  estimated_minutes INTEGER,
  deep_link_url VARCHAR(255),

  -- Task type
  task_type VARCHAR(20) DEFAULT 'system', -- system, off_system

  -- Scheduling
  scheduled_date DATE NOT NULL,
  due_time TIME,

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, skipped, deferred

  -- Completion tracking
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  time_spent_seconds INTEGER,

  -- For deferred tasks
  deferred_from_date DATE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflow_task_instances_user_date ON workflow_task_instances(user_id, scheduled_date);
CREATE INDEX idx_workflow_task_instances_status ON workflow_task_instances(status);
```

#### off_system_task_presets
```sql
CREATE TABLE off_system_task_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,

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

#### platform_orders modification
```sql
ALTER TABLE platform_orders
ADD COLUMN IF NOT EXISTS dispatch_by TIMESTAMPTZ;

CREATE INDEX idx_platform_orders_dispatch_by ON platform_orders(user_id, dispatch_by)
WHERE dispatch_by IS NOT NULL AND internal_status NOT IN ('Shipped', 'Completed', 'Cancelled');
```

### 5.2 API Specifications

#### GET /api/workflow/tasks/today
Returns today's task queue with dynamic counts.

**Response:**
```typescript
interface TasksResponse {
  tasks: Array<{
    id: string;
    name: string;
    description?: string;
    category: string;
    icon?: string;
    priority: 1 | 2 | 3 | 4;
    estimatedMinutes?: number;
    scheduledDate: string;
    dueTime?: string;
    status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'deferred';
    deepLinkUrl?: string;
    deepLinkParams?: Record<string, string>;
    taskType: 'system' | 'off_system';
    count?: number; // Dynamic count if count_source defined
    definitionId?: string;
  }>;
  completedToday: Array<{
    id: string;
    name: string;
    completedAt: string;
    timeSpentSeconds?: number;
    category: string;
  }>;
  summary: {
    tasksCompleted: number;
    totalTimeSeconds: number;
  };
}
```

#### GET /api/orders/dispatch-deadlines
Returns orders grouped by platform with dispatch SLA deadlines.

**Response:**
```typescript
interface DispatchDeadlinesResponse {
  platforms: Array<{
    platform: 'ebay' | 'amazon' | 'bricklink' | 'brickowl';
    orders: Array<{
      id: string;
      platformOrderId: string;
      buyerName: string;
      total: number;
      currency: string;
      dispatchBy: string; // ISO timestamp
      isOverdue: boolean;
      isUrgent: boolean; // Within 2 hours
      itemCount: number;
    }>;
    orderCount: number;
    earliestDeadline?: string;
  }>;
  overdueCount: number;
  urgentCount: number;
}
```

#### PATCH /api/workflow/tasks/[id]
Update task status.

**Request:**
```typescript
interface UpdateTaskRequest {
  status: 'completed' | 'skipped' | 'deferred';
  deferredToDate?: string; // ISO date, required if deferred
}
```

### 5.3 Component Specifications

#### TaskCard
```tsx
interface TaskCardProps {
  task: Task;
  onStart: () => void;
  onComplete: () => void;
  onSkip: () => void;
  onDefer: (date: Date) => void;
}
```

**UI Elements:**
- Priority indicator badge (coloured: red/amber/green/blue)
- Icon (from task definition or default)
- Name with dynamic count in parentheses
- Estimated duration badge
- Schedule/due badge (Today, AM, PM, etc.)
- Action buttons row: Start, Complete, Skip, Defer (with calendar popover)

#### OrdersDispatchPanel
```tsx
interface OrdersDispatchPanelProps {
  className?: string;
}
```

**UI Elements:**
- Platform tabs (eBay, Amazon, BrickLink, Brick Owl)
- Per-platform order list with countdown timers
- Overdue section (red highlight) at top
- Urgent section (amber highlight) after overdue
- Generate Picking List button per platform
- Empty state: "No orders awaiting dispatch"

### 5.4 System Task Definitions (Seed Data)

| Task | Category | Frequency | Priority | Duration | Deep Link | Count Source |
|------|----------|-----------|----------|----------|-----------|--------------|
| Process orders / Ship | Shipping | Daily | Critical | 30-60m | `/orders?status=paid` | `orders.paid` |
| Resolve inventory matches | Admin | Daily | Critical | 10-20m | `/settings/inventory-resolution` | `resolution.pending` |
| Sync all platforms | Admin | Daily | Critical | 2-5m | Trigger sync | - |
| Arbitrage check (AM) | Sourcing | Daily | Important | 15-30m | `/arbitrage/amazon` | - |
| Arbitrage check (PM) | Sourcing | Daily | Important | 15-30m | `/arbitrage/amazon` | - |
| List from backlog | Listing | Daily | Important | 2-4h | `/inventory?status=BACKLOG` | `inventory.backlog` |
| Categorise Monzo transactions | Admin | Twice weekly | Regular | 10-15m | `/transactions?tab=monzo&filter=uncategorised` | `transactions.uncategorised` |
| Review slow-moving inventory | Listing | Weekly | Regular | 20-30m | `/reports/inventory-aging` | `inventory.stale` |
| Send buyer discount offers | Listing | Twice weekly | Regular | 10-15m | `/listing-assistant?tab=offers` | - |
| Refresh old eBay listings | Listing | Weekly | Regular | 20-30m | `/listing-assistant?tab=refresh` | `ebay.refresh_eligible` |
| Review Amazon repricing | Listing | Weekly | Regular | 15-20m | `/repricing` | - |
| Push Amazon price changes | Listing | As needed | Regular | 5-10m | `/amazon-sync` | `amazon_sync.pending` |
| Analyse low-score listings | Listing | Weekly | Regular | 20-30m | `/listing-assistant` | `listings.low_score` |
| Review platform performance | Admin | Weekly | Low | 15-20m | `/reports/platform-performance` | - |
| Monthly P&L review | Admin | Monthly | Low | 30-45m | `/reports/profit-loss?period=lastMonth` | - |
| Inventory valuation check | Admin | Monthly | Low | 15-20m | `/reports/inventory-valuation` | - |
| Review purchase ROI | Admin | Monthly | Low | 20-30m | `/reports/purchase-analysis` | - |
| Discover new ASINs (seeded) | Sourcing | Monthly | Low | 30-45m | `/arbitrage/amazon?tab=seeded` | - |
| Re-analyse listing scores | Listing | Quarterly | Low | 30-45m | `/listing-assistant?reanalyse=stale` | - |
| Review Amazon stock discrepancies | Admin | Biannual | Low | 45-60m | `/platform-stock?compare=true` | - |
| Review eBay stock discrepancies | Admin | Biannual | Low | 45-60m | `/ebay-stock?compare=true` | - |

### 5.5 Off-System Task Presets (Seed Data)

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

---

## 6. Build Order

### Step 1: Database Schema (F32-F36)
1. Create migration for workflow tables (workflow_config, workflow_task_definitions, workflow_task_instances, off_system_task_presets)
2. Create migration for dispatch_by column on platform_orders
3. Create seed migration for system tasks and presets
4. Push migrations and regenerate types

**Verification:** Tables exist, types regenerated

### Step 2: Workflow Repository & Service (F37-F39)
1. Create `workflow.repository.ts` with CRUD operations
2. Create `workflow.service.ts` with business logic:
   - Generate missing task instances for today
   - Calculate dynamic counts
   - Handle task status updates
3. Create TanStack Query hooks in `use-workflow.ts`

**Verification:** Unit tests for service logic pass

### Step 3: Task Queue API & Components (F15-F23)
1. Create `GET /api/workflow/tasks/today` endpoint
2. Create `PATCH /api/workflow/tasks/[id]` endpoint
3. Create `POST /api/workflow/tasks` endpoint
4. Build TaskCard, TaskQueue, TaskActionsMenu components

**Verification:** API returns tasks; actions update status

### Step 4: Off-System Tasks (F24-F28)
1. Create AddTaskDropdown component
2. Create QuickAddTaskDialog component
3. Wire up preset buttons to create tasks instantly

**Verification:** Can add ad-hoc tasks and use presets

### Step 5: Dispatch SLA Integration (F6-F7, F42-F43)
1. Extend eBay order sync to fetch ShippingTimeMax from Trading API
2. Extend Amazon order sync to store LatestShipDate
3. Create migration to backfill existing orders (if feasible)
4. Create `GET /api/orders/dispatch-deadlines` endpoint

**Verification:** Orders have dispatch_by populated

### Step 6: Critical Actions Panel (F4-F14)
1. Build OrdersDispatchPanel with countdown timers
2. Build InventoryResolutionCard (reuse existing API)
3. Build PlatformSyncStatusGrid
4. Create `POST /api/sync/all` endpoint
5. Assemble CriticalActionsPanel container

**Verification:** All three sections render with live data

### Step 7: Completed Today Section (F29-F31)
1. Build CompletedTodaySection component
2. Add collapsible functionality with localStorage persistence
3. Add summary calculation

**Verification:** Completed tasks appear; section collapses

### Step 8: Page Assembly (F1-F3, E1-E6, U1-U8)
1. Create main page.tsx with section layout
2. Add loading.tsx skeleton
3. Add Workflow link to Sidebar
4. Implement per-section error boundaries
5. Add toast notifications for actions
6. Test responsive layouts

**Verification:** Full page works end-to-end

### Step 9: Integration Testing (I1-I4, P1-P4)
1. Verify all deep links navigate correctly
2. Verify counts match source pages
3. Performance profiling and optimisation
4. Cross-browser testing

**Verification:** All integration criteria pass

---

## 7. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **eBay Trading API doesn't expose ShippingTimeMax easily** | Medium | High | May need to fetch shipping policy separately; fallback to order date + 3 days default |
| **Dynamic counts cause slow page load** | Medium | Medium | Progressive loading; cache counts briefly; limit concurrent requests |
| **Task instance generation logic complex** | Low | Medium | Thorough unit tests; handle edge cases (spanning midnight, timezone issues) |
| **Dispatch countdown timezone issues** | Medium | Low | Use UTC throughout; convert for display only |

### Scope Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| **Scope creep to add Phase 2-6 features** | High | Strict adherence to done-criteria.md; defer requests to future phases |
| **Task scheduling complexity** | Medium | Start simple (daily generation); enhance if needed |

### Integration Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **eBay API rate limits during sync** | Low | Medium | Already handled in existing sync service |
| **Amazon SP-API doesn't return LatestShipDate for all orders** | Medium | Medium | Fallback to order date + handling time; log missing data |

---

## 8. Feasibility Validation

| Criterion | Feasible | Confidence | Notes |
|-----------|----------|------------|-------|
| F1-F3: Page & Navigation | ✅ Yes | High | Standard Next.js patterns |
| F4-F10: Orders Dispatch | ✅ Yes | High | Builds on existing orders infrastructure |
| F6-F7: SLA from APIs | ✅ Yes | Medium | eBay Fulfilment API includes fulfillmentStartInstructions; Amazon has LatestShipDate |
| F11: Resolution Count | ✅ Yes | High | API already exists |
| F12-F14: Sync Status | ✅ Yes | High | Extends existing SyncStatusProvider |
| F15-F23: Task Queue | ✅ Yes | High | CRUD + sorting logic |
| F24-F28: Off-System Tasks | ✅ Yes | High | Standard form patterns |
| F29-F31: Completed Today | ✅ Yes | High | Query + collapsible UI |
| F32-F36: Database Schema | ✅ Yes | High | Standard migrations |
| F37-F41: API Endpoints | ✅ Yes | High | Standard API patterns |
| F42-F43: Sync Integration | ✅ Yes | Medium | Need to verify API response structure |
| E1-E6: Error Handling | ✅ Yes | High | Established patterns exist |
| P1-P4: Performance | ✅ Yes | Medium | Progressive loading achievable |
| U1-U8: UI/UX | ✅ Yes | High | shadcn/ui components available |
| I1-I4: Integration | ✅ Yes | High | Existing APIs to integrate |

**Overall:** All 46 criteria feasible with planned approach. ✅

**Medium Confidence Items:**
- F6-F7, F42-F43: SLA extraction from eBay/Amazon APIs - need to verify exact response fields
- P1-P4: Performance targets - may need optimisation iteration

---

## 9. Notes for Build Agent

### Hints

1. **Start with database migration** - Other work depends on types being generated
2. **eBay SLA data location** - Check `fulfillmentStartInstructions.shippingStep` in eBay Fulfilment API response, or may need Trading API GetSellerList for shipping policies
3. **Amazon LatestShipDate** - Already in `AmazonOrder` type at line 171 of `amazon/types.ts`
4. **Reuse existing patterns:**
   - `SyncStatusProvider` for sync state
   - Resolution queue API for counts
   - Toast from `use-toast` hook
5. **Task instance generation** - Call when page loads; check if instances exist for today; create missing ones from definitions
6. **Count sources** - Map count_source strings to actual queries:
   - `orders.paid` → `SELECT COUNT(*) FROM platform_orders WHERE internal_status = 'Paid'`
   - `inventory.backlog` → `SELECT COUNT(*) FROM inventory_items WHERE status = 'BACKLOG'`
7. **Priority sort** - 1 (Critical) should appear first, then 2 (Important), etc.
8. **Recurring task regeneration** - When completing/skipping a recurring task, don't generate next instance until next scheduled occurrence

### Common Gotchas

- `dispatch_by` should be NULL for orders already shipped/completed
- Task instances should have user_id for RLS
- Off-system tasks have no definition_id (ad-hoc)
- Countdown should show "Overdue" text for past deadlines, not negative numbers

---

## 10. Handoff Summary

**Feature:** business-workflow (Phase 1)
**Spec:** docs/features/business-workflow/feature-spec.md
**Criteria:** docs/features/business-workflow/done-criteria.md (46 criteria)
**Status:** READY_FOR_BUILD

**Summary:**
- 25 new files (~2,500 lines)
- 4 modified files (~85 lines)
- 5 new database tables + 1 column
- 46 criteria (all AUTO_VERIFY)
- Iteration budget: 7

**Build order:**
1. Database schema (migrations)
2. Repository & service layer
3. Task queue API & components
4. Off-system tasks
5. Dispatch SLA integration
6. Critical actions panel
7. Completed today section
8. Page assembly
9. Integration testing

**Risks flagged:**
- Medium: eBay/Amazon SLA extraction (mitigated with fallbacks)
- Medium: Performance targets (mitigated with progressive loading)

**Ready for:** `/build-feature business-workflow`
