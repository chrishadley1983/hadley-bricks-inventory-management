'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useSyncAll, useGlobalSyncStatus } from '@/hooks';

/** Sync context value */
interface SyncContextValue {
  /** Whether any sync is in progress */
  isSyncing: boolean;
  /** Last error from sync operations */
  lastError: string | null;
  /** Overall sync status */
  status: 'synced' | 'syncing' | 'stale' | 'error';
  /** Last successful sync time */
  lastSync: Date | null;
  /** Trigger a full sync of all tables */
  syncAll: () => void;
  /** Whether initial sync has completed */
  initialSyncComplete: boolean;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/** Hook to access sync context */
export function useSyncContext() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSyncContext must be used within SyncStatusProvider');
  }
  return context;
}

interface SyncStatusProviderProps {
  children: React.ReactNode;
  /** TTL in milliseconds before auto-syncing (default: 5 minutes) */
  staleTtlMs?: number;
  /** Whether to auto-sync on mount if data is stale (default: true) */
  autoSyncOnMount?: boolean;
}

/**
 * Provider that manages sync state and triggers auto-sync when data is stale
 */
export function SyncStatusProvider({
  children,
  staleTtlMs = 5 * 60 * 1000,
  autoSyncOnMount = true,
}: SyncStatusProviderProps) {
  const { syncAll, isSyncing, lastError } = useSyncAll();
  const { status, lastSync } = useGlobalSyncStatus();
  const [initialSyncComplete, setInitialSyncComplete] = useState(false);

  // Auto-sync on mount if data is stale
  useEffect(() => {
    if (!autoSyncOnMount) {
      setInitialSyncComplete(true);
      return;
    }

    // Check if data is stale
    const isStale = !lastSync || new Date().getTime() - lastSync.getTime() > staleTtlMs;

    if (isStale && !isSyncing) {
      syncAll();
    }

    // Mark initial sync as complete after first sync attempt
    if (!isSyncing && status !== 'syncing') {
      setInitialSyncComplete(true);
    }
  }, [autoSyncOnMount, staleTtlMs, lastSync, isSyncing, syncAll, status]);

  // Mark initial sync complete when sync finishes
  useEffect(() => {
    if (!isSyncing && status !== 'syncing') {
      setInitialSyncComplete(true);
    }
  }, [isSyncing, status]);

  const value: SyncContextValue = {
    isSyncing,
    lastError,
    status,
    lastSync,
    syncAll,
    initialSyncComplete,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
