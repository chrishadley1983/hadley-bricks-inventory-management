/**
 * eBay Finding Service for Listing Assistant
 *
 * Wrapper around the existing eBay Finding client to provide
 * sold price research for the listing generator.
 */

import { getEbayFindingClient, type SoldListingsResult } from '@/lib/ebay/ebay-finding.client';
import type { EbaySoldItem } from './types';

/**
 * Search for eBay sold items using a generic keyword query
 *
 * This is more flexible than the set-number specific search,
 * allowing searches for non-LEGO items or partial queries.
 */
export async function getEbaySoldPrices(
  query: string,
  condition: 'New' | 'Used'
): Promise<{ items: EbaySoldItem[]; stats: { min: number | null; avg: number | null; max: number | null } }> {
  try {
    const client = getEbayFindingClient();

    // Extract set number from query if it looks like a LEGO query
    // e.g., "LEGO 75192" -> "75192"
    const setNumberMatch = query.match(/\b(\d{4,6})\b/);
    const searchQuery = setNumberMatch ? setNumberMatch[1] : query;

    const result = await client.findCompletedItems(searchQuery, condition, 10);

    // Transform to our format
    const items: EbaySoldItem[] = result.listings.map((item) => ({
      itemId: item.itemId,
      title: item.title,
      soldPrice: item.soldPrice,
      currency: item.currency,
      soldDate: formatDate(item.soldDate),
      condition: item.condition,
      url: item.url,
    }));

    return {
      items,
      stats: {
        min: result.minPrice,
        avg: result.avgPrice,
        max: result.maxPrice,
      },
    };
  } catch (error) {
    console.error('[EbayFindingService] Error fetching sold prices:', error);
    // Return empty result on error so the listing can still be generated
    return {
      items: [],
      stats: { min: null, avg: null, max: null },
    };
  }
}

/**
 * Get sold prices for a specific LEGO set number
 */
export async function getLegoSetSoldPrices(
  setNumber: string,
  condition: 'New' | 'Used'
): Promise<SoldListingsResult> {
  const client = getEbayFindingClient();
  return client.findCompletedItems(setNumber, condition, 10);
}

/**
 * Format ISO date to readable format
 */
function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Format price for display
 */
export function formatPrice(price: number, currency: string = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(price);
}

/**
 * Generate a price range string from min/max values
 */
export function generatePriceRange(
  minPrice: number | null,
  maxPrice: number | null,
  currency: string = 'GBP'
): string {
  if (minPrice === null || maxPrice === null) {
    return 'Price TBD';
  }

  if (minPrice === maxPrice) {
    return formatPrice(minPrice, currency);
  }

  return `${formatPrice(minPrice, currency)} - ${formatPrice(maxPrice, currency)}`;
}
