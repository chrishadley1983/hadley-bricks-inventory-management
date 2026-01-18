# Feature: Dashboard

> **Category:** Business Intelligence
> **Primary Entry Point:** `/dashboard`
> **Complexity:** Low

## Overview

The Dashboard is the home page of the Hadley Bricks inventory system, providing an at-a-glance view of business health. It displays financial metrics, inventory status breakdowns, listing performance targets, alerts, and recent activity—all filterable by platform and with the option to exclude sold items.

**Key Value Proposition:**
- Rolling 12-month revenue tracking
- Monthly turnover and profit metrics
- Daily/weekly listing value targets vs actuals
- Inventory breakdown by status with cost/value
- Bricqer parts inventory integration
- Actionable alerts for pending items
- Recent inventory activity feed

## User Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Dashboard                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Summary Row (4 Cards)                                                │   │
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────────────────┐ │   │
│  │ │  Annual   │ │  Monthly  │ │  Monthly  │ │ Listing Performance   │ │   │
│  │ │ Turnover  │ │ Turnover  │ │  Profit   │ │ Today: £X / £200      │ │   │
│  │ │ £45,230   │ │  £3,450   │ │ +£1,234   │ │ Week: £X / £1,000     │ │   │
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Controls                               Platform: [All Platforms ▼]        │
│                                         [✓] Exclude sold items             │
│                                                                             │
│  ┌───────────────┐ ┌───────────────┐ ┌─────────────────────────────────┐   │
│  │   Bricqer     │ │   Inventory   │ │      Status Breakdown           │   │
│  │  Inventory    │ │    Value      │ │                                 │   │
│  │               │ │               │ │ Not Received ████░░░░░░  120    │   │
│  │ 12,450 Lots   │ │ Status│Cost│Val│ │ Backlog      ██████████  340    │   │
│  │ 89,230 Pieces │ │ Back. │£X  │£Y │ │ Listed       ████████░░  280    │   │
│  │ £34,500 Value │ │ List. │£X  │£Y │ │ Sold         ██░░░░░░░░   85    │   │
│  │               │ │ Total │£X  │£Y │ │ Returned     █░░░░░░░░░   12    │   │
│  └───────────────┘ └───────────────┘ └─────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────┐ ┌─────────────────────────────────┐   │
│  │      Recent Activity            │ │        Alerts & Status          │   │
│  │                                 │ │                                 │   │
│  │ ┌───────────────────────────┐  │ │ ⏰ Pending Receipt              │   │
│  │ │ Set 75192 • New • £120   │  │ │    120 items awaiting delivery   │   │
│  │ │ 2 hours ago              │  │ │                                 │   │
│  │ └───────────────────────────┘  │ │ 🛒 Listed Items                 │   │
│  │ ┌───────────────────────────┐  │ │    280 items currently listed   │   │
│  │ │ Set 10294 • Used • £85   │  │ │                                 │   │
│  │ │ 5 hours ago              │  │ │                                 │   │
│  │ └───────────────────────────┘  │ │                                 │   │
│  └─────────────────────────────────┘ └─────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Dashboard Widgets

### 1. Summary Row

A row of four stat cards showing key business metrics:

| Card | Metric | Source | Description |
|------|--------|--------|-------------|
| **Annual Turnover** | Rolling 12-month revenue | P&L Report | Sum of Income category for last 12 months |
| **Turnover This Month** | Current month revenue | P&L Report | Sum of Income category for current month |
| **Profit This Month** | Net profit | P&L Report | Grand total for current month (revenue - expenses) |
| **Listing Performance** | Daily/weekly targets | Daily Activity | Compares actual listing value vs configurable target |

**Listing Performance Table:**
| Period | Target | Diff | % |
|--------|--------|------|---|
| Today | £200 | +£50 | 125% |
| This Week | £1,000 | -£200 | 80% |

- Target is configurable in Report Settings (default: £200/day)
- Week runs Monday to today
- Green text for meeting target, amber/red for below

### 2. Bricqer Inventory Widget

Displays parts inventory from connected Bricqer account:

| Metric | Description |
|--------|-------------|
| **Lots** | Unique part types in inventory |
| **Pieces** | Total quantity of all parts |
| **Value** | Total inventory value in GBP |
| **Last Updated** | Relative time since last sync |

**Features:**
- Manual refresh button with progress indicator
- Shows live counts during scan (lot count, piece count)
- Progress bar during refresh operation

### 3. Inventory Value Widget

Financial breakdown of inventory by status:

| Status | Cost | Value |
|--------|------|-------|
| Not Received | £X | £Y |
| Backlog (Valued) | £X | £Y |
| Backlog (Unvalued) | £X | — |
| Listed | £X | £Y |
| Sold | £X | £Y |
| Returned | £X | £Y |
| **Total** | **£X** | **£Y** |

**Features:**
- Color-coded status labels
- Listed Margin percentage (profit as % of selling price)
- Respects "Exclude Sold" toggle
- Respects platform filter

### 4. Status Breakdown Widget

Visual bar chart of inventory counts by status:

| Status | Color | Description |
|--------|-------|-------------|
| Not Received | Yellow | Items awaiting delivery |
| Backlog | Green | Items ready to list |
| Listed | Blue | Items currently on sale |
| Sold | Purple | Items that have sold |
| Returned | Orange | Items returned by buyers |

**Features:**
- Progress bar per status showing percentage of total
- Respects "Exclude Sold" toggle
- Respects platform filter

### 5. Recent Activity Widget

Shows the 5 most recently added inventory items:

**Item Display:**
```
┌─────────────────────────────────────────────────────────────────────┐
│ Set 75192 • New                                        £120.00     │
│ Item Name                                              2 hours ago │
└─────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Clickable links to inventory detail page
- Shows set number, condition, cost
- Relative time display (e.g., "2 hours ago")

### 6. Alerts & Status Widget

Actionable alerts for inventory needing attention:

| Alert | Icon | Description |
|-------|------|-------------|
| **Pending Receipt** | Clock | Items with "Not Yet Received" status |
| **Listed Items** | Shopping Cart | Items currently listed for sale |

**Features:**
- Clickable links to filtered inventory view
- Shows count and description
- Only displays alerts with items > 0

---

## Dashboard Controls

### Platform Filter

Dropdown to filter all widgets by selling platform:

- **All Platforms** (default) — Show all inventory
- **eBay** — Only eBay-listed items
- **Amazon** — Only Amazon-listed items
- **BrickLink** — Only BrickLink-listed items
- **Brick Owl** — Only Brick Owl-listed items

### Exclude Sold Toggle

Switch to hide/show sold items across all widgets:

- **On** (default) — Hide sold items from counts and values
- **Off** — Include sold items in all metrics

**Persistence:** Both settings are stored in localStorage and remembered across sessions.

---

## Data Sources

### Profit & Loss Report

Used by Summary widgets for revenue and profit:

```typescript
interface ProfitLossReport {
  categoryTotals: {
    Income: Record<string, number>;  // By month
    // ...other categories
  };
  grandTotal: Record<string, number>;  // Net by month
}
```

### Daily Activity Report

Used by Listing Performance widget:

```typescript
interface DailyActivityReport {
  summary: {
    grandTotals: {
      totalListingValue: number;
      // ...other totals
    };
  };
}
```

### Inventory Summary

Used by multiple widgets:

```typescript
interface InventorySummary {
  totalItems: number;
  totalCost: number;
  totalListingValue: number;
  byStatus: Record<string, number>;  // Count by status
  valueByStatus: Record<string, {
    count: number;
    cost: number;
    listingValue: number;
  }>;
}
```

### Bricqer Inventory Stats

Used by Bricqer widget:

```typescript
interface BricqerInventoryStats {
  lotCount: number;      // Unique part types
  pieceCount: number;    // Total quantities
  inventoryValue: number; // GBP value
  lastUpdated: string;   // ISO date
}
```

---

## State Management

### Dashboard Store (Zustand)

```typescript
interface DashboardState {
  excludeSold: boolean;        // Hide sold items
  toggleExcludeSold: () => void;
  platform: string | null;     // null = "All Platforms"
  setPlatform: (platform: string | null) => void;
}
```

**Persistence:** Uses `zustand/persist` middleware with localStorage key `dashboard-preferences`.

---

## Technical Details

### Widget Loading

All widgets use dynamic imports with skeleton placeholders:

```typescript
const DashboardSummaryWidget = dynamic(
  () => import('@/components/features/dashboard').then(mod => ({
    default: mod.DashboardSummaryWidget
  })),
  { ssr: false, loading: () => <StatCardSkeleton /> }
);
```

### Date Calculations

| Function | Purpose |
|----------|---------|
| `getMondayOfCurrentWeek()` | Get Monday for weekly calculations |
| `getToday()` | Get today at midnight |
| `getLast12MonthsRange()` | Rolling 12-month range |
| `getCurrentMonthRange()` | Current month start/end |

### Query Hooks Used

| Hook | Purpose |
|------|---------|
| `useProfitLossReport` | P&L data for revenue/profit |
| `useDailyActivityReport` | Daily listing activity |
| `useInventorySummary` | Inventory counts and values |
| `useBricqerInventoryStats` | Bricqer parts inventory |
| `useInventoryList` | Recent inventory items |
| `usePlatforms` | Available platform list |
| `useReportSettings` | Daily target configuration |

---

## Source Files

| File | Purpose |
|------|---------|
| [page.tsx](../../../apps/web/src/app/(dashboard)/dashboard/page.tsx) | Main dashboard page |
| [DashboardSummaryWidget.tsx](../../../apps/web/src/components/features/dashboard/DashboardSummaryWidget.tsx) | Financial summary cards |
| [InventorySummaryWidget.tsx](../../../apps/web/src/components/features/dashboard/InventorySummaryWidget.tsx) | Total inventory count |
| [StatusBreakdownWidget.tsx](../../../apps/web/src/components/features/dashboard/StatusBreakdownWidget.tsx) | Status bar chart |
| [FinancialSnapshotWidget.tsx](../../../apps/web/src/components/features/dashboard/FinancialSnapshotWidget.tsx) | Value by status grid |
| [LowStockWidget.tsx](../../../apps/web/src/components/features/dashboard/LowStockWidget.tsx) | Alerts and status |
| [RecentActivityWidget.tsx](../../../apps/web/src/components/features/dashboard/RecentActivityWidget.tsx) | Recent inventory |
| [BricqerInventoryWidget.tsx](../../../apps/web/src/components/features/dashboard/BricqerInventoryWidget.tsx) | Bricqer parts stats |
| [dashboard.store.ts](../../../apps/web/src/stores/dashboard.store.ts) | Dashboard preferences store |

## Related Features

- [Reports](../reports/overview.md) — Detailed P&L and analytics
- [Inventory](../inventory/overview.md) — Full inventory management
- [Transactions](../transactions/overview.md) — Financial data sources
