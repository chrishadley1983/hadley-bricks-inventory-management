/**
 * Monzo Auto-Sync Hook
 *
 * Triggers automatic incremental sync when:
 * 1. User has Monzo connected
 * 2. Last sync was more than 1 hour ago
 *
 * Call in dashboard layout or transactions page.
 */

import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface MonzoStatus {
  connected: boolean;
  accountId?: string;
  lastSync?: string;
  transactionCount?: number;
}

interface SyncResponse {
  success: boolean;
  syncedCount?: number;
  error?: string;
}

const SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if enough time has passed since last sync
 */
function shouldAutoSync(lastSync: string | undefined): boolean {
  if (!lastSync) {
    return true; // Never synced, should sync
  }

  const lastSyncTime = new Date(lastSync).getTime();
  const now = Date.now();

  return now - lastSyncTime > SYNC_INTERVAL_MS;
}

/**
 * Hook for automatic Monzo sync on startup
 *
 * @param enabled - Whether auto-sync is enabled (default: true)
 * @returns Object with sync status and manual sync trigger
 */
export function useMonzoAutoSync(enabled: boolean = true) {
  const queryClient = useQueryClient();
  const hasAttemptedSync = useRef(false);

  // Fetch Monzo connection status
  const {
    data: status,
    isLoading: isLoadingStatus,
    error: statusError,
  } = useQuery<MonzoStatus>({
    queryKey: ['monzo', 'status'],
    queryFn: async () => {
      const response = await fetch('/api/integrations/monzo/status');
      if (!response.ok) {
        throw new Error('Failed to fetch Monzo status');
      }
      const data = await response.json();
      return data.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled,
  });

  // Sync mutation
  const syncMutation = useMutation<SyncResponse, Error>({
    mutationFn: async () => {
      const response = await fetch('/api/integrations/monzo/sync', {
        method: 'POST',
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate relevant queries after sync
      queryClient.invalidateQueries({ queryKey: ['monzo', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
    },
  });

  // Auto-sync effect
  useEffect(() => {
    // Skip if disabled, already attempted, loading, or not connected
    if (!enabled || hasAttemptedSync.current || isLoadingStatus) {
      return;
    }

    if (!status?.connected) {
      return;
    }

    // Check if we should sync
    if (shouldAutoSync(status.lastSync)) {
      hasAttemptedSync.current = true;
      syncMutation.mutate();
    }
  }, [enabled, status, isLoadingStatus, syncMutation]);

  return {
    // Status
    isConnected: status?.connected ?? false,
    lastSync: status?.lastSync,
    transactionCount: status?.transactionCount ?? 0,

    // Loading states
    isLoadingStatus,
    isSyncing: syncMutation.isPending,

    // Errors
    statusError,
    syncError: syncMutation.error,

    // Actions
    triggerSync: () => syncMutation.mutate(),

    // Computed
    needsSync: status?.connected && shouldAutoSync(status.lastSync),
  };
}

export default useMonzoAutoSync;
