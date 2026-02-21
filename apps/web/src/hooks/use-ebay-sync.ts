/**
 * eBay Sync Hook
 *
 * Provides sync status, manual sync triggers, and auto-sync functionality.
 * Use in dashboard layout or eBay transactions page.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// ============================================================================
// Types
// ============================================================================

interface EbaySyncConfig {
  autoSyncEnabled: boolean;
  autoSyncIntervalHours: number;
  lastAutoSyncAt?: string;
  nextAutoSyncAt?: string;
  historicalImportCompleted?: boolean;
}

interface EbaySyncStatus {
  isConnected: boolean;
  isRunning: boolean;
  runningSyncTypes: string[];
  config?: EbaySyncConfig;
  lastSync?: {
    orders?: { status: string; completedAt?: string; recordsProcessed?: number };
    transactions?: { status: string; completedAt?: string; recordsProcessed?: number };
    payouts?: { status: string; completedAt?: string; recordsProcessed?: number };
  };
}

interface SyncLog {
  id: string;
  sync_type: string;
  sync_mode: string;
  status: string;
  started_at: string;
  completed_at?: string;
  records_processed?: number;
  records_created?: number;
  records_updated?: number;
  error_message?: string;
}

interface SyncResponse {
  status: EbaySyncStatus;
  logs: SyncLog[];
}

interface ManualSyncResult {
  success: boolean;
  results: {
    orders?: { success: boolean; ordersProcessed?: number; error?: string };
    transactions?: { success: boolean; recordsProcessed?: number; error?: string };
    payouts?: { success: boolean; recordsProcessed?: number; error?: string };
  };
  totalDuration?: number;
}

interface HistoricalImportResult {
  success: boolean;
  results: {
    orders: { success: boolean; ordersProcessed: number; ordersCreated: number; error?: string };
    transactions: {
      success: boolean;
      recordsProcessed: number;
      recordsCreated: number;
      error?: string;
    };
    payouts: { success: boolean; recordsProcessed: number; recordsCreated: number; error?: string };
  };
  totalDuration: number;
  durationFormatted: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for eBay sync status and operations
 *
 * @param options.enabled - Whether to fetch status (default: true)
 * @param options.autoSync - Whether to trigger auto-sync when due (default: false)
 * @returns Object with sync status, actions, and loading states
 */
export function useEbaySync(options: { enabled?: boolean; autoSync?: boolean } = {}) {
  const { enabled = true, autoSync = false } = options;
  const queryClient = useQueryClient();
  const hasAttemptedAutoSync = useRef(false);

  // Fetch sync status
  const {
    data: syncData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<SyncResponse>({
    queryKey: ['ebay', 'sync', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/ebay/sync');
      if (!response.ok) {
        throw new Error('Failed to fetch eBay sync status');
      }
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: (data) => {
      // Poll more frequently when sync is running
      if (data?.state?.data?.status?.isRunning) {
        return 5 * 1000; // 5 seconds
      }
      return 60 * 1000; // 1 minute
    },
    enabled,
  });

  // Manual sync mutation
  const syncMutation = useMutation<ManualSyncResult, Error, { type?: string; fullSync?: boolean }>({
    mutationFn: async ({ type = 'all', fullSync = false }) => {
      const response = await fetch('/api/integrations/ebay/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, fullSync }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay', 'sync'] });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['ebay', 'payouts'] });
    },
  });

  // Historical import mutation
  const historicalImportMutation = useMutation<HistoricalImportResult, Error, { fromDate: string }>(
    {
      mutationFn: async ({ fromDate }) => {
        const response = await fetch('/api/integrations/ebay/sync/historical', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromDate }),
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Historical import failed');
        }
        return response.json();
      },
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['ebay', 'sync'] });
        queryClient.invalidateQueries({ queryKey: ['ebay', 'transactions'] });
        queryClient.invalidateQueries({ queryKey: ['ebay', 'payouts'] });
      },
    }
  );

  // Config update mutation
  const updateConfigMutation = useMutation<
    { config: EbaySyncConfig },
    Error,
    Partial<EbaySyncConfig>
  >({
    mutationFn: async (updates) => {
      const response = await fetch('/api/integrations/ebay/sync/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update config');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ebay', 'sync', 'status'] });
    },
  });

  // Check if auto-sync should run
  const shouldAutoSync = useCallback((): boolean => {
    if (!syncData?.status?.isConnected) return false;
    if (syncData?.status?.isRunning) return false;

    const config = syncData?.status?.config;
    if (!config?.autoSyncEnabled) return false;

    const nextSyncAt = config.nextAutoSyncAt;
    if (!nextSyncAt) return true; // Never synced

    return new Date() >= new Date(nextSyncAt);
  }, [syncData]);

  // Auto-sync effect
  useEffect(() => {
    if (!autoSync || hasAttemptedAutoSync.current || isLoadingStatus) {
      return;
    }

    if (shouldAutoSync()) {
      hasAttemptedAutoSync.current = true;
      syncMutation.mutate({ type: 'all', fullSync: false });
    }
  }, [autoSync, isLoadingStatus, shouldAutoSync, syncMutation]);

  // Computed values
  const status = syncData?.status;
  const logs = syncData?.logs || [];

  const lastSyncTime = (() => {
    const times = [
      status?.lastSync?.orders?.completedAt,
      status?.lastSync?.transactions?.completedAt,
      status?.lastSync?.payouts?.completedAt,
    ].filter(Boolean) as string[];

    if (times.length === 0) return undefined;
    return times.reduce((latest, time) => (time > latest ? time : latest));
  })();

  return {
    // Status
    isConnected: status?.isConnected ?? false,
    isRunning: status?.isRunning ?? false,
    runningSyncTypes: status?.runningSyncTypes ?? [],
    config: status?.config,
    lastSync: status?.lastSync,
    lastSyncTime,
    logs,

    // Loading states
    isLoadingStatus,
    isSyncing: syncMutation.isPending,
    isImporting: historicalImportMutation.isPending,
    isUpdatingConfig: updateConfigMutation.isPending,

    // Errors
    statusError,
    syncError: syncMutation.error,
    importError: historicalImportMutation.error,
    configError: updateConfigMutation.error,

    // Results
    syncResult: syncMutation.data,
    importResult: historicalImportMutation.data,

    // Actions
    triggerSync: (type?: 'orders' | 'transactions' | 'payouts' | 'all', fullSync = false) =>
      syncMutation.mutate({ type: type || 'all', fullSync }),
    triggerHistoricalImport: (fromDate: string) => historicalImportMutation.mutate({ fromDate }),
    updateConfig: (updates: Partial<EbaySyncConfig>) => updateConfigMutation.mutate(updates),
    refetchStatus,

    // Computed
    needsSync: shouldAutoSync(),
    hasCompletedHistoricalImport: status?.config?.historicalImportCompleted ?? false,
  };
}

export default useEbaySync;
