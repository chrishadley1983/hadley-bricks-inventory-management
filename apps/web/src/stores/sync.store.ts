/**
 * Sync Status Store
 *
 * Zustand store for managing sync status between Google Sheets and Supabase.
 */

import { create } from 'zustand';

export interface TableSyncStatus {
  lastSync: Date | null;
  status: 'synced' | 'syncing' | 'stale' | 'error';
  errorMessage?: string;
  recordCount: number;
}

export interface SyncState {
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

const defaultTableStatus: TableSyncStatus = {
  lastSync: null,
  status: 'stale',
  recordCount: 0,
};

export const useSyncStore = create<SyncState>((set) => ({
  tables: {
    inventory: { ...defaultTableStatus },
    purchases: { ...defaultTableStatus },
  },
  isSyncing: false,
  lastError: null,

  setTableStatus: (tableName, status) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [tableName]: status,
      },
    })),

  setTableSyncing: (tableName) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [tableName]: {
          ...state.tables[tableName],
          status: 'syncing',
        },
      },
    })),

  setTableSynced: (tableName, recordCount) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [tableName]: {
          lastSync: new Date(),
          status: 'synced',
          recordCount,
        },
      },
    })),

  setTableError: (tableName, error) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [tableName]: {
          ...state.tables[tableName],
          status: 'error',
          errorMessage: error,
        },
      },
    })),

  setTableStale: (tableName) =>
    set((state) => ({
      tables: {
        ...state.tables,
        [tableName]: {
          ...state.tables[tableName],
          status: 'stale',
        },
      },
    })),

  setGlobalSyncing: (isSyncing) => set({ isSyncing }),

  setGlobalError: (error) => set({ lastError: error }),

  resetAll: () =>
    set({
      tables: {
        inventory: { ...defaultTableStatus },
        purchases: { ...defaultTableStatus },
      },
      isSyncing: false,
      lastError: null,
    }),
}));
