/**
 * eBay Listing Validator
 *
 * Validates eBay listing titles to filter out non-set items like:
 * - Display mounts and brackets
 * - Instructions/manuals only
 * - Minifigures only or parts
 * - Knockoff/clone brands
 * - Third-party accessories
 */

/**
 * Patterns to exclude from listings (case-insensitive)
 *
 * NOTE: The eBay API query already filters to category 19006 (LEGO Complete Sets & Packs),
 * New condition, and Buy It Now. This pre-filtering at the API level handles most invalid
 * listings, so these patterns are disabled to avoid over-filtering.
 *
 * Users can manually exclude individual listings that slip through.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  // DISABLED - eBay category filter handles most of these
  // Re-enable specific patterns if needed
  // // Display accessories
  // /\bdisplay\s+mount\b/i,
  // /\bdisplay\s+stand\s+only\b/i,
  // /\bdisplay\s+case\s+only\b/i,
  // /\bwall\s+mount\b/i,
  // /\bacrylic\s+case\b/i,
  // // Documentation
  // /\binstructions?\s+only\b/i,
  // /\bmanual\s+only\b/i,
  // // Incomplete items
  // /\bminifig(ure)?s?\s+only\b/i,
  // /\bparts\s+only\b/i,
  // /\bincomplete\b/i,
  // /\bno\s+box\b/i,
  // /\bmissing\s+pieces\b/i,
  // // Third-party
  // /\bfor\s+lego\b/i,
  // /\bcompatible\s+with\b/i,
  // /\bmoc\b/i,
  // // Knockoffs
  // /\blepin\b/i,
  // /\bnot\s+lego\b/i,
];

/**
 * Check if a listing title is a valid LEGO set listing
 *
 * Since we're searching category 19006 (LEGO Complete Sets & Packs) with the query
 * "LEGO {setNumber}", eBay's relevance ranking should return mostly valid results.
 * We only do minimal validation here to avoid over-filtering.
 *
 * @param title - The eBay listing title
 * @param setNumber - The LEGO set number to match (e.g., "75192" or "40585-1")
 * @returns true if the listing appears to be a valid LEGO set
 */
export function isValidLegoListing(title: string, setNumber: string): boolean {
  if (!title || !setNumber) {
    return false;
  }

  // Strip -1 suffix from set number (e.g., 40585-1 -> 40585)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cleanSetNumber = setNumber.replace(/-\d+$/, '');

  // DISABLED: Set number requirement was too strict - many sellers don't include it
  // The eBay search query already includes the set number for relevance ranking
  // if (!title.includes(cleanSetNumber)) {
  //   return false;
  // }

  // Should contain "LEGO" (official branding) - this is a reasonable minimum requirement
  const titleLower = title.toLowerCase();
  if (!titleLower.includes('lego')) {
    return false;
  }

  // Check against exclude patterns (currently empty - category filter handles most cases)
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(title)) {
      return false;
    }
  }

  return true;
}

/**
 * Get the reason why a listing was rejected (for debugging/logging)
 *
 * @param title - The eBay listing title
 * @param setNumber - The LEGO set number to match
 * @returns Rejection reason or null if valid
 */
export function getListingRejectionReason(title: string, setNumber: string): string | null {
  if (!title || !setNumber) {
    return 'Missing title or set number';
  }

  // Set number check is disabled - kept for reference
  // const cleanSetNumber = setNumber.replace(/-\d+$/, '');
  // if (!title.includes(cleanSetNumber)) {
  //   return `Title does not contain set number ${cleanSetNumber}`;
  // }

  const titleLower = title.toLowerCase();
  if (!titleLower.includes('lego')) {
    return 'Title does not contain "LEGO"';
  }

  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(title)) {
      return `Matched exclude pattern: ${pattern.source}`;
    }
  }

  return null;
}
