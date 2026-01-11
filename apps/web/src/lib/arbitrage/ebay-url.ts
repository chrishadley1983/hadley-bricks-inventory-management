/**
 * eBay URL Builder
 *
 * Builds eBay search URLs with appropriate filters for LEGO arbitrage tracking.
 */

/**
 * eBay UK category IDs
 */
export const EBAY_CATEGORIES = {
  LEGO_COMPLETE_SETS: '19006',
  LEGO_MINIFIGURES: '19001',
  LEGO_BRICKS_PIECES: '19003',
  LEGO_INSTRUCTIONS: '19007',
} as const;

/**
 * eBay search filter parameters
 */
export const EBAY_FILTERS = {
  BUY_IT_NOW: 'LH_BIN=1',
  NEW_CONDITION: 'LH_ItemCondition=1000',
  UK_ONLY: 'LH_PrefLoc=1',
} as const;

/**
 * Build an eBay UK search URL for a LEGO set
 *
 * @param setNumber - The LEGO set number (e.g., "75192" or "40585-1")
 * @returns eBay search URL with filters pre-applied
 *
 * @example
 * buildEbaySearchUrl("75192")
 * // Returns: https://www.ebay.co.uk/sch/19006/i.html?_nkw=LEGO%2075192&LH_BIN=1&LH_ItemCondition=1000&LH_PrefLoc=1
 */
export function buildEbaySearchUrl(setNumber: string): string {
  // Strip -1 suffix if present (e.g., 40585-1 -> 40585)
  const cleanSetNumber = setNumber.replace(/-\d+$/, '');

  const query = encodeURIComponent(`LEGO ${cleanSetNumber}`);

  // Build URL with filters:
  // - 19006 = LEGO Complete Sets & Packs category
  // - LH_BIN=1 = Buy It Now only
  // - LH_ItemCondition=1000 = New only
  // - LH_PrefLoc=1 = UK only
  return `https://www.ebay.co.uk/sch/${EBAY_CATEGORIES.LEGO_COMPLETE_SETS}/i.html?_nkw=${query}&${EBAY_FILTERS.BUY_IT_NOW}&${EBAY_FILTERS.NEW_CONDITION}&${EBAY_FILTERS.UK_ONLY}`;
}

/**
 * Build an eBay UK item URL from an item ID
 *
 * @param itemId - The eBay item ID (e.g., "205988726767" or "v1|205988726767|0")
 * @returns Direct link to the eBay listing
 */
export function buildEbayItemUrl(itemId: string): string {
  // Extract numeric ID if in v1|...|0 format
  const match = itemId.match(/\|(\d+)\|/);
  const numericId = match ? match[1] : itemId.replace(/\D/g, '');

  return `https://www.ebay.co.uk/itm/${numericId}`;
}

/**
 * Build an eBay UK sold items search URL for a LEGO set
 * Useful for checking historical sales prices
 *
 * @param setNumber - The LEGO set number
 * @returns eBay sold items search URL
 */
export function buildEbaySoldSearchUrl(setNumber: string): string {
  const cleanSetNumber = setNumber.replace(/-\d+$/, '');
  const query = encodeURIComponent(`LEGO ${cleanSetNumber}`);

  // LH_Complete=1 = Completed listings
  // LH_Sold=1 = Sold items only
  return `https://www.ebay.co.uk/sch/${EBAY_CATEGORIES.LEGO_COMPLETE_SETS}/i.html?_nkw=${query}&${EBAY_FILTERS.NEW_CONDITION}&${EBAY_FILTERS.UK_ONLY}&LH_Complete=1&LH_Sold=1`;
}
