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

export { EbayTransactionSyncService, ebayTransactionSyncService } from './ebay-transaction-sync.service';
export type { EbaySyncResult, EbaySyncOptions } from './ebay-transaction-sync.service';

export { EbayOrderSyncService, ebayOrderSyncService } from './ebay-order-sync.service';
export type { EbayOrderSyncResult, EbayOrderSyncOptions } from './ebay-order-sync.service';

export { EbayAutoSyncService, ebayAutoSyncService } from './ebay-auto-sync.service';
export type { EbaySyncConfig, EbayFullSyncResult, EbaySyncStatusSummary } from './ebay-auto-sync.service';

export { EbaySignatureService, ebaySignatureService } from './ebay-signature.service';
export type { EbaySigningKeys, SignedRequestHeaders } from './ebay-signature.service';

export { EbayBrowseClient, getEbayBrowseClient } from './ebay-browse.client';
export type { EbayItemSummary, EbaySearchResponse, EbaySearchOptions } from './ebay-browse.client';

export { EbayFindingClient, getEbayFindingClient } from './ebay-finding.client';
export type { EbaySoldItem, SoldListingsResult } from './ebay-finding.client';

export * from './types';
