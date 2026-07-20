import { describe, it, expect } from 'vitest';
import {
  landedUnitGbp, zoneForCountry, makeAmazonValuer, marginalShippingGbp,
  HANDLING_AMORTISE_UNITS, AMAZON_FEE_SHARE, AMAZON_OUTBOUND_SHIP_GBP, type ZoneCosts,
} from '../landed-cost';
import { MAX_BUY_FEE, MAX_BUY_SHIP } from '../../investment/max-buy';

const ASIA: ZoneCosts = {
  zone: 'ASIA', countries: ['HK', 'CN', 'MY', 'SG'], duty_rate: 0.04, vat_rate: 0.20,
  vat_recoverable: false, handling_fee_gbp: 10, ship_base_gbp: 11, ship_per_100g_gbp: 2, calibrated_at: null,
};
const UK: ZoneCosts = {
  zone: 'UK', countries: ['UK', 'GB'], duty_rate: 0, vat_rate: 0.20,
  vat_recoverable: false, handling_fee_gbp: 0, ship_base_gbp: 0, ship_per_100g_gbp: 0, calibrated_at: null,
};
const ROW: ZoneCosts = { ...ASIA, zone: 'ROW', countries: [] };

describe('zoneForCountry', () => {
  it('routes HK to ASIA and unknown to ROW', () => {
    expect(zoneForCountry('HK', [UK, ASIA, ROW]).zone).toBe('ASIA');
    expect(zoneForCountry('BR', [UK, ASIA, ROW]).zone).toBe('ROW');
    expect(zoneForCountry(null, [UK, ASIA, ROW]).zone).toBe('ROW');
  });
});

describe('landedUnitGbp', () => {
  it('UK is item + domestic postage share, no import legs', () => {
    const ukBands = { ...UK, ship_base_gbp: 4, ship_per_100g_gbp: 0.15 };
    const l = landedUnitGbp(ukBands, 200, 1500)!;
    // 1500g: marginal 15*0.15=2.25 + base 4/10 = £2.65
    expect(l.shippingGbp).toBeCloseTo(2.65, 2);
    expect(l.dutyGbp).toBe(0);
    expect(l.vatGbp).toBe(0);
    expect(l.handlingGbp).toBe(0);
    expect(l.landedGbp).toBeCloseTo(202.65, 2);
    expect(landedUnitGbp(ukBands, 200, null)).toBeNull();
  });

  it('Asia consignment example matches the spec formula', () => {
    // £228.80 HK set, 2,000g: marginal ship 2000/100*2 = £40, +base 11/10 = £41.10
    // dutiable 269.90 -> duty 10.796 -> VAT 0.2*(280.696)=56.139 -> +handling 1
    const l = landedUnitGbp(ASIA, 228.8, 2000)!;
    expect(l.shippingGbp).toBeCloseTo(41.1, 2);
    expect(l.dutyGbp).toBeCloseTo(10.8, 1);
    expect(l.vatGbp).toBeCloseTo(56.14, 1);
    expect(l.handlingGbp).toBeCloseTo(10 / HANDLING_AMORTISE_UNITS, 5);
    expect(l.landedGbp).toBeCloseTo(228.8 + 41.1 + 10.8 + 56.14 + 1, 0);
  });

  it('unknown weight -> null, never a guessed cost', () => {
    expect(landedUnitGbp(ASIA, 100, null)).toBeNull();
    expect(marginalShippingGbp(ASIA, null)).toBeNull();
  });

  it('vat_recoverable zeroes the VAT leg only', () => {
    const rec = landedUnitGbp({ ...ASIA, vat_recoverable: true }, 228.8, 2000)!;
    expect(rec.vatGbp).toBe(0);
    expect(rec.dutyGbp).toBeCloseTo(10.8, 1);
  });
});

describe('makeAmazonValuer', () => {
  const v = makeAmazonValuer(new Map([
    ['10307-1', { asin: 'B0TEST', buyBox: 100, was90: 95, drops90: 42, salesRank: 12_345, snapshotDate: '2026-07-20', asinConfidence: 99 }],
    ['10308-1', { asin: 'B0NOPX', buyBox: null, was90: null, drops90: null, salesRank: null, snapshotDate: null, asinConfidence: 99 }],
  ]));
  it('house constants are the max-buy ones, never re-declared', () => {
    expect(AMAZON_FEE_SHARE).toBe(MAX_BUY_FEE);
    expect(AMAZON_OUTBOUND_SHIP_GBP).toBe(MAX_BUY_SHIP);
  });
  it('quotes HOUSE net: fees and outbound ship off the sale price', () => {
    const q = v.quote('10307-1')!;
    expect(q.sellNetGbp).toBeCloseTo(100 * (1 - AMAZON_FEE_SHARE) - AMAZON_OUTBOUND_SHIP_GBP, 2);
    expect(q.velocityDrops90).toBe(42);
    expect(q.was90Gbp).toBe(95);
    expect(q.salesRank).toBe(12_345);
    expect(q.snapshotDate).toBe('2026-07-20');
  });
  it('null without a buy box or unknown set', () => {
    expect(v.quote('10308-1')).toBeNull();
    expect(v.quote('99999-1')).toBeNull();
  });
});
