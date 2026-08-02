import { describe, it, expect } from 'vitest';
import {
  buildMerchantPrecedentMap,
  isPayPalDescriptor,
  resolveLocalCategory,
  TRUSTED_LOCAL_CATEGORIES,
} from '../monzo-category-rules';

const noPrecedents = new Map<string, string>();

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
        precedents: new Map([['Keepa Price Tracker', 'Software']]),
      })
    ).toBeNull();
  });

  it('accepts a trusted sheet category on a new row', () => {
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
        merchantName: 'Keepa Price Tracker',
        description: 'KEEPA PRICE TRACKER KEMNATH DEU',
        precedents: new Map([['Keepa Price Tracker', 'Software']]),
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

  it('prefers merchant precedent over the PayPal heuristic', () => {
    expect(
      resolveLocalCategory({
        existing: undefined,
        sheetCategory: 'General',
        merchantName: 'Bricqer',
        description: 'PAYPAL *BRICQER 0630196670 NLD',
        precedents: new Map([['Bricqer', 'Selling Fees']]),
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
  it('sets precedent from a clear trusted majority', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
      { merchant_name: 'Keepa Price Tracker', local_category: 'Software' },
    ]);
    expect(map.get('Keepa Price Tracker')).toBe('Software');
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
    expect(map.get('Bricqer')).toBe('Selling Fees');
  });

  it('skips rows without merchant or category', () => {
    const map = buildMerchantPrecedentMap([
      { merchant_name: null, local_category: 'Software' },
      { merchant_name: 'No Category Ltd', local_category: null },
    ]);
    expect(map.size).toBe(0);
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
