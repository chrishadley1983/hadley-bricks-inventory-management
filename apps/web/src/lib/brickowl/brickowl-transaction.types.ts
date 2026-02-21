/**
 * BrickOwl Transaction Staging Types
 *
 * Types for BrickOwl transaction sync service following the BrickLink pattern
 */

// ============================================================================
// JSON Type (for Supabase compatibility)
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ============================================================================
// Sync Mode Types
// ============================================================================

export type BrickOwlSyncMode = 'FULL' | 'INCREMENTAL' | 'HISTORICAL';
export type BrickOwlSyncStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

// ============================================================================
// Database Row Types
// ============================================================================

export interface BrickOwlTransactionRow {
  id: string;
  user_id: string;
  brickowl_order_id: string;
  order_date: string;
  status_changed_date: string | null;
  buyer_name: string;
  buyer_email: string | null;
  buyer_username: string | null;
  base_currency: string;
  order_total: number;
  shipping: number;
  tax: number;
  coupon_discount: number;
  combined_shipping_discount: number;
  base_grand_total: number;
  total_lots: number;
  total_items: number;
  order_status: string;
  payment_status: string | null;
  payment_method: string | null;
  tracking_number: string | null;
  shipping_method: string | null;
  buyer_location: string | null;
  buyer_note: string | null;
  seller_note: string | null;
  public_note: string | null;
  raw_response: Json;
  created_at: string;
  updated_at: string;
}

export interface BrickOwlSyncLogRow {
  id: string;
  user_id: string;
  sync_mode: BrickOwlSyncMode;
  status: BrickOwlSyncStatus;
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

export interface BrickOwlSyncConfigRow {
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
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Sync Options and Results
// ============================================================================

export interface BrickOwlSyncOptions {
  /** Force full sync (ignore cursor) */
  fullSync?: boolean;
  /** Custom from date for historical import */
  fromDate?: string;
  /** Custom to date for historical import */
  toDate?: string;
}

export interface BrickOwlSyncResult {
  success: boolean;
  syncMode: BrickOwlSyncMode;
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

export interface BrickOwlConnectionStatus {
  isConnected: boolean;
  transactionCount?: number;
  lastSyncAt?: string;
  syncConfig?: {
    autoSyncEnabled: boolean;
    autoSyncIntervalHours: number;
    nextAutoSyncAt?: string;
    lastSyncCursor?: string;
    historicalImportCompleted: boolean;
  };
  recentLogs?: Array<{
    id: string;
    syncMode: BrickOwlSyncMode;
    status: BrickOwlSyncStatus;
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

export interface BrickOwlTransactionsResponse {
  transactions: BrickOwlTransactionRow[];
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

export const BRICKOWL_STATUS_LABELS: Record<string, string> = {
  Pending: 'Pending',
  'Payment Received': 'Payment Received',
  'Payment Submitted': 'Payment Submitted',
  Processing: 'Processing',
  Processed: 'Processed',
  Shipped: 'Shipped',
  Received: 'Received',
  Cancelled: 'Cancelled',
  'On Hold': 'On Hold',
};

export const BRICKOWL_PAYMENT_STATUS_LABELS: Record<string, string> = {
  None: 'None',
  Pending: 'Pending',
  Submitted: 'Submitted',
  Received: 'Received',
  Cleared: 'Cleared',
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Parse a currency string value to a number
 * Handles various formats: "12.34", "£12.34", "", null, undefined, unknown
 */
export function parseCurrencyValue(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  if (value === '') return 0;
  const cleaned = value.replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Get a friendly status label
 */
export function getStatusLabel(status: string): string {
  return BRICKOWL_STATUS_LABELS[status] || status;
}

/**
 * Get a friendly payment status label
 */
export function getPaymentStatusLabel(status: string): string {
  return BRICKOWL_PAYMENT_STATUS_LABELS[status] || status;
}
