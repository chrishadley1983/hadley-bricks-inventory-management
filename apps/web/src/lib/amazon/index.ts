/**
 * Amazon SP-API Integration
 *
 * Exports for Amazon Selling Partner API integration.
 */

export * from './types';
export * from './client';
export * from './adapter';
export * from './amazon-finances.client';
export {
  AmazonTransactionSyncService,
  amazonTransactionSyncService,
  type AmazonSyncResult,
  type AmazonSyncOptions,
} from './amazon-transaction-sync.service';
export {
  AmazonCatalogClient,
  createAmazonCatalogClient,
  type CatalogItemResponse,
  type ProductTypeResult,
} from './amazon-catalog.client';
export {
  AmazonFeedsClient,
  createAmazonFeedsClient,
} from './amazon-feeds.client';
export { AmazonSyncService, type AddToQueueResult } from './amazon-sync.service';
export * from './amazon-sync.types';
