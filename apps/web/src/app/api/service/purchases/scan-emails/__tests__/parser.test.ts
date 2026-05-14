import { describe, it, expect } from 'vitest';
import { parseEbayEmail } from '../parsers';

// Real Gmail body shapes captured from production for the two orders that
// silently dropped to the review queue on 2026-05-09 / 2026-05-10. Both have
// the set number bare in the listing title (no parens), which the old
// parens-only body fallback couldn't match. Keep these fixtures verbatim so
// any future change to title-region heuristics has to keep them green.
//
// HTML-derived: the bodies have been through htmlToText, so newlines and
// table-cell `|` separators are preserved.

const BODY_40759 = `
Your order is confirmed.
| | NIB ***REAL*** LEGO CELEBRATION SERIES: 2. VALENTINES DAY BOX - 40759 |
| | &#160; | | Price: £6.23 incl. £0.50 Buyer Protection fee
| Item ID: 178100661794
| Order number: 05-14626-20354
| Seller: ch1rem
| Estimated delivery: Wed, 13 May - Fri, 15 May 2026
| Subtotal £6.23
| Postage £2.45
| VAT £0.49
| Total charged to £9.17
`;

const BODY_3859 = `
Your order is confirmed.
| | LEGO Game Heroica Caverns of Nathuz 3859 New Sealed |
| | &#160; | | Price: £13.99 incl. £1.01 Buyer Protection fee
| Item ID: 267655348997
| Order number: 03-14624-24827
| Seller: kronkor
| Estimated delivery: Tue, 12 May - Fri, 15 May 2026
| Subtotal £13.99
| Postage £3.38
| Total charged to £17.37
`;

// Subjects are truncated as eBay sends them — set number is NOT in the subject.
const baseEmail = (subject: string, body: string) => ({
  id: 'gmail-id-test',
  subject,
  from: 'eBay <ebay@ebay.com>',
  date: '2026-05-10T13:32:13Z',
  snippet: '',
  body,
});

describe('parseEbayEmail body fallback', () => {
  it('extracts set number when subject is truncated and title has " - NNNNN" tail', () => {
    const result = parseEbayEmail(baseEmail('Order confirmed: NIB ***REAL*** LEGO ...', BODY_40759));
    expect(result).not.toBeNull();
    expect(result?.set_number).toBe('40759');
    expect(result?.order_reference).toBe('05-14626-20354');
    expect(result?.cost).toBe(9.17);
    expect(result?.skip_reason).toBeUndefined();
  });

  it('extracts set number from a bare title with no parens', () => {
    const result = parseEbayEmail(baseEmail('Order confirmed: LEGO Game Heroica Ca...', BODY_3859));
    expect(result).not.toBeNull();
    expect(result?.set_number).toBe('3859');
    expect(result?.order_reference).toBe('03-14624-24827');
    expect(result?.cost).toBe(17.37);
    expect(result?.skip_reason).toBeUndefined();
  });

  it('does not pick up the delivery year as a set number', () => {
    const body = `
      | | Some packaging item with no set number |
      | | &#160; | | Price: £4.99
      | Order number: 05-14621-66230
      | Seller: packshop
      | Estimated delivery: Mon, 11 May 2026
      | Total charged to £6.49
    `;
    const result = parseEbayEmail(baseEmail('Order confirmed: Plain Kraft Cardboar...', body));
    expect(result).not.toBeNull();
    expect(result?.set_number).toBeNull();
    expect(result?.skip_reason).toBe('no_set_number');
  });

  it('still prefers parens-form when present', () => {
    const body = `
      | | LEGO Star Wars X-Wing (75301) New |
      | | &#160; | | Price: £19.99
      | Order number: 07-14600-12345
      | Seller: shop
      | Total charged to £22.99
    `;
    const result = parseEbayEmail(baseEmail('Order confirmed: LEGO Star Wars X-Wi...', body));
    expect(result?.set_number).toBe('75301');
  });
});
