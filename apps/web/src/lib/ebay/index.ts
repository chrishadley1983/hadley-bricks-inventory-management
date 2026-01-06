/**
 * eBay Integration Module
 *
 * Exports for eBay API integration including adapters, services, and types.
 */

export { EbayApiAdapter, EbayApiError } from './ebay-api.adapter';
export type { EbayApiAdapterConfig, EbayApiRequestOptions } from './ebay-api.adapter';

export { EbayAuthService, ebayAuthService } from './ebay-auth.service';
export type { EbayAuthConfig, EbayConnectionStatus } from './ebay-auth.service';

export { EbayFulfilmentService, ebayFulfilmentService } from './ebay-fulfilment.service';
export type {
  OrderSyncOptions,
  OrderSyncResult,
  PickingListItem,
  PickingListOptions,
} from './ebay-fulfilment.service';

export { EbayFinancesService, ebayFinancesService } from './ebay-finances.service';
export type {
  TransactionSyncOptions,
  TransactionSyncResult,
  PayoutSyncOptions,
  PayoutSyncResult,
  FinancialSummary,
  TransactionBreakdown,
} from './ebay-finances.service';

export * from './types';
