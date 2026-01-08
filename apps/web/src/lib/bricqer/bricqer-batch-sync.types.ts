/**
 * Bricqer Batch Sync Types
 *
 * Types for syncing Bricqer batches to bricklink_uploads table
 */

// ============================================================================
// JSON Type (for Supabase compatibility)
// ============================================================================

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ============================================================================
// Sync Mode Types
// ============================================================================

export type BatchSyncMode = 'FULL' | 'INCREMENTAL';
export type BatchSyncStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

// ============================================================================
// Database Row Types
// ============================================================================

export interface BrickLinkUploadRow {
  id: string;
  user_id: string;
  bricqer_batch_id: number | null;
  bricqer_purchase_id: number | null;
  upload_date: string;
  total_quantity: number;
  selling_price: number;
  cost: number | null;
  source: string | null;
  notes: string | null;
  purchase_id: string | null;
  linked_lot: string | null;
  lots: number | null;
  condition: string | null;
  reference: string | null;
  is_activated: boolean | null;
  remaining_quantity: number | null;
  remaining_price: number | null;
  raw_response: Json | null;
  synced_from_bricqer: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface BatchSyncLogRow {
  id: string;
  user_id: string;
  sync_mode: BatchSyncMode;
  status: BatchSyncStatus;
  started_at: string;
  completed_at: string | null;
  batches_processed: number | null;
  batches_created: number | null;
  batches_updated: number | null;
  batches_skipped: number | null;
  error_message: string | null;
  created_at: string;
}

export interface BatchSyncConfigRow {
  id: string;
  user_id: string;
  auto_sync_enabled: boolean;
  auto_sync_interval_hours: number;
  last_auto_sync_at: string | null;
  next_auto_sync_at: string | null;
  sync_activated_only: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Sync Options and Results
// ============================================================================

export interface BatchSyncOptions {
  /** Force full sync (re-fetch all batches) */
  fullSync?: boolean;
  /** Only sync activated/published batches (default: true) */
  activatedOnly?: boolean;
}

export interface BatchSyncResult {
  success: boolean;
  syncMode: BatchSyncMode;
  batchesProcessed: number;
  batchesCreated: number;
  batchesUpdated: number;
  batchesSkipped: number;
  error?: string;
  startedAt: Date;
  completedAt: Date;
}

// ============================================================================
// Connection Status
// ============================================================================

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
    syncMode: BatchSyncMode;
    status: BatchSyncStatus;
    startedAt: string;
    completedAt?: string;
    batchesProcessed?: number;
    batchesCreated?: number;
    batchesUpdated?: number;
    error?: string;
  }>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface BrickLinkUploadsResponse {
  uploads: BrickLinkUploadRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalUploads: number;
    totalQuantity: number;
    totalSellingPrice: number;
    totalCost: number;
    totalMargin: number;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a currency string value to a number
 * Handles various formats: "12.34", "£12.34", "", null, undefined
 */
export function parseCurrencyValue(value: string | number | undefined | null): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Format a date string for display
 */
export function formatUploadDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calculate margin from selling price and cost
 */
export function calculateMargin(sellingPrice: number, cost: number | null): number {
  if (cost === null || cost === 0) return 0;
  return sellingPrice - cost;
}

/**
 * Calculate margin percentage
 */
export function calculateMarginPercent(sellingPrice: number, cost: number | null): number {
  if (cost === null || cost === 0 || sellingPrice === 0) return 0;
  return ((sellingPrice - cost) / cost) * 100;
}
