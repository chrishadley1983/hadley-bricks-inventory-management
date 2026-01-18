# Feature: Data Sync

> **Category:** Data Management
> **Primary Entry Point:** Settings / Integrations pages
> **Complexity:** Medium

## Overview

The Sync feature manages data synchronization between external data sources and the Supabase database. Originally designed for Google Sheets as the primary data source, the system now uses Supabase as the source of truth, with sync functionality preserved for one-time data imports.

**Key Value Proposition:**
- Visual sync status indicators across the application
- Manual sync controls for legacy data imports
- Automatic sync for connected integrations (Monzo, PayPal)
- Centralized state management for sync operations

## Current Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Sync System                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Sync Store (Zustand)                                                 │   │
│  │ ┌─────────────────┐ ┌─────────────────┐ ┌──────────────────────────┐│   │
│  │ │ Table Status    │ │ Global State    │ │ Actions                  ││   │
│  │ │ - inventory     │ │ - isSyncing     │ │ - setTableSyncing()      ││   │
│  │ │ - purchases     │ │ - lastError     │ │ - setTableSynced()       ││   │
│  │ └─────────────────┘ └─────────────────┘ │ - setTableError()        ││   │
│  │                                          │ - setTableStale()        ││   │
│  │                                          └──────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────┐   │
│  │ Google Sheets   │ │ Monzo Auto-Sync │ │ PayPal Sync                 │   │
│  │ (Legacy/Import) │ │ (1 hour cycle)  │ │ (On-demand + Historical)    │   │
│  │                 │ │                 │ │                             │   │
│  │ ⚠️ Disabled     │ │ ✓ Active        │ │ ✓ Active                    │   │
│  └─────────────────┘ └─────────────────┘ └─────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Sync Status States

| Status | Badge Color | Description |
|--------|-------------|-------------|
| `synced` | Green | Data is current, no sync needed |
| `syncing` | Blue (pulsing) | Sync operation in progress |
| `stale` | Yellow | Data may be outdated, sync recommended |
| `error` | Red | Sync failed, action required |

### Staleness Detection

Data is considered stale after 5 minutes (configurable):

```typescript
const DEFAULT_STALE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

---

## Google Sheets Sync (Legacy)

> **Note:** Google Sheets sync is currently disabled. Supabase is now the source of truth. The sync functionality is preserved for one-time data imports if needed.

### Supported Tables

| Table | Description |
|-------|-------------|
| `inventory` | Inventory items from Sheets |
| `purchases` | Purchase records from Sheets |

### Manual Sync Controls

The `SyncControls` component provides manual sync buttons:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Google Sheets Sync                                                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Inventory                                              [Sync Now]    │   │
│  │ 🟢 Synced • 1,234 records • Last sync: 5 minutes ago                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ Purchases                                              [Sync Now]    │   │
│  │ 🟡 Stale • 567 records • Last sync: 2 hours ago                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  [Sync All Tables]                                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Hooks

| Hook | Purpose |
|------|---------|
| `useSyncStatus(table)` | Get current sync status for a table |
| `useSyncTable(table)` | Mutation hook to sync a specific table |
| `useSyncAll()` | Mutation hook to sync all tables |
| `useSyncOnLoad(table, options)` | Auto-sync on component mount if stale |
| `useGlobalSyncStatus()` | Get overall sync status across all tables |

---

## Monzo Auto-Sync

Automatically syncs Monzo transactions on a 1-hour interval when the integration is connected.

### Configuration

| Setting | Value |
|---------|-------|
| Sync Interval | 1 hour (3,600,000 ms) |
| Auto-start | Enabled when integration connected |
| Manual Trigger | Available via `triggerSync()` |

### Hook Interface

```typescript
function useMonzoAutoSync(enabled: boolean = true): {
  isConnected: boolean;
  lastSync: Date | null;
  transactionCount: number;
  isSyncing: boolean;
  triggerSync: () => void;
  needsSync: boolean;
}
```

### Sync Flow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Timer     │────▶│ Check if    │────▶│ Fetch new   │
│ (1 hour)    │     │ connected   │     │ transactions│
└─────────────┘     └─────────────┘     └─────────────┘
                           │                    │
                           │ Not connected      ▼
                           │              ┌─────────────┐
                           └────────────▶ │ Skip sync   │
                                          └─────────────┘
```

---

## PayPal Sync

Provides on-demand and automatic synchronization of PayPal transactions with support for historical imports.

### Sync Modes

| Mode | Description |
|------|-------------|
| **Incremental** | Fetch transactions since last sync |
| **Full** | Re-sync all transactions from configured start date |
| **Historical Import** | One-time import of older transactions |

### Hook Interface

```typescript
function usePayPalSync(options: {
  enabled?: boolean;
  autoSync?: boolean;
}): {
  isConnected: boolean;
  isRunning: boolean;
  config: PayPalSyncConfig | null;
  lastSync: Date | null;
  triggerSync: () => void;
  triggerHistoricalImport: (startDate: Date, endDate: Date) => void;
}
```

### Features

- **Auto-sync**: Optionally enabled via `autoSync` option
- **Historical Import**: Import transactions from a specific date range
- **Progress Tracking**: Reports sync progress during operations
- **Error Handling**: Captures and displays sync errors

---

## State Management

### Sync Store (Zustand)

```typescript
interface SyncState {
  /** Sync status by table name */
  tables: Record<string, TableSyncStatus>;

  /** Whether a global sync is in progress */
  isSyncing: boolean;

  /** Last global sync error */
  lastError: string | null;

  /** Actions */
  setTableStatus: (tableName: string, status: TableSyncStatus) => void;
  setTableSyncing: (tableName: string) => void;
  setTableSynced: (tableName: string, recordCount: number) => void;
  setTableError: (tableName: string, error: string) => void;
  setTableStale: (tableName: string) => void;
  setGlobalSyncing: (isSyncing: boolean) => void;
  setGlobalError: (error: string | null) => void;
  resetAll: () => void;
}
```

### Table Sync Status

```typescript
interface TableSyncStatus {
  lastSync: Date | null;
  status: 'synced' | 'syncing' | 'stale' | 'error';
  errorMessage?: string;
  recordCount: number;
}
```

---

## UI Components

### SyncStatusBadge

Displays sync status with color-coded badge:

```typescript
interface SyncStatusBadgeProps {
  status: TableSyncStatus;
  showTime?: boolean;  // Show "Last sync: X ago"
  className?: string;
}
```

**Visual States:**

| Status | Appearance |
|--------|------------|
| Synced | 🟢 Green badge |
| Syncing | 🔵 Blue pulsing badge |
| Stale | 🟡 Yellow badge |
| Error | 🔴 Red badge with error message |

### SyncControls

Manual sync controls card with table-specific or global sync options:

```typescript
interface SyncControlsProps {
  compact?: boolean;  // Minimal UI for embedding
  table?: 'inventory' | 'purchases';  // Single table or all
}
```

---

## Technical Details

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/sync/sheets` | POST | Trigger Google Sheets sync |
| `/api/sync/monzo` | POST | Trigger Monzo transaction sync |
| `/api/sync/paypal` | POST | Trigger PayPal transaction sync |
| `/api/sync/paypal/historical` | POST | Historical PayPal import |

### Query Keys

```typescript
// Sync status queries
const syncKeys = {
  all: ['sync'] as const,
  status: (table: string) => ['sync', 'status', table] as const,
  global: ['sync', 'global'] as const,
};
```

### Error Handling

Sync errors are:
1. Stored in the sync store (`errorMessage`)
2. Displayed via the SyncStatusBadge
3. Logged to console for debugging
4. Optionally reported to monitoring (Sentry)

---

## Source Files

| File | Purpose |
|------|---------|
| [sync.store.ts](../../../apps/web/src/stores/sync.store.ts) | Zustand store for sync state |
| [use-sync.ts](../../../apps/web/src/hooks/use-sync.ts) | Google Sheets sync hooks |
| [use-monzo-auto-sync.ts](../../../apps/web/src/hooks/use-monzo-auto-sync.ts) | Monzo auto-sync hook |
| [use-paypal-sync.ts](../../../apps/web/src/hooks/use-paypal-sync.ts) | PayPal sync hook |
| [SyncStatusBadge.tsx](../../../apps/web/src/components/features/sync/SyncStatusBadge.tsx) | Status badge component |
| [SyncControls.tsx](../../../apps/web/src/components/features/sync/SyncControls.tsx) | Manual sync controls |

## Related Features

- [Integrations](../integrations/overview.md) — Platform connections (Monzo, PayPal)
- [Transactions](../transactions/overview.md) — Transaction data display
- [Settings](../settings/overview.md) — Integration configuration
