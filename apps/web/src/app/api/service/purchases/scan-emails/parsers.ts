// Pure parsers for purchase-confirmation emails. Lifted out of `route.ts` so
// they can be unit-tested directly — Next.js disallows non-handler exports
// from route files, but a sibling module in the same directory is fine.

export interface PurchaseCandidate {
  source: 'Vinted' | 'eBay';
  order_reference: string;
  seller_username: string;
  item_name: string;
  set_number: string | null;
  cost: number;
  purchase_date: string;
  email_id: string;
  email_subject: string;
  email_date: string;
  payment_method: string;
  suggested_condition: 'New' | 'Used';
  status: 'new' | 'already_processed' | 'already_imported';
  skip_reason?: string;
  bundle_group?: string;
  bundle_total_cost?: number;
  bundle_index?: number;
  forwarded_from?: string;
}

/**
 * Extract ALL LEGO set numbers from text.
 * Handles comma-separated in parentheses like (30666,30565,30679),
 * single in parentheses like (10786), and standalone like 40461.
 */
export function extractAllSetNumbers(text: string): string[] {
  const multiParenMatch = text.match(/\(([\d,\s-]+)\)/);
  if (multiParenMatch) {
    const nums = multiParenMatch[1]
      .split(/[,\s]+/)
      .map((n) => n.replace(/-\d$/, '').trim())
      .filter((n) => /^\d{4,5}$/.test(n));
    if (nums.length > 1) return nums;
    if (nums.length === 1) return nums;
  }

  const singleParenMatch = text.match(/\((\d{4,5})\)/);
  if (singleParenMatch) return [singleParenMatch[1]];

  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of text.matchAll(/\b(\d{4,5})(?:-\d)?\b/g)) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      results.push(match[1]);
    }
  }
  return results;
}

/**
 * Parse eBay purchase confirmation email (single-item "Order confirmed:" form).
 *
 * eBay truncates long subject lines with "...", so the set number frequently
 * lives only in the body. The body fallback runs in two tiers:
 *   1. Parens — `(NNNNN)` — safest.
 *   2. Bare number in the title slice ending at `| Price:` — handles real
 *      listings like `...DAY BOX - 40759 |` and `...Nathuz 3859 New Sealed |`.
 *      Restricted to the title region so we don't pick up order-reference
 *      chunks, delivery years, or item IDs from elsewhere in the email.
 */
export function parseEbayEmail(email: {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body?: string;
}): Partial<PurchaseCandidate> | null {
  const subjectMatch = email.subject.match(/Order confirmed[:\s]*(.+)/i);
  if (!subjectMatch) return null;

  const itemName = subjectMatch[1].replace(/\.{3}$/, '').trim();
  const content = email.body || email.snippet;
  const normalizedContent = content.replace(/[\r\n\s]+/g, ' ');

  let cost = 0;
  const totalMatch = normalizedContent.match(/Total charged to[^£]*£([\d.]+)/i);
  if (totalMatch) {
    cost = parseFloat(totalMatch[1]);
  } else {
    const priceMatch = normalizedContent.match(/Price:\s*£([\d.]+)/i);
    if (priceMatch) {
      cost = parseFloat(priceMatch[1]);
    }
  }

  const sellerMatch = normalizedContent.match(/Seller:\s*(\w+)/i);
  const seller = sellerMatch ? sellerMatch[1].trim() : 'unknown';

  const orderMatch = normalizedContent.match(/Order number:\s*([\d-]+)/i);
  const orderRef = orderMatch ? orderMatch[1] : `ebay-${email.id}`;

  const setNumberMatch = itemName.match(/\((\d{4,5})\)|(?:^|\s)(\d{4,5})(?:-\d)?(?:\s|$)/);
  let setNumber: string | null = setNumberMatch
    ? setNumberMatch[1] || setNumberMatch[2]
    : null;

  if (!setNumber) {
    const bodyParenMatch = normalizedContent.match(/\((\d{4,5})\)/);
    if (bodyParenMatch) setNumber = bodyParenMatch[1];
  }
  if (!setNumber) {
    const priceIdx = normalizedContent.search(/\|\s*Price:/i);
    if (priceIdx > 0) {
      const titleSlice = normalizedContent.slice(Math.max(0, priceIdx - 300), priceIdx);
      const numbers = extractAllSetNumbers(titleSlice).filter((n) => !/^(19|20)\d{2}$/.test(n));
      if (numbers.length > 0) setNumber = numbers[numbers.length - 1];
    }
  }

  const isUsed = /\bused\b|opened|built|incomplete|no box|played/i.test(itemName);

  return {
    source: 'eBay',
    order_reference: orderRef,
    seller_username: seller,
    item_name: itemName,
    set_number: setNumber,
    cost,
    purchase_date: new Date(email.date).toISOString().split('T')[0],
    email_id: email.id,
    email_subject: email.subject,
    email_date: email.date,
    payment_method: 'PayPal',
    suggested_condition: isUsed ? 'Used' : 'New',
    skip_reason: setNumber ? undefined : 'no_set_number',
  };
}
