import { describe, it, expect } from 'vitest';
import {
  AMAZON_FEE_RATE,
  VINTED_SHIPPING_COST,
  COG_THRESHOLDS,
  calculateTotalCost,
  calculateCogPercent,
  calculateProfit,
  calculateRoi,
  classifyCogPercent,
  isViable,
  isNearMiss,
  calculateArbitrage,
} from '../arbitrage-calculations';

describe('Arbitrage Calculations', () => {
  describe('Constants', () => {
    it('should have correct Amazon fee rate', () => {
      expect(AMAZON_FEE_RATE).toBe(0.1836);
    });

    it('should have correct Vinted shipping cost', () => {
      expect(VINTED_SHIPPING_COST).toBe(2.3);
    });

    it('should have correct COG thresholds', () => {
      expect(COG_THRESHOLDS.EXCELLENT).toBe(30);
      expect(COG_THRESHOLDS.GOOD).toBe(40);
      expect(COG_THRESHOLDS.MARGINAL).toBe(50);
      expect(COG_THRESHOLDS.POOR).toBe(60);
    });
  });

  describe('calculateTotalCost', () => {
    it('should add default shipping cost', () => {
      expect(calculateTotalCost(50)).toBe(52.3);
      expect(calculateTotalCost(100)).toBe(102.3);
    });

    it('should use custom shipping cost when provided', () => {
      expect(calculateTotalCost(50, 5)).toBe(55);
      expect(calculateTotalCost(100, 0)).toBe(100);
    });
  });

  describe('calculateCogPercent', () => {
    it('should calculate COG% correctly', () => {
      // £40 total cost / £100 Amazon = 40%
      expect(calculateCogPercent(40, 100)).toBe(40);

      // £30 total cost / £100 Amazon = 30%
      expect(calculateCogPercent(30, 100)).toBe(30);
    });

    it('should round to 1 decimal place', () => {
      // £33.33 / £100 = 33.33...
      expect(calculateCogPercent(33.33, 100)).toBe(33.3);
    });

    it('should return null for invalid inputs', () => {
      expect(calculateCogPercent(40, null)).toBeNull();
      expect(calculateCogPercent(40, 0)).toBeNull();
      expect(calculateCogPercent(40, -100)).toBeNull();
      expect(calculateCogPercent(-40, 100)).toBeNull();
    });
  });

  describe('calculateProfit', () => {
    it('should calculate profit after Amazon fees', () => {
      // £100 sale - 18.36% fees - £40 cost
      // = £100 * 0.8164 - £40
      // = £81.64 - £40
      // = £41.64
      const profit = calculateProfit(100, 40);
      expect(profit).toBeCloseTo(41.64, 1);
    });

    it('should return null for invalid inputs', () => {
      expect(calculateProfit(null, 40)).toBeNull();
      expect(calculateProfit(0, 40)).toBeNull();
      expect(calculateProfit(-100, 40)).toBeNull();
      expect(calculateProfit(100, -40)).toBeNull();
    });

    it('should use custom fee rate when provided', () => {
      // £100 sale - 20% fees - £40 cost
      // = £80 - £40 = £40
      const profit = calculateProfit(100, 40, 0.2);
      expect(profit).toBe(40);
    });
  });

  describe('calculateRoi', () => {
    it('should calculate ROI correctly', () => {
      // £20 profit / £40 cost = 50% ROI
      expect(calculateRoi(20, 40)).toBe(50);
    });

    it('should round to 1 decimal place', () => {
      // £33.33 profit / £100 cost = 33.33% ROI
      expect(calculateRoi(33.33, 100)).toBe(33.3);
    });

    it('should return null for invalid inputs', () => {
      expect(calculateRoi(null, 40)).toBeNull();
      expect(calculateRoi(20, 0)).toBeNull();
      expect(calculateRoi(20, -40)).toBeNull();
    });
  });

  describe('classifyCogPercent', () => {
    it('should classify excellent opportunities', () => {
      expect(classifyCogPercent(25)).toBe('excellent');
      expect(classifyCogPercent(29.9)).toBe('excellent');
    });

    it('should classify good opportunities', () => {
      expect(classifyCogPercent(30)).toBe('good');
      expect(classifyCogPercent(35)).toBe('good');
      expect(classifyCogPercent(39.9)).toBe('good');
    });

    it('should classify marginal opportunities', () => {
      expect(classifyCogPercent(40)).toBe('marginal');
      expect(classifyCogPercent(45)).toBe('marginal');
      expect(classifyCogPercent(49.9)).toBe('marginal');
    });

    it('should classify poor opportunities', () => {
      expect(classifyCogPercent(50)).toBe('poor');
      expect(classifyCogPercent(55)).toBe('poor');
      expect(classifyCogPercent(59.9)).toBe('poor');
    });

    it('should classify not viable opportunities', () => {
      expect(classifyCogPercent(60)).toBe('not_viable');
      expect(classifyCogPercent(75)).toBe('not_viable');
      expect(classifyCogPercent(100)).toBe('not_viable');
    });

    it('should return unknown for null', () => {
      expect(classifyCogPercent(null)).toBe('unknown');
    });
  });

  describe('isViable', () => {
    it('should return true for COG% at or below default threshold', () => {
      expect(isViable(40)).toBe(true);
      expect(isViable(30)).toBe(true);
      expect(isViable(20)).toBe(true);
    });

    it('should return false for COG% above default threshold', () => {
      expect(isViable(40.1)).toBe(false);
      expect(isViable(50)).toBe(false);
      expect(isViable(60)).toBe(false);
    });

    it('should use custom threshold when provided', () => {
      expect(isViable(45, 50)).toBe(true);
      expect(isViable(55, 50)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isViable(null)).toBe(false);
    });
  });

  describe('isNearMiss', () => {
    it('should identify near misses (above viable, below near-miss threshold)', () => {
      // Default: viable=40, near-miss=50
      expect(isNearMiss(45)).toBe(true);
      expect(isNearMiss(50)).toBe(true);
    });

    it('should not identify viable items as near misses', () => {
      expect(isNearMiss(35)).toBe(false);
      expect(isNearMiss(40)).toBe(false);
    });

    it('should not identify items above near-miss threshold', () => {
      expect(isNearMiss(51)).toBe(false);
      expect(isNearMiss(60)).toBe(false);
    });

    it('should use custom thresholds when provided', () => {
      expect(isNearMiss(55, 50, 60)).toBe(true);
      expect(isNearMiss(45, 50, 60)).toBe(false); // Below viable
      expect(isNearMiss(65, 50, 60)).toBe(false); // Above near-miss
    });

    it('should return false for null', () => {
      expect(isNearMiss(null)).toBe(false);
    });
  });

  describe('calculateArbitrage', () => {
    it('should return complete arbitrage calculation', () => {
      const result = calculateArbitrage(50, 100);

      expect(result.totalCost).toBe(52.3); // £50 + £2.30
      expect(result.cogPercent).toBe(52.3); // 52.3%
      expect(result.profit).not.toBeNull();
      expect(result.roi).not.toBeNull();
      expect(result.classification).toBe('poor'); // 52.3% is poor
      expect(result.isViable).toBe(false);
    });

    it('should identify viable opportunity', () => {
      const result = calculateArbitrage(30, 100);

      expect(result.totalCost).toBe(32.3);
      expect(result.cogPercent).toBe(32.3);
      expect(result.classification).toBe('good');
      expect(result.isViable).toBe(true);
    });

    it('should handle null Amazon price', () => {
      const result = calculateArbitrage(50, null);

      expect(result.totalCost).toBe(52.3);
      expect(result.cogPercent).toBeNull();
      expect(result.profit).toBeNull();
      expect(result.roi).toBeNull();
      expect(result.classification).toBe('unknown');
      expect(result.isViable).toBe(false);
    });

    it('should use custom shipping cost', () => {
      const result = calculateArbitrage(50, 100, 5);

      expect(result.totalCost).toBe(55);
      expect(result.cogPercent).toBe(55);
    });
  });

  describe('Parity with old calculation', () => {
    it('should match old COG% formula: (totalCost / amazonPrice) * 100', () => {
      const vintedPrice = 450;
      const shippingCost = 2.3;
      const amazonPrice = 749.99;

      const totalCost = vintedPrice + shippingCost;
      const oldFormula = (totalCost / amazonPrice) * 100;
      const newCalculation = calculateCogPercent(calculateTotalCost(vintedPrice), amazonPrice);

      expect(newCalculation).toBeCloseTo(oldFormula, 1);
    });

    it('should match old profit formula', () => {
      const amazonPrice = 749.99;
      const totalCost = 452.3;

      // Old formula: amazonPrice - amazonFees - totalCost
      const amazonFees = amazonPrice * 0.1836;
      const oldProfit = amazonPrice - amazonFees - totalCost;

      const newProfit = calculateProfit(amazonPrice, totalCost);

      expect(newProfit).toBeCloseTo(oldProfit, 1);
    });
  });
});
