/**
 * Monzo Category Rules
 *
 * Guards the sheet→DB category mapping in the Monzo sheets sync. The sheet's
 * Category column is whatever Monzo's app auto-assigned per merchant, and in
 * July 2026 Monzo retroactively re-mapped the PayPal merchants (BrickLink
 * sellers → Entertainment/Services/General, Keepa/Proton/Bricqer → Bills),
 * silently misfiling 20 rows. Because every row arrived with *some* category,
 * nothing ever surfaced as needing review.
 *
 * The guard: only trusted categories pass through from the sheet; a merchant's
 * own history and the BL-seller PayPal pattern fill confident gaps; anything
 * else lands as NULL so the "Categorise Monzo transactions" workflow task
 * (count source transactions.uncategorised) queues it for human review.
 */

/**
 * Categories the P&L reads, plus the deliberate non-P&L buckets. A sheet
 * category outside this set is a Monzo auto-guess and is never accepted as-is.
 */
export const TRUSTED_LOCAL_CATEGORIES = new Set([
  // Read by the P&L / MTD export
  'Lego Stock',
  'Lego Parts',
  'Postage',
  'Packing Materials',
  'Selling Fees',
  'Services',
  'Software',
  'Office Space',
  // Deliberate non-P&L buckets
  'Income',
  'Salary',
  'Personal',
  'Transfers',
]);

/** Minimum categorised rows a merchant needs before its history sets precedent. */
const PRECEDENT_MIN_OCCURRENCES = 2;

/**
 * Build merchant → dominant trusted category from existing rows. A merchant
 * qualifies when its most common trusted category has at least
 * PRECEDENT_MIN_OCCURRENCES rows and a strict majority of the merchant's
 * trusted-categorised rows (ties or mixed history set no precedent).
 */
export function buildMerchantPrecedentMap(
  rows: Array<{ merchant_name: string | null; local_category: string | null }>
): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();

  for (const row of rows) {
    if (!row.merchant_name || !row.local_category) continue;
    if (!TRUSTED_LOCAL_CATEGORIES.has(row.local_category)) continue;
    let perMerchant = counts.get(row.merchant_name);
    if (!perMerchant) {
      perMerchant = new Map();
      counts.set(row.merchant_name, perMerchant);
    }
    perMerchant.set(row.local_category, (perMerchant.get(row.local_category) || 0) + 1);
  }

  const precedents = new Map<string, string>();
  for (const [merchant, perMerchant] of counts) {
    let total = 0;
    let topCategory: string | null = null;
    let topCount = 0;
    for (const [category, count] of perMerchant) {
      total += count;
      if (count > topCount) {
        topCount = count;
        topCategory = category;
      }
    }
    if (topCategory && topCount >= PRECEDENT_MIN_OCCURRENCES && topCount * 2 > total) {
      precedents.set(merchant, topCategory);
    }
  }

  return precedents;
}

/**
 * PayPal card payments in this account are overwhelmingly BrickLink store
 * purchases (every historic 'Lego Parts' row is one). The descriptor is
 * "PAYPAL *<seller handle> ..." — the handle is the seller's PayPal name, not
 * the store name, so merchant precedent usually can't help on a new seller.
 */
export function isPayPalDescriptor(description: string | null | undefined): boolean {
  return /^PAYPAL \*/i.test(description ?? '');
}

/**
 * Resolve the local_category for a row arriving from the sheet.
 *
 * Existing rows keep their stored value UNCHANGED — including NULL. A NULL on
 * an existing row means "awaiting review", and falling back to the sheet's
 * category would let Monzo's auto-guess overwrite the review queue on the
 * next sync.
 */
export function resolveLocalCategory(input: {
  /** Row already exists in the DB (existing.local_category may be null). */
  existing?: { local_category: string | null } | undefined;
  sheetCategory: string | null | undefined;
  merchantName: string | null | undefined;
  description: string | null | undefined;
  precedents: Map<string, string>;
}): string | null {
  const { existing, sheetCategory, merchantName, description, precedents } = input;

  if (existing) return existing.local_category;

  if (sheetCategory && TRUSTED_LOCAL_CATEGORIES.has(sheetCategory)) {
    return sheetCategory;
  }

  const precedent = merchantName ? precedents.get(merchantName) : undefined;
  if (precedent) return precedent;

  if (isPayPalDescriptor(description)) return 'Lego Parts';

  return null;
}
