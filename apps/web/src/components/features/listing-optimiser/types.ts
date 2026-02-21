/**
 * Types for Listing Optimiser components
 */

import type { OptimiserListing } from '@/lib/ebay/listing-optimiser.service';
import type { ListingAnalysisResponse } from '@/lib/ai/prompts/analyse-listing';
import type { PricingAnalysisResult } from '@/lib/ebay/ebay-finding.client';

export type {
  OptimiserListing,
  ListingOptimiserSummary,
} from '@/lib/ebay/listing-optimiser.service';
export type { ListingAnalysisResponse, ListingSuggestion } from '@/lib/ai/prompts/analyse-listing';

/**
 * Filters for listing optimiser
 */
export interface OptimiserFilters {
  search?: string;
  minAge?: number;
  minViews?: number;
  maxViews?: number;
  hasWatchers?: boolean;
  qualityGrade?: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F' | 'all';
  reviewedStatus?: 'reviewed' | 'not_reviewed' | 'all';
}

/**
 * Sort configuration
 */
export interface SortConfig {
  key: keyof OptimiserListing;
  direction: 'asc' | 'desc';
}

/**
 * Analysis result with pricing
 */
export interface FullAnalysisResult {
  listingId: string;
  analysis: ListingAnalysisResponse;
  pricing: PricingAnalysisResult & {
    profitEstimate: number | null;
    profitMargin: number | null;
    costSource: 'inventory' | null;
  };
  reviewId: string;
}

/**
 * Selection state for multi-select
 */
export interface SelectionState {
  selectedIds: Set<string>;
  toggleSelection: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  isSelected: (id: string) => boolean;
}
