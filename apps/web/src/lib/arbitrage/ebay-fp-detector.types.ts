/**
 * eBay False-Positive Detector Types
 *
 * Types for the automated detection and exclusion of false-positive
 * eBay listings from arbitrage calculations.
 */

import type { EbayListing } from './types';

/**
 * Detection signal that triggered during scoring
 */
export interface DetectionSignal {
  signal: string;
  points: number;
  description: string;
}

/**
 * Result of scoring a single eBay listing
 */
export interface ListingScoreResult {
  itemId: string;
  title: string;
  score: number;
  isFlagged: boolean;
  signals: DetectionSignal[];
  listing: EbayListing;
  setNumber: string;
  amazonPrice: number | null;
}

/**
 * Arbitrage item from the view with eBay data
 */
export interface ArbitrageViewItem {
  bricklink_set_number: string | null;
  name: string | null;
  effective_amazon_price: number | null;
  ebay_listings: EbayListing[] | string | null;
}

/**
 * Exclusion record to insert
 */
export interface ExclusionRecord {
  user_id: string;
  ebay_item_id: string;
  set_number: string;
  title: string;
  reason: string;
}

/**
 * Result of the FP cleanup job
 */
export interface FpCleanupResult {
  success: boolean;
  itemsScanned: number;
  listingsScanned: number;
  itemsFlagged: number;
  itemsExcluded: number;
  errors: number;
  duration: number;
  topReasons: string[];
}

/**
 * Configuration for the FP detector
 */
export interface FpDetectorConfig {
  threshold: number;
  userId: string;
}

/**
 * Signal weights for scoring
 */
export const SIGNAL_WEIGHTS = {
  VERY_LOW_COG: 35,
  LOW_COG: 25,
  SUSPICIOUS_COG: 15,
  PART_NUMBER_PATTERN: 30,
  MINIFIGURE_KEYWORDS: 25,
  INSTRUCTIONS_ONLY: 30,
  MISSING_SET_NUMBER: 15,
  PARTS_PIECES_KEYWORDS: 20,
  INCOMPLETE_INDICATORS: 25,
  ITEM_ONLY_PATTERN: 30,
  KEYRING_DETECTION: 30,
  NAME_MISMATCH: 25,
  WRONG_SET_NUMBER: 40,
  PRICE_ANOMALY: 20,
  LED_LIGHT_KIT: 30,
  DISPLAY_ACCESSORY: 25,
  THIRD_PARTY_PRODUCT: 30,
  BUNDLE_LOT: 25,
  CUSTOM_MOC: 30,
  MULTI_QUANTITY: 20,
  BOOK_MAGAZINE: 25,
  STICKER_POSTER: 25,
  POLYBAG_PAPER_BAG: 30,
  ADVENT_DAY_SALE: 35,
  SPLIT_FROM_SET: 30,
  NO_MINIFIGURES: 30,
  PROMOTIONAL_ITEM: 25,
  MIN_TO_AVG_RATIO: 25,
  ELEVATED_COG: 10,
} as const;

/**
 * Default threshold for flagging (50 = flagged)
 */
export const DEFAULT_THRESHOLD = 50;

/**
 * Default user ID for single-user system
 */
export const DEFAULT_USER_ID = '4b6e94b4-661c-4462-9d14-b21df7d51e5b';
