/**
 * Scanner React Hooks
 *
 * TanStack Query hooks for scanner sessions and piece review.
 *
 * Hook signatures match the pre-existing component API:
 *   useScannerSessions({ page, pageSize, status, ... })
 *     → data: ScannerSessionsResponse (access sessions via data.sessions)
 *
 *   useScannerSession(sessionId, { pieceStatus, piecePage, piecePageSize })
 *     → data: ScannerSessionDetailResponse (session, pieces, pieceTotal, pieceCounts)
 *
 *   useScannerPieces(sessionId, filters?, pagination?)
 *     → data: PaginatedResponse<ScannerPiece>
 *
 *   useActiveSession()  — polls every 10s
 *   useReviewPiece()    — mutation
 */

'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchScannerSessions,
  fetchScannerSessionDetail,
  fetchScannerPieces,
  fetchActiveSession,
  reviewPiece,
  fetchSetCheckSessions,
  fetchSetCheckSession,
  linkSessionToInventory,
  linkPieceToInventory,
} from '@/lib/api/scanner';
import type {
  ScannerSessionsOptions,
  ScannerSessionDetailOptions,
  ScannerPieceFilters,
  ReviewPieceInput,
  InventoryLinkItem,
} from '@/types/scanner';

// ============================================================================
// QUERY KEY FACTORY
// ============================================================================

export const scannerKeys = {
  all: ['scanner'] as const,
  sessions: () => [...scannerKeys.all, 'sessions'] as const,
  sessionList: (options?: ScannerSessionsOptions) =>
    [...scannerKeys.sessions(), 'list', options] as const,
  session: (sessionId: string) => [...scannerKeys.sessions(), sessionId] as const,
  sessionDetail: (sessionId: string, options?: ScannerSessionDetailOptions) =>
    [...scannerKeys.session(sessionId), 'detail', options] as const,
  pieces: (sessionId: string) => [...scannerKeys.session(sessionId), 'pieces'] as const,
  pieceList: (
    sessionId: string,
    filters?: ScannerPieceFilters,
    page?: number,
    pageSize?: number
  ) => [...scannerKeys.pieces(sessionId), filters, page, pageSize] as const,
  active: () => [...scannerKeys.all, 'active'] as const,
  setCheck: () => [...scannerKeys.all, 'set-check'] as const,
  setCheckList: (page?: number, pageSize?: number) =>
    [...scannerKeys.setCheck(), 'list', page, pageSize] as const,
  setCheckSession: (sessionId: string) => [...scannerKeys.setCheck(), sessionId] as const,
};

// ============================================================================
// QUERY HOOKS
// ============================================================================

/**
 * Fetch a paginated list of scanner sessions.
 * Accepts a flat options object including pagination (page, pageSize) and filters (status, etc.).
 * Returns ScannerSessionsResponse — access sessions via data.sessions.
 */
export function useScannerSessions(options?: ScannerSessionsOptions) {
  const { page, pageSize, status, dateFrom, dateTo, search } = options ?? {};

  return useQuery({
    queryKey: scannerKeys.sessionList(options),
    queryFn: () =>
      fetchScannerSessions(
        { status, dateFrom, dateTo, search },
        { page, pageSize }
      ),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Fetch session metadata, pieces (filtered/paginated), and piece counts.
 * Accepts optional piece filtering/pagination options as a second argument.
 * Returns ScannerSessionDetailResponse: { session, pieces, pieceTotal, pieceCounts }.
 */
export function useScannerSession(
  sessionId: string | null,
  options?: ScannerSessionDetailOptions
) {
  return useQuery({
    queryKey: scannerKeys.sessionDetail(sessionId ?? '', options),
    queryFn: () =>
      fetchScannerSessionDetail(sessionId!, {
        pieceStatus: options?.pieceStatus,
        piecePage: options?.piecePage,
        piecePageSize: options?.piecePageSize,
      }),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch pieces for a session with optional status filter and pagination.
 * Returns PaginatedResponse<ScannerPiece>: { data, total, page, pageSize, totalPages }.
 */
export function useScannerPieces(
  sessionId: string | null,
  filters?: ScannerPieceFilters,
  pagination?: { page?: number; pageSize?: number }
) {
  return useQuery({
    queryKey: scannerKeys.pieceList(
      sessionId ?? '',
      filters,
      pagination?.page,
      pagination?.pageSize
    ),
    queryFn: () => fetchScannerPieces(sessionId!, filters, pagination),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch the currently active scanner session (scanning, calibrating, or paused).
 * Polls every 10 seconds to reflect live status changes.
 */
export function useActiveSession() {
  return useQuery({
    queryKey: scannerKeys.active(),
    queryFn: fetchActiveSession,
    staleTime: 10 * 1000,
    refetchInterval: 10 * 1000,
  });
}

// ============================================================================
// SET-CHECK HOOKS
// ============================================================================

/**
 * Fetch a paginated list of set-check sessions.
 * Returns SetCheckSessionsResponse — access sessions via data.sessions.
 */
export function useSetCheckSessions(options?: { page?: number; pageSize?: number }) {
  const { page, pageSize } = options ?? {};

  return useQuery({
    queryKey: scannerKeys.setCheckList(page, pageSize),
    queryFn: () => fetchSetCheckSessions({ page, pageSize }),
    staleTime: 30 * 1000,
  });
}

/**
 * Fetch a single set-check session with all progress rows.
 * Returns SetCheckDetailResponse: { session, progress }.
 */
export function useSetCheckSession(sessionId: string | null) {
  return useQuery({
    queryKey: scannerKeys.setCheckSession(sessionId ?? ''),
    queryFn: () => fetchSetCheckSession(sessionId!),
    enabled: !!sessionId,
    staleTime: 30 * 1000,
  });
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

/**
 * Review a scanner piece — mark as accepted or rejected with a BrickLink item ID.
 * On success, invalidates the session detail and piece list for that session.
 */
export function useReviewPiece() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pieceId, input }: { pieceId: string; input: ReviewPieceInput }) =>
      reviewPiece(pieceId, input),
    onSuccess: (updatedPiece) => {
      // Invalidate session detail (pieceCounts change) and all piece lists for the session
      queryClient.invalidateQueries({
        queryKey: scannerKeys.session(updatedPiece.session_id),
      });
    },
  });
}

/**
 * Bulk-link scanned pieces from a session to inventory.
 * Returns { created, updated } counts.
 */
export function useLinkToInventory() {
  return useMutation({
    mutationFn: ({
      sessionId,
      items,
    }: {
      sessionId: string;
      items: InventoryLinkItem[];
    }) => linkSessionToInventory(sessionId, items),
  });
}

/**
 * Link a single scanner piece to an inventory item.
 * On success, invalidates the session containing the piece.
 */
export function useLinkPiece() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      pieceId,
      inventoryItemId,
    }: {
      pieceId: string;
      inventoryItemId: string;
    }) => linkPieceToInventory(pieceId, inventoryItemId),
    onSuccess: (updatedPiece) => {
      if (updatedPiece?.session_id) {
        queryClient.invalidateQueries({
          queryKey: scannerKeys.session(updatedPiece.session_id),
        });
      }
    },
  });
}
