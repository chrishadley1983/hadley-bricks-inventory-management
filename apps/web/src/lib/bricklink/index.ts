export { BrickLinkClient, BrickLinkApiError, RateLimitError } from './client';
export { normalizeOrder, normalizeOrders, calculateOrderStats } from './adapter';
// Note: BrickLinkTransactionSyncService is server-only (uses next/headers)
// Import directly from './bricklink-transaction-sync.service' in API routes
export type {
  BrickLinkCredentials,
  BrickLinkOrderSummary,
  BrickLinkOrderDetail,
  BrickLinkOrderItem,
  BrickLinkOrderListParams,
  NormalizedOrder,
  NormalizedOrderItem,
  RateLimitInfo,
} from './types';
export type {
  BrickLinkTransactionRow,
  BrickLinkSyncLogRow,
  BrickLinkSyncConfigRow,
  BrickLinkSyncMode,
  BrickLinkSyncOptions,
  BrickLinkSyncResult,
  BrickLinkConnectionStatus,
  BrickLinkTransactionsResponse,
} from './bricklink-transaction.types';
export {
  parseCurrencyValue,
  getStatusLabel,
  BRICKLINK_STATUS_LABELS,
} from './bricklink-transaction.types';
