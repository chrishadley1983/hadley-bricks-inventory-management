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
 * Patterns to exclude from listings (case-insensitive).
 *
 * These were disabled on the assumption that the category-19006 filter handled it.
 * It does not: 71741 searched in 19006 still returned a £3.99 minimum against a
 * £250-400 market. Sellers miscategorise constantly — we run a weekly GCP job
 * (`ebay-category-audit`, Mondays 07:00) precisely because OUR OWN complete sets end up
 * in 183448 (Bricks & Parts), so assuming other sellers get it right is not safe.
 *
 * Anchored with  and mostly qualified with "only" so genuine listings survive:
 * "with instructions" and "includes minifigures" must NOT be rejected, while
 * "instructions only" and "minifigures only" must be.
 */
const EXCLUDE_PATTERNS: RegExp[] = [
  // Documentation / packaging sold alone
  /\binstruction(s| manual)?\s+only\b/i,
  /\bmanual(s)?\s+only\b/i,
  /\bbox\s+only\b/i,
  /\bempty\s+box\b/i,
  /\bsticker(s)?\s+(sheet\s+)?only\b/i,
  /\bposter\s+only\b/i,

  // Fragments of a set rather than the set
  /\bminifig(ure)?s?\s+only\b/i,
  /\bfig(ure)?s?\s+only\b/i,
  /\bparts?\s+only\b/i,
  /\bspares?\s+(and|&)\s+repairs?\b/i,
  /\bno\s+(bricks|box|minifig(ure)?s?|instructions)\b/i,
  /\bincomplete\b/i,
  /\bmissing\s+(pieces|parts)\b/i,

  // Display accessories and third-party tat
  /\bdisplay\s+(stand|mount|case)\b/i,
  /\bwall\s+mount(ing)?\b/i,
  /\bacrylic\s+(case|stand)\b/i,
  /\blight(ing)?\s+kit\b/i,
  /\bled\s+light/i,

  // Fragments sold OUT of a set — the dominant residual leak in a 50-set survey.
  // "Malfoy Manor (76453) - Pick Your Minifigure or Parts" £9.95 vs a £134 median;
  // "76324 - Kraven the Hunter Minifigure" £22 vs £104; "Birds x5 from set 11372" £16.
  // All carry the set number and pass every other gate.
  /\bpick\s+(your|a)\b/i,
  // SINGULAR only, and only at the end: "76324 - Kraven the Hunter Minifigure" is one
  // fig; "Malfoy Manor Complete with all minifigures" is the set. The plural must survive.
  /\bminifig(ure)?\s*$/i,
  /\bfrom\s+set\b/i,
  /\bsets?\s*:\s*\d/i, // "Sets: 42617 76324" — parts listed against several sets

  // Documentation and merch that carries the set number
  /\binstructions?\s+manual\b/i,
  /\bvip\s+(frame|card)\b/i,
  /\bblack\s+card\b/i,

  // Not the real thing
  /\bfor\s+lego\b/i,
  /\bcompatible\s+with\b/i,
  /\bnot\s+lego\b/i,
  /\blepin\b/i,
  /\bcustom\s+build\b/i,
  /\bmoc\b/i,
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
export interface ValidationOptions {
  /**
   * Require the set number in the title.
   *
   * OFF by default, preserving arbitrage behaviour where it was found too strict.
   * ON for price aggregation, where precision beats recall: on 71741 every listing that
   * survived the other gates but lacked "71741" was the wrong product — loose parts
   * (53020 syringes at £3.99) or a DIFFERENT SET (40705 Micro City Gardens at £17-20).
   * Category 19006, the "lego" check and the exclusion patterns all pass those; only the
   * set number rejects them.
   */
  requireSetNumber?: boolean;
}

export function isValidLegoListing(
  title: string,
  setNumber: string,
  options: ValidationOptions = {}
): boolean {
  if (!title || !setNumber) {
    return false;
  }

  // Strip -1 suffix from set number (e.g., 40585-1 -> 40585)
  const cleanSetNumber = setNumber.replace(/-\d+$/, '');

  if (options.requireSetNumber && !title.includes(cleanSetNumber)) {
    return false;
  }

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
