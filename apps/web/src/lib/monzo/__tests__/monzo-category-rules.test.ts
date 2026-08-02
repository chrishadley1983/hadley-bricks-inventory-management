import { describe, it, expect } from 'vitest';
import {
  buildMerchantPrecedentMap,
  isPayPalDescriptor,
  resolveLocalCategory,
  TRUSTED_LOCAL_CATEGORIES,
  type MerchantPrecedent,
} from '../monzo-category-rules';

const noPrecedents = new Map<string, MerchantPrecedent>();
const strong = (category: string): MerchantPrecedent => ({ category, strong: true });
const weak = (category: string): MerchantPrecedent => ({ category, strong: false });

describe('resolveLocalCategory', () => {
  it('keeps an existing row category verbatim', () => {
    expect(
      resolveLocalCategory({
        existing: { local_category: 'Lego Parts' },
        sheetCategory: 'Entertainment',
        merchantName: 'Magicbrixen Br',
        description: 'PAYPAL *MAGICBRIXEN',
        precedents: noPrecedents,
      })
    ).toBe('Lego Parts');
  });

  it('keeps NULL on an existing row awaiting review — the sheet guess must not refill it', () => {
    expect(
      resolveLocalCategory({
        existing: { local_category: null },
        sheetCategory: 'Bills',
        merchantName: 'Keepa Price Tracker',
        description: 'KEEPA PRICE TRACKER KEMNATH DEU',
        precedents: new Map([['Keepa Price Tracker', strong('Software')]]),
      })
    ).toBeNull();
  });

  it('lets a strong precedent override even a trusted sheet category', () => {
    // Keepa arriving mis-tagged as 'Services' (trusted!) must still be Software.
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Services',
        merchantName: 'Keepa Price Tracker',
        description: 'KEEPA PRICE TRACKER KEMNATH DEU',
        precedents: new Map([['Keepa Price Tracker', strong('Software')]]),
      })
    ).toBe('Software');
  });

  it('does NOT let a weak precedent override a trusted sheet category', () => {
    // eBay is majority Lego Stock but has genuine Packing Materials rows —
    // a deliberate trusted tag must survive.
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Packing Materials',
        merchantName: 'eBay',
        description: 'EBAY O*12-3456',
        precedents: new Map([['eBay', weak('Lego Stock')]]),
      })
    ).toBe('Packing Materials');
  });

  it('never trusts the sheet on PayPal rows — trusted-but-wrong Services is rejected', () => {
    // The July 2026 failure: BL sellers auto-tagged 'Services' (a valid P&L
    // category) sailed past a pure whitelist. PayPal rows resolve from our
    // own rules only.
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Services',
        merchantName: 'Bradnewton9 Br',
        description: 'PAYPAL *BRADNEWTON9 BR 35314369001   GBR',
        precedents: noPrecedents,
      })
    ).toBe('Lego Parts');
  });

  it('accepts a trusted sheet category on a new non-PayPal row', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Postage',
        merchantName: 'Royal Mail',
        description: 'ROYAL MAIL',
        precedents: noPrecedents,
      })
    ).toBe('Postage');
  });

  it('overrides an untrusted sheet category with merchant precedent', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Bills',
        merchantName: 'Proton',
        description: 'Proton                 Geneva        CHE',
        precedents: new Map([['Proton', weak('Software')]]),
      })
    ).toBe('Software');
  });

  it('falls back to Lego Parts for PayPal descriptors with no precedent (BL sellers)', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Entertainment',
        merchantName: 'Sphbricks Bric',
        description: 'PAYPAL *SPHBRICKS BRIC Peterborough  GBR',
        precedents: noPrecedents,
      })
    ).toBe('Lego Parts');
  });

  it('prefers merchant precedent over the PayPal Lego Parts fallback', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'General',
        merchantName: 'Bricqer',
        description: 'PAYPAL *BRICQER        0630196670    NLD',
        precedents: new Map([['Bricqer', weak('Selling Fees')]]),
      })
    ).toBe('Selling Fees');
  });

  it('returns NULL for an untrusted category with no precedent and no PayPal pattern', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'Entertainment',
        merchantName: 'Some New Shop',
        description: 'SOME NEW SHOP LONDON GBR',
        precedents: noPrecedents,
      })
    ).toBeNull();
  });

  it('returns NULL when the sheet category is missing entirely', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: null,
        merchantName: 'Some New Shop',
        description: 'SOME NEW SHOP LONDON GBR',
        precedents: noPrecedents,
      })
    ).toBeNull();
  });
});

describe('buildMerchantPrecedentMap', () => {
  it('marks a unanimous history of 3+ as strong', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
    ]);
    expect(map.get('Keepa Price Tracker')).toEqual({ category: 'Software', strong: true });
  });

  it('marks a 2-row unanimous history as weak (below strong threshold)', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Proton', local_category: 'Software' },
      { merchant_name: 'Proton', local_category: 'Software' },
    ]);
    expect(map.get('Proton')).toEqual({ category: 'Software', strong: false });
  });

  it('marks a clear-but-mixed majority as weak', () => {
    // 7 of 10 = 70% majority: precedent yes, strong no.
    const rows = [
      ...Array.from({ length: 7 }, () => ({
        merchant_name: 'eBay',
        local_category: 'Lego Stock',
      })),
      ...Array.from({ length: 3 }, () => ({
        merchant_name: 'eBay',
        local_category: 'Packing Materials',
      })),
    ];
    expect(buildMerchantPrecedentMap(rows).get('eBay')).toEqual({
      category: 'Lego Stock',
      strong: false,
    });
  });

  it('marks a 90%+ majority as strong', () => {
    const rows = [
      ...Array.from({ length: 19 }, () => ({
        merchant_name: 'Vinted',
        local_category: 'Lego Stock',
      })),
      { merchant_name: 'Vinted', local_category: 'Personal' },
    ];
    expect(buildMerchantPrecedentMap(rows).get('Vinted')).toEqual({
      category: 'Lego Stock',
      strong: true,
    });
  });

  it('requires at least two occurrences', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'One Off Ltd', local_category: 'Software' },
    ]);
    expect(map.has('One Off Ltd')).toBe(false);
  });

  it('sets no precedent on a tie', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Split Shop', local_category: 'Lego Stock' },
      { merchant_name: 'Split Shop', local_category: 'Lego Stock' },
      { merchant_name: 'Split Shop', local_category: 'Lego Parts' },
      { merchant_name: 'Split Shop', local_category: 'Lego Parts' },
    ]);
    expect(map.has('Split Shop')).toBe(false);
  });

  it('ignores untrusted categories when counting', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Bricqer', local_category: 'Selling Fees' },
      { merchant_name: 'Bricqer', local_category: 'Selling Fees' },
      { merchant_name: 'Bricqer', local_category: 'Bills' },
      { merchant_name: 'Bricqer', local_category: 'Bills' },
      { merchant_name: 'Bricqer', local_category: 'Bills' },
    ]);
    expect(map.get('Bricqer')).toEqual({ category: 'Selling Fees', strong: false });
  });

  it('skips rows without merchant or category', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: null, local_category: 'Software' },
      { merchant_name: 'No Category Ltd', local_category: null },
    ]);
    expect(map.size).toBe(0);
  });

  it('ignores history older than the recency window when now is given', () => {
    // The eBay case: 1,771 'Postage' rows up to Feb 2025 must not set the
    // precedent for 2026 stock purchases.
    const now = new Date('2026-08-02T00:00:00Z');
    const rows = [
      ...Array.from({ length: 100 }, () => ({
        merchant_name: 'eBay',
        local_category: 'Postage',
        created: '2024-11-01T00:00:00Z',
      })),
      ...Array.from({ length: 10 }, () => ({
        merchant_name: 'eBay',
        local_category: 'Lego Stock',
        created: '2026-06-01T00:00:00Z',
      })),
    ];
    expect(buildMerchantPrecedentMap(rows, now).get('eBay')).toEqual({
      category: 'Lego Stock',
      strong: true,
    });
  });

  it('treats rows with missing created as outside the window when now is given', () => {
    const now = new Date('2026-08-02T00:00:00Z');
    const map = buildMerchantPrecedentMap(
      [
        { merchant_name: 'Ghost Ltd', local_category: 'Software', created: null },
        { merchant_name: 'Ghost Ltd', local_category: 'Software', created: null },
      ],
      now
    );
    expect(map.has('Ghost Ltd')).toBe(false);
  });

  it('uses all rows when now is omitted', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Old Faithful', local_category: 'Software', created: '2024-01-01T00:00:00Z' },
      { merchant_name: 'Old Faithful', local_category: 'Software', created: '2024-01-02T00:00:00Z' },
    ]);
    expect(map.get('Old Faithful')).toEqual({ category: 'Software', strong: false });
  });
});

describe('isPayPalDescriptor', () => {
  it('matches the PayPal card descriptor', () => {
    expect(isPayPalDescriptor('PAYPAL *SPHBRICKS BRIC Peterborough  GBR')).toBe(true);
    expect(isPayPalDescriptor('paypal *legocraig      wakefield     GBR')).toBe(true);
  });

  it('does not match non-PayPal descriptors', () => {
    expect(isPayPalDescriptor('KEEPA PRICE TRACKER KEMNATH DEU')).toBe(false);
    expect(isPayPalDescriptor('PP1777694076')).toBe(false);
    expect(isPayPalDescriptor(null)).toBe(false);
  });
});

describe('TRUSTED_LOCAL_CATEGORIES', () => {
  it('contains every category the P&L reads', () => {
    for (const category of [
      'Lego Stock',
      'Lego Parts',
      'Postage',
      'Packing Materials',
      'Selling Fees',
      'Services',
      'Software',
      'Office Space',
    ]) {
      expect(TRUSTED_LOCAL_CATEGORIES.has(category)).toBe(true);
    }
  });

  it('excludes Monzo auto-guess categories', () => {
    for (const category of ['Bills', 'Entertainment', 'General', 'Equipment', 'Shopping']) {
      expect(TRUSTED_LOCAL_CATEGORIES.has(category)).toBe(false);
    }
  });
});
