/**
 * Amazon Transaction Sync Hook
 *
 * Provides sync status, manual sync triggers, and historical import functionality.
 * Use in dashboard layout or Amazon transactions tab.
 */

import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AmazonSyncConfigRow, AmazonSyncLogRow } from '@/lib/amazon/types';

// ============================================================================
// Types
// ============================================================================

interface AmazonSyncStatus {
  isConnected: boolean;
  isRunning: boolean;
  lastSync?: {
    status: string;
    completedAt?: Date;
    recordsProcessed?: number;
  };
  config?: AmazonSyncConfigRow;
  logs: AmazonSyncLogRow[];
  transactionCount: number;
}

interface SyncResult {
  success: boolean;
  result: {
    success: boolean;
    syncType: string;
    recordsProcessed: number;
    recordsCreated: number;
    recordsUpdated: number;
    lastSyncCursor?: string;
    error?: string;
    startedAt: string;
    completedAt: string;
  };
}

interface HistoricalImportResult {
  success: boolean;
  result: {
    success: boolean;
    syncType: string;
    recordsProcessed: number;
    recordsCreated: number;
    recordsUpdated: number;
    error?: string;
    startedAt: string;
    completedAt: string;
  };
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for Amazon transaction sync status and operations
 *
 * @param options.enabled - Whether to fetch status (default: true)
 * @returns Object with sync status, actions, and loading states
 */
export function useAmazonTransactionSync(
  options: { enabled?: boolean } = {}
) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();

  // Fetch sync status
  const {
    data: syncData,
    isLoading: isLoadingStatus,
    error: statusError,
    refetch: refetchStatus,
  } = useQuery<AmazonSyncStatus>({
    queryKey: ['amazon', 'transactions', 'sync', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/amazon/transactions/sync');
      if (!response.ok) {
        throw new Error('Failed to fetch Amazon sync status');
      }
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: (data) => {
      // Poll more frequently when sync is running
      if (data?.state?.data?.isRunning) {
        return 5 * 1000; // 5 seconds
      }
      return 60 * 1000; // 1 minute
    },
    enabled,
  });

  // Manual sync mutation
  const syncMutation = useMutation<SyncResult, Error, { fullSync?: boolean }>({
    mutationFn: async ({ fullSync = false }) => {
      const response = await fetch('/api/integrations/amazon/transactions/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullSync }),
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'transactions'] });
    },
  });

  // Historical import mutation
  const historicalImportMutation = useMutation<
    HistoricalImportResult,
    Error,
    { fromDate: string }
  >({
    mutationFn: async ({ fromDate }) => {
      const response = await fetch(
        '/api/integrations/amazon/transactions/sync/historical',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fromDate }),
        }
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Historical import failed');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['amazon', 'transactions'] });
    },
  });

  // Check if sync is needed (no cursor or never synced)
  const needsSync = useCallback((): boolean => {
    if (!syncData?.isConnected) return false;
    if (syncData?.isRunning) return false;
    if (!syncData?.config?.transactions_posted_cursor) return true;
    return false;
  }, [syncData]);

  // Computed values
  const lastSyncTime = syncData?.lastSync?.completedAt
    ? new Date(syncData.lastSync.completedAt).toISOString()
    : undefined;

  const hasCompletedHistoricalImport =
    !!syncData?.config?.historical_import_completed_at;

  return {
    // Status
    isConnected: syncData?.isConnected ?? false,
    isRunning: syncData?.isRunning ?? false,
    config: syncData?.config,
    lastSync: syncData?.lastSync,
    lastSyncTime,
    logs: syncData?.logs ?? [],
    transactionCount: syncData?.transactionCount ?? 0,

    // Loading states
    isLoadingStatus,
    isSyncing: syncMutation.isPending,
    isImporting: historicalImportMutation.isPending,

    // Errors
    statusError,
    syncError: syncMutation.error,
    importError: historicalImportMutation.error,

    // Results
    syncResult: syncMutation.data,
    importResult: historicalImportMutation.data,

    // Actions
    triggerSync: (fullSync = false) => syncMutation.mutate({ fullSync }),
    triggerHistoricalImport: (fromDate: string) =>
      historicalImportMutation.mutate({ fromDate }),
    refetchStatus,

    // Computed
    needsSync: needsSync(),
    hasCompletedHistoricalImport,
  };
}

export default useAmazonTransactionSync;
