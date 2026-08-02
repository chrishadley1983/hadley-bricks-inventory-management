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
 * Crucially, a sheet category being in the trusted taxonomy is NOT validation:
 * four of July's misfiled BL-seller payments arrived as 'Services' — a valid
 * P&L category — and would have sailed through a whitelist. Our own evidence
 * therefore outranks the sheet:
 *
 *   1. Strong merchant precedent (≥90% one category over ≥3 rows of our own
 *      history) overrides the sheet outright — Keepa is Software 12/12 times,
 *      whatever Monzo guesses this month.
 *   2. PayPal-descriptor rows ("PAYPAL *…") never trust the sheet: these are
 *      BrickLink seller payments whose handle Monzo cannot categorise. Any
 *      precedent wins, else Lego Parts.
 *   3. Only then is a trusted sheet category accepted (covers deliberate tags
 *      on genuinely mixed merchants, e.g. eBay → Packing Materials).
 *   4. Majority-but-not-strong precedent fills untrusted gaps.
 *   5. Anything else lands NULL so the "Categorise Monzo transactions"
 *      workflow task (count source transactions.uncategorised) queues it.
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

/** A precedent this consistent overrides even a trusted sheet category. */
const STRONG_PRECEDENT_MIN_OCCURRENCES = 3;
const STRONG_PRECEDENT_MIN_SHARE = 0.9;

export interface MerchantPrecedent {
  category: string;
  /**
   * Near-unanimous history (≥ STRONG_PRECEDENT_MIN_SHARE of the merchant's
   * trusted-categorised rows, over ≥ STRONG_PRECEDENT_MIN_OCCURRENCES rows).
   * Strong precedents override the sheet; weak ones only fill untrusted gaps.
   */
  strong: boolean;
}

/**
 * Build merchant → dominant trusted category from existing rows. A merchant
 * qualifies when its most common trusted category has at least
 * PRECEDENT_MIN_OCCURRENCES rows and a strict majority of the merchant's
 * trusted-categorised rows (ties or mixed history set no precedent).
 */
export function buildMerchantPrecedentMap(
  rows: Array<{ merchant_name: string | null; local_category: string | null }>
): Map<string, MerchantPrecedent> {
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

  const precedents = new Map<string, MerchantPrecedent>();
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
      precedents.set(merchant, {
        category: topCategory,
        strong:
          topCount >= STRONG_PRECEDENT_MIN_OCCURRENCES &&
          topCount / total >= STRONG_PRECEDENT_MIN_SHARE,
      });
    }
  }

  return precedents;
}

/**
 * PayPal card payments in this account are overwhelmingly BrickLink store
 * purchases (every historic 'Lego Parts' row is one). The descriptor is
 * "PAYPAL *<seller handle> ..." — the handle is the seller's PayPal name, not
 * the store name, so Monzo cannot categorise it and its guess (Entertainment,
 * Services, General…) is noise.
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
  precedents: Map<string, MerchantPrecedent>;
}): string | null {
  const { existing, sheetCategory, merchantName, description, precedents } = input;

  if (existing) return existing.local_category;

  const precedent = merchantName ? precedents.get(merchantName) : undefined;

  // 1. Near-unanimous history beats whatever the sheet claims, trusted or not.
  if (precedent?.strong) return precedent.category;

  // 2. PayPal rows: the sheet's category is untrustworthy by construction.
  if (isPayPalDescriptor(description)) {
    return precedent?.category ?? 'Lego Parts';
  }

  // 3. A trusted sheet category on a non-PayPal row is accepted — this is how
  //    deliberate tags on mixed merchants (eBay → Packing Materials) survive.
  if (sheetCategory && TRUSTED_LOCAL_CATEGORIES.has(sheetCategory)) {
    return sheetCategory;
  }

  // 4. Majority precedent fills untrusted gaps.
  if (precedent) return precedent.category;

  // 5. Nothing confident — queue for review.
  return null;
}
