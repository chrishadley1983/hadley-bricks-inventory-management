'use client';

import { useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSyncStore, type TableSyncStatus } from '@/stores';
import { inventoryKeys } from './use-inventory';
import { purchaseKeys } from './use-purchases';

/**
 * Sync a table from Google Sheets
 */
async function syncTable(tableName: 'inventory' | 'purchases'): Promise<{ count: number }> {
  // Only log detailed sync info in development to avoid performance impact in production
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    console.log(`[syncTable] Table: ${tableName}, Timestamp: ${timestamp}`);
  }

  const response = await fetch(`/api/sync/${tableName}`, {
    method: 'POST',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to sync ${tableName}`);
  }

  const result = await response.json();
  if (process.env.NODE_ENV === 'development') {
    console.log(`[syncTable] Sync complete for ${tableName}:`, result);
  }
  return result.data;
}

/**
 * Hook for accessing sync status of a specific table
 */
export function useSyncStatus(tableName: 'inventory' | 'purchases'): TableSyncStatus {
  const tableStatus = useSyncStore((state) => state.tables[tableName]);
  return (
    tableStatus || {
      lastSync: null,
      status: 'stale',
      recordCount: 0,
    }
  );
}

/**
 * Hook for syncing a specific table
 */
export function useSyncTable(tableName: 'inventory' | 'purchases') {
  const queryClient = useQueryClient();
  const { setTableSyncing, setTableSynced, setTableError } = useSyncStore();

  const mutation = useMutation({
    mutationFn: () => syncTable(tableName),
    onMutate: () => {
      setTableSyncing(tableName);
    },
    onSuccess: (data) => {
      setTableSynced(tableName, data.count);
      // Surgical invalidation - only invalidate lists and summary, not detail views
      if (tableName === 'inventory') {
        queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
        queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
      } else {
        queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
      }
    },
    onError: (error: Error) => {
      setTableError(tableName, error.message);
    },
  });

  return {
    sync: mutation.mutate,
    syncAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

/**
 * Hook for syncing all tables
 */
export function useSyncAll() {
  const queryClient = useQueryClient();
  const { setGlobalSyncing, setGlobalError, setTableSynced, setTableError } = useSyncStore();

  const syncAll = useCallback(async () => {
    setGlobalSyncing(true);
    setGlobalError(null);

    try {
      // Sync both tables in parallel
      const [inventoryResult, purchasesResult] = await Promise.allSettled([
        syncTable('inventory'),
        syncTable('purchases'),
      ]);

      if (inventoryResult.status === 'fulfilled') {
        setTableSynced('inventory', inventoryResult.value.count);
      } else {
        setTableError('inventory', inventoryResult.reason?.message || 'Sync failed');
      }

      if (purchasesResult.status === 'fulfilled') {
        setTableSynced('purchases', purchasesResult.value.count);
      } else {
        setTableError('purchases', purchasesResult.reason?.message || 'Sync failed');
      }

      // Surgical invalidation - only invalidate lists and summary, not detail views
      queryClient.invalidateQueries({ queryKey: inventoryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: inventoryKeys.summary() });
      queryClient.invalidateQueries({ queryKey: purchaseKeys.lists() });
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : 'Sync failed');
    } finally {
      setGlobalSyncing(false);
    }
  }, [queryClient, setGlobalSyncing, setGlobalError, setTableSynced, setTableError]);

  const isSyncing = useSyncStore((state) => state.isSyncing);
  const lastError = useSyncStore((state) => state.lastError);

  return {
    syncAll,
    isSyncing,
    lastError,
  };
}

/**
 * Hook for syncing on page load if data is stale
 *
 * @param tableName The table to sync
 * @param options Configuration options
 */
export function useSyncOnLoad(
  tableName: 'inventory' | 'purchases',
  options: {
    /** Whether to auto-sync on load (default: true) */
    enabled?: boolean;
    /** TTL in milliseconds before considering data stale (default: 5 min) */
    staleTtlMs?: number;
  } = {}
) {
  const { enabled = true, staleTtlMs = 5 * 60 * 1000 } = options;

  const tableStatus = useSyncStatus(tableName);
  const { sync, isPending } = useSyncTable(tableName);

  useEffect(() => {
    if (!enabled) {
      console.log(`[useSyncOnLoad] ${tableName}: Sync disabled`);
      return;
    }

    // Check if we should sync
    const isStale =
      !tableStatus.lastSync ||
      new Date().getTime() - tableStatus.lastSync.getTime() > staleTtlMs;

    console.log(`[useSyncOnLoad] ${tableName}: Checking sync status`, {
      enabled,
      isStale,
      lastSync: tableStatus.lastSync,
      status: tableStatus.status,
      staleTtlMs,
    });

    if (isStale && tableStatus.status !== 'syncing') {
      console.log(`[useSyncOnLoad] ${tableName}: AUTO-TRIGGERING SYNC (data is stale)`);
      sync();
    }
  }, [enabled, staleTtlMs, sync, tableStatus.lastSync, tableStatus.status, tableName]);

  return {
    status: tableStatus,
    isSyncing: isPending,
    manualSync: sync,
  };
}

/**
 * Hook for getting the overall sync state
 */
export function useGlobalSyncStatus() {
  const tables = useSyncStore((state) => state.tables);
  const isSyncing = useSyncStore((state) => state.isSyncing);
  const lastError = useSyncStore((state) => state.lastError);

  // Calculate overall status
  const tableStatuses = Object.values(tables);
  const hasError = tableStatuses.some((t) => t.status === 'error');
  const hasStale = tableStatuses.some((t) => t.status === 'stale');
  const allSynced = tableStatuses.every((t) => t.status === 'synced');

  const overallStatus: 'synced' | 'syncing' | 'stale' | 'error' = isSyncing
    ? 'syncing'
    : hasError
      ? 'error'
      : hasStale
        ? 'stale'
        : allSynced
          ? 'synced'
          : 'stale';

  // Get the oldest last sync time
  const lastSyncTimes = tableStatuses.map((t) => t.lastSync).filter(Boolean) as Date[];
  const oldestSync = lastSyncTimes.length > 0 ? new Date(Math.min(...lastSyncTimes.map((d) => d.getTime()))) : null;

  return {
    status: overallStatus,
    lastSync: oldestSync,
    isSyncing,
    lastError,
    tables,
  };
}
