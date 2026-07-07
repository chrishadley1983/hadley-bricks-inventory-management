/**
 * Set-completeness screen for BL store listings.
 *
 * A seller's SET lot priced against the complete-set UK 6MA is only a valid
 * comparison when the set is complete. BL exposes two signals:
 *   1. `invComplete` from the store AJAX ('C' complete / 'B' incomplete / 'S' sealed —
 *      display text "Complete"/"Incomplete"/"Sealed" depending on endpoint version)
 *   2. the free-text description ("SHIP BUILD & INSTRUCTIONS ONLY - NO FIGURE OR BOX",
 *      "bags opened to remove minifigures and resealed", ...)
 *
 * Found the hard way on Gibbo0o (2026-07-07): both headline set lots were
 * incomplete and carried £66 of phantom projected profit.
 */

/** Description markers that indicate a set is not complete. */
const INCOMPLETE_DESC_RE =
  /incomplete|instructions only|no figure|no minifig|no box|build only|resealed|figures? not included|minifigures? removed/i;

/**
 * True when a SET lot should not be benchmarked against complete-set prices.
 * `invComplete` codes: 'B' = incomplete, 'S' = sealed, 'C' = complete (BL also
 * renders full words in some responses; both are handled). Null/unknown falls
 * back to the description screen.
 */
export function isIncompleteSetListing(
  invComplete: string | null | undefined,
  description: string | null | undefined,
): boolean {
  const code = (invComplete ?? '').trim().toUpperCase();
  if (code === 'B' || code === 'INCOMPLETE') return true;
  if (description && INCOMPLETE_DESC_RE.test(description)) return true;
  return false;
}
