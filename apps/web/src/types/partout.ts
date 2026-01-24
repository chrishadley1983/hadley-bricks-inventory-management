/**
 * Partout Value Types
 *
 * Types for calculating and displaying the total value of a LEGO set's
 * individual parts if sold separately on BrickLink.
 */

import type { BrickLinkItemType } from '@/lib/bricklink/types';

/** Complete partout analysis data returned from the API */
export interface PartoutData {
  setNumber: string;
  totalParts: number;
  povNew: number;
  povUsed: number;
  setPrice: {
    new: number | null;
    used: number | null;
  };
  ratioNew: number | null;
  ratioUsed: number | null;
  recommendation: 'part-out' | 'sell-complete';
  cacheStats: {
    fromCache: number;
    fromApi: number;
    total: number;
  };
  parts: PartValue[];
}

/** Individual part value in the partout analysis */
export interface PartValue {
  partNumber: string;
  partType: BrickLinkItemType;
  name: string;
  colourId: number;
  colourName: string;
  imageUrl: string;
  quantity: number;
  priceNew: number | null;
  priceUsed: number | null;
  totalNew: number;
  totalUsed: number;
  /** Sell-through rate for New condition */
  sellThroughRateNew: number | null;
  /** Sell-through rate for Used condition */
  sellThroughRateUsed: number | null;
  /** Number of lots available for New condition */
  stockAvailableNew: number | null;
  /** Number of lots available for Used condition */
  stockAvailableUsed: number | null;
  /** Number of times sold for New condition */
  timesSoldNew: number | null;
  /** Number of times sold for Used condition */
  timesSoldUsed: number | null;
  fromCache: boolean;
}

/** Part identifier for cache lookups */
export interface PartIdentifier {
  partNumber: string;
  partType: BrickLinkItemType;
  colourId: number;
  colourName?: string;
  name: string;
  quantity: number;
}

/** Cached part price from database */
export interface CachedPartPrice {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string | null;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRateNew: number | null;
  sellThroughRateUsed: number | null;
  stockAvailableNew: number | null;
  stockAvailableUsed: number | null;
  timesSoldNew: number | null;
  timesSoldUsed: number | null;
  fetchedAt: Date;
}

/** Result of cache lookup */
export interface CacheLookupResult {
  cached: CachedPartWithIdentifier[];
  uncached: PartIdentifier[];
}

/** Cached price with part identifier for combining results */
export interface CachedPartWithIdentifier extends CachedPartPrice {
  name: string;
  quantity: number;
}

/** Part price data to insert/update in cache */
export interface PartPriceData {
  partNumber: string;
  partType: string;
  colourId: number;
  colourName: string | null;
  priceNew: number | null;
  priceUsed: number | null;
  sellThroughRateNew: number | null;
  sellThroughRateUsed: number | null;
  stockAvailableNew: number | null;
  stockAvailableUsed: number | null;
  timesSoldNew: number | null;
  timesSoldUsed: number | null;
}

/** Progress callback for batch fetching */
export type PartoutProgressCallback = (fetched: number, total: number, cached: number) => void;

/** Partout API response */
export interface PartoutApiResponse {
  data: PartoutData;
}

/** Partout API error response */
export interface PartoutApiError {
  error: string;
  details?: unknown;
}

/** Phase of the partout streaming fetch */
export type PartoutStreamPhase = 'fetching-colors' | 'fetching-subsets' | 'fetching-parts';

/** Server-Sent Event types for partout streaming */
export interface PartoutStreamEvent {
  type: 'start' | 'phase' | 'progress' | 'complete' | 'error';
  message?: string;
  phase?: PartoutStreamPhase;
  fetched?: number;
  total?: number;
  cached?: number;
  data?: PartoutData;
  error?: string;
}

/** Progress state for streaming fetch in UI */
export interface StreamProgress {
  fetched: number;
  total: number;
  cached: number;
}
