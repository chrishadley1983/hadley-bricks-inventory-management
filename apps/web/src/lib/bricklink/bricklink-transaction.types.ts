/**
 * BrickLink Transaction Staging Types
 *
 * Types for BrickLink transaction sync service following the PayPal pattern
 */

import type {
  BaseTransactionRow,
  Json,
  SyncMode,
  SyncRunStatus,
} from '@/lib/sync/transaction-sync-base';

// ============================================================================
// JSON Type (for Supabase compatibility) — shared declaration, re-exported
// ============================================================================

export type { Json };

// ============================================================================
// Sync Mode Types
// ============================================================================

export type BrickLinkSyncMode = SyncMode;
export type BrickLinkSyncStatus = SyncRunStatus;

// ============================================================================
// Database Row Types
// ============================================================================

// BrickLink rows use `base_currency` rather than the shared `currency` column.
export interface BrickLinkTransactionRow extends Omit<BaseTransactionRow, 'currency'> {
  id: string;
  bricklink_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  base_currency: string;
  shipping: number;
  insurance: number;
  add_charge_1: number;
  add_charge_2: number;
  credit: number;
  coupon_credit: number;
  order_total: number;
  tax: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  payment_date: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  buyer_location: string | null;
  order_note: string | null;
  seller_remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface BrickLinkSyncLogRow {
  id: string;
  user_id: string;
  sync_mode: BrickLinkSyncMode;
  status: BrickLinkSyncStatus;
  started_at: string;
  completed_at: string | null;
  orders_processed: number | null;
  orders_created: number | null;
  orders_updated: number | null;
  orders_skipped: number | null;
  from_date: string | null;
  to_date: string | null;
  last_sync_cursor: string | null;
  error_message: string | null;
  created_at: string;
}

export interface BrickLinkSyncConfigRow {
  id: string;
  user_id: string;
  auto_sync_enabled: boolean;
  auto_sync_interval_hours: number;
  last_auto_sync_at: string | null;
  next_auto_sync_at: string | null;
  last_sync_date_cursor: string | null;
  historical_import_started_at: string | null;
  historical_import_completed_at: string | null;
  historical_import_from_date: string | null;
  include_filed_orders: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Sync Options and Results
// ============================================================================

export interface BrickLinkSyncOptions {
  /** Force full sync (ignore cursor) */
  fullSync?: boolean;
  /** Include filed/archived orders */
  includeFiled?: boolean;
  /** Custom from date for historical import */
  fromDate?: string;
  /** Custom to date for historical import */
  toDate?: string;
}

export interface BrickLinkSyncResult {
  success: boolean;
  syncMode: BrickLinkSyncMode;
  ordersProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  error?: string;
  lastSyncCursor?: string;
  startedAt: Date;
  completedAt: Date;
}

// ============================================================================
// Connection Status
// ============================================================================

export interface BrickLinkConnectionStatus {
  isConnected: boolean;
  transactionCount?: number;
  lastSyncAt?: string;
  syncConfig?: {
    autoSyncEnabled: boolean;
    autoSyncIntervalHours: number;
    nextAutoSyncAt?: string;
    lastSyncCursor?: string;
    historicalImportCompleted: boolean;
    includeFiled: boolean;
  };
  recentLogs?: Array<{
    id: string;
    syncMode: BrickLinkSyncMode;
    status: BrickLinkSyncStatus;
    startedAt: string;
    completedAt?: string;
    ordersProcessed?: number;
    ordersCreated?: number;
    ordersUpdated?: number;
    error?: string;
  }>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface BrickLinkTransactionsResponse {
  transactions: BrickLinkTransactionRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalSales: number;
    totalShipping: number;
    totalTax: number;
    totalGrandTotal: number;
    transactionCount: number;
  };
}

// ============================================================================
// Status Labels
// ============================================================================

export const BRICKLINK_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pending',
  UPDATED: 'Updated',
  PROCESSING: 'Processing',
  READY: 'Ready',
  PAID: 'Paid',
  PACKED: 'Packed',
  SHIPPED: 'Shipped',
  RECEIVED: 'Received',
  COMPLETED: 'Completed',
  OCR: 'Cancelled (Refund)',
  NPB: 'Non-Paying Buyer',
  NPX: 'NPB Expired',
  NRS: 'Non-Responding Seller',
  NSS: 'Non-Shipping Seller',
  CANCELLED: 'Cancelled',
};

// ============================================================================
// Helper Functions
// ============================================================================

/** Re-exported from the shared currency helper (see @/lib/utils/currency). */
export { parseCurrencyValue } from '@/lib/utils/currency';

/**
 * Get a friendly status label
 */
export function getStatusLabel(status: string): string {
  return BRICKLINK_STATUS_LABELS[status] || status;
}
