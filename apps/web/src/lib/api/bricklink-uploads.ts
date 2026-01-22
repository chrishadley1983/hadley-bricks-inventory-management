import type { PaginationParams, PaginatedResponse } from './inventory';
import type {
  BrickLinkUpload,
  BrickLinkUploadInsert,
  BrickLinkUploadUpdate,
} from '@/lib/services/bricklink-upload.service';

export type { BrickLinkUpload, BrickLinkUploadInsert, BrickLinkUploadUpdate };

export interface BrickLinkUploadFilters {
  dateFrom?: string;
  dateTo?: string;
  source?: string;
  search?: string;
  syncedFromBricqer?: boolean;
  purchaseId?: string;
  unlinked?: boolean;
}

/**
 * Fetch uploads with optional filters and pagination
 */
export async function fetchBrickLinkUploads(
  filters?: BrickLinkUploadFilters,
  pagination?: PaginationParams
): Promise<PaginatedResponse<BrickLinkUpload>> {
  const params = new URLSearchParams();

  if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) params.set('dateTo', filters.dateTo);
  if (filters?.source) params.set('source', filters.source);
  if (filters?.search) params.set('search', filters.search);
  if (filters?.syncedFromBricqer !== undefined)
    params.set('syncedFromBricqer', String(filters.syncedFromBricqer));
  if (filters?.purchaseId) params.set('purchaseId', filters.purchaseId);
  if (filters?.unlinked !== undefined)
    params.set('unlinked', String(filters.unlinked));
  if (pagination?.page) params.set('page', String(pagination.page));
  if (pagination?.pageSize) params.set('pageSize', String(pagination.pageSize));

  const response = await fetch(`/api/bricklink-uploads?${params.toString()}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch uploads');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Fetch a single upload by ID
 */
export async function fetchBrickLinkUpload(id: string): Promise<BrickLinkUpload> {
  const response = await fetch(`/api/bricklink-uploads/${id}`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch upload');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Create a new upload
 */
export async function createBrickLinkUpload(
  data: BrickLinkUploadInsert
): Promise<BrickLinkUpload> {
  const response = await fetch('/api/bricklink-uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create upload');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Update an upload
 */
export async function updateBrickLinkUpload(
  id: string,
  data: BrickLinkUploadUpdate
): Promise<BrickLinkUpload> {
  const response = await fetch(`/api/bricklink-uploads/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update upload');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Delete an upload
 */
export async function deleteBrickLinkUpload(id: string): Promise<void> {
  const response = await fetch(`/api/bricklink-uploads/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete upload');
  }
}

/**
 * Sync status types
 */
export interface BatchConnectionStatus {
  isConnected: boolean;
  uploadCount?: number;
  lastSyncAt?: string;
  syncConfig?: {
    autoSyncEnabled: boolean;
    autoSyncIntervalHours: number;
    nextAutoSyncAt?: string;
    syncActivatedOnly: boolean;
  };
  recentLogs?: Array<{
    id: string;
    syncMode: 'FULL' | 'INCREMENTAL';
    status: 'RUNNING' | 'COMPLETED' | 'FAILED';
    startedAt: string;
    completedAt?: string;
    batchesProcessed?: number;
    batchesCreated?: number;
    batchesUpdated?: number;
    error?: string;
  }>;
}

export interface BatchSyncResult {
  success: boolean;
  syncMode: 'FULL' | 'INCREMENTAL';
  batchesProcessed: number;
  batchesCreated: number;
  batchesUpdated: number;
  batchesSkipped: number;
  error?: string;
  startedAt: string;
  completedAt: string;
}

export interface BatchSyncOptions {
  fullSync?: boolean;
  activatedOnly?: boolean;
}

/**
 * Get batch sync status
 */
export async function getBatchSyncStatus(): Promise<BatchConnectionStatus> {
  const response = await fetch('/api/integrations/bricqer/batches/sync');

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get sync status');
  }

  const result = await response.json();
  return result.data;
}

/**
 * Trigger batch sync from Bricqer
 */
export async function triggerBatchSync(options?: BatchSyncOptions): Promise<BatchSyncResult> {
  const response = await fetch('/api/integrations/bricqer/batches/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to trigger sync');
  }

  const result = await response.json();
  return result.data;
}
