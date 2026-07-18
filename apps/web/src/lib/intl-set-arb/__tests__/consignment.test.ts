import { describe, it, expect } from 'vitest';
import { buildConsignment, CONSIGNMENT_FLOOR_GBP } from '../consignment';
import type { ZoneCosts } from '../landed-cost';

const ASIA: ZoneCosts = {
  zone: 'ASIA', countries: ['HK'], duty_rate: 0.04, vat_rate: 0.20,
  vat_recoverable: false, handling_fee_gbp: 10, ship_base_gbp: 11, ship_per_100g_gbp: 2, calibrated_at: null,
};

const UKZ: ZoneCosts = {
  zone: 'UK', countries: ['UK', 'GB'], duty_rate: 0, vat_rate: 0.20,
  vat_recoverable: false, handling_fee_gbp: 0, ship_base_gbp: 4, ship_per_100g_gbp: 0.15, calibrated_at: null,
};

describe('buildConsignment', () => {
  it('UK basket: postage once, no duty/VAT/handling, floor always cleared', () => {
    const b = buildConsignment(UKZ, [
      { itemNo: 'a', buyPriceGbp: 60, weightG: 1000, sellNetGbp: 120, qty: 1 },
      { itemNo: 'b', buyPriceGbp: 40, weightG: 500, sellNetGbp: 80, qty: 1 },
    ]);
    // shipping = 4 + 1500/100*0.15 = £6.25
    expect(b.shippingGbp).toBeCloseTo(6.25, 2);
    expect(b.dutyGbp).toBe(0);
    expect(b.vatGbp).toBe(0);
    expect(b.handlingGbp).toBe(0);
    expect(b.landedGbp).toBeCloseTo(106.25, 2);
    expect(b.clearsFloor).toBe(true); // £100 basket — no border floor domestically
    expect(b.netMarginGbp).toBeCloseTo(200 - 106.25, 1);
  });

  it('charges shipping/handling once across the basket and allocates by value', () => {
    const b = buildConsignment(ASIA, [
      { itemNo: '71785', buyPriceGbp: 50, weightG: 1000, sellNetGbp: 215.8, qty: 1 },
      { itemNo: '80043', buyPriceGbp: 50, weightG: 1000, sellNetGbp: 203.35, qty: 1 },
    ]);
    // shipping = 11 + 2000/100*2 = £51, dutiable 151, duty 6.04, vat 0.2*157.04=31.408, handling 10
    expect(b.shippingGbp).toBeCloseTo(51, 2);
    expect(b.dutyGbp).toBeCloseTo(6.04, 2);
    expect(b.vatGbp).toBeCloseTo(31.41, 1);
    expect(b.handlingGbp).toBe(10);
    expect(b.landedGbp).toBeCloseTo(100 + 51 + 6.04 + 31.41 + 10, 1);
    // equal values -> equal landed shares
    expect(b.perItem[0].landedShareGbp).toBeCloseTo(b.perItem[1].landedShareGbp, 2);
    expect(b.netMarginGbp).toBeCloseTo(215.8 + 203.35 - b.landedGbp, 1);
  });

  it('flags baskets under the £135 border floor', () => {
    const b = buildConsignment(ASIA, [{ itemNo: 'x', buyPriceGbp: 100, weightG: 500, sellNetGbp: 150, qty: 1 }]);
    expect(b.clearsFloor).toBe(false);
    expect(CONSIGNMENT_FLOOR_GBP).toBe(135);
  });

  it('context items without sell side share overhead but not margin', () => {
    const b = buildConsignment(ASIA, [
      { itemNo: 'a', buyPriceGbp: 150, weightG: 1000, sellNetGbp: 300, qty: 1 },
      { itemNo: 'b', buyPriceGbp: 50, weightG: 500, sellNetGbp: null, qty: 1 },
    ]);
    expect(b.perItem[1].itemMarginGbp).toBeNull();
    // margin counts only item a's landed share
    expect(b.netMarginGbp).toBeCloseTo(300 - b.perItem[0].landedShareGbp, 1);
  });
});
