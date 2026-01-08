/**
 * Brick Owl module exports
 */

export { BrickOwlClient, BrickOwlApiError, BrickOwlRateLimitError } from './client';
export { normalizeOrder, normalizeOrders, calculateOrderStats } from './adapter';
// Note: BrickOwlTransactionSyncService is server-only (uses next/headers)
// Import directly from './brickowl-transaction-sync.service' in API routes
export {
  parseCurrencyValue,
  getStatusLabel,
  getPaymentStatusLabel,
  BRICKOWL_STATUS_LABELS,
  BRICKOWL_PAYMENT_STATUS_LABELS,
} from './brickowl-transaction.types';
export type {
  BrickOwlCredentials,
  BrickOwlOrder,
  BrickOwlOrderDetail,
  BrickOwlOrderItem,
  BrickOwlOrderListParams,
  BrickOwlRateLimitInfo,
  NormalizedBrickOwlOrder,
  NormalizedBrickOwlOrderItem,
} from './types';
export type {
  BrickOwlSyncMode,
  BrickOwlSyncStatus,
  BrickOwlTransactionRow,
  BrickOwlSyncLogRow,
  BrickOwlSyncConfigRow,
  BrickOwlSyncOptions,
  BrickOwlSyncResult,
  BrickOwlConnectionStatus,
  BrickOwlTransactionsResponse,
} from './brickowl-transaction.types';
