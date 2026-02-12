/**
 * Arbitrage Tracker Module
 *
 * Amazon vs BrickLink arbitrage comparison functionality.
 */

// Types
export * from './types';

// Utilities
export * from './calculations';
export * from './bricklink-url';
export * from './ebay-url';
export * from './ebay-listing-validator';

// Services
export { ArbitrageService } from './arbitrage.service';
export { MappingService } from './mapping.service';
export { AmazonArbitrageSyncService } from './amazon-sync.service';
export { BrickLinkArbitrageSyncService } from './bricklink-sync.service';
export { EbayArbitrageSyncService } from './ebay-sync.service';
export { ArbitrageWatchlistService } from './watchlist.service';
export { KeepaPricingSyncService } from './keepa-pricing-sync.service';
export type { WatchlistItem, WatchlistRefreshResult, WatchlistStats, WatchlistSource } from './watchlist.service';

// eBay False-Positive Detector
export { EbayFpDetectorService } from './ebay-fp-detector.service';
export * from './ebay-fp-detector.types';
