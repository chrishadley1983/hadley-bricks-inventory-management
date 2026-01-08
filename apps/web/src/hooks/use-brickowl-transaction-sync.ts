/**
 * BrickOwl Transaction Sync Hook
 *
 * Provides sync status, manual sync triggers, and historical import functionality.
 * Use in dashboard layout or BrickOwl transactions page.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BrickOwlConnectionStatus, BrickOwlSyncResult } from '@/lib/brickowl';

// ============================================================================
// Types
// ============================================================================

interface SyncLog {
  id: string;
  syncMode: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  ordersProcessed?: number;
  ordersCreated?: number;
  ordersUpdated?: number;
  error?: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for BrickOwl transaction sync status and operations
 *
 * @param options.enabled - Whether to fetch status (default: true)
 * @param options.autoSync - Whether to trigger auto-sync when due (default: false)
 * @returns Object with sync status, actions, and loading states
 */
export function useBrickOwlTransactionSync(options: { enabled?: boolean; autoSync?: boolean } = {}) {
  const { enabled = true, autoSync = false } = options;
  const queryClient = useQueryClient();
  const hasAttemptedAutoSync = useRef(false);

  // Fetch connection status
  const {
    data: connectionStatus,
    isLoading: isLoadingConnection,
    error: connectionError,
    refetch: refetchConnection,
  } = useQuery<BrickOwlConnectionStatus>({
    queryKey: ['brickowl', 'transactions', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/brickowl/status');
      if (!response.ok) {
        throw new Error('Failed to fetch BrickOwl connection status');
      }
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // 1 minute
    enabled,
  });

  // Manual sync mutation
  const syncMutation = useMutation<BrickOwlSyncResult, Error, { fullSync?: boolean }>({
    mutationFn: async ({ fullSync = false }) => {
      const response = await fetch('/api/integrations/brickowl/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullSync }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }
      const data = await response.json();
      // Extract transaction sync result from combined response
      return {
        success: data.success,
        syncMode: fullSync ? 'FULL' : 'INCREMENTAL',
        ordersProcessed: data.data?.transactions?.processed ?? 0,
        ordersCreated: data.data?.transactions?.created ?? 0,
        ordersUpdated: data.data?.transactions?.updated ?? 0,
        ordersSkipped: 0,
        error: data.data?.transactions?.error,
        startedAt: new Date(),
        completedAt: new Date(),
      } as BrickOwlSyncResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'sync'] });
    },
  });

  // Historical import mutation
  const historicalImportMutation = useMutation<BrickOwlSyncResult, Error, { fromDate: string }>({
    mutationFn: async ({ fromDate }) => {
      const response = await fetch('/api/integrations/brickowl/sync/historical', {
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
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['brickowl', 'sync'] });
    },
  });

  // Check if auto-sync should run
  const shouldAutoSync = useCallback((): boolean => {
    if (!connectionStatus?.isConnected) return false;

    const config = connectionStatus?.syncConfig;
    if (!config?.autoSyncEnabled) return false;

    const nextSyncAt = config.nextAutoSyncAt;
    if (!nextSyncAt) return true; // Never synced

    return new Date() >= new Date(nextSyncAt);
  }, [connectionStatus]);

  // Auto-sync effect
  useEffect(() => {
    if (!autoSync || hasAttemptedAutoSync.current || isLoadingConnection) {
      return;
    }

    if (shouldAutoSync()) {
      hasAttemptedAutoSync.current = true;
      syncMutation.mutate({ fullSync: false });
    }
  }, [autoSync, isLoadingConnection, shouldAutoSync, syncMutation]);

  // Get logs from connection status
  const logs: SyncLog[] = connectionStatus?.recentLogs?.map((log) => ({
    id: log.id,
    syncMode: log.syncMode,
    status: log.status,
    startedAt: log.startedAt,
    completedAt: log.completedAt,
    ordersProcessed: log.ordersProcessed,
    ordersCreated: log.ordersCreated,
    ordersUpdated: log.ordersUpdated,
    error: log.error,
  })) ?? [];

  // Computed values
  const lastSyncTime = connectionStatus?.lastSyncAt;
  const isRunning = logs.some((log) => log.status === 'RUNNING');

  // Refetch all
  const refetchStatus = useCallback(() => {
    refetchConnection();
  }, [refetchConnection]);

  return {
    // Status
    isConnected: connectionStatus?.isConnected ?? false,
    isRunning,
    config: connectionStatus?.syncConfig,
    lastSyncTime,
    transactionCount: connectionStatus?.transactionCount ?? 0,
    logs,

    // Loading states
    isLoadingStatus: isLoadingConnection,
    isSyncing: syncMutation.isPending,
    isImporting: historicalImportMutation.isPending,

    // Errors
    statusError: connectionError,
    syncError: syncMutation.error,
    importError: historicalImportMutation.error,

    // Results
    syncResult: syncMutation.data,
    importResult: historicalImportMutation.data,

    // Actions
    triggerSync: (fullSync = false) => syncMutation.mutate({ fullSync }),
    triggerHistoricalImport: (fromDate: string) => historicalImportMutation.mutate({ fromDate }),
    refetchStatus,

    // Computed
    needsSync: shouldAutoSync(),
    hasCompletedHistoricalImport: connectionStatus?.syncConfig?.historicalImportCompleted ?? false,
  };
}

export default useBrickOwlTransactionSync;
