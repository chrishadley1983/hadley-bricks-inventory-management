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
 */
const EXCLUDE_PATTERNS = [
  // Display accessories
  /\bmount\b/i,
  /\bbracket\b/i,
  /\bstand\b/i,
  /\bdisplay\b/i,
  /\bholder\b/i,
  /\bframe\b/i,
  /\bcase\b/i,

  // Documentation
  /\binstructions?\b/i,
  /\bmanual\b/i,
  /\bbooklet\b/i,

  // Incomplete items
  /\bminifig(ure)?s?\s+only\b/i,
  /\bparts\s+only\b/i,
  /\bspares?\b/i,
  /\bpieces?\s+only\b/i,
  /\bbricks?\s+only\b/i,
  /\bincomplete\b/i,
  /\bno\s+box\b/i,
  /\bno\s+minifig/i,
  /\bmissing\b/i,

  // Third-party / compatibility markers
  /\bcompatible\b/i,
  /\bfor\s+lego\b/i, // "For Lego" = third party accessory
  /\balternative\b/i,
  /\baftermarket\b/i,
  /\bcustom\b/i,
  /\bmoc\b/i, // My Own Creation

  // Knockoff brands
  /\bknockoff\b/i,
  /\breplica\b/i,
  /\bfake\b/i,
  /\bclone\b/i,
  /\blepin\b/i,
  /\bking\b/i,
  /\bbela\b/i,
  /\blele\b/i,
  /\bsluban\b/i,
  /\bcobi\b/i,
  /\benlighten\b/i,
  /\bxingbao\b/i,
  /\bsembo\b/i,
  /\bwange\b/i,
  /\bpanlos\b/i,

  // Box/packaging only
  /\bbox\s+only\b/i,
  /\bempty\s+box\b/i,
  /\bpackaging\s+only\b/i,

  // Stickers
  /\bstickers?\s+only\b/i,
  /\bsticker\s+sheet\b/i,
];

/**
 * Check if a listing title is a valid LEGO set listing
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
  const cleanSetNumber = setNumber.replace(/-\d+$/, '');

  // Must contain the set number
  if (!title.includes(cleanSetNumber)) {
    return false;
  }

  // Should contain "LEGO" (official branding)
  const titleLower = title.toLowerCase();
  if (!titleLower.includes('lego')) {
    return false;
  }

  // Check against all exclude patterns
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
export function getListingRejectionReason(
  title: string,
  setNumber: string
): string | null {
  if (!title || !setNumber) {
    return 'Missing title or set number';
  }

  const cleanSetNumber = setNumber.replace(/-\d+$/, '');

  if (!title.includes(cleanSetNumber)) {
    return `Title does not contain set number ${cleanSetNumber}`;
  }

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
