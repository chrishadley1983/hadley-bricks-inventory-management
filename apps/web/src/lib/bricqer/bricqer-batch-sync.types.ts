/**
 * Bricqer Batch Sync Types
 *
 * Types for syncing Bricqer batches to bricklink_uploads table
 */

// ============================================================================
// JSON Type (for Supabase compatibility)
// ============================================================================

import { parseCurrencyValue } from '@/lib/utils/currency';

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

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

/** Re-exported from the shared currency helper (see @/lib/utils/currency). */
export { parseCurrencyValue };

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

/**
 * Sum the purchase cost from a Bricqer purchase detail's journal posts.
 *
 * Bricqer records each purchase as a double-entry journal: the inbound stock
 * ledger posts 0.00 (for margin-scheme purchases) and the supplier/cash ledger
 * posts the negative purchase price (e.g. -85.00). Summing the absolute value
 * of all negative amounts gives the total cash paid.
 */
export function calculatePurchaseCost(
  posts: Array<{ amount: string }> | undefined | null
): number {
  if (!posts || posts.length === 0) return 0;
  let total = 0;
  for (const post of posts) {
    const value = parseCurrencyValue(post.amount);
    if (value < 0) total += Math.abs(value);
  }
  return total;
}
