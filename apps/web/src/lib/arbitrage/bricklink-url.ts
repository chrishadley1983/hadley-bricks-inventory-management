/**
 * BrickLink URL Builder
 *
 * Generates BrickLink catalog URLs with pre-applied filters for UK + New condition.
 */

/**
 * Build BrickLink catalog URL for a set with UK + New filters
 *
 * @param setNumber - BrickLink set number (e.g., "40585-1")
 * @returns Full URL to BrickLink catalog page with filters
 */
export function buildBricklinkUrl(setNumber: string): string {
  // Filter options for UK sellers and New condition
  const filters = {
    cond: 'N', // New condition
    loc: 'UK', // UK sellers
  };

  const filterParam = encodeURIComponent(JSON.stringify(filters));

  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(setNumber)}#T=S&O=${filterParam}`;
}

/**
 * Build BrickLink price guide URL for a set
 *
 * @param setNumber - BrickLink set number (e.g., "40585-1")
 * @param condition - 'N' for New, 'U' for Used
 * @returns URL to BrickLink price guide page
 */
export function buildBricklinkPriceGuideUrl(
  setNumber: string,
  condition: 'N' | 'U' = 'N'
): string {
  const condParam = condition === 'N' ? 'new_or_used=N' : 'new_or_used=U';
  return `https://www.bricklink.com/v2/catalog/catalogitem.page?S=${encodeURIComponent(setNumber)}#T=P&${condParam}`;
}

/**
 * Build BrickLink search URL
 *
 * @param query - Search query
 * @returns URL to BrickLink search results
 */
export function buildBricklinkSearchUrl(query: string): string {
  return `https://www.bricklink.com/v2/search.page?q=${encodeURIComponent(query)}&tab=S`;
}

/**
 * Extract BrickLink set number from various input formats
 *
 * @param input - Set number in various formats
 * @returns Normalized set number (e.g., "40585-1") or null
 */
export function normalizeSetNumber(input: string): string | null {
  if (!input || typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();

  // Already in correct format: 40585-1
  if (/^\d{4,6}-\d$/.test(trimmed)) {
    return trimmed;
  }

  // Just the number: 40585
  if (/^\d{4,6}$/.test(trimmed)) {
    return `${trimmed}-1`;
  }

  // With prefix: SET 40585-1 or LEGO 40585
  const match = trimmed.match(/\d{4,6}(-\d)?/);
  if (match) {
    const num = match[0];
    return num.includes('-') ? num : `${num}-1`;
  }

  return null;
}
