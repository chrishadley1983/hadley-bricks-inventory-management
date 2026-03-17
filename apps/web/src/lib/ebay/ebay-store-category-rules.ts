/**
 * eBay Store Category Assignment Rules
 *
 * Shared rules for assigning listings to the correct eBay store category.
 * Used by the category review service, fix scripts, and audit reports.
 */

// Store category IDs and display names
export const STORE_CATEGORIES = {
  LEGO: { id: '44622906018', name: 'Lego' },
  LEGO_USED_SETS: { id: '48000875018', name: 'Lego Used Sets' },
  LEGO_MINIFIGURES: { id: '48000873018', name: 'Lego Minifigures' },
  LEGO_NEW_SETS: { id: '48000876018', name: 'Lego New Sets' },
  LEGO_OTHER: { id: '48000877018', name: 'Lego Other' },
  ANYTHING_ELSE: { id: '44622911018', name: 'Anything Else' },
  OTHER_ITEMS_DEFAULT: { id: '1', name: 'Other Items (default)' },
} as const;

export const STORE_CATEGORY_BY_ID: Record<string, string> = Object.fromEntries(
  Object.values(STORE_CATEGORIES).map((c) => [c.id, c.name])
);

export interface StoreCategoryResult {
  id: string;
  name: string;
  reason: string;
}

/**
 * Determine the correct store category for a listing based on its attributes.
 *
 * Priority order:
 * 1. Non-LEGO → Anything Else
 * 2. Minifigure → Lego Minifigures
 * 3. Instructions/manuals → Lego Other
 * 4. Parts/pieces/track (not a set) → Lego
 * 5. New/sealed → Lego New Sets
 * 6. Default → Lego Used Sets
 */
export function getCorrectStoreCategory(listing: {
  title: string;
  categoryId?: string | number | null;
  categoryName?: string | null;
  condition?: string | null;
}): StoreCategoryResult {
  const title = listing.title.toLowerCase();
  const catId = String(listing.categoryId || '');
  const condition = (listing.condition || '').toLowerCase();
  const catName = (listing.categoryName || '').toLowerCase();

  // Non-LEGO items
  if (!title.includes('lego') && !catName.includes('lego')) {
    return { ...STORE_CATEGORIES.ANYTHING_ELSE, reason: 'Non-LEGO item' };
  }

  // Minifigures
  if (catId === '263012' || title.includes('minifigure') || title.includes('minifig')) {
    return { ...STORE_CATEGORIES.LEGO_MINIFIGURES, reason: 'Minifigure listing' };
  }

  // Instructions/manuals — match category ID or specific title keywords
  // Avoid matching "book" broadly (would catch BrickHeadz, Handbook, etc.)
  if (catId === '183450' || title.includes('instruction') || title.includes('manual')) {
    return { ...STORE_CATEGORIES.LEGO_OTHER, reason: 'Instructions/manual' };
  }

  // Parts/pieces/track — only if not clearly a complete set
  if (
    (catName.includes('parts') || catName.includes('pieces') || title.includes('track')) &&
    !title.includes('complete') &&
    !title.includes('set')
  ) {
    return { ...STORE_CATEGORIES.LEGO, reason: 'Parts/pieces/track' };
  }

  // New/sealed condition
  if (
    condition.includes('new') ||
    title.includes('sealed') ||
    title.includes('bnib') ||
    title.includes('bnisb') ||
    title.includes('bnsib') ||
    title.includes('brand new') ||
    title.includes('bnip')
  ) {
    return { ...STORE_CATEGORIES.LEGO_NEW_SETS, reason: 'New/sealed condition' };
  }

  // Default for LEGO items
  return { ...STORE_CATEGORIES.LEGO_USED_SETS, reason: 'Used/other LEGO set' };
}

/**
 * Determine if a listing in category 183448 (Bricks & Parts) looks like
 * a complete set that should be in 19006 (Complete Sets & Packs).
 *
 * Returns true if the listing should be moved to 19006.
 * Allows sets that mention minifigure counts (e.g. "8 Minifigures").
 */
export function looksLikeCompleteSet(title: string): boolean {
  const t = title.toLowerCase();

  // Standalone minifigure listing (not a set mentioning minifigure count)
  const isStandaloneMinifig =
    (t.includes('minifigure') || t.includes('minifig')) &&
    !t.match(/\d+\s*minifig/i) && // "4 Minifigures" = set listing
    !t.includes('complete') &&
    !t.includes('set') &&
    !t.match(/\b\d{4,6}\b/); // No set number = likely standalone

  if (isStandaloneMinifig) return false;

  // Clearly not a complete set
  const excludePatterns = [
    /parts?\s+(only|lot)/i,
    /bulk/i,
    /\bbricks?\b.*\blot\b/i,
    /instruction/i,
    /manual/i,
    /box only/i,
    /empty box/i,
  ];

  return !excludePatterns.some((p) => p.test(t));
}
