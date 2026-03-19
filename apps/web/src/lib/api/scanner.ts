/**
 * Scanner API Client
 *
 * Fetch functions for scanner session and piece API routes.
 */

import type {
  ScannerSession,
  ScannerSessionsResponse,
  ScannerSessionDetailResponse,
  ScannerPiece,
  ScannerSessionFilters,
  ScannerPieceFilters,
  PaginatedResponse,
  ReviewPieceInput,
  SetCheckSessionsResponse,
  SetCheckDetailResponse,
  InventoryLinkItem,
  LinkInventoryResponse,
} from '@/types/scanner';

// ============================================================================
// FETCH FUNCTIONS
// ============================================================================

/**
 * Fetch paginated list of scanner sessions.
 * Returns ScannerSessionsResponse — access sessions via `.sessions`.
 */
export async function fetchScannerSessions(
  filters?: ScannerSessionFilters,
  pagination?: { page?: number; pageSize?: number }
): Promise<ScannerSessionsResponse> {
  const params = new URLSearchParams();

  if (filters?.status) params.set('status', filters.status);
  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.search) params.set('search', filters.search);
  if (pagination?.page !== undefined) params.set('page', String(pagination.page));
  if (pagination?.pageSize !== undefined) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/scanner/sessions?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch scanner sessions (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as ScannerSessionsResponse;
}

/**
 * Fetch session metadata, pieces (filtered/paginated), and piece counts by status.
 * Returns ScannerSessionDetailResponse: { session, pieces, pieceTotal, pieceCounts }.
 */
export async function fetchScannerSessionDetail(
  sessionId: string,
  options?: { pieceStatus?: string; piecePage?: number; piecePageSize?: number }
): Promise<ScannerSessionDetailResponse> {
  const params = new URLSearchParams();
  if (options?.pieceStatus) params.set('pieceStatus', options.pieceStatus);
  if (options?.piecePage !== undefined) params.set('piecePage', String(options.piecePage));
  if (options?.piecePageSize !== undefined)
    params.set('piecePageSize', String(options.piecePageSize));

  const qs = params.toString();
  const response = await fetch(
    `/api/scanner/sessions/${sessionId}${qs ? `?${qs}` : ''}`
  );

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch scanner session (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as ScannerSessionDetailResponse;
}

/**
 * Fetch pieces for a scanner session with optional status filter and pagination.
 * Returns PaginatedResponse<ScannerPiece>: { data, total, page, pageSize, totalPages }.
 */
export async function fetchScannerPieces(
  sessionId: string,
  filters?: ScannerPieceFilters,
  pagination?: { page?: number; pageSize?: number }
): Promise<PaginatedResponse<ScannerPiece>> {
  const params = new URLSearchParams();

  if (filters?.status) params.set('status', filters.status);
  if (pagination?.page !== undefined) params.set('page', String(pagination.page));
  if (pagination?.pageSize !== undefined) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(
    `/api/scanner/sessions/${sessionId}/pieces?${params.toString()}`
  );

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch scanner pieces (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as PaginatedResponse<ScannerPiece>;
}

/**
 * Fetch the active scanner session (scanning, calibrating, or paused), or null.
 */
export async function fetchActiveSession(): Promise<ScannerSession | null> {
  const response = await fetch('/api/scanner/sessions/active');

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch active scanner session (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as ScannerSession | null;
}

/**
 * Fetch paginated list of set-check sessions.
 * Returns SetCheckSessionsResponse — access sessions via `.sessions`.
 */
export async function fetchSetCheckSessions(pagination?: {
  page?: number;
  pageSize?: number;
}): Promise<SetCheckSessionsResponse> {
  const params = new URLSearchParams();
  if (pagination?.page !== undefined) params.set('page', String(pagination.page));
  if (pagination?.pageSize !== undefined) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/scanner/set-check?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch set-check sessions (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as SetCheckSessionsResponse;
}

/**
 * Fetch a single set-check session with all progress rows.
 * Returns SetCheckDetailResponse: { session, progress }.
 */
export async function fetchSetCheckSession(sessionId: string): Promise<SetCheckDetailResponse> {
  const response = await fetch(`/api/scanner/set-check/${sessionId}`);

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to fetch set-check session (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as SetCheckDetailResponse;
}

/**
 * Bulk-link scanned pieces from a session to inventory.
 * Items with inventory_item_id are updated (quantity incremented); others are created.
 * Returns LinkInventoryResponse: { created, updated }.
 */
export async function linkSessionToInventory(
  sessionId: string,
  items: InventoryLinkItem[]
): Promise<LinkInventoryResponse> {
  const response = await fetch(`/api/scanner/sessions/${sessionId}/link-inventory`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to link inventory (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as LinkInventoryResponse;
}

/**
 * Link a single scanner piece to an existing inventory item.
 * Returns the updated ScannerPiece.
 */
export async function linkPieceToInventory(
  pieceId: string,
  inventoryItemId: string
): Promise<ScannerPiece> {
  const response = await fetch(`/api/scanner/pieces/${pieceId}/link`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventory_item_id: inventoryItemId }),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to link piece to inventory (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as ScannerPiece;
}

/**
 * Submit a piece review (mark as accepted or rejected with a BrickLink item ID).
 */
export async function reviewPiece(
  pieceId: string,
  input: ReviewPieceInput
): Promise<ScannerPiece> {
  const response = await fetch(`/api/scanner/pieces/${pieceId}/review`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!response.ok) {
    const text = await response.text();
    let msg = `Failed to review scanner piece (${response.status})`;
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      // ignore parse errors
    }
    throw new Error(msg);
  }

  const json = await response.json();
  return json.data as ScannerPiece;
}
