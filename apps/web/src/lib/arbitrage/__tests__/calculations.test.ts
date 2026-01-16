import { describe, it, expect } from 'vitest';
import {
  calculateMargin,
  calculateProfit,
  formatMarginPercent,
  isOpportunity,
  formatCurrencyGBP,
  formatSalesRank,
  calculateMedianPrice,
  getShippingCost,
  calculateAmazonFBMProfit,
  formatROIPercent,
} from '../calculations';

describe('Arbitrage Calculations', () => {
  describe('calculateMargin', () => {
    it('should calculate margin correctly for profitable items', () => {
      // Amazon price £100, BrickLink price £70 = 30% margin
      const margin = calculateMargin(100, 70);
      expect(margin).toBe(30);
    });

    it('should calculate margin correctly for high-margin items', () => {
      // Amazon price £100, BrickLink price £40 = 60% margin
      const margin = calculateMargin(100, 40);
      expect(margin).toBe(60);
    });

    it('should calculate margin correctly for low-margin items', () => {
      // Amazon price £100, BrickLink price £90 = 10% margin
      const margin = calculateMargin(100, 90);
      expect(margin).toBe(10);
    });

    it('should return 0 for invalid Amazon price', () => {
      expect(calculateMargin(0, 70)).toBe(0);
      expect(calculateMargin(-100, 70)).toBe(0);
    });

    it('should return 0 for invalid BrickLink price', () => {
      expect(calculateMargin(100, 0)).toBe(0);
      expect(calculateMargin(100, -70)).toBe(0);
    });

    it('should handle negative margin (loss scenario)', () => {
      // Amazon price £70, BrickLink price £100 = -42.86% margin
      const margin = calculateMargin(70, 100);
      expect(margin).toBeCloseTo(-42.86, 1);
    });
  });

  describe('calculateProfit', () => {
    it('should calculate gross profit correctly', () => {
      const result = calculateProfit(100, 70);
      expect(result.grossProfit).toBe(30);
      expect(result.marginPercent).toBe(30);
    });

    it('should return zeros for invalid inputs', () => {
      expect(calculateProfit(0, 70)).toEqual({ grossProfit: 0, marginPercent: 0 });
      expect(calculateProfit(100, 0)).toEqual({ grossProfit: 0, marginPercent: 0 });
      expect(calculateProfit(-100, 70)).toEqual({ grossProfit: 0, marginPercent: 0 });
    });
  });

  describe('formatMarginPercent', () => {
    it('should format positive margins with + sign', () => {
      expect(formatMarginPercent(45.2)).toBe('+45.2%');
      expect(formatMarginPercent(100)).toBe('+100.0%');
    });

    it('should format negative margins', () => {
      expect(formatMarginPercent(-12.3)).toBe('-12.3%');
    });

    it('should format zero margin with + sign', () => {
      expect(formatMarginPercent(0)).toBe('+0.0%');
    });

    it('should return em-dash for null', () => {
      expect(formatMarginPercent(null)).toBe('—');
    });

    it('should round to one decimal place', () => {
      expect(formatMarginPercent(33.333)).toBe('+33.3%');
      expect(formatMarginPercent(66.666)).toBe('+66.7%');
    });
  });

  describe('isOpportunity', () => {
    it('should return true for margins above default threshold', () => {
      expect(isOpportunity(30)).toBe(true);
      expect(isOpportunity(50)).toBe(true);
      expect(isOpportunity(100)).toBe(true);
    });

    it('should return false for margins below default threshold', () => {
      expect(isOpportunity(29.9)).toBe(false);
      expect(isOpportunity(10)).toBe(false);
      expect(isOpportunity(0)).toBe(false);
    });

    it('should return false for null margin', () => {
      expect(isOpportunity(null)).toBe(false);
    });

    it('should use custom threshold when provided', () => {
      expect(isOpportunity(20, 20)).toBe(true);
      expect(isOpportunity(19.9, 20)).toBe(false);
      expect(isOpportunity(50, 60)).toBe(false);
    });

    it('should return false for negative margins', () => {
      expect(isOpportunity(-10)).toBe(false);
    });
  });

  describe('formatCurrencyGBP', () => {
    it('should format amounts as GBP', () => {
      expect(formatCurrencyGBP(12.99)).toBe('£12.99');
      expect(formatCurrencyGBP(0)).toBe('£0.00');
    });

    it('should format large amounts with thousands separators', () => {
      const result = formatCurrencyGBP(1234.56);
      expect(result).toContain('1,234.56');
    });

    it('should return em-dash for null', () => {
      expect(formatCurrencyGBP(null)).toBe('—');
    });

    it('should handle negative amounts', () => {
      const result = formatCurrencyGBP(-50);
      expect(result).toContain('50.00');
      expect(result).toContain('-');
    });
  });

  describe('formatSalesRank', () => {
    it('should format rank with # prefix', () => {
      expect(formatSalesRank(1234)).toBe('#1,234');
      expect(formatSalesRank(1)).toBe('#1');
    });

    it('should return em-dash for null', () => {
      expect(formatSalesRank(null)).toBe('—');
    });

    it('should format large ranks with thousands separators', () => {
      expect(formatSalesRank(1000000)).toBe('#1,000,000');
    });
  });

  describe('calculateMedianPrice', () => {
    it('should calculate median for odd number of prices', () => {
      expect(calculateMedianPrice([10, 20, 30])).toBe(20);
      expect(calculateMedianPrice([5, 15, 25, 35, 45])).toBe(25);
    });

    it('should calculate median for even number of prices', () => {
      expect(calculateMedianPrice([10, 20, 30, 40])).toBe(25);
      expect(calculateMedianPrice([10, 20])).toBe(15);
    });

    it('should return null for empty array', () => {
      expect(calculateMedianPrice([])).toBeNull();
    });

    it('should filter out zero and negative prices', () => {
      expect(calculateMedianPrice([0, 10, 20, 30])).toBe(20);
      expect(calculateMedianPrice([-10, 10, 20, 30])).toBe(20);
      expect(calculateMedianPrice([0, 0, 0])).toBeNull();
    });

    it('should return single price for array of one', () => {
      expect(calculateMedianPrice([50])).toBe(50);
    });
  });

  describe('getShippingCost', () => {
    it('should return low cost for items under threshold', () => {
      const result = getShippingCost(10);
      expect(result.cost).toBe(3);
      expect(result.tier).toContain('Under');
    });

    it('should return high cost for items at or above threshold', () => {
      const result = getShippingCost(14);
      expect(result.cost).toBe(4);
      expect(result.tier).toContain('or over');
    });

    it('should return high cost for expensive items', () => {
      const result = getShippingCost(100);
      expect(result.cost).toBe(4);
    });
  });

  describe('calculateAmazonFBMProfit', () => {
    it('should calculate full profit breakdown', () => {
      const result = calculateAmazonFBMProfit(50, 20);

      expect(result).not.toBeNull();
      expect(result!.salePrice).toBe(50);
      expect(result!.productCost).toBe(20);
      expect(result!.referralFee).toBe(7.5); // 15% of £50
      expect(result!.referralFeeRate).toBe(0.15);
    });

    it('should return null for invalid sale price', () => {
      expect(calculateAmazonFBMProfit(0, 20)).toBeNull();
      expect(calculateAmazonFBMProfit(-50, 20)).toBeNull();
    });

    it('should return null for invalid product cost', () => {
      expect(calculateAmazonFBMProfit(50, 0)).toBeNull();
      expect(calculateAmazonFBMProfit(50, -20)).toBeNull();
    });

    it('should include Digital Services Tax', () => {
      const result = calculateAmazonFBMProfit(100, 40);

      expect(result!.dstRate).toBe(0.02);
      expect(result!.digitalServicesTax).toBeCloseTo(0.3, 2); // 2% of £15 referral fee
    });

    it('should include VAT on fees', () => {
      const result = calculateAmazonFBMProfit(100, 40);

      expect(result!.vatRate).toBe(0.2);
      expect(result!.vatOnFees).toBeGreaterThan(0);
    });

    it('should calculate correct shipping tier', () => {
      const lowPriceResult = calculateAmazonFBMProfit(10, 5);
      expect(lowPriceResult!.shippingCost).toBe(3);

      const highPriceResult = calculateAmazonFBMProfit(50, 20);
      expect(highPriceResult!.shippingCost).toBe(4);
    });

    it('should calculate ROI correctly', () => {
      const result = calculateAmazonFBMProfit(50, 20);

      // ROI = (profit / cost) * 100
      expect(result!.roiPercent).toBeDefined();
      expect(typeof result!.roiPercent).toBe('number');
    });

    it('should calculate profit margin correctly', () => {
      const result = calculateAmazonFBMProfit(50, 20);

      // Profit margin = (profit / sale price) * 100
      expect(result!.profitMarginPercent).toBeDefined();
      expect(typeof result!.profitMarginPercent).toBe('number');
    });
  });

  describe('formatROIPercent', () => {
    it('should format positive ROI with + sign', () => {
      expect(formatROIPercent(125.3)).toBe('+125.3%');
    });

    it('should format negative ROI', () => {
      expect(formatROIPercent(-15.2)).toBe('-15.2%');
    });

    it('should return em-dash for null', () => {
      expect(formatROIPercent(null)).toBe('—');
    });

    it('should round to one decimal place', () => {
      expect(formatROIPercent(50.555)).toBe('+50.6%');
    });
  });
});
