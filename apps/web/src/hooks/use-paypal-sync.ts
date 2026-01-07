/**
 * PayPal Sync Hook
 *
 * Provides sync status, manual sync triggers, and historical import functionality.
 * Use in dashboard layout or PayPal transactions page.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { PayPalConnectionStatus } from '@/lib/paypal/types';

// ============================================================================
// Types
// ============================================================================

interface SyncLog {
  id: string;
  sync_mode: string;
  status: string;
  started_at: string;
  completed_at?: string;
  transactions_processed?: number;
  transactions_created?: number;
  transactions_updated?: number;
  transactions_skipped?: number;
  error_message?: string;
}

interface SyncStatusResponse {
  status: {
    isRunning: boolean;
    lastSync?: {
      status: string;
      completedAt?: string;
      transactionsProcessed?: number;
      transactionsCreated?: number;
      transactionsUpdated?: number;
      transactionsSkipped?: number;
    };
    config?: {
      autoSyncEnabled: boolean;
      nextSyncAt?: string;
      historicalImportCompleted: boolean;
      lastSyncDateCursor?: string;
    };
  };
  logs: SyncLog[];
}

interface ManualSyncResult {
  success: boolean;
  syncMode: string;
  transactionsProcessed: number;
  transactionsCreated: number;
  transactionsUpdated: number;
  transactionsSkipped: number;
  lastSyncCursor?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for PayPal sync status and operations
 *
 * @param options.enabled - Whether to fetch status (default: true)
 * @param options.autoSync - Whether to trigger auto-sync when due (default: false)
 * @returns Object with sync status, actions, and loading states
 */
export function usePayPalSync(options: { enabled?: boolean; autoSync?: boolean } = {}) {
  const { enabled = true, autoSync = false } = options;
  const queryClient = useQueryClient();
  const hasAttemptedAutoSync = useRef(false);

  // Fetch connection status
  const {
    data: connectionStatus,
    isLoading: isLoadingConnection,
    error: connectionError,
    refetch: refetchConnection,
  } = useQuery<PayPalConnectionStatus>({
    queryKey: ['paypal', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/paypal/status');
      if (!response.ok) {
        throw new Error('Failed to fetch PayPal connection status');
      }
      return response.json();
    },
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // 1 minute
    enabled,
  });

  // Fetch sync status
  const {
    data: syncData,
    isLoading: isLoadingSync,
    error: syncStatusError,
    refetch: refetchSyncStatus,
  } = useQuery<SyncStatusResponse>({
    queryKey: ['paypal', 'sync', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/paypal/sync');
      if (!response.ok) {
        throw new Error('Failed to fetch PayPal sync status');
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
    enabled: enabled && connectionStatus?.isConnected,
  });

  // Manual sync mutation
  const syncMutation = useMutation<ManualSyncResult, Error, { fullSync?: boolean }>({
    mutationFn: async ({ fullSync = false }) => {
      const response = await fetch('/api/integrations/paypal/sync', {
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
      queryClient.invalidateQueries({ queryKey: ['paypal', 'sync'] });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'status'] });
    },
  });

  // Historical import mutation
  const historicalImportMutation = useMutation<ManualSyncResult, Error, { fromDate: string }>({
    mutationFn: async ({ fromDate }) => {
      const response = await fetch('/api/integrations/paypal/sync/historical', {
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
      queryClient.invalidateQueries({ queryKey: ['paypal', 'sync'] });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'transactions'] });
      queryClient.invalidateQueries({ queryKey: ['paypal', 'status'] });
    },
  });

  // Check if auto-sync should run
  const shouldAutoSync = useCallback((): boolean => {
    if (!connectionStatus?.isConnected) return false;
    if (syncData?.status?.isRunning) return false;

    const config = syncData?.status?.config;
    if (!config?.autoSyncEnabled) return false;

    const nextSyncAt = config.nextSyncAt;
    if (!nextSyncAt) return true; // Never synced

    return new Date() >= new Date(nextSyncAt);
  }, [connectionStatus, syncData]);

  // Auto-sync effect
  useEffect(() => {
    if (!autoSync || hasAttemptedAutoSync.current || isLoadingSync) {
      return;
    }

    if (shouldAutoSync()) {
      hasAttemptedAutoSync.current = true;
      syncMutation.mutate({ fullSync: false });
    }
  }, [autoSync, isLoadingSync, shouldAutoSync, syncMutation]);

  // Computed values
  const status = syncData?.status;
  const logs = syncData?.logs || [];

  const lastSyncTime = status?.lastSync?.completedAt;

  // Refetch all
  const refetchStatus = useCallback(() => {
    refetchConnection();
    refetchSyncStatus();
  }, [refetchConnection, refetchSyncStatus]);

  return {
    // Status
    isConnected: connectionStatus?.isConnected ?? false,
    sandbox: connectionStatus?.sandbox,
    isRunning: status?.isRunning ?? false,
    config: status?.config,
    lastSync: status?.lastSync,
    lastSyncTime,
    transactionCount: connectionStatus?.transactionCount ?? 0,
    logs,

    // Loading states
    isLoadingStatus: isLoadingConnection || isLoadingSync,
    isSyncing: syncMutation.isPending,
    isImporting: historicalImportMutation.isPending,

    // Errors
    statusError: connectionError || syncStatusError,
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
    hasCompletedHistoricalImport: status?.config?.historicalImportCompleted ?? false,
  };
}

export default usePayPalSync;
