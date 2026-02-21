/**
 * useAmazonTransactionSync Hook Tests
 *
 * Tests for the Amazon transaction sync React hook.
 *
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAmazonTransactionSync } from '../use-amazon-transaction-sync';

// ============================================================================
// Fixtures (inlined to avoid path resolution issues)
// ============================================================================

const mockAmazonSyncConfig = {
  id: 'config-001',
  user_id: 'user-123',
  auto_sync_enabled: false,
  auto_sync_interval_hours: 24,
  last_auto_sync_at: null,
  next_auto_sync_at: null,
  transactions_posted_cursor: '2025-01-01T00:00:00.000Z',
  settlements_cursor: null,
  historical_import_started_at: null,
  historical_import_completed_at: null,
  historical_import_from_date: null,
  created_at: '2025-01-01T00:00:00.000Z',
  updated_at: '2025-01-05T10:30:00.000Z',
};

const mockAmazonSyncLog = {
  id: 'log-001',
  user_id: 'user-123',
  sync_type: 'TRANSACTIONS',
  sync_mode: 'INCREMENTAL',
  status: 'COMPLETED',
  started_at: '2025-01-05T10:00:00.000Z',
  completed_at: '2025-01-05T10:05:00.000Z',
  records_processed: 5,
  records_created: 3,
  records_updated: 2,
  last_sync_cursor: '2025-01-05T10:30:00.000Z',
  from_date: null,
  to_date: null,
  error_message: null,
  created_at: '2025-01-05T10:00:00.000Z',
};

// ============================================================================
// Mocks
// ============================================================================

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ============================================================================
// Test Utilities
// ============================================================================

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createSyncStatusResponse(overrides = {}) {
  return {
    isConnected: true,
    isRunning: false,
    lastSync: {
      status: 'COMPLETED',
      completedAt: '2025-01-05T10:05:00.000Z',
      recordsProcessed: 5,
    },
    config: mockAmazonSyncConfig,
    logs: [mockAmazonSyncLog],
    transactionCount: 10,
    ...overrides,
  };
}

function createSyncSuccessResponse() {
  return {
    success: true,
    result: {
      success: true,
      syncType: 'INCREMENTAL',
      recordsProcessed: 5,
      recordsCreated: 3,
      recordsUpdated: 2,
      lastSyncCursor: '2025-01-05T10:30:00.000Z',
      startedAt: '2025-01-05T10:00:00.000Z',
      completedAt: '2025-01-05T10:05:00.000Z',
    },
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('useAmazonTransactionSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // ============================================================================
  // Status Query Tests
  // ============================================================================

  describe('sync status query', () => {
    it('should fetch sync status on mount when enabled', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse()),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoadingStatus).toBe(false);
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/integrations/amazon/transactions/sync');
      expect(result.current.isConnected).toBe(true);
    });

    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: false }), {
        wrapper: createWrapper(),
      });

      // Give time for any potential fetch
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.current.isConnected).toBe(false);
    });

    it('should return not connected when API returns not connected', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse({ isConnected: false })),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoadingStatus).toBe(false);
      });

      expect(result.current.isConnected).toBe(false);
    });

    it('should return running status when sync is in progress', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse({ isRunning: true })),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isRunning).toBe(true);
      });
    });

    it('should handle status fetch error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.statusError).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // Sync Trigger Tests
  // ============================================================================

  describe('triggerSync', () => {
    it('should set syncError on sync failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse()),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoadingStatus).toBe(false);
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Sync failed' }),
      });

      await act(async () => {
        result.current.triggerSync();
      });

      await waitFor(() => {
        expect(result.current.syncError).toBeTruthy();
      });
    });

    it('should provide sync result on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse()),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoadingStatus).toBe(false);
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncSuccessResponse()),
      });

      await act(async () => {
        result.current.triggerSync();
      });

      await waitFor(() => {
        expect(result.current.syncResult).toBeDefined();
        expect(result.current.syncResult?.success).toBe(true);
      });
    });
  });

  // ============================================================================
  // Computed Values Tests
  // ============================================================================

  describe('computed values', () => {
    it('should compute needsSync when no cursor exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            createSyncStatusResponse({
              config: { ...mockAmazonSyncConfig, transactions_posted_cursor: null },
            })
          ),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.needsSync).toBe(true);
      });
    });

    it('should compute needsSync false when cursor exists', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse()),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.needsSync).toBe(false);
      });
    });

    it('should compute hasCompletedHistoricalImport', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            createSyncStatusResponse({
              config: {
                ...mockAmazonSyncConfig,
                historical_import_completed_at: '2025-01-01T00:00:00.000Z',
              },
            })
          ),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.hasCompletedHistoricalImport).toBe(true);
      });
    });

    it('should format lastSyncTime as ISO string', async () => {
      const completedAt = '2025-01-05T10:05:00.000Z';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve(
            createSyncStatusResponse({
              lastSync: { completedAt, status: 'COMPLETED' },
            })
          ),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.lastSyncTime).toBe(new Date(completedAt).toISOString());
      });
    });
  });

  // ============================================================================
  // Refetch Tests
  // ============================================================================

  describe('refetchStatus', () => {
    it('should provide refetchStatus function', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createSyncStatusResponse()),
      });

      const { result } = renderHook(() => useAmazonTransactionSync({ enabled: true }), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(result.current.isLoadingStatus).toBe(false);
      });

      expect(typeof result.current.refetchStatus).toBe('function');

      await act(async () => {
        await result.current.refetchStatus();
      });

      // Should have fetched twice (initial + refetch)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
